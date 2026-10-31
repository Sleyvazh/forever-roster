import type { GuildBankLogResponse, GuildBankResponse } from "@forever/game-data";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { gameItems, groups, guildBank, guildBankLog, guildBankTabs } from "../src/db/schema";
import { DAY, frl, HOUR, m, NOW, paste, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, signedIn, type TestEnv } from "./helpers";

/**
 * Lot « Banque » (Forever) : relevé de la banque de guilde (lignes B, T, I, X, O du bloc FRL) enregistré par onglet,
 * journaux dédoublonnés, routes de lecture, effacement quand la guilde est déliée. Noms inventés.
 */

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  // Un objet du catalogue ; 13444 et 999999 n'y sont pas
  await db().insert(gameItems).values({ id: 13446, name: "Major Healing Potion", quality: 1, itemLevel: 1, reqLevel: 45, classId: 0, subclassId: 1, inventoryType: 0 });
});
afterAll(async () => { await env.close(); });
afterEach(() => { env.app.ctx.now = undefined; });

const db = () => env.app.ctx.db;
const setNow = (unix: number) => { env.app.ctx.now = () => new Date(unix * 1000); };
const iso = (unix: number) => new Date(unix * 1000).toISOString();

/** Ligne B comme l'addon l'écrit (or en cuivre ; vide : le jeu ne l'a pas dit). */
const B = (at: number, money: number | string, ntabs: number) => `B;${at};Morwen Cendrevoile;${money};${ntabs}`;
/** Guilde du site liée à la guilde du jeu par le premier relevé du propriétaire (officier). */
async function linked(name: string, others: string[] = []) {
  const s = await sceneOf(env, name, others);
  await paste(s.owner, frl({ at: NOW() - DAY, members: [m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0 })] }));
  return s;
}
/** Relevé de banque seul, envoyé par `who` (l'heure de la liste ne compte pas ici). */
const send = (who: Signed, at: number, bank: string[]) => paste(who, frl({ at, bank }));
const bankOf = (s: Awaited<ReturnType<typeof linked>>, who: Signed) => s.get<GuildBankResponse>(who, "/guild/bank");
const logOf = (s: Awaited<ReturnType<typeof linked>>, who: Signed, query: string) => s.get<GuildBankLogResponse>(who, `/guild/bank/log?${query}`);

