import {
  ATTENDANCE_LABEL, BANK_REQUEST_STATUS_LABEL, bankItemVerb, bankMoneyText, CONSUMABLE_TARGET_LABEL, LOOT_CATEGORY_LABEL, LOOT_COUNT_DAYS, LOOT_METHOD_LABEL, LOOT_RESPONSE_LABEL, SIGNUP_HINT,
  SIGNUP_LABEL, lootCategoryText, lootModeHint, lootModeLabel, professionTier,
  type AttendanceStatus, type BankRequestStatus, type ConsumableTarget, type Game, type LootCategory, type LootCategoryCounts, type LootMethod, type LootMode,
  type LootResponse, type LootSettings, type SignupStatus,
} from "@forever/game-data";
import { N, t } from "../i18n";

/**
 * Libellés français de @forever/game-data (partagés avec l'API et le bot), traduits pour l'affichage du site.
 * scripts/i18n-check.mjs lit ces tables dans packages/game-data (liste GAME_LABELS) : chaque libellé doit avoir sa
 * traduction dans en.json, comme les textes du site.
 */
export const signupLabel = (s: SignupStatus) => t(SIGNUP_LABEL[s]);
export const signupHint = (s: SignupStatus) => t(SIGNUP_HINT[s]);
export const lootModeName = (mode: LootMode, game: Game, short = false) => t(lootModeLabel(mode, game, short));
export const lootModeHintText = (mode: LootMode, game: Game) => t(lootModeHint(mode, game));
export const lootResponseLabel = (r: LootResponse) => t(LOOT_RESPONSE_LABEL[r]);
export const lootMethodLabel = (m: LootMethod) => t(LOOT_METHOD_LABEL[m]);
export const lootCategoryLabel = (c: LootCategory) => t(LOOT_CATEGORY_LABEL[c]);
export const consumableTargetLabel = (c: ConsumableTarget) => t(CONSUMABLE_TARGET_LABEL[c]);
export const attendanceLabel = (s: AttendanceStatus) => t(ATTENDANCE_LABEL[s]);
/** Banque de guilde : statut d'une demande de retrait, verbes des journaux (« a déposé ») ; un type inconnu « (xyz) » reste tel quel. */
export const bankRequestStatusLabel = (s: BankRequestStatus) => t(BANK_REQUEST_STATUS_LABEL[s]);
export const bankItemVerbText = (type: string) => { const v = bankItemVerb(type); return v.startsWith("(") ? v : t(v); };
export const bankMoneyVerb = (type: string) => { const v = bankMoneyText(type).verb; return v.startsWith("(") ? v : t(v); };

// Textes écrits en dur dans les fonctions de game-data (lootModeLabel, parseTalentLink) : déclarés ici pour la traduction
N("Conseil");
N("Ce n'est pas une adresse valide : colle le lien complet copié depuis le calculateur.");
N("Seuls les liens du calculateur foreverchanges.pro/talents sont reconnus.");
N("Le lien doit pointer vers le calculateur de talents (…/talents/<classe>).");
N("Le build contenu dans le lien est illisible.");
/** Erreur d'un lien de talents mal formé (parseTalentLink). */
export const talentLinkError = (e: string) => t(e);

// Qualités d'objet (ITEM_QUALITIES, puis les deux du jeu moderne) et paliers de métier (professionTier)
const QUALITY = [N("Médiocre"), N("Commun"), N("Inhabituel"), N("Rare"), N("Épique"), N("Légendaire"), N("Artefact"), N("Héritage")];
N("Artisan"); N("Expert"); N("Compagnon"); N("Apprenti"); N("Non appris");
/** Qualité d'un objet, de 0 (Médiocre) à 7 (Héritage). */
export const itemQualityLabel = (q: number) => (QUALITY[q] ? t(QUALITY[q]!) : String(q));
/** Les qualités dans l'ordre, pour une liste de choix. */
export const itemQualityLabels = () => QUALITY.map(q => t(q));
/** Palier d'un métier selon la compétence : « Artisan », « Expert »… */
export const professionTierText = (skill: number) => t(professionTier(skill));
// Arbres de l'héritage (LEGACY_TREES) : leur description
N("Montée de compétence, récolte, or"); N("Leveling et déplacements"); N("Entretien, buffs, réputation, honneur");
/** Description d'un arbre de l'héritage (LEGACY_TREES). */
export const legacyTreeDesc = (desc: string) => t(desc);

/** « 2 BiS · 3 Up · 1 MS » : sigles du jeu, les mêmes dans les deux langues. */
export const lootCategoryShort = (c: Partial<LootCategoryCounts>) => lootCategoryText(c);

/** « depuis le 06/10/2026 », « sur les 30 derniers jours », « sur les 5 derniers raids » (lootCountLabel, traduit). */
export function lootCountText(s: Pick<LootSettings, "countMode" | "countRaids" | "seasonStart">): string {
  if (s.countMode === "days") return t("sur les {n} derniers jours", { n: LOOT_COUNT_DAYS });
  if (s.countMode === "raids") return s.countRaids > 1 ? t("sur les {n} derniers raids", { n: s.countRaids }) : t("sur le dernier raid");
  if (!s.seasonStart) return t("depuis le début");
  const [y, m, d] = s.seasonStart.split("-");
  return t("depuis le {date}", { date: `${d}/${m}/${y}` });
}

