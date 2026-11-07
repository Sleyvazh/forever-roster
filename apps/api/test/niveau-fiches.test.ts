import { atTime, outingDays } from "@forever/game-data";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { characters } from "../src/db/schema";
import { frc, frl, HOUR, m, NOW, paste, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, type TestEnv } from "./helpers";

/**
 * Niveau des fiches relevé en jeu (7/11, Necko s'était mis 60 à la main) : une fiche rangée dans une guilde liée, rapprochée
 * d'un perso de la liste du jeu (GUID de l'addon, nom complet, prénom unique), prend son niveau à chaque relevé et son
 * joueur ne le change plus ; une fiche introuvable peut avoir un niveau fixé par un officier. Noms inventés.
 */

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
const db = () => env.app.ctx.db;

type Lock = { by: "game"; name: string; level: number; at: string | null } | { by: "officer"; name: string; at: string | null } | null;
interface Fiche { id: string; name: string; level: number; levelLock: Lock }
const iso = (unix: number) => new Date(unix * 1000).toISOString();

async function scene(name: string) {
  const s = await sceneOf(env, name, ["Necko", "Pikou", "Vex"]);
  await s.promote("Vex");
  /** Fiche créée par son joueur et rangée dans la guilde. */
  const fiche = async (who: Signed, n: string, level: number, cls = "Rogue", race = "Orc") => {
    const c = (await who.c.post("/api/characters", { name: n, cls, race, level })).json().character as { id: string };
    const r = await who.c.put(`/api/groups/${s.g.id}/characters/${c.id}`, { assigned: true });
    expect(r.statusCode, r.body).toBe(200);
    return c.id;
  };
  const row = async (id: string) => (await db().select().from(characters).where(eq(characters.id, id)))[0]!;
  const level = async (id: string) => (await row(id)).level;
  const mine = async (who: Signed, id: string) => ((await who.c.get("/api/characters")).json().characters as Fiche[]).find(c => c.id === id)!;
  const inGuild = async (who: Signed, id: string) => ((await who.c.get(`/api/groups/${s.g.id}/characters`)).json().characters as Fiche[]).find(c => c.id === id)!;
  const fix = (who: Signed, id: string, lv: number) => who.c.put(`/api/groups/${s.g.id}/characters/${id}/level`, { level: lv });
  const release = (who: Signed, id: string) => who.c.del(`/api/groups/${s.g.id}/characters/${id}/level`);
  const journal = async () => ((await s.owner.c.get(`/api/groups/${s.g.id}/audit`)).json().events as { type: string; actor: string; meta: Record<string, unknown> }[]);
  return { ...s, fiche, row, level, mine, inGuild, fix, release, journal };
}

