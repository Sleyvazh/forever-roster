import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const druid = {
  name: "Tournicoti Tournicoton", race: "Tauren", cls: "Druid", spec1: "Feral Cat", spec2: "Feral Bear", level: 1,
  talents: "9/37/5", talentLink: "https://foreverchanges.pro/talents/druid?b=050022-5520002123032213051-05",
  professions: { prof1: { name: "Leatherworking", skill: 0 }, prof2: { name: "Skinning", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 },
};

describe("personnages", () => {
  it("crée, modifie, réordonne et supprime ses persos", async () => {
    const { c } = await signedIn(env);
    const a = (await c.post("/api/characters", druid)).json().character;
    const b = (await c.post("/api/characters", { name: "John Poutre", race: "Orc", cls: "Warrior", spec1: "Arms" })).json().character;
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);

    const upd = await c.patch(`/api/characters/${a.id}`, { level: 12, gear: { Head: { cur: "Casque", q: 2, got: false } } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().character.level).toBe(12);

    expect((await c.put("/api/characters/order", { ids: [b.id, a.id] })).statusCode).toBe(200);
    const list = (await c.get("/api/characters")).json().characters;
    expect(list.map((x: { id: string }) => x.id)).toEqual([b.id, a.id]);

    expect((await c.del(`/api/characters/${a.id}`)).statusCode).toBe(200);
  });

  it("applique les règles de WoW Forever", async () => {
    const { c } = await signedIn(env);
    expect((await c.post("/api/characters", { name: "X", race: "Tauren", cls: "Mage" })).statusCode).toBe(400);
    expect((await c.post("/api/characters", { name: "X", cls: "Warrior", spec1: "Feral Cat" })).statusCode).toBe(400);
    expect((await c.post("/api/characters", { name: "X", cls: "Druid", talents: "40/30/0" })).statusCode).toBe(400);
    expect((await c.post("/api/characters", { name: "X", level: 61 })).statusCode).toBe(400);
    expect((await c.post("/api/characters", { name: "X", cls: "Druid", talents2: "40/30/0" })).statusCode).toBe(400);
    expect((await c.post("/api/characters", { name: "X", cls: "Priest", spec1: "Holy DPS" })).statusCode).toBe(400);
  });

  it("enregistre la spé principale et l'off-spec avec chacune son build", async () => {
    const { c } = await signedIn(env);
    const r = await c.post("/api/characters", {
      name: "Sam", race: "Undead", cls: "Priest", spec1: "Discipline Heal", spec2: "Discipline DPS",
      talents: "31/20/0", talents2: "21/0/30", talentLink2: "https://foreverchanges.pro/talents/priest?b=1",
    });
    expect(r.statusCode).toBe(201);
    const ch = r.json().character;
    expect(ch).toMatchObject({ spec1: "Discipline Heal", spec2: "Discipline DPS", talents: "31/20/0", talents2: "21/0/30" });
    expect((await c.patch(`/api/characters/${ch.id}`, { talentLink2: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await c.patch(`/api/characters/${ch.id}`, { spec2: "Shadow", talents2: "0/21/30" })).json().character.talents2).toBe("0/21/30");
  });

  it("refuse les liens non https (XSS via javascript:)", async () => {
    const { c } = await signedIn(env);
    const r = await c.post("/api/characters", { name: "X", talentLink: "javascript:alert(document.cookie)" });
    expect(r.statusCode).toBe(400);
  });

  it("un autre joueur ne voit ni ne modifie mes persos hors groupe commun", async () => {
    const owner = await signedIn(env), other = await signedIn(env);
    const ch = (await owner.c.post("/api/characters", druid)).json().character;
    expect((await other.c.get(`/api/characters/${ch.id}`)).statusCode).toBe(404);
    expect((await other.c.patch(`/api/characters/${ch.id}`, { level: 60 })).statusCode).toBe(404);
    expect((await other.c.del(`/api/characters/${ch.id}`)).statusCode).toBe(404);
  });
});

describe("groupes, invitations et raids", () => {
  it("déroule le parcours complet d'une guilde", async () => {
    const gm = await signedIn(env, "Chef"), p1 = await signedIn(env, "Membre"), outsider = await signedIn(env, "Dehors");
    const g = (await gm.c.post("/api/groups", { name: "Les Tournicotis" })).json().group;

    // Invitation : lien montré une fois, jeton dans le fragment
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    expect(inv.url).toMatch(/\/join#/);
    const token = tokenFrom(inv.url);
    expect((await p1.c.post("/api/groups/invites/preview", { token })).json().group.name).toBe("Les Tournicotis");
    expect((await p1.c.post("/api/groups/invites/accept", { token })).json().groupId).toBe(g.id);
    // maxUses = 1 : un second joueur ne peut plus l'utiliser
    expect((await outsider.c.post("/api/groups/invites/accept", { token })).statusCode).toBe(404);

    // Un non-membre ne voit pas le groupe
    expect((await outsider.c.get(`/api/groups/${g.id}`)).statusCode).toBe(404);

    // Les persos des membres sont visibles par le groupe
    const tank = (await p1.c.post("/api/characters", { name: "Tank", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    const cat = (await gm.c.post("/api/characters", druid)).json().character;
    const out = (await outsider.c.post("/api/characters", { name: "Intrus", race: "Human", cls: "Mage", spec1: "Frost" })).json().character;
    const shared = (await gm.c.get(`/api/groups/${g.id}/characters`)).json().characters;
    expect(shared.map((x: { name: string }) => x.name).sort()).toEqual(["Tank", "Tournicoti Tournicoton"]);
    expect((await gm.c.get(`/api/characters/${tank.id}`)).json().editable).toBe(false);

    // Un simple membre ne crée pas de raid
    expect((await p1.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core" })).statusCode).toBe(403);
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: "2026-11-12T20:30:00+01:00" })).json().raid;

    // Composition + couverture des buffs
    const put = await gm.c.put(`/api/groups/${g.id}/raids/${raid.id}`, {
      name: "Molten Core", scheduledAt: null,
      slots: [{ group: 1, pos: 1, characterId: tank.id }, { group: 2, pos: 1, characterId: cat.id }],
    });
    expect(put.statusCode).toBe(200);
    const cov = Object.fromEntries(put.json().coverage.map((x: { id: string }) => [x.id, x]));
    expect(cov.sunder.covered).toBe(true);
    expect(cov.motw.covered).toBe(true);
    expect(cov.bshout.missingGroups).toEqual([2]);
    expect(cov.lotp.missingGroups).toEqual([1]);

    // Règles de composition
    const dup = await gm.c.put(`/api/groups/${g.id}/raids/${raid.id}`, { name: "MC", slots: [{ group: 1, pos: 1, characterId: tank.id }, { group: 1, pos: 1, characterId: cat.id }] });
    expect(dup.statusCode).toBe(400);
    const foreign = await gm.c.put(`/api/groups/${g.id}/raids/${raid.id}`, { name: "MC", slots: [{ group: 1, pos: 1, characterId: out.id }] });
    expect(foreign.statusCode).toBe(400);

    // Promotion en officier puis droits de raid
    expect((await gm.c.patch(`/api/groups/${g.id}/members/${p1.user.id}`, { role: "officer" })).statusCode).toBe(200);
    expect((await p1.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia" })).statusCode).toBe(201);
    // Un officier ne peut pas retirer le propriétaire
    expect((await p1.c.del(`/api/groups/${g.id}/members/${gm.user.id}`)).statusCode).toBe(403);
    // Le propriétaire ne peut pas quitter sans transférer
    expect((await gm.c.del(`/api/groups/${g.id}/members/${gm.user.id}`)).statusCode).toBe(409);

    // Le journal du groupe trace les actions
    const events = (await gm.c.get(`/api/groups/${g.id}/audit`)).json().events.map((e: { type: string }) => e.type);
    expect(events).toEqual(expect.arrayContaining(["group_created", "invite_created", "group_joined", "raid_created", "group_role_changed"]));
  });
});

describe("renommage de groupe", () => {
  it("réservé aux officiers, validé et tracé dans le journal", async () => {
    const gm = await signedIn(env, "Chef"), p1 = await signedIn(env, "Membre"), outsider = await signedIn(env, "Dehors");
    const g = (await gm.c.post("/api/groups", { name: "Ancien nom" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 1, expiresInHours: 24 })).json().invite;
    expect((await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);

    // Un simple membre ne peut pas renommer ; un non-membre ne voit même pas le groupe
    expect((await p1.c.patch(`/api/groups/${g.id}`, { name: "Piraté" })).statusCode).toBe(403);
    expect((await outsider.c.patch(`/api/groups/${g.id}`, { name: "Piraté" })).statusCode).toBe(404);
    // Nom trop court ou trop long
    expect((await gm.c.patch(`/api/groups/${g.id}`, { name: " a " })).statusCode).toBe(400);
    expect((await gm.c.patch(`/api/groups/${g.id}`, { name: "x".repeat(49) })).statusCode).toBe(400);

    const ok = await gm.c.patch(`/api/groups/${g.id}`, { name: "  Les Tournicotis  " });
    expect(ok.statusCode).toBe(200);
    expect((await p1.c.get(`/api/groups/${g.id}`)).json().group.name).toBe("Les Tournicotis");

    // Un officier peut aussi renommer ; renvoyer le même nom ne crée pas d'entrée de journal
    await gm.c.patch(`/api/groups/${g.id}/members/${p1.user.id}`, { role: "officer" });
    expect((await p1.c.patch(`/api/groups/${g.id}`, { name: "Les Tournicotis" })).statusCode).toBe(200);

    const renames = (await gm.c.get(`/api/groups/${g.id}/audit`)).json().events.filter((e: { type: string }) => e.type === "group_renamed");
    expect(renames).toHaveLength(1);
    expect(renames[0].meta).toEqual({ from: "Ancien nom", to: "Les Tournicotis" });
  });
});
