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
