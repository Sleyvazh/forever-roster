import { Fragment, useSyncExternalStore, type ReactNode } from "react";

/**
 * Langue du site (version anglaise, 10/11/2026). Comme dans l'addon, le texte français reste dans le code et sert de clé :
 *   t("Se connecter")                              → texte
 *   t("{n} raids sans réponse", { n })             → texte avec variables {nom}
 *   tx("Lis la {link}.", { link: <a …/> })         → texte avec des éléments React
 *   tn(n, "{n} raid", "{n} raids")                 → pluriel (français : 0 et 1 au singulier ; anglais : 1 seulement)
 *   N("Libellé")                                   → texte déclaré hors d'un composant, traduit plus tard par t(variable)
 * Le catalogue anglais (i18n/en.json, français → anglais) n'est chargé qu'en anglais. `npm test -w apps/web`
 * (scripts/i18n-check.mjs) vérifie que chaque texte du code a sa traduction, sans traduction inutile.
 */
export type Lang = "fr" | "en";
export type LangPref = Lang | "auto";

// Cookie (et pas seulement le stockage du navigateur) : le serveur le lit aussi (page d'accueil publique, messages, e-mails)
const COOKIE = "fr-lang";
let lang: Lang = "fr";
let dict: Record<string, string> = {};
const subs = new Set<() => void>();

/** Langue choisie dans ce navigateur, si elle l'a été. */
export function storedLang(): Lang | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)fr-lang=(fr|en)(?:;|$)/);
  return m ? (m[1] as Lang) : null;
}
/** Langue du navigateur : français s'il le demande, sinon anglais. */
export function browserLang(): Lang {
  const l = typeof navigator !== "undefined" ? navigator.language : "fr";
  return (l ?? "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
}
/** Langue au chargement : celle choisie dans ce navigateur, sinon celle du navigateur (traduction finie, lot E7). */
export function initialLang(): Lang {
  return storedLang() ?? browserLang();
}
/** Garde la langue dans ce navigateur (un an), ou l'oublie (null : celle du navigateur). */
export function rememberLang(l: Lang | null) {
  try {
    document.cookie = l ? `${COOKIE}=${l}; Path=/; Max-Age=31536000; SameSite=Lax; Secure` : `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  } catch { /* cookies refusés : la langue vaut pour cet onglet */ }
}

/** Charge le catalogue de la langue et prévient l'interface (tout le site se redessine dans la nouvelle langue). */
export async function loadLang(l: Lang) {
  dict = l === "en" ? (await import("./i18n/en.json")).default as Record<string, string> : {};
  lang = l;
  if (typeof document !== "undefined") document.documentElement.lang = l;
  subs.forEach(f => f());
}
export const getLang = () => lang;
/** Langue affichée ; le composant se redessine quand elle change. */
export function useLang(): Lang {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => lang, () => lang);
}

const look = (fr: string) => (lang === "fr" ? fr : dict[fr] || fr);
const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

export function t(fr: string, vars?: Record<string, string | number>): string {
  return fill(look(fr), vars);
}
/** « : » entre deux parties d'une phrase : espace avant en français, pas en anglais. */
export const colon = () => (lang === "fr" ? " : " : ": ");
/** Pluriel ? Français : 2 et plus ; anglais : tout sauf 1 (« 0 points »). */
export const isMany = (n: number) => (lang === "fr" ? Math.abs(n) >= 2 : Math.abs(n) !== 1);
/** Pluriel : {n} vaut n. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(isMany(n) ? many : one, { n, ...vars });
}
/** Texte avec des éléments React à la place des {variables}. */
export function tx(fr: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = look(fr).split(/\{(\w+)\}/);
  return parts.map((p, i) => (i % 2 === 0 ? p : <Fragment key={i}>{p in vars ? vars[p] : `{${p}}`}</Fragment>));
}
/** Marque un texte déclaré hors d'un composant (listes, constantes) : traduit à l'affichage par t(). */
export const N = (fr: string) => fr;

/** Dates et nombres : français, ou anglais à l'européenne (« 9 Nov », 24 h). */
export const dateLocale = () => (lang === "en" ? "en-GB" : "fr-FR");