describe("banque de guilde : enregistrement par onglet", () => {
  it("un membre envoie la banque : or, noms d'onglets, cases dans l'ordre, objets du catalogue seulement", async () => {
    const s = await linked("Les Banquiers", ["Pikou", "Vexou"]);
    const T = NOW() - HOUR;
    const r = await send(s.p.Pikou!, T, [
      B(T, 1234567, 3), "T;1;Consommables;1;1", "T;2;Officiers;1;1", "T;3;Métiers;0;0",
      "I;1;15;13446;20", "I;1;2;999999;3", "I;2;1;13446;1",
    ]);
    expect(r.results[0]).toMatchObject({ status: "updated", message: expect.stringContaining("banque : 2 onglets relevés") });
    const v = await bankOf(s, s.p.Vexou!);
    expect(v.linked).toBe(true);
    expect(v.bank).toMatchObject({ at: iso(T), by: "Morwen Cendrevoile", money: 1234567, moneyAt: iso(T) });
    expect(v.bank!.tabs.map(t => t.name)).toEqual(["Consommables", "Officiers", "Métiers"]);
    // Cases dans l'ordre des cases ; l'onglet que l'envoyeur ne voit pas n'a jamais été relevé
    expect(v.bank!.tabs[0]).toEqual({ tab: 1, name: "Consommables", at: iso(T), by: "Morwen Cendrevoile", slots: [{ slot: 2, id: 999999, n: 3 }, { slot: 15, id: 13446, n: 20 }] });
    expect(v.bank!.tabs[1]).toMatchObject({ tab: 2, slots: [{ slot: 1, id: 13446, n: 1 }] });
    expect(v.bank!.tabs[2]).toEqual({ tab: 3, name: "Métiers", at: null, by: "", slots: [] });
    // Objet du catalogue : nom et qualité ; objet inconnu : dans les cases, pas dans les objets
    expect(v.objects[13446]).toMatchObject({ name: "Major Healing Potion", quality: 1 });
    expect(Object.keys(v.objects)).toEqual(["13446"]);
    expect(v.lastMoney).toEqual([]);
    // Le compte du site qui a envoyé le relevé est noté
    const [row] = await db().select().from(guildBank).where(eq(guildBank.groupId, s.g.id));
    expect(row!.sentBy).toBe(s.p.Pikou!.user.id);
    const tabs = (await db().select().from(guildBankTabs).where(eq(guildBankTabs.groupId, s.g.id))).sort((a, b) => a.tab - b.tab);
    expect(tabs.map(t => t.sentBy)).toEqual([s.p.Pikou!.user.id, s.p.Pikou!.user.id, null]);
  });

  it("onglet pas relu (1;0) ou que l'envoyeur ne voit pas (0;0) : le contenu d'avant est gardé, le nom suit le relevé le plus récent", async () => {
    const s = await linked("Les Gardiens", ["Pikou"]);
    const T = NOW() - 5 * HOUR;
    await send(s.p.Pikou!, T, [B(T, 1000, 2), "T;1;Consommables;1;1", "T;2;Officiers;1;1", "I;1;1;13446;5", "I;2;1;13444;1"]);
    // Une heure plus tard : Officiers visible mais pas relu (banque fermée trop tôt), Consommables a changé
    const T1 = T + HOUR;
    const r = await send(s.p.Pikou!, T1, [B(T1, 900, 2), "T;1;Consommables;1;1", "T;2;Officiers (bis);1;0", "I;1;1;13446;3"]);
    expect(r.results[0]!.message).toContain("banque : 1 onglet relevé");
    let v = await bankOf(s, s.owner);
    expect(v.bank).toMatchObject({ at: iso(T1), money: 900 });
    expect(v.bank!.tabs[0]).toMatchObject({ at: iso(T1), slots: [{ slot: 1, id: 13446, n: 3 }] });
    expect(v.bank!.tabs[1]).toMatchObject({ name: "Officiers (bis)", at: iso(T), slots: [{ slot: 1, id: 13444, n: 1 }] });
    // Encore une heure plus tard : onglet que son rang ne voit pas (0;0), sans cases
    const T2 = T + 2 * HOUR;
    await send(s.p.Pikou!, T2, [B(T2, 900, 2), "T;1;Consommables;1;1", "T;2;Officiers;0;0", "I;1;1;13446;1"]);
    v = await bankOf(s, s.owner);
    expect(v.bank!.tabs[0]).toMatchObject({ at: iso(T2), slots: [{ slot: 1, id: 13446, n: 1 }] });
    expect(v.bank!.tabs[1]).toMatchObject({ name: "Officiers", at: iso(T), slots: [{ slot: 1, id: 13444, n: 1 }] });
  });

  it("relevé plus ancien : or, noms et onglets déjà relevés gardés ; un onglet que le site n'avait jamais lu est pris", async () => {
    const s = await linked("Les Archivistes", ["Pikou"]);
    const T = NOW() - 5 * HOUR;
    await send(s.p.Pikou!, T + HOUR, [B(T + HOUR, 2000, 2), "T;1;Soins;1;1", "T;2;Officiers;1;0", "I;1;1;13446;7"]);
    const r = await send(s.p.Pikou!, T, [B(T, 500, 2), "T;1;Soins (vieux);1;1", "T;2;Officiers;1;0", "I;1;1;13446;1"]);
    expect(r.results[0]!.message).toContain("banque plus ancienne que celle du site (gardée)");
    let v = await bankOf(s, s.owner);
    expect(v.bank).toMatchObject({ at: iso(T + HOUR), money: 2000, moneyAt: iso(T + HOUR) });
    expect(v.bank!.tabs[0]).toMatchObject({ name: "Soins", at: iso(T + HOUR), slots: [{ slot: 1, id: 13446, n: 7 }] });
    expect(v.bank!.tabs[1]).toMatchObject({ at: null, slots: [] });
    // Encore plus ancien, mais il a lu l'onglet 2 que personne n'a relu : c'est son dernier relevé lu
    const T0 = T - HOUR;
    const r0 = await send(s.p.Pikou!, T0, [B(T0, 100, 2), "T;1;Soins;1;0", "T;2;Officiers;1;1", "I;2;5;13444;9"]);
    expect(r0.results[0]!.message).toContain("banque : 1 onglet relevé");
    v = await bankOf(s, s.owner);
    expect(v.bank).toMatchObject({ at: iso(T + HOUR), money: 2000 });
    expect(v.bank!.tabs[0]).toMatchObject({ at: iso(T + HOUR) });
    expect(v.bank!.tabs[1]).toMatchObject({ name: "Officiers", at: iso(T0), slots: [{ slot: 5, id: 13444, n: 9 }] });
  });

  it("moins d'onglets dans un relevé plus récent : les onglets en trop sont effacés, un relevé plus ancien ne les remet pas", async () => {
    const s = await linked("Les Rangeurs", ["Pikou"]);
    const T = NOW() - 5 * HOUR;
    await send(s.p.Pikou!, T, [B(T, 10, 3), "T;1;Un;1;1", "T;2;Deux;1;1", "T;3;Trois;1;1", "I;3;1;13446;1"]);
    expect((await bankOf(s, s.owner)).bank!.tabs).toHaveLength(3);
    await send(s.p.Pikou!, T + HOUR, [B(T + HOUR, 10, 2), "T;1;Un;1;1", "T;2;Deux;1;1"]);
    expect((await bankOf(s, s.owner)).bank!.tabs.map(t => t.name)).toEqual(["Un", "Deux"]);
    expect(await db().$count(guildBankTabs, eq(guildBankTabs.groupId, s.g.id))).toBe(2);
    // Un relevé d'avant, qui avait trois onglets : le troisième n'existe plus
    await send(s.p.Pikou!, T - HOUR, [B(T - HOUR, 10, 3), "T;1;Un;1;1", "T;2;Deux;1;1", "T;3;Trois;1;1", "I;3;1;13446;1"]);
    expect((await bankOf(s, s.owner)).bank!.tabs).toHaveLength(2);
    expect(await db().$count(guildBankTabs, eq(guildBankTabs.groupId, s.g.id))).toBe(2);
  });

  it("heure dans le futur (horloge du PC) : ramenée à maintenant, le relevé suivant passe quand même", async () => {
    const s = await linked("Les Voyageurs", ["Pikou"]);
    const T = NOW() - 2 * HOUR;
    setNow(T + HOUR);
    await send(s.p.Pikou!, T + 3650 * DAY, [B(T + 3650 * DAY, 111, 1), "T;1;Soins;1;1", "I;1;1;13446;1"]);
    expect((await bankOf(s, s.owner)).bank).toMatchObject({ at: iso(T + HOUR), money: 111 });
    setNow(T + 2 * HOUR);
    const r = await send(s.p.Pikou!, T + HOUR + 1800, [B(T + HOUR + 1800, 222, 1), "T;1;Soins;1;1", "I;1;1;13446;2"]);
    expect(r.results[0]!.message).toContain("banque : 1 onglet relevé");
    const v = await bankOf(s, s.owner);
    expect(v.bank).toMatchObject({ at: iso(T + HOUR + 1800), money: 222 });
    expect(Date.parse(v.bank!.at)).toBeLessThanOrEqual(Date.now());
  });

  it("valeurs démesurées : l'enregistrement ne plante pas, les lignes impossibles sont sautées", async () => {
    const s = await linked("Les Fous", ["Pikou"]);
    const T = NOW() - 2 * HOUR;
    const huge = "99999999999999999999";
    const r = await send(s.p.Pikou!, T, [
      B(T, huge, 1), "T;1;Soins;1;1",
      "I;1;1;13446;20", `I;1;2;99999999999;1`, `I;1;3;13446;99999999999`, // objet et quantité hors d'un entier de la base
      "X;1;deposit;Pikou;13446;20;;;3", // la seule ligne valide
      `X;1;deposit;Pikou;13446;20;;;${huge}`, // il y a 10^20 heures : date impossible
      "X;1;deposit;Pikou;13446;20;;;9999999", // il y a plus de mille ans
      "X;1;deposit;Pikou;99999999999;1;;;4", // objet hors d'un entier de la base
      "X;1;withdraw;Vex;13446;99999999999;;;5", // quantité hors d'un entier de la base : sans quantité
      `O;deposit;Kaeldra;${huge};6`, // or démesuré : sans montant
      "O;deposit;Kaeldra;9007199254740991;7", // le plus grand entier sûr
    ]);
    expect(r.results[0]).toMatchObject({ status: "updated" });
    const v = await bankOf(s, s.owner);
    expect(v.bank).toMatchObject({ money: null, moneyAt: null });
    expect(v.bank!.tabs[0]!.slots).toEqual([{ slot: 1, id: 13446, n: 20 }]);
    const items = await logOf(s, s.owner, "kind=items");
    expect(items.moves.map(x => [x.type, x.itemId, x.n, x.tab])).toEqual([["deposit", 13446, 20, 1], ["withdraw", 13446, null, 1]]);
    expect((await logOf(s, s.owner, "kind=money")).money.map(x => [x.type, x.amount])).toEqual([["deposit", null], ["deposit", 9007199254740991]]);
    // Un relevé plus récent avec l'or le plus haut qu'un nombre garde exactement
    const T1 = T + HOUR;
    await send(s.p.Pikou!, T1, [B(T1, 9007199254740991, 1), "T;1;Soins;1;1"]);
    expect((await bankOf(s, s.owner)).bank!.money).toBe(9007199254740991);
  });
});

