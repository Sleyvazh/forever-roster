import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe("cette semaine", () => {
  it("nouveau compte : rien, et les étapes de démarrage à faire", async () => {
    const { c } = await signedIn(env);
    const w = (await c.get("/api/week")).json();
    expect(w).toEqual({ raids: [], todo: [], steps: { character: false, group: false, addon: false } });
  });

  it("raids de la semaine avec mon inscription, choses à faire", async () => {
    const gm = await signedIn(env, "Chef"), p1 = await signedIn(env, "Druide");
    const g = (await gm.c.post("/api/groups", { name: "Les Veilleurs" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const mc = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: inHours(3) })).json().raid;
    const ony = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia", scheduledAt: inHours(48) })).json().raid;
    await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Plus tard", scheduledAt: inHours(24 * 10) });
    await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Sans date" });
    const druid = (await p1.c.post("/api/characters", { name: "Thalwen", race: "Tauren", cls: "Druid", spec1: "Feral Bear" })).json().character;
    const noSpec = (await p1.c.post("/api/characters", { name: "Korrin", race: "Orc", cls: "Hunter" })).json().character;
    await p1.c.put(`/api/groups/${g.id}/raids/${mc.id}/signup`, { status: "present", characterId: druid.id });

    const w = (await p1.c.get("/api/week")).json();
    expect(w.raids.map((r: { name: string }) => r.name)).toEqual(["Molten Core", "Onyxia"]);
    expect(w.raids[0]).toMatchObject({ groupName: "Les Veilleurs", counts: { coming: 1, tank: 1, heal: 0, dps: 0 }, mine: { status: "present", characterName: "Thalwen" } });
    expect(w.raids[1].mine).toBeNull();
    expect(w.todo).toEqual([
      expect.objectContaining({ kind: "signup", raidId: ony.id, name: "Onyxia" }),
      { kind: "incomplete", characterId: noSpec.id, name: "Korrin", missing: "spé" },
    ]);
    expect(w.steps).toEqual({ character: true, group: true, addon: false });

    // Fiche synchronisée par l'addon : étape cochée
    await p1.c.patch(`/api/characters/${druid.id}`, { addonSynced: true });
    expect((await p1.c.get("/api/week")).json().steps.addon).toBe(true);
    // Un joueur hors du groupe ne voit pas ces raids
    expect((await (await signedIn(env)).c.get("/api/week")).json().raids).toEqual([]);
  });

  it("réservé aux comptes connectés", async () => {
    const res = await env.app.inject({ method: "GET", url: "/api/week" });
    expect(res.statusCode).toBe(401);
  });
});
