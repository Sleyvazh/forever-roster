import { channelNameFor } from "@forever/game-data";
import { asc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raids, raidTemplates, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Salon Discord à part pour un raid récurrent, renommé avec la date du raid courant (ex. jeudi-15-10). */

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
const inHours = (h: number) => new Date(Date.now() + h * 3600e3);
let snow = 720000000000000000n;
const nextId = () => String(++snow);
type View = { raid: { id: string; changedAt: string }; channelId: string; messageId: string | null };
type Tpl = { id: string; name: string; discord: { linked: boolean; channelName: string | null; rename: boolean; renameError: string | null } };

/** Groupe avec un officier et un membre (Discord liés), son salon des raids, et un raid récurrent (2 raids créés, ses 2 prochains). */
async function scene(name: string, opts: { groupChannel?: boolean } = {}) {
  const slug = name.normalize("NFD").replace(/[^A-Za-z]/g, "");
  const gm = await signedIn(env, `${slug}Chef`), p1 = await signedIn(env, `${slug}Ana`);
  const g = (await gm.c.post("/api/groups", { name })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
  const ids = { guild: nextId(), group: nextId(), gm: nextId(), p1: nextId() };
  await env.app.ctx.db.update(users).set({ discordId: ids.gm }).where(eq(users.id, gm.user.id));
  await env.app.ctx.db.update(users).set({ discordId: ids.p1 }).where(eq(users.id, p1.user.id));
  if (opts.groupChannel !== false) {
    const { code } = (await gm.c.post(`/api/groups/${g.id}/discord/code`)).json();
    expect((await bot("POST", "/internal/discord/bind", { code, guildId: ids.guild, channelId: ids.group, discordUserId: ids.gm })).json().kind).toBe("raids");
  }
  const t = (await gm.c.post(`/api/groups/${g.id}/raid-templates`, { name: "Molten Core", weekday: 4, time: "21:00", leadDays: 21 })).json().template as Tpl;
  const tplRaids = async () => env.app.ctx.db.select({ id: raids.id, scheduledAt: raids.scheduledAt, channelId: raids.discordChannelId, messageId: raids.discordMessageId })
    .from(raids).where(eq(raids.templateId, t.id)).orderBy(asc(raids.scheduledAt));
  // Exactement 2 raids quelle que soit l'heure : 21 jours, puis seulement les 2 premiers
  // (avec 14 jours, le jeudi peu après 21 h, un changement d'heure dans les 2 semaines n'en laissait qu'un)
  const extra = (await tplRaids()).slice(2);
  if (extra.length) await env.app.ctx.db.delete(raids).where(inArray(raids.id, extra.map(r => r.id)));
  const templates = async () => (await gm.c.get(`/api/groups/${g.id}/raid-templates`)).json().templates as Tpl[];
  /** Lie le salon `channelId` au raid récurrent (code généré par l'officier). */
  const bindTemplate = async (channelId: string, extra: object = {}, by = ids.gm) => {
    const { code } = (await gm.c.post(`/api/groups/${g.id}/raid-templates/${t.id}/discord/code`)).json();
    return bot("POST", "/internal/discord/bind", { code, guildId: ids.guild, channelId, discordUserId: by, ...extra });
  };
  return { gm, p1, g, t, ids, tplRaids, templates, bindTemplate };
}

const outbox = async () => (await bot("GET", "/internal/discord/outbox")).json() as { raids: View[]; deletions: { id: number; channelId: string; messageId: string }[] };
/** Vide la file des suppressions (comme le bot) et renvoie « salon/message » de chacune. */
const drain = async () => {
  const { deletions } = await outbox();
  for (const d of deletions) await bot("DELETE", `/internal/discord/deletions/${d.id}`);
  return deletions.map(d => `${d.channelId}/${d.messageId}`);
};
const inOutbox = async (raidId: string) => (await outbox()).raids.find(r => r.raid.id === raidId);
/** Le bot publie l'annonce du raid (dans le salon que lui donne l'outbox). */
const publish = async (raidId: string, messageId: string) => {
  const item = await inOutbox(raidId);
  expect(item).toBeDefined();
  await bot("POST", `/internal/discord/raids/${raidId}/published`, { channelId: item!.channelId, messageId, changedAt: item!.raid.changedAt });
  return item!;
};

describe("salon à part pour un raid récurrent", () => {
  it("code, liaison, refus des salons déjà pris, salon effectif des annonces", async () => {
    const s = await scene("Veilleurs");
    const tpl = nextId();
    // État initial : le salon du groupe, rien d'exposé
    const [first] = await s.templates();
    expect(first!.discord).toEqual({ linked: false, channelName: null, rename: true, renameError: null });

    // Code : officiers seulement, raid récurrent du groupe seulement
    expect((await s.p1.c.post(`/api/groups/${s.g.id}/raid-templates/${s.t.id}/discord/code`)).statusCode).toBe(403);
    const other = await signedIn(env, "VeilleursIntrus");
    const og = (await other.c.post("/api/groups", { name: "Intrus" })).json().group;
    expect((await other.c.post(`/api/groups/${og.id}/raid-templates/${s.t.id}/discord/code`)).statusCode).toBe(404);

    // Le salon du groupe est refusé ; un simple membre ne peut pas lier
    const { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/raid-templates/${s.t.id}/discord/code`)).json();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    const refused = await bot("POST", "/internal/discord/bind", { code, guildId: s.ids.guild, channelId: s.ids.group, discordUserId: s.ids.gm });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe("Ce salon est déjà celui de la guilde : choisis un autre salon pour ce raid récurrent.");
    expect((await bot("POST", "/internal/discord/bind", { code, guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.p1 })).statusCode).toBe(403);

    // Annonce déjà publiée dans le salon du groupe : effacée à la liaison, republiée dans le salon du raid récurrent
    const [r1, r2] = await s.tplRaids();
    await drain();
    await publish(r1!.id, "720000000000009001");
    const bound = await bot("POST", "/internal/discord/bind", { code: code.toLowerCase(), guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm, channelName: "molten-core" });
    expect(bound.statusCode).toBe(200);
    expect(bound.json()).toEqual({
      group: { id: s.g.id, name: "Veilleurs" }, kind: "template",
      template: { id: s.t.id, name: "Molten Core", rename: true, next: channelNameFor(r1!.scheduledAt!) },
    });
    // Code à usage unique
    expect((await bot("POST", "/internal/discord/bind", { code, guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm })).statusCode).toBe(400);
    expect(await drain()).toEqual([`${s.ids.group}/720000000000009001`]);
    expect(await inOutbox(r1!.id)).toMatchObject({ channelId: tpl, messageId: null });
    expect(await inOutbox(r2!.id)).toMatchObject({ channelId: tpl, messageId: null });

    // Le site : le nom du salon, jamais ses identifiants
    const res = await s.gm.c.get(`/api/groups/${s.g.id}/raid-templates`);
    expect(res.json().templates[0].discord).toEqual({ linked: true, channelName: "molten-core", rename: true, renameError: null });
    expect(res.body).not.toContain(tpl);
    expect(res.body).not.toContain(s.ids.guild);
    const journal = await s.gm.c.get(`/api/groups/${s.g.id}/audit`);
    expect(journal.json().events.map((e: { type: string }) => e.type)).toContain("template_discord_linked");
    expect(journal.body).not.toContain(tpl);

    // Ce salon ne peut plus servir au groupe, ni à ses commandes, ni à un autre raid récurrent
    const gcode = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json().code;
    expect((await bot("POST", "/internal/discord/bind", { code: gcode, guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm })).json().error)
      .toBe("Ce salon est déjà celui du raid récurrent « Molten Core » : choisis un autre salon pour la guilde.");
    const ocode = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/orders-code`)).json().code;
    expect((await bot("POST", "/internal/discord/bind", { code: ocode, guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm })).statusCode).toBe(400);
    const t2 = (await s.gm.c.post(`/api/groups/${s.g.id}/raid-templates`, { name: "Onyxia", weekday: 7, time: "20:30", leadDays: 7 })).json().template;
    const c2 = (await s.gm.c.post(`/api/groups/${s.g.id}/raid-templates/${t2.id}/discord/code`)).json().code;
    expect((await bot("POST", "/internal/discord/bind", { code: c2, guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm })).json().error)
      .toBe("Ce salon est déjà celui du raid récurrent « Molten Core » : choisis un autre salon pour ce raid récurrent.");
    // Relier le même salon au même raid récurrent reste possible
    expect((await s.bindTemplate(tpl)).statusCode).toBe(200);

    // /raid tapé dans le salon du raid récurrent : raid ponctuel du groupe, annoncé dans le salon du groupe
    const created = (await bot("POST", "/internal/discord/raids", { guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm, name: "Zul'Gurub", scheduledAt: inHours(48).toISOString() })).json();
    expect(created).toMatchObject({ channelId: s.ids.group, group: { id: s.g.id } });
    const [zg] = await env.app.ctx.db.select({ templateId: raids.templateId }).from(raids).where(eq(raids.id, created.raid.id));
    expect(zg!.templateId).toBeNull();
    // Le bouton d'une annonce passe par la vue : même salon effectif
    expect((await bot("GET", `/internal/discord/raids/${r1!.id}/view`)).json()).toMatchObject({ channelId: tpl });
  });

  it("rappels et relances : salon du raid récurrent même sans salon de groupe", async () => {
    const s = await scene("Sans Salon", { groupChannel: false });
    const tpl = nextId();
    expect((await s.bindTemplate(tpl)).json().kind).toBe("template");
    const [r1] = await s.tplRaids();
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(5) }).where(eq(raids.id, r1!.id));
    const loose = (await s.gm.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", scheduledAt: inHours(5).toISOString() })).json().raid;
    // Inscription depuis le bouton de l'annonce (salon du raid récurrent) ; le raid ponctuel n'a pas d'annonce
    const guest = nextId();
    expect((await bot("POST", `/internal/discord/raids/${r1!.id}/signup`, { discordUserId: guest, discordName: "Invité", status: "tentative", cls: "Mage", spec: "Frost" })).statusCode).toBe(200);
    expect((await bot("GET", `/internal/discord/raids/${loose.id}/view`)).statusCode).toBe(404);

    const { reminders } = (await bot("POST", "/internal/discord/reminders/claim")).json();
    const mine = reminders.filter((r: { view: View }) => [r1!.id, loose.id].includes(r.view.raid.id));
    // Le raid récurrent a un salon (le sien) ; le raid ponctuel n'en a aucun
    expect(mine).toHaveLength(1);
    expect(mine[0].view).toMatchObject({ raid: { id: r1!.id }, channelId: tpl });
    expect(mine[0].recipients.map((r: { discordUserId: string }) => r.discordUserId)).toEqual([guest]);
    expect(await inOutbox(loose.id)).toBeUndefined();
    expect(await inOutbox(r1!.id)).toMatchObject({ channelId: tpl });
    // Relance demandée par un officier : partie aussi (salon du raid récurrent)
    expect((await s.gm.c.get(`/api/groups/${s.g.id}/raids/${r1!.id}/reach`)).json().discordLinked).toBe(true);
    expect((await s.gm.c.get(`/api/groups/${s.g.id}/raids/${loose.id}/reach`)).json().discordLinked).toBe(false);
    // /raid dans ce salon : le groupe n'a pas de salon pour un raid ponctuel
    const res = await bot("POST", "/internal/discord/raids", { guildId: s.ids.guild, channelId: tpl, discordUserId: s.ids.gm, name: "Naxx", scheduledAt: inHours(30).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("pas de salon Discord pour ses raids ponctuels");
  });

  it("nom du salon : date du raid courant, jusqu'à 12 h après, puis la suivante", async () => {
    const s = await scene("Calendrier");
    const tpl = nextId();
    await s.bindTemplate(tpl);
    const [a, b] = await s.tplRaids();
    const names = async () => ((await bot("GET", "/internal/discord/channel-names")).json() as { templateId: string; guildId: string; channelId: string; name: string }[])
      .filter(c => c.templateId === s.t.id);
    const at = async (id: string, d: Date) => { await env.app.ctx.db.update(raids).set({ scheduledAt: d }).where(eq(raids.id, id)); return d; };

    // Raid d'il y a 11 h : encore le raid courant
    const da = await at(a!.id, inHours(-11));
    const db = await at(b!.id, inHours(7 * 24 - 11));
    expect(await names()).toEqual([{ templateId: s.t.id, guildId: s.ids.guild, channelId: tpl, name: channelNameFor(da) }]);
    expect((await names())[0]!.name).toMatch(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)-\d{2}-\d{2}$/);
    // 13 h après : le salon passe à la date du raid suivant
    await at(a!.id, inHours(-13));
    expect((await names()).map(c => c.name)).toEqual([channelNameFor(db)]);
    // Renommage coupé, ou raid récurrent en pause : plus d'entrée
    await s.gm.c.patch(`/api/groups/${s.g.id}/raid-templates/${s.t.id}`, { discordRename: false });
    expect(await names()).toEqual([]);
    await s.gm.c.patch(`/api/groups/${s.g.id}/raid-templates/${s.t.id}`, { discordRename: true });
    await env.app.ctx.db.update(raidTemplates).set({ active: false }).where(eq(raidTemplates.id, s.t.id));
    expect(await names()).toEqual([]);
    await env.app.ctx.db.update(raidTemplates).set({ active: true }).where(eq(raidTemplates.id, s.t.id));
    // Aucun raid courant : pas d'entrée, le salon garde son nom
    await at(b!.id, inHours(-30));
    expect(await names()).toEqual([]);
  });

  it("annonce d'un raid passé effacée du salon du raid récurrent, sans republication ; salon du groupe inchangé", async () => {
    const s = await scene("Archives");
    const tpl = nextId();
    await s.bindTemplate(tpl);
    const [a, b] = await s.tplRaids();
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(2) }).where(eq(raids.id, a!.id));
    const loose = (await s.gm.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", scheduledAt: inHours(2).toISOString() })).json().raid;
    await drain();
    expect((await publish(a!.id, "720000000000009101")).channelId).toBe(tpl);
    await publish(b!.id, "720000000000009102");
    expect((await publish(loose.id, "720000000000009103")).channelId).toBe(s.ids.group);

    // 11 h après : rien ne bouge
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(-11) }).where(eq(raids.id, a!.id));
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(-11) }).where(eq(raids.id, loose.id));
    expect(await drain()).toEqual([]);
    // 13 h après : l'annonce du salon du raid récurrent est effacée, pas celle du salon du groupe
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(-13) }).where(eq(raids.id, a!.id));
    await env.app.ctx.db.update(raids).set({ scheduledAt: inHours(-13) }).where(eq(raids.id, loose.id));
    expect(await drain()).toEqual([`${tpl}/720000000000009101`]);
    const rows = await s.tplRaids();
    expect(rows.find(r => r.id === a!.id)).toMatchObject({ channelId: null, messageId: null });
    expect(rows.find(r => r.id === b!.id)).toMatchObject({ channelId: tpl, messageId: "720000000000009102" });
    const [l] = await env.app.ctx.db.select({ messageId: raids.discordMessageId }).from(raids).where(eq(raids.id, loose.id));
    expect(l!.messageId).toBe("720000000000009103");
    // … et le raid n'est pas republié, même après un changement
    await env.app.ctx.db.update(raids).set({ discordChangedAt: new Date() }).where(eq(raids.id, a!.id));
    expect(await inOutbox(a!.id)).toBeUndefined();
    expect(await drain()).toEqual([]);
  });

  it("rapport du bot (nom, erreur), renommage coupé, retour au salon du groupe, suppression", async () => {
    const s = await scene("Rapports");
    const tpl = nextId();
    await s.bindTemplate(tpl);
    const [a] = await s.tplRaids();
    await drain();
    await publish(a!.id, "720000000000009201");

    // Le bot rapporte le nom actuel du salon, puis une erreur de renommage
    expect((await bot("POST", `/internal/discord/templates/${s.t.id}/channel`, { channelId: tpl, name: "jeudi-15-10", error: null })).json()).toEqual({ ok: true });
    expect((await s.templates())[0]!.discord).toEqual({ linked: true, channelName: "jeudi-15-10", rename: true, renameError: null });
    const err = "Le bot ne peut pas renommer ce salon : donne-lui la permission « Gérer les salons » sur ce salon.";
    await bot("POST", `/internal/discord/templates/${s.t.id}/channel`, { channelId: tpl, name: "molten-core", error: err });
    expect((await s.templates())[0]!.discord).toEqual({ linked: true, channelName: "molten-core", rename: true, renameError: err });
    // Salon introuvable : le dernier nom connu reste ; rapport sur un ancien salon : ignoré
    await bot("POST", `/internal/discord/templates/${s.t.id}/channel`, { channelId: tpl, name: null, error: "Salon introuvable : lie un autre salon." });
    expect((await s.templates())[0]!.discord).toMatchObject({ channelName: "molten-core", renameError: "Salon introuvable : lie un autre salon." });
    expect((await bot("POST", `/internal/discord/templates/${s.t.id}/channel`, { channelId: nextId(), name: "autre", error: null })).json()).toEqual({ ok: false });
    // Renommage coupé : l'erreur ne vaut plus
    expect((await s.p1.c.patch(`/api/groups/${s.g.id}/raid-templates/${s.t.id}`, { discordRename: false })).statusCode).toBe(403);
    expect((await s.gm.c.patch(`/api/groups/${s.g.id}/raid-templates/${s.t.id}`, { discordRename: false })).json().template.discord)
      .toEqual({ linked: true, channelName: "molten-core", rename: false, renameError: null });
    // Le bind répond sans date à prendre quand le renommage est coupé
    expect((await s.bindTemplate(tpl)).json().template).toMatchObject({ rename: false, next: null });

    // Retour au salon du groupe : annonce effacée du salon à part, republiée dans celui du groupe
    expect((await s.p1.c.del(`/api/groups/${s.g.id}/raid-templates/${s.t.id}/discord`)).statusCode).toBe(403);
    expect((await s.gm.c.del(`/api/groups/${s.g.id}/raid-templates/${s.t.id}/discord`)).statusCode).toBe(200);
    expect(await drain()).toEqual([`${tpl}/720000000000009201`]);
    expect(await inOutbox(a!.id)).toMatchObject({ channelId: s.ids.group, messageId: null });
    expect((await s.templates())[0]!.discord).toEqual({ linked: false, channelName: null, rename: false, renameError: null });
    expect((await bot("GET", "/internal/discord/channel-names")).json().filter((c: { templateId: string }) => c.templateId === s.t.id)).toEqual([]);

    // Relié puis supprimé : ses annonces quittent le salon à part, ses raids restent et repartent dans le salon du groupe
    await publish(a!.id, "720000000000009202");
    await s.bindTemplate(tpl);
    expect(await drain()).toEqual([`${s.ids.group}/720000000000009202`]);
    await publish(a!.id, "720000000000009203");
    expect((await s.gm.c.del(`/api/groups/${s.g.id}/raid-templates/${s.t.id}`)).statusCode).toBe(200);
    expect(await drain()).toEqual([`${tpl}/720000000000009203`]);
    expect(await inOutbox(a!.id)).toMatchObject({ channelId: s.ids.group, messageId: null });
  });

  it("changer le salon du groupe garde les annonces des raids récurrents qui ont le leur", async () => {
    const s = await scene("Déménagement");
    const tpl = nextId();
    await s.bindTemplate(tpl);
    const [a] = await s.tplRaids();
    const loose = (await s.gm.c.post(`/api/groups/${s.g.id}/raids`, { name: "Onyxia", scheduledAt: inHours(30).toISOString() })).json().raid;
    await drain();
    await publish(a!.id, "720000000000009301");
    await publish(loose.id, "720000000000009302");
    const moved = nextId();
    const { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: s.ids.guild, channelId: moved, discordUserId: s.ids.gm });
    expect(await drain()).toEqual([`${s.ids.group}/720000000000009302`]);
    expect(await inOutbox(loose.id)).toMatchObject({ channelId: moved, messageId: null });
    // Republication de l'annonce du raid récurrent (marqué changé) : même message, même salon
    expect(await inOutbox(a!.id)).toMatchObject({ channelId: tpl, messageId: "720000000000009301" });
    // Délier le salon du groupe : le raid récurrent garde le sien
    await s.gm.c.del(`/api/groups/${s.g.id}/discord`);
    expect(await drain()).toEqual([]);
    expect(await inOutbox(a!.id)).toMatchObject({ channelId: tpl });
  });
});

