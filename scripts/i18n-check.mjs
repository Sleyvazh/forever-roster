#!/usr/bin/env node
// Version anglaise du site (10/11/2026) : vérifie le catalogue apps/web/src/i18n/en.json, comme locale_check.lua pour l'addon.
//   node scripts/i18n-check.mjs            → échoue si un texte du code n'a pas sa traduction, si une traduction ne sert
//                                            plus, ou si les {variables} diffèrent entre le français et l'anglais
//   node scripts/i18n-check.mjs --missing  → écrit les textes sans traduction (JSON, valeurs vides) pour les remplir
// Textes repérés : t("…"), tx("…"), N("…") et les deux textes de tn(n, "…", "…"), entre "", '' ou `` (sans ${}).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "apps/web/src");
const catalogFile = path.join(src, "i18n/en.json");

function files(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    // i18n.tsx : ses exemples en commentaire ne sont pas des textes du site
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && p !== path.join(src, "i18n.tsx") ? [p] : [];
  });
}

const LIT = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`(?:[^\`\\$]|\\.)*\`)`;
const ONE = new RegExp(String.raw`(?<![\w.$])(?:t|tx|N)\(\s*` + LIT, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.$])tn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*` + LIT + String.raw`\s*,\s*` + LIT, "g");

function unquote(lit) {
  const q = lit[0], body = lit.slice(1, -1);
  if (q === '"') return JSON.parse(lit);
  return body.replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t" })[c] ?? c);
}

const used = new Map(); // texte → premier endroit vu
for (const f of files(src)) {
  const text = readFileSync(f, "utf8");
  const where = (i) => `${path.relative(root, f)}:${text.slice(0, i).split("\n").length}`;
  for (const m of text.matchAll(ONE)) if (!used.has(unquote(m[1]))) used.set(unquote(m[1]), where(m.index));
  for (const m of text.matchAll(PLURAL)) for (const lit of [m[1], m[2]]) if (!used.has(unquote(lit))) used.set(unquote(lit), where(m.index));
}

// Libellés français de packages/game-data affichés par le site à travers i18n/game.ts : leurs valeurs comptent comme des textes
const GAME_LABELS = [
  ["core.ts", "SIGNUP_LABEL"], ["core.ts", "SIGNUP_HINT"],
  ["loot.ts", "LOOT_MODE_LABEL"], ["loot.ts", "LOOT_MODE_HINT"], ["loot.ts", "RETAIL_LOOT_MODE_LABEL"], ["loot.ts", "RETAIL_LOOT_MODE_HINT"],
  ["loot.ts", "LOOT_RESPONSE_LABEL"], ["loot.ts", "LOOT_METHOD_LABEL"], ["loot.ts", "LOOT_CATEGORY_LABEL"],
  ["prep.ts", "CONSUMABLE_TARGET_LABEL"], ["raidlog.ts", "ATTENDANCE_LABEL"],
];
for (const [f, name] of GAME_LABELS) {
  const text = readFileSync(path.join(root, "packages/game-data/src", f), "utf8");
  const start = text.search(new RegExp(String.raw`(?:export )?const ${name}\b[^=]*=\s*\{`));
  if (start < 0) { console.log(`  ${f} : table ${name} introuvable`); process.exit(1); }
  let i = text.indexOf("{", start), depth = 0, end = i;
  for (; end < text.length; end++) { if (text[end] === "{") depth++; else if (text[end] === "}" && --depth === 0) break; }
  for (const m of text.slice(i, end).matchAll(/:\s*("(?:[^"\\]|\\.)*")/g)) {
    const k = JSON.parse(m[1]);
    if (!used.has(k)) used.set(k, `packages/game-data/src/${f} (${name})`);
  }
}

const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");

if (process.argv.includes("--missing")) {
  const missing = {};
  for (const [k] of used) if (!catalog[k]) missing[k] = "";
  process.stdout.write(JSON.stringify(missing, null, 2) + "\n");
  process.exit(0);
}

const problems = [];
for (const [k, at] of used) {
  if (!catalog[k]) problems.push(`${at} : pas de traduction anglaise pour « ${k} »`);
  else if (vars(k) !== vars(catalog[k])) problems.push(`${at} : variables différentes pour « ${k} » (${vars(k) || "aucune"} / ${vars(catalog[k]) || "aucune"})`);
}
for (const k of Object.keys(catalog)) if (!used.has(k)) problems.push(`traduction inutile (i18n/en.json) : « ${k} »`);

console.log(`Site : ${used.size} textes à traduire, ${Object.keys(catalog).length} traductions`);
if (problems.length) {
  for (const p of problems) console.log("  " + p);
  console.log(`${problems.length} problème(s)`);
  process.exit(1);
}
console.log("Textes du site : tout est bon");
