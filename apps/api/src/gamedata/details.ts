import type { ItemDetails } from "@forever/game-data";
import type { DetailTables, ItemRow } from "./extract";

/**
 * Calcul des infobulles à l'import. Le client ne stocke pas « +5 Agilité » : il stocke une part
 * (sur 10 000) d'un budget qui dépend du niveau d'objet, de la qualité et de l'emplacement
 * (RandPropPoints). L'armure et les dégâts des armes viennent de barèmes par niveau d'objet.
 * Formules vérifiées sur des objets connus (Serpent's Shoulders : 68 armure, +5 Agilité ;
 * Arcanite Reaper : 153-256 ; Nightfall : 187-282).
 */

type Row = Record<string, string>;
const I = (s: string | undefined) => { const n = Number.parseInt(s ?? "", 10); return Number.isFinite(n) ? n : 0; };
const F = (s: string | undefined) => { const n = Number.parseFloat(s ?? ""); return Number.isFinite(n) ? n : 0; };

/** Données brutes d'un objet, lues dans les tables ou dans le cache du client. */
export interface RawItem {
  itemLevel: number; quality: number; inventoryType: number; classId: number; subclassId: number;
  bonding: number; maxCount: number; sellPrice: number; delay: number; variance: number; itemSet: number;
  /** [type, part du budget sur 10 000] */
  stats: [number, number][];
}

export function rawFromSparse(s: Row): Omit<RawItem, "classId" | "subclassId" | "inventoryType"> & { inventoryType: number } {
  const stats: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const t = I(s[`StatModifier_bonusStat_${k}`]), a = I(s[`StatPercentEditor_${k}`]);
    if (t > 0 && a) stats.push([t, a]);
  }
  return {
    itemLevel: I(s.ItemLevel), quality: I(s.OverallQualityID), inventoryType: I(s.InventoryType),
    bonding: I(s.Bonding), maxCount: I(s.MaxCount), sellPrice: I(s.SellPrice), delay: I(s.ItemDelay), variance: F(s.DmgVariance),
    itemSet: I(s.ItemSet), stats,
  };
}

/** Barèmes du jeu (tables RandPropPoints, ItemArmor*, ArmorLocation, ItemDamage*). */
export interface Scales {
  budget: Map<number, Row>; armorTotal: Map<number, Row>; armorQuality: Map<number, Row>; armorLocation: Map<number, Row>;
  shield: Map<number, Row>; oneHand: Map<number, Row>; twoHand: Map<number, Row>;
}
export function buildScales(t: { RandPropPoints?: Row[]; ItemArmorTotal?: Row[]; ItemArmorQuality?: Row[]; ArmorLocation?: Row[]; ItemArmorShield?: Row[]; ItemDamageOneHand?: Row[]; ItemDamageTwoHand?: Row[] }): Scales {
  const by = (rows: Row[] | undefined, key: string) => new Map((rows ?? []).map(r => [I(r[key]), r]));
  return {
    budget: by(t.RandPropPoints, "ID"), armorTotal: by(t.ItemArmorTotal, "ItemLevel"), armorQuality: by(t.ItemArmorQuality, "ID"),
    armorLocation: by(t.ArmorLocation, "ID"), shield: by(t.ItemArmorShield, "ItemLevel"),
    oneHand: by(t.ItemDamageOneHand, "ItemLevel"), twoHand: by(t.ItemDamageTwoHand, "ItemLevel"),
  };
}

/** Colonne du budget selon l'emplacement (0 : tête, torse, jambes, deux mains ; 1 : épaules, taille, pieds, mains, bijou ; …). */
const BUDGET_SLOT: Record<number, number> = {
  1: 0, 5: 0, 20: 0, 7: 0, 17: 0, 3: 1, 6: 1, 8: 1, 10: 1, 12: 1,
  2: 2, 9: 2, 11: 2, 16: 2, 23: 2, 14: 2, 13: 3, 21: 3, 22: 3, 15: 4, 25: 4, 26: 4, 28: 4,
};
const budgetColumn = (q: number) => (q >= 4 ? "EpicF" : q === 3 ? "SuperiorF" : "GoodF");
const ARMOR_COLUMN: Record<number, [string, string]> = { 1: ["Cloth", "Clothmodifier"], 2: ["Leather", "Leathermodifier"], 3: ["Mail", "Chainmodifier"], 4: ["Plate", "Platemodifier"] };
const ARMOR = 4, WEAPON = 2, SHIELD = 6;

