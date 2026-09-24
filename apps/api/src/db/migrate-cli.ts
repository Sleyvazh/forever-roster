import { createDb } from "./client";
import { runMigrations } from "./migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
const { db, pool } = createDb(url);
await runMigrations(db);
await pool.end();
console.log("Migrations appliquées.");
