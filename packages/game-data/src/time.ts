/**
 * Heures locales du serveur de jeu (Europe/Paris par défaut), sans bibliothèque :
 * utilisé par l'API (raids récurrents) et le bot (/raid). Gère les changements d'heure.
 */

export const GAME_TIMEZONE = "Europe/Paris";

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; /** 1 = lundi … 7 = dimanche */ weekday: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(timeZone, f);
  }
  return f;
}

function raw(ts: number, timeZone: string) {
  const parts = fmt(timeZone).formatToParts(new Date(ts));
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { year: n("year"), month: n("month"), day: n("day"), hour: n("hour"), minute: n("minute"), second: n("second") };
}

/** Date et heure murales d'un instant dans le fuseau. */
export function zonedParts(date: Date, timeZone = GAME_TIMEZONE): ZonedParts {
  const r = raw(date.getTime(), timeZone);
  const wd = new Date(Date.UTC(r.year, r.month - 1, r.day)).getUTCDay();
  return { year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, weekday: wd === 0 ? 7 : wd };
}

/** Décalage (ms) du fuseau par rapport à UTC à l'instant `ts`. */
function offset(ts: number, timeZone: string) {
  const r = raw(ts, timeZone);
  return Date.UTC(r.year, r.month - 1, r.day, r.hour, r.minute, r.second) - Math.floor(ts / 1000) * 1000;
}

/** Heure murale (dans le fuseau) → instant, ou null si la date n'existe pas (31/02, 25 h…). */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, timeZone = GAME_TIMEZONE): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(wall);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  let ts = wall - offset(wall, timeZone);
  ts = wall - offset(ts, timeZone); // second passage : bon côté d'un changement d'heure
  return new Date(ts);
}

/**
 * Occurrences hebdomadaires (jour ISO + « HH:MM » locale) strictement après `after`
 * et au plus tard à `until`, dans l'ordre.
 */
export function weeklyOccurrences(weekday: number, time: string, after: Date, until: Date, timeZone = GAME_TIMEZONE): Date[] {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || weekday < 1 || weekday > 7) return [];
  const [h, mi] = [Number(m[1]), Number(m[2])];
  const start = zonedParts(after, timeZone);
  const out: Date[] = [];
  const days = Math.ceil((until.getTime() - after.getTime()) / 86400e3) + 1;
  for (let i = 0; i <= days; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const wd = day.getUTCDay() || 7;
    if (wd !== weekday) continue;
    const at = zonedTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, timeZone);
    if (at && at > after && at <= until) out.push(at);
  }
  return out;
}

export const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;
