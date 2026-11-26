/**
 * Sondages de la guilde (bot Discord et site, 26/11/2026, choix de Flo : « A + B », officiers par défaut, aussi sur le site).
 * - « choice » (A, /sondage) : une question, 2 à 10 choix ; un ou plusieurs choix par votant ; anonyme ou public ;
 *   résultats en direct ou cachés jusqu'à la fin.
 * - « dates » (B, /dispos) : des créneaux pour un raid ; chacun répond Oui, Si besoin ou Non (rien coché) à chacun ;
 *   le meilleur créneau peut devenir un raid.
 * Partagé par l'API (règles), le bot et le site (affichage).
 */
import { GAME_TIMEZONE, zonedParts, zonedTime } from "./time";

export const POLL_KINDS = ["choice", "dates"] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const POLL_MIN_OPTIONS = 2;
/** Choix d'un sondage (A) ; créneaux d'un sondage de disponibilités (B : 2 à 8, maquette du 26/11). */
export const POLL_MAX_OPTIONS = 10;
export const POLL_MAX_SLOTS = 8;
export const pollMaxOptions = (kind: PollKind) => (kind === "dates" ? POLL_MAX_SLOTS : POLL_MAX_OPTIONS);
export const POLL_MAX_QUESTION = 200;
export const POLL_MAX_LABEL = 80;
/** Durée maximale d'un sondage (sa fin, au plus tard) et sondages ouverts à la fois par guilde. */
export const POLL_MAX_DAYS = 30;
export const POLL_MAX_OPEN = 20;
/** Un sondage clos reste visible (site et message Discord) ce nombre de jours, puis il est effacé. */
export const POLL_KEEP_DAYS = 90;

/** Choix d'un sondage : numéro (1, 2…, jamais réutilisé), libellé ; créneau d'un sondage de disponibilités : sa date (ISO). */
export interface PollOption { id: number; label: string; at?: string }
/** Qui peut voir les résultats : en direct, ou seulement une fois le sondage clos. */
export const POLL_RESULTS = ["live", "end"] as const;
export type PollResults = (typeof POLL_RESULTS)[number];

export interface PollOptionCount { id: number; yes: number; maybe: number }

/**
 * Meilleur créneau d'un sondage de disponibilités : le plus de « Oui », puis le plus de « Si besoin », puis le plus tôt
 * (ordre des créneaux). null sans aucun « Oui ».
 */
export function bestSlot(options: PollOptionCount[]): number | null {
  let best: PollOptionCount | null = null;
  for (const o of options) {
    if (!o.yes) continue;
    if (!best || o.yes > best.yes || (o.yes === best.yes && o.maybe > best.maybe)) best = o;
  }
  return best?.id ?? null;
}

/** Choix en tête d'un sondage à choix (ex æquo compris) ; vide sans aucun vote. */
export function leaders(options: PollOptionCount[]): number[] {
  const top = Math.max(0, ...options.map(o => o.yes));
  return top ? options.filter(o => o.yes === top).map(o => o.id) : [];
}

/** Barre de texte pour Discord : « ███████░░░░░░░ » (14 cases), pourcentage arrondi. */
export function textBar(part: number, total: number, width = 14) {
  const n = total ? Math.round((part / total) * width) : 0;
  return "█".repeat(n) + "░".repeat(width - n);
}

/* ---------- Créneaux et fin : texte et lecture (bot, site, tests) ---------- */

const WEEKDAY: Record<"fr" | "en", string[]> = {
  fr: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
};
const two = (n: number) => String(n).padStart(2, "0");