describe("niveau des fiches : relevé en jeu", () => {
  it("le relevé impose le niveau du jeu aux fiches rapprochées (prénom seul, nom complet), le verrouille et le suit", async () => {
    const s = await scene("Les Niveaux");
    const necko = await s.fiche(s.p.Necko!, "Necko", 60);
    const zelie = await s.fiche(s.p.Pikou!, "zelie ombrelune", 50, "Priest", "Troll");
    const twin = await s.fiche(s.p.Pikou!, "Pikou", 40, "Mage", "Troll");
    const nb = m("Necko Brisefer", 34);
    const T = NOW() - HOUR;
    await paste(s.owner, frl({ at: T, members: [m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0 }), nb, m("Zélie Ombrelune", 22), m("Pikou Patacuivre", 19), m("Pikou Ventlourd", 12)] }));
    expect(await s.level(necko)).toBe(34);
    expect(await s.level(zelie)).toBe(22);
    expect(await s.level(twin)).toBe(40); // deux Pikou en jeu : pas de rapprochement
    expect((await s.mine(s.p.Necko!, necko)).levelLock).toEqual({ by: "game", name: "Necko Brisefer", level: 34, at: iso(T) });
    expect((await s.inGuild(s.p.Vex!, necko)).levelLock).toMatchObject({ by: "game", level: 34 });
    expect((await s.mine(s.p.Pikou!, twin)).levelLock).toBeNull();

    // Le joueur ne le change plus, même par l'API ; le reste de la fiche, si
    const r = await s.p.Necko!.c.patch(`/api/characters/${necko}`, { level: 60 });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("Le niveau de Necko suit le jeu : Necko Brisefer est niveau 34 dans la liste de guilde.");
    const ok = await s.p.Necko!.c.patch(`/api/characters/${necko}`, { level: 34, spec1: "Combat" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().character.levelLock).toMatchObject({ by: "game" });

    // Relevé suivant : le niveau suit le jeu
    await paste(s.owner, frl({ at: T + 600, members: [{ ...nb, level: 36 }] }));
    expect(await s.level(necko)).toBe(36);

    // Renommée en un nom que la liste ne connaît pas : plus de rapprochement ; renommée en arrière : le jeu reprend la main
    await s.p.Necko!.c.patch(`/api/characters/${necko}`, { name: "Neckox" });
    expect((await s.mine(s.p.Necko!, necko)).levelLock).toBeNull();
    await s.p.Necko!.c.patch(`/api/characters/${necko}`, { level: 50 });
    await s.p.Necko!.c.patch(`/api/characters/${necko}`, { name: "Necko" });
    expect(await s.level(necko)).toBe(36);
  });

  it("l'export de l'addon du joueur, plus récent que la liste et plus haut, est gardé", async () => {
    const s = await scene("Les Addons");
    const necko = await s.fiche(s.p.Necko!, "Necko", 60);
    const nb = m("Necko Brisefer", 34);
    const T = NOW() - HOUR;
    await paste(s.owner, frl({ at: T, members: [nb] }));
    expect(await s.level(necko)).toBe(34);
    // L'addon de Necko envoie le perso, niveau 38 (GUID et nom complet) : c'est le jeu aussi
    await paste(s.p.Necko!, frc("Necko", "ROGUE", "Orc", 38, nb.guid, "Necko Brisefer"));
    expect(await s.level(necko)).toBe(38);
    // Une liste plus récente que la précédente mais plus ancienne que l'export (relevée il y a 40 min) ne le baisse pas
    await paste(s.owner, frl({ at: T + 1200, members: [{ ...nb, level: 36 }] }));
    expect(await s.level(necko)).toBe(38);
    // Une liste plus récente que l'export et à jour : elle l'emporte
    await paste(s.owner, frl({ at: NOW() + 1, members: [{ ...nb, level: 39 }] }));
    expect(await s.level(necko)).toBe(39);
  });

  it("une fiche qui entre dans la guilde par une sortie est contrôlée au niveau du jeu ; un refus n'y range rien", async () => {
    const s = await scene("Les Sorties");
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Necko Brisefer", 34)] }));
    const c = (await s.p.Necko!.c.post("/api/characters", { name: "Necko", cls: "Rogue", race: "Orc", spec1: "Combat", level: 60 })).json().character as { id: string };
    const { tomorrow } = outingDays();
    const r = await s.p.Necko!.c.post(`/api/groups/${s.g.id}/outings`, { dungeon: "blackrock-depths", day: tomorrow, at: atTime(tomorrow, "21:00")!.toISOString(), characterId: c.id, role: "DPS" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("Necko (niveau 34) n'a pas le niveau");
    // Refusé : la fiche n'est pas rangée dans la guilde, son niveau n'a pas bougé
    expect((await s.mine(s.p.Necko!, c.id))).toMatchObject({ level: 60, levelLock: null });
  });

  it("pas d'échappatoire : retirée puis remise avec « addonSynced », ou doublée d'une fiche « leurre », elle suit le jeu", async () => {
    const s = await scene("Les Malins");
    const necko = await s.fiche(s.p.Necko!, "Necko", 60);
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Necko Brisefer", 34)] }));
    expect(await s.level(necko)).toBe(34);
    await s.p.Necko!.c.put(`/api/groups/${s.g.id}/characters/${necko}`, { assigned: false });
    expect((await s.p.Necko!.c.patch(`/api/characters/${necko}`, { level: 60, addonSynced: true })).statusCode).toBe(200);
    await s.p.Necko!.c.put(`/api/groups/${s.g.id}/characters/${necko}`, { assigned: true });
    expect(await s.level(necko)).toBe(34);
    // Une deuxième fiche du même joueur qui vise le même perso ne libère pas la première
    const leurre = await s.fiche(s.p.Necko!, "Necko Brisefer", 1);
    expect(await s.level(leurre)).toBe(34);
    expect((await s.p.Necko!.c.patch(`/api/characters/${necko}`, { level: 60 })).statusCode).toBe(409);
  });

  it("une fiche qui arrive dans la guilde après le relevé prend le niveau du jeu tout de suite", async () => {
    const s = await scene("Les Arrivants");
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 52, { rank: "Maître de guilde", ri: 0 })] }));
    const k = await s.fiche(s.p.Pikou!, "Kaeldra", 1, "Warrior", "Orc");
    expect(await s.level(k)).toBe(52);
  });
});

