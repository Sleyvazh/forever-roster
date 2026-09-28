import { PROFESSION_SKILL_LINES } from "@forever/game-data";
import type { Reagent } from "../db/schema";

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

export interface ItemRow { id: number; name: string; quality: number; itemLevel: number; reqLevel: number; classId: number; subclassId: number; inventoryType: number; kind: string }
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

/** Joint les tables du client en objets et recettes de métier prêts à insérer. */
export function extract(tables: Tables): { items: ItemRow[]; recipes: RecipeRow[] } {
  checkColumns(tables);
  const professionLines = new Set(Object.values(PROFESSION_SKILL_LINES));

  const itemBase = new Map(tables.Item.map(r => [I(r.ID), r]));
  const className = new Map(tables.ItemClass.map(r => [I(r.ClassID), r.ClassName_lang ?? ""]));
  const subName = new Map(tables.ItemSubClass.map(r => [`${I(r.ClassID)}:${I(r.SubClassID)}`, r.DisplayName_lang || r.VerboseName_lang || ""]));

  const items: ItemRow[] = [];
  const itemById = new Map<number, ItemRow>();
  const skillOfItem = new Map<number, [number, number]>();
  for (const s of tables.ItemSparse) {
    const id = I(s.ID), name = s.Display_lang ?? "";
    if (!id || !name) continue;
    const b = itemBase.get(id);
    const classId = I(b?.ClassID), subclassId = I(b?.SubclassID);
    const kind = [className.get(classId), subName.get(`${classId}:${subclassId}`)].filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    const row: ItemRow = {
      id, name, quality: Math.max(0, Math.min(7, I(s.OverallQualityID))), itemLevel: I(s.ItemLevel), reqLevel: I(s.RequiredLevel),
      classId, subclassId, inventoryType: I(b?.InventoryType), kind,
    };
    items.push(row); itemById.set(id, row);
    if (I(s.RequiredSkill)) skillOfItem.set(id, [I(s.RequiredSkill), I(s.RequiredSkillRank)]);
  }

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
