import { atTime, outingDays, type GuildMembersResponse } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, characters, groupCharacters, outingSignups, raids, raidSignups, softReserves } from "../src/db/schema";
import { frc, frl, HOUR, m, NOW, paste, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, type TestEnv } from "./helpers";

/**
 * Rattacher, créer la fiche d'un joueur, donner une fiche (8/11) : une fiche retrouvée dans la liste du jeu rattache son perso
 * à son compte ; « Rattacher à… » pour plusieurs persos et vers un membre du site sans perso ; « Créer sa fiche… » (officier) ;
 * « Donner la fiche à… » (joueur ou officier), inscriptions à venir comprises. Noms inventés.
 */

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });
const db = () => env.app.ctx.db;

/** Pseudo du compte (la connexion le renvoie avec l'identifiant). */
const nm = (s: Signed) => (s.user as { id: string; displayName: string }).displayName;
interface Fiche { id: string; name: string; level: number; userId: string; origin: { kind: string; by: string; at: string } | null; group: { id: string; isMain: boolean } | null }

async function scene(name: string) {
  const s = await sceneOf(env, name, ["Pikou", "Brakka", "Morwen", "Vex"]);
  await s.promote("Vex");
  const fiche = async (who: Signed, n: string, level: number, cls = "Warrior", race = "Orc") => {
    const c = (await who.c.post("/api/characters", { name: n, cls, race, level })).json().character as { id: string };
    const r = await who.c.put(`/api/groups/${s.g.id}/characters/${c.id}`, { assigned: true });
    expect(r.statusCode, r.body).toBe(200);
    return c.id;
  };
  const guild = (who: Signed = s.owner) => s.get<GuildMembersResponse>(who, "/guild");
  const charOf = async (n: string, who: Signed = s.owner) => (await guild(who)).chars.find(c => c.name === n)!;
  const mine = async (who: Signed) => (await who.c.get("/api/characters")).json().characters as Fiche[];
  return { ...s, fiche, guild, charOf, mine };
}

describe("rattacher", () => {
  it("une fiche rangée dans la guilde, retrouvée par son nom, rattache son perso du jeu à son compte ; un officier passe avant", async () => {
    const s = await scene("Les Fiches Nommées");
    await s.fiche(s.p.Pikou!, "Pikou", 30, "Mage", "Troll");
    await s.fiche(s.p.Brakka!, "Brakka Tonnefer", 29);
    const pk = m("Pikou Patacuivre", 31, { cls: "MAGE" }), bk = m("Brakka Tonnefer", 29), zz = m("Zirta Pellerouge", 8, { cls: "PRIEST" });
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 40, { ri: 0 }), pk, bk, zz] }));
    const pikou = await s.charOf(pk.name);
    expect(pikou).toMatchObject({ player: `u:${s.p.Pikou!.user.id}`, link: { source: "account" }, fiche: { byName: true } });
    expect((await s.charOf(bk.name)).player).toBe(`u:${s.p.Brakka!.user.id}`);
    expect((await s.charOf(zz.name)).fiche).toBeNull();
    // Le joueur le voit comme le sien ; détacher dit d'où vient le lien
    expect((await s.charOf(pk.name, s.p.Pikou!)).mine).toBe(true);
    const det = await s.owner.c.del(`/api/groups/${s.g.id}/guild/members/${pk.guid}/link`);
    expect(det.json().error).toBe(`${pk.name} est sur le compte de ${nm(s.p.Pikou!)} (sa fiche du site « Pikou » porte son nom) : choisis « Nouveau joueur » pour l'en séparer.`);
    // Rattaché par un officier ailleurs : l'officier passe avant la fiche
    await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/${pk.guid}/link`, { to: `u:${s.p.Brakka!.user.id}` });
    expect((await s.charOf(pk.name)).player).toBe(`u:${s.p.Brakka!.user.id}`);
  });

  it("deux comptes dont la fiche vise le même perso par son nom : aucun des deux", async () => {
    const s = await scene("Les Doublons");
    await s.fiche(s.p.Pikou!, "Necko", 20);
    await s.fiche(s.p.Brakka!, "Necko Brisefer", 20);
    const nb = m("Necko Brisefer", 20);
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 40, { ri: 0 }), nb] }));
    expect((await s.charOf(nb.name)).fiche).toBeNull();
  });

  it("plusieurs persos d'un coup, vers un membre du site qui n'a encore aucun perso ; « Nouveau joueur » : le plus haut niveau est le main", async () => {
    const s = await scene("Les Groupés");
    const mg = m("Morgrim Feudacier", 33, { cls: "PALADIN" }), th = m("Thorn Malvent", 24, { cls: "HUNTER" }), a = m("Aldo Brume", 12), b = m("Bruno Sel", 18);
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 40, { ri: 0 }), mg, th, a, b] }));
    const morwen = s.p.Morwen!;
    // Un simple membre ne rattache pas
    expect((await morwen.c.put(`/api/groups/${s.g.id}/guild/members/link`, { guids: [mg.guid], to: `u:${morwen.user.id}` })).statusCode).toBe(403);
    const r = await s.p.Vex!.c.put(`/api/groups/${s.g.id}/guild/members/link`, { guids: [th.guid, mg.guid], to: `u:${morwen.user.id}` });
    expect(r.statusCode, r.body).toBe(200);
    const g = await s.guild(morwen);
    expect(g.questions.map(q => q.name).sort()).toEqual([mg.name, th.name]);
    const p = g.players.find(x => x.key === `u:${morwen.user.id}`)!;
    expect([p.main, ...p.alts]).toEqual([mg.guid, th.guid]);
    // Nouveau joueur sans compte : Bruno (18) main, Aldo son alt ; un perso coché n'est pas une cible
    expect((await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/link`, { guids: [a.guid, b.guid], to: `m:${a.guid}` })).statusCode).toBe(400);
    const n = (await s.owner.c.put(`/api/groups/${s.g.id}/guild/members/link`, { guids: [a.guid, b.guid], to: "new" })).json();
    const np = (await s.guild()).players.find(x => x.key === n.player)!;
    expect([np.main, ...np.alts]).toEqual([b.guid, a.guid]);
    const journal = await db().select({ meta: auditEvents.meta }).from(auditEvents).where(and(eq(auditEvents.groupId, s.g.id), eq(auditEvents.type, "guild_member_linked")));
    expect(journal).toHaveLength(4);
  });
});