describe("niveau des fiches : correction par un officier", () => {
  it("fiche introuvable : un officier fixe le niveau, le joueur ne le change plus, l'officier lui rend la main ; journal", async () => {
    const s = await scene("Les Correcteurs");
    const grumz = await s.fiche(s.p.Necko!, "Grumz", 60, "Warrior", "Orc");
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Necko Brisefer", 34)] }));
    const vex = "LesCorrecteursVex"; // nom affiché du compte de test (scene : nom de la guilde sans espaces + prénom)

    // Un membre ne peut pas
    expect((await s.fix(s.p.Pikou!, grumz, 45)).statusCode).toBe(403);
    const r = await s.fix(s.p.Vex!, grumz, 45);
    expect(r.statusCode, r.body).toBe(200);
    expect(await s.level(grumz)).toBe(45);
    expect((await s.mine(s.p.Necko!, grumz)).levelLock).toMatchObject({ by: "officer", name: vex });
    const no = await s.p.Necko!.c.patch(`/api/characters/${grumz}`, { level: 60 });
    expect(no.statusCode).toBe(409);
    expect(no.json().error).toBe(`Le niveau de Grumz a été fixé par ${vex}, officier de sa guilde.`);
    expect((await s.journal())[0]).toMatchObject({ type: "character_level_fixed", actor: vex, meta: { character: "Grumz", from: 60, to: 45 } });

    expect((await s.release(s.p.Vex!, grumz)).statusCode).toBe(200);
    expect((await s.mine(s.p.Necko!, grumz)).levelLock).toBeNull();
    expect((await s.journal())[0]).toMatchObject({ type: "character_level_released", actor: vex, meta: { character: "Grumz" } });
    expect((await s.p.Necko!.c.patch(`/api/characters/${grumz}`, { level: 46 })).statusCode).toBe(200);
  });

  it("refusé pour une fiche que la liste du jeu connaît, et pour les persos du propriétaire", async () => {
    const s = await scene("Les Refus");
    const necko = await s.fiche(s.p.Necko!, "Necko", 60);
    const chef = await s.fiche(s.owner, "Chefounet", 20, "Warrior", "Orc");
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Necko Brisefer", 34)] }));
    const r = await s.fix(s.p.Vex!, necko, 45);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("Necko est dans la liste de guilde du jeu (Necko Brisefer) : son niveau suit le jeu.");
    expect((await s.fix(s.p.Vex!, chef, 30)).statusCode).toBe(403);
    expect((await s.fix(s.owner, chef, 30)).statusCode).toBe(200);
  });

  it("le verrou d'un officier ne survit pas au départ du joueur de la guilde", async () => {
    const s = await scene("Les Partants");
    const grumz = await s.fiche(s.p.Necko!, "Grumz", 60, "Warrior", "Orc");
    expect((await s.fix(s.p.Vex!, grumz, 45)).statusCode).toBe(200);
    expect((await s.p.Necko!.c.del(`/api/groups/${s.g.id}/members/${s.p.Necko!.user.id}`)).statusCode).toBe(200);
    expect((await s.row(grumz)).levelFixedBy).toBeNull();
    expect((await s.mine(s.p.Necko!, grumz)).levelLock).toBeNull();
    expect((await s.p.Necko!.c.patch(`/api/characters/${grumz}`, { level: 50 })).statusCode).toBe(200);
  });

  it("le verrou tombe quand la fiche quitte la guilde, quand l'addon envoie le perso, et quand la liste le retrouve", async () => {
    const s = await scene("Les Verrous");
    const grumz = await s.fiche(s.p.Necko!, "Grumz", 60, "Warrior", "Orc");
    await paste(s.owner, frl({ at: NOW() - 2 * HOUR, members: [m("Necko Brisefer", 34)] }));
    // Quitte la guilde
    await s.fix(s.p.Vex!, grumz, 45);
    await s.p.Necko!.c.put(`/api/groups/${s.g.id}/characters/${grumz}`, { assigned: false });
    expect((await s.row(grumz)).levelFixedBy).toBeNull();
    await s.p.Necko!.c.put(`/api/groups/${s.g.id}/characters/${grumz}`, { assigned: true });
    // L'addon de Necko envoie Grumz (autre guilde en jeu) : le niveau du jeu, plus de verrou d'officier
    await s.fix(s.p.Vex!, grumz, 45);
    await paste(s.p.Necko!, frc("Grumz", "WARRIOR", "Orc", 41, "Player-4620-0BADCAFE", "Grumz Rocdur"));
    expect(await s.row(grumz)).toMatchObject({ level: 41, levelFixedBy: null });
    // La liste du jeu le retrouve : le jeu reprend la main
    await s.fix(s.p.Vex!, grumz, 45).then(async r => { expect(r.statusCode, r.body).toBe(200); });
    await s.p.Necko!.c.patch(`/api/characters/${grumz}`, { name: "Grumz" }); // inchangé
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Necko Brisefer", 34), m("Grumz Rocdur", 42, { guid: "Player-4620-0BADCAFE" })] }));
    expect(await s.row(grumz)).toMatchObject({ level: 42, levelFixedBy: null });
    expect((await s.mine(s.p.Necko!, grumz)).levelLock).toMatchObject({ by: "game", name: "Grumz Rocdur", level: 42 });
  });
});