export function computeDetails(raw: RawItem, sc: Scales): ItemDetails {
  const d: ItemDetails = {};
  if (raw.bonding) d.bond = raw.bonding;
  if (raw.maxCount === 1) d.unique = true;
  if (raw.sellPrice > 0) d.sell = raw.sellPrice;
  const q = Math.min(raw.quality, 6);
  const inv = raw.inventoryType === 20 ? 5 : raw.inventoryType; // robe = torse

  // Caractéristiques
  const slot = BUDGET_SLOT[raw.inventoryType];
  const b = sc.budget.get(raw.itemLevel);
  if (raw.stats.length && b && slot !== undefined) {
    const points = F(b[`${budgetColumn(q)}_${slot}`]);
    const stats = raw.stats.map(([t, a]) => [t, Math.round((a * points) / 10000)] as [number, number]).filter(([, v]) => v !== 0);
    if (stats.length) d.stats = stats;
  }

  // Armure
  if (raw.classId === ARMOR) {
    let armor = 0;
    const col = ARMOR_COLUMN[raw.subclassId];
    if (col) {
      const total = F(sc.armorTotal.get(raw.itemLevel)?.[col[0]]);
      const loc = F(sc.armorLocation.get(inv)?.[col[1]]);
      const qual = F(sc.armorQuality.get(raw.itemLevel)?.[`Qualitymod_${q}`]);
      armor = Math.round(total * loc * qual);
    } else if (raw.subclassId === SHIELD) {
      armor = I(sc.shield.get(raw.itemLevel)?.[`Quality_${q}`]);
    }
    if (armor > 0) d.armor = armor;
  }

  // Armes de mêlée (les armes à distance utilisent un autre barème, pas encore identifié)
  if (raw.classId === WEAPON && raw.delay > 0) {
    const table = inv === 17 ? sc.twoHand : [13, 21, 22].includes(inv) ? sc.oneHand : null;
    const dps = F(table?.get(raw.itemLevel)?.[`Quality_${q}`]);
    const speed = raw.delay / 1000;
    if (dps > 0) {
      const v = raw.variance;
      d.dmg = { min: Math.floor(dps * speed * (1 - v / 2)), max: Math.floor(dps * speed * (1 + v / 2) + 0.5), speed, dps: Math.round(dps * 10) / 10 };
    }
  }
  return d;
}

/* ---------- Effets (sorts) et sets ---------- */

export interface SpellTexts { describe(spellId: number): string | null }

/**
 * Descriptions de sorts avec leurs valeurs : $s1 / $m1 (points de l'effet 1), $t1 (période), $x1 (cibles), $d (durée),
 * $lsingulier:pluriel; et $gil:elle;. Ce qui ne peut pas être calculé est retiré proprement.
 */
