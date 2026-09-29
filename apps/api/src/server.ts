import { buildApp } from "./app";
import { buildInternalApp } from "./internal";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { createMailer } from "./lib/mailer";
import { ensureRecurringRaids } from "./lib/recurring";

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

// API interne du bot Discord : port séparé, jamais exposé par Caddy (réseau Docker uniquement).
const internal = cfg.INTERNAL_API_SECRET ? await buildInternalApp({ db, cfg, mailer: mailerRef, fetch }, logger) : null;

// Raids récurrents : création des prochaines occurrences au démarrage, puis toutes les 15 minutes.
const runRecurring = () => ensureRecurringRaids(db)
  .then(n => { if (n) app.log.info({ created: n }, "Raids récurrents créés"); })
  .catch(err => app.log.error({ err }, "Échec de la création des raids récurrents"));
const recurringTimer = setInterval(runRecurring, 15 * 60e3);

const close = async () => {
  clearInterval(recurringTimer);
  await Promise.all([app.close(), internal?.close()]);
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
if (internal) await internal.listen({ port: cfg.INTERNAL_PORT, host: cfg.HOST });
void runRecurring();
