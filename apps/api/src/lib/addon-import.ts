/**
 * Import d'un export de l'addon (lot K1) : blocs FRC (persos), FRB (bilans de raid) et FRL (relevé de la guilde du jeu,
 * lot « Guilde »), appliqués côté serveur. Sert au Ctrl+V du site (choix de la fiche par perso) et à Roster Companion
 * (synchro automatique). L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont jamais touchés.
 * En-tête FRC de l'addon 1.6.2 : GUID du perso (gardé sur la fiche, clé de la liste de guilde) et nom complet, qui
 * complète une fiche qui n'a que le prénom (un nom saisi à la main, différent, est gardé et signalé).
 * Roster (WoW Retail, lot R3a) : seulement les bilans RRB de l'addon Roster (les persos viennent de Battle.net) ;
 * le texte de l'autre addon est refusé avec un message clair sur chaque site.
 */
import {
  addonKeyOf, foreignAddonErrors, gameName, GEAR_SLOTS, IMPORT_PARTS, INVTYPE_2H, isValidCombo, linkFromRanks, parseCharacterExports, parseGuildBlocks, parseRaidLogs,
  parseRRB, PROFESSION_SKILL_LINES, professionsFromExport, sameCharacter, withoutCurrent,
  type CharacterExport, type Game, type ImportPart, type ImportResult, type RaidLogExport, type RosterRaidLog,
} from "@forever/game-data";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { addonIgnored, characters, gameTalents, groupCharacters, groupMembers, raids, raidSignups, users, type Gear } from "../db/schema";
import { itemsById } from "../routes/gamedata";
import { logInput, saveRaidLog } from "../routes/raidlogs";
import { MAX_CHARACTERS } from "../routes/characters";
import { characterFields, crossCheck } from "./character-schema";
import { audit } from "./audit";
import { charsChanged } from "./events";
import { membership } from "./groups";
import { importGuildExports } from "./guild-import";
import { HttpError } from "./http";
import { importKnownRecipes, setWantedPatterns } from "./recipes";
import { signUpSiteUser } from "./signups";

type CharacterRow = typeof characters.$inferSelect;
type User = { id: string; displayName: string; addonVersion?: string | null };

