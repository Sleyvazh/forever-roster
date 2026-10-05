import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gameItems, raids } from "../src/db/schema";
import { ensureRecurringRaids } from "../src/lib/recurring";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  await env.app.ctx.db.insert(gameItems).values([
    { id: 990201, name: "Greater Fire Protection Potion Test", quality: 1, itemLevel: 48, reqLevel: 38, classId: 0, subclassId: 0, inventoryType: 0 },
    { id: 990202, name: "Flask of the Titans Test", quality: 1, itemLevel: 60, reqLevel: 50, classId: 0, subclassId: 0, inventoryType: 0 },
    { id: 990203, name: "Band of Accuria Test", quality: 4, itemLevel: 78, reqLevel: 60, classId: 4, subclassId: 0, inventoryType: 11 },
  ]).onConflictDoNothing();
});
afterAll(async () => { await env.close(); });

const PROFS = { prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 };
const inDays = (d: number) => new Date(Date.now() + d * 86400e3).toISOString();

async function group(name: string) {
  const gm = await signedIn(env, `${name}Chef`), p = await signedIn(env, `${name}Joueur`);
  const g = (await gm.c.post("/api/groups", { name })).json().group;
  const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 3, expiresInHours: 24 })).json().invite;
  await p.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
  const tank = (await gm.c.post("/api/characters", { name: `${name}tank`, race: "Tauren", cls: "Warrior", spec1: "Protection", professions: PROFS })).json().character;
  const rogue = (await p.c.post("/api/characters", { name: `${name}rogue`, race: "Undead", cls: "Rogue", spec1: "Combat", professions: PROFS })).json().character;
  await gm.c.put(`/api/groups/${g.id}/characters/${tank.id}`, { assigned: true, main: true });
  await p.c.put(`/api/groups/${g.id}/characters/${rogue.id}`, { assigned: true, main: true });
  return { gm, p, g, tank, rogue };
}
const newRaid = async (c: Awaited<ReturnType<typeof signedIn>>["c"], g: { id: string }, name: string, days: number, extra: object = {}) =>
  (await c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: inDays(days), ...extra })).json().raid.id as string;

