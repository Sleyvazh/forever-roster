import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

describe("format du raid, banc, fiche joueur (lot D1)", () => {
  it("format 10/20/40 et rôles visés ; groupes limités au format", async () => {
    const gm = await signedIn(env, "Chef");
    const g = (await gm.c.post("/api/groups", { name: "Formats" })).json().group;
    const tank = (await gm.c.post("/api/characters", { name: "Rempart", race: "Orc", cls: "Warrior", spec1: "Protection", spec2: "Fury" })).json().character;
    await gm.c.put(`/api/groups/${g.id}/characters/${tank.id}`, { assigned: true });
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Karazhan", scheduledAt: inDays(2), size: 10 })).json().raid;
    const r = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json();
    expect(r.raid).toMatchObject({ size: 10, targets: { tank: 2, heal: 3, dps: 5 }, customTargets: false });

    // Groupe 3 interdit à 10 joueurs
    const put = (slots: object[]) => gm.c.put(`/api/groups/${g.id}/raids/${raid.id}`, { name: "Karazhan", scheduledAt: inDays(2), slots });
    expect((await put([{ group: 3, pos: 1, characterId: tank.id }])).json().error).toMatch(/2 groupes au plus/);
    expect((await put([{ group: 2, pos: 1, characterId: tank.id }])).statusCode).toBe(200);

    // Rôles visés personnalisés, puis retour à ceux du format ; passer à 40
    const f = await gm.c.patch(`/api/groups/${g.id}/raids/${raid.id}/format`, { targets: { tank: 1, heal: 3, dps: 6 } });
    expect(f.json()).toMatchObject({ size: 10, targets: { tank: 1, heal: 3, dps: 6 }, customTargets: true });
    expect((await gm.c.patch(`/api/groups/${g.id}/raids/${raid.id}/format`, { size: 40, targets: null })).json()).toMatchObject({ size: 40, targets: { tank: 4, heal: 10, dps: 26 } });
    // Revenir à 10 alors qu'un perso est au groupe 5 : refusé
    await gm.c.put(`/api/groups/${g.id}/raids/${raid.id}`, { name: "Karazhan", scheduledAt: inDays(2), slots: [{ group: 5, pos: 1, characterId: tank.id }] });
    expect((await gm.c.patch(`/api/groups/${g.id}/raids/${raid.id}/format`, { size: 10 })).json().error).toMatch(/groupe 5/);

    // L'officier change la spé d'un inscrit (« Passer en Fury »), avec contrôle de la classe
    await gm.c.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "present", characterId: tank.id });
    const su = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().signups[0];
    expect((await gm.c.patch(`/api/groups/${g.id}/raids/${raid.id}/signups/${su.id}`, { spec: "Holy" })).json().error).toMatch(/n'existe pas/);
    expect((await gm.c.patch(`/api/groups/${g.id}/raids/${raid.id}/signups/${su.id}`, { spec: "Fury" })).statusCode).toBe(200);
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().signups[0].spec).toBe("Fury");
  });

  it("historique du banc et fiche joueur", async () => {
    const gm = await signedIn(env, "Meneur"), p1 = await signedIn(env, "Joueuse");
    const g = (await gm.c.post("/api/groups", { name: "Banc" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const mage = (await p1.c.post("/api/characters", { name: "Givra", race: "Undead", cls: "Mage", spec1: "Frost" })).json().character;
    const alt = (await p1.c.post("/api/characters", { name: "Fennec", race: "Orc", cls: "Hunter", spec1: "Marksmanship" })).json().character;
    await p1.c.put(`/api/groups/${g.id}/characters/${mage.id}`, { assigned: true });
    await p1.c.put(`/api/groups/${g.id}/characters/${alt.id}`, { assigned: true });

    // Deux raids passés : banc puis présent
    const mk = async (name: string, d: number) => (await gm.c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: inDays(d) })).json().raid;
    const r1 = await mk("MC 1", 1), r2 = await mk("MC 2", 2), next = await mk("MC 3", 3);
    await p1.c.put(`/api/groups/${g.id}/raids/${r1.id}/signup`, { status: "present", characterId: mage.id });
    await p1.c.put(`/api/groups/${g.id}/raids/${r2.id}/signup`, { status: "present", characterId: mage.id });
    const su2 = (await gm.c.get(`/api/groups/${g.id}/raids/${r2.id}`)).json().signups[0];
    await gm.c.patch(`/api/groups/${g.id}/raids/${r2.id}/signups/${su2.id}`, { status: "bench" });
    const h = (await gm.c.get(`/api/groups/${g.id}/raids/${next.id}/bench-history`)).json();
    expect(h.raids).toBe(2);
    expect(h.stats[mage.id]).toEqual({ bench: 1, signed: 2, lastBenched: true });

    // Bilan du premier raid : présent + un objet reçu
    await gm.c.post("/api/raid-logs", {
      raidId: r1.id, start: 1000, end: 9000, recorder: "Meneur",
      attendees: [{ name: "Givra", first: 1000, last: 9000, samples: 80 }],
      loot: [{ itemId: 16818, name: "Givra", at: 3000, boss: "Lucifron" }],
    });
    const sheet = (await gm.c.get(`/api/groups/${g.id}/members/${p1.user.id}/sheet`)).json();
    expect(sheet.member).toMatchObject({ displayName: "Joueuse", role: "member" });
    expect(sheet.characters.map((c: { name: string; isMain: boolean }) => `${c.name}${c.isMain ? "*" : ""}`)).toEqual(["Givra*", "Fennec"]);
    expect(sheet.attendance).toMatchObject({ raids: 1, attended: 1 });
    expect(sheet.loot).toEqual([expect.objectContaining({ itemId: 16818, character: "Givra", boss: "Lucifron", raidName: "MC 1" })]);
    // Un non-membre : introuvable
    const out = await signedIn(env, "Dehors");
    expect((await out.c.get(`/api/groups/${g.id}/members/${p1.user.id}/sheet`)).statusCode).toBe(404);
  });
});