export interface ImportOptions {
  game: Game;
  /** Ce qu'on reprend (Ctrl+V : « Choisir quoi importer ») ; tout par défaut. */
  parts?: ReadonlySet<ImportPart>;
  /** Fiche choisie par perso (clé « Prénom-Royaume » → id de fiche, « new » ou « skip ») : Ctrl+V du site. */
  targets?: Readonly<Record<string, string>>;
  /** Persos inconnus à créer / à ignorer (réponses données dans Roster Companion). */
  create?: ReadonlySet<string>;
  ignore?: ReadonlySet<string>;
  /** Perso inconnu sans réponse : « ask » (statut unknown, l'appli demande) ou « create ». */
  unknown?: "ask" | "create";
  /** Adresse de l'autre site (message quand on y colle le texte de l'autre addon). */
  otherHost?: string;
  /** Heure de référence des relevés de guilde et des inscriptions relayées (tests) ; maintenant sinon. */
  now?: Date;
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
const ALL_PARTS: ReadonlySet<ImportPart> = new Set(IMPORT_PARTS);

/** Champs de la fiche à modifier : identité, équipement porté, métiers, talents. Validés comme une modification faite sur le site. */
async function buildPatch(db: Db, c: CharacterRow, d: CharacterExport, parts: ReadonlySet<ImportPart>) {
  const patch: Partial<Pick<CharacterRow, "name" | "level" | "cls" | "race" | "gear" | "professions" | "talentNodes" | "talents" | "talentLink">> = {};
  if (parts.has("identity")) {
    // Nom complet du jeu : complète une fiche qui n'a que le prénom (jamais un nom saisi autrement)
    if (d.fullName && c.name !== d.fullName && !c.name.trim().includes(" ") && sameCharacter(d.fullName, c.name)) patch.name = d.fullName;
    if (d.level !== c.level) patch.level = d.level;
    if (d.cls && !c.cls) patch.cls = d.cls;
    if (d.race && !c.race && isValidCombo(d.race, d.cls ?? c.cls)) patch.race = d.race;
  }
  if (parts.has("gear") && Object.keys(d.gear).length) {
    const items = await itemsById(db, Object.values(d.gear));
    const gear: Gear = { ...c.gear };
    // L'export liste ce qui est porté : un emplacement absent est vide en jeu (objet retiré, main gauche sous une arme à
    // deux mains). L'objectif BiS reste.
    for (const slot of GEAR_SLOTS) {
      const id = d.gear[slot];
      const it = id ? items[id] : undefined;
      if (id) gear[slot] = { ...gear[slot], cur: (it?.name ?? `Objet ${id}`).slice(0, 100), curId: it ? id : null, q: it?.quality ?? null };
      else if (gear[slot]) gear[slot] = withoutCurrent(gear[slot])!;
    }
    const main = d.gear["Main Hand"];
    if (main && items[main]?.inventoryType === INVTYPE_2H && gear["Off Hand"]) gear["Off Hand"] = withoutCurrent(gear["Off Hand"])!;
    patch.gear = gear;
  }
  if (parts.has("professions") && d.professions.length) patch.professions = professionsFromExport(d.professions);
  if (parts.has("talents") && d.talents.length) {
    patch.talentNodes = d.talents;
    const cls = d.cls ?? c.cls;
    if (cls) {
      const talents = await db.select({ id: gameTalents.id, tree: gameTalents.tree, linkIndex: gameTalents.linkIndex, maxRank: gameTalents.maxRank })
        .from(gameTalents).where(eq(gameTalents.cls, cls)).orderBy(asc(gameTalents.tree), asc(gameTalents.linkIndex));
      const build = talents.length ? linkFromRanks(cls, talents, new Map(d.talents.map(t => [t.id, t.rank]))) : null;
      if (build) { patch.talents = build.split; patch.talentLink = build.link; }
    }
  }
  return patch;
}

/** Relais (lignes V) : raid passé depuis moins de 24 h, clic jamais plus de 5 min dans le futur ni de plus de 7 jours dans le passé. */
const RELAY_RAID_GRACE = 24 * 3600e3, RELAY_CLICK_AHEAD = 5 * 60e3, RELAY_CLICK_AGE = 7 * 86400e3;

/**
 * Inscriptions faites en jeu par d'autres joueurs, transmises par l'officier qui envoie ce bloc (lignes V, spec B4).
 * Chaque ligne passe ses gardes dans l'ordre ; rien n'est jamais créé pour un perso inconnu. Renvoie les prénoms des
 * persos inscrits (`sent`), ceux dont le site avait déjà le dernier mot (`kept`) et les lignes refusées, chacune avec le
 * prénom de la ligne et une raison courte (`refused`, dite à l'officier dans le message du bloc).
 */
export async function applyRelayed(db: Db, relayer: User, d: CharacterExport, now: Date) {
  const res = { sent: [] as string[], kept: [] as string[], refused: [] as { name: string; why: string }[] };
  const officer = new Map<string, boolean>();
  const roster = new Map<string, { id: string; name: string; guid: string | null; cls: string; userId: string }[]>();
  /** L'envoyeur est propriétaire ou officier de la guilde ; un non-membre est refusé comme un membre simple. */
  const isOfficer = async (groupId: string) => {
    let ok = officer.get(groupId);
    if (ok === undefined) {
      ok = await membership(db, groupId, relayer.id).then(role => role !== "member", e => { if (e instanceof HttpError) return false; throw e; });
      officer.set(groupId, ok);
    }
    return ok;
  };
  /** Persos rangés dans la guilde. */
  const guildCharacters = async (groupId: string) => {
    let rows = roster.get(groupId);
    if (!rows) {
      rows = await db.select({ id: characters.id, name: characters.name, guid: characters.guid, cls: characters.cls, userId: characters.userId })
        .from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId)).where(eq(groupCharacters.groupId, groupId));
      roster.set(groupId, rows);
    }
    return rows;
  };

  for (const v of d.relayed) {
    const refuse = (why: string) => { res.refused.push({ name: v.name, why }); };
    // 1. L'envoyeur est officier ou propriétaire de la guilde
    if (!await isOfficer(v.groupId)) { refuse("pas officier"); continue; }
    // 2. Raid de cette guilde, pas passé depuis plus de 24 h
    const [raid] = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt }).from(raids)
      .where(and(eq(raids.id, v.raidId), eq(raids.groupId, v.groupId)));
    if (!raid) { refuse("raid introuvable"); continue; }
    if (raid.scheduledAt && raid.scheduledAt.getTime() < now.getTime() - RELAY_RAID_GRACE) { refuse("raid passé"); continue; }
    // 3. Perso visé rangé dans la guilde : par GUID, à défaut par prénom s'il est seul à le porter (une fiche qui a un autre GUID n'est pas lui).
    // Le prénom de la ligne est celui de l'expéditeur, authentifié par le jeu ; le GUID, lui, est déclaré dans le message et se
    // falsifie : un GUID connu ne vaut que pour le perso qui porte ce prénom.
    const chars = await guildCharacters(v.groupId);
    let target: (typeof chars)[number] | undefined;
    if (v.guid) {
      const hits = chars.filter(c => c.guid === v.guid);
      if (hits.length > 1) { refuse("GUID en double"); continue; }
      if (hits.length === 1 && !sameCharacter(v.name, hits[0]!.name)) { refuse("GUID d'un autre perso"); continue; }
      target = hits[0];
    }
    if (!target) {
      const hits = chars.filter(c => sameCharacter(v.name, c.name));
      if (!hits.length) { refuse("perso introuvable"); continue; }
      if (hits.length > 1) { refuse("prénom en double"); continue; }
      if (v.guid && hits[0]!.guid && hits[0]!.guid !== v.guid) { refuse("GUID différent sur la fiche"); continue; }
      target = hits[0]!;
    }
    // 4. Pas un perso de l'envoyeur ; son joueur est membre de la guilde et accepte le relais
    if (target.userId === relayer.id) { refuse("ton perso"); continue; }
    const [player] = await db.select({ id: users.id, displayName: users.displayName, gameRelay: users.gameRelay }).from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId)).where(and(eq(groupMembers.groupId, v.groupId), eq(groupMembers.userId, target.userId)));
    if (!player) { refuse("pas membre"); continue; }
    if (!player.gameRelay) { refuse("relais coupé par le joueur"); continue; }
    // 5. Heure du clic plausible
    const clic = v.at * 1000;
    if (clic > now.getTime() + RELAY_CLICK_AHEAD || clic < now.getTime() - RELAY_CLICK_AGE) { refuse("heure du clic"); continue; }
    // 6. Le site a le dernier mot : changement de statut fait au moins aussi tard que le clic, ou même réponse avec le même perso
    const [old] = await db.select({ status: raidSignups.status, characterId: raidSignups.characterId, statusAt: raidSignups.statusAt }).from(raidSignups)
      .where(and(eq(raidSignups.raidId, raid.id), eq(raidSignups.userId, player.id)));
    if (old && (old.statusAt.getTime() >= clic || (old.status === v.status && old.characterId === target.id))) { res.kept.push(gameName(target.name)); continue; }
    // 7. Inscription du joueur visé avec ce perso (un perso sans classe est refusé comme sur le site), puis journal de la guilde
    if (!target.cls) { refuse("perso sans classe"); continue; }
    try {
      await signUpSiteUser(db, raid.id, { id: player.id, displayName: player.displayName }, { status: v.status, characterId: target.id });
    } catch (e) {
      if (e instanceof HttpError) { refuse("inscription impossible"); continue; }
      throw e;
    }
    await audit(db, null, "signup_relayed", {
      userId: relayer.id, groupId: v.groupId, meta: { character: target.name, raid: raid.name, at: raid.scheduledAt?.toISOString() ?? null, status: v.status },
    });
    res.sent.push(gameName(target.name));
  }
  return res;
}