describe("préparation du raid (lot G)", () => {
  it("consommables et fiches de boss : saisis par un officier, repris par le raid suivant du même nom", async () => {
    const { gm, p, g, tank, rogue } = await group("Prepa");
    const r1 = await newRaid(gm.c, g, "Molten Core", 2);
    let prep = (await gm.c.get(`/api/groups/${g.id}/raids/${r1}/prep`)).json();
    // Instance devinée d'après le nom : les 10 boss sont proposés
    expect(prep.prep.instance).toBe("mc");
    expect(prep.known).toHaveLength(10);
    expect(prep.canEdit).toBe(true);

    const body = {
      instance: "mc",
      consumables: [{ itemId: 990201, n: 5, for: "all" }, { itemId: 990202, n: 1, for: "tank" }],
      bosses: [{ name: "Ragnaros", encounterId: 672, npcIds: [11502], rows: [
        { label: "Tank principal", characterIds: [tank.id, "00000000-0000-4000-8000-000000000000"], text: "" },
        { label: "Fils de la flamme", characterIds: [], text: "Groupes 3 et 4" },
        { label: "", characterIds: [], text: "" },
      ] }, { name: "Lucifron", encounterId: 663, npcIds: [12118], rows: [] }],
    };
    expect((await p.c.put(`/api/groups/${g.id}/raids/${r1}/prep`, body)).statusCode).toBe(403);
    const saved = (await gm.c.put(`/api/groups/${g.id}/raids/${r1}/prep`, body)).json().prep;
    // Nom des objets recopié, perso hors du groupe retiré, fiche vide d'un boss connu retirée (une ligne vide reste, en cours de saisie)
    expect(saved.consumables[0]).toEqual({ itemId: 990201, n: 5, for: "all", name: "Greater Fire Protection Potion Test" });
    expect(saved.bosses).toHaveLength(1);
    expect(saved.bosses[0].rows).toEqual([{ label: "Tank principal", characterIds: [tank.id], text: "" }, { label: "Fils de la flamme", characterIds: [], text: "Groupes 3 et 4" }, { label: "", characterIds: [], text: "" }]);
    // Un boss d'un nouveau raid, ajouté à la main, reste même vide
    const custom = (await gm.c.put(`/api/groups/${g.id}/raids/${r1}/prep`, { ...body, bosses: [...body.bosses, { name: "Gardien des failles", encounterId: null, npcIds: [], rows: [] }] })).json().prep;
    expect(custom.bosses.map((b: { name: string }) => b.name)).toEqual(["Ragnaros", "Gardien des failles"]);
    await gm.c.put(`/api/groups/${g.id}/raids/${r1}/prep`, body);

    // Raid suivant du même nom : préparation reprise ; un autre nom : seulement l'instance devinée
    const r2 = await newRaid(gm.c, g, "Molten Core", 9);
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${r2}/prep`)).json().prep).toEqual(saved);
    const r3 = await newRaid(gm.c, g, "BWL semaine 1", 3);
    expect((await gm.c.get(`/api/groups/${g.id}/raids/${r3}/prep`)).json().prep).toEqual({ instance: "bwl", consumables: [], bosses: [] });

    // Qui est prêt : compte de la synchro, puis appel en raid plus récent
    await gm.c.put(`/api/groups/${g.id}/raids/${r1}/signup`, { status: "present", characterId: tank.id });
    await p.c.put(`/api/groups/${g.id}/raids/${r1}/signup`, { status: "present", characterId: rogue.id });
    await gm.c.patch(`/api/characters/${tank.id}`, { addonSynced: true, consumables: { 990201: 6, 990202: 0 } });
    prep = (await p.c.get(`/api/groups/${g.id}/raids/${r1}/prep`)).json();
    expect(prep.canEdit).toBe(false);
    const row = (n: string) => prep.roster.find((x: { name: string }) => x.name === n);
    expect(row("Prepatank")).toMatchObject({ role: "Tank", source: "sync", counts: { 990201: 6, 990202: 0 } });
    expect(row("Preparogue")).toMatchObject({ source: "never", counts: null });

    const now = Math.floor(Date.now() / 1000) + 5;
    const log = await gm.c.post("/api/raid-logs", {
      raidId: r1, start: now - 60, end: now, recorder: "Prepatank", attendees: [{ name: "Prepatank", first: now - 60, last: now, samples: 2 }], loot: [],
      consumableCall: { at: now, by: "Prepatank", counts: [{ name: "Prepatank", items: { 990201: 4, 990202: 1 } }, { name: "Preparogue", items: null }] },
    });
    expect(log.statusCode).toBe(200);
    prep = (await gm.c.get(`/api/groups/${g.id}/raids/${r1}/prep`)).json();
    expect(prep.call).toMatchObject({ by: "Prepatank" });
    expect(prep.roster.find((x: { name: string }) => x.name === "Prepatank")).toMatchObject({ source: "call", counts: { 990201: 4, 990202: 1 } });
    expect(prep.roster.find((x: { name: string }) => x.name === "Preparogue")).toMatchObject({ source: "noaddon", counts: null });

    // Recherche de consommables
    const items = (await gm.c.get("/api/gamedata/items?q=Titans%20Test&kind=consumable")).json().items;
    expect(items.map((i: { id: number }) => i.id)).toEqual([990202]);
  });

  it("conseil du butin choisi pour le raid, export pour l'addon (C, F, T, L), réservations cachées", async () => {
    const { gm, p, g, tank, rogue } = await group("Conseil");
    const r = await newRaid(gm.c, g, "Molten Core", 2, { lootMode: "council" });
    const me = (await gm.c.get("/api/auth/me")).json().user.id;
    expect((await p.c.put(`/api/groups/${g.id}/raids/${r}/council`, { userIds: [me] })).statusCode).toBe(403);
    expect((await gm.c.put(`/api/groups/${g.id}/raids/${r}/council`, { userIds: [me, "00000000-0000-4000-8000-000000000000"] })).json().council).toEqual([me]);
    await gm.c.put(`/api/groups/${g.id}/raids/${r}/prep`, {
      instance: "mc", consumables: [{ itemId: 990202, n: 1, for: "tank" }],
      bosses: [{ name: "Ragnaros", encounterId: 672, npcIds: [11502], rows: [{ label: "Tank principal", characterIds: [tank.id], text: "" }] }],
    });
    const text: string = (await p.c.get(`/api/groups/${g.id}/addon-export`)).json().text;
    const lines = text.split("\n");
    expect(lines).toContain(`C;${r};990202;1;tank;Flask of the Titans Test`);
    expect(lines).toContain(`F;${r};1;672;11502;Ragnaros`);
    expect(lines).toContain(`T;${r};1;Tank principal;Conseiltank;`);
    expect(lines).toContain(`L;${r};Conseiltank`);
    expect(lines.some(l => l.startsWith(`I;${r};`))).toBe(false); // personne d'inscrit
    await p.c.put(`/api/groups/${g.id}/raids/${r}/signup`, { status: "present", characterId: rogue.id });
    expect((await p.c.get(`/api/groups/${g.id}/addon-export`)).json().text.split("\n")).toContain(`I;${r};Conseilrogue;DPS;melee`);

    // Soft reserve cachée : un membre ne reçoit que ses réservations dans l'export, un officier toutes
    const sr = await newRaid(gm.c, g, "Onyxia", 4, { lootMode: "softres", srHidden: true });
    await p.c.put(`/api/groups/${g.id}/raids/${sr}/soft-reserves`, { characterId: rogue.id, itemId: 990203 });
    await gm.c.put(`/api/groups/${g.id}/raids/${sr}/soft-reserves`, { characterId: tank.id, itemId: 990203 });
    const reserve = (t: string) => t.split("\n").find(l => l.startsWith(`S;${sr};`));
    expect(reserve((await p.c.get(`/api/groups/${g.id}/addon-export`)).json().text)).toBe(`S;${sr};990203;Conseilrogue:0`);
    expect(reserve((await gm.c.get(`/api/groups/${g.id}/addon-export`)).json().text)?.split(";")[3]?.split(",").sort()).toEqual(["Conseilrogue:0", "Conseiltank:0"]);

    // Les raids récurrents reprennent aussi la préparation (et le conseil) du dernier raid du même nom
    const t = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: inDays(5), lootMode: "council", weekly: { leadDays: 14 } })).json();
    expect(t.raid.id).toBeTruthy();
    await ensureRecurringRaids(env.app.ctx.db, new Date());
    const generated = await env.app.ctx.db.select({ prep: raids.prep, council: raids.council, templateId: raids.templateId }).from(raids).where(eq(raids.groupId, g.id));
    const fromTemplate = generated.filter(x => x.templateId);
    expect(fromTemplate.length).toBeGreaterThan(1);
    for (const x of fromTemplate) { expect(x.prep.consumables).toHaveLength(1); expect(x.council).toEqual([me]); }
  });
});
