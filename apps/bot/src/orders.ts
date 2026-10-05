import { ButtonStyle, ComponentType } from "discord.js";
import type { InternalApi, OrderView } from "./api";
import { encodeId } from "./ids";
import { escapeMd, fitLines, type MessagePayload, type Row } from "./render";
import type { Logger } from "./sync";

/**
 * Commandes d'artisanat dans leur salon Discord (lot F) : un message par commande, avec « Je m'en charge » tant
 * qu'elle est ouverte, mis à jour quand elle est prise ou faite. Rendu pur (testé sans Discord) et relève.
 */

const COLOR = { open: 0xc8a04b, taken: 0x5865f2, done: 0x3fa45b } as const;
const STATUS = { open: "Ouverte", taken: "Prise", done: "Faite" } as const;

export function renderOrder(o: OrderView): MessagePayload {
  const what = `${o.item?.name ?? o.recipeName}${o.quantity > 1 ? ` ×${o.quantity}` : ""}`;
  const fields = [
    { name: "Demandé par", value: `${escapeMd(o.requester)}${o.character && o.character !== o.requester ? ` (pour ${escapeMd(o.character)})` : ""}`, inline: true },
    { name: "Statut", value: o.status === "open" ? STATUS.open : `${STATUS[o.status]} · ${escapeMd(o.taker ?? "?")}`, inline: true },
    { name: o.crafters.length ? `Peuvent le faire — ${o.crafters.length}` : "Peuvent le faire", value: o.crafters.length ? fitLines(o.crafters.map(escapeMd), 1024, ", ") : "personne ne connaît le patron pour l'instant", inline: false },
  ];
  if (o.reagents.length) {
    const given = o.reagents.filter(r => r.provided).length;
    fields.push({ name: `Composants — ${given}/${o.reagents.length} fournis`, value: fitLines(o.reagents.map(r => `${r.provided ? "✅" : "▫️"} ${r.n} × ${escapeMd(r.name)}`)), inline: false });
  }
  if (o.note) fields.push({ name: "Détails", value: escapeMd(o.note).slice(0, 1024), inline: false });
  const buttons: Row["components"] = [];
  if (o.status === "open") buttons.push({ type: ComponentType.Button, style: ButtonStyle.Success, label: "Je m'en charge", custom_id: encodeId({ a: "otake", orderId: o.id }) });
  buttons.push({ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: o.url });
  return {
    embeds: [{
      title: `${o.status === "done" ? "✅ " : ""}Commande : ${what}`.slice(0, 256),
      url: o.url,
      color: COLOR[o.status],
      fields,
      footer: { text: `${o.group.name} · commandes d'artisanat`.slice(0, 2048) },
    }],
    components: [{ type: ComponentType.ActionRow, components: buttons }] as Row[],
    allowedMentions: { parse: [] },
  };
}

export interface OrderPublisher { upsert(o: OrderView, messageId: string | null): Promise<{ channelId: string; messageId: string }> }

/** Relève des commandes à publier ; une seule publication à la fois par commande (clic et relève simultanés). */
export function createOrderSync(api: Pick<InternalApi, "ordersOutbox" | "orderPublished">, pub: OrderPublisher, log: Logger) {
  const posted = new Map<string, { channelId: string; messageId: string }>();
  const locks = new Map<string, Promise<unknown>>();
  const failures = new Map<string, number>();
  let running = false;
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, next);
    void next.catch(() => {}).finally(() => { if (locks.get(key) === next) locks.delete(key); });
    return next;
  };
  function publish(o: OrderView) {
    return serial(o.id, async () => {
      const known = posted.get(o.id);
      const msg = await pub.upsert(o, o.messageId ?? (known?.channelId === o.channelId ? known.messageId : null));
      posted.set(o.id, msg);
      await api.orderPublished(o.id, { ...msg, changedAt: o.changedAt });
      failures.delete(o.id);
      return msg;
    });
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { orders } = await api.ordersOutbox();
      for (const o of orders) {
        if ((failures.get(o.id) ?? 0) > Date.now()) continue;
        try { await publish(o); } catch (e) {
          failures.set(o.id, Date.now() + 60e3);
          log.warn(`Commande non publiée (${o.id})`, e instanceof Error ? e.message : e);
        }
      }
    } finally { running = false; }
  }
  return { publish, tick };
}