/**
 * Résumé des lignes V pour le message du bloc : « 2 inscriptions transmises (Greta, Pikou) · 1 gardée · 1 refusée (Kaelys :
 * heure du clic) » (parties à zéro omises ; un même prénom refusé pour la même raison n'est dit qu'une fois).
 */
function relayedText(r: Awaited<ReturnType<typeof applyRelayed>>) {
  const sent = r.sent.length, kept = r.kept.length, refused = r.refused.length;
  return [
    sent && `${plural(sent, "inscription")} transmise${sent > 1 ? "s" : ""} (${[...new Set(r.sent)].join(", ")})`,
    kept && `${kept} gardée${kept > 1 ? "s" : ""}`,
    refused && `${refused} refusée${refused > 1 ? "s" : ""} (${[...new Set(r.refused.map(x => `${x.name} : ${x.why}`))].join(", ")})`,
  ].filter(Boolean).join(" · ");
}

/** Patrons connus et recherchés, inscriptions : enregistrés à part. Renvoie un résumé à afficher. */
async function applyExtras(db: Db, user: User, c: CharacterRow, d: CharacterExport, parts: ReadonlySet<ImportPart>) {
  const out: string[] = [];
  if (parts.has("recipes") && d.recipes.length) {
    const res = await importKnownRecipes(db, c, {
      spellIds: d.recipes.flatMap(x => (x.spellId ? [x.spellId] : [])).slice(0, 2000),
      itemIds: d.recipes.flatMap(x => (x.itemId ? [x.itemId] : [])).slice(0, 2000),
      professions: d.professions.map(p => p.name).filter(n => n in PROFESSION_SKILL_LINES),
    });
    out.push(`${plural(res.known, "patron")} coché${res.known > 1 ? "s" : ""}${res.unknown ? `, ${res.unknown} inconnu${res.unknown > 1 ? "s" : ""} de la base` : ""}`);
  }
  if (parts.has("recipes") && d.wanted.length) {
    const res = await setWantedPatterns(db, c.id, d.wanted.filter(w => w.on).map(w => w.itemId).slice(0, 200), d.wanted.filter(w => !w.on).map(w => w.itemId).slice(0, 200));
    if (res.added || res.removed) out.push(`${res.added} recherché${res.added > 1 ? "s" : ""} ajouté${res.added > 1 ? "s" : ""}${res.removed ? `, ${res.removed} retiré${res.removed > 1 ? "s" : ""}` : ""}`);
  }
  if (parts.has("signups") && d.signups.length) {
    let ok = 0;
    for (const s of d.signups.slice(0, 30)) {
      try {
        await membership(db, s.groupId, user.id);
        const [r] = await db.select({ id: raids.id }).from(raids).where(and(eq(raids.id, s.raidId), eq(raids.groupId, s.groupId)));
        if (!r) continue;
        await signUpSiteUser(db, s.raidId, user, { status: s.status, characterId: c.id });
        ok++;
      } catch { /* raid supprimé, groupe quitté ou perso sans classe */ }
    }
    out.push(`${plural(ok, "inscription")} aux raids${ok < d.signups.length ? ` (${d.signups.length - ok} impossible${d.signups.length - ok > 1 ? "s" : ""} : raid supprimé ou perso sans classe)` : ""}`);
  }
  return out.join(" · ");
}

