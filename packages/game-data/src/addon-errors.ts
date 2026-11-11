/**
 * Erreurs de lecture d'un texte de l'addon (parse…, sealError, foreignAddonErrors : en français, comme le reste de game-data),
 * avec leur partie variable {v}. Le site et l'API les traduisent par motif (matchAddonError, puis leur catalogue) :
 * un message qui change ici change aussi dans cette liste (le test addon-errors.test.ts le vérifie).
 */
export const ADDON_ERROR_TEXTS: readonly string[] = [
  "Ce n'est pas un export de perso : dans le jeu, tape /fr export et copie tout le texte.",
  "Version d'export non gérée ({v}) : mets le site ou l'addon à jour.",
  "Export incomplet : recopie tout le texte, jusqu'à la ligne END.",
  "Export trop long.",
  "Export illisible.",
  "texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le",
  "Texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le.",
  "texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu",
  "Texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu.",
  "version du relevé de guilde non gérée ({v}) : mets le site à jour",
  "relevé de guilde incomplet : recopie tout le texte, jusqu'à la ligne END",
  "relevé de guilde trop long",
  "relevé sans guilde (perso sans guilde ?)",
  "version de bilan non gérée ({v}) : mets le site à jour",
  "bilan sans raid du site (charge les données du site en jeu avant le raid)",
  "bilan sans raid du site (copie les données du site dans l'addon avant le raid)",
  "heures du bilan illisibles",
  "ligne de présence illisible : {v}",
  "ligne de butin illisible : {v}",
  "ligne de rencontre illisible : {v}",
  "bilan incomplet : recopie tout le texte, jusqu'à la ligne END",
  "bilan incomplet (nombre de lignes)",
  "Ce texte vient de l'addon Forever Roster : colle-le sur {v}. Sur Roster, les persos viennent de Battle.net (« Importer depuis Battle.net ») ou se créent à la main.",
  "Ce texte vient de l'addon Forever Roster : colle-le sur {v}.",
  "Ce texte vient de l'addon Roster (WoW Retail) : colle-le sur {v}.",
];

const PATTERNS = ADDON_ERROR_TEXTS.map(k => [
  new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{v\\}", "([\\s\\S]*?)")}$`), k,
] as const);

/**
 * Motif d'une erreur de lecture : sa clé (texte français de ADDON_ERROR_TEXTS), sa partie variable, et le prénom du perso
 * quand l'erreur vient d'un bloc (« Kaeldra : Export incomplet… »). Null pour un autre message.
 */
export function matchAddonError(e: string): { key: string; v: string; name?: string } | null {
  for (const [re, key] of PATTERNS) {
    const m = e.match(re);
    if (m) return { key, v: m[1] ?? "" };
  }
  const named = e.match(/^(.+?) : ([\s\S]+)$/);
  if (named) {
    const inner = matchAddonError(named[2]!);
    if (inner && !inner.name) return { ...inner, name: named[1]! };
  }
  return null;
}
