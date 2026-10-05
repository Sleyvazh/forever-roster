import { zonedParts } from "@forever/game-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

describe("un perso = un groupe (lot E)", () => {
  it("changer de groupe le retire de l'ancien (main remplacé), les inscriptions restent", async () => {
    const p = await signedIn(env, "Rangeur");
    const a = (await p.c.post("/api/groups", { name: "Guilde" })).json().group;
    const b = (await p.c.post("/api/groups", { name: "Pick-up" })).json().group;
    const mk = async (name: string) => (await p.c.post("/api/characters", { name, race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    const one = await mk("Rempart"), two = await mk("Brisecrane");
    await p.c.put(`/api/groups/${a.id}/characters/${one.id}`, { assigned: true });
    await p.c.put(`/api/groups/${a.id}/characters/${two.id}`, { assigned: true });
    const raid = (await p.c.post(`/api/groups/${a.id}/raids`, { name: "MC", scheduledAt: inDays(2) })).json().raid;
    await p.c.put(`/api/groups/${a.id}/raids/${raid.id}/signup`, { status: "present", characterId: one.id });

    // Rempart (main de Guilde) passe dans Pick-up : Brisecrane devient main de Guilde
    expect((await p.c.put(`/api/groups/${b.id}/characters/${one.id}`, { assigned: true })).statusCode).toBe(200);
    const list = (await p.c.get("/api/characters")).json().characters;
    const g = (n: string) => list.find((c: { name: string }) => c.name === n).group;
    expect(g("Rempart")).toMatchObject({ id: b.id, name: "Pick-up", isMain: true });
    expect(g("Brisecrane")).toMatchObject({ id: a.id, isMain: true });
    // Son inscription au raid de Guilde reste
    expect((await p.c.get(`/api/groups/${a.id}/raids/${raid.id}`)).json().signups[0]).toMatchObject({ characterId: one.id, status: "present" });

    // S'inscrire dans Guilde avec un perso rangé dans Pick-up : refusé ; un perso sans groupe y entre
    const raid2 = (await p.c.post(`/api/groups/${a.id}/raids`, { name: "BWL", scheduledAt: inDays(3) })).json().raid;
    expect((await p.c.put(`/api/groups/${a.id}/raids/${raid2.id}/signup`, { status: "present", characterId: one.id })).json().error).toMatch(/rangé dans « Pick-up »/);
    const free = await mk("Libre");
    expect((await p.c.put(`/api/groups/${a.id}/raids/${raid2.id}/signup`, { status: "present", characterId: free.id })).statusCode).toBe(200);
    expect((await p.c.get("/api/characters")).json().characters.find((c: { name: string }) => c.name === "Libre").group).toMatchObject({ id: a.id, isMain: false });
    // Sortir du groupe : « Aucun groupe »
    await p.c.put(`/api/groups/${a.id}/characters/${free.id}`, { assigned: false });
    expect((await p.c.get("/api/characters")).json().characters.find((c: { name: string }) => c.name === "Libre").group).toBeNull();
  });

  it("un officier retire toujours le perso d'un membre", async () => {
    const gm = await signedIn(env, "Chef"), m = await signedIn(env, "Membre");
    const g = (await gm.c.post("/api/groups", { name: "Retrait" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 2, expiresInHours: 24 })).json().invite;
    await m.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const c = (await m.c.post("/api/characters", { name: "Fennec", race: "Orc", cls: "Hunter", spec1: "Marksmanship" })).json().character;
    await m.c.put(`/api/groups/${g.id}/characters/${c.id}`, { assigned: true });
    expect((await gm.c.put(`/api/groups/${g.id}/characters/${c.id}`, { assigned: false })).statusCode).toBe(200);
    expect((await m.c.get("/api/characters")).json().characters[0].group).toBeNull();
  });
});

describe("onglet Raids (lot E)", () => {
  it("« Chaque semaine » crée aussi le raid récurrent ; la liste donne rôles et butin", async () => {
    const p = await signedIn(env, "Organisateur");
    const g = (await p.c.post("/api/groups", { name: "Hebdo" })).json().group;
    const tank = (await p.c.post("/api/characters", { name: "Bouclier", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;
    expect((await p.c.post(`/api/groups/${g.id}/raids`, { name: "ZG", weekly: { leadDays: 7 } })).json().error).toMatch(/date du premier raid/);
    const at = new Date(Date.now() + 3 * 86400e3); at.setUTCHours(18, 30, 0, 0);
    const r = (await p.c.post(`/api/groups/${g.id}/raids`, { name: "ZG", scheduledAt: at.toISOString(), size: 20, lootMode: "council", weekly: { leadDays: 7 } })).json().raid;
    const t = (await p.c.get(`/api/groups/${g.id}/raid-templates`)).json().templates;
    const z = zonedParts(at);
    const time = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
    expect(t).toEqual([expect.objectContaining({ name: "ZG", leadDays: 7, size: 20, lootMode: "council", time, weekday: z.weekday })]);
    await p.c.put(`/api/groups/${g.id}/raids/${r.id}/signup`, { status: "present", characterId: tank.id });
    const raids = (await p.c.get(`/api/groups/${g.id}/raids`)).json().raids;
    // Le premier raid est rattaché au modèle (pas de doublon à la même heure)
    expect(raids.filter((x: { scheduledAt: string }) => x.scheduledAt === at.toISOString())).toHaveLength(1);
    expect(raids.find((x: { id: string }) => x.id === r.id)).toMatchObject({ recurring: true, lootMode: "council", roles: { Tank: 1, Heal: 0, DPS: 0 } });
  });
});
