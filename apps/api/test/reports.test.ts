import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reports, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { browserOf } from "../src/lib/reports";
import { Client, setup, signedIn, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
const upload = (c: Client, url: string, body: Buffer) => c.req("PUT", url, body, { "content-type": "image/png" });
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
let snow = 920000000000000000n;
const linkDiscord = async (userId: string) => { const id = String(++snow); await env.app.ctx.db.update(users).set({ discordId: id }).where(eq(users.id, userId)); return id; };
const makeAdmin = (userId: string) => env.app.ctx.db.update(users).set({ siteAdmin: true }).where(eq(users.id, userId));
const frc = (version: string) => `FRC;2;Signaleur;Forever EU;DRUID;Tauren;60;Horde;1790000000;${version}\nEND;0`;

describe("signalements : joueur", () => {
  it("envoie un bug avec la page, le navigateur et sa version de l'addon ; capture jointe une fois", async () => {
    const { c } = await signedIn(env, "Signaleur");
    expect((await c.post("/api/addon/import", { text: frc("1.5.4") })).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user).toMatchObject({ addonVersion: "1.5.4", siteAdmin: false });

    expect((await c.post("/api/reports", { kind: "bug", area: "addon", title: "x", body: "trop court" })).statusCode).toBe(400);
    expect((await c.post("/api/reports", { kind: "rant", area: "site", title: "Titre correct", body: "Un texte assez long" })).statusCode).toBe(400);
    const r = await c.req("POST", "/api/reports", { kind: "bug", area: "addon", title: "La fenêtre du conseil se ferme", body: "Quand je clique sur Passer.", page: "/groups/g/raids/r" }, { "user-agent": FIREFOX });
    expect(r.statusCode).toBe(201);
    const rep = r.json().report;
    expect(rep).toMatchObject({ author: "Signaleur", game: "forever", status: "new", page: "/groups/g/raids/r", browser: "Firefox 131 · Windows", addonVersion: "1.5.4", hasImage: false, unseen: false });
    expect(rep.userAgent).toBeUndefined();

    // Capture : ré-encodée en WebP, 1600 px au plus, une seule fois ; seul l'auteur (ou un admin) la voit
    expect((await upload(c, `/api/reports/${rep.id}/image`, await png(2400, 1200))).statusCode).toBe(200);
    expect((await upload(c, `/api/reports/${rep.id}/image`, await png(100, 100))).statusCode).toBe(400);
    const img = await c.get(`/api/reports/${rep.id}/image`);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(await sharp(img.rawPayload).metadata()).toMatchObject({ format: "webp", width: 1600, height: 800 });
    const other = await signedIn(env, "Curieux");
    expect((await other.c.get(`/api/reports/${rep.id}/image`)).statusCode).toBe(404);
    expect((await upload(other.c, `/api/reports/${rep.id}/image`, await png(10, 10))).statusCode).toBe(404);
    expect((await other.c.get("/api/reports/mine")).json().reports).toEqual([]);

    const mine = (await c.get("/api/reports/mine")).json().reports;
    expect(mine).toEqual([expect.objectContaining({ id: rep.id, hasImage: true })]);
    expect((await c.get("/api/reports/unseen")).json()).toEqual({ n: 0 });
    // Pas de capture après 15 minutes
    const late = (await c.post("/api/reports", { kind: "idea", area: "site", title: "Une idée", body: "Trier par niveau d'objet" })).json().report;
    await env.app.ctx.db.update(reports).set({ createdAt: new Date(Date.now() - 16 * 60e3) }).where(eq(reports.id, late.id));
    expect((await upload(c, `/api/reports/${late.id}/image`, await png(10, 10))).statusCode).toBe(400);
  });

  it("réservé aux comptes connectés", async () => {
    const anon = new Client(env);
    expect((await anon.post("/api/reports", { kind: "bug", area: "site", title: "Anonyme", body: "Pas connecté" })).statusCode).toBe(401);
  });

  it("navigateur lisible", () => {
    expect(browserOf(FIREFOX)).toBe("Firefox 131 · Windows");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0")).toBe("Edge 129 · Windows");
    expect(browserOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari 18 · iOS");
    expect(browserOf("")).toBe("");
  });
});

describe("signalements : admins du site et salon Discord", () => {
  it("statut, réponse vue par le joueur (pastille), suppression ; droits", async () => {
    const p = await signedIn(env, "Joueuse");
    const a = await signedIn(env, "AdminSite");
    const rep = (await p.c.post("/api/reports", { kind: "question", area: "bot", title: "Lier un salon", body: "Comment lier un salon ?" })).json().report;

    expect((await a.c.get("/api/reports/admin")).statusCode).toBe(403);
    expect((await a.c.patch(`/api/reports/admin/${rep.id}`, { status: "done" })).statusCode).toBe(403);
    await makeAdmin(a.user.id);
    expect((await a.c.get("/api/auth/me")).json().user.siteAdmin).toBe(true);
    const list = (await a.c.get("/api/reports/admin")).json();
    expect(list.channel).toBe(false);
    expect(list.reports.map((r: { id: string }) => r.id)).toContain(rep.id);
    expect(list.counts.new).toBeGreaterThanOrEqual(1);

    const done = (await a.c.patch(`/api/reports/admin/${rep.id}`, { status: "wip", reply: "Tape /forever-lier avec le code du groupe." })).json().report;
    expect(done).toMatchObject({ status: "wip", repliedBy: "AdminSite", unseen: true });
    expect((await p.c.get("/api/reports/unseen")).json()).toEqual({ n: 1 });
    expect((await p.c.get("/api/reports/mine")).json().reports[0]).toMatchObject({ reply: "Tape /forever-lier avec le code du groupe.", unseen: true });
    await p.c.post("/api/reports/mine/seen");
    expect((await p.c.get("/api/reports/unseen")).json()).toEqual({ n: 0 });
    expect((await a.c.get("/api/reports/admin?status=wip")).json().reports.map((r: { id: string }) => r.id)).toContain(rep.id);
    expect((await a.c.get("/api/reports/admin?status=done")).json().reports.map((r: { id: string }) => r.id)).not.toContain(rep.id);
    expect((await a.c.patch(`/api/reports/admin/${rep.id}`, {})).statusCode).toBe(400);

    // Le salon : un admin du site au compte Discord lié, dans le salon de son choix
    const pDiscord = await linkDiscord(p.user.id);
    expect((await bot("POST", "/internal/discord/reports/bind", { guildId: "800000000000000001", channelId: "800000000000000002", discordUserId: pDiscord })).statusCode).toBe(403);
    expect((await bot("POST", "/internal/discord/reports/bind", { guildId: "800000000000000001", channelId: "800000000000000002", discordUserId: "800000000000000099" })).statusCode).toBe(403);
    const aDiscord = await linkDiscord(a.user.id);
    expect((await bot("POST", "/internal/discord/reports/bind", { guildId: "800000000000000001", channelId: "800000000000000002", discordUserId: aDiscord })).statusCode).toBe(200);
    expect((await a.c.get("/api/reports/admin")).json().channel).toBe(true);

    // Relève : un signalement tout juste envoyé attend sa capture 30 s
    await env.app.ctx.db.update(reports).set({ createdAt: new Date(Date.now() - 60e3) }).where(eq(reports.id, rep.id));
    const fresh = (await p.c.post("/api/reports", { kind: "idea", area: "site", title: "Toute fraîche", body: "Envoyée à l'instant" })).json().report;
    let out = (await bot("GET", "/internal/discord/reports/outbox")).json().reports as { id: string; messageId: string | null; changedAt: string; url: string; site: string; status: string; reply: string }[];
    expect(out.map(r => r.id)).toContain(rep.id);
    expect(out.map(r => r.id)).not.toContain(fresh.id);
    const view = out.find(r => r.id === rep.id)!;
    expect(view).toMatchObject({ messageId: null, site: "Forever Roster", status: "wip", reply: "Tape /forever-lier avec le code du groupe." });
    expect(view.url).toMatch(new RegExp(`/admin/signalements\\?id=${rep.id}$`));
    expect((await bot("POST", `/internal/discord/reports/${rep.id}/published`, { channelId: "800000000000000002", messageId: "800000000000000010", changedAt: view.changedAt })).statusCode).toBe(200);
    out = (await bot("GET", "/internal/discord/reports/outbox")).json().reports;
    expect(out.map(r => r.id)).not.toContain(rep.id);

    // Changement de statut : le message est modifié (même identifiant)
    await a.c.patch(`/api/reports/admin/${rep.id}`, { status: "done" });
    out = (await bot("GET", "/internal/discord/reports/outbox")).json().reports;
    expect(out.find(r => r.id === rep.id)).toMatchObject({ messageId: "800000000000000010", status: "done" });

    // Autre salon : l'ancien message est supprimé, le signalement republié
    await bot("POST", "/internal/discord/reports/bind", { guildId: "800000000000000001", channelId: "800000000000000003", discordUserId: aDiscord });
    const dels = (await bot("GET", "/internal/discord/outbox")).json().deletions;
    expect(dels).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: "800000000000000002", messageId: "800000000000000010" })]));
    out = (await bot("GET", "/internal/discord/reports/outbox")).json().reports;
    expect(out.find(r => r.id === rep.id)).toMatchObject({ messageId: null });
    await bot("POST", `/internal/discord/reports/${rep.id}/published`, { channelId: "800000000000000003", messageId: "800000000000000011", changedAt: out.find(r => r.id === rep.id)!.changedAt });

    // Suppression : le message Discord part aussi ; le joueur ne le voit plus
    expect((await p.c.del(`/api/reports/admin/${rep.id}`)).statusCode).toBe(403);
    expect((await a.c.del(`/api/reports/admin/${rep.id}`)).statusCode).toBe(200);
    expect((await bot("GET", "/internal/discord/outbox")).json().deletions).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: "800000000000000011" })]));
    expect((await p.c.get("/api/reports/mine")).json().reports.map((r: { id: string }) => r.id)).not.toContain(rep.id);
  });

  it("capture lue par le bot pour le salon", async () => {
    const p = await signedIn(env, "AvecCapture");
    const rep = (await p.c.post("/api/reports", { kind: "bug", area: "site", title: "Avec capture", body: "Voir la capture" })).json().report;
    expect((await bot("GET", `/internal/discord/reports/${rep.id}/image`)).statusCode).toBe(404);
    await upload(p.c, `/api/reports/${rep.id}/image`, await png(50, 40));
    const img = await bot("GET", `/internal/discord/reports/${rep.id}/image`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect((await bot("GET", "/internal/discord/reports/outbox")).json().reports.map((r: { id: string }) => r.id)).toContain(rep.id);
    expect((await internal.inject({ method: "GET", url: `/internal/discord/reports/${rep.id}/image` })).statusCode).toBe(401);
  });
});
