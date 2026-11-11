import en from "./i18n/en.json";

/**
 * Version anglaise (lot E6) : le bot parle la langue de la guilde (réglage du site, Administration → Discord).
 * Comme le site et l'API, le texte français sert de clé et le catalogue `i18n/en.json` donne l'anglais ;
 * `node scripts/i18n-check.mjs` vérifie qu'aucun texte ne manque (tr(), trn(), N()).
 * Sans guilde connue (salon pas encore lié, avis d'un serveur sans guilde), le bot prend la langue de Discord du joueur.
 */
export type Lang = "fr" | "en";
type Vars = Record<string, string | number>;

const dict: Record<string, string> = en;

/** Marque un texte déclaré hors d'une fonction (table) : traduit plus tard par tr(). */
export const N = (fr: string) => fr;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** Texte dans la langue voulue ; {variables} remplies. */
export function tr(lang: Lang, fr: string, vars?: Vars): string {
  return fill(lang === "en" ? dict[fr] || fr : fr, vars);
}

/** Pluriel : français à partir de 2, anglais tout sauf 1 ; {n} vaut n. */
export function trn(lang: Lang, n: number, one: string, many: string, vars?: Vars): string {
  return tr(lang, (lang === "fr" ? Math.abs(n) >= 2 : Math.abs(n) !== 1) ? many : one, { n, ...vars });
}

/** « : » entre deux parties assemblées : espace avant en français, pas en anglais. */
export const colon = (lang: Lang) => (lang === "fr" ? " : " : ": ");
/** Guillemets d'un titre cité : « … » ou “…”. */
export const quote = (lang: Lang, s: string) => (lang === "fr" ? `« ${s} »` : `“${s}”`);

/** Langue d'une guilde (vue renvoyée par le site) ; absente (ancienne donnée) : français. */
export const langOf = (x: { lang?: string | null } | null | undefined, fallback: Lang = "fr"): Lang =>
  x?.lang === "en" ? "en" : x?.lang === "fr" ? "fr" : fallback;

/** Langue de Discord d'un joueur (interaction.locale) : français pour fr, anglais sinon. */
export const localeLang = (locale: string | null | undefined): Lang => (!locale || locale.startsWith("fr") ? "fr" : "en");

/**
 * Langue connue d'un raid, d'une sortie, d'une commande ou d'un salon, apprise des vues reçues du site : un clic sur un
 * bouton répond dans la langue de la guilde avant même de demander quoi que ce soit au site.
 */
const known = new Map<string, Lang>();
export function remember(lang: string | null | undefined, ...keys: (string | null | undefined)[]) {
  if (lang !== "fr" && lang !== "en") return;
  for (const k of keys) if (k) known.set(k, lang);
  // Garde-fou mémoire : on oublie les plus anciennes au-delà de 5 000
  if (known.size > 5000) for (const k of [...known.keys()].slice(0, known.size - 5000)) known.delete(k);
}
export const recall = (...keys: (string | null | undefined)[]): Lang | null => {
  for (const k of keys) { const l = k ? known.get(k) : undefined; if (l) return l; }
  return null;
};
