import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gameItems, lootCatalog } from "../src/db/schema";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  const item = (id: number, name: string, quality = 4) => ({ id, name, quality, itemLevel: 66, reqLevel: 60, classId: 4, subclassId: 1, inventoryType: 20 });
  await env.app.ctx.db.insert(gameItems).values([item(91001, "Robe of Volatile Power"), item(91002, "Wristguards of Stability"), item(91003, "Talisman of Ephemeral Power"), item(91004, "Linen Cloth", 1)])
    .onConflictDoNothing();
});
afterAll(async () => { await env.close(); });

const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

describe("butin : mode du raid et soft reserve (lot C2)", () => {
  it("mode choisi à la création, réservations limitées, cachées au choix, SR+ et catalogue appris", async () => {
    const gm = await signedIn(env, "Organisatrice"), p1 = await signedIn(env, "Mage"), p2 = await signedIn(env, "Demoniste");
    const g = (await gm.c.post("/api/groups", { name: "Butin" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    for (const p of [p1, p2]) await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const greta = (await p1.c.post("/api/characters", { name: "Greta", race: "Undead", cls: "Mage", spec1: "Frost" })).json().character;
    const kae = (await p2.c.post("/api/characters", { name: "Kaelys", race: "Undead", cls: "Warlock", spec1: "Affliction" })).json().character;

    // Réglages du groupe : réservés aux officiers
    expect((await p1.c.put(`/api/groups/${g.id}/loot-settings`, { srCount: 1 })).statusCode).toBe(403);
    expect((await gm.c.put(`/api/groups/${g.id}/loot-settings`, { srCount: 1, srPlusStep: 10 })).json().settings).toMatchObject({ srCount: 1, srPlus: true, srPlusStep: 10 });

    // Raid passé en soft reserve, avec un bilan : Greta avait réservé la robe sans l'avoir
    const old = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: inDays(2), lootMode: "softres" })).json().raid;
    await p1.c.put(`/api/groups/${g.id}/raids/${old.id}/soft-reserves`, { characterId: greta.id, itemId: 91001 });
    // Le raid est maintenant passé (on recule sa date) et son bilan est collé
    await env.app.ctx.db.execute(`update raids set scheduled_at = now() - interval '7 days' where id = '${old.id}'`);
    const log = await gm.c.post("/api/raid-logs", {
      raidId: old.id, start: 1000, end: 9000, recorder: "Orga", instance: "Molten Core",
      attendees: [{ name: "Greta", first: 1000, last: 9000, samples: 80 }],
      loot: [{ itemId: 91002, name: "Kaelys", at: 3000, boss: "Garr", method: "sr", detail: "jet 87" }],
    });
    expect(log.statusCode).toBe(200);

    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "molten core", scheduledAt: inDays(3), lootMode: "softres", srHidden: true })).json().raid;
    const r = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}`)).json().raid;
    expect(r).toMatchObject({ lootMode: "softres", srHidden: true });

    // Catalogue appris par le bilan (même instance, nom normalisé) + recherche libre (rares et mieux)
    const opts = (await p1.c.get(`/api/groups/${g.id}/raids/${raid.id}/loot-options?q=wrist`)).json();
    expect(opts.catalog).toEqual([expect.objectContaining({ id: 91002, boss: "Garr", seen: 1 })]);
    const search = (await p1.c.get(`/api/groups/${g.id}/raids/${raid.id}/loot-options?q=Robe`)).json();
    expect(search.search.map((x: { id: number }) => x.id)).toEqual([91001]);
    expect((await p1.c.get(`/api/groups/${g.id}/raids/${raid.id}/loot-options?q=Linen`)).json().search).toEqual([]);
    // Recoller le même bilan ne recompte pas
    await gm.c.post("/api/raid-logs", { raidId: old.id, start: 1000, end: 9000, recorder: "Orga", instance: "Molten Core", attendees: [], loot: [{ itemId: 91002, name: "Kaelys", at: 3000, boss: "Garr" }] });
    const cat = await env.app.ctx.db.select().from(lootCatalog);
    expect(cat.find(c => c.itemId === 91002)?.seen).toBe(1);

    // Réservations : la mienne, dans la limite ; pas avec le perso d'un autre
    const put = (c: typeof p1.c, characterId: string, itemId: number) => c.put(`/api/groups/${g.id}/raids/${raid.id}/soft-reserves`, { characterId, itemId });
    expect((await put(p1.c, kae.id, 91001)).statusCode).toBe(403);
    const mine = (await put(p1.c, greta.id, 91001)).json();
    expect(mine.items[0]).toMatchObject({ item: { id: 91001 }, reservers: [expect.objectContaining({ name: "Greta", mine: true, bonus: 10 })] });
    expect((await put(p1.c, greta.id, 91002)).json().error).toMatch(/Déjà 1 réservation/);
    await put(p2.c, kae.id, 91001);

    // Cachées jusqu'à la fermeture : chacun ne voit que les siennes, l'officier voit tout
    const seenByP1 = (await p1.c.get(`/api/groups/${g.id}/raids/${raid.id}/soft-reserves`)).json();
    expect(seenByP1).toMatchObject({ hidden: true, total: 2 });
    expect(seenByP1.items[0].reservers.map((x: { name: string }) => x.name)).toEqual(["Greta"]);
    const seenByGm = (await gm.c.get(`/api/groups/${g.id}/raids/${raid.id}/soft-reserves`)).json();
    expect(seenByGm.items[0].reservers.map((x: { name: string }) => x.name).sort()).toEqual(["Greta", "Kaelys"]);

    // Réserver fait entrer le perso dans le groupe
    expect((await gm.c.get(`/api/groups/${g.id}/characters`)).json().characters.map((c: { name: string }) => c.name).sort()).toEqual(["Greta", "Kaelys"]);

    // Export pour l'addon : mode, réservations avec SR+, conseil
    const frg = (await gm.c.get(`/api/groups/${g.id}/addon-export`)).json().text as string;
    expect(frg).toMatch(new RegExp(`\\nR;${raid.id};\\d+;molten core;;;softres`));
    expect(frg).toContain(`\nS;${raid.id};91001;`);
    expect(frg).toMatch(/Greta:10/);

    // Retirer : la sienne ; un membre ne retire pas celle d'un autre
    expect((await p1.c.del(`/api/groups/${g.id}/raids/${raid.id}/soft-reserves?characterId=${kae.id}&itemId=91001`)).statusCode).toBe(403);
    expect((await p1.c.del(`/api/groups/${g.id}/raids/${raid.id}/soft-reserves?characterId=${greta.id}&itemId=91001`)).statusCode).toBe(200);

    // Fermé : plus de réservation
    await env.app.ctx.db.execute(`update raids set scheduled_at = now() + interval '30 minutes' where id = '${raid.id}'`);
    expect((await put(p1.c, greta.id, 91001)).json().error).toMatch(/fermées/);
    // Hors soft reserve : refusé
    const journal = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia", scheduledAt: inDays(4) })).json().raid;
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${journal.id}`)).json().raid.lootMode).toBe("journal");
    expect((await p1.c.put(`/api/groups/${g.id}/raids/${journal.id}/soft-reserves`, { characterId: greta.id, itemId: 91001 })).json().error).toMatch(/pas en soft reserve/);
  });
});
