#!/usr/bin/env node
/**
 * Release GitHub de Roster Companion à partir d'un tag companion-v<version> (Action .github/workflows/companion.yml).
 * Sans dépendance : Node 22 ou 24.
 *
 *   node scripts/companion-release.mjs --check companion-v0.3.0
 *       Avant de construire : le tag reprend la version de apps/companion (tauri.conf.json, package.json, Cargo.toml),
 *       apps/companion/CHANGELOG.md a une section « ## <version> », et la clé publique de signature est dans
 *       tauri.conf.json (plugins > updater > pubkey). Sinon : échec, rien n'est construit.
 *
 *   node scripts/companion-release.mjs --tag companion-v0.3.0 --dir <dossier de l'installateur> --out <dossier>
 *       Après le build Windows : à partir de « Roster Companion_<version>_x64-setup.exe » et de son « .exe.sig »
 *       (signature minisign écrite par tauri build quand TAURI_SIGNING_PRIVATE_KEY est présente), écrit dans <dossier> :
 *         assets/Roster-Companion_<version>_x64-setup.exe      l'installateur (nom sans espace : celui de l'adresse)
 *         assets/Roster-Companion_<version>_x64-setup.exe.sig  sa signature
 *         assets/latest.json                                   ce que l'appli lit pour savoir s'il y a du nouveau
 *         assets/SHA256SUMS.txt                                empreinte de l'installateur (vérification à la main)
 *         notes.md                                             texte de la Release (section du CHANGELOG)
 *       latest.json : { version, notes, pub_date, platforms: { "windows-x86_64": { signature, url } } }, format
 *       statique du plugin updater de Tauri ; url = l'adresse de l'installateur dans la Release du tag.
 *       --repo <propriétaire/dépôt> (sinon GITHUB_REPOSITORY, sinon Sleyvazh/forever-roster).
 *
 * Essai en local, avec un faux installateur :
 *   mkdir -p /tmp/rc && printf 'MZfaux' > "/tmp/rc/Roster Companion_0.3.0_x64-setup.exe" \
 *     && printf 'dW50cnVzdGVkIGNvbW1lbnQ6IGZhdXNzZSBzaWduYXR1cmU=' > "/tmp/rc/Roster Companion_0.3.0_x64-setup.exe.sig" \
 *     && node scripts/companion-release.mjs --tag companion-v0.3.0 --dir /tmp/rc --out /tmp/rc/out
 */
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "apps", "companion");
const DEFAULT_REPO = "Sleyvazh/forever-roster";
const TARGET = "windows-x86_64";

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function help() {
  const text = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const m = /\/\*\*\n([\s\S]*?)\*\//.exec(text);
  console.log((m?.[1] ?? "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}

// Arguments
const argv = process.argv.slice(2);
const opt = { check: "", tag: "", dir: "", out: "", repo: "" };
if (!argv.length || argv.includes("--help") || argv.includes("-h")) help();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check") opt.check = argv[++i] ?? "";
  else if (a === "--tag") opt.tag = argv[++i] ?? "";
  else if (a === "--dir") opt.dir = argv[++i] ?? "";
  else if (a === "--out") opt.out = argv[++i] ?? "";
  else if (a === "--repo") opt.repo = argv[++i] ?? "";
  else fail(`Argument inconnu : ${a} (--help).`);
}
const tag = opt.check || opt.tag;
if (!tag) fail("Tag à préciser : --check companion-v0.3.0, ou --tag companion-v0.3.0 --dir … --out … (--help).");

// Tag : companion-v0.3.0 (pas de suffixe : une Release est toujours la version que l'appli installera)
const tagMatch = /^companion-v(\d+\.\d+\.\d+)$/.exec(tag);
if (!tagMatch) fail(`Tag « ${tag} » non reconnu : companion-v0.3.0 (trois nombres, pas de suffixe).`);
const version = tagMatch[1];

// Version de l'appli : tauri.conf.json fait foi ; package.json et Cargo.toml doivent dire la même chose
const conf = JSON.parse(readFileSync(path.join(APP, "src-tauri", "tauri.conf.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(APP, "package.json"), "utf8"));
const cargo = readFileSync(path.join(APP, "Cargo.toml"), "utf8").match(/^version = "([^"]+)"/m)?.[1] ?? "";
const versions = { "src-tauri/tauri.conf.json": conf.version, "package.json": pkg.version, "Cargo.toml": cargo };
const wrong = Object.entries(versions).filter(([, v]) => v !== version);
if (wrong.length) {
  fail(`Le tag ${tag} annonce ${version}, mais apps/companion : ${wrong.map(([f, v]) => `${f} en ${v || "?"}`).join(", ")}. Rien n'est publié.`);
}

// Changements de cette version
let notes = "";
try {
  const text = readFileSync(path.join(APP, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const esc = version.replace(/\./g, "\\.");
  const m = new RegExp(`^## v?${esc}(?![\\d.])[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text);
  notes = m?.[1].trim() ?? "";
} catch { /* fichier absent : message ci-dessous */ }
if (!notes) fail(`Ajoute une section « ## ${version} » dans apps/companion/CHANGELOG.md : c'est le texte de la Release et de la mise à jour.`);

// Clé publique de signature : sans elle, l'appli n'installe rien (et tauri build ne saurait pas quoi vérifier)
const pubkey = String(conf.plugins?.updater?.pubkey ?? "").trim();
if (!pubkey) {
  fail("plugins > updater > pubkey est vide dans apps/companion/src-tauri/tauri.conf.json : mets-y la clé publique de signature (docs/operations.md, « Mises à jour de Roster Companion ») avant de publier.");
}
if (!conf.plugins?.updater?.endpoints?.length) fail("plugins > updater > endpoints est vide dans tauri.conf.json.");

if (opt.check) {
  console.log(`${tag} : version ${version} partout, section du CHANGELOG présente (${notes.split("\n").length} lignes), clé publique configurée.`);
  process.exit(0);
}

// Installateur et signature
if (!opt.dir || !opt.out) fail("--dir (dossier de l'installateur) et --out (dossier de sortie) sont obligatoires avec --tag.");
const files = readdirSync(opt.dir);
const exeName = files.find(f => /-setup\.exe$/i.test(f));
if (!exeName) fail(`Aucun « *-setup.exe » dans ${opt.dir} : l'installateur NSIS manque.`);
if (!exeName.includes(`_${version}_`)) fail(`L'installateur ${exeName} n'est pas en version ${version}.`);
const sigName = files.find(f => f === `${exeName}.sig`);
if (!sigName) fail(`Pas de ${exeName}.sig : tauri build n'a pas signé l'installateur (secret TAURI_SIGNING_PRIVATE_KEY, et createUpdaterArtifacts dans la configuration du build).`);
const exe = readFileSync(path.join(opt.dir, exeName));
const signature = readFileSync(path.join(opt.dir, sigName), "utf8").trim();
if (!/^[A-Za-z0-9+/=\s]+$/.test(signature) || signature.length < 100) fail(`${sigName} ne ressemble pas à une signature (base64 écrit par tauri build).`);
if (!Buffer.from(signature, "base64").toString("utf8").startsWith("untrusted comment:")) {
  fail(`${sigName} n'est pas une signature minisign (le texte décodé doit commencer par « untrusted comment: »).`);
}

// Sortie
const repo = opt.repo || process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail(`Dépôt « ${repo} » : attendu propriétaire/dépôt.`);
const asset = `Roster-Companion_${version}_x64-setup.exe`;
const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`;
const sha256 = createHash("sha256").update(exe).digest("hex");
const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const latest = { version, notes, pub_date: pubDate, platforms: { [TARGET]: { signature, url } } };

const assets = path.join(opt.out, "assets");
mkdirSync(assets, { recursive: true });
copyFileSync(path.join(opt.dir, exeName), path.join(assets, asset));
writeFileSync(path.join(assets, `${asset}.sig`), `${signature}\n`);
writeFileSync(path.join(assets, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
writeFileSync(path.join(assets, "SHA256SUMS.txt"), `${sha256}  ${asset}\n`);
const body = [
  notes,
  "",
  `Installateur Windows : [${asset}](${url}) (${(exe.length / 1048576).toFixed(1)} Mo, SHA-256 \`${sha256}\`). Pendant la bêta, l'installateur n'est pas signé pour Windows : SmartScreen → « Informations complémentaires » → « Exécuter quand même ».`,
  "",
  "Depuis Roster Companion 0.3.0, l'appli propose cette version toute seule (vérification au démarrage, puis une fois par jour) : « Installer » télécharge l'installateur, vérifie sa signature et relance l'appli.",
].join("\n");
writeFileSync(path.join(opt.out, "notes.md"), `${body}\n`);

const lines = [
  `### Roster Companion ${version} (${tag})`,
  "",
  `- ${asset} : ${exe.length} octets, SHA-256 \`${sha256}\``,
  `- latest.json : ${url}`,
  "",
  notes,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
