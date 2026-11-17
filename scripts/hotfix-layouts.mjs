#!/usr/bin/env node
/**
 * Génère apps/api/src/gamedata/hotfix-layouts.ts : la disposition des lignes de chaque table du client utilisée par
 * l'import, pour lire les correctifs du cache du jeu (DBCache.bin). Source : WoWDBDefs (définitions communautaires des
 * tables, https://github.com/wowdev/WoWDBDefs), bloc LAYOUT de la version de Forever demandée.
 *
 *   node scripts/hotfix-layouts.mjs 1.60.1.70938
 *
 * À relancer quand Forever change de version et que l'import signale des lignes du cache illisibles.
 * Sans version exacte dans les définitions, prend le bloc de la version 1.60 la plus récente (avec un avertissement).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW = "https://raw.githubusercontent.com/wowdev/WoWDBDefs/master";
const build = process.argv[2];
if (!/^\d+\.\d+\.\d+\.\d+$/.test(build ?? "")) { console.error("Usage : node scripts/hotfix-layouts.mjs 1.60.1.70938"); process.exit(1); }
const branch = build.split(".").slice(0, 2).join(".");

// Tables lues par l'import (apps/api/src/gamedata/extract.ts : TABLES et DETAIL_TABLES)
const TABLES = [
  "ItemSparse", "Item", "ItemClass", "ItemSubClass", "ItemEffect", "ItemXItemEffect", "SpellName", "SpellEffect", "SpellReagents",
  "SpellItemEnchantment", "SkillLineAbility", "TradeSkillCategory",
  "RandPropPoints", "ItemArmorTotal", "ItemArmorQuality", "ArmorLocation", "ItemArmorShield", "ItemDamageOneHand", "ItemDamageTwoHand",
  "Spell", "ItemSet", "ItemSetSpell", "SpellMisc", "SpellDuration", "ItemModifiedAppearance", "ItemAppearance",
  "TraitNode", "TraitNodeEntry", "TraitDefinition", "TraitNodeXTraitNodeEntry", "TraitEdge",
];

const get = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res.text();
};
const cmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

const manifest = JSON.parse(await get(`${RAW}/manifest.json`));
const hashOf = new Map(manifest.filter(e => e.tableHash).map(e => [e.tableName, e.tableHash]));

const out = [];
for (const table of TABLES) {
  const hash = hashOf.get(table);
  if (!hash) { console.warn(`${table} : pas d'empreinte dans le manifeste, ignorée.`); continue; }
  const text = (await get(`${RAW}/definitions/${table}.dbd`)).replace(/\r/g, "");
  const [head, ...blocks] = text.split(/\n(?=LAYOUT )/);
  // COLUMNS : type de chaque colonne (int, float, string, locstring)
  const types = new Map();
  for (const line of head.split("\n").slice(1)) {
    const m = line.match(/^(int|uint|float|string|locstring)(?:<[^>]*>)?\s+([A-Za-z0-9_]+)\??/);
    if (m) types.set(m[2], m[1]);
  }
  // Bloc LAYOUT de la version demandée, sinon celui de la version la plus récente de la même branche
  let best = null;
  for (const b of blocks) {
    const builds = [...b.matchAll(/^BUILD (.+)$/gm)].flatMap(m => m[1].split(",").map(s => s.trim())).filter(s => !s.includes("-"));
    const ranges = [...b.matchAll(/^BUILD (.+)$/gm)].flatMap(m => m[1].split(",").map(s => s.trim())).filter(s => s.includes("-"));
    const exact = builds.includes(build) || ranges.some(r => { const [lo, hi] = r.split("-"); return cmp(lo, build) <= 0 && cmp(build, hi) <= 0; });
    const same = builds.filter(s => s.startsWith(`${branch}.`)).sort(cmp).at(-1);
    if (exact) { best = { b, exact: true }; break; }
    if (same && (!best || cmp(same, best.latest) > 0)) best = { b, exact: false, latest: same };
  }
  if (!best) { console.warn(`${table} : aucune disposition pour ${branch}, ignorée.`); continue; }
  if (!best.exact) console.warn(`${table} : pas de disposition pour ${build}, celle de ${best.latest} est utilisée.`);
  const layout = best.b.match(/^LAYOUT ([0-9A-F, ]+)/m)[1].split(",")[0].trim();
  const fields = [];
  for (const raw of best.b.split("\n").slice(1)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line || /^(BUILD|COMMENT|LAYOUT)\b/.test(line)) continue;
    const m = line.match(/^(?:\$([a-z,]+)\$)?([A-Za-z0-9_]+)(?:<(u?)(\d+)>)?(?:\[(\d+)\])?$/);
    if (!m) throw new Error(`${table} : ligne de disposition illisible « ${line} »`);
    const [, ann = "", name, unsigned, bits, count] = m;
    // L'identifiant hors ligne n'est pas dans les données du correctif (il est dans l'en-tête de l'enregistrement)
    if (ann.split(",").includes("noninline") && ann.split(",").includes("id")) continue;
    const type = types.get(name);
    if (!type) throw new Error(`${table} : colonne ${name} absente de COLUMNS`);
    const code = type === "float" ? "f32" : type === "string" || type === "locstring" ? "s" : `${unsigned || type === "uint" ? "u" : "i"}${bits ?? 32}`;
    fields.push(`${name}:${code}${count ? `*${count}` : ""}`);
  }
  out.push(`  ${table}: { hash: 0x${hash.toLowerCase()}, layout: "${layout}", fields: "${fields.join(" ")}" },`);
  console.log(`${table} : ${fields.length} champs (${layout}${best.exact ? "" : `, ${best.latest}`})`);
}

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/api/src/gamedata/hotfix-layouts.ts");
writeFileSync(file, `/**
 * Disposition des lignes des tables du client de Forever ${build}, pour lire les correctifs du cache du jeu (hotfix.ts).
 * Généré par scripts/hotfix-layouts.mjs d'après WoWDBDefs : ne pas modifier à la main.
 * Champs dans l'ordre des données : nom:type[*nombre] ; types i8 u8 i16 u16 i32 u32 i64 u64 f32, s = chaîne terminée par un zéro.
 */
export const HOTFIX_BUILD = "${build}";
export const HOTFIX_LAYOUTS: Record<string, { hash: number; layout: string; fields: string }> = {
${out.join("\n")}
};
`);
console.log(`Écrit : ${path.relative(process.cwd(), file)}`);
