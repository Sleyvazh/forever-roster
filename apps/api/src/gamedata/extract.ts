import { PROFESSION_SKILL_LINES } from "@forever/game-data";
import type { ItemDetails } from "@forever/game-data";
import type { Reagent } from "../db/schema";
import { rawFromSparse, type RawItem } from "./details";

/** Tables du client utilisées, avec les colonnes indispensables (contrôlées à l'import). */
export const TABLES = {
  ItemSparse: ["ID", "Display_lang", "ItemLevel", "OverallQualityID", "RequiredLevel", "RequiredSkill", "RequiredSkillRank"],
  Item: ["ID", "ClassID", "SubclassID", "InventoryType"],
  ItemClass: ["ClassID", "ClassName_lang"],
  ItemSubClass: ["ClassID", "SubClassID", "DisplayName_lang"],
  ItemEffect: ["ID", "SpellID", "TriggerType"],
  ItemXItemEffect: ["ItemEffectID", "ItemID"],
  SpellName: ["ID", "Name_lang"],
  SpellEffect: ["SpellID", "Effect", "EffectItemType", "EffectBasePointsF", "EffectMiscValue_0", "EffectTriggerSpell"],
  SpellReagents: ["SpellID", "Reagent_0", "ReagentCount_0"],
  SpellItemEnchantment: ["ID", "Name_lang"],
  SkillLineAbility: ["SkillLine", "Spell", "MinSkillLineRank", "TrivialSkillLineRankLow", "TrivialSkillLineRankHigh", "TradeSkillCategoryID"],
  TradeSkillCategory: ["ID", "Name_lang", "ParentTradeSkillCategoryID"],
} as const;

export type TableName = keyof typeof TABLES;
export type Tables = Record<TableName, Record<string, string>[]>;

export interface ItemRow {
  id: number; name: string; quality: number; itemLevel: number; reqLevel: number; classId: number; subclassId: number; inventoryType: number; kind: string;
  /** « forever » : tables du client Forever ; « era » : objet absent de ces tables, complété avec Classic Era. */
  origin: "forever" | "era";
  /** Données brutes pour l'infobulle (calculée ensuite par addDetails), identifiant du fichier d'icône. */
  raw?: RawItem;
  iconFileId?: number;
  details?: ItemDetails;
}

/**
 * Tables des infobulles (barèmes, sorts, sets). Facultatives : si l'une manque ou change de structure,
 * l'import continue et les infobulles perdent seulement la partie concernée.
 */
export const DETAIL_TABLES = {
  RandPropPoints: ["ID", "EpicF_0", "SuperiorF_0", "GoodF_0"],
  ItemArmorTotal: ["ItemLevel", "Cloth", "Leather", "Mail", "Plate"],
  ItemArmorQuality: ["ID", "Qualitymod_0"],
  ArmorLocation: ["ID", "Clothmodifier", "Leathermodifier", "Chainmodifier", "Platemodifier"],
  ItemArmorShield: ["ItemLevel", "Quality_0"],
  ItemDamageOneHand: ["ItemLevel", "Quality_0"],
  ItemDamageTwoHand: ["ItemLevel", "Quality_0"],
  Spell: ["ID", "Description_lang"],
  ItemSet: ["ID", "Name_lang", "ItemID_0"],
  ItemSetSpell: ["ItemSetID", "SpellID", "Threshold"],
  SpellMisc: ["SpellID", "DurationIndex"],
  SpellDuration: ["ID", "Duration"],
  // Icône quand Item.IconFileDataID vaut 0 : celle de l'apparence de l'objet
  ItemModifiedAppearance: ["ItemID", "ItemAppearanceID", "OrderIndex"],
  ItemAppearance: ["ID", "DefaultIconFileDataID"],
} as const;
export type DetailTableName = keyof typeof DETAIL_TABLES;
export type DetailTables = Partial<Record<DetailTableName, Record<string, string>[]>>;

/** Garde une table de détail seulement si elle a les colonnes attendues. */
export function checkDetailTable(name: DetailTableName, rows: Record<string, string>[] | undefined, warn: (m: string) => void) {
  if (!rows?.length) return undefined;
  const missing = DETAIL_TABLES[name].filter(c => !(c in rows[0]!));
  if (missing.length) { warn(`Table ${name} ignorée (colonnes manquantes : ${missing.join(", ")}).`); return undefined; }
  return rows;
}
/** Tables suffisantes pour lire les objets (import complémentaire depuis Classic Era). */
export const ITEM_TABLES = ["ItemSparse", "Item"] as const;
export type ItemTables = Pick<Tables, "ItemSparse" | "Item" | "ItemClass" | "ItemSubClass">;
export interface RecipeRow {
  spellId: number; skillLine: number; name: string; reqSkill: number; trivialLow: number; trivialHigh: number; category: string;
  createdItemId: number | null; createdCount: number; enchant: string | null; reagents: Reagent[]; taughtBy: number[]; fromItem: boolean;
}

