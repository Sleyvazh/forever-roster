import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { characters, guildLevels, guildMembers } from "../src/db/schema";
import { frc, frl, HOUR, m, NOW, paste, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, type TestEnv } from "./helpers";

/**
 * Sceau des textes de l'addon (1.6.5) et niveau d'un membre de la liste : la plus récente observation fait foi (8/11 :
 * Necko avait retouché un relevé à la main, son perso était resté 60 dans la liste, la Course au 60 et sa fiche). Noms inventés.
 */

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
const db = () => env.app.ctx.db;

const member = async (groupId: string, guid: string) =>
  (await db().select().from(guildMembers).where(and(eq(guildMembers.groupId, groupId), eq(guildMembers.guid, guid))))[0]!;
const history = async (groupId: string, guid: string) =>
  (await db().select({ level: guildLevels.level, source: guildLevels.source }).from(guildLevels)
    .where(and(eq(guildLevels.groupId, groupId), eq(guildLevels.guid, guid)))).sort((a, b) => a.level - b.level);
const ficheRow = async (id: string) => (await db().select().from(characters).where(eq(characters.id, id)))[0]!;
const unsealed = (text: string) => text.replace(/;[0-9a-f]{16}$/, "");

/** Fiche créée par son joueur et rangée dans la guilde. */
async function fiche(groupId: string, who: Signed, name: string, level: number) {
  const c = (await who.c.post("/api/characters", { name, cls: "Rogue", race: "Orc", level })).json().character as { id: string };
  const r = await who.c.put(`/api/groups/${groupId}/characters/${c.id}`, { assigned: true });
  expect(r.statusCode, r.body).toBe(200);
  return c.id;
}

describe("sceau des textes de l'addon (1.6.5)", () => {
  it("relevé ou perso sans sceau (addon trop ancien) ou retouché à la main : refusé, rien n'est enregistré", async () => {
    const s = await sceneOf(env, "Les Scellés", ["Necko"]);
    const nb = m("Necko Brisefer", 38);
    const ok = frl({ at: NOW() - HOUR, members: [nb] });
    const forged = await paste(s.owner, ok.replace(";38;", ";60;"));
    expect(forged.results).toEqual([]);
    expect(forged.errors).toEqual(["Relevé de guilde ignoré : texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu"]);
    const old = await paste(s.owner, unsealed(ok));
    expect(old.errors).toEqual(["Relevé de guilde ignoré : texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le"]);
    expect(await db().select().from(guildMembers).where(eq(guildMembers.groupId, s.g.id))).toEqual([]);
    const perso = await paste(s.p.Necko!, unsealed(frc("Necko", "ROGUE", "Orc", 60)));
    expect(perso.results).toEqual([]);
    expect(perso.errors).toEqual(["Necko : Texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le."]);
    expect((await s.p.Necko!.c.get("/api/characters")).json().characters).toEqual([]);
    // Le même relevé, tel que l'addon l'a scellé : enregistré
    expect((await paste(s.owner, ok)).errors).toEqual([]);
    expect((await member(s.g.id, nb.guid)).level).toBe(38);
  });
});

