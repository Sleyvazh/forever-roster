import { GAME_TIMEZONE } from "@forever/game-data";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { siteAlerts, siteSettings, users, type SiteAlertKind } from "../db/schema";
import type { Mailer } from "./mailer";
import { siteForGame } from "./site";

/**
 * Surveillance du site : le bot Discord et la sauvegarde de nuit. Chaque minute, server.ts appelle checkSiteStatus ;
 * une alerte (table site_alerts) naît par coupure ou par retard, une autre au retour à la normale. Elle part aussitôt par
 * e-mail aux admins du site (même bot tombé), puis le bot la poste dans le salon des signalements quand il répond.
 * L'API ne peut pas se signaler elle-même : pour une panne du site entier, un moniteur externe (docs/operations.md).
 */

/** Plus de signe de vie du bot au-delà de ce silence : alerte. */
const BOT_SILENCE_MS = 10 * 60e3;
/** Pas de sauvegarde réussie depuis ce temps : alerte. */
const BACKUP_LATE_MS = 26 * 3600e3;
const BACKUP_KEY = "backup_status";

/** « 23 min » sous une heure, puis « 3 h 05 » (heures, minutes sur deux chiffres) et « 2 h » pile. */
export function outageSpan(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

/** Textes des alertes (ceux de la maquette : 10 min = BOT_SILENCE_MS, 26 h = BACKUP_LATE_MS). */
const TEXT = {
  botDown: "Le bot Discord ne répond plus depuis 10 min",
  botUp: (minutes: number) => `Le bot Discord répond à nouveau (coupure de ${outageSpan(minutes)})`,
  backupLate: "Pas de sauvegarde réussie depuis 26 h",
  backupOk: "Sauvegarde rétablie",
};

/* ----- Le bot : chaque appel à l'API interne est un signe de vie ----- */

/**
 * Mémoire du processus : dernier appel du bot. Tant que l'API n'a rien vu depuis son démarrage, le démarrage tient lieu
 * de signe de vie : un redémarrage de l'API (déploiement) ne déclenche pas de fausse alerte avant 10 minutes.
 */
const startedAt = new Date();
let lastCall: Date | null = null;
export function noteBotSeen(now: Date): void { lastCall = now; }
const botSeenAt = () => lastCall ?? startedAt;

/** Dernière alerte d'une famille (bot, sauvegarde) : « ne répond plus » / « en retard » dit qu'un incident est ouvert. */
async function lastAlert(db: Db, kinds: SiteAlertKind[]) {
  const [row] = await db.select().from(siteAlerts).where(inArray(siteAlerts.kind, kinds)).orderBy(desc(siteAlerts.id)).limit(1);
  return row ?? null;
}
const addAlert = (db: Db, kind: SiteAlertKind, text: string, createdAt: Date) => db.insert(siteAlerts).values({ kind, text, createdAt });

/**
 * Coupure en cours (lue dans la base : elle survit à un redémarrage de l'API). L'alerte date du moment où le silence a
 * atteint 10 min, d'où le dernier signe de vie d'avant la coupure.
 */
async function botIncident(db: Db) {
  const last = await lastAlert(db, ["bot_down", "bot_up"]);
  return last?.kind === "bot_down" ? { alertAt: last.createdAt, since: new Date(last.createdAt.getTime() - BOT_SILENCE_MS) } : null;
}
/** Moment où le bot a rappelé depuis l'alerte (jamais avant un vrai appel : le démarrage de l'API ne compte pas), sinon null. */
const returnedAt = (incident: { alertAt: Date }) => (lastCall && lastCall > incident.alertAt ? lastCall : null);

async function checkBot(db: Db, now: Date) {
  const incident = await botIncident(db);
  if (incident) {
    const back = returnedAt(incident);
    if (back) await addAlert(db, "bot_up", TEXT.botUp(Math.round((back.getTime() - incident.since.getTime()) / 60e3)), back);
  } else if (now.getTime() - botSeenAt().getTime() > BOT_SILENCE_MS) {
    await addAlert(db, "bot_down", TEXT.botDown, new Date(botSeenAt().getTime() + BOT_SILENCE_MS));
  }
}

/* ----- La sauvegarde de nuit : forever-backup.sh la signale à la fin de chaque sauvegarde réussie ----- */

/** watchSince : début de la surveillance, pour dater le retard tant qu'aucune sauvegarde n'a jamais été signalée. */
interface BackupStatus { at: string | null; bytes: number | null; watchSince: string }

async function readBackup(db: Db): Promise<BackupStatus | null> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, BACKUP_KEY));
  const v = row?.value as Partial<BackupStatus> | undefined;
  return v?.watchSince ? { at: v.at ?? null, bytes: v.bytes ?? null, watchSince: v.watchSince } : null;
}
const isLate = (st: BackupStatus, now: Date) => now.getTime() - Date.parse(st.at ?? st.watchSince) > BACKUP_LATE_MS;

