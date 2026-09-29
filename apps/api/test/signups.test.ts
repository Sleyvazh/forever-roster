import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

async function guild() {
  const gm = await signedIn(env, "Chef"), p1 = await signedIn(env, "Druide"), out = await signedIn(env, "Dehors");
  const g = (await gm.c.post("/api/groups", { name: "Les Tournicotis" })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
  const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", description: "Pull à 21 h", scheduledAt: "2026-11-11T20:00:00.000Z" })).json().raid;
  const druid = (await p1.c.post("/api/characters", { name: "Tournicoti", race: "Tauren", cls: "Druid", spec1: "Feral Cat", spec2: "Feral Bear" })).json().character;
  const noClass = (await p1.c.post("/api/characters", { name: "Sans classe" })).json().character;
  return { gm, p1, out, g, raid, druid, noClass, base: `/api/groups/${g.id}/raids/${raid.id}` };
}

describe("inscriptions aux raids", () => {
  it("s'inscrire avec un perso et une spé, puis changer de statut", async () => {
    const { p1, druid, base } = await guild();
    // Spé par défaut : la spé principale du perso
    let r = await p1.c.put(`${base}/signup`, { status: "present", characterId: druid.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().signups[0]).toMatchObject({ displayName: "Druide", characterName: "Tournicoti", cls: "Druid", spec: "Feral Cat", role: "DPS", status: "present", mine: true });
    // Même joueur : mise à jour, pas de doublon
    r = await p1.c.put(`${base}/signup`, { status: "late", characterId: druid.id, spec: "Feral Bear", note: "Arrive vers 21 h 15" });
    expect(r.json().signups).toHaveLength(1);
    expect(r.json().signups[0]).toMatchObject({ spec: "Feral Bear", role: "Tank", status: "late", note: "Arrive vers 21 h 15" });
    // Absent : sans perso
    r = await p1.c.put(`${base}/signup`, { status: "absent" });
    expect(r.json().signups[0]).toMatchObject({ status: "absent", characterId: null });
  });

  it("refuse les inscriptions incohérentes", async () => {
    const { p1, gm, druid, noClass, base } = await guild();
    expect((await p1.c.put(`${base}/signup`, { status: "present" })).statusCode).toBe(400);
    expect((await p1.c.put(`${base}/signup`, { status: "present", characterId: druid.id, spec: "Holy" })).statusCode).toBe(400);
    expect((await p1.c.put(`${base}/signup`, { status: "present", characterId: noClass.id })).statusCode).toBe(400);
    expect((await p1.c.put(`${base}/signup`, { status: "peut-etre", characterId: druid.id })).statusCode).toBe(400);
    // Le perso d'un autre joueur
    expect((await gm.c.put(`${base}/signup`, { status: "present", characterId: druid.id })).statusCode).toBe(400);
  });

  it("réservé aux membres ; les officiers gèrent les inscrits", async () => {
    const { p1, gm, out, g, druid, base } = await guild();
    const outChar = (await out.c.post("/api/characters", { name: "Intrus", race: "Orc", cls: "Warrior" })).json().character;
    expect((await out.c.put(`${base}/signup`, { status: "present", characterId: outChar.id })).statusCode).toBe(404);
    const s = (await p1.c.put(`${base}/signup`, { status: "present", characterId: druid.id })).json().signups[0];

    // Un membre ne peut pas modifier l'inscription d'un autre
    expect((await p1.c.patch(`${base}/signups/${s.id}`, { status: "bench" })).statusCode).toBe(403);
    expect((await gm.c.patch(`${base}/signups/${s.id}`, { status: "bench" })).statusCode).toBe(200);
    const detail = (await gm.c.get(base)).json();
    expect(detail.signups[0]).toMatchObject({ status: "bench", mine: false });
    expect(detail.raid.description).toBe("Pull à 21 h");

    // La liste des raids donne les compteurs et mon statut
    const list = (await p1.c.get(`/api/groups/${g.id}/raids`)).json().raids[0];
    expect(list).toMatchObject({ signups: { bench: 1 }, mySignup: "bench" });

    // Quitter le groupe retire ses inscriptions
    await p1.c.del(`/api/groups/${g.id}/members/${p1.user.id}`);
    expect((await gm.c.get(base)).json().signups).toEqual([]);
  });

  it("la composition utilise la spé choisie à l'inscription", async () => {
    const { p1, gm, druid, base } = await guild();
    await p1.c.put(`${base}/signup`, { status: "present", characterId: druid.id, spec: "Feral Bear" });
    const r = await gm.c.put(base, { name: "Molten Core", slots: [{ group: 1, pos: 1, characterId: druid.id }] });
    expect(r.statusCode).toBe(200);
    // Demoralizing Roar : fourni par un druide en Feral Bear seulement
    expect(r.json().coverage.find((c: { id: string }) => c.id === "demo").covered).toBe(true);
    await p1.c.del(`${base}/signup`);
    expect((await gm.c.get(base)).json().coverage.find((c: { id: string }) => c.id === "demo").covered).toBe(false);
  });
});
