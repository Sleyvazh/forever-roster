import type { SignupStatus } from "./core";
import { LOOT_METHODS, LOOT_RESPONSES, type LootMethod, type LootResponse } from "./loot";

/**
 * Bilan d'un raid relevé par l'addon (format « FRB », version 1, docs/addon-format.md) :
 * qui était dans le groupe de raid (relevé chaque minute) et le butin noté pendant la soirée.
 *
 *   FRB;1;<id du raid>;<début unix>;<fin unix>;<relevé par>;<nom du raid>
 *   A;<nom en jeu>;<vu la 1re fois>;<vu la dernière fois>;<nombre de relevés>
 *   L;<id de l'objet>;<reçu par>;<heure unix>;<boss>
 *   END;<nombre de lignes A et L>
 *
 * Version 2 (lot C2) : l'en-tête ajoute l'instance réelle (nom renvoyé par le jeu), et L la façon dont l'objet
 * a été attribué : `L;<objet>;<reçu par>;<heure>;<boss>;<méthode>;<réponse>;<détail>` (champs vides permis).
 *
 * Lot K1 (addon 1.3) : 9e champ de l'en-tête, `1` si celui qui a relevé menait le raid ou distribuait le butin
 * (chef de raid) : Roster Companion n'envoie tout seul que ce bilan-là. Absent ou `0` sinon.
 *
 * Lot G (hors du compte de END, ignoré par un site plus ancien) : appel aux consommables lancé en raid,
 * `Q;<heure unix>;<lancé par>` puis `K;<nom en jeu>;<objet:quantité,…>` par joueur (`-` : pas de réponse, pas d'addon).
 */

