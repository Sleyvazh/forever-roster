import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

describe("bilan de raid relevé par l'addon", () => {
  it("officier : enregistre présence et butin, coche le BiS ; présence du groupe", async () => {
    const gm = await signedIn(env, "Officiere"), p1 = await signedIn(env, "Joueuse"), p2 = await signedIn(env, "Absent");
    const g = (await gm.c.post("/api/groups", { name: "Les Bilans" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await p2.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const at = 1_790_000_000;
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: new Date(at * 1000).toISOString() })).json().raid;
    const druid = (await p1.c.post("/api/characters", { name: "Greta Coulé", race: "Tauren", cls: "Druid", spec1: "Feral Bear" })).json().character;
    await p1.c.patch(`/api/characters/${druid.id}`, { gear: { Chest: { bis: "Cenarion Vestments", bisId: 16833 } } });
    const war = (await p2.c.post("/api/characters", { name: "Grumdal", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    const priest = (await gm.c.post("/api/characters", { name: "Sylvae", race: "Undead", cls: "Priest", spec1: "Holy" })).json().character;
    const base = `/api/groups/${g.id}/raids/${raid.id}`;
    await p1.c.put(`${base}/signup`, { status: "present", characterId: druid.id });
    await p2.c.put(`${base}/signup`, { status: "present", characterId: war.id });
    await gm.c.put(`${base}/signup`, { status: "present", characterId: priest.id });

    const log = {
      raidId: raid.id, start: at - 600, end: at + 3 * 3600, recorder: "Sylvae",
      attendees: [{ name: "Greta", first: at - 600, last: at + 3 * 3600, samples: 190 }, { name: "Sylvae", first: at + 1800, last: at + 3 * 3600, samples: 150 }, { name: "Inconnu", first: at, last: at + 600, samples: 10 }],
      loot: [{ itemId: 16833, name: "Greta", at: at + 1200, boss: "Lucifron" }, { itemId: 17063, name: "Inconnu", at: at + 1300, boss: "" }],
    };
    // Un simple membre ne peut pas enregistrer le bilan
    expect((await p1.c.post("/api/raid-logs", log)).statusCode).toBe(403);
    const r = await gm.c.post("/api/raid-logs", log);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ attendees: 3, loot: 2, bis: 1, unknown: ["Inconnu"] });

    const view = (await p1.c.get(base)).json().log;
    expect(view.attendance.map((a: { name: string; status: string }) => `${a.name}:${a.status}`)).toEqual(["Greta Coulé:present", "Sylvae:late", "Inconnu:left", "Grumdal:absent"]);
    expect(view.loot[0]).toMatchObject({ itemId: 16833, name: "Greta Coulé", characterId: druid.id, boss: "Lucifron", bis: true });
    const fiche = (await p1.c.get("/api/characters")).json().characters.find((c: { id: string }) => c.id === druid.id);
    expect(fiche.gear.Chest.got).toBe(true);

    // Un nouveau collage remplace le bilan
    expect((await gm.c.post("/api/raid-logs", { ...log, loot: [] })).json().loot).toBe(0);
    expect((await p1.c.get(base)).json().log.loot).toEqual([]);

    const stats = (await p2.c.get(`/api/groups/${g.id}/attendance`)).json();
    expect(stats.raids).toHaveLength(1);
    const byName = Object.fromEntries(stats.characters.map((c: { name: string }) => [c.name, c]));
    expect(byName["Greta Coulé"]).toMatchObject({ cells: ["present"], attended: 1 });
    expect(byName.Grumdal).toMatchObject({ cells: ["absent"], attended: 0 });
    expect((await (await signedIn(env)).c.get(`/api/groups/${g.id}/attendance`)).statusCode).toBe(404);
  });

  it("refuse un bilan pour un raid inconnu ou mal formé", async () => {
    const { c } = await signedIn(env);
    expect((await c.post("/api/raid-logs", { raidId: "4a1e43ea-54e8-4b49-888f-5e19b5754f61", start: 1, end: 2, recorder: "X", attendees: [], loot: [] })).statusCode).toBe(404);
    expect((await c.post("/api/raid-logs", { raidId: "pas-un-id", start: 1, end: 2, recorder: "X", attendees: [], loot: [] })).statusCode).toBe(400);
  });
});