describe("nom des salons liés (Administration → Discord)", () => {
  type Linked = { kind: "group" | "orders" | "template"; id: string; guildId: string | null; channelId: string; name: string | null };
  const linkedOf = async (...ids: string[]) => ((await bot("GET", "/internal/discord/linked-channels")).json() as Linked[]).filter(c => ids.includes(c.id));
  const report = async (b: { kind: string; id: string; channelId: string; name: string }) => bot("POST", "/internal/discord/channel-name", b);

  it("la liaison garde le nom, le bot le met à jour, délier l'efface ; le site n'expose que le nom", async () => {
    const s = await scene("Enseignes");
    const group = async () => (await s.gm.c.get(`/api/groups/${s.g.id}`)).json().group as Record<string, unknown>;
    // Salon du groupe lié sans nom (bot d'avant) : lié, nom inconnu
    expect(await group()).toMatchObject({ discordLinked: true, discordChannelName: null, ordersLinked: false, ordersChannelName: null });

    // Liaison avec le nom du salon : groupe, commandes, raid récurrent
    const raidsCh = nextId(), ordersCh = nextId(), tplCh = nextId();
    const { code } = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: s.ids.guild, channelId: raidsCh, discordUserId: s.ids.gm, channelName: "raids" });
    const ocode = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/orders-code`)).json().code;
    await bot("POST", "/internal/discord/bind", { code: ocode, guildId: s.ids.guild, channelId: ordersCh, discordUserId: s.ids.gm, channelName: "commandes" });
    await s.bindTemplate(tplCh, { channelName: "molten-core" });
    const res = await s.gm.c.get(`/api/groups/${s.g.id}`);
    expect(res.json().group).toMatchObject({ discordLinked: true, discordChannelName: "raids", ordersLinked: true, ordersChannelName: "commandes" });
    // Un membre voit aussi les noms, jamais les identifiants
    expect((await s.p1.c.get(`/api/groups/${s.g.id}`)).json().group.discordChannelName).toBe("raids");
    for (const id of [raidsCh, ordersCh, tplCh, s.ids.guild]) expect(res.body).not.toContain(id);

    // Liste du bot : les trois sortes de salons, avec le nom connu
    expect(await linkedOf(s.g.id, s.t.id)).toEqual(expect.arrayContaining([
      { kind: "group", id: s.g.id, guildId: s.ids.guild, channelId: raidsCh, name: "raids" },
      { kind: "orders", id: s.g.id, guildId: s.ids.guild, channelId: ordersCh, name: "commandes" },
      { kind: "template", id: s.t.id, guildId: s.ids.guild, channelId: tplCh, name: "molten-core" },
    ]));
    expect(await linkedOf(s.g.id, s.t.id)).toHaveLength(3);

    // Rapport du bot : écrit seulement si le nom diffère
    expect((await report({ kind: "group", id: s.g.id, channelId: raidsCh, name: "raids-du-jeudi" })).json()).toEqual({ ok: true, changed: true });
    expect((await report({ kind: "group", id: s.g.id, channelId: raidsCh, name: "raids-du-jeudi" })).json()).toEqual({ ok: true, changed: false });
    expect((await report({ kind: "orders", id: s.g.id, channelId: ordersCh, name: "artisanat" })).json().changed).toBe(true);
    expect((await report({ kind: "template", id: s.t.id, channelId: tplCh, name: "jeudi-15-10" })).json().changed).toBe(true);
    expect(await group()).toMatchObject({ discordChannelName: "raids-du-jeudi", ordersChannelName: "artisanat" });
    expect((await s.templates())[0]!.discord).toMatchObject({ linked: true, channelName: "jeudi-15-10" });
    // … et seulement si le salon est toujours lié : rapport sur un autre salon, ou mauvaise sorte, ignoré
    expect((await report({ kind: "group", id: s.g.id, channelId: nextId(), name: "ancien" })).json().changed).toBe(false);
    expect((await report({ kind: "orders", id: s.g.id, channelId: raidsCh, name: "ancien" })).json().changed).toBe(false);
    expect((await report({ kind: "template", id: s.t.id, channelId: raidsCh, name: "ancien" })).json().changed).toBe(false);
    expect(await group()).toMatchObject({ discordChannelName: "raids-du-jeudi", ordersChannelName: "artisanat" });
    expect((await report({ kind: "salon", id: s.g.id, channelId: raidsCh, name: "x" })).statusCode).toBe(400);
    expect((await report({ kind: "group", id: s.g.id, channelId: raidsCh, name: " " })).statusCode).toBe(400);

    // Délier : nom effacé, plus dans la liste du bot, rapport tardif ignoré
    await s.gm.c.del(`/api/groups/${s.g.id}/discord`);
    await s.gm.c.del(`/api/groups/${s.g.id}/discord/orders`);
    expect(await group()).toMatchObject({ discordLinked: false, discordChannelName: null, ordersLinked: false, ordersChannelName: null });
    expect((await report({ kind: "group", id: s.g.id, channelId: raidsCh, name: "raids" })).json().changed).toBe(false);
    expect(await linkedOf(s.g.id, s.t.id)).toEqual([{ kind: "template", id: s.t.id, guildId: s.ids.guild, channelId: tplCh, name: "jeudi-15-10" }]);
    // Relier sans nom (bot d'avant) : nom inconnu jusqu'au prochain rapport du bot
    const again = (await s.gm.c.post(`/api/groups/${s.g.id}/discord/code`)).json().code;
    await bot("POST", "/internal/discord/bind", { code: again, guildId: s.ids.guild, channelId: raidsCh, discordUserId: s.ids.gm });
    expect(await group()).toMatchObject({ discordLinked: true, discordChannelName: null });
    expect((await report({ kind: "group", id: s.g.id, channelId: raidsCh, name: "raids" })).json().changed).toBe(true);
    expect(await group()).toMatchObject({ discordChannelName: "raids" });
  });
});
