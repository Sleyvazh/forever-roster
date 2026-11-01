import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { siteAlerts, siteSettings, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { bindReportsChannel } from "../src/lib/reports";
import { checkSiteStatus, noteBotSeen, outageSpan, recordBackup, siteStatusView } from "../src/lib/site-status";
import { ORIGIN, setup, signedIn, type TestEnv } from "./helpers";

/**
 * Surveillance : le bot Discord (chaque appel à l'API interne compte comme un signe de vie) et la sauvegarde de nuit
 * (signalée par infra/backup/forever-backup.sh). Horloge simulée : app.ctx.now pour les appels, la date passée à
 * checkSiteStatus pour la vérification de chaque minute.
 */

let env: TestEnv;
let internal: FastifyInstance;
let admin: Awaited<ReturnType<typeof signedIn>>;
let member: Awaited<ReturnType<typeof signedIn>>;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
const BOT_DOWN = "Le bot Discord ne répond plus depuis 10 min";
const BACKUP_LATE = "Pas de sauvegarde réussie depuis 26 h";
// Lundi 2 novembre 2026, 10:00 UTC = 11:00 à Paris
const T0 = new Date("2026-11-02T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60e3);
const hour = (n: number) => new Date(T0.getTime() + n * 3600e3);
const ADMIN_MAILS = ["admindeux@example.test", "adminun@example.test"];
const db = () => env.app.ctx.db;

const clock = (d: Date) => { env.app.ctx.now = () => d; };
const bot = (method: string, url: string, payload: object = {}, secret = SECRET) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${secret}` }, ...(method === "GET" ? {} : { payload }) });
/** Un appel du bot à l'API interne, à cette heure. */
const botCall = (d: Date) => { clock(d); return bot("GET", "/internal/discord/channel-names"); };
const check = (d: Date, ctx: Parameters<typeof checkSiteStatus>[0] = env.app.ctx) => checkSiteStatus(ctx, d);
/** Vérification d'un moment où le bot répond (pour ne regarder que la sauvegarde). */
const healthy = (d: Date) => { noteBotSeen(d); return check(d); };
const alerts = () => db().select().from(siteAlerts).orderBy(asc(siteAlerts.id));
const kinds = async () => (await alerts()).map(a => a.kind);
const recipients = () => env.mailer.outbox.map(m => m.to).sort();

/** Module rechargé comme au démarrage de l'API : sa mémoire « bot vu » repart de l'heure de démarrage. */
async function restartedAt(start: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  vi.resetModules();
  try { return await import("../src/lib/site-status"); } finally { vi.useRealTimers(); }
}

beforeAll(async () => {
  env = await setup();
  internal = await buildInternalApp(env.app.ctx);
  await internal.ready();
  // Deux admins avec adresse confirmée, un admin sans adresse confirmée, un simple membre
  for (const name of ["AdminUn", "AdminDeux"]) {
    const a = await signedIn(env, name);
    await db().update(users).set({ siteAdmin: true }).where(eq(users.id, a.user.id));
    if (name === "AdminUn") admin = a;
  }
  member = await signedIn(env, "Membre");
  const unverified = await signedIn(env, "AdminSansMail");
  await db().update(users).set({ siteAdmin: true, emailVerifiedAt: null }).where(eq(users.id, unverified.user.id));
});
afterAll(async () => { await internal.close(); await env.close(); });
beforeEach(async () => {
  await db().delete(siteAlerts);
  await db().delete(siteSettings).where(eq(siteSettings.key, "backup_status"));
  env.mailer.outbox.length = 0;
  noteBotSeen(T0);
  clock(T0);
});
afterEach(() => { env.app.ctx.now = undefined; });

describe("surveillance du bot Discord", () => {
  it("9 min sans appel : rien ; 11 min : une alerte et un e-mail à chaque admin ; une seule alerte par coupure", async () => {
    await check(min(9));
    expect(await alerts()).toEqual([]);
    expect(env.mailer.outbox).toEqual([]);

    await check(min(11));
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "bot_down", text: BOT_DOWN, postedAt: null });
    // L'alerte date du moment où le silence a atteint 10 min ; l'e-mail est parti à la vérification
    expect(rows[0]!.createdAt).toEqual(min(10));
    expect(rows[0]!.emailedAt).toEqual(min(11));
    // Admins avec adresse confirmée seulement : ni le membre, ni l'admin sans adresse confirmée
    expect(recipients()).toEqual(ADMIN_MAILS);
    const mail = env.mailer.outbox[0]!;
    expect(mail.subject).toBe(`[Forever Roster] ${BOT_DOWN}`);
    expect(mail.fromName).toBe("Forever Roster");
    expect(mail.text).toContain("Le bot Discord ne répond plus depuis 10 min (dernier signe de vie : lun. 02/11 à 11:00).");
    expect(mail.text).toContain("plus d'annonces de raids ni de sorties, plus de rappels en message privé, plus de commandes");
    expect(mail.text).toContain("docker compose ps");
    expect(mail.text).toContain("docker compose logs bot");
    expect(mail.text).toContain(`${ORIGIN}/admin/signalements`);

    // Encore des vérifications pendant la coupure : toujours une seule alerte, pas d'autre e-mail
    await check(min(12));
    await check(min(45));
    expect(await kinds()).toEqual(["bot_down"]);
    expect(env.mailer.outbox).toHaveLength(2);
  });

  it("au retour du bot : une alerte « répond à nouveau (coupure de N min) », puis une nouvelle coupure compte à part", async () => {
    await check(min(11));
    expect((await botCall(min(23))).statusCode).toBe(200);
    await check(min(23));
    expect((await alerts()).map(a => [a.kind, a.text])).toEqual([
      ["bot_down", BOT_DOWN],
      ["bot_up", "Le bot Discord répond à nouveau (coupure de 23 min)"],
    ]);
    expect(env.mailer.outbox.filter(m => m.subject.includes("répond à nouveau")).map(m => m.to).sort()).toEqual(ADMIN_MAILS);
    expect(env.mailer.outbox.at(-1)!.text).toContain("Le bot Discord répond à nouveau (coupure de 23 min).");

    // Rien de plus tant que le bot répond
    await botCall(min(30));
    await check(min(30));
    expect(await kinds()).toEqual(["bot_down", "bot_up"]);

    // Il se tait de nouveau : nouvelle coupure, nouvelle alerte
    await check(min(41));
    expect(await kinds()).toEqual(["bot_down", "bot_up", "bot_down"]);
  });

  it("coupure longue : « coupure de N min » sous une heure, « 3 h 05 » à partir d'une heure (alerte, salon et e-mail)", async () => {
    await check(min(11));
    await botCall(min(185));
    await check(min(185));
    expect((await alerts()).map(a => a.text)).toEqual([BOT_DOWN, "Le bot Discord répond à nouveau (coupure de 3 h 05)"]);
    expect(env.mailer.outbox.at(-1)!.subject).toBe("[Forever Roster] Le bot Discord répond à nouveau (coupure de 3 h 05)");
    expect(env.mailer.outbox.at(-1)!.text).toContain("Le bot Discord répond à nouveau (coupure de 3 h 05).");
  });

  it("durée d'une coupure : minutes sous une heure, puis heures et minutes sur deux chiffres (« 1 h » quand les minutes sont à 0)", () => {
    expect([10, 23, 59, 60, 61, 65, 125, 185, 600, 605, 1500].map(outageSpan)).toEqual(
      ["10 min", "23 min", "59 min", "1 h", "1 h 01", "1 h 05", "2 h 05", "3 h 05", "10 h", "10 h 05", "25 h"]);
  });

  it("un appel sans le secret interne n'est pas un signe de vie", async () => {
    await check(min(11));
    clock(min(12));
    expect((await bot("GET", "/internal/discord/channel-names", {}, "mauvais-secret")).statusCode).toBe(401);
    await check(min(12));
    expect(await kinds()).toEqual(["bot_down"]);
  });

  it("l'API vient de démarrer et n'a encore rien vu : rien avant 10 min, une alerte ensuite", async () => {
    const fresh = await restartedAt(T0);
    await fresh.checkSiteStatus(env.app.ctx, T0);
    await fresh.checkSiteStatus(env.app.ctx, min(9));
    expect(await alerts()).toEqual([]);
    expect(env.mailer.outbox).toEqual([]);
    await fresh.checkSiteStatus(env.app.ctx, min(11));
    expect(await kinds()).toEqual(["bot_down"]);
  });

  it("l'API redémarre pendant une coupure : pas de seconde alerte, pas de faux retour avant un vrai appel du bot", async () => {
    await check(min(11));
    const fresh = await restartedAt(min(30));
    await fresh.checkSiteStatus(env.app.ctx, min(31));
    await fresh.checkSiteStatus(env.app.ctx, min(45));
    expect(await kinds()).toEqual(["bot_down"]);
    // La page garde le vrai dernier signe de vie, pas l'heure de démarrage
    expect((await fresh.siteStatusView(db(), min(45), env.cfg)).bot).toEqual({ watched: true, lastSeenAt: T0.toISOString(), down: true, downSince: T0.toISOString() });

    fresh.noteBotSeen(min(50));
    await fresh.checkSiteStatus(env.app.ctx, min(50));
    expect((await alerts()).map(a => a.text)).toEqual([BOT_DOWN, "Le bot Discord répond à nouveau (coupure de 50 min)"]);
  });

  it("sans secret interne (pas de bot sur ce serveur) : pas d'alerte du bot", async () => {
    const noBot = { ...env.app.ctx, cfg: { ...env.cfg, INTERNAL_API_SECRET: "" } };
    await check(min(60), noBot);
    expect(await alerts()).toEqual([]);
  });
});

describe("surveillance de la sauvegarde de nuit", () => {
  it("25 h : rien ; 27 h : une alerte et un e-mail à chaque admin ; une nouvelle sauvegarde : « Sauvegarde rétablie »", async () => {
    await recordBackup(db(), 48_300_000, T0);
    expect(await alerts()).toEqual([]);
    await healthy(hour(25));
    expect(await alerts()).toEqual([]);
    expect(env.mailer.outbox).toEqual([]);

    await healthy(hour(27));
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "backup_late", text: BACKUP_LATE, postedAt: null, createdAt: hour(27), emailedAt: hour(27) });
    expect(recipients()).toEqual(ADMIN_MAILS);
    const mail = env.mailer.outbox[0]!;
    expect(mail.subject).toBe(`[Forever Roster] ${BACKUP_LATE}`);
    expect(mail.text).toContain("dernière sauvegarde réussie : lun. 02/11 à 11:00");
    expect(mail.text).toContain("journalctl -u forever-backup.service");
    expect(mail.text).toContain(`${ORIGIN}/admin/signalements`);

    // Une seule alerte par retard
    await healthy(hour(30));
    expect(await kinds()).toEqual(["backup_late"]);
    expect(env.mailer.outbox).toHaveLength(2);

    // La sauvegarde suivante réussit : un seul « rétabli », puis plus rien
    await recordBackup(db(), 48_100_000, hour(31));
    await healthy(hour(31));
    expect((await alerts()).map(a => [a.kind, a.text])).toEqual([["backup_late", BACKUP_LATE], ["backup_ok", "Sauvegarde rétablie"]]);
    expect(env.mailer.outbox).toHaveLength(4);
    expect(env.mailer.outbox.at(-1)!.subject).toBe("[Forever Roster] Sauvegarde rétablie");
    await healthy(hour(40));
    expect(await kinds()).toEqual(["backup_late", "backup_ok"]);

    // 26 h après la nouvelle sauvegarde : un nouveau retard
    await healthy(hour(58));
    expect(await kinds()).toEqual(["backup_late", "backup_ok", "backup_late"]);
  });

  it("une sauvegarde qui réussit sans retard ne crée aucune alerte", async () => {
    await recordBackup(db(), 1000, T0);
    await recordBackup(db(), 2000, hour(24));
    await healthy(hour(25));
    expect(await alerts()).toEqual([]);
    const [row] = await db().select().from(siteSettings).where(eq(siteSettings.key, "backup_status"));
    expect(row!.value).toEqual({ at: hour(24).toISOString(), bytes: 2000, watchSince: T0.toISOString() });
  });

  it("aucune sauvegarde jamais signalée (script pas réinstallé) : alerte 26 h après le début de la surveillance, pas avant", async () => {
    await healthy(T0);
    const [row] = await db().select().from(siteSettings).where(eq(siteSettings.key, "backup_status"));
    expect(row!.value).toEqual({ at: null, bytes: null, watchSince: T0.toISOString() });
    await healthy(hour(25));
    expect(await alerts()).toEqual([]);
    await healthy(hour(27));
    expect(await kinds()).toEqual(["backup_late"]);
    // Une seule parenthèse : la date de début de la surveillance suit une virgule, elle n'en ouvre pas une deuxième
    expect(env.mailer.outbox.at(-1)!.text).toContain(
      "Pas de sauvegarde réussie depuis 26 h (aucune sauvegarde réussie n'a été signalée depuis le début de la surveillance, le lun. 02/11 à 11:00).");
  });
});

describe("État du site (admins)", () => {
  it("réservé aux admins du site : 200 avec l'état du bot, de la sauvegarde et les alertes, 403 pour un membre, 401 sans compte", async () => {
    clock(min(2));
    expect((await member.c.get("/api/admin/site-status")).statusCode).toBe(403);
    expect((await member.c.get("/api/admin/site-status")).json()).toEqual({ error: "Réservé aux admins du site." });
    expect((await env.app.inject({ method: "GET", url: "/api/admin/site-status" })).statusCode).toBe(401);

    const ok = await admin.c.get("/api/admin/site-status");
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      bot: { watched: true, lastSeenAt: T0.toISOString(), down: false, downSince: null },
      backup: { at: null, bytes: null, late: false },
      alerts: [],
    });
  });

  it("sans secret interne (pas de bot sur ce serveur) : « bot non surveillé », jamais « ne répond plus », quelle que soit l'heure ; la sauvegarde l'est toujours", async () => {
    const real = env.app.ctx.cfg;
    const noBot = { INTERNAL_API_SECRET: "" };
    // Un bot jamais vu depuis 6 h : surveillé, il serait tombé ; sans bot sur le serveur, rien à dire
    const unwatched = { watched: false, lastSeenAt: null, down: false, downSince: null };
    expect((await siteStatusView(db(), hour(6), env.cfg)).bot).toMatchObject({ watched: true, down: true });
    expect((await siteStatusView(db(), hour(6), noBot)).bot).toEqual(unwatched);
    // Même avec une coupure restée dans la base (le secret a été retiré depuis)
    await check(min(11));
    expect(await kinds()).toEqual(["bot_down"]);
    expect((await siteStatusView(db(), hour(6), noBot)).bot).toEqual(unwatched);

    // Par la route des admins, avec la configuration du serveur sans secret
    env.app.ctx.cfg = { ...real, INTERNAL_API_SECRET: "" };
    try {
      clock(hour(6));
      const v = (await admin.c.get("/api/admin/site-status")).json();
      expect(v.bot).toEqual(unwatched);
      expect(v.backup).toEqual({ at: null, bytes: null, late: false });
    } finally { env.app.ctx.cfg = real; }
  });

  it("bot tombé, sauvegarde en retard : « ne répond plus », « en retard » et les 5 dernières alertes, la plus récente en premier", async () => {
    await recordBackup(db(), 48_100_000, T0);
    await check(min(14));
    // Pas encore de sauvegarde en retard à 14 min
    expect((await siteStatusView(db(), min(14), env.cfg)).backup).toEqual({ at: T0.toISOString(), bytes: 48_100_000, late: false });

    await check(hour(27));
    clock(hour(27));
    const v = (await admin.c.get("/api/admin/site-status")).json();
    expect(v.bot).toEqual({ watched: true, lastSeenAt: T0.toISOString(), down: true, downSince: T0.toISOString() });
    expect(v.backup).toEqual({ at: T0.toISOString(), bytes: 48_100_000, late: true });
    expect(v.alerts).toEqual([
      { at: hour(27).toISOString(), kind: "backup_late", text: BACKUP_LATE },
      { at: min(10).toISOString(), kind: "bot_down", text: BOT_DOWN },
    ]);

    // Plus de 5 alertes : les 5 dernières seulement
    for (let i = 0; i < 6; i++) await db().insert(siteAlerts).values({ kind: "backup_ok", text: `Sauvegarde rétablie ${i}`, createdAt: hour(28 + i) });
    const last = (await siteStatusView(db(), hour(40), env.cfg)).alerts;
    expect(last.map(a => a.text)).toEqual([5, 4, 3, 2, 1].map(i => `Sauvegarde rétablie ${i}`));
  });
});

describe("alertes à poster dans le salon des admins (bot)", () => {
  const CHANNEL = "300000000000000002";

  it("sans salon des signalements lié : rien à poster", async () => {
    await check(min(11));
    expect((await bot("GET", "/internal/discord/site-alerts/outbox")).json()).toEqual({ alerts: [] });
  });

  it("listées du plus ancien au plus récent jusqu'à ce que le bot confirme leur publication, puis disparues", async () => {
    await bindReportsChannel(db(), { guildId: "100000000000000001", channelId: CHANNEL });
    await check(min(11));
    await botCall(min(23));
    await check(min(23));

    const list = async () => (await bot("GET", "/internal/discord/site-alerts/outbox")).json().alerts as { id: number; kind: string; text: string; at: string; channelId: string }[];
    const [first, second, ...none] = await list();
    expect(none).toEqual([]);
    expect(first).toMatchObject({ kind: "bot_down", text: BOT_DOWN, at: min(10).toISOString(), channelId: CHANNEL });
    expect(second).toMatchObject({ kind: "bot_up", text: "Le bot Discord répond à nouveau (coupure de 23 min)", at: min(23).toISOString(), channelId: CHANNEL });
    expect(first!.id).toBeLessThan(second!.id);

    clock(min(24));
    expect((await bot("POST", `/internal/discord/site-alerts/${first!.id}/posted`)).json()).toEqual({ ok: true });
    expect((await list()).map(a => a.id)).toEqual([second!.id]);
    const [row] = await db().select().from(siteAlerts).where(eq(siteAlerts.id, first!.id));
    expect(row!.postedAt).toEqual(min(24));

    await bot("POST", `/internal/discord/site-alerts/${second!.id}/posted`);
    expect(await list()).toEqual([]);
    // Confirmer deux fois ne change rien
    expect((await bot("POST", `/internal/discord/site-alerts/${second!.id}/posted`)).statusCode).toBe(200);
    expect((await db().select().from(siteAlerts).orderBy(desc(siteAlerts.id)))).toHaveLength(2);
  });

  it("réservé au bot : le secret interne est exigé", async () => {
    expect((await bot("GET", "/internal/discord/site-alerts/outbox", {}, "mauvais-secret")).statusCode).toBe(401);
    expect((await bot("POST", "/internal/discord/site-alerts/1/posted", {}, "mauvais-secret")).statusCode).toBe(401);
  });
});
