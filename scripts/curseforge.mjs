#!/usr/bin/env node
/**
 * Envoi d'un addon sur CurseForge (API d'envoi des auteurs : https://wow.curseforge.com/api).
 *
 *   node scripts/curseforge.mjs --tag roster-v0.3.2          (ce que fait l'Action sur un tag)
 *   node scripts/curseforge.mjs Roster --type beta --dry-run  (prépare le zip et le texte, sans rien envoyer)
 *
 * - Zip : celui du site, octet pour octet (apps/web/addon-zip.ts), nommé <dossier>-<version>.zip.
 * - Version : celle du .toc ; avec --tag, le tag doit la reprendre (roster-v0.3.2 pour 0.3.2), sinon rien ne part.
 *   Suffixe -beta ou -alpha : fichier Beta ou Alpha ; sinon Release (le seul que l'appli CurseForge installe d'office).
 * - Changements : section « ## <version> » de addon/<dossier>/CHANGELOG.md (obligatoire sur CurseForge).
 * - Versions du jeu : lues dans « ## Interface » (120100 → 12.1.0, 120105 → 12.1.5), retrouvées dans la liste de
 *   CurseForge ; celles qu'il n'a pas encore sont ignorées (avertissement), aucune : échec.
 * - Projet : « ## X-Curse-Project-ID » du .toc, sinon la variable CF_PROJECT_ROSTER ou CF_PROJECT_FOREVER.
 * - Jeton : variable d'environnement CF_API_TOKEN (secret GitHub), jamais affiché ni écrit.
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addonZipData } from "../apps/web/addon-zip.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADDONS = {
  Roster: { prefix: "roster", projectVar: "CF_PROJECT_ROSTER" },
  ForeverRoster: { prefix: "forever", projectVar: "CF_PROJECT_FOREVER" },
};
const TYPES = ["release", "beta", "alpha"];
const API = (process.env.CF_API_URL || "https://wow.curseforge.com").replace(/\/+$/, "");

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

// Arguments
const argv = process.argv.slice(2);
const opt = { addon: "", type: "", tag: "", dryRun: false, out: "" };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--dry-run") opt.dryRun = true;
  else if (a === "--type") opt.type = argv[++i] ?? "";
  else if (a === "--tag") opt.tag = argv[++i] ?? "";
  else if (a === "--out") opt.out = argv[++i] ?? "";
  else if (!a.startsWith("--") && !opt.addon) opt.addon = a;
  else fail(`Argument inconnu : ${a}`);
}

// Tag : roster-v0.3.2, forever-v1.5.6, avec -beta ou -alpha en option
let tagVersion = "";
if (opt.tag) {
  const m = /^([a-z]+)-v(\d+(?:\.\d+)+)(?:-(beta|alpha))?$/.exec(opt.tag);
  const entry = m && Object.entries(ADDONS).find(([, a]) => a.prefix === m[1]);
  if (!m || !entry) fail(`Tag « ${opt.tag} » non reconnu : roster-v0.3.2 ou forever-v1.5.6 (suffixe -beta ou -alpha en option).`);
  if (opt.addon && opt.addon !== entry[0]) fail(`Le tag ${opt.tag} est celui de ${entry[0]}, pas de ${opt.addon}.`);
  opt.addon = entry[0];
  tagVersion = m[2];
  if (!opt.type) opt.type = m[3] ?? "release";
}
if (!ADDONS[opt.addon]) fail(`Addon à préciser : ${Object.keys(ADDONS).join(" ou ")} (ou --tag).`);
opt.type ||= "release";
if (!TYPES.includes(opt.type)) fail(`Type « ${opt.type} » : ${TYPES.join(", ")}.`);

// .toc
const dir = path.join(ROOT, "addon", opt.addon);
const toc = readFileSync(path.join(dir, `${opt.addon}.toc`), "utf8");
const tocField = (k) => toc.match(new RegExp(`^## ${k}:\\s*(.+?)\\s*$`, "m"))?.[1] ?? "";
const version = tocField("Version");
if (!version) fail(`Pas de « ## Version » dans ${opt.addon}.toc.`);
if (tagVersion && tagVersion !== version) {
  fail(`Le tag ${opt.tag} annonce ${tagVersion}, mais ${opt.addon}.toc est en ${version} : rien n'est envoyé.`);
}
const interfaces = tocField("Interface").split(/[\s,]+/).filter(Boolean).map(Number);
if (!interfaces.length || interfaces.some(n => !Number.isInteger(n) || n < 10000)) fail(`« ## Interface » illisible dans ${opt.addon}.toc.`);
/** 120105 → 12.1.5 ; 16001 → 1.60.1 */
const gameVersionName = (n) => `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}`;
const wanted = [...new Set(interfaces.map(gameVersionName))];

