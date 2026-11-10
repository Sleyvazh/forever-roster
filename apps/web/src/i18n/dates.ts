import { getLang } from "../i18n";

/**
 * Noms des jours et des mois dans la langue du site (version anglaise, 10/11/2026). L'anglais suit l'usage européen :
 * le jour avant le mois (« Monday 10 November »), semaine du lundi, 24 h. wd : 1 = lundi … 7 = dimanche ; m : 1 … 12.
 */
const FR = {
  dayShort: ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."],
  dayLong: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
  dayMin: ["lu", "ma", "me", "je", "ve", "sa", "di"],
  month: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  monthShort: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
};
const EN = {
  dayShort: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  dayLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  dayMin: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  month: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const names = () => (getLang() === "en" ? EN : FR);

/** « lun. » / « Mon » */
export const dayShort = (wd: number) => names().dayShort[wd - 1] ?? "";
/** « lundi » / « Monday » (minuscule en français, comme dans une phrase) */
export const dayLong = (wd: number) => names().dayLong[wd - 1] ?? "";
/** « Lundi » / « Monday » : en début de ligne ou de libellé */
export const dayTitle = (wd: number) => { const d = dayLong(wd); return d.charAt(0).toUpperCase() + d.slice(1); };
/** Initiales du calendrier : lu ma me … / Mo Tu We … */
export const dayInitials = () => names().dayMin;
/** « novembre » / « November » */
export const monthLong = (m: number) => names().month[m - 1] ?? "";
/** « nov. » / « Nov » */
export const monthShort = (m: number) => names().monthShort[m - 1] ?? "";
/** « Novembre 2026 » / « November 2026 » */
export const monthTitle = (m: number, y: number) => { const s = monthLong(m); return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${y}`; };
/** « lundi 10 novembre » / « Monday 10 November » */
export const dayMonth = (wd: number, d: number, m: number) => `${dayLong(wd)} ${d} ${monthLong(m)}`;
/** « 10 nov. » / « 10 Nov » */
export const dayMonthShort = (d: number, m: number) => `${d} ${monthShort(m)}`;
/** Liste « lundi, mardi et vendredi » / « Monday, Tuesday and Friday » */
export const andList = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} ${getLang() === "en" ? "and" : "et"} ${items.at(-1)}` : items[0] ?? "";
