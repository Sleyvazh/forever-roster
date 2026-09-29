/**
 * Lecture de la date tapée dans /raid, en heure locale du serveur de jeu (Europe/Paris par défaut) :
 *   « 12/11/2026 21:00 », « 12/11 21h », « 12/11/2026 20h45 », « 2026-11-12 21:00 ».
 * Sans année, on prend la prochaine occurrence.
 */
import { zonedTime } from "@forever/game-data";

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