export function buildSpellTexts(t: { Spell?: Row[]; SpellEffect?: Row[]; SpellMisc?: Row[]; SpellDuration?: Row[] }): SpellTexts {
  const desc = new Map((t.Spell ?? []).map(r => [I(r.ID), r.Description_lang ?? ""]));
  const effects = new Map<number, Map<number, Row>>();
  for (const e of t.SpellEffect ?? []) {
    const sid = I(e.SpellID);
    if (I(e.DifficultyID)) continue;
    (effects.get(sid) ?? effects.set(sid, new Map()).get(sid)!).set(I(e.EffectIndex), e);
  }
  const durationById = new Map((t.SpellDuration ?? []).map(r => [I(r.ID), I(r.Duration)]));
  const durationOf = new Map((t.SpellMisc ?? []).map(r => [I(r.SpellID), durationById.get(I(r.DurationIndex)) ?? 0]));
  const fmtDuration = (ms: number) => {
    const s = Math.round(ms / 1000);
    if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
    if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
    return `${s} s`;
  };

  function resolve(text: string, sid: number, depth = 0): string {
    const eff = effects.get(sid);
    const val = (n: number) => { const e = eff?.get(n - 1); return e ? Math.abs(Math.round(F(e.EffectBasePointsF))) : null; };
    const num = (x: number, decimals?: string) => {
      const d = decimals ? Number(decimals) : Number.isInteger(x) ? 0 : 1;
      return x.toFixed(d).replace(/\.0+$/, "");
    };
    let out = text
      // Expressions : ${$s1/10}.1 → valeur calculée, avec le nombre de décimales demandé
      .replace(/\$\{([^}]*)\}(?:\.(\d))?/g, (_m, expr: string, dec?: string) => {
        const e = expr.replace(/\$[sSmM](\d)/g, (_x, n: string) => String(val(Number(n)) ?? "NaN"));
        const v = evaluate(e);
        return v === null ? "" : num(v, dec);
      })
      // $/10;s1 → points divisés par 10
      .replace(/\$\/(\d+);(\d*)[sSmM](\d)/g, (_m, div: string, other: string, n: string) => {
        if (other) return "";
        const v = val(Number(n)); return v === null ? "" : num(v / Number(div));
      })
      // « pendant $d » sans durée connue : on retire toute la tournure
      .replace(/\s+(?:for|over)\s+\$[dD]\b/g, m => (durationOf.get(sid) ? m : ""))
      // Référence à un autre sort : $12345s1
      .replace(/\$(\d+)([sSmMdtxo])(\d?)/g, (_m, id: string, k: string, n: string) => depth ? "" : resolve(`$${k}${n}`, Number(id), 1))
      .replace(/\$[sSmM](\d)/g, (_m, n: string) => String(val(Number(n)) ?? ""))
      .replace(/\$[tT](\d)/g, (_m, n: string) => { const p = I(eff?.get(Number(n) - 1)?.EffectAuraPeriod); return p ? String(p / 1000) : ""; })
      .replace(/\$[xX](\d)/g, (_m, n: string) => String(I(eff?.get(Number(n) - 1)?.EffectChainTargets) || ""))
      .replace(/\$[oO](\d)/g, (_m, n: string) => {
        const e = eff?.get(Number(n) - 1); const p = I(e?.EffectAuraPeriod), dur = durationOf.get(sid) ?? 0;
        return e && p && dur ? String(Math.abs(Math.round(F(e.EffectBasePointsF))) * Math.floor(dur / p)) : "";
      })
      .replace(/\$[dD]\b/g, () => { const ms = durationOf.get(sid); return ms && ms > 0 ? fmtDuration(ms) : ""; })
      .replace(/\$[lL]([^:;]*):([^;]*);/g, (_m, one: string, many: string) => many || one)
      .replace(/\$[gG]([^:;]*):([^;]*);/g, (_m, a: string) => a)
      .replace(/\$\{[^}]*\}/g, "")
      .replace(/\$[a-zA-Z]+\d*/g, "");
    out = out.replace(/\s+([.,])/g, "$1").replace(/\s{2,}/g, " ").trim();
    return out;
  }
  return { describe: sid => { const d = desc.get(sid); return d ? resolve(d, sid) : null; } };
}

/** Effets d'objets (ItemEffect par ItemXItemEffect) : Utiliser, Équipé, Chances quand vous touchez. */
export function itemEffects(t: { ItemEffect?: Row[]; ItemXItemEffect?: Row[] }, spells: SpellTexts) {
  const effect = new Map((t.ItemEffect ?? []).map(r => [I(r.ID), r]));
  const out = new Map<number, { trigger: number; text: string }[]>();
  for (const x of t.ItemXItemEffect ?? []) {
    const e = effect.get(I(x.ItemEffectID));
    const trigger = I(e?.TriggerType);
    if (!e || trigger > 2) continue; // 6 : « apprendre » (patrons), traité ailleurs
    const text = spells.describe(I(e.SpellID));
    if (!text) continue;
    const item = I(x.ItemID);
    (out.get(item) ?? out.set(item, []).get(item)!).push({ trigger, text });
  }
  return out;
}

