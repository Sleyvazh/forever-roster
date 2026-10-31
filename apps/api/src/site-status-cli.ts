import { createDb } from "./db/client";
import { recordBackup } from "./lib/site-status";

/**
 * Signale une sauvegarde réussie à l'API : infra/backup/forever-backup.sh l'appelle à la fin de chaque sauvegarde.
 *   node dist/site-status.js backup-ok <octets>
 * L'API garde la date et la taille de la dernière sauvegarde réussie (page « État du site ») et prévient les admins
 * si aucune ne réussit pendant plus de 26 h.
 */
const [cmd, bytes] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL manquant");
if (cmd !== "backup-ok" || !bytes || !/^\d{1,15}$/.test(bytes)) {
  console.error("Usage : site-status.js backup-ok <octets>");
  process.exit(2);
}
const { db, pool } = createDb(url);
try {
  await recordBackup(db, Number(bytes), new Date());
  console.log(`Sauvegarde signalée à l'API (${bytes} octets).`);
} finally {
  await pool.end();
}
