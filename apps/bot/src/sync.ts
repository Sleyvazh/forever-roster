import type { InternalApi, RaidView } from "./api";

/**
 * Synchronisation des annonces : le site marque les raids modifiés, le bot relève la « boîte d'envoi »
 * toutes les quelques secondes, publie ou met à jour les messages, puis confirme la version publiée.
 */

export interface Publisher {
  /** Publie ou met à jour l'annonce ; renvoie le message obtenu. */
  upsert(view: RaidView, messageId: string | null): Promise<{ channelId: string; messageId: string }>;
  /** Supprime un message (sans erreur s'il n'existe plus). */
  remove(channelId: string, messageId: string): Promise<void>;
}
export interface Logger { info(msg: string, extra?: unknown): void; warn(msg: string, extra?: unknown): void }

const MAX_BACKOFF = 10 * 60e3;

export function createSync(api: Pick<InternalApi, "outbox" | "published" | "deletionDone">, pub: Publisher, log: Logger, now = () => Date.now()) {
  /** Dernier message connu par raid : évite un doublon si l'API n'a pas encore enregistré la publication. */
  const posted = new Map<string, { channelId: string; messageId: string }>();
  /** Une seule publication à la fois par raid (clic de bouton et relève simultanés). */
  const locks = new Map<string, Promise<unknown>>();
  /** Échecs répétés (salon supprimé, droits retirés…) : on réessaie de plus en plus tard. */
  const failures = new Map<string, { n: number; until: number }>();
  let running = false;

  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    void next.catch(() => {}).finally(() => { if (locks.get(key) === next) locks.delete(key); });
    return next;
  };

  const fail = (key: string, err: unknown) => {
    const n = (failures.get(key)?.n ?? 0) + 1;
    const delay = Math.min(MAX_BACKOFF, 15e3 * 2 ** (n - 1));
    failures.set(key, { n, until: now() + delay });
    log.warn(`Échec (${key}), nouvel essai dans ${Math.round(delay / 1000)} s`, err instanceof Error ? err.message : err);
  };
  const waiting = (key: string) => (failures.get(key)?.until ?? 0) > now();

  function publish(view: RaidView) {
    return serial(view.raid.id, async () => {
      const known = posted.get(view.raid.id);
      const messageId = view.messageId ?? (known?.channelId === view.channelId ? known.messageId : null);
      const msg = await pub.upsert(view, messageId);
      posted.set(view.raid.id, msg);
      await api.published(view.raid.id, { ...msg, changedAt: view.raid.changedAt });
      failures.delete(view.raid.id);
      return msg;
    });
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const { raids, deletions } = await api.outbox();
      for (const view of raids) {
        if (waiting(view.raid.id)) continue;
        try { await publish(view); } catch (e) { fail(view.raid.id, e); }
      }
      for (const d of deletions) {
        const key = `del:${d.id}`;
        if (waiting(key)) continue;
        try {
          await pub.remove(d.channelId, d.messageId);
          await api.deletionDone(d.id);
          failures.delete(key);
          for (const [raidId, m] of posted) if (m.messageId === d.messageId) posted.delete(raidId);
        } catch (e) { fail(key, e); }
      }
    } finally { running = false; }
  }

  return { publish, tick };
}
