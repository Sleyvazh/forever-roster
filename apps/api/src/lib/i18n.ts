import { matchAddonError } from "@forever/game-data";
import type { FastifyRequest } from "fastify";
import en from "../i18n/en.json";

/**
 * Version anglaise (lot E5) : messages de l'API (erreurs, résultats d'un import, e-mails) en français ou en anglais.
 * Comme sur le site, le texte français sert de clé et le catalogue `i18n/en.json` donne l'anglais ;
 * `node scripts/i18n-check.mjs` vérifie qu'aucun texte ne manque (premier argument de badRequest(), forbidden()…, de tr()
 * et de N(), textes de trn()).
 */
export type Lang = "fr" | "en";
type Vars = Record<string, string | number>;

const dict: Record<string, string> = en;

/** Marque un texte déclaré hors d'une fonction (table, raison codée) : traduit plus tard par tr(). */
export const N = (fr: string) => fr;

/** Message rendu par une fonction (erreur de validation…) : texte français avec ses {variables}, traduit par qui l'affiche. */
export interface Msg { key: string; vars?: Vars }
export const msg = (key: string, vars?: Vars): Msg => ({ key, vars });

export const fill = (s: string, vars?: Vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** Texte dans la langue voulue ; {variables} remplies. */
export function tr(lang: Lang, fr: string, vars?: Vars): string {
  return fill(lang === "en" ? dict[fr] || fr : fr, vars);
}

/** Pluriel : français à partir de 2, anglais tout sauf 1 ; {n} vaut n. */
export function trn(lang: Lang, n: number, one: string, many: string, vars?: Vars): string {
  const many_ = lang === "fr" ? Math.abs(n) >= 2 : Math.abs(n) !== 1;
  return tr(lang, many_ ? many : one, { n, ...vars });
}

/** « : » entre deux parties assemblées : espace avant en français, pas en anglais. */
export const colon = (lang: Lang) => (lang === "fr" ? " : " : ": ");

const asLang = (v: unknown): Lang | null => (v === "fr" || v === "en" ? v : null);

/**
 * Langue d'une requête : celle de la page (en-tête X-Lang, envoyé par le site à chaque appel), sinon celle du compte, sinon
 * le cookie fr-lang ; français par défaut (Roster Companion, bot).
 */
export function reqLang(req: FastifyRequest): Lang {
  return asLang(req.headers["x-lang"]) ?? asLang(req.user?.lang) ?? asLang(req.cookies?.["fr-lang"]) ?? "fr";
}

/** Langue d'un compte pour un message qui part hors d'une requête : choisie dans le compte, sinon français. */
export const userLang = (u: { lang?: string | null } | null | undefined): Lang => asLang(u?.lang) ?? "fr";

/**
 * Message d'erreur traduit : texte du catalogue (variables traduites aussi quand ce sont des textes connus, comme un
 * message de zod), sinon une erreur de lecture d'un texte de l'addon (game-data, par motif), sinon tel quel.
 */
export function errorText(lang: Lang, key: string, vars?: Vars): string {
  if (lang === "fr") return fill(key, vars);
  const v = vars && Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, typeof x === "string" ? addonText(lang, dict[x] || x) : x]));
  if (dict[key]) return fill(dict[key], v);
  return addonText(lang, fill(key, vars));
}

/** Erreur de lecture d'un texte de l'addon (parse…, sealError, foreignAddonErrors : en français) dans la langue voulue. */
export function addonText(lang: Lang, e: string): string {
  if (lang === "fr") return e;
  const m = matchAddonError(e);
  if (!m) return e;
  const text = tr(lang, m.key, { v: m.v });
  return m.name ? `${m.name}${colon(lang)}${text}` : text;
}