const errorText = (e: unknown, fallback: string) => (e instanceof HttpError ? e.message : fallback);

/** Applique chaque bloc à sa fiche (retrouvée, choisie, ou créée) ; la date de dernière synchro est notée sur la fiche. */
export async function importCharacters(db: Db, user: User, blocks: CharacterExport[], opts: ImportOptions): Promise<ImportResult[]> {
  const parts = opts.parts ?? ALL_PARTS;
  const now = opts.now ?? new Date();
  const mine = await db.select().from(characters).where(and(eq(characters.userId, user.id), eq(characters.game, opts.game)));
  const ignored = new Set((await db.select({ key: addonIgnored.key }).from(addonIgnored)
    .where(and(eq(addonIgnored.userId, user.id), eq(addonIgnored.game, opts.game)))).map(r => r.key));
  const out: ImportResult[] = [];
  let changed = false;
  // Version de l'addon la plus récente de cet envoi : affichée dans les signalements du joueur
  const version = blocks.map(b => b.addon).filter(Boolean).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (version && version !== user.addonVersion) await db.update(users).set({ addonVersion: version.slice(0, 20) }).where(eq(users.id, user.id));

  for (const d of blocks) {
    const key = addonKeyOf(d);
    const base = { key, kind: "character" as const, name: d.name, cls: d.cls, level: d.level };
    const first = out.length;
    try {
      // 1. Fiche visée : choix explicite (Ctrl+V), sinon perso déjà lié, sinon même prénom et même classe
      const target = opts.targets?.[key];
      let c: CharacterRow | undefined;
      let create = false;
      if (target === "skip") { out.push({ ...base, status: "skipped", message: "ignoré" }); continue; }
      if (target === "new") create = true;
      else if (target) {
        c = mine.find(x => x.id === target);
        if (!c) { out.push({ ...base, status: "error", message: "fiche introuvable" }); continue; }
      } else {
        // Le GUID (addon 1.6.2) identifie le perso même si son prénom existe deux fois
        c = (d.guid ? mine.find(x => x.guid === d.guid) : undefined)
          ?? mine.find(x => x.addonKey === key && (!d.guid || !x.guid))
          ?? mine.find(x => !x.addonKey && !x.guid && sameCharacter(d.name, x.name) && (!x.cls || !d.cls || x.cls === d.cls));
        if (!c) {
          if (opts.ignore?.has(key)) {
            await db.insert(addonIgnored).values({ userId: user.id, game: opts.game, key }).onConflictDoNothing();
            ignored.add(key);
          }
          if (opts.create?.has(key) || (opts.unknown === "create" && !ignored.has(key))) create = true;
          else if (ignored.has(key)) { out.push({ ...base, status: "ignored", message: "perso ignoré (à remettre dans les options de l'appli)" }); continue; }
          else { out.push({ ...base, status: "unknown", message: "perso inconnu du site : à créer ou à ignorer" }); continue; }
        }
      }
      if (c && d.cls && c.cls && d.cls !== c.cls) { out.push({ ...base, status: "error", message: `classe différente sur la fiche (${c.cls})` }); continue; }

      // 2. Nouvelle fiche : niveau, race et classe toujours repris
      if (create) {
        const [{ n, top }] = await db.select({ n: sql<number>`count(*)::int`, top: max(characters.sortOrder) }).from(characters)
          .where(and(eq(characters.userId, user.id), eq(characters.game, opts.game))) as [{ n: number; top: number | null }];
        if (n >= MAX_CHARACTERS) { out.push({ ...base, status: "error", message: `limite de ${MAX_CHARACTERS} personnages atteinte` }); continue; }
        const [row] = await db.insert(characters).values({ userId: user.id, game: opts.game, name: (d.fullName ?? d.name).slice(0, 40), sortOrder: (top ?? -1) + 1 }).returning();
        c = row!;
        mine.push(c);
        if (ignored.has(key)) { await db.delete(addonIgnored).where(and(eq(addonIgnored.userId, user.id), eq(addonIgnored.game, opts.game), eq(addonIgnored.key, key))); ignored.delete(key); }
      }
      const fiche = c!;
      const patch = await buildPatch(db, fiche, d, create ? new Set<ImportPart>([...parts, "identity"]) : parts);
      // Mêmes règles qu'une modification faite sur le site (longueurs, formats, combinaisons race / classe)
      const checked = characterFields.partial().safeParse(patch);
      if (!checked.success) { out.push({ ...base, status: "error", message: "export illisible pour cette fiche" }); continue; }
      const err = crossCheck({ ...fiche, ...patch }, opts.game);
      if (err) { out.push({ ...base, status: "error", message: err }); continue; }

      // 3. Lien perso du jeu → fiche (retiré d'une autre fiche si le joueur a changé de cible), GUID compris
      if (fiche.addonKey !== key) {
        const other = mine.find(x => x.addonKey === key && x.id !== fiche.id);
        if (other) { await db.update(characters).set({ addonKey: null }).where(eq(characters.id, other.id)); other.addonKey = null; }
      }
      if (d.guid && fiche.guid !== d.guid) {
        for (const other of mine.filter(x => x.guid === d.guid && x.id !== fiche.id)) {
          await db.update(characters).set({ guid: null }).where(eq(characters.id, other.id)); other.guid = null;
        }
      }
      const consumables = Object.keys(d.consumables).length ? Object.fromEntries(Object.entries(d.consumables).slice(0, 60).map(([k, v]) => [k, Math.min(9999, v)])) : null;
      const [row] = await db.update(characters).set({
        ...patch, addonKey: key, ...(d.guid && { guid: d.guid }), addonSyncedAt: new Date(), updatedAt: new Date(),
        // Consommables comptés en jeu (lot G) : toujours repris, ils servent à l'onglet Préparation des raids
        ...(consumables && { consumables, consumablesAt: new Date() }),
      }).where(eq(characters.id, fiche.id)).returning();
      Object.assign(fiche, row);
      changed = true;
      const extras = await applyExtras(db, user, fiche, d, parts);
      // Nom complet du jeu différent du nom saisi sur la fiche : gardé, mais signalé
      const conflict = d.fullName && parts.has("identity") && !create && fiche.name !== d.fullName ? { fiche: fiche.name, game: d.fullName } : null;
      out.push({
        ...base, status: create ? "created" : "updated", characterId: fiche.id, ...(conflict && { nameConflict: conflict }),
        message: `${create ? "fiche créée" : "fiche mise à jour"}${patch.name ? ` · nom complet : ${patch.name}` : ""}${extras ? ` · ${extras}` : ""}${conflict ? ` · nom en jeu « ${conflict.game} » différent de la fiche (« ${conflict.fiche} », gardé)` : ""}`,
      });
    } catch (e) {
      out.push({ ...base, status: "error", message: errorText(e, "mise à jour impossible") });
    } finally {
      // Lignes V : des inscriptions d'autres joueurs, qui ne parlent pas du perso porteur du bloc. Elles sont donc transmises
      // quel que soit son sort (inconnu, ignoré, laissé de côté, classe différente, erreur) et le message s'ajoute à son résultat :
      // l'appli accuse réception de ces résultats et l'addon oublie alors ces lignes pour de bon.
      if (parts.has("signups") && d.relayed.length) {
        let note: string | null = null;
        try { note = relayedText(await applyRelayed(db, user, d, now)); } catch (e) { out[first] = { ...(out[first] ?? base), status: "error", message: errorText(e, "transmission des inscriptions impossible") }; }
        const res = out[first];
        if (note && res) out[first] = { ...res, message: res.message ? `${res.message} · ${note}` : note };
      }
    }
  }
  if (changed) await charsChanged(db, user.id).catch(() => {});
  return out;
}

