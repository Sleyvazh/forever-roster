import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discordDeletions, gameItems, groups, questNotices, quests, questTakers, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { expireAndRemind, purgeOldQuests } from "../src/lib/quests";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Quêtes de guilde (27/11/2026) : parcours complet, droits, places, échéance, rappels, départ d'un membre. */

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  await env.app.ctx.db.insert(gameItems).values([
    { id: 4304, name: "Cuir épais", quality: 1, itemLevel: 40, reqLevel: 0, classId: 7, subclassId: 0, inventoryType: 0, details: { icon: "inv_misc_leatherscrap_08" } },
    { id: 13446, name: "Potion de soins majeure", quality: 1, itemLevel: 55, reqLevel: 45, classId: 0, subclassId: 1, inventoryType: 0 },
  ]);
});
afterAll(async () => { await env.close(); });

const db = () => env.app.ctx.db;
type Signed = Awaited<ReturnType<typeof signedIn>>;
let discord = 910000000000000000n;

/** Guilde Forever : un chef et des membres (Discord lié, chacun un main). */
async function guild(name: string, players: string[]) {
  const slug = name.replace(/[^A-Za-z]/g, "");
  const chef = await signedIn(env, `${slug}Chef`);
  const g = (await chef.c.post("/api/groups", { name })).json().group as { id: string };
  const inv = (await chef.c.post(`/api/groups/${g.id}/invites`, { maxUses: 20, expiresInHours: 24 })).json().invite;
  const p: Record<string, Signed> = { Chef: chef };
  for (const n of players) {
    const s = await signedIn(env, `${slug}${n}`);
    await s.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    p[n] = s;
  }
  for (const [n, s] of Object.entries(p)) {
    await db().update(users).set({ discordId: String(++discord) }).where(eq(users.id, s.user.id));
    const c = (await s.c.post("/api/characters", { name: `${n}${slug}`.slice(0, 12), race: "Troll", cls: "Mage", spec1: "Frost", level: 60 })).json().character;
    await s.c.put(`/api/groups/${g.id}/characters/${c.id}`, { assigned: true });
  }
  const base = `/api/groups/${g.id}/quests`;
  return { g, p, base };
}

const leather = { type: "collect", title: "Du cuir pour mes sacoches", description: "Je monte le Travail du cuir.", objectiveItemId: 4304, objectiveQty: 20, rewardCopper: 30000 };
const noticesFor = async (s: Signed) => {
  const [u] = await db().select({ d: users.discordId }).from(users).where(eq(users.id, s.user.id));
  return (await db().select().from(questNotices).where(eq(questNotices.discordUserId, u!.d!))).map(n => n.kind);
};