const I = (s: string | undefined) => { const n = Number.parseInt(s ?? "", 10); return Number.isFinite(n) ? n : 0; };
const F = (s: string | undefined) => { const n = Number.parseFloat(s ?? ""); return Number.isFinite(n) ? n : 0; };

// Effets de sort (SpellEffect.Effect) utiles ici
const CREATE_ITEM = 24, LEARN_SPELL = 36, ENCHANT_ITEM = 53, ENCHANT_ITEM_TEMP = 54, ENCHANT_HELD = 92;
const TRIGGER_LEARN = 6; // ItemEffect.TriggerType : « apprendre » (objets Patron, Plans, Recette…)

/** Vérifie que chaque table a les colonnes attendues : si Blizzard change la structure, l'import s'arrête proprement. */
export function checkColumns(tables: Tables) {
  for (const [name, cols] of Object.entries(TABLES) as [TableName, readonly string[]][]) {
    const first = tables[name][0];
    if (!first) throw new Error(`Table ${name} vide.`);
    const missing = cols.filter(c => !(c in first));
    if (missing.length) throw new Error(`Table ${name} : colonnes manquantes ${missing.join(", ")} (structure du client modifiée).`);
  }
}

/** Objets (ItemSparse + Item), avec le libellé de classe / sous-classe et la compétence requise des patrons. */
export function readItems(tables: ItemTables, origin: ItemRow["origin"]) {
  const itemBase = new Map(tables.Item.map(r => [I(r.ID), r]));
  const className = new Map(tables.ItemClass.map(r => [I(r.ClassID), r.ClassName_lang ?? ""]));
  const subName = new Map(tables.ItemSubClass.map(r => [`${I(r.ClassID)}:${I(r.SubClassID)}`, r.DisplayName_lang || r.VerboseName_lang || ""]));
  const items: ItemRow[] = [];
  const skillOfItem = new Map<number, [number, number]>();
  for (const s of tables.ItemSparse) {
    const id = I(s.ID), name = s.Display_lang ?? "";
    if (!id || !name) continue;
    const b = itemBase.get(id);
    const classId = I(b?.ClassID), subclassId = I(b?.SubclassID);
    const kind = [className.get(classId), subName.get(`${classId}:${subclassId}`)].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    const inventoryType = I(b?.InventoryType);
    items.push({
      id, name, quality: Math.max(0, Math.min(7, I(s.OverallQualityID))), itemLevel: I(s.ItemLevel), reqLevel: I(s.RequiredLevel),
      classId, subclassId, inventoryType, kind, origin,
      raw: { ...rawFromSparse(s), classId, subclassId, inventoryType }, iconFileId: I(b?.IconFileDataID) || undefined,
    });
    if (I(s.RequiredSkill)) skillOfItem.set(id, [I(s.RequiredSkill), I(s.RequiredSkillRank)]);
  }
  return { items, skillOfItem };
}

/**
 * Le client Forever ne contient pas tous les objets : une partie n'arrive que par le serveur du jeu
 * (correctifs à chaud), que wago.tools ne publie pas. On complète avec les objets d'origine de Classic Era
 * (identifiants < ERA_MAX_ID, donc hors Saison de la Découverte) absents des tables Forever.
 */
export const ERA_MAX_ID = 30000;
export function fillFromEra(items: ItemRow[], era: ItemRow[]): ItemRow[] {
  const have = new Set(items.map(i => i.id));
  const extra = era.filter(i => i.id < ERA_MAX_ID && !have.has(i.id)).map(i => ({ ...i, origin: "era" as const }));
  return [...items, ...extra];
}

