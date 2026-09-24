import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./client";

/** Dossier des migrations SQL générées par drizzle-kit (apps/api/drizzle). */
export function migrationsFolder() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Depuis src/db (dev) ou depuis dist (bundle de production)
  const candidates = [path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")];
  return candidates.find(p => existsSync(path.join(p, "meta"))) ?? candidates[0]!;
}

export async function runMigrations(db: Db, folder = migrationsFolder()) {
  await migrate(db, { migrationsFolder: folder });
}
