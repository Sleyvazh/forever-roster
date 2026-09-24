import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { createMailer } from "./lib/mailer";

const cfg = loadConfig();
const { db, pool } = createDb(cfg.DATABASE_URL);
await runMigrations(db);

const logger = {
  level: cfg.NODE_ENV === "production" ? "info" : "debug",
  // Jamais de cookie, de jeton ou de mot de passe dans les journaux.
  redact: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-csrf-token']", "res.headers['set-cookie']"],
};

// Le mailer a besoin d'un logger : on crée l'app avec un mailer provisoire puis on le branche.
const mailerRef: { send: (m: { to: string; subject: string; text: string }) => Promise<void> } = { send: async () => {} };
const app = await buildApp({ ctx: { db, cfg, mailer: mailerRef, fetch }, logger });
const real = createMailer(cfg.SMTP_URL, cfg.MAIL_FROM, app.log, cfg.NODE_ENV === "development");
mailerRef.send = real.send;

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