/** Joint les tables du client en objets et recettes de métier prêts à insérer. */
export function extract(tables: Tables): { items: ItemRow[]; recipes: RecipeRow[] } {
  checkColumns(tables);
  const professionLines = new Set(Object.values(PROFESSION_SKILL_LINES));

  const { items, skillOfItem } = readItems(tables, "forever");

  const spellName = new Map(tables.SpellName.map(r => [I(r.ID), r.Name_lang ?? ""]));
  const effects = new Map<number, Record<string, string>[]>();
  for (const e of tables.SpellEffect) {
    const k = I(e.SpellID); (effects.get(k) ?? effects.set(k, []).get(k)!).push(e);
  }
  const reagentsOf = new Map<number, Reagent[]>();
  for (const r of tables.SpellReagents) {
    const list: Reagent[] = [];
    for (let i = 0; i < 8; i++) {
      const id = I(r[`Reagent_${i}`]);
      if (id > 0) list.push({ id, n: I(r[`ReagentCount_${i}`]) || 1 });
    }
    if (list.length && !reagentsOf.has(I(r.SpellID))) reagentsOf.set(I(r.SpellID), list);
  }
  const enchantName = new Map(tables.SpellItemEnchantment.map(r => [I(r.ID), r.Name_lang ?? ""]));

  // Objets qui enseignent un sort : directement (TriggerType 6) ou via un sort « apprendre » (effet 36).
  const itemEffect = new Map(tables.ItemEffect.map(r => [I(r.ID), r]));
  const taughtBy = new Map<number, Set<number>>();
  const teach = (spell: number, item: number) => (taughtBy.get(spell) ?? taughtBy.set(spell, new Set()).get(spell)!).add(item);
  for (const x of tables.ItemXItemEffect) {
    const fx = itemEffect.get(I(x.ItemEffectID));
    if (!fx || I(fx.TriggerType) !== TRIGGER_LEARN) continue;
    const sid = I(fx.SpellID), item = I(x.ItemID);
    teach(sid, item);
    for (const e of effects.get(sid) ?? []) if (I(e.Effect) === LEARN_SPELL && I(e.EffectTriggerSpell)) teach(I(e.EffectTriggerSpell), item);
  }

  const category = new Map(tables.TradeSkillCategory.map(r => [I(r.ID), r]));
  const categoryPath = (id: number) => {
    const names: string[] = [];
    for (let c = category.get(id), guard = 0; c && guard < 5; c = category.get(I(c.ParentTradeSkillCategoryID)), guard++) {
      if (c.Name_lang) names.unshift(c.Name_lang);
    }
    // Le premier niveau est souvent le nom du métier lui-même : on garde le plus précis.
    return names.at(-1) ?? "";
  };

  const recipes: RecipeRow[] = [];
  const seen = new Set<number>();
  for (const r of tables.SkillLineAbility) {
    const spellId = I(r.Spell), skillLine = I(r.SkillLine);
    if (!professionLines.has(skillLine) || seen.has(spellId)) continue;
    const name = spellName.get(spellId);
    let createdItemId: number | null = null, createdCount = 1, enchant: string | null = null;
    for (const e of effects.get(spellId) ?? []) {
      const eff = I(e.Effect);
      if (eff === CREATE_ITEM && I(e.EffectItemType)) { createdItemId = I(e.EffectItemType); createdCount = Math.max(1, Math.round(F(e.EffectBasePointsF))); }
      else if ((eff === ENCHANT_ITEM || eff === ENCHANT_ITEM_TEMP || eff === ENCHANT_HELD) && enchantName.get(I(e.EffectMiscValue_0))) enchant = enchantName.get(I(e.EffectMiscValue_0))!;
    }
    const reagents = reagentsOf.get(spellId) ?? [];
    // Garde les vraies recettes (qui fabriquent, enchantent ou consomment des composants), pas les rangs du métier.
    if (!name || (!createdItemId && !enchant && !reagents.length)) continue;
    seen.add(spellId);
    const teachers = [...(taughtBy.get(spellId) ?? [])].sort((a, b) => a - b);
    const minRank = I(r.MinSkillLineRank);
    // Le seuil « requis » est porté par l'objet Patron quand il existe.
    const fromItemRank = teachers.map(t => skillOfItem.get(t)).filter(v => v && v[0] === skillLine).map(v => v![1]);
    const reqSkill = fromItemRank.length ? Math.max(...fromItemRank) : minRank;
    recipes.push({
      spellId, skillLine, name, reqSkill, trivialLow: I(r.TrivialSkillLineRankLow), trivialHigh: I(r.TrivialSkillLineRankHigh),
      category: categoryPath(I(r.TradeSkillCategoryID)), createdItemId, createdCount, enchant, reagents,
      taughtBy: teachers, fromItem: teachers.length > 0,
    });
  }
  return { items, recipes };
}

/**
 * Recettes en double (même métier, même nom) : le client Forever contient aussi celles de la Saison de la Découverte,
 * dont l'objet fabriqué n'existe pas sur Forever (ex. Dreamscale Breastplate 24703 et 1213751). On garde celle dont
 * l'objet est connu (sinon la plus ancienne) ; `replaced` donne, pour chaque recette écartée, celle qui la remplace.
 */
export function dedupeRecipes(recipes: RecipeRow[], knownItems: Set<number>) {
  const score = (r: RecipeRow) => (r.createdItemId && knownItems.has(r.createdItemId) ? 2 : 0) + (r.taughtBy.some(t => knownItems.has(t)) ? 1 : 0);
  const byName = new Map<string, RecipeRow[]>();
  for (const r of recipes) {
    const k = `${r.skillLine}:${r.name.toLowerCase()}`;
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const keep: RecipeRow[] = [];
  const replaced = new Map<number, number>();
  for (const group of byName.values()) {
    const best = [...group].sort((a, b) => score(b) - score(a) || a.spellId - b.spellId)[0]!;
    // Seulement si une version a un objet connu et l'autre non : deux vraies variantes (ex. rangs) restent toutes les deux
    for (const r of group) {
      if (r === best || score(r) >= 2 || score(best) < 2) keep.push(r);
      else replaced.set(r.spellId, best.spellId);
    }
  }
  return { recipes: keep.sort((a, b) => a.spellId - b.spellId), replaced };
}