/**
 * Bilans de raid (FRB, ou RRB sur Roster) : après les persos, pour que le BiS reçu soit coché sur la fiche à jour.
 * game : jeu du site où le bilan arrive ; le bilan d'un raid de l'autre jeu est refusé.
 */
export async function importRaidLogs(db: Db, user: User, logs: (RaidLogExport | RosterRaidLog)[], opts: { auto?: boolean; game?: Game } = {}): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const l of logs) {
    const name = `Bilan de ${l.raidName || "raid"}`;
    const roster = "encounters" in l;
    const base = { key: `${roster ? "rrb" : "frb"}:${l.raidId}`, kind: "raidlog" as const, name, raidId: l.raidId };
    try {
      const body = logInput.parse({
        raidId: l.raidId, start: l.start, end: l.end, recorder: l.recorder, instance: l.instance, lead: l.lead,
        attendees: l.attendees, loot: l.loot, consumableCall: l.consumableCall,
        ...(roster && { encounters: l.encounters, difficulty: l.difficulty }),
      });
      const r = await saveRaidLog(db, user.id, body, opts);
      if (r.status === "kept") { out.push({ ...base, status: "kept", message: "le bilan du chef de raid est déjà enregistré" }); continue; }
      const kills = roster ? new Set(l.encounters.filter(e => e.killed).map(e => e.encounterId || e.boss)).size : 0;
      out.push({ ...base, status: "updated", message: `enregistré · ${plural(r.attendees, "présent")}, ${plural(r.loot, "objet")}${roster ? `, ${kills} boss vaincu${kills > 1 ? "s" : ""}` : ""}${r.bis ? `, ${r.bis} BiS coché${r.bis > 1 ? "s" : ""}` : ""}${r.unknown.length ? ` · sans fiche : ${r.unknown.slice(0, 5).join(", ")}${r.unknown.length > 5 ? "…" : ""}` : ""}` });
    } catch (e) {
      const refused = e instanceof HttpError && e.status === 403;
      out.push({ ...base, status: refused ? "refused" : "error", message: refused ? "pas officier de la guilde" : errorText(e, "enregistrement impossible") });
    }
  }
  return out;
}