/** Créneau : « Mardi 01/12 · 21:00 » (anglais : « Tuesday 01/12 · 21:00 »), heure du serveur de jeu. */
export function slotText(at: Date, lang: "fr" | "en" = "fr", timeZone = GAME_TIMEZONE) {
  const z = zonedParts(at, timeZone);
  const wd = WEEKDAY[lang][z.weekday - 1]!;
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${two(z.day)}/${two(z.month)} · ${two(z.hour)}:${two(z.minute)}`;
}

/** Fin d'un sondage : « jeudi 26/11 à 18:00 » (anglais : « Thursday 26/11 at 18:00 »). */
export function pollEndText(at: Date, lang: "fr" | "en" = "fr", timeZone = GAME_TIMEZONE) {
  const z = zonedParts(at, timeZone);
  return `${WEEKDAY[lang][z.weekday - 1]} ${two(z.day)}/${two(z.month)} ${lang === "en" ? "at" : "à"} ${two(z.hour)}:${two(z.minute)}`;
}

export type SlotError = "unreadable" | "invalid" | "past" | "far";
export type ParsedSlot = { ok: true; at: Date } | { ok: false; reason: SlotError };

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const DAY_WORDS: [RegExp, number][] = [
  [/\b(lundi|lun|monday|mon)\b/, 1], [/\b(mardi|mar|tuesday|tue|tues)\b/, 2], [/\b(mercredi|mer|wednesday|wed)\b/, 3],
  [/\b(jeudi|jeu|thursday|thu|thur|thurs)\b/, 4], [/\b(vendredi|ven|friday|fri)\b/, 5], [/\b(samedi|sam|saturday|sat)\b/, 6],
  [/\b(dimanche|dim|sunday|sun)\b/, 7],
];

/**
 * Créneau ou fin tapé dans le bot (heure de Paris) : « 01/12 21:00 », « 01/12/2026 21h », « 2026-12-01 21:00 »,
 * « mardi 21h », « mardi 01/12 · 21:00 » (le texte du bot lui-même), « demain 20h30 », « ce soir 21h », « 21:00 »
 * (aujourd'hui) ; anglais : « tuesday 9pm », « tomorrow 20:30 », « tonight 21:00 ». L'heure est obligatoire.
 * Sans année, la prochaine occurrence ; un jour de la semaine seul, le prochain (aujourd'hui compris si l'heure est à venir).
 */
export function parseSlot(input: string, now = new Date(), timeZone = GAME_TIMEZONE): ParsedSlot {
  let s = ` ${plain(input).replace(/[·,]/g, " ")} `;
  const today = zonedParts(now, timeZone);
  let y: number | null = null, mo: number | null = null, d: number | null = null, weekday: number | null = null, explicitYear = false;
  const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const dmy = iso ? null : /(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?(?!\d)/.exec(s);
  if (iso) { [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]; explicitYear = true; s = s.replace(iso[0], " "); }
  else if (dmy) {
    d = Number(dmy[1]); mo = Number(dmy[2]);
    if (dmy[3]) { y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]); explicitYear = true; }
    s = s.replace(dmy[0], " ");
  }
  const dayWord = DAY_WORDS.find(([re]) => re.test(s));
  if (dayWord) weekday = dayWord[1];
  const tomorrow = /\b(demain|tomorrow)\b/.test(s);
  // Heure : 21:00, 21h, 21h30, 21 h, 9pm, 9:30pm
  const pm = /(?:^|[^\d])(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s);
  const hm = pm ? null : /(?:^|[^\d])(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?!\d)/.exec(s);
  if (!pm && !hm) return { ok: false, reason: "unreadable" };
  // Un mot inconnu (« merc 21h ») : illisible plutôt que lu de travers (aujourd'hui 21:00)
  const rest = s.replace((pm ?? hm)![0], " ").replace(/\b(lundi|lun|monday|mon|mardi|mar|tuesday|tue|tues|mercredi|mer|wednesday|wed|jeudi|jeu|thursday|thu|thur|thurs|vendredi|ven|friday|fri|samedi|sam|saturday|sat|dimanche|dim|sunday|sun)\b/g, " ")
    .replace(/\b(demain|tomorrow|aujourd'?hui|today|ce|soir|tonight|a|at|le|the|on|prochaine?|next|vers|around)\b/g, " ");
  if (/[a-z]/.test(rest)) return { ok: false, reason: "unreadable" };
  let h = Number((pm ?? hm)![1]);
  const mi = Number((pm ?? hm)![2] ?? 0);
  if (pm) { if (h < 1 || h > 12) return { ok: false, reason: "invalid" }; h = (h % 12) + (pm[3] === "pm" ? 12 : 0); }
  if (h > 23 || mi > 59) return { ok: false, reason: "invalid" };

  let at: Date | null;
  if (d !== null && mo !== null) {
    const year = y ?? today.year;
    at = zonedTime(year, mo, d, h, mi, timeZone);
    // Sans année : l'an prochain si la date est déjà passée
    if (at && !explicitYear && at.getTime() < now.getTime() - 3600e3) at = zonedTime(year + 1, mo, d, h, mi, timeZone);
  } else {
    // Jour de référence : aujourd'hui, demain, ou le prochain jour de la semaine nommé
    let offset = tomorrow ? 1 : 0;
    if (weekday !== null) offset = (weekday - today.weekday + 7) % 7;
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    at = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, mi, timeZone);
    if (at && weekday !== null && at.getTime() < now.getTime() - 60e3) {
      const next = new Date(Date.UTC(today.year, today.month - 1, today.day + offset + 7));
      at = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), h, mi, timeZone);
    }
  }
  if (!at) return { ok: false, reason: "invalid" };
  if (at.getTime() < now.getTime() - 60e3) return { ok: false, reason: "past" };
  if (at.getTime() > now.getTime() + 366 * 86400e3) return { ok: false, reason: "far" };
  return { ok: true, at };
}

export type ParsedEnd = { ok: true; at: Date | null } | { ok: false; reason: SlotError };

/**
 * Fin d'un sondage : vide (jusqu'à ce qu'on le close), une durée (« 2j », « 3 jours », « 48h », « dans 12 h »,
 * « 1 semaine » ; anglais « 2d », « 3 days », « 1 week ») ou un moment (comme un créneau : « jeudi 18:00 »).
 * « 21h » seul est une heure (aujourd'hui 21:00), pas une durée : « 48h » ou « dans 21 h » le sont.
 */
export function parseEnd(input: string, now = new Date(), timeZone = GAME_TIMEZONE): ParsedEnd {
  const s = plain(input).trim();
  if (!s) return { ok: true, at: null };
  const dur = /^(?:dans\s+|in\s+)?(\d{1,3})\s*(j|jours?|d|days?|h|heures?|hours?|hrs?|sem|semaines?|w|weeks?)$/.exec(s);
  if (dur) {
    const n = Number(dur[1]);
    const unit = dur[2]!;
    const hours = /^(h|heures?|hours?|hrs?)$/.test(unit);
    const explicit = /^(dans|in)\s/.test(s) || /^(heures?|hours?|hrs?)$/.test(unit);
    if (!hours || n > 23 || explicit) {
      const ms = n * (hours ? 3600e3 : /^(sem|semaines?|w|weeks?)$/.test(unit) ? 7 * 86400e3 : 86400e3);
      if (!n) return { ok: false, reason: "invalid" };
      return { ok: true, at: new Date(now.getTime() + ms) };
    }
  }
  return parseSlot(input, now, timeZone);
}