/**
 * Roster : comment un objet a été distribué (retailLootHow, traduit) : « Conseil : BiS · 3 votes », « Jet MS 87 »,
 * « Jet libre 54 », « Chef de butin ». Null pour un objet seulement noté.
 */
export function lootHowText(l: { method?: LootMethod | null; response?: LootResponse | null; detail?: string | null }): string | null {
  const d = (l.detail ?? "").trim();
  switch (l.method) {
    case "council": return [l.response ? t("Conseil : {response}", { response: lootResponseLabel(l.response) }) : t("Conseil"), d].filter(Boolean).join(" · ");
    case "roll": {
      if (/^(MS|OS)\b/i.test(d)) return t("Jet {detail}", { detail: d });
      const free = d.match(/^jet\b\s*(.*)$/i);
      return free ? (free[1] ? t("Jet libre {n}", { n: free[1] }) : t("Jet libre")) : d ? `${t("Jet")} · ${d}` : t("Jet");
    }
    case "ml": return /^gardé/i.test(d) ? t("Gardé par le chef de butin") : d ? `${t("Chef de butin")} · ${d}` : t("Chef de butin");
    case "sr": return d ? `Soft reserve · ${d}` : "Soft reserve";
    default: return null;
  }
}

/**
 * Erreurs de lecture d'un texte de l'addon (parse…, sealError et foreignAddonErrors de game-data, en français : l'API
 * s'en sert aussi), traduites à l'affichage par motif ; {v} reprend la partie variable. Un message inconnu reste tel quel.
 */
const lit = (k: string): [RegExp, string] => [new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), k];
const ADDON_ERRORS: [RegExp, string][] = [
  lit(N("Ce n'est pas un export de perso : dans le jeu, tape /fr export et copie tout le texte.")),
  [/^Version d'export non gérée \((.*)\) : mets le site ou l'addon à jour\.$/, N("Version d'export non gérée ({v}) : mets le site ou l'addon à jour.")],
  lit(N("Export incomplet : recopie tout le texte, jusqu'à la ligne END.")),
  lit(N("Export trop long.")),
  lit(N("Export illisible.")),
  lit(N("texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le")),
  lit(N("Texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le.")),
  lit(N("texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu")),
  lit(N("Texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu.")),
  [/^version du relevé de guilde non gérée \((.*)\) : mets le site à jour$/, N("version du relevé de guilde non gérée ({v}) : mets le site à jour")],
  lit(N("relevé de guilde incomplet : recopie tout le texte, jusqu'à la ligne END")),
  lit(N("relevé de guilde trop long")),
  lit(N("relevé sans guilde (perso sans guilde ?)")),
  [/^version de bilan non gérée \((.*)\) : mets le site à jour$/, N("version de bilan non gérée ({v}) : mets le site à jour")],
  lit(N("bilan sans raid du site (charge les données du site en jeu avant le raid)")),
  lit(N("bilan sans raid du site (copie les données du site dans l'addon avant le raid)")),
  lit(N("heures du bilan illisibles")),
  [/^ligne de présence illisible : ([\s\S]*)$/, N("ligne de présence illisible : {v}")],
  [/^ligne de butin illisible : ([\s\S]*)$/, N("ligne de butin illisible : {v}")],
  [/^ligne de rencontre illisible : ([\s\S]*)$/, N("ligne de rencontre illisible : {v}")],
  lit(N("bilan incomplet : recopie tout le texte, jusqu'à la ligne END")),
  lit(N("bilan incomplet (nombre de lignes)")),
  [/^Ce texte vient de l'addon Forever Roster : colle-le sur (\S+)\. Sur Roster, les persos viennent de Battle\.net \(« Importer depuis Battle\.net »\) ou se créent à la main\.$/,
    N("Ce texte vient de l'addon Forever Roster : colle-le sur {v}. Sur Roster, les persos viennent de Battle.net (« Importer depuis Battle.net ») ou se créent à la main.")],
  [/^Ce texte vient de l'addon Forever Roster : colle-le sur (\S+)\.$/, N("Ce texte vient de l'addon Forever Roster : colle-le sur {v}.")],
  [/^Ce texte vient de l'addon Roster \(WoW Retail\) : colle-le sur (\S+)\.$/, N("Ce texte vient de l'addon Roster (WoW Retail) : colle-le sur {v}.")],
];
export function addonTextError(e: string): string {
  for (const [re, key] of ADDON_ERRORS) {
    const m = e.match(re);
    if (m) return t(key, { v: m[1] ?? "" });
  }
  // « Kaeldra : <erreur> » : un bloc de perso refusé (parseCharacterExports)
  const named = e.match(/^(.+?) : ([\s\S]+)$/);
  if (named) {
    const rest = addonTextError(named[2]!);
    if (rest !== named[2]) return t("{name} : {error}", { name: named[1]!, error: rest });
  }
  return e;
}