describe("créer la fiche d'un joueur", () => {
  it("un officier crée la fiche d'un perso de la liste sur le compte d'un membre : rangée, son main, GUID, niveau du jeu, « créée par »", async () => {
    const s = await scene("Les Créées");
    const mg = m("Morgrim Feudacier", 33, { cls: "PALADIN" });
    await paste(s.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 40, { ri: 0 }), mg] }));
    const url = `/api/groups/${s.g.id}/guild/members/${mg.guid}/fiche`;
    const morwen = s.p.Morwen!;
    expect((await morwen.c.post(url, { userId: morwen.user.id, name: "Morgrim" })).statusCode).toBe(403);
    expect((await s.p.Vex!.c.post(url, { userId: morwen.user.id, name: "Morgrim", race: "Orc" })).json().error).toBe("Orc ne peut pas être Paladin dans WoW Forever.");
    const r = await s.p.Vex!.c.post(url, { userId: morwen.user.id, name: "Morgrim Feudacier", race: "Undead" });
    expect(r.statusCode, r.body).toBe(201);
    const [f] = await s.mine(morwen);
    expect(f).toMatchObject({ name: "Morgrim Feudacier", level: 33, origin: { kind: "created", by: nm(s.p.Vex!) }, group: { id: s.g.id, isMain: true } });
    const [row] = await db().select().from(characters).where(eq(characters.id, f!.id));
    expect(row).toMatchObject({ cls: "Paladin", race: "Undead", guid: mg.guid, userId: morwen.user.id });
    // Le perso du jeu est maintenant sur son compte ; une deuxième fiche est refusée
    expect(await s.charOf(mg.name)).toMatchObject({ player: `u:${morwen.user.id}`, fiche: { id: f!.id, byName: false } });
    expect((await s.p.Vex!.c.post(url, { userId: s.p.Pikou!.user.id, name: "Autre" })).statusCode).toBe(409);
    // Un étranger à la guilde : refusé
    const other = await sceneOf(env, "Les Autres");
    expect((await s.owner.c.post(`/api/groups/${s.g.id}/guild/members/${m("X Y", 1).guid}/fiche`, { userId: other.owner.user.id, name: "X" })).statusCode).toBe(404);
    // Journal ; la mention disparaît quand le joueur modifie sa fiche
    const [ev] = await db().select({ meta: auditEvents.meta }).from(auditEvents).where(and(eq(auditEvents.groupId, s.g.id), eq(auditEvents.type, "character_created_for")));
    expect(ev!.meta).toMatchObject({ character: "Morgrim Feudacier", targetName: nm(morwen), cls: "Paladin", level: 33 });
    await morwen.c.patch(`/api/characters/${f!.id}`, { spec1: "Holy Heal" });
    expect((await s.mine(morwen))[0]!.origin).toBeNull();
    // Son addon retrouve la fiche par son GUID (pas de doublon)
    await paste(morwen, frc("Morgrim", "PALADIN", "Scourge", 33, mg.guid, mg.name));
    expect(await s.mine(morwen)).toHaveLength(1);
  });
});

