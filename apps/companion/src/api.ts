/**
 * Lien avec le cœur de l'appli (Rust) : commandes (`invoke`) et état poussé à chaque passe de la boucle (« status »).
 * Hors de Tauri (npm run dev dans un navigateur), un faux appareil (demo.ts) répond à la place.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { demoInvoke, demoListen } from "./demo";

export type Game = "forever" | "retail";
export type Overall = "active" | "idle" | "paused" | "error" | "unlinked";

export interface Settings {
  startup: "windows" | "game" | "manual";
  close: "hide" | "quit";
  theme: "auto" | "light" | "dark";
  notifications: { enabled: boolean; errors: boolean; sent: boolean; unknown: boolean; fresh: boolean };
  syncMinutes: 1 | 5 | 15;
  folders: Partial<Record<Game, string>>;
  extraRoots: string[];
}

export interface Install {
  path: string; dirName: string; version: string | null; game: Game | null; test: boolean;
  addonVersion: string | null; dataAddon: boolean; accounts: number; saved: number;
}

export interface HistoryLine { at: number; key?: string; label: string; status: string; message: string }

export interface GameView {
  game: Game; label: string; enabled: boolean; site: string;
  install: Install | null; running: boolean; restartNeeded: boolean;
  queue: number; queueErrors: string[];
  unknown: { key: string; name: string; cls: string | null; level: number | null }[];
  manual: { key: string; label: string }[];
  history: HistoryLine[];
  report: { at: number; items: string[] } | null;
  groups: { name: string; raids: number; patterns: number; bis: number }[];
  frgAt: number; hasFrg: boolean;
  lastPush: number | null; lastPull: number | null;
  lastError: string | null; readError: string | null; retryAt: number | null;
}

export interface Status {
  version: string; now: number; overall: Overall; tooltip: string;
  device: { id: string; name: string; user: string; linkedAt: number } | null;
  setupDone: boolean; pausedUntil: number | null;
  settings: Settings; games: GameView[]; installs: Install[];
  pairing: { userCode: string; verifyUrl: string; expiresAt: number; status: string; message: string | null } | null;
  os: string;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function call<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inTauri ? tauriInvoke<T>(cmd, args) : demoInvoke<T>(cmd, args);
}

export function onStatus(fn: (s: Status) => void): () => void {
  if (!inTauri) return demoListen(fn);
  let stop: (() => void) | null = null;
  let cancelled = false;
  void tauriListen<Status>("status", e => fn(e.payload)).then(u => { if (cancelled) u(); else stop = u; });
  return () => { cancelled = true; stop?.(); };
}

/** Message d'erreur d'une commande (texte renvoyé par Rust). */
/** Version de l'addon au moins égale à `min` (« 1.4.0 » ≥ « 1.4 »). */
export function atLeast(version: string | null | undefined, min: string) {
  if (!version) return false;
  const a = version.split(".").map(n => parseInt(n, 10) || 0), b = min.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Message d'erreur à afficher seul : majuscule en tête (« le site ne répond pas » → « Le site ne répond pas »). */
export function errorText(e: unknown) {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Action impossible.";
}

/* ---------- Dates ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
export function hhmm(t: number) {
  const d = new Date(t * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** « 21:42 » aujourd'hui, « hier à 21:42 », sinon « 06/10 à 21:42 ». */
export function when(t: number, now = Date.now() / 1000) {
  const d = new Date(t * 1000), today = new Date(now * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(today) - day(d)) / 86400000);
  if (diff === 0) return hhmm(t);
  if (diff === 1) return `hier à ${hhmm(t)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${hhmm(t)}`;
}
/** « il y a 40 s », « il y a 3 min », « il y a 2 h », sinon la date. */
export function ago(t: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.round(now - t));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 6 * 3600) return `il y a ${Math.floor(s / 3600)} h`;
  return when(t, now);
}

export const CLASS_FR: Record<string, string> = {
  Druid: "Druide", Warrior: "Guerrier", Paladin: "Paladin", Hunter: "Chasseur", Rogue: "Voleur",
  Priest: "Prêtre", Shaman: "Chaman", Mage: "Mage", Warlock: "Démoniste",
};