/** Une alerte au passage en retard, une autre au retour à la normale (jamais deux de suite). */
async function settleBackup(db: Db, st: BackupStatus, now: Date) {
  const open = (await lastAlert(db, ["backup_late", "backup_ok"]))?.kind === "backup_late";
  const late = isLate(st, now);
  if (late && !open) await addAlert(db, "backup_late", TEXT.backupLate, now);
  else if (!late && open) await addAlert(db, "backup_ok", TEXT.backupOk, now);
}

/** À la fin d'une sauvegarde réussie (node dist/site-status.js backup-ok <octets>) : date, taille, et fin d'un éventuel retard. */
export async function recordBackup(db: Db, bytes: number, now: Date) {
  const prev = await readBackup(db);
  const st: BackupStatus = { at: now.toISOString(), bytes, watchSince: prev?.watchSince ?? now.toISOString() };
  await db.insert(siteSettings).values({ key: BACKUP_KEY, value: { ...st } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { ...st }, updatedAt: now } });
  await settleBackup(db, st, now);
}

async function checkBackup(db: Db, now: Date) {
  let st = await readBackup(db);
  if (!st) {
    // Première vérification : la surveillance commence ici (script de sauvegarde peut-être pas encore réinstallé)
    st = { at: null, bytes: null, watchSince: now.toISOString() };
    await db.insert(siteSettings).values({ key: BACKUP_KEY, value: { ...st } }).onConflictDoNothing();
    st = (await readBackup(db)) ?? st;
  }
  await settleBackup(db, st, now);
}

/* ----- La vérification de chaque minute ----- */

export interface SiteStatusContext { db: Db; mailer: Mailer; cfg: Config }

/** Sans secret interne, il n'y a pas de bot sur ce serveur (développement, tests, serveur sans Discord) : rien à surveiller de ce côté. */
const botWatched = (cfg: Pick<Config, "INTERNAL_API_SECRET">) => !!cfg.INTERNAL_API_SECRET;

export async function checkSiteStatus(ctx: SiteStatusContext, now: Date): Promise<void> {
  if (botWatched(ctx.cfg)) await checkBot(ctx.db, now);
  await checkBackup(ctx.db, now);
  await mailPending(ctx, now);
}

/* ----- E-mails aux admins du site ----- */

const whenFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: GAME_TIMEZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** « lun. 02/11 à 11:00 », heure de Paris. */
function when(d: Date | string) {
  const p = Object.fromEntries(whenFmt.formatToParts(new Date(d)).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day}/${p.month} à ${p.hour}:${p.minute}`;
}

/** Ce que l'alerte veut dire et que faire (paragraphes de l'e-mail, après le texte de l'alerte). */
async function details(db: Db, a: typeof siteAlerts.$inferSelect): Promise<string[]> {
  switch (a.kind) {
    case "bot_down": return [
      `${a.text} (dernier signe de vie : ${when(new Date(a.createdAt.getTime() - BOT_SILENCE_MS))}).`,
      "Tant qu'il est arrêté : plus d'annonces de raids ni de sorties, plus de rappels en message privé, plus de commandes.",
      "À regarder sur le serveur : docker compose ps, puis docker compose logs bot.",
      "Une seule alerte part par coupure. Tu recevras un autre message quand le bot répondra de nouveau.",
    ];
    case "bot_up": return [
      `${a.text}.`,
      "Tout est rentré dans l'ordre : annonces de raids et de sorties, rappels en message privé et commandes fonctionnent de nouveau.",
    ];
    case "backup_late": {
      const st = await readBackup(db);
      const since = st?.at ? `dernière sauvegarde réussie : ${when(st.at)}`
        : `aucune sauvegarde réussie n'a été signalée depuis le début de la surveillance${st ? `, le ${when(st.watchSince)}` : ""}`;
      return [
        `${a.text} (${since}).`,
        "Tant qu'aucune sauvegarde ne réussit, la base n'est plus copiée : si le serveur tombait, on repartirait d'une copie de plus en plus ancienne.",
        "À regarder sur le serveur : systemctl list-timers forever-backup.timer, puis journalctl -u forever-backup.service. Si le script n'a pas été réinstallé depuis la mise en place de la surveillance, la commande est dans docs/operations.md (Sauvegardes).",
        "Une seule alerte part par retard. Tu recevras un autre message quand une sauvegarde réussira de nouveau.",
      ];
    }
    case "backup_ok": return [
      `${a.text}.`,
      "Une sauvegarde de nuit vient de réussir : la base est de nouveau copiée.",
    ];
  }
}