// Changements de cette version
let changelog = "";
try {
  const text = readFileSync(path.join(dir, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const esc = version.replace(/\./g, "\\.");
  const m = new RegExp(`^## v?${esc}(?![\\d.])[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
  changelog = m?.[1].trim() ?? "";
} catch { /* fichier absent : message ci-dessous */ }
if (!changelog) fail(`Ajoute une section « ## ${version} » dans addon/${opt.addon}/CHANGELOG.md : CurseForge exige le texte des changements.`);

// Zip
const zipName = `${opt.addon}-${version}.zip`;
const data = addonZipData(opt.addon);
const metadata = {
  changelog,
  changelogType: "markdown",
  displayName: `${tocField("Title") || opt.addon} ${version}`,
  releaseType: opt.type,
  gameVersions: [],
};
if (opt.out) {
  mkdirSync(opt.out, { recursive: true });
  writeFileSync(path.join(opt.out, zipName), data);
  writeFileSync(path.join(opt.out, "metadata.json"), `${JSON.stringify({ ...metadata, gameVersions: wanted }, null, 2)}\n`);
}
console.log(`${opt.addon} ${version} (${opt.type}) : ${zipName}, ${data.length} octets ; jeu ${wanted.join(", ")}`);

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

if (opt.dryRun) {
  console.log("Essai à blanc : rien n'est envoyé.");
  console.log(`--- Changements ---\n${changelog}`);
  summary([`### ${opt.addon} ${version} : essai à blanc`, "", `Zip ${zipName} (${data.length} octets), ${opt.type}, jeu ${wanted.join(", ")}.`]);
  process.exit(0);
}

const token = process.env.CF_API_TOKEN ?? "";
if (!token) fail("Secret CF_API_TOKEN absent (dépôt GitHub > Settings > Secrets and variables > Actions).");
const projectId = tocField("X-Curse-Project-ID") || process.env[ADDONS[opt.addon].projectVar] || "";
if (!/^\d+$/.test(projectId)) {
  fail(`Projet CurseForge inconnu : ajoute « ## X-Curse-Project-ID: <numéro> » à ${opt.addon}.toc, ou la variable ${ADDONS[opt.addon].projectVar}.`);
}

async function call(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), "X-Api-Token": token } });
  const body = await res.text();
  if (!res.ok) fail(`CurseForge a répondu ${res.status} à ${new URL(url).pathname} : ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { fail(`Réponse illisible de CurseForge : ${body.slice(0, 200)}`); }
}

// Versions du jeu connues de CurseForge
const list = await call(`${API}/api/game/versions`);
const ids = [], kept = [];
for (const name of wanted) {
  const found = list.filter(v => v?.name === name);
  if (found.length > 1) fail(`Plusieurs versions CurseForge s'appellent ${name} (${found.map(v => v.id).join(", ")}).`);
  if (found.length) { ids.push(found[0].id); kept.push(name); }
  else console.log(`::warning::CurseForge n'a pas encore la version ${name} : ignorée.`);
}
if (!ids.length) fail(`Aucune des versions ${wanted.join(", ")} n'existe sur CurseForge pour l'instant.`);
metadata.gameVersions = ids;

// Envoi
const form = new FormData();
form.append("metadata", JSON.stringify(metadata));
form.append("file", new Blob([data], { type: "application/zip" }), zipName);
const res = await call(`${API}/api/projects/${projectId}/upload-file`, { method: "POST", body: form });
console.log(`Envoyé : fichier ${res?.id ?? "?"} du projet ${projectId}, en attente de modération sur CurseForge.`);
summary([`### ${opt.addon} ${version} envoyé sur CurseForge`, "", `Fichier ${res?.id ?? "?"} (${opt.type}), jeu ${kept.join(", ")} ; en attente de modération.`]);
