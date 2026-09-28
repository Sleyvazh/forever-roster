/**
 * Importe les objets et recettes de WoW Forever depuis les tables du client publiées par wago.tools.
 *
 *   node dist/import-gamedata.js               dernière version de Forever
 *   node dist/import-gamedata.js --build 1.60.1.70009
 *   node dist/import-gamedata.js --dir ./csv    fichiers <Table>.csv déjà téléchargés
 */
import { createDb } from "../db/client";
import { extract } from "./extract";
import { downloadTables, latestBuild, readTables } from "./source";
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

const { db, pool } = createDb(url);
try {
  await storeGameData(db, data, build);
  console.log("Import terminé :", await gameDataStatus(db));
} finally {
  await pool.end();
}