describe("niveau d'un membre : la plus récente observation fait foi", () => {
  it("un 60 inventé est corrigé par le relevé suivant, plus bas : liste, historique, Course au 60, fiche", async () => {
    const s = await sceneOf(env, "Les Corrigés", ["Necko"]);
    const id = await fiche(s.g.id, s.p.Necko!, "Necko", 30);
    const nb = m("Necko Brisefer", 30), k = m("Kaeldra Brisevent", 36, { ri: 0 });
    const T = NOW() - 3 * HOUR;
    await paste(s.owner, frl({ at: T, members: [k, nb] }));
    // Relevé retouché (avant le sceau, ou par quelqu'un qui a lu le code de l'addon) : 60
    await paste(s.owner, frl({ at: T + HOUR, members: [k, { ...nb, level: 60 }] }));
    expect((await member(s.g.id, nb.guid)).level).toBe(60);
    expect((await ficheRow(id)).level).toBe(60);
    expect((await s.race()).podium.sixties).toBe(1);
    // Relevé honnête suivant : 38, plus bas, il fait foi
    const r = await paste(s.owner, frl({ at: T + 2 * HOUR, members: [k, { ...nb, level: 38 }] }));
    expect(r.results[0]!.message).toContain("1 niveau corrigé");
    expect(await member(s.g.id, nb.guid)).toMatchObject({ level: 38, levelAt: new Date((T + 2 * HOUR) * 1000) });
    expect((await history(s.g.id, nb.guid)).at(-1)).toEqual({ level: 38, source: "roster" });
    expect((await ficheRow(id)).level).toBe(38);
    const race = await s.race();
    expect(race.podium.sixties).toBe(0);
    expect(race.rows.find(x => x.best.name === nb.name)!.best.level).toBe(38);
    // Un relevé plus ancien (envoyé en retard) ne change rien
    await paste(s.owner, frl({ at: T + HOUR + 60, members: [k, { ...nb, level: 60 }] }));
    expect((await member(s.g.id, nb.guid)).level).toBe(38);
  });

  it("XP ou montée de niveau plus récente que la liste : elle fait foi ; une liste plus ancienne ne la change pas ; une montée plus ancienne au-dessus n'est pas notée", async () => {
    const s = await sceneOf(env, "Les Horaires");
    const v = m("Vex Ombrelame", 20);
    const T = NOW() - 6 * HOUR;
    await paste(s.owner, frl({ at: T, members: [v] }));
    // XP lue par l'addon de Vex après cette liste : niveau 21
    await paste(s.owner, frl({ at: 0, xp: [["Vex", 21, 100, 1000, T + 2 * HOUR, v.guid]] }));
    expect((await member(s.g.id, v.guid)).level).toBe(21);
    // Liste lue avant cette XP, envoyée après : prise, mais pas son niveau
    await paste(s.owner, frl({ at: T + HOUR, members: [{ ...v, rank: "Vétéran" }] }));
    expect(await member(s.g.id, v.guid)).toMatchObject({ level: 21, rank: "Vétéran" });
    // Montée au 60 datée d'avant l'XP : ni niveau ni heure notés ; montée au 22 après l'XP : elle fait foi
    await paste(s.owner, frl({ at: 0, levels: [["Vex", 60, T + HOUR + 1, v.guid], ["Vex", 22, T + 3 * HOUR, v.guid]] }));
    expect((await member(s.g.id, v.guid)).level).toBe(22);
    expect((await history(s.g.id, v.guid)).map(h => [h.level, h.source])).toEqual([[20, "seen"], [21, "roster"], [22, "exact"]]);
    // Liste plus récente : elle fait foi, même plus bas
    await paste(s.owner, frl({ at: T + 4 * HOUR, members: [{ ...v, level: 21 }] }));
    expect((await member(s.g.id, v.guid)).level).toBe(21);
    expect((await history(s.g.id, v.guid)).map(h => h.level)).toEqual([20, 21]);
  });

  it("podium figé avec un 60 inventé : refait sans lui", async () => {
    const s = await sceneOf(env, "Les Podiums");
    const d = m("Dorgan Faussaire", 30), a = m("Aria Vive", 59), b = m("Bram Fort", 59), c = m("Cyra Lente", 50);
    const T = NOW() - 10 * HOUR;
    await paste(s.owner, frl({ at: T, members: [d, a, b, c] }));
    await paste(s.owner, frl({ at: T + HOUR, members: [{ ...d, level: 60 }, a, b, c] }));
    await paste(s.owner, frl({ at: T + 2 * HOUR, members: [{ ...d, level: 60 }, { ...a, level: 60 }, b, c] }));
    await paste(s.owner, frl({ at: T + 3 * HOUR, members: [{ ...d, level: 60 }, { ...a, level: 60 }, { ...b, level: 60 }, c] }));
    let race = await s.race();
    expect(race.podium.frozen).toBe(true);
    expect(race.podium.places.map(p => p.char.name)).toEqual([d.name, a.name, b.name]);
    // Dorgan était 38 : le podium n'en compte plus que deux, il n'est plus figé
    await paste(s.owner, frl({ at: T + 4 * HOUR, members: [{ ...d, level: 38 }, { ...a, level: 60 }, { ...b, level: 60 }, c] }));
    race = await s.race();
    expect(race.podium).toMatchObject({ frozen: false, sixties: 2 });
    await paste(s.owner, frl({ at: T + 5 * HOUR, members: [{ ...d, level: 38 }, { ...a, level: 60 }, { ...b, level: 60 }, { ...c, level: 60 }] }));
    race = await s.race();
    expect(race.podium.frozen).toBe(true);
    expect(race.podium.places.map(p => p.char.name)).toEqual([a.name, b.name, c.name]);
  });

  it("fiche mise au niveau de la liste après un envoi de l'addon : un relevé plus bas, plus ancien que cet envoi, la corrige quand même", async () => {
    const s = await sceneOf(env, "Les Envois", ["Necko"]);
    const id = await fiche(s.g.id, s.p.Necko!, "Necko", 30);
    const nb = m("Necko Brisefer", 30);
    const T = NOW() - 3 * HOUR;
    await paste(s.owner, frl({ at: T, members: [nb] }));
    // Envoi du joueur : son perso (38, lu maintenant par l'addon) et un relevé à 60, plus récent que celui du site
    await paste(s.p.Necko!, `${frc("Necko", "ROGUE", "Orc", 38, nb.guid, nb.name)}\n${frl({ at: T + HOUR, members: [{ ...nb, level: 60 }] })}`, { targets: { "Necko-Forever EU": id } });
    expect(await ficheRow(id)).toMatchObject({ level: 60, levelSyncedAt: null });
    // Relevé d'un officier lu avant cet envoi, après le relevé à 60 : 38
    await paste(s.owner, frl({ at: T + 2 * HOUR, members: [{ ...nb, level: 38 }] }));
    expect((await ficheRow(id)).level).toBe(38);
  });
});
