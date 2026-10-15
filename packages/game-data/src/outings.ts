import { CLASS_SPECS, specDef, type Role, type SpecDef } from "./core";
import { GAME_TIMEZONE, zonedParts, zonedTime } from "./time";

/**
 * Sorties donjon (Forever) : un groupe de 5 pour aujourd'hui ou demain (heure de Paris), places par rôle.
 * Règles et libellés partagés par l'API, le site et le bot. Cahier des charges : forever-guilde.md, §3.
 */

export const OUTING_SIZE = 5;
export const OUTING_NOTE_MAX = 80;
/** Une sortie (et son message Discord) disparaît 2 h après son heure. */
export const OUTING_KEEP_MS = 2 * 3600e3;
/** Limites (§3) : sorties ouvertes par joueur (créées par lui), et par groupe. */
export const MAX_OPEN_OUTINGS_PER_PLAYER = 3;
export const MAX_OUTINGS_PER_GROUP = 30;
/** Rappel en MP aux inscrits, avant l'heure. */
export const OUTING_SOON_MS = 15 * 60e3;

export const OUTING_ROLES = ["Tank", "Heal", "DPS"] as const satisfies readonly Role[];
export interface OutingPlaces { tank: number; heal: number; dps: number }
export const DEFAULT_OUTING_PLACES: OutingPlaces = { tank: 1, heal: 1, dps: 3 };
export const placesOf = (p: OutingPlaces, role: Role) => (role === "Tank" ? p.tank : role === "Heal" ? p.heal : p.dps);
/** Places « T/H/D » (ligne X du FRG, ex. 1/1/3). */
export const placesText = (p: OutingPlaces) => `${p.tank}/${p.heal}/${p.dps}`;
/** Places valides : chaque rôle entre 0 et 5, 5 en tout. */
export const validPlaces = (p: OutingPlaces) => [p.tank, p.heal, p.dps].every(n => Number.isInteger(n) && n >= 0 && n <= OUTING_SIZE) && p.tank + p.heal + p.dps === OUTING_SIZE;

/** Rôles que la classe peut tenir (d'après ses spés de Forever). */
export function classRoles(cls: string): Role[] {
  const specs = (CLASS_SPECS as Record<string, SpecDef[]>)[cls] ?? [];
  return OUTING_ROLES.filter(r => specs.some(s => s.role === r));
}

/**
 * Rôles qu'un perso tient : ceux de ses spés (principale puis secondaire), sinon tous ceux de sa classe.
 * Sert à proposer « + Brindille » seulement dans les rôles qu'il peut prendre.
 */
export function characterRoles(c: { cls: string; spec1?: string | null; spec2?: string | null }): Role[] {
  const own = [c.spec1, c.spec2].map(s => (s ? specDef(c.cls, s)?.role : null)).filter((r): r is Role => !!r);
  if (own.length) return OUTING_ROLES.filter(r => own.includes(r));
  return classRoles(c.cls);
}
/** Spé à retenir pour un rôle : la principale si elle convient, sinon la secondaire, sinon la première de la classe. */
export function specForRole(c: { cls: string; spec1?: string | null; spec2?: string | null }, role: Role): string {
  for (const s of [c.spec1, c.spec2]) if (s && specDef(c.cls, s)?.role === role) return s;
  return ((CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? []).find(s => s.role === role)?.name ?? "";
}

/* ---------- Jours et heures (heure de Paris) ---------- */

/** Jour « AAAA-MM-JJ » dans le fuseau du serveur de jeu. */
export function dayKeyOf(date: Date, timeZone = GAME_TIMEZONE) {
  const z = zonedParts(date, timeZone);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}
const parseDay = (day: string) => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; return { y, m, d }; };
/** Jour suivant (ou précédent, avec n < 0). */
export function addDays(day: string, n: number) {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
/** Aujourd'hui et demain (les deux seuls jours possibles pour une sortie). */
export function outingDays(now = new Date(), timeZone = GAME_TIMEZONE) {
  const today = dayKeyOf(now, timeZone);
  return { today, tomorrow: addDays(today, 1) };
}
/** Instant qui suit le jour (minuit du lendemain, heure de Paris). */
export function endOfDay(day: string, timeZone = GAME_TIMEZONE): Date {
  const { y, m, d } = parseDay(addDays(day, 1));
  return zonedTime(y, m, d, 0, 0, timeZone)!;
}
/** Instant d'une heure « HH:MM » ce jour-là (null si l'heure est invalide). */
export function atTime(day: string, time: string, timeZone = GAME_TIMEZONE): Date | null {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!t) return null;
  const { y, m, d } = parseDay(day);
  return zonedTime(y, m, d, Number(t[1]), Number(t[2]), timeZone);
}
/** Fin de vie d'une sortie : 2 h après son heure ; « dès que complet » (sans heure) : à la fin de son jour. */
export const outingExpiry = (at: Date | null, day: string, timeZone = GAME_TIMEZONE) => (at ? new Date(at.getTime() + OUTING_KEEP_MS) : endOfDay(day, timeZone));
/** « HH:MM » à l'heure de Paris. */
export function hhmmOf(date: Date, timeZone = GAME_TIMEZONE) {
  const z = zonedParts(date, timeZone);
  return `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
}

/** À partir de 17 h, « ce soir » plutôt qu'« aujourd'hui ». */
const EVENING = 17;
/**
 * Quand, en clair : jour relatif (« Ce soir », « Aujourd'hui », « Demain », « Hier ») et heure (null : dès que complet).
 * Calculé au moment de l'affichage : la même sortie de demain devient « ce soir » après minuit.
 */
export function outingWhen(at: Date | null, day: string, now = new Date(), timeZone = GAME_TIMEZONE): { day: string; time: string | null } {
  const { today, tomorrow } = outingDays(now, timeZone);
  const time = at ? hhmmOf(at, timeZone) : null;
  if (day === tomorrow) return { day: "Demain", time };
  if (day === today) return { day: at && zonedParts(at, timeZone).hour >= EVENING ? "Ce soir" : "Aujourd'hui", time };
  if (day === addDays(today, -1)) return { day: "Hier", time };
  const { y, m, d } = parseDay(day);
  return { day: `${d}/${String(m).padStart(2, "0")}${y !== Number(today.slice(0, 4)) ? `/${y}` : ""}`, time };
}
/** « ce soir 21:00 », « demain, dès que complet » (titres Discord, messages). */
export function outingWhenText(at: Date | null, day: string, now = new Date(), timeZone = GAME_TIMEZONE) {
  const w = outingWhen(at, day, now, timeZone);
  const d = w.day.toLowerCase();
  return w.time ? `${d} ${w.time}` : `${d}, dès que complet`;
}
/** Fourchette « 29-38 » (vide pour « Autre »). */
export const levelsText = (min: number | null | undefined, max: number | null | undefined) => (min && max ? (min === max ? `${min}` : `${min}-${max}`) : "");