/** Alertes pas encore envoyées, par e-mail à chaque admin du site dont l'adresse est confirmée. */
async function mailPending({ db, mailer, cfg }: SiteStatusContext, now: Date) {
  const pending = await db.select().from(siteAlerts).where(isNull(siteAlerts.emailedAt)).orderBy(asc(siteAlerts.id));
  if (!pending.length) return;
  const admins = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.siteAdmin, true), isNotNull(users.email), isNotNull(users.emailVerifiedAt)));
  const site = siteForGame(cfg, "forever");
  for (const a of pending) {
    // Réservée avant l'envoi : deux vérifications qui se chevauchent n'envoient jamais deux fois la même alerte
    const [claimed] = await db.update(siteAlerts).set({ emailedAt: now }).where(and(eq(siteAlerts.id, a.id), isNull(siteAlerts.emailedAt))).returning({ id: siteAlerts.id });
    if (!claimed) continue;
    const text = [
      "Bonjour,", "",
      ...(await details(db, a)).flatMap(p => [p, ""]),
      `État en direct : page « Administration du site » de ${site.name}.`,
      `${site.origin}/admin/signalements`,
    ].join("\n");
    for (const { email } of admins) await mailer.send({ to: email!, subject: `[${site.name}] ${a.text}`, text, fromName: site.name });
  }
}

/* ----- Pour la page des admins et pour le bot ----- */

export interface SiteStatusView {
  /** watched : false quand il n'y a pas de bot sur ce serveur (ni dernier signe de vie, ni coupure à montrer). */
  bot: { watched: boolean; lastSeenAt: string | null; down: boolean; downSince: string | null };
  backup: { at: string | null; bytes: number | null; late: boolean };
  /** Les 5 dernières, la plus récente d'abord. */
  alerts: { at: string; kind: string; text: string }[];
}

async function botView(db: Db, now: Date, cfg: Pick<Config, "INTERNAL_API_SECRET">): Promise<SiteStatusView["bot"]> {
  if (!botWatched(cfg)) return { watched: false, lastSeenAt: null, down: false, downSince: null };
  const incident = await botIncident(db);
  // Coupure signalée et le bot n'a pas rappelé : le dernier signe de vie est celui d'avant la coupure (même après un redémarrage de l'API)
  const ongoing = incident && !returnedAt(incident) ? incident : null;
  const lastSeen = ongoing ? ongoing.since : botSeenAt();
  const down = !!ongoing || now.getTime() - lastSeen.getTime() > BOT_SILENCE_MS;
  return { watched: true, lastSeenAt: lastSeen.toISOString(), down, downSince: down ? lastSeen.toISOString() : null };
}

export async function siteStatusView(db: Db, now: Date, cfg: Pick<Config, "INTERNAL_API_SECRET">): Promise<SiteStatusView> {
  const st = await readBackup(db);
  const alerts = await db.select().from(siteAlerts).orderBy(desc(siteAlerts.id)).limit(5);
  return {
    bot: await botView(db, now, cfg),
    backup: { at: st?.at ?? null, bytes: st?.bytes ?? null, late: !!st && isLate(st, now) },
    alerts: alerts.map(a => ({ at: a.createdAt.toISOString(), kind: a.kind, text: a.text })),
  };
}

/** Alertes à poster dans le salon des signalements, la plus ancienne d'abord (la coupure avant le retour). */
export async function pendingSiteAlerts(db: Db, channelId: string) {
  const rows = await db.select().from(siteAlerts).where(isNull(siteAlerts.postedAt)).orderBy(asc(siteAlerts.id)).limit(20);
  return rows.map(r => ({ id: r.id, kind: r.kind, text: r.text, at: r.createdAt.toISOString(), channelId }));
}

export async function markSiteAlertPosted(db: Db, id: number, now: Date) {
  await db.update(siteAlerts).set({ postedAt: now }).where(and(eq(siteAlerts.id, id), isNull(siteAlerts.postedAt)));
}