describe("parcours complet", () => {
  it("publier → prendre → rendre → valider → remis → reçu, avec les MP", async () => {
    const { p, base } = await guild("Cuirassiers", ["Kael", "Vex"]);
    const r = await p.Vex!.c.post(base, { ...leather, places: 2, rewardItems: [{ itemId: 13446, qty: 5 }], rewardText: "un enchantement" });
    expect(r.statusCode).toBe(201);
    const q = r.json().quest;
    expect(q).toMatchObject({ state: "open", free: 2, places: 2, objective: { item: { name: "Cuir épais", qty: 20, icon: "inv_misc_leatherscrap_08" } } });
    expect(q.reward.label).toBe("3 po · 5 × Potion de soins majeure · un enchantement");

    const took = (await p.Kael!.c.post(`${base}/${q.id}/take`)).json().quest;
    expect(took.free).toBe(1);
    const taker = took.takers[0];
    expect(taker).toMatchObject({ state: "taken", userId: p.Kael!.user.id });
    expect(await noticesFor(p.Vex!)).toContain("taken");

    // Seul le donneur valide ; le preneur rend avec un mot
    expect((await p.Kael!.c.post(`${base}/${q.id}/takers/${taker.id}/validate`)).statusCode).toBe(403);
    const turned = (await p.Kael!.c.post(`${base}/${q.id}/turn-in`, { note: "Je te les envoie par courrier." })).json().quest;
    expect(turned.takers[0]).toMatchObject({ state: "turned_in", note: "Je te les envoie par courrier." });
    expect(await noticesFor(p.Vex!)).toContain("turned_in");

    // « Pas encore » renvoie en « Prise » avec le mot du donneur
    const back = (await p.Vex!.c.post(`${base}/${q.id}/takers/${taker.id}/reject`, { note: "Il en manque 5." })).json().quest;
    expect(back.takers[0]).toMatchObject({ state: "taken", rejectNote: "Il en manque 5." });
    await p.Kael!.c.post(`${base}/${q.id}/turn-in`, {});
    expect((await p.Vex!.c.post(`${base}/${q.id}/takers/${taker.id}/validate`)).json().quest.takers[0].state).toBe("validated");
    expect((await p.Vex!.c.post(`${base}/${q.id}/takers/${taker.id}/paid`)).json().quest.takers[0].state).toBe("paid");
    expect(await noticesFor(p.Kael!)).toEqual(expect.arrayContaining(["rejected", "validated", "paid"]));

    // « Pas reçu » prévient le donneur ; il remet à nouveau ; « Reçu »
    expect((await p.Kael!.c.post(`${base}/${q.id}/received`, { ok: false })).json().quest.takers[0].disputed).toBe(true);
    expect(await noticesFor(p.Vex!)).toContain("not_received");
    expect((await p.Vex!.c.post(`${base}/${q.id}/takers/${taker.id}/paid`)).json().quest.takers[0].disputed).toBe(false);
    const done = (await p.Kael!.c.post(`${base}/${q.id}/received`, { ok: true })).json().quest;
    expect(done.takers[0].state).toBe("received");
    // Une place reste : la quête est encore disponible ; close, elle est terminée
    expect(done.state).toBe("open");
    expect((await p.Vex!.c.post(`${base}/${q.id}/close`)).json().quest.state).toBe("done");

    const list = (await p.Kael!.c.get(base)).json();
    expect(list.reliability[p.Kael!.user.id]).toMatchObject({ done: 1 });
    expect(list.reliability[p.Vex!.user.id]).toMatchObject({ given: 1, paid: 1, owed: 1 });
  });
});

describe("droits et limites", () => {
  it("non-membre, sa propre quête, réglage « officiers », objet inconnu, récompense vide", async () => {
    const { g, p, base } = await guild("Gardiens", ["Ana"]);
    const outsider = await signedIn(env, "Etranger");
    expect((await outsider.c.get(base)).statusCode).toBe(404);
    const q = (await p.Ana!.c.post(base, leather)).json().quest;
    expect((await p.Ana!.c.post(`${base}/${q.id}/take`)).json().error).toBe("Tu ne peux pas prendre ta propre quête.");
    expect((await p.Ana!.c.post(base, { ...leather, objectiveItemId: 999999 })).json().error).toBe("Cet objet n'est pas dans la base du site.");
    expect((await p.Ana!.c.post(base, { ...leather, rewardCopper: 0 })).json().error).toBe("Donne au moins une récompense : de l'or, un objet ou autre chose.");
    expect((await p.Ana!.c.post(base, { ...leather, objectiveItemId: null })).json().error).toBe("Donne un objectif : un objet du jeu ou une phrase.");
    await p.Chef!.c.put(`/api/groups/${g.id}/creators`, { quests: "officers" });
    expect((await p.Ana!.c.post(base, leather)).statusCode).toBe(403);
    expect((await p.Chef!.c.post(base, leather)).statusCode).toBe(201);
    expect((await p.Ana!.c.get(`/api/groups/${g.id}`)).json().group.creators).toMatchObject({ quests: "officers", canCreateQuest: false });
  });

  it("5 quêtes ouvertes par joueur", async () => {
    const { p, base } = await guild("Ouvriers", []);
    for (let i = 0; i < 5; i++) expect((await p.Chef!.c.post(base, { ...leather, title: `Quête ${i}` })).statusCode).toBe(201);
    expect((await p.Chef!.c.post(base, leather)).json().error).toBe("Tu as déjà 5 quêtes ouvertes : closes-en une avant d'en publier une autre.");
  });

  it("modifiée après une prise : seuls la description, l'échéance et les places changent", async () => {
    const { p, base } = await guild("Scribes", ["Bo"]);
    const q = (await p.Chef!.c.post(base, { ...leather, places: 3 })).json().quest;
    await p.Bo!.c.post(`${base}/${q.id}/take`);
    const r = (await p.Chef!.c.put(`${base}/${q.id}`, { ...leather, title: "Autre titre", rewardCopper: 100, description: "Nouvelle", places: 2 })).json();
    expect(r.limited).toBe(true);
    expect(r.quest).toMatchObject({ title: leather.title, description: "Nouvelle", places: 2, reward: { copper: 30000 } });
    expect((await p.Chef!.c.put(`${base}/${q.id}`, { ...leather, places: 0 })).statusCode).toBe(400);
  });
});

