/**
 * Importe les objets et recettes de WoW Forever depuis les tables du client publiées par wago.tools.
 *
 *   node dist/import-gamedata.js               dernière version de Forever
 *   node dist/import-gamedata.js --build 1.60.1.70009
 *   node dist/import-gamedata.js --dir ./csv    fichiers <Table>.csv déjà téléchargés
 *   options : --no-era (sans complément Classic Era), --era-dir ./era (ItemSparse.csv et Item.csv de Classic Era)
 *
 * Les objets absents du client Forever (envoyés par le serveur du jeu, non publiés par wago.tools)
 * sont complétés avec ceux de Classic Era, marqués « era ».
 */
import { createDb } from "../db/client";
import { extract, fillFromEra, readItems } from "./extract";
import { downloadItemTables, downloadTables, latestBuild, latestEraBuild, readItemTables, readTables } from "./source";
import { gameDataStatus, storeGameData } from "./store";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");

const dir = arg("--dir");
let build = arg("--build") ?? (dir ? "local" : undefined);
if (!build) {
  const latest = await latestBuild();
  build = latest.version;
  console.log(`Dernière version de Forever sur wago.tools : ${build} (${latest.product})`);
}
console.log(dir ? `Lecture des tables dans ${dir}` : `Téléchargement des tables du client ${build}`);
const tables = dir ? await readTables(dir) : await downloadTables(build, fetch, m => console.log(m));
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
    data.items = fillFromEra(data.items, readItems({ ...eraTables, ItemClass: tables.ItemClass, ItemSubClass: tables.ItemSubClass }, "era").items);
    console.log(`${data.items.length - before} objets ajoutés depuis Classic Era (absents du client Forever).`);
  } catch (err) {
    eraBuild = null;
    console.warn(`Complément Classic Era ignoré : ${(err as Error).message}`);
  }
}

const { db, pool } = createDb(url);
try {
  await storeGameData(db, data, build, eraBuild);
  console.log("Import terminé :", await gameDataStatus(db));
} finally {
  await pool.end();
}