export interface RaidLogAttendee { name: string; first: number; last: number; samples: number }
export interface RaidLogLoot { itemId: number; name: string; at: number; boss: string; method?: LootMethod; response?: LootResponse; detail?: string }
export interface RaidLogExport {
  raidId: string; start: number; end: number; recorder: string; raidName: string;
  /** Version 2 : instance où le relevé a été fait (nom du jeu). */
  instance?: string;
  /** Lot K1 : relevé par le chef de raid (il menait le raid ou distribuait le butin). */
  lead?: boolean;
  attendees: RaidLogAttendee[]; loot: RaidLogLoot[];
  /** Lot G : dernier appel aux consommables (null par joueur : pas de réponse). */
  consumableCall?: { at: number; by: string; counts: { name: string; items: Record<number, number> | null }[] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEOPLE = 80, MAX_LOOT = 200;
const txt = (s: string | undefined, max: number) => (s ?? "").replace(/[|\r\n]/g, "").trim().slice(0, max);
const int = (s: string | undefined) => { const n = Number(s); return Number.isInteger(n) && n >= 0 ? n : null; };
/** Prénom seul, sans royaume : « Greta-Forever EU » → « Greta ». */
const gameNameOf = (s: string) => txt(s, 40).split("-")[0]!.split(/\s+/)[0] ?? "";

function parseBlock(lines: string[]): { ok: true; data: RaidLogExport } | { ok: false; error: string } {
  const head = lines[0]!.split(";");
  if (head[1] !== "1" && head[1] !== "2") return { ok: false, error: `version de bilan non gérée (${head[1] ?? "?"}) : mets le site à jour` };
  const raidId = (head[2] ?? "").trim(), start = int(head[3]), end = int(head[4]);
  if (!UUID.test(raidId)) return { ok: false, error: "bilan sans raid du site (charge les données du site en jeu avant le raid)" };
  if (start === null || end === null || end < start) return { ok: false, error: "heures du bilan illisibles" };
  const data: RaidLogExport = { raidId: raidId.toLowerCase(), start, end, recorder: gameNameOf(head[5] ?? ""), raidName: txt(head[6], 60), attendees: [], loot: [] };
  if (head[1] === "2" && txt(head[7], 60)) data.instance = txt(head[7], 60);
  if (head[1] === "2" && head[8]?.trim() === "1") data.lead = true;
  let count: number | null = null;
  for (const line of lines.slice(1)) {
    const f = line.trim().split(";");
    if (f[0] === "A") {
      const name = gameNameOf(f[1] ?? ""), first = int(f[2]), last = int(f[3]), samples = int(f[4]);
      if (!name || first === null || last === null || samples === null) return { ok: false, error: `ligne de présence illisible : ${line.slice(0, 40)}` };
      if (data.attendees.length < MAX_PEOPLE) data.attendees.push({ name, first, last: Math.max(first, last), samples });
    } else if (f[0] === "L") {
      const itemId = int(f[1]), at = int(f[3]), name = gameNameOf(f[2] ?? "");
      if (!itemId || at === null || !name) return { ok: false, error: `ligne de butin illisible : ${line.slice(0, 40)}` };
      const entry: RaidLogLoot = { itemId, name, at, boss: txt(f[4], 60) };
      if ((LOOT_METHODS as readonly string[]).includes(f[5] ?? "")) entry.method = f[5] as LootMethod;
      if ((LOOT_RESPONSES as readonly string[]).includes(f[6] ?? "")) entry.response = f[6] as LootResponse;
      if (txt(f[7], 60)) entry.detail = txt(f[7], 60);
      if (data.loot.length < MAX_LOOT) data.loot.push(entry);
    } else if (f[0] === "Q") {
      const at = int(f[1]);
      if (at !== null) data.consumableCall = { at, by: gameNameOf(f[2] ?? ""), counts: [] };
    } else if (f[0] === "K" && data.consumableCall) {
      const name = gameNameOf(f[1] ?? "");
      if (!name || data.consumableCall.counts.length >= MAX_PEOPLE) continue;
      let items: Record<number, number> | null = null;
      if ((f[2] ?? "-") !== "-") {
        items = {};
        for (const p of (f[2] ?? "").split(",").slice(0, 60)) {
          const [id, n] = p.split(":");
          const itemId = int(id), qty = int(n);
          if (itemId && qty !== null) items[itemId] = Math.min(9999, qty);
        }
      }
      data.consumableCall.counts.push({ name, items });
    } else if (f[0] === "END") {
      count = int(f[1]);
    }
  }
  if (count === null) return { ok: false, error: "bilan incomplet : recopie tout le texte, jusqu'à la ligne END" };
  if (count !== data.attendees.length + data.loot.length && count <= MAX_PEOPLE + MAX_LOOT) return { ok: false, error: "bilan incomplet (nombre de lignes)" };
  return { ok: true, data };
}

/** Bilans de raid (blocs FRB) contenus dans un texte collé, au milieu d'éventuels blocs FRC. */
export function parseRaidLogs(text: string): { data: RaidLogExport[]; errors: string[] } {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("FRB;")) { current = [line]; blocks.push(current); }
    else if (/^FR[A-Z];/.test(line)) current = null;
    else if (current && line) current.push(line);
  }
  const data: RaidLogExport[] = [], errors: string[] = [];
  for (const b of blocks.slice(0, 5)) {
    const r = parseBlock(b);
    if (r.ok) data.push(r.data); else errors.push(r.error);
  }
  return { data, errors };
}

/* ---------- Présence à partir du relevé ---------- */

export type AttendanceStatus = "present" | "late" | "left" | "absent" | "bench";
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Présent", late: "En retard", left: "Parti tôt", absent: "Inscrit, absent", bench: "Banc",
};
/** Statuts qui comptent comme « venu » dans le taux de présence. */
export const ATTENDED: AttendanceStatus[] = ["present", "late", "left", "bench"];

/** Marge avant d'être « en retard » ; « parti tôt » : absent du dernier quart de la soirée (au moins 15 min). */
const LATE_AFTER = 10 * 60, EARLY_MIN = 15 * 60;

/**
 * Statut de chaque joueur : vu dans le raid (à l'heure, en retard, parti tôt), inscrit mais jamais vu (absent), ou banc.
 * `ref` : heure prévue du raid (sinon le début du relevé). Si le relevé a commencé après l'heure prévue, l'arrivée
 * au premier relevé ne compte pas comme un retard (on ne sait pas).
 */
export function attendanceStatus(a: Pick<RaidLogAttendee, "first" | "last"> | null, log: { start: number; end: number }, ref: number | null, signup: SignupStatus | null): AttendanceStatus | null {
  if (signup === "bench") return "bench";
  if (!a) return signup === "present" || signup === "late" ? "absent" : null;
  const begin = Math.max(log.start, ref ?? log.start);
  const late = a.first > begin + LATE_AFTER && a.first > log.start + 120;
  const span = log.end - begin;
  const left = span > 0 && log.end - a.last > Math.max(EARLY_MIN, span / 4);
  return late ? "late" : left ? "left" : "present";
}
