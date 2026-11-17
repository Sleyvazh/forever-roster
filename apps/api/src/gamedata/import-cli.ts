/**
 * Importe les objets et recettes de WoW Forever depuis les tables du client publiées par wago.tools.
 *
 *   node dist/import-gamedata.js               dernière version de Forever
 *   node dist/import-gamedata.js --build 1.60.1.70009
 *   node dist/import-gamedata.js --dir ./csv    fichiers <Table>.csv déjà téléchargés
 *   options : --no-era (sans complément Classic Era), --era-dir ./era (ItemSparse.csv et Item.csv de Classic Era)
 *             --cache <DBCache.bin | -> : cache d'un client (correctifs du serveur : objets révélés en jeu, leurs effets, sets,
 *               apparences, talents, recettes), ajouté aux correctifs gardés par le site ; option répétable ; « - » : entrée
 *               standard, un cache seul ou plusieurs (flux FRCACHES, voir splitCaches)
 *             --if-new : ne rien faire s'il n'y a ni correctif arrivé depuis le dernier import (caches envoyés par les
 *               contributeurs ou passés ici), ni nouvelle version du client sur wago.tools (import de la nuit) ;
 *               code de sortie 3 dans ce cas
 *             --no-db-cache : ignorer les correctifs gardés par le site (seulement ceux des fichiers passés ici)
 *             --no-icons : ne pas chercher les noms d'icônes (listfile communautaire)
 *
 * Les objets absents du client Forever (envoyés par le serveur du jeu, non publiés par wago.tools)
 * sont complétés avec ceux de Classic Era, marqués « era ».
 */
import { createDb } from "../db/client";
import { readFile } from "node:fs/promises";
import { hotfixesSince, loadHotfixCaches, saveHotfixes } from "./cache-store";
import { parseDbCache, splitCaches, type DbCache } from "./dbcache";
import { applyHotfixes, collectHotfixes, removedItems } from "./hotfix";
import { HOTFIX_BUILD } from "./hotfix-layouts";
import { dedupeRecipes, extract, fillFromEra, readItems } from "./extract";
import { addDetails, appearanceIcons, buildForeverTalents, buildSpellTexts, iconNames } from "./details";
import { downloadDetailTables, downloadItemTables, downloadTables, latestBuild, latestEraBuild, listfileLines, readDetailTables, readItemTables, readTables } from "./source";
import { gameDataStatus, storeGameData } from "./store";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");

const { db, pool } = createDb(url);
const dir = arg("--dir");
let build = arg("--build") ?? (dir ? "local" : undefined);
if (!build) {
  const latest = await latestBuild();
  build = latest.version;
  console.log(`Dernière version de Forever sur wago.tools : ${build} (${latest.product})`);
}

// Caches passés ici (gamedata/*.bin sur le serveur) : ajoutés aux correctifs gardés par le site, comme un envoi
const cachePaths = process.argv.flatMap((a, i) => (a === "--cache" && process.argv[i + 1] ? [process.argv[i + 1]!] : []));
const fileCaches: DbCache[] = [];
for (const p of cachePaths) {
  for (const f of p === "-" ? splitCaches(await readStdin()) : [await readFile(p)]) fileCaches.push(parseDbCache(f));
}
const useDb = !process.argv.includes("--no-db-cache");
if (useDb) {
  for (const c of fileCaches) {
    const r = await saveHotfixes(db, c, null);
    console.log(`Cache du client (build ${c.build}) : ${r.rows} lignes utiles, ${r.newRows} nouvelles pour le site.`);
  }
}

