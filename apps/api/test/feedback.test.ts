import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedbacks, groups } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object, secret = SECRET) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${secret}` }, ...(payload ? { payload } : {}) });

const GUILD = "900000000000000001";

describe("avis (feedback) du bot", () => {
  it("réglages par serveur, sans groupe ni compte sur le site", async () => {
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`, undefined, "mauvais")).statusCode).toBe(401);
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`)).json().config).toBeNull();

    const first = await bot("PUT", `/internal/feedback/config/${GUILD}`, {
      inboxChannelId: "900000000000000010", panelChannelId: "900000000000000011", panelMessageId: "900000000000000012", allowAnonymous: true, updatedBy: "900000000000000099",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().previous).toBeNull();
    expect(first.json().config).toMatchObject({ inboxChannelId: "900000000000000010", allowAnonymous: true });

    // Nouveaux réglages : les anciens sont renvoyés (le bot retire l'ancien bouton)
    const second = await bot("PUT", `/internal/feedback/config/${GUILD}`, {
      inboxChannelId: "900000000000000010", panelChannelId: null, panelMessageId: null, allowAnonymous: false, updatedBy: "900000000000000099",
    });
    expect(second.json().previous.panelMessageId).toBe("900000000000000012");
    expect(second.json().config).toMatchObject({ panelChannelId: null, allowAnonymous: false });

    expect((await bot("PUT", `/internal/feedback/config/${GUILD}`, { inboxChannelId: "pas-un-id", panelChannelId: null, panelMessageId: null, allowAnonymous: true, updatedBy: "1" })).statusCode).toBe(400);

    const removed = await bot("DELETE", `/internal/feedback/config/${GUILD}`);
    expect(removed.json().previous.inboxChannelId).toBe("900000000000000010");
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`)).json().config).toBeNull();
  });

  it("garde l'auteur 30 jours pour la réponse, puis l'oublie", async () => {
    const id = randomUUID();
    const post = await bot("POST", "/internal/feedback", {
      id, guildId: GUILD, channelId: "900000000000000010", messageId: "900000000000000020", anonymous: true, authorId: "900000000000000030",
    });
    expect(post.statusCode).toBe(200);
    const got = await bot("GET", `/internal/feedback/${id}`);
    expect(got.json().feedback).toMatchObject({ authorId: "900000000000000030", anonymous: true, messageId: "900000000000000020" });

    // 31 jours plus tard : l'avis et son auteur sont effacés
    await env.app.ctx.db.execute(sql`update feedbacks set created_at = now() - interval '31 days' where id = ${id}`);
    const old = await bot("GET", `/internal/feedback/${id}`);
    expect(old.statusCode).toBe(404);
    expect(old.json().error).toMatch(/30 jours/);
    expect(await env.app.ctx.db.select().from(feedbacks).where(eq(feedbacks.id, id))).toEqual([]);
  });
});

