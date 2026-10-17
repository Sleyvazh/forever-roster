import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, bnetImports, devices, discordDeletions, emailTokens, reports, sessions, siteSettings, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { randomToken, sha256 } from "../src/lib/crypto";
import { purgeOldData } from "../src/lib/purges";
import { setup, signedIn, type TestEnv } from "./helpers";

/** Purges automatiques (lib/purges.ts) et effacement du compte : ce qui part, ce qui reste. */
let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const db = () => env.app.ctx.db;
const DAY = 86400e3;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const bot = (url: string) => internal.inject({ method: "GET", url, headers: { authorization: `Bearer ${SECRET}` } });
const auditOf = (userId: string) => db().select().from(auditEvents).where(eq(auditEvents.userId, userId));

describe("purges automatiques", () => {
  it("journal de sécurité : effacé après 12 mois ; le journal d'un groupe reste, sans IP ni navigateur", async () => {
    const { c, user } = await signedIn(env, "Archiviste");
    const gid = (await c.post("/api/groups", { name: "Les Anciens" })).json().group.id as string;
    const mine = await auditOf(user.id);
    const solo = mine.filter(e => !e.groupId);
    const inGroup = mine.find(e => e.groupId === gid && e.type === "group_created")!;
    expect(solo.length).toBeGreaterThanOrEqual(3); // inscription, adresse confirmée, connexion
    expect(inGroup.ip).not.toBeNull();
    // Inscription et création du groupe : il y a 13 mois ; adresse confirmée : il y a 11 mois et demi ; le reste est récent
    const register = solo.find(e => e.type === "register")!;
    const verified = solo.find(e => e.type === "email_verified")!;
    await db().update(auditEvents).set({ createdAt: ago(396) }).where(inArray(auditEvents.id, [register.id, inGroup.id]));
    await db().update(auditEvents).set({ createdAt: ago(350) }).where(eq(auditEvents.id, verified.id));
    // Échec de connexion avec une adresse inconnue (sans compte), il y a 13 mois
    await db().insert(auditEvents).values({ type: "login_failure", ip: "203.0.113.7", userAgent: FIREFOX, createdAt: ago(396) });

    const n = await purgeOldData(db());
    expect(n).toMatchObject({ audit: 2, auditStripped: 1 });
    const after = await auditOf(user.id);
    expect(after.map(e => e.id)).not.toContain(register.id);
    expect(after.find(e => e.id === verified.id)?.ip).toBeTruthy();
    expect(after.filter(e => !e.groupId)).toHaveLength(solo.length - 1);
    expect(after.filter(e => !e.groupId).every(e => e.ip)).toBe(true);
    expect(after.find(e => e.id === inGroup.id)).toMatchObject({ ip: null, userAgent: null, type: "group_created" });
    expect(await db().select().from(auditEvents).where(eq(auditEvents.ip, "203.0.113.7"))).toEqual([]);
    // Toujours dans le journal du groupe
    expect((await c.get(`/api/groups/${gid}/audit`)).json().events.map((e: { id: number }) => e.id)).toContain(inGroup.id);
    // Rien de plus au passage suivant
    expect(await purgeOldData(db())).toMatchObject({ audit: 0, auditStripped: 0 });
  });

  it("par lots : tout un arriéré part en un passage, lot après lot", async () => {
    await db().execute(sql`INSERT INTO audit_events (type, ip, created_at) SELECT 'login_failure', '198.51.100.1', now() - interval '400 days' FROM generate_series(1, 2500)`);
    expect((await purgeOldData(db())).audit).toBe(2500);
    expect(await db().select().from(auditEvents).where(eq(auditEvents.ip, "198.51.100.1"))).toEqual([]);
  });

  it("sessions, appareils déliés, liens d'e-mail : effacés 30 jours après leur fin ; import Battle.net dès son expiration", async () => {
    const { user } = await signedIn(env, "Menagere");
    const other = await signedIn(env, "Voisine");
    const session = (name: string, v: Partial<typeof sessions.$inferInsert>) =>
      ({ userId: user.id, tokenHash: sha256(randomToken()), csrfToken: name, ip: "192.0.2.1", userAgent: FIREFOX, createdAt: ago(60), lastSeenAt: ago(1), expiresAt: ago(-1), ...v });
    await db().insert(sessions).values([
      session("expiree-31j", { expiresAt: ago(31) }),
      session("expiree-29j", { expiresAt: ago(29) }),
      session("fermee-31j", { revokedAt: ago(31) }),
      session("fermee-hier", { revokedAt: ago(1) }),
      // Sans activité depuis 38 jours : finie il y a 31 jours (7 jours sans activité)
      session("abandonnee-38j", { lastSeenAt: ago(38) }),
      session("abandonnee-36j", { lastSeenAt: ago(36) }),
    ]);
    const device = (name: string, revokedAt: Date | null) => ({ userId: user.id, name, tokenHash: sha256(randomToken()), lastIp: "192.0.2.2", revokedAt });
    await db().insert(devices).values([device("PC-delie-31j", ago(31)), device("PC-delie-29j", ago(29)), device("PC-actif", null)]);
    const token = (name: string, v: Partial<typeof emailTokens.$inferInsert>) =>
      ({ userId: user.id, purpose: "reset" as const, tokenHash: `test:${name}`, expiresAt: ago(-1), ...v });
    await db().insert(emailTokens).values([
      token("utilise-31j", { usedAt: ago(31), expiresAt: ago(30) }),
      token("expire-31j", { expiresAt: ago(31) }),
      token("utilise-hier", { usedAt: ago(1), expiresAt: ago(1) }),
      token("en-attente", {}),
    ]);
    await db().insert(bnetImports).values([
      { userId: user.id, characters: [], expiresAt: new Date(Date.now() - 60e3) },
      { userId: other.user.id, characters: [], expiresAt: new Date(Date.now() + 20 * 60e3) },
    ]);

    expect(await purgeOldData(db())).toMatchObject({ sessions: 3, devices: 1, emailTokens: 2, bnetImports: 1 });
    const left = await db().select({ name: sessions.csrfToken, ip: sessions.ip }).from(sessions).where(eq(sessions.userId, user.id));
    expect(left.filter(s => s.ip === "192.0.2.1").map(s => s.name).sort()).toEqual(["abandonnee-36j", "expiree-29j", "fermee-hier"]);
    expect(left).toHaveLength(4); // et la session ouverte par la connexion
    expect((await db().select({ name: devices.name }).from(devices).where(eq(devices.userId, user.id))).map(d => d.name).sort()).toEqual(["PC-actif", "PC-delie-29j"]);
    const tokens = await db().select({ hash: emailTokens.tokenHash }).from(emailTokens).where(and(eq(emailTokens.userId, user.id), eq(emailTokens.purpose, "reset")));
    expect(tokens.map(t => t.hash).sort()).toEqual(["test:en-attente", "test:utilise-hier"]);
    expect((await db().select({ userId: bnetImports.userId }).from(bnetImports)).map(b => b.userId)).toEqual([other.user.id]);
  });
});