// Import de la nuit : seulement s'il y a du nouveau
if (process.argv.includes("--if-new")) {
  const before = await gameDataStatus(db);
  const fresh = useDb ? await hotfixesSince(db, before.hotfixesAt ? new Date(before.hotfixesAt) : null) : fileCaches.length;
  if (!fresh && before.build === build) {
    console.log(`Rien de nouveau depuis le dernier import (${before.importedAt ?? "jamais"}, client ${build}) : import sauté.`);
    await pool.end();
    process.exit(3); // scripts/import-gamedata.sh : rien à faire ensuite (icônes)
  }
  console.log(fresh ? `${fresh} correctifs arrivés depuis le dernier import.` : `Nouvelle version du client : ${before.build ?? "aucune"} → ${build}.`);
}

console.log(dir ? `Lecture des tables dans ${dir}` : `Téléchargement des tables du client ${build}`);
const tables = dir ? await readTables(dir) : await downloadTables(build, fetch, m => console.log(m));
console.log("Tables des infobulles :");
const detailTables = dir ? await readDetailTables(dir, m => console.log(m)) : await downloadDetailTables(build, fetch, m => console.log(m));

// Correctifs du serveur (caches des clients) : appliqués aux tables comme le fait le jeu, avant tout le reste
let cacheBuild: string | null = null, cacheItems = 0, removed = new Set<number>();
const hotfixesAt = new Date();
const caches = useDb ? await loadHotfixCaches(db) : fileCaches;
if (caches.length) {
  const hot = collectHotfixes(caches);
  // Tables des objets et des infobulles ensemble (aucune n'est dans les deux) ; une table non téléchargée reste absente
  const all: Partial<Record<string, Record<string, string>[]>> = { ...tables, ...detailTables };
  const report = applyHotfixes(all, hot);
  for (const k of Object.keys(tables)) (tables as Record<string, unknown>)[k] = all[k];
  for (const k of Object.keys(detailTables)) (detailTables as Record<string, unknown>)[k] = all[k];
  removed = removedItems(hot);
  cacheBuild = [...new Set(caches.map(c => c.build))].join(", ");
  cacheItems = report.find(r => r.table === "ItemSparse")?.added ?? 0;
  const rows = caches.reduce((n, c) => n + c.records.length + c.removed.length, 0);
  console.log(`Correctifs du serveur : ${rows} lignes (client ${cacheBuild}${useDb ? ", gardées par le site" : ""}), appliqués :`);
  const other = caches.filter(c => !HOTFIX_BUILD.endsWith(`.${c.build}`)).map(c => c.build);
  if (other.length) console.warn(`  Dispositions des tables : client ${HOTFIX_BUILD}, cache ${[...new Set(other)].join(", ")} ; si des tables sont ignorées, relancer scripts/hotfix-layouts.mjs.`);
  for (const r of report) {
    if (r.skipped === "illisible") console.warn(`  ${r.table} : correctifs ignorés (${r.unreadable} lignes illisibles : version du client différente, relancer scripts/hotfix-layouts.mjs)`);
    else if (r.skipped === "absent") console.warn(`  ${r.table} : correctifs ignorés (table absente des fichiers téléchargés)`);
    else if (r.added || r.replaced || r.removed) console.log(`  ${r.table} : ${r.added} ajoutées, ${r.replaced} remplacées, ${r.removed} retirées${r.unreadable ? `, ${r.unreadable} illisibles ignorées` : ""}`);
  }
}

const data = extract(tables);
console.log(`${data.items.length} objets, ${data.recipes.length} recettes de métier.`);

// Complément Classic Era
let eraBuild: string | null = null;
const eraDir = arg("--era-dir");
if (!process.argv.includes("--no-era") && (eraDir || !dir)) {
  try {
    let eraTables;
    if (eraDir) { eraBuild = "local"; eraTables = await readItemTables(eraDir); }
    else {
      const era = await latestEraBuild();
      if (!era) throw new Error("aucune version de Classic Era sur wago.tools");
      eraBuild = era.version;
      console.log(`Complément : objets de Classic Era ${eraBuild}`);
      eraTables = await downloadItemTables(eraBuild, fetch, m => console.log(m));
    }
    const before = data.items.length;
    // Un objet retiré par le serveur de Forever n'est pas repris de Classic Era non plus
    const eraItems = readItems({ ...eraTables, ItemClass: tables.ItemClass, ItemSubClass: tables.ItemSubClass }, "era").items.filter(i => !removed.has(i.id));
    data.items = fillFromEra(data.items, eraItems);
    console.log(`${data.items.length - before} objets ajoutés depuis Classic Era (absents du client Forever).`);
  } catch (err) {
    eraBuild = null;
    console.warn(`Complément Classic Era ignoré : ${(err as Error).message}`);
  }
}