describe("banque de guilde : journaux", () => {
  const ITEM_LINES = (h: number) => [`X;1;deposit;Pikou;13446;20;;;${3 + h}`, `X;1;withdraw;Vex Ombrelame;13444;5;;;${4 + h}`, `X;2;move;Kaeldra;13446;1;1;2;${6 + h}`];
  const MONEY_LINES = (h: number) => [`O;deposit;Kaeldra;500000;${5 + h}`, `O;repair;Gorrak;123030;${7 + h}`];

  it("journaux dédoublonnés comme le journal de guilde : le même relevé relu une heure plus tard n'ajoute rien", async () => {
    const s = await linked("Les Comptables", ["Pikou"]);
    const T = NOW() - 3 * HOUR;
    const head = (at: number) => [B(at, 5000, 2), "T;1;Consommables;1;0", "T;2;Officiers;1;0"];
    let r = await send(s.p.Pikou!, T, [...head(T), ...ITEM_LINES(0), ...MONEY_LINES(0)]);
    expect(r.results[0]!.message).toContain("journal de la banque : 5 nouveaux mouvements");
    // Une heure plus tard, le jeu dit « il y a » une heure de plus
    r = await send(s.p.Pikou!, T + HOUR, [...head(T + HOUR), ...ITEM_LINES(1), ...MONEY_LINES(1)]);
    expect(r.results[0]!.message).not.toContain("journal de la banque");
    const items = await logOf(s, s.owner, "kind=items");
    expect(items.more).toBe(false);
    expect(items.moves.map(x => [x.type, x.who, x.tab, x.itemId, x.n, x.tab1, x.tab2, x.at])).toEqual([
      ["deposit", "Pikou", 1, 13446, 20, null, null, iso(T - 3 * HOUR)],
      ["withdraw", "Vex Ombrelame", 1, 13444, 5, null, null, iso(T - 4 * HOUR)],
      ["move", "Kaeldra", 2, 13446, 1, 1, 2, iso(T - 6 * HOUR)],
    ]);
    expect(items.objects[13446]).toMatchObject({ name: "Major Healing Potion" });
    expect(items.money).toEqual([]);
    const money = await logOf(s, s.owner, "kind=money");
    expect(money.money.map(x => [x.type, x.who, x.amount, x.at])).toEqual([
      ["deposit", "Kaeldra", 500000, iso(T - 5 * HOUR)],
      ["repair", "Gorrak", 123030, iso(T - 7 * HOUR)],
    ]);
    expect(money.moves).toEqual([]);
    // Deux lignes identiques d'un même relevé sont deux mouvements, et relues elles ne se multiplient pas
    const T2 = NOW() - HOUR;
    const twice = ["X;1;deposit;Pikou;13446;20;;;3", "X;1;deposit;Pikou;13446;20;;;3"];
    const s2 = await linked("Les Jumeaux", ["Pikou"]);
    await send(s2.p.Pikou!, T2, [B(T2, 1, 1), "T;1;Soins;1;0", ...twice]);
    expect((await logOf(s2, s2.owner, "kind=items")).moves).toHaveLength(2);
    await send(s2.p.Pikou!, T2 + 600, [B(T2 + 600, 1, 1), "T;1;Soins;1;0", ...twice]);
    expect((await logOf(s2, s2.owner, "kind=items")).moves).toHaveLength(2);
    expect(await db().$count(guildBankLog, eq(guildBankLog.groupId, s2.g.id))).toBe(2);
  });

  it("journal de l'or paginé : 60 lignes sur deux relevés, 50 puis le reste ; les deux derniers mouvements d'or avec la banque", async () => {
    const s = await linked("Les Tresoriers", ["Pikou"]);
    const T = NOW() - 2 * HOUR;
    // 60 mouvements, un par heure (k = 0 le plus récent, 1 000 + k cuivres) ; le premier relevé, fait 10 h plus tôt, voit k = 10 à 59
    const line = (k: number, h: number) => `O;deposit;Pikou;${1000 + k};${h}`;
    await send(s.p.Pikou!, T - 10 * HOUR, [B(T - 10 * HOUR, 1, 1), "T;1;Soins;1;0", ...Array.from({ length: 50 }, (_, i) => line(i + 10, i))]);
    const r = await send(s.p.Pikou!, T, [B(T, 2, 1), "T;1;Soins;1;0", ...Array.from({ length: 50 }, (_, i) => line(i, i))]);
    expect(r.results[0]!.message).toContain("journal de la banque : 10 nouveaux mouvements");
    expect(await db().$count(guildBankLog, eq(guildBankLog.groupId, s.g.id))).toBe(60);
    const first = await logOf(s, s.owner, "kind=money&limit=50");
    expect(first.money).toHaveLength(50);
    expect(first.more).toBe(true);
    expect(first.money.map(x => x.amount)).toEqual(Array.from({ length: 50 }, (_, k) => 1000 + k));
    const rest = await logOf(s, s.owner, `kind=money&limit=50&before=${encodeURIComponent(first.money.at(-1)!.at)}`);
    expect(rest.money.map(x => x.amount)).toEqual(Array.from({ length: 10 }, (_, k) => 1050 + k));
    expect(rest.more).toBe(false);
    expect((await logOf(s, s.owner, "kind=money&limit=7")).money).toHaveLength(7);
    // Les deux derniers mouvements d'or accompagnent la banque, le plus récent d'abord
    expect((await bankOf(s, s.owner)).lastMoney.map(x => [x.amount, x.who])).toEqual([[1000, "Pikou"], [1001, "Pikou"]]);
    // Bornes de la demande
    for (const q of ["kind=money&limit=0", "kind=money&limit=201", "kind=autre", "kind=money&before=hier"]) expect((await s.owner.c.get(`/api/groups/${s.g.id}/guild/bank/log?${q}`)).statusCode, q).toBe(400);
    expect((await s.owner.c.get(`/api/groups/${s.g.id}/guild/bank/log`)).statusCode).toBe(200);
  });

  it("journal paginé : les lignes de la même heure restent ensemble (« avant » est exclusif)", async () => {
    const s = await linked("Les Horlogers", ["Pikou"]);
    const T = NOW() - HOUR;
    // Trois dépôts la même heure, de part et d'autre de la limite de 2 lignes, puis un plus ancien
    await send(s.p.Pikou!, T, [B(T, 1, 1), "T;1;Soins;1;0", "X;1;deposit;Aa;13446;1;;;1", "X;1;deposit;Bb;13446;2;;;2", "X;1;deposit;Cc;13446;3;;;2", "X;1;deposit;Dd;13446;4;;;2", "X;1;deposit;Ee;13446;5;;;3"]);
    const first = await logOf(s, s.owner, "kind=items&limit=2");
    expect(first.moves.map(x => x.who).sort()).toEqual(["Aa", "Bb", "Cc", "Dd"]);
    expect(first.more).toBe(true);
    const rest = await logOf(s, s.owner, `kind=items&limit=2&before=${encodeURIComponent(first.moves.at(-1)!.at)}`);
    expect(rest.moves.map(x => x.who)).toEqual(["Ee"]);
    expect(rest.more).toBe(false);
    // La limite est atteinte pile sur la dernière heure : rien de plus à montrer
    expect((await logOf(s, s.owner, "kind=items&limit=4")).more).toBe(true);
    expect((await logOf(s, s.owner, "kind=items&limit=5")).more).toBe(false);
  });
});