/** Sets : nom, pièces (noms résolus plus tard) et bonus par nombre de pièces. */
export function itemSets(t: { ItemSet?: Row[]; ItemSetSpell?: Row[] }, spells: SpellTexts) {
  const bonuses = new Map<number, { n: number; text: string }[]>();
  for (const r of t.ItemSetSpell ?? []) {
    const text = spells.describe(I(r.SpellID));
    if (!text) continue;
    const id = I(r.ItemSetID);
    (bonuses.get(id) ?? bonuses.set(id, []).get(id)!).push({ n: I(r.Threshold), text });
  }
  const sets = new Map<number, { name: string; itemIds: number[]; bonuses: { n: number; text: string }[] }>();
  for (const r of t.ItemSet ?? []) {
    const itemIds = Array.from({ length: 17 }, (_, k) => I(r[`ItemID_${k}`])).filter(Boolean);
    sets.set(I(r.ID), { name: r.Name_lang ?? "", itemIds, bonuses: (bonuses.get(I(r.ID)) ?? []).sort((a, b) => a.n - b.n) });
  }
  return sets;
}

/** Petit évaluateur arithmétique (+ - * / parenthèses) : jamais d'eval sur des données externes. */
export function evaluate(expr: string): number | null {
  const src = expr.replace(/\s+/g, "");
  if (!/^[0-9.+\-*/()]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const factor = (): number => {
    if (peek() === "-") { i++; return -factor(); }
    if (peek() === "(") { i++; const v = sum(); if (src[i++] !== ")") throw new Error(); return v; }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error();
    i += m[0].length; return Number(m[0]);
  };
  const product = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") { const op = src[i++]; const r = factor(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = product(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  try { const v = sum(); return i === src.length && Number.isFinite(v) ? v : null; } catch { return null; }
}

/**
 * Calcule l'infobulle de chaque objet (stats, armure, dégâts, effets, set) à partir des données brutes.
 * Les noms des pièces de set sont pris dans la liste finale des objets.
 */
export function addDetails(items: ItemRow[], t: DetailTables & { ItemEffect?: Row[]; ItemXItemEffect?: Row[]; SpellEffect?: Row[] }) {
  const scales = buildScales(t);
  const spells = buildSpellTexts(t);
  const effects = itemEffects(t, spells);
  const sets = itemSets(t, spells);
  const nameOf = new Map(items.map(i => [i.id, i.name]));
  for (const it of items) {
    const d: ItemDetails = it.raw ? computeDetails(it.raw, scales) : {};
    const fx = effects.get(it.id);
    if (fx?.length) d.effects = fx;
    const set = it.raw?.itemSet ? sets.get(it.raw.itemSet) : undefined;
    if (set) d.set = { id: it.raw!.itemSet, name: set.name, items: set.itemIds.map(id => nameOf.get(id)).filter((n): n is string => !!n), bonuses: set.bonuses };
    it.details = d;
  }
}

/** Noms des icônes (listfile communautaire : « 135039;interface/icons/inv_shoulder_08.blp »), lus au fil du téléchargement. */
export async function iconNames(fileIds: Set<number>, lines: AsyncIterable<string>): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for await (const line of lines) {
    const i = line.indexOf(";");
    if (i < 0) continue;
    const id = Number(line.slice(0, i));
    if (!fileIds.has(id)) continue;
    const m = /interface\/icons\/([a-z0-9_\-]+)\.blp$/i.exec(line.slice(i + 1).trim());
    if (m) out.set(id, m[1]!.toLowerCase());
    if (out.size === fileIds.size) break;
  }
  return out;
}

/**
 * Icône par l'apparence : beaucoup d'objets (surtout ceux ajoutés par Forever) ont Item.IconFileDataID = 0,
 * et le jeu prend alors l'icône de leur apparence (ItemModifiedAppearance → ItemAppearance.DefaultIconFileDataID).
 * On garde l'apparence de plus petit OrderIndex (celle de base).
 */
export function appearanceIcons(tables: Pick<DetailTables, "ItemModifiedAppearance" | "ItemAppearance">) {
  const icon = new Map<number, number>();
  for (const r of tables.ItemAppearance ?? []) { const f = Number(r.DefaultIconFileDataID); if (f > 0) icon.set(Number(r.ID), f); }
  const best = new Map<number, { order: number; fid: number }>();
  for (const r of tables.ItemModifiedAppearance ?? []) {
    const fid = icon.get(Number(r.ItemAppearanceID)); if (!fid) continue;
    const item = Number(r.ItemID), order = Number(r.OrderIndex) || 0;
    const cur = best.get(item);
    if (!cur || order < cur.order) best.set(item, { order, fid });
  }
  return new Map([...best].map(([k, v]) => [k, v.fid]));
}
