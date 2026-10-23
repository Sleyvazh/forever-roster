import {
  zonedParts,
  type GuildChar, type GuildHistoryResponse, type GuildHomeResponse, type GuildLinkResponse, type GuildMembersResponse, type GuildRaceResponse, type RaceDate,
} from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { get } from "./api";

/**
 * Guilde du jeu (Forever, lot « Guilde ») : requêtes de l'API (routes /api/groups/:id/guild…, /home) et petits textes
 * de dates, à l'heure de Paris. Les écrans sont dans pages/HomePage.tsx, components/GuildMembers.tsx et GuildRace.tsx.
 */

/** Clés des requêtes : rechargées par l'événement en direct « guild » (live.ts). */
export const guildKeys = {
  members: (g: string) => ["guild", g] as const,
  race: (g: string) => ["guild-race", g] as const,
  history: (g: string, kind: string) => ["guild-history", g, kind] as const,
  home: (g: string) => ["guild-home", g] as const,
  link: (g: string) => ["guild-link", g] as const,
};
export const GUILD_QUERY_ROOTS = ["guild", "guild-race", "guild-history", "guild-home", "guild-link"] as const;

export const useGuildMembers = (g: string) => useQuery({ queryKey: guildKeys.members(g), queryFn: () => get<GuildMembersResponse>(`/groups/${g}/guild`) });
export const useGuildRace = (g: string) => useQuery({ queryKey: guildKeys.race(g), queryFn: () => get<GuildRaceResponse>(`/groups/${g}/guild/race`) });
export const useGuildHome = (g: string) => useQuery({ queryKey: guildKeys.home(g), queryFn: () => get<GuildHomeResponse>(`/groups/${g}/home`) });
export const useGuildLink = (g: string, enabled = true) => useQuery({ queryKey: guildKeys.link(g), queryFn: () => get<GuildLinkResponse>(`/groups/${g}/guild/link`), enabled });
export const fetchHistory = (g: string, kind: string, before?: string) =>
  get<GuildHistoryResponse>(`/groups/${g}/guild/history?kind=${kind}${before ? `&before=${encodeURIComponent(before)}` : ""}`);

/* ---------- Dates (heure de Paris) ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const DAY_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DAY_MS = 86400e3;
/** Jour du calendrier (Paris) : nombre comparable. */
const dayNum = (d: Date) => { const z = zonedParts(d); return Date.UTC(z.year, z.month - 1, z.day) / DAY_MS; };

/** « 14/11 » */
export const dayMonth = (iso: string) => { const z = zonedParts(new Date(iso)); return `${z.day}/${pad(z.month)}`; };
/** « 22:41 » */
export const hourMin = (iso: string) => { const z = zonedParts(new Date(iso)); return `${pad(z.hour)}:${pad(z.minute)}`; };
/** « mer. 18/11 » */
export const shortDay = (iso: string) => `${DAY_SHORT[zonedParts(new Date(iso)).weekday - 1]} ${dayMonth(iso)}`;
/** « Mercredi 18 novembre » */
export const longDay = (iso: string) => { const z = zonedParts(new Date(iso)); return `${DAY_LONG[z.weekday - 1]} ${z.day} ${MONTHS[z.month - 1]}`; };
/** « jeudi 5/11 à 00:00 » */
export const dayTimeShort = (iso: string) => `${DAY_LONG[zonedParts(new Date(iso)).weekday - 1]!.toLowerCase()} ${dayMonth(iso)} à ${hourMin(iso)}`;
/** « jeudi 5 novembre à 00:00 » */
export const longDayTime = (iso: string) => `${longDay(iso).toLowerCase()} à ${hourMin(iso)}`;
/** Clé du jour (regroupement de l'historique). */
export const dayKey = (iso: string) => String(dayNum(new Date(iso)));

/** « auj. 14:10 », « hier 23:40 », « 14/11 16:52 ». */
export function whenShort(iso: string, now = new Date()) {
  const d = dayNum(now) - dayNum(new Date(iso));
  return d === 0 ? `auj. ${hourMin(iso)}` : d === 1 ? `hier ${hourMin(iso)}` : `${dayMonth(iso)} ${hourMin(iso)}`;
}
/** Date d'un niveau de la course : exacte, ou approximative (« vers le 18/11 », jour du relevé). */
export function raceDateText(d: RaceDate | null | undefined, now = new Date()): { text: string; est: boolean } {
  if (!d) return { text: "—", est: false };
  if (!d.at) return { text: "✓", est: true };
  return d.exact ? { text: whenShort(d.at, now), est: false } : { text: `vers le ${dayMonth(d.at)}`, est: true };
}
/** Jalon (colonnes 20 / 40 / 60) : « 6/11 », ou « ≈ 8/11 » (approximatif). */
export function milestoneText(d: RaceDate | undefined): { text: string; est: boolean; none: boolean } {
  if (!d) return { text: "—", est: false, none: true };
  if (!d.at) return { text: "✓", est: true, none: false };
  return { text: d.exact ? dayMonth(d.at) : `≈ ${dayMonth(d.at)}`, est: !d.exact, none: false };
}

/** Dernière connexion : « en ligne », « il y a 40 min », « il y a 5 h », « hier », « il y a 9 jours » ; old : plus de 7 jours. */
export function seenText(online: boolean, lastOnlineAt: string | null, now = new Date()): { text: string; state: "on" | "" | "old" } {
  if (online) return { text: "en ligne", state: "on" };
  if (!lastOnlineAt) return { text: "inconnue", state: "" };
  const ms = now.getTime() - Date.parse(lastOnlineAt);
  if (ms < 3600e3) return { text: `il y a ${Math.max(1, Math.round(ms / 60e3))} min`, state: "" };
  if (ms < 20 * 3600e3) return { text: `il y a ${Math.round(ms / 3600e3)} h`, state: "" };
  const d = Math.max(1, dayNum(now) - dayNum(new Date(lastOnlineAt)));
  return { text: d === 1 ? "hier" : `il y a ${d} jours`, state: d > 7 ? "old" : "" };
}
/** Actif depuis moins de N jours (en ligne compris). */
export const activeWithin = (c: Pick<GuildChar, "online" | "lastOnlineAt">, days: number, now = Date.now()) =>
  c.online || (!!c.lastOnlineAt && now - Date.parse(c.lastOnlineAt) < days * DAY_MS);

/** Relevé « il y a 12 min », « il y a 3 h », « hier », « le 14/11 ». */
export function agoText(iso: string, now = new Date()) {
  const ms = now.getTime() - Date.parse(iso);
  if (ms < 60e3) return "à l'instant";
  if (ms < 3600e3) return `il y a ${Math.round(ms / 60e3)} min`;
  if (ms < 20 * 3600e3) return `il y a ${Math.round(ms / 3600e3)} h`;
  const d = dayNum(now) - dayNum(new Date(iso));
  return d <= 1 ? "hier" : `le ${dayMonth(iso)}`;
}
/** Jours entiers avant un instant (compte à rebours de la course : « J-7 »). */
export const daysUntil = (iso: string, now = new Date()) => Math.max(0, dayNum(new Date(iso)) - dayNum(now));

/** Exposant d'un rang dans la guilde : « 1re » (la place), « 7e ». */
export const placeSuffix = (n: number) => (n === 1 ? "re" : "e");
