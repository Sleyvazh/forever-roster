/**
 * Import d'un export de l'addon (lot K1) : blocs FRC (persos) et FRB (bilans de raid), appliqués côté serveur.
 * Sert au Ctrl+V du site (choix de la fiche par perso) et à Roster Companion (synchro automatique).
 * L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont jamais touchés.
 */
import {
  addonKeyOf, GEAR_SLOTS, IMPORT_PARTS, INVTYPE_2H, isValidCombo, linkFromRanks, parseCharacterExports, parseRaidLogs,
  PROFESSION_SKILL_LINES, professionsFromExport, sameCharacter, withoutCurrent,
  type CharacterExport, type Game, type ImportPart, type ImportResult, type RaidLogExport,
} from "@forever/game-data";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { addonIgnored, characters, gameTalents, raids, users, type Gear } from "../db/schema";
import { itemsById } from "../routes/gamedata";
import { logInput, saveRaidLog } from "../routes/raidlogs";
import { MAX_CHARACTERS } from "../routes/characters";
import { characterFields, crossCheck } from "./character-schema";
import { charsChanged } from "./events";
import { membership } from "./groups";
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
}

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;
const ALL_PARTS: ReadonlySet<ImportPart> = new Set(IMPORT_PARTS);

/** Champs de la fiche à modifier : identité, équipement porté, métiers, talents. Validés comme une modification faite sur le site. */
async function buildPatch(db: Db, c: CharacterRow, d: CharacterExport, parts: ReadonlySet<ImportPart>) {
  const patch: Partial<Pick<CharacterRow, "level" | "cls" | "race" | "gear" | "professions" | "talentNodes" | "talents" | "talentLink">> = {};
  if (parts.has("identity")) {
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
        c = mine.find(x => x.addonKey === key)
          ?? mine.find(x => !x.addonKey && sameCharacter(d.name, x.name) && (!x.cls || !d.cls || x.cls === d.cls));
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
        const [row] = await db.insert(characters).values({ userId: user.id, game: opts.game, name: d.name.slice(0, 40), sortOrder: (top ?? -1) + 1 }).returning();
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

      // 3. Lien perso du jeu → fiche (retiré d'une autre fiche si le joueur a changé de cible)
      if (fiche.addonKey !== key) {
        const other = mine.find(x => x.addonKey === key && x.id !== fiche.id);
        if (other) { await db.update(characters).set({ addonKey: null }).where(eq(characters.id, other.id)); other.addonKey = null; }
      }
      const consumables = Object.keys(d.consumables).length ? Object.fromEntries(Object.entries(d.consumables).slice(0, 60).map(([k, v]) => [k, Math.min(9999, v)])) : null;
      const [row] = await db.update(characters).set({
        ...patch, addonKey: key, addonSyncedAt: new Date(), updatedAt: new Date(),
        // Consommables comptés en jeu (lot G) : toujours repris, ils servent à l'onglet Préparation des raids
        ...(consumables && { consumables, consumablesAt: new Date() }),
      }).where(eq(characters.id, fiche.id)).returning();
      Object.assign(fiche, row);
      changed = true;
      const extras = await applyExtras(db, user, fiche, d, parts);
      out.push({ ...base, status: create ? "created" : "updated", characterId: fiche.id, message: `${create ? "fiche créée" : "fiche mise à jour"}${extras ? ` · ${extras}` : ""}` });
    } catch (e) {
      out.push({ ...base, status: "error", message: errorText(e, "mise à jour impossible") });
    }
  }
  if (changed) await charsChanged(db, user.id).catch(() => {});
  return out;
}

/** Bilans de raid (FRB) : après les persos, pour que le BiS reçu soit coché sur la fiche à jour. */
export async function importRaidLogs(db: Db, user: User, logs: RaidLogExport[], opts: { auto?: boolean } = {}): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  for (const l of logs) {
    const name = `Bilan de ${l.raidName || "raid"}`;
    const base = { key: `frb:${l.raidId}`, kind: "raidlog" as const, name, raidId: l.raidId };
    try {
      const body = logInput.parse({
        raidId: l.raidId, start: l.start, end: l.end, recorder: l.recorder, instance: l.instance, lead: l.lead,
        attendees: l.attendees, loot: l.loot, consumableCall: l.consumableCall,
      });
      const r = await saveRaidLog(db, user.id, body, opts);
      if (r.status === "kept") { out.push({ ...base, status: "kept", message: "le bilan du chef de raid est déjà enregistré" }); continue; }
      out.push({ ...base, status: "updated", message: `enregistré · ${plural(r.attendees, "présent")}, ${plural(r.loot, "objet")}${r.bis ? `, ${r.bis} BiS coché${r.bis > 1 ? "s" : ""}` : ""}${r.unknown.length ? ` · sans fiche : ${r.unknown.slice(0, 5).join(", ")}${r.unknown.length > 5 ? "…" : ""}` : ""}` });
    } catch (e) {
      const refused = e instanceof HttpError && e.status === 403;
      out.push({ ...base, status: refused ? "refused" : "error", message: refused ? "pas officier du groupe" : errorText(e, "enregistrement impossible") });
    }
  }
  return out;
}

/** Texte collé ou envoyé : persos puis bilans. Les blocs abîmés sont signalés sans bloquer les autres. */
export async function importAddonText(db: Db, user: User, text: string, opts: ImportOptions & { skipLogs?: ReadonlySet<string>; auto?: boolean }) {
  const errors: string[] = [];
  const raid = parseRaidLogs(text);
  errors.push(...raid.errors.map(x => `Bilan ignoré : ${x}`));
  let blocks: CharacterExport[] = [];
  if (/(^|\n)\s*FRC;/.test(text)) {
    const r = parseCharacterExports(text);
    if (r.ok) { blocks = r.data; errors.push(...r.errors.map(x => `Bloc ignoré : ${x}`)); } else errors.push(r.error);
  }
  const results = [
    ...await importCharacters(db, user, blocks, opts),
    ...await importRaidLogs(db, user, raid.data.filter(l => !opts.skipLogs?.has(l.raidId)), { auto: opts.auto }),
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
