import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

type Row = { name: string; own: number; player: number; count: number };
const DAY = 86400;

describe("compte des objets reçus (lot I)", () => {
  it("période, spé principale, joueur ou perso, exclusions, corrections, export pour l'addon", async () => {
    const gm = await signedIn(env, "Comptable"), p1 = await signedIn(env, "Greta"), p2 = await signedIn(env, "Grum");
    const g = (await gm.c.post("/api/groups", { name: "Les Comptes" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await p2.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const now = Math.floor(Date.now() / 1000);
    const greta = (await p1.c.post("/api/characters", { name: "Greta Coulé", race: "Tauren", cls: "Druid", spec1: "Feral Bear" })).json().character;
    const brindille = (await p1.c.post("/api/characters", { name: "Brindille", race: "Undead", cls: "Priest", spec1: "Holy" })).json().character;
    const grumdal = (await p2.c.post("/api/characters", { name: "Grumdal", race: "Orc", cls: "Warrior", spec1: "Protection" })).json().character;

    const raidAt = async (at: number, name: string, signups: [typeof p1, string][], loot: object[]) => {
      const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name, scheduledAt: new Date(at * 1000).toISOString() })).json().raid;
      for (const [p, characterId] of signups) await p.c.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "present", characterId });
      const r = await gm.c.post("/api/raid-logs", { raidId: raid.id, start: at, end: at + 3 * 3600, recorder: "Comptable", attendees: [], loot });
      expect(r.statusCode).toBe(200);
      return { raid, loot };
    };
    // Il y a 40 jours : soft reserve (compte), jet OS (ne compte pas), conseil BiS (compte)
    const old = await raidAt(now - 40 * DAY, "Molten Core", [[p1, greta.id], [p2, grumdal.id]], [
      { itemId: 16833, name: "Greta", at: now - 40 * DAY + 600, boss: "Lucifron", method: "sr", detail: "61 +20 = 81" },
      { itemId: 16834, name: "Greta", at: now - 40 * DAY + 700, boss: "Lucifron", method: "roll", detail: "OS 54" },
      { itemId: 16866, name: "Grumdal", at: now - 40 * DAY + 800, boss: "Magmadar", method: "council", response: "bis" },
    ]);
    // Il y a 2 jours : conseil Upgrade sur l'alt, Off-Spec (non), jet MS (oui), objet du journal (oui)
    const recent = await raidAt(now - 2 * DAY, "Molten Core", [[p1, brindille.id], [p2, grumdal.id]], [
      { itemId: 16811, name: "Brindille", at: now - 2 * DAY + 600, boss: "Lucifron", method: "council", response: "upgrade" },
      { itemId: 16812, name: "Grumdal", at: now - 2 * DAY + 700, boss: "Gehennas", method: "council", response: "off" },
      { itemId: 16813, name: "Grumdal", at: now - 2 * DAY + 800, boss: "Garr", method: "roll", detail: "MS 80" },
      { itemId: 16814, name: "Greta", at: now - 2 * DAY + 900, boss: "Garr" },
    ]);
    // Brindille entre dans le groupe en s'inscrivant (alt de Greta)
    const counts = async () => {
      const r = (await p2.c.get(`/api/groups/${g.id}/loot-counts`)).json();
      return { ...r, by: Object.fromEntries(r.rows.map((x: Row) => [x.name, x])) as Record<string, Row> };
    };

    // Par défaut : saison sans début (tout l'historique), par joueur
    let c = await counts();
    expect(c.summary).toMatchObject({ mode: "season", by: "player", label: "depuis le début", short: "saison", raids: 2 });
    expect(c.by["Greta Coulé"]).toMatchObject({ own: 2, player: 3, count: 3 });
    expect(c.by.Brindille).toMatchObject({ own: 1, player: 3, count: 3 });
    expect(c.by.Grumdal).toMatchObject({ own: 2, player: 2, count: 2 });

    // Bilan du raid : ce qui ne compte pas d'office
    const view = (await p1.c.get(`/api/groups/${g.id}/raids/${recent.raid.id}`)).json().log;
    expect(view.loot.map((l: { itemId: number; skip: string | null; excluded: boolean }) => [l.itemId, l.skip, l.excluded]))
      .toEqual([[16811, null, false], [16812, "Off-Spec", false], [16813, null, false], [16814, null, false]]);

    // Exclusion par un officier (pas par un membre), gardée par un nouveau collage du bilan
    const excl = { itemId: 16814, name: "Greta Coulé", at: now - 2 * DAY + 900, excluded: true };
    expect((await p1.c.put(`/api/groups/${g.id}/raids/${recent.raid.id}/loot-exclusions`, excl)).statusCode).toBe(403);
    expect((await gm.c.put(`/api/groups/${g.id}/raids/${recent.raid.id}/loot-exclusions`, { ...excl, at: 1 })).statusCode).toBe(404);
    expect((await gm.c.put(`/api/groups/${g.id}/raids/${recent.raid.id}/loot-exclusions`, excl)).json()).toEqual({ excluded: true });
    await gm.c.post("/api/raid-logs", { raidId: recent.raid.id, start: now - 2 * DAY, end: now - 2 * DAY + 3 * 3600, recorder: "Comptable", attendees: [], loot: recent.loot });
    c = await counts();
    expect(c.by["Greta Coulé"]).toMatchObject({ own: 1, player: 2 });
    expect((await p1.c.get(`/api/groups/${g.id}/raids/${recent.raid.id}`)).json().log.loot[3]).toMatchObject({ itemId: 16814, excluded: true });

    // Correction manuelle : motif obligatoire, officiers seulement, visible de tout le groupe
    const corr = { characterId: greta.id, delta: 1, note: "donné hors addon" };
    expect((await p1.c.post(`/api/groups/${g.id}/loot-corrections`, corr)).statusCode).toBe(403);
    expect((await gm.c.post(`/api/groups/${g.id}/loot-corrections`, { ...corr, note: "" })).statusCode).toBe(400);
    expect((await gm.c.post(`/api/groups/${g.id}/loot-corrections`, { ...corr, delta: 0 })).statusCode).toBe(400);
    const made = await gm.c.post(`/api/groups/${g.id}/loot-corrections`, corr);
    expect(made.statusCode).toBe(201);
    c = await counts();
    expect(c.by["Greta Coulé"]).toMatchObject({ own: 2, player: 3 });
    expect(c.corrections).toMatchObject([{ name: "Greta Coulé", delta: 1, note: "donné hors addon", by: "Comptable" }]);

    // Par perso : chacun son compte
    await gm.c.put(`/api/groups/${g.id}/loot-settings`, { countBy: "character" });
    c = await counts();
    expect([c.by["Greta Coulé"]!.count, c.by.Brindille!.count, c.by.Grumdal!.count]).toEqual([2, 1, 2]);

    // 30 derniers jours, puis le dernier raid : le raid d'il y a 40 jours ne compte plus
    await gm.c.put(`/api/groups/${g.id}/loot-settings`, { countBy: "player", countMode: "days" });
    c = await counts();
    expect(c.summary).toMatchObject({ label: "sur les 30 derniers jours", short: "30 j", raids: 1 });
    expect([c.by["Greta Coulé"]!.count, c.by.Grumdal!.count]).toEqual([2, 1]);
    await gm.c.put(`/api/groups/${g.id}/loot-settings`, { countMode: "raids", countRaids: 1 });
    c = await counts();
    expect(c.summary).toMatchObject({ label: "sur le dernier raid", short: "1 raids", raids: 1 });
    expect([c.by["Greta Coulé"]!.count, c.by.Grumdal!.count]).toEqual([2, 1]);

    // Nouvelle saison aujourd'hui : il ne reste que la correction (faite aujourd'hui)
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
    expect((await gm.c.put(`/api/groups/${g.id}/loot-settings`, { countMode: "season", seasonStart: "2026-02-31" })).statusCode).toBe(400);
    expect((await p1.c.put(`/api/groups/${g.id}/loot-settings`, { seasonStart: today })).statusCode).toBe(403);
    await gm.c.put(`/api/groups/${g.id}/loot-settings`, { countMode: "season", seasonStart: today });
    c = await counts();
    expect(c.summary.raids).toBe(0);
    expect([c.by["Greta Coulé"]!.count, c.by.Grumdal!.count]).toEqual([1, 0]);

    // Export pour l'addon : ligne N (persos d'un même joueur ensemble, main d'abord)
    await gm.c.put(`/api/groups/${g.id}/loot-settings`, { seasonStart: null });
    const text = (await p1.c.get(`/api/groups/${g.id}/addon-export`)).json().text as string;
    const n = text.split("\n").find(l => l.startsWith("N;"))!;
    expect(n.split(";").slice(0, 3)).toEqual(["N", "saison", "depuis le début"]);
    const entries = n.split(";")[3]!.split(",");
    expect(entries).toContain("Grumdal:2");
    expect(entries.some(e => e === "Greta+Brindille:3" || e === "Brindille+Greta:3")).toBe(true);

    // Fiche du joueur : compte, corrections, objets comptés ou non
    const sheet = (await p2.c.get(`/api/groups/${g.id}/members/${p1.user.id}/sheet`)).json();
    expect(sheet.lootCount).toMatchObject({ player: 3, label: "depuis le début" });
    expect(sheet.lootCount.corrections).toMatchObject([{ delta: 1, note: "donné hors addon", inPeriod: true }]);
    expect(sheet.loot.find((l: { itemId: number }) => l.itemId === 16834)).toMatchObject({ skip: "jet OS", excluded: false });

    // Suppression d'une correction
    expect((await gm.c.del(`/api/groups/${g.id}/loot-corrections/${made.json().correction.id}`)).statusCode).toBe(200);
    expect((await counts()).by["Greta Coulé"]!.player).toBe(2);
    // Présence : colonne des objets comptés
    const att = (await p2.c.get(`/api/groups/${g.id}/attendance`)).json();
    expect(att.count).toMatchObject({ short: "saison" });
    expect(att.characters.find((x: { name: string }) => x.name === "Grumdal")).toMatchObject({ counted: 2, loot: 3 });
    expect(old.raid.id).toBeTruthy();
  });
});
