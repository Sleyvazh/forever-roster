#!/usr/bin/env node
// Version anglaise (10/11/2026) : vérifie les catalogues anglais du site (apps/web/src/i18n/en.json) et de l'API
// (apps/api/src/i18n/en.json), comme locale_check.lua pour l'addon.
//   node scripts/i18n-check.mjs                 → échoue si un texte du code n'a pas sa traduction, si une traduction ne
//                                                 sert plus, ou si les {variables} diffèrent entre le français et l'anglais
//   node scripts/i18n-check.mjs --missing [api] → écrit les textes sans traduction du site (ou de l'API) : JSON, valeurs
//                                                 vides, pour les remplir
// Site : t("…"), tx("…"), N("…") et les deux textes de tn(n, "…", "…"). API : badRequest("…"), forbidden("…"),
// notFound("…"), conflict("…"), unauthorized("…"), new HttpError(status, "…"), tr(lang, "…"), N("…"), msg("…") et les deux textes
// de trn(lang, n, "…", "…"). Entre "", '' ou `` (sans ${} : des {variables}).
// Le site refuse aussi t(), tx() et tn() appelés au chargement d'un module (hors de toute fonction) : le texte y resterait
// en français ; hors d'un composant, on marque le texte avec N("…") et on le traduit à l'affichage avec t().
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(import.meta.url)("typescript");
const gameData = (f) => path.join(root, "packages/game-data/src", f);

// Libellés français de packages/game-data montrés par le site ou l'API à travers leur traduction : leurs valeurs comptent
// comme des textes (chaînes de la valeur d'une table, pas ses noms de propriétés)
const GAME_LABELS_SITE = [
  ["core.ts", "SIGNUP_LABEL"], ["core.ts", "SIGNUP_HINT"],
  ["loot.ts", "LOOT_MODE_LABEL"], ["loot.ts", "LOOT_MODE_HINT"], ["loot.ts", "RETAIL_LOOT_MODE_LABEL"], ["loot.ts", "RETAIL_LOOT_MODE_HINT"],
  ["loot.ts", "LOOT_RESPONSE_LABEL"], ["loot.ts", "LOOT_METHOD_LABEL"], ["loot.ts", "LOOT_CATEGORY_LABEL"],
  ["prep.ts", "CONSUMABLE_TARGET_LABEL"], ["raidlog.ts", "ATTENDANCE_LABEL"],
  ["bank.ts", "ITEM_VERBS"], ["bank.ts", "MONEY_TEXTS"], ["bank.ts", "BANK_REQUEST_STATUS_LABEL"],
  ["addon-errors.ts", "ADDON_ERROR_TEXTS"],
];
const GAME_LABELS_API = [["addon-errors.ts", "ADDON_ERROR_TEXTS"]];

const DOMAINS = {
  site: {
    name: "Site", dir: "apps/web/src", catalog: "apps/web/src/i18n/en.json",
    // i18n.tsx : ses exemples en commentaire ne sont pas des textes du site
    skip: ["apps/web/src/i18n.tsx"],
    calls: { t: [0], tx: [0], N: [0], tn: [1, 2] }, news: {}, moduleRule: true, game: GAME_LABELS_SITE,
  },
  api: {
    name: "API", dir: "apps/api/src", catalog: "apps/api/src/i18n/en.json",
    skip: ["apps/api/src/lib/i18n.ts"],
    calls: { tr: [1], trn: [2, 3], N: [0], msg: [0], badRequest: [0], forbidden: [0], notFound: [0], conflict: [0], unauthorized: [0] },
    news: { HttpError: [1] }, moduleRule: false, game: GAME_LABELS_API,
  },
};

function files(dir, skip) {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p, skip);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !skip.includes(path.relative(root, p)) ? [p] : [];
  });
}

/** Textes d'une table de game-data : chaînes de sa valeur (une expression régulière ou un nom de propriété n'en sont pas). */
function tableTexts(file, name) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let init = null;
  const find = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) init = n.initializer;
    if (!init) ts.forEachChild(n, find);
  };
  find(sf);
  if (!init) return null;
  const out = [];
  const walk = (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) out.push(n.text);
    ts.forEachChild(n, walk);
  };
  walk(init);
  return out;
}

function check(d) {
  const used = new Map(); // texte → premier endroit vu
  const problems = [];
  for (const f of files(path.join(root, d.dir), d.skip)) {
    const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n) => `${path.relative(root, f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    // Un choix « cond ? "a" : "b" » compte ses deux textes ; un argument calculé (variable, table) doit avoir été marqué N("…")
    const keys = (n, fn) => {
      while (ts.isParenthesizedExpression(n)) n = n.expression;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { if (!used.has(n.text)) used.set(n.text, at(n)); }
      else if (ts.isConditionalExpression(n)) { keys(n.whenTrue, fn); keys(n.whenFalse, fn); }
      else if (ts.isTemplateExpression(n)) problems.push(`${at(n)} : gabarit \`…\${}\` dans ${fn}() : mettre des {variables}`);
    };
    const visit = (n, inFn) => {
      inFn ||= ts.isFunctionLike(n);
      const call = ts.isCallExpression(n) ? d.calls : ts.isNewExpression(n) ? d.news : null;
      if (call && ts.isIdentifier(n.expression) && Object.hasOwn(call, n.expression.text)) {
        const name = n.expression.text;
        for (const i of call[name]) if (n.arguments?.[i]) keys(n.arguments[i], name);
        if (d.moduleRule && !inFn && name !== "N") problems.push(`${at(n)} : ${name}() appelé au chargement du module (N("…") puis t() à l'affichage)`);
      }
      ts.forEachChild(n, c => visit(c, inFn));
    };
    visit(sf, false);
  }
  for (const [f, name] of d.game) {
    const texts = tableTexts(gameData(f), name);
    if (!texts) { problems.push(`packages/game-data/src/${f} : table ${name} introuvable`); continue; }
    for (const k of texts) if (!used.has(k)) used.set(k, `packages/game-data/src/${f} (${name})`);
  }
  return { used, problems };
}

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");

const mi = process.argv.indexOf("--missing");
if (mi >= 0) {
  const d = DOMAINS[process.argv[mi + 1] === "api" ? "api" : "site"];
  const catalog = JSON.parse(readFileSync(path.join(root, d.catalog), "utf8"));
  const missing = {};
  for (const [k] of check(d).used) if (!catalog[k]) missing[k] = "";
  process.stdout.write(JSON.stringify(missing, null, 2) + "\n");
  process.exit(0);
}

let failed = false;
for (const d of Object.values(DOMAINS)) {
  const { used, problems } = check(d);
  const catalog = JSON.parse(readFileSync(path.join(root, d.catalog), "utf8"));
  for (const [k, at] of used) {
    if (!catalog[k]) problems.push(`${at} : pas de traduction anglaise pour « ${k} »`);
    else if (vars(k) !== vars(catalog[k])) problems.push(`${at} : variables différentes pour « ${k} » (${vars(k) || "aucune"} / ${vars(catalog[k]) || "aucune"})`);
  }
  for (const k of Object.keys(catalog)) if (!used.has(k)) problems.push(`traduction inutile (${d.catalog}) : « ${k} »`);
  console.log(`${d.name} : ${used.size} textes à traduire, ${Object.keys(catalog).length} traductions`);
  if (problems.length) {
    for (const p of problems) console.log("  " + p);
    console.log(`${problems.length} problème(s)`);
    failed = true;
  } else console.log(`Textes ${d.name === "Site" ? "du site" : "de l'API"} : tout est bon`);
}
if (failed) process.exit(1);