describe("places", () => {
  it("deux joueurs prennent la dernière place en même temps : un seul l'a", async () => {
    const { p, base } = await guild("Rivaux", ["Un", "Deux"]);
    const q = (await p.Chef!.c.post(base, leather)).json().quest;
    const [a, b] = await Promise.all([p.Un!.c.post(`${base}/${q.id}/take`), p.Deux!.c.post(`${base}/${q.id}/take`)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    expect([a, b].find(r => r.statusCode === 400)!.json().error).toBe("Plus de place dans cette quête.");
    const rows = await db().select().from(questTakers).where(eq(questTakers.questId, q.id));
    expect(rows).toHaveLength(1);
  });

  it("rendre sa place la libère ; un officier retire un preneur", async () => {
    const { p, base } = await guild("Errants", ["Lu", "Mo"]);
    const q = (await p.Lu!.c.post(base, leather)).json().quest;
    await p.Mo!.c.post(`${base}/${q.id}/take`);
    expect((await p.Mo!.c.post(`${base}/${q.id}/abandon`)).json().quest.state).toBe("open");
    const again = (await p.Mo!.c.post(`${base}/${q.id}/take`)).json().quest;
    expect(again.takers[0].state).toBe("taken");
    const t = again.takers[0].id;
    await p.Mo!.c.post(`${base}/${q.id}/turn-in`, {});
    // Le donneur ne retire pas un preneur qui a rendu ; un officier, si
    expect((await p.Lu!.c.del(`${base}/${q.id}/takers/${t}`)).statusCode).toBe(403);
    expect((await p.Chef!.c.del(`${base}/${q.id}/takers/${t}`)).json().quest.takers[0].state).toBe("removed");
    expect((await p.Mo!.c.post(`${base}/${q.id}/take`)).json().error).toBe("Un officier t'a retiré de cette quête.");
  });
});

describe("échéance, rappels, départ, purge", () => {
  it("échéance passée : plus de preneur, ceux en « Prise » expirent ; une quête rendue se valide encore", async () => {
    const { p, base } = await guild("Pressés", ["Ri", "Su"]);
    const due = new Date(Date.now() + 2 * 3600e3).toISOString();
    const q = (await p.Chef!.c.post(base, { ...leather, places: 3, dueAt: due })).json().quest;
    await p.Ri!.c.post(`${base}/${q.id}/take`);
    await p.Su!.c.post(`${base}/${q.id}/take`);
    await p.Su!.c.post(`${base}/${q.id}/turn-in`, {});
    await db().update(quests).set({ dueAt: new Date(Date.now() - 60e3) }).where(eq(quests.id, q.id));
    await expireAndRemind(db());
    const v = (await p.Chef!.c.get(base)).json().quests.find((x: { id: string }) => x.id === q.id);
    expect(v.state).toBe("running");
    expect(v.takers.map((t: { state: string }) => t.state).sort()).toEqual(["expired", "turned_in"]);
    expect(await noticesFor(p.Ri!)).toContain("expired");
    expect((await p.Ri!.c.post(`${base}/${q.id}/take`)).json().error).toBe("Cette quête n'est plus disponible.");
    const su = v.takers.find((t: { state: string }) => t.state === "turned_in");
    expect((await p.Chef!.c.post(`${base}/${q.id}/takers/${su.id}/validate`)).statusCode).toBe(200);
  });

  it("rappels : un seul de chaque, au bon moment", async () => {
    const { p, base } = await guild("Oublieux", ["Ze"]);
    const q = (await p.Chef!.c.post(base, leather)).json().quest;
    await p.Ze!.c.post(`${base}/${q.id}/take`);
    await p.Ze!.c.post(`${base}/${q.id}/turn-in`, {});
    await db().update(questTakers).set({ turnedInAt: new Date(Date.now() - 2 * 86400e3) }).where(eq(questTakers.questId, q.id));
    await expireAndRemind(db());
    expect((await noticesFor(p.Chef!)).filter(k => k === "remind_validate")).toHaveLength(0);
    await db().update(questTakers).set({ turnedInAt: new Date(Date.now() - 3.1 * 86400e3) }).where(eq(questTakers.questId, q.id));
    await expireAndRemind(db());
    await expireAndRemind(db());
    expect((await noticesFor(p.Chef!)).filter(k => k === "remind_validate")).toHaveLength(1);
  });

  it("un membre qui quitte la guilde : sa place est rendue, ses quêtes sont annulées", async () => {
    const { g, p, base } = await guild("Partants", ["Ga", "Bu"]);
    const mine = (await p.Ga!.c.post(base, leather)).json().quest;
    const other = (await p.Bu!.c.post(base, leather)).json().quest;
    await p.Bu!.c.post(`${base}/${mine.id}/take`);
    await p.Ga!.c.post(`${base}/${other.id}/take`);
    await p.Ga!.c.del(`/api/groups/${g.id}/members/${p.Ga!.user.id}`);
    const list = (await p.Bu!.c.get(base)).json().quests as { id: string; state: string; takers: { state: string }[] }[];
    expect(list.find(x => x.id === mine.id)!.state).toBe("cancelled");
    expect(list.find(x => x.id === other.id)).toMatchObject({ state: "open", takers: [{ state: "abandoned" }] });
    expect(await noticesFor(p.Bu!)).toContain("cancelled");
  });

  it("purge : 12 mois sans activité et sans preneur en cours", async () => {
    const { p, base } = await guild("Anciens", ["Ol"]);
    const a = (await p.Chef!.c.post(base, { ...leather, title: "Vieille" })).json().quest;
    const b = (await p.Chef!.c.post(base, { ...leather, title: "Vieille mais prise" })).json().quest;
    await p.Ol!.c.post(`${base}/${b.id}/take`);
    const old = new Date(Date.now() - 400 * 86400e3);
    await db().update(quests).set({ updatedAt: old }).where(eq(quests.groupId, (await db().select({ g: quests.groupId }).from(quests).where(eq(quests.id, a.id)))[0]!.g));
    await purgeOldQuests(db());
    const left = (await db().select({ id: quests.id }).from(quests).where(eq(quests.title, "Vieille mais prise"))).map(r => r.id);
    expect(left).toContain(b.id);
    expect((await db().select().from(quests).where(eq(quests.id, a.id)))).toHaveLength(0);
  });

  it("guilde Retail : pas de quêtes", async () => {
    const { g, p, base } = await guild("Pasta", []);
    await db().update(groups).set({ game: "retail" }).where(eq(groups.id, g.id));
    expect((await p.Chef!.c.get(base)).json().error).toBe("Les quêtes de guilde sont pour WoW Forever.");
    expect((await p.Chef!.c.get(`/api/groups/${g.id}`)).json().group.creators.canCreateQuest).toBe(false);
});
});

describe("bot Discord", () => {
  it("salon #quêtes, annonce, Prendre, MP avec l'adresse du site, /quete, message effacé à la fin", async () => {
    const internal = await buildInternalApp(env.app.ctx);
    await internal.ready();
    const bot = (method: string, url: string, payload?: object) =>
      internal.inject({ method: method as "GET", url, headers: { authorization: "Bearer secret-interne-de-test-assez-long-0123456789" }, ...(payload ? { payload } : {}) });
    try {
      const { g, p, base } = await guild("Annonceurs", ["Ri"]);
      const did = async (s: Signed) => (await db().select({ d: users.discordId }).from(users).where(eq(users.id, s.user.id)))[0]!.d!;
      const guildId = "777000000000000001", raids = "777000000000000002", questsChannel = "777000000000000003";
      const raidCode = (await p.Chef!.c.post(`/api/groups/${g.id}/discord/code`)).json().code;
      expect((await bot("POST", "/internal/discord/bind", { code: raidCode, guildId, channelId: raids, discordUserId: await did(p.Chef!) })).statusCode).toBe(200);
      // Sans salon à part : dans le salon de la guilde
      const q = (await p.Chef!.c.post(base, leather)).json().quest;
      expect(q.channelId).toBe(raids);
      // Salon des quêtes lié : la quête y part
      const code = (await p.Chef!.c.post(`/api/groups/${g.id}/discord/quests-code`)).json().code;
      const bound = await bot("POST", "/internal/discord/bind", { code, guildId, channelId: questsChannel, discordUserId: await did(p.Chef!), channelName: "quêtes" });
      expect(bound.json()).toMatchObject({ kind: "quests" });
      let out = (await bot("GET", "/internal/discord/quests/outbox")).json().quests as { id: string; channelId: string; changedAt: string }[];
      expect(out.find(x => x.id === q.id)!.channelId).toBe(questsChannel);
      await bot("POST", `/internal/discord/quests/${q.id}/published`, { channelId: questsChannel, messageId: "777000000000000099", changedAt: out.find(x => x.id === q.id)!.changedAt });
      expect((await bot("GET", "/internal/discord/quests/outbox")).json().quests.find((x: { id: string }) => x.id === q.id)).toBeUndefined();

      // Prendre depuis Discord ; un Discord inconnu est refusé
      expect((await bot("POST", `/internal/discord/quests/${q.id}/take`, { discordUserId: "777000000000000555" })).json().error).toBe("Lie d'abord ton compte Discord au site (Compte & sécurité).");
      const taken = (await bot("POST", `/internal/discord/quests/${q.id}/take`, { discordUserId: await did(p.Ri!) })).json().view;
      expect(taken.state).toBe("running");
      const claimed = (await bot("POST", "/internal/discord/quests/notices/claim")).json().notices as { kind: string; payload: { questId: string; url: string; other: string } }[];
      const n = claimed.find(x => x.kind === "taken" && x.payload.questId === q.id)!;
      expect(n.payload.url).toBe(`http://app.test/groups/${g.id}/membres/quetes?quete=${q.id}`);
      expect((await bot("POST", "/internal/discord/quests/notices/claim")).json().notices.filter((x: { kind: string }) => x.kind === "taken")).toHaveLength(0);

      // Fin : validée, remise, reçue, close → message effacé
      const t = taken.takers[0].id;
      await bot("POST", `/internal/discord/quests/${q.id}/takers/${t}/validate`, { discordUserId: await did(p.Chef!) });
      await bot("POST", `/internal/discord/quests/${q.id}/takers/${t}/paid`, { discordUserId: await did(p.Chef!) });
      expect((await bot("POST", `/internal/discord/quests/${q.id}/received`, { discordUserId: await did(p.Ri!), ok: true })).json().view.state).toBe("done");
      await bot("GET", "/internal/discord/quests/outbox");
      expect(await db().select().from(discordDeletions).where(eq(discordDeletions.messageId, "777000000000000099"))).toHaveLength(1);

      // /quete
      const made = await bot("POST", "/internal/discord/quests", { guildId, channelId: questsChannel, discordUserId: await did(p.Ri!), title: "Escorte", objective: "Arriver à Gadgetzan", gold: 2, places: 3 });
      expect(made.json().view).toMatchObject({ title: "Escorte", places: 3, reward: { copper: 20000 }, objective: { text: "Arriver à Gadgetzan" } });
    } finally { await internal.close(); }
  });
});
