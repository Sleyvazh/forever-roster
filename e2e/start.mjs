/**
 * Démarre l'environnement de test de bout en bout :
 * migrations, import des tables d'exemple du jeu, API compilée, puis front servi avec la CSP de production.
 * Les e-mails sont écrits dans test-results/api.log (mode développement) pour récupérer les liens.
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.join(root, "apps/api");
const env = {
  ...process.env,
  NODE_ENV: "development",
  APP_ORIGIN: `http://localhost:${process.env.E2E_PORT ?? 4173}`,
  // Deuxième adresse (Roster, WoW Retail) : même serveur, autre nom d'hôte
  RETAIL_ORIGIN: `http://127.0.0.1:${process.env.E2E_PORT ?? 4173}`,
  DATABASE_URL: process.env.DATABASE_URL_E2E ?? "postgres://forever:forever@localhost:5432/forever_e2e",
  COOKIE_SECURE: "false",
  HIBP_CHECK: "false",
  // Toutes les requêtes des tests viennent de 127.0.0.1 : la limite par minute de la production (300) se remplit vite
  RATE_LIMIT_MAX: "3000",
  SMTP_URL: "smtp://127.0.0.1:1", // aucun serveur : les e-mails sont seulement journalisés
  MAIL_FROM: "Forever Roster <no-reply@e2e.test>",
  PORT: "3000",
  HOST: "127.0.0.1",
  // Battle.net simulé (e2e/blizzard-mock.mjs) : import des persos de Roster
  BNET_CLIENT_ID: "e2e", BNET_CLIENT_SECRET: "e2e",
  BNET_OAUTH_HOST: "http://127.0.0.1:4199", BNET_API_HOST: "http://127.0.0.1:4199",
};

const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: api, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(["dist/migrate-cli.js"]);
run(["dist/import-gamedata.js", "--dir", "test/fixtures/gamedata", "--build", "e2e"]);

mkdirSync(path.join(root, "test-results"), { recursive: true });
const log = createWriteStream(path.join(root, "test-results/api.log"));
const apiProc = spawn(process.execPath, ["dist/server.js"], { cwd: api, env });
apiProc.stdout.pipe(log); apiProc.stderr.pipe(log);
const web = spawn(process.execPath, [path.join(root, "e2e/serve.mjs")], { env, stdio: "inherit" });
const bnet = spawn(process.execPath, [path.join(root, "e2e/blizzard-mock.mjs")], { env, stdio: "inherit" });

const stop = () => { apiProc.kill(); web.kill(); bnet.kill(); process.exit(0); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
apiProc.on("exit", code => { console.error(`API arrêtée (code ${code}) : voir test-results/api.log`); web.kill(); process.exit(1); });