describe("donner une fiche", () => {
  const futureRaid = async (groupId: string, name: string, inHours: number) =>
    (await db().insert(raids).values({ groupId, name, scheduledAt: new Date(Date.now() + inHours * HOUR * 1000), lootMode: "softres" }).returning())[0]!;
  const signup = (raidId: string, who: Signed, characterId: string, status: "present" | "late" = "present") =>
    db().insert(raidSignups).values({ raidId, userId: who.user.id, displayName: nm(who), characterId, cls: "Warrior", spec: "Arms", status }).returning();

  it("le joueur donne sa fiche : compte, guilde, main du receveur ; inscriptions à venir qui suivent, sauf là où il est déjà ; le passé reste", async () => {
    const s = await scene("Les Données");
    const brakka = s.p.Brakka!, morwen = s.p.Morwen!;
    const main = await s.fiche(brakka, "Brakka", 29);
    const grumz = await s.fiche(brakka, "Grumz", 22);
    const morwenMain = await s.fiche(morwen, "Morwen", 20, "Priest", "Undead");
    const past = (await db().insert(raids).values({ groupId: s.g.id, name: "Onyxia", scheduledAt: new Date(Date.now() - 48 * HOUR * 1000) }).returning())[0]!;
    const mc = await futureRaid(s.g.id, "Molten Core", 48), bwl = await futureRaid(s.g.id, "Blackwing Lair", 72);
    await signup(past.id, brakka, grumz);
    const [mcSign] = await signup(mc.id, brakka, grumz);
    await signup(bwl.id, brakka, grumz);
    await signup(bwl.id, morwen, morwenMain);
    await db().insert(softReserves).values([{ raidId: mc.id, characterId: grumz, userId: brakka.user.id, itemId: 16800 }, { raidId: bwl.id, characterId: grumz, userId: brakka.user.id, itemId: 16801 }]);
    // Sortie de demain, créée par Pikou : Brakka y est avec Grumz
    const pik = await s.fiche(s.p.Pikou!, "Pikou", 20, "Mage", "Troll");
    const day = outingDays().tomorrow;
    const o = (await s.p.Pikou!.c.post(`/api/groups/${s.g.id}/outings`, { dungeon: "deadmines", day, at: atTime(day, "21:00")!.toISOString(), characterId: pik, role: "DPS" })).json().outing as { id: string };
    expect((await brakka.c.put(`/api/groups/${s.g.id}/outings/${o.id}/signup`, { characterId: grumz, role: "DPS" })).statusCode).toBe(200);

    const pre = (await brakka.c.get(`/api/groups/${s.g.id}/characters/${grumz}/give`)).json();
    const dm = (pre.upcoming as { kind: string; name: string }[]).find(u => u.kind === "outing")!.name;
    expect(pre.upcoming.map((u: { kind: string; name: string }) => `${u.kind}:${u.name}`)).toEqual(["raid:Molten Core", "raid:Blackwing Lair", `outing:${dm}`]);
    const r = await brakka.c.post(`/api/groups/${s.g.id}/characters/${grumz}/give`, { to: morwen.user.id });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ to: nm(morwen), moved: ["Molten Core", dm], dropped: ["Blackwing Lair"] });

    const [row] = await db().select().from(characters).where(eq(characters.id, grumz));
    expect(row).toMatchObject({ userId: morwen.user.id, addonKey: null, originKind: "given", originByName: nm(brakka) });
    const [gc] = await db().select().from(groupCharacters).where(eq(groupCharacters.characterId, grumz));
    expect(gc).toMatchObject({ userId: morwen.user.id, isMain: false });
    expect((await db().select().from(groupCharacters).where(eq(groupCharacters.characterId, main)))[0]!.isMain).toBe(true);
    // Molten Core : l'inscription et la réservation passent à Morwen ; BWL : Morwen y était déjà, la sienne reste ; Onyxia : passé, inchangé
    expect((await db().select().from(raidSignups).where(eq(raidSignups.id, mcSign!.id)))[0]).toMatchObject({ userId: morwen.user.id, displayName: nm(morwen) });
    const bwlSigns = await db().select().from(raidSignups).where(eq(raidSignups.raidId, bwl.id));
    expect(bwlSigns.map(x => x.characterId)).toEqual([morwenMain]);
    expect((await db().select().from(softReserves).where(eq(softReserves.characterId, grumz))).map(x => [x.raidId, x.userId])).toEqual([[mc.id, morwen.user.id]]);
    expect((await db().select().from(raidSignups).where(eq(raidSignups.raidId, past.id)))[0]).toMatchObject({ userId: brakka.user.id, characterId: grumz });
    expect((await db().select().from(outingSignups).where(and(eq(outingSignups.outingId, o.id), eq(outingSignups.characterId, grumz))))[0]).toMatchObject({ userId: morwen.user.id });
    // Chez Morwen : la fiche, avec « donnée par » ; chez Brakka : plus là
    expect((await s.mine(morwen)).find(f => f.id === grumz)).toMatchObject({ origin: { kind: "given", by: nm(brakka) } });
    expect((await s.mine(brakka)).map(f => f.name)).toEqual(["Brakka"]);
    const [ev] = await db().select({ meta: auditEvents.meta }).from(auditEvents).where(and(eq(auditEvents.groupId, s.g.id), eq(auditEvents.type, "character_given")));
    expect(ev!.meta).toMatchObject({ character: "Grumz", fromName: nm(brakka), targetName: nm(morwen) });
  });

  it("droits : le joueur, un officier (pas sur le propriétaire), pas un autre membre ; receveur membre ; même perso déjà chez lui ; sortie de son créateur", async () => {
    const s = await scene("Les Droits");
    const brakka = s.p.Brakka!, morwen = s.p.Morwen!, pikou = s.p.Pikou!, vex = s.p.Vex!;
    const grumz = await s.fiche(brakka, "Grumz", 22);
    const kael = await s.fiche(s.owner, "Kaeldra", 40);
    const give = (who: Signed, id: string, to: string) => who.c.post(`/api/groups/${s.g.id}/characters/${id}/give`, { to });
    expect((await give(pikou, grumz, morwen.user.id)).statusCode).toBe(403);
    expect((await give(vex, kael, morwen.user.id)).statusCode).toBe(403);
    const other = await sceneOf(env, "Les Étrangers");
    expect((await give(brakka, grumz, other.owner.user.id)).statusCode).toBe(404);
    expect((await give(brakka, grumz, brakka.user.id)).statusCode).toBe(400);
    // Même perso du jeu (GUID) déjà sur une fiche du receveur
    const g = m("Grumz Brisecrâne", 22);
    await db().update(characters).set({ guid: g.guid }).where(eq(characters.id, grumz));
    const dup = await s.fiche(morwen, "Grumz bis", 22);
    await db().update(characters).set({ guid: g.guid }).where(eq(characters.id, dup));
    expect((await give(brakka, grumz, morwen.user.id)).statusCode).toBe(409);
    // Un officier donne la fiche d'un membre ; le perso de la sortie créée par son joueur : refusé
    const day = outingDays().tomorrow;
    expect((await brakka.c.post(`/api/groups/${s.g.id}/outings`, { dungeon: "deadmines", day, at: atTime(day, "21:00")!.toISOString(), characterId: grumz, role: "DPS" })).statusCode).toBe(201);
    const refused = await give(vex, grumz, pikou.user.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/^Grumz est le perso de la sortie « .+ » créée par .+ : elle doit être annulée, ou passée, avant de donner la fiche\.$/);
    const free = await s.fiche(brakka, "Brakka", 29);
    expect((await give(vex, free, pikou.user.id)).statusCode).toBe(200);
    expect((await s.mine(pikou)).map(f => f.name)).toEqual(["Brakka"]);
    // Le propriétaire peut donner la sienne
    expect((await give(s.owner, kael, vex.user.id)).statusCode).toBe(200);
  });
});