/**
 * Texte collé ou envoyé : persos, bilans, puis relevés de guilde (après les persos : leur GUID rapproche les persos de la
 * liste). Les blocs abîmés sont signalés sans bloquer les autres. skipGuild : Ctrl+V sans le relevé de guilde.
 */
export async function importAddonText(db: Db, user: User, text: string, opts: ImportOptions & { skipLogs?: ReadonlySet<string>; auto?: boolean; skipGuild?: boolean }) {
  const errors: string[] = [];
  // Roster : bilans RRB seulement (les persos viennent de Battle.net ou se créent à la main) ; un texte de Forever Roster est refusé
  if (opts.game === "retail") {
    const rrb = parseRRB(text, { otherHost: opts.otherHost });
    errors.push(...rrb.errors.map(x => (x.startsWith("Ce texte vient") ? x : `Bilan ignoré : ${x}`)));
    const results = await importRaidLogs(db, user, rrb.data.filter(l => !opts.skipLogs?.has(l.raidId)), { auto: opts.auto, game: "retail" });
    return { results, errors };
  }
  // Forever Roster : un texte de l'addon Roster (WoW Retail) est refusé, jamais mal lu
  errors.push(...foreignAddonErrors(text, "forever", opts.otherHost));
  const raid = parseRaidLogs(text);
  errors.push(...raid.errors.map(x => `Bilan ignoré : ${x}`));
  let blocks: CharacterExport[] = [];
  if (/(^|\n)\s*FRC;/.test(text)) {
    const r = parseCharacterExports(text);
    if (r.ok) { blocks = r.data; errors.push(...r.errors.map(x => `Bloc ignoré : ${x}`)); } else errors.push(r.error);
  }
  const guild = /(^|\n)\s*FRL;/.test(text) && !opts.skipGuild ? parseGuildBlocks(text) : { blocks: [], errors: [] };
  errors.push(...guild.errors.map(x => `Relevé de guilde ignoré : ${x}`));
  const results = [
    ...await importCharacters(db, user, blocks, opts),
    ...await importRaidLogs(db, user, raid.data.filter(l => !opts.skipLogs?.has(l.raidId)), { auto: opts.auto, game: "forever" }),
    ...await importGuildExports(db, user, guild.blocks, opts.now),
  ];
  return { results, errors };
}

/** Persos ignorés (Roster Companion) : liste et retour. */
export async function ignoredKeys(db: Db, userId: string, game: Game) {
  return (await db.select({ key: addonIgnored.key, at: addonIgnored.createdAt }).from(addonIgnored)
    .where(and(eq(addonIgnored.userId, userId), eq(addonIgnored.game, game)))).map(r => ({ key: r.key, at: r.at }));
}
export async function unignore(db: Db, userId: string, game: Game, keys: string[]) {
  if (!keys.length) return 0;
  const rows = await db.delete(addonIgnored).where(and(eq(addonIgnored.userId, userId), eq(addonIgnored.game, game), inArray(addonIgnored.key, keys))).returning({ key: addonIgnored.key });
  return rows.length;
}