describe("banque de guilde : accès et lien", () => {
  it("membres seulement, comme la guilde ; Roster (Retail) refusé ; guilde pas liée : rien", async () => {
    const s = await linked("Les Prudents", ["Pikou"]);
    const T = NOW() - HOUR;
    await send(s.p.Pikou!, T, [B(T, 5, 1), "T;1;Soins;1;1", "I;1;1;13446;1"]);
    const outsider = await signedIn(env, "Intrus");
    const base = `/api/groups/${s.g.id}/guild`;
    const known = await outsider.c.get(base);
    expect(known.statusCode).toBeGreaterThanOrEqual(400);
    for (const path of ["/bank", "/bank/log?kind=items"]) {
      const r = await outsider.c.get(`${base}${path}`);
      expect(r.statusCode, path).toBe(known.statusCode);
      expect(r.json().error, path).toBe(known.json().error);
    }
    expect((await s.p.Pikou!.c.get(`${base}/bank`)).statusCode).toBe(200);
    // Guilde liée, banque pas encore relevée
    const empty = await linked("Les Vides");
    expect(await bankOf(empty, empty.owner)).toEqual({ linked: true, bank: null, objects: {}, lastMoney: [] });
    // Guilde pas liée
    const free = await sceneOf(env, "Les Libres");
    expect(await free.get<GuildBankResponse>(free.owner, "/guild/bank")).toEqual({ linked: false, bank: null, objects: {}, lastMoney: [] });
    expect(await free.get<GuildBankLogResponse>(free.owner, "/guild/bank/log?kind=items")).toEqual({ moves: [], money: [], objects: {}, more: false });
    // Roster (Retail)
    await db().update(groups).set({ game: "retail" }).where(eq(groups.id, s.g.id));
    for (const path of ["/bank", "/bank/log?kind=money"]) {
      const r = await s.owner.c.get(`${base}${path}`);
      expect(r.statusCode, path).toBe(400);
      expect(r.json().error).toBe("La guilde du jeu, la Course au 60 et l'accueil sont pour WoW Forever.");
    }
  });

  it("« Délier » efface la banque : onglets, or et journaux", async () => {
    const s = await linked("Les Partants", ["Pikou"]);
    const T = NOW() - HOUR;
    await send(s.p.Pikou!, T, [B(T, 5, 1), "T;1;Soins;1;1", "I;1;1;13446;1", "X;1;deposit;Pikou;13446;1;;;1", "O;deposit;Pikou;100;1"]);
    expect((await bankOf(s, s.owner)).bank).not.toBeNull();
    expect(await db().$count(guildBankLog, eq(guildBankLog.groupId, s.g.id))).toBe(2);
    const del = await s.owner.c.del(`/api/groups/${s.g.id}/guild/link`);
    expect(del.statusCode, del.body).toBe(200);
    expect(await bankOf(s, s.owner)).toEqual({ linked: false, bank: null, objects: {}, lastMoney: [] });
    expect(await db().$count(guildBank, eq(guildBank.groupId, s.g.id))).toBe(0);
    expect(await db().$count(guildBankTabs, eq(guildBankTabs.groupId, s.g.id))).toBe(0);
    expect(await db().$count(guildBankLog, eq(guildBankLog.groupId, s.g.id))).toBe(0);
  });
});