// Infobulles : barèmes, sorts et sets, puis noms des icônes
addDetails(data.items, { ...detailTables, ItemEffect: tables.ItemEffect, ItemXItemEffect: tables.ItemXItemEffect, SpellEffect: tables.SpellEffect });
const byAppearance = appearanceIcons(detailTables);
let fromAppearance = 0;
for (const it of data.items) if (!it.iconFileId && byAppearance.has(it.id)) { it.iconFileId = byAppearance.get(it.id); fromAppearance++; }
if (fromAppearance) console.log(`Icônes : ${fromAppearance} objets sans icône propre complétés par leur apparence.`);
// Talents de Forever : arbres du système C_Traits (positions, rangs, sorts, flèches)
const talents = buildForeverTalents(detailTables, tables, buildSpellTexts({ ...detailTables, SpellEffect: tables.SpellEffect }));
if (talents.length) console.log(`Talents : ${talents.length} talents pour ${new Set(talents.map(x => x.cls)).size} classes.`);
else console.warn("Talents : tables absentes, les arbres déjà en base sont conservés.");
const withStats = data.items.filter(i => i.details?.stats?.length || i.details?.armor || i.details?.dmg).length;
console.log(`Infobulles : ${withStats} objets avec stats, armure ou dégâts.`);
if (!dir && !process.argv.includes("--no-icons")) {
  try {
    const ids = new Set([...data.items.map(i => i.iconFileId), ...talents.map(x => x.iconId)].filter((v): v is number => !!v));
    console.log(`Noms des icônes (listfile communautaire, ${ids.size} fichiers)…`);
    const names = await iconNames(ids, listfileLines());
    let n = 0;
    const missing = new Set<number>();
    for (const it of data.items) {
      const name = it.iconFileId ? names.get(it.iconFileId) : undefined;
      if (name) { it.details = { ...it.details, icon: name, iconId: it.iconFileId }; n++; }
      else if (it.iconFileId) {
        // Nom inconnu : fichier nommé d'après son identifiant, récupéré dans les fichiers du jeu (scripts/fetch-item-icons.sh)
        it.details = { ...it.details, icon: `f${it.iconFileId}`, iconId: it.iconFileId };
        missing.add(it.iconFileId);
      }
    }
    for (const x of talents) if (x.iconId) x.icon = names.get(x.iconId) ?? `f${x.iconId}`;
    console.log(`${n} objets avec une icône (${names.size} icônes différentes, talents compris).`);
    if (missing.size) console.log(`${missing.size} fichiers d'icône absents de la liste communautaire (ex. ${[...missing].slice(0, 5).join(", ")}) : récupérés par leur identifiant.`);
  } catch (err) { console.warn(`Icônes ignorées : ${(err as Error).message}`); }
}

// Recettes en double (versions de la Saison de la Découverte présentes dans le client)
const dedup = dedupeRecipes(data.recipes, new Set(data.items.map(i => i.id)));
if (dedup.replaced.size) console.log(`Recettes : ${dedup.replaced.size} doublons écartés (version dont l'objet n'existe pas sur Forever).`);
data.recipes = dedup.recipes;

try {
  await storeGameData(db, { ...data, talents }, build, { eraBuild, cacheBuild, cacheItems, replacedRecipes: dedup.replaced, hotfixesAt });
  console.log("Import terminé :", await gameDataStatus(db));
} finally {
  await pool.end();
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
