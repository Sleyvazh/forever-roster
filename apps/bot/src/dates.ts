/**
 * Lecture de la date tapée dans /raid, en heure locale du serveur de jeu (Europe/Paris par défaut) :
 *   « 12/11/2026 21:00 », « 12/11 21h », « 12/11/2026 20h45 », « 2026-11-12 21:00 ».
 * Sans année, on prend la prochaine occurrence.
 */
import { atTime, outingDays, outingWhenText, zonedParts, zonedTime } from "@forever/game-data";

const DMY = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?\s+(\d{1,2})\s*(?:[h:](\d{2})?)?$/i;
const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/;

export type ParsedDate = { ok: true; date: Date } | { ok: false; error: string };

export function parseRaidDate(input: string, now: Date, timeZone: string): ParsedDate {
  const s = input.trim();
  let y: number | undefined, mo: number, d: number, h: number, mi: number;
  const iso = ISO.exec(s);
  const dmy = iso ? null : DMY.exec(s);
  if (iso) [y, mo, d, h, mi] = iso.slice(1).map(Number) as [number, number, number, number, number];
  else if (dmy) {
    d = Number(dmy[1]); mo = Number(dmy[2]); h = Number(dmy[4]); mi = Number(dmy[5] ?? 0);
    if (dmy[3]) y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  } else return { ok: false, error: "Date illisible. Exemple : 12/11/2026 21:00 (heure de Paris)." };

  let date: Date | null;
  if (y === undefined) {
    // Sans année : cette année, ou l'an prochain si la date est déjà passée
    const thisYear = Number(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(now));
    date = zonedTime(thisYear, mo, d, h, mi, timeZone);
    if (date && date.getTime() < now.getTime() - 3600e3) date = zonedTime(thisYear + 1, mo, d, h, mi, timeZone);
  } else date = zonedTime(y, mo, d, h, mi, timeZone);

  if (!date) return { ok: false, error: "Cette date n'existe pas. Exemple : 12/11/2026 21:00." };
  if (date.getTime() < now.getTime() - 3600e3) return { ok: false, error: "Cette date est déjà passée." };
  if (date.getTime() > now.getTime() + 366 * 86400e3) return { ok: false, error: "Date trop lointaine (un an maximum)." };
  return { ok: true, date };
}

/* ---------- /sortie : aujourd'hui ou demain ---------- */

export type ParsedOutingTime = { ok: true; day: string; at: Date | null } | { ok: false; error: string };
const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Heure tapée dans /sortie (heure de Paris) : « 21:00 », « 21h30 », « ce soir 21:00 », « demain 20h », « dès que complet »,
 * « demain, dès que complet ». Aujourd'hui sauf « demain » ; rien au-delà de demain, et pas une heure déjà passée.
 */
export function parseOutingTime(input: string, now: Date, timeZone: string): ParsedOutingTime {
  const s = plain(input);
  const { today, tomorrow } = outingDays(now, timeZone);
  const day = /\bdemain\b/.test(s) ? tomorrow : today;
  if (/complet|asap|des que|quand on est/.test(s)) return { ok: true, day, at: null };
  const m = /(?:^|\D)(\d{1,2})\s*(?:h|:)\s*(\d{2})?(?!\d)|^(\d{1,2})$/.exec(s);
  if (!m) return { ok: false, error: "Heure illisible. Exemples : 21:00, demain 20h30, dès que complet (heure de Paris)." };
  const h = Number(m[1] ?? m[3]), mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return { ok: false, error: "Cette heure n'existe pas. Exemple : 21:00." };
  const at = atTime(day, `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`, timeZone);
  if (!at) return { ok: false, error: "Cette heure n'existe pas. Exemple : 21:00." };
  if (at.getTime() < now.getTime() - 60e3) return { ok: false, error: `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} est déjà passé : écris « demain ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")} », ou une heure à venir.` };
  return { ok: true, day, at };
}

/** Propositions de la complétion de l'heure : dès que complet, les prochaines demi-heures, puis demain. */
export function outingTimeChoices(typed: string, now: Date, timeZone: string): string[] {
  const { today, tomorrow } = outingDays(now, timeZone);
  const z = zonedParts(now, timeZone);
  const slots: string[] = [];
  // Les 6 prochaines demi-heures d'aujourd'hui (au moins 15 min devant soi)
  for (let m = Math.ceil((z.hour * 60 + z.minute + 15) / 30) * 30; m < 24 * 60 && slots.length < 6; m += 30) {
    const at = atTime(today, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, timeZone);
    if (at) slots.push(outingWhenText(at, today, now, timeZone));
  }
  const all = ["Dès que complet", ...slots.map(x => x.charAt(0).toUpperCase() + x.slice(1)), "Demain, dès que complet",
    ...["18:00", "20:00", "21:00"].map(t => outingWhenText(atTime(tomorrow, t, timeZone), tomorrow, now, timeZone)).map(x => x.charAt(0).toUpperCase() + x.slice(1))];
  const q = plain(typed);
  const list = q ? all.filter(x => plain(x).includes(q)) : all;
  // Ce que le joueur tape reste proposable tel quel (« 21h45 »)
  return [...new Set([...(typed.trim() && !list.length ? [typed.trim()] : []), ...list])].slice(0, 25);
}