describe("suppression du compte", () => {
  it("le journal garde ses lignes sans IP ni navigateur ; les signalements restent, anonymisés", async () => {
    const p = await signedIn(env, "Partante");
    const stay = await signedIn(env, "Restante");
    await db().insert(siteSettings).values({ key: "reports_channel", value: { guildId: "810000000000000001", channelId: "810000000000000002" } });
    const send = async (who: typeof p, title: string) =>
      (await who.c.req("POST", "/api/reports", { kind: "bug", area: "site", title, body: "Un texte assez long" }, { "user-agent": FIREFOX })).json().report.id as string;
    const recent = await send(p, "Récent, suivi par le bot");
    const old = await send(p, "Ancien, plus suivi");
    const theirs = await send(stay, "Celui d'une autre");
    // Tous déjà publiés dans le salon des admins ; le récent a un jour, l'ancien 40 jours
    for (const [id, msg] of [[recent, "810000000000000010"], [old, "810000000000000011"], [theirs, "810000000000000012"]] as const) {
      await db().update(reports).set({ discordChannelId: "810000000000000002", discordMessageId: msg, discordSyncedAt: new Date() }).where(eq(reports.id, id));
    }
    await db().update(reports).set({ createdAt: ago(1) }).where(inArray(reports.id, [recent, theirs]));
    await db().update(reports).set({ createdAt: ago(40) }).where(eq(reports.id, old));
    const events = await auditOf(p.user.id);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every(e => e.ip && e.userAgent)).toBe(true);

    expect((await p.c.del("/api/account", { password: "mauvais mot de passe" })).statusCode).toBe(403);
    expect((await auditOf(p.user.id)).every(e => e.ip)).toBe(true);
    expect((await p.c.del("/api/account", { password: p.password })).statusCode).toBe(200);
    expect(await db().select().from(users).where(eq(users.id, p.user.id))).toEqual([]);
    expect((await p.c.get("/api/auth/me")).json().user).toBeNull();

    // Journal : mêmes lignes, détachées du compte, sans IP ni navigateur
    const kept = await db().select().from(auditEvents).where(inArray(auditEvents.id, events.map(e => e.id)));
    expect(kept).toHaveLength(events.length);
    expect(kept.every(e => e.userId === null && e.ip === null && e.userAgent === null)).toBe(true);
    expect((await auditOf(stay.user.id)).every(e => e.ip && e.userAgent)).toBe(true);

    // Signalements : restent, sans pseudo ni navigateur ; celui de l'autre joueuse ne change pas
    const rows = await db().select().from(reports).where(inArray(reports.id, [recent, old, theirs]));
    const byId = new Map(rows.map(r => [r.id, r]));
    for (const id of [recent, old]) expect(byId.get(id)).toMatchObject({ userId: null, author: "", userAgent: "", title: expect.any(String), body: "Un texte assez long" });
    expect(byId.get(theirs)).toMatchObject({ userId: stay.user.id, author: "Restante", userAgent: FIREFOX });
    await db().update(users).set({ siteAdmin: true }).where(eq(users.id, stay.user.id));
    const admin = (await stay.c.get("/api/reports/admin?status=all")).json().reports as { id: string; author: string; browser: string }[];
    expect(admin.find(r => r.id === recent)).toMatchObject({ author: "Compte supprimé", browser: "" });
    expect(admin.find(r => r.id === theirs)).toMatchObject({ author: "Restante", browser: "Firefox 131 · Windows" });

    // Discord : le bot corrige le message récent sur place ; l'ancien, qu'il ne suit plus, est retiré du salon
    const out = (await bot("/internal/discord/reports/outbox")).json().reports as { id: string; author: string; browser: string; messageId: string | null }[];
    expect(out.map(r => r.id)).toEqual([recent]);
    expect(out[0]).toMatchObject({ author: "Compte supprimé", browser: "", messageId: "810000000000000010" });
    expect(byId.get(old)).toMatchObject({ discordChannelId: null, discordMessageId: null });
    const dels = await db().select().from(discordDeletions);
    expect(dels.filter(d => d.channelId === "810000000000000002").map(d => d.messageId)).toEqual(["810000000000000011"]);
  });
});