describe("avis suivis par un groupe (Administration → Avis)", () => {
  const db = () => env.app.ctx.db;
  const G2 = "900000000000000002";
  const INBOX = "900000000000000040";
  const ADMIN_DISCORD = "900000000000000041";
  let chef: Awaited<ReturnType<typeof signedIn>>, officier: Awaited<ReturnType<typeof signedIn>>, membre: Awaited<ReturnType<typeof signedIn>>;
  let gid = "", autre = "";

  beforeAll(async () => {
    chef = await signedIn(env, "AvisChef"); officier = await signedIn(env, "AvisOff"); membre = await signedIn(env, "AvisMembre");
    gid = (await chef.c.post("/api/groups", { name: "Les Veilleurs" })).json().group.id;
    autre = (await chef.c.post("/api/groups", { name: "Autre serveur" })).json().group.id;
    for (const p of [officier, membre]) {
      const inv = (await chef.c.post(`/api/groups/${gid}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
      await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    }
    await chef.c.patch(`/api/groups/${gid}/members/${officier.user.id}`, { role: "officer" });
    // Groupe lié à ce serveur par son salon des raids ; l'autre groupe est lié à un autre serveur
    await db().update(groups).set({ discordGuildId: G2, discordChannelId: "900000000000000050" }).where(eq(groups.id, gid));
    await db().update(groups).set({ discordGuildId: "900000000000000003", discordChannelId: "900000000000000051" }).where(eq(groups.id, autre));
  });

  const config = (b: object) => bot("PUT", `/internal/feedback/config/${G2}`, {
    inboxChannelId: INBOX, panelChannelId: null, panelMessageId: null, allowAnonymous: true, updatedBy: ADMIN_DISCORD, updatedByName: "Sley", guildName: "Amis Forever", ...b,
  });
  const record = (id: string, b: object = {}) => bot("POST", "/internal/feedback", {
    id, guildId: G2, channelId: INBOX, messageId: `9000000000000${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`, anonymous: true,
    authorId: "900000000000000060", text: "Les raids finissent trop tard le mercredi.", authorName: null, ...b,
  });

  it("le réglage ne propose et n'accepte que les groupes liés à ce serveur", async () => {
    const list = (await bot("GET", `/internal/feedback/groups/${G2}?q=veil`)).json().groups;
    expect(list).toEqual([expect.objectContaining({ id: gid, name: "Les Veilleurs", site: "Forever Roster", raidsChannelId: "900000000000000050" })]);
    expect((await bot("GET", `/internal/feedback/groups/${G2}?q=autre`)).json().groups).toEqual([]);
    expect((await bot("GET", `/internal/feedback/groups/${G2}?game=retail`)).json().groups).toEqual([]);
    // Caractères spéciaux du LIKE : pris tels quels
    expect((await bot("GET", `/internal/feedback/groups/${G2}?q=%25`)).json().groups).toEqual([]);

    const refused = await config({ groupId: autre });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/pas lié à ce serveur/);

    const ok = await config({ groupId: gid });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().config.track).toMatchObject({ groupId: gid, groupName: "Les Veilleurs", site: "Forever Roster", url: `http://app.test/groups/${gid}/admin` });
    // Relancé sans l'option groupe : le suivi est gardé
    expect((await config({})).json().config.track.groupId).toBe(gid);
    // Journal du groupe : par un admin du serveur sans compte sur le site
    const events = (await chef.c.get(`/api/groups/${gid}/audit`)).json().events;
    expect(events[0]).toMatchObject({ type: "group_feedback_linked", meta: { name: "Amis Forever", by: "Sley" } });
  });

  it("avis suivi : visible du chef et des officiers seulement, anonyme sur le site aussi", async () => {
    const id = randomUUID();
    const r = await record(id);
    expect(r.json()).toEqual({ ok: true, tracked: true });
    // Pastille sur le détail du groupe
    expect((await officier.c.get(`/api/groups/${gid}`)).json().feedback).toEqual({ linked: true, unseen: 1 });
    expect((await membre.c.get(`/api/groups/${gid}`)).json().feedback).toBeNull();
    expect((await membre.c.get(`/api/groups/${gid}/feedback`)).statusCode).toBe(403);
    const outsider = await signedIn(env, "AvisDehors");
    expect((await outsider.c.get(`/api/groups/${gid}/feedback`)).statusCode).toBe(404);

    const res = await officier.c.get(`/api/groups/${gid}/feedback`);
    const body = res.json();
    expect(body.sources).toEqual([{ guildName: "Amis Forever", allowAnonymous: true }]);
    const f = body.feedbacks.find((x: { id: string }) => x.id === id);
    expect(f).toMatchObject({ anonymous: true, author: null, text: "Les raids finissent trop tard le mercredi.", status: "new", reachable: true, unseen: true });
    // L'identifiant Discord de l'auteur ne sort jamais de l'API interne
    expect(res.body).not.toContain("900000000000000060");

    await officier.c.post(`/api/groups/${gid}/feedback/seen`);
    expect((await officier.c.get(`/api/groups/${gid}`)).json().feedback.unseen).toBe(0);
    // Chaque officier a ses propres pastilles
    expect((await chef.c.get(`/api/groups/${gid}`)).json().feedback.unseen).toBeGreaterThanOrEqual(1);
  });

  it("conversation : réponses Discord et site, envoi par le bot, statut reporté sur Discord", async () => {
    const id = randomUUID();
    await record(id, { anonymous: false, authorName: "Mirelle", text: "Merci pour le SR+ !" });
    // Réponse de l'équipe dans Discord : notée, et l'avis passe « En cours »
    await bot("POST", `/internal/feedback/${id}/messages`, { from: "team", name: "Sley", text: "Avec plaisir !", delivered: true });
    // L'auteur répond par MP
    await bot("POST", `/internal/feedback/${id}/messages`, { from: "author", name: "Mirelle", text: "Et sur Onyxia ?" });
    let f = (await chef.c.get(`/api/groups/${gid}/feedback`)).json().feedbacks.find((x: { id: string }) => x.id === id);
    expect(f.status).toBe("wip");
    expect(f.author).toBe("Mirelle");
    expect(f.messages.map((m: { from: string; source: string }) => `${m.from}:${m.source}`)).toEqual(["team:discord", "author:discord"]);

    // Réponse écrite sur le site : en attente, puis envoyée par le bot (relève)
    expect((await chef.c.post(`/api/groups/${gid}/feedback/${id}/reply`, { text: "Oui, dès la semaine prochaine." })).statusCode).toBe(201);
    const out = (await bot("GET", "/internal/feedback/outbox")).json();
    const rep = out.replies.find((x: { feedbackId: string }) => x.feedbackId === id);
    expect(rep).toMatchObject({ authorId: "900000000000000060", responder: "AvisChef", text: "Oui, dès la semaine prochaine.", guildName: "Amis Forever", original: "Merci pour le SR+ !" });
    // Statut « En cours » à reporter sur le message de l'avis
    expect(out.statuses.find((x: { id: string }) => x.id === id)).toMatchObject({ status: "wip", track: { groupName: "Les Veilleurs", url: `http://app.test/groups/${gid}/admin?avis=${id}` } });
    await bot("POST", `/internal/feedback/replies/${rep.id}`, { delivered: true });
    const st = out.statuses.find((x: { id: string }) => x.id === id);
    await bot("POST", `/internal/feedback/${id}/synced`, { changedAt: st.changedAt });
    const after = (await bot("GET", "/internal/feedback/outbox")).json();
    expect(after.replies.some((x: { feedbackId: string }) => x.feedbackId === id)).toBe(false);
    expect(after.statuses.some((x: { id: string }) => x.id === id)).toBe(false);
    f = (await chef.c.get(`/api/groups/${gid}/feedback`)).json().feedbacks.find((x: { id: string }) => x.id === id);
    expect(f.messages.at(-1)).toMatchObject({ from: "team", source: "site", name: "AvisChef", delivered: true });

    // Statut changé sur le site : de nouveau à reporter
    expect((await officier.c.patch(`/api/groups/${gid}/feedback/${id}`, { status: "done" })).statusCode).toBe(200);
    expect((await bot("GET", "/internal/feedback/outbox")).json().statuses.find((x: { id: string }) => x.id === id).status).toBe("done");
    expect((await chef.c.get(`/api/groups/${gid}/feedback?status=done`)).json().feedbacks.map((x: { id: string }) => x.id)).toContain(id);
    expect((await membre.c.patch(`/api/groups/${gid}/feedback/${id}`, { status: "new" })).statusCode).toBe(403);
  });

  it("conservation : l'auteur est oublié 30 jours après la clôture, l'avis reste ; suppression aussi dans Discord", async () => {
    const id = randomUUID();
    await record(id);
    await officier.c.patch(`/api/groups/${gid}/feedback/${id}`, { status: "refused" });
    await db().execute(sql`update feedbacks set closed_at = now() - interval '31 days', created_at = now() - interval '40 days' where id = ${id}`);
    const f = (await chef.c.get(`/api/groups/${gid}/feedback?status=all`)).json().feedbacks.find((x: { id: string }) => x.id === id);
    expect(f).toMatchObject({ reachable: false, status: "refused" });
    expect((await chef.c.post(`/api/groups/${gid}/feedback/${id}/reply`, { text: "Trop tard ?" })).json().error).toMatch(/plus joignable/);
    expect((await bot("GET", `/internal/feedback/${id}`)).json().error).toMatch(/plus joignable/);

    const [row] = await db().select().from(feedbacks).where(eq(feedbacks.id, id));
    expect((await chef.c.del(`/api/groups/${gid}/feedback/${id}`)).statusCode).toBe(200);
    expect(await db().select().from(feedbacks).where(eq(feedbacks.id, id))).toEqual([]);
    const outbox = (await bot("GET", "/internal/discord/outbox")).json();
    expect(outbox.deletions).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: INBOX, messageId: row!.messageId })]));
  });

  it("« Ne plus recevoir » : les avis suivants restent dans Discord seulement", async () => {
    expect((await membre.c.del(`/api/groups/${gid}/feedback-link`)).statusCode).toBe(403);
    expect((await officier.c.del(`/api/groups/${gid}/feedback-link`)).json()).toMatchObject({ ok: true, removed: 1 });
    expect((await bot("GET", `/internal/feedback/config/${G2}`)).json().config).toMatchObject({ groupId: null, track: null });
    const id = randomUUID();
    expect((await record(id)).json().tracked).toBe(false);
    const [row] = await db().select().from(feedbacks).where(eq(feedbacks.id, id));
    expect(row).toMatchObject({ groupId: null, text: null });
    expect((await chef.c.get(`/api/groups/${gid}`)).json().feedback.linked).toBe(false);
  });
});
