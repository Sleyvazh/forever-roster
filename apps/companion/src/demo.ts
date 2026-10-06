/**
 * Faux appareil pour voir l'interface dans un navigateur (npm run dev) et faire les aperçus :
 * ?ecran=appairage | dossiers | principal | probleme | inconnus | options | journal
 */
import type { GameView, Install, Settings, Status } from "./api";

const now = () => Math.floor(Date.now() / 1000);
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
export const demoScreen = params.get("ecran") ?? "principal";

const forever: Install = {
  path: "C:\\Games\\World of Warcraft\\_classic_beta_", dirName: "_classic_beta_", version: "1.60.1.70170", game: "forever", test: true,
  addonVersion: "1.4.0", dataAddon: true, accounts: 1, saved: 1,
};
const retail: Install = { path: "C:\\Games\\World of Warcraft\\_retail_", dirName: "_retail_", version: "12.1.0.63000", game: "retail", test: false, addonVersion: null, dataAddon: false, accounts: 1, saved: 0 };

const settings: Settings = {
  startup: "windows", close: "hide", theme: "auto", notifications: { enabled: false, errors: true, sent: false, unknown: true },
  syncMinutes: 5, folders: {}, extraRoots: [],
};

function game(): GameView {
  const t = now();
  return {
    game: "forever", label: "Forever", enabled: true, site: "https://forever-roster.sleyvazh.fr", install: { ...forever, dataAddon: demoScreen !== "dossiers" },
    running: demoScreen !== "probleme", restartNeeded: false, queue: 0, queueErrors: [],
    unknown: demoScreen === "inconnus" ? [{ key: "Brindille-Forever EU", name: "Brindille", cls: "Druid", level: 23 }, { key: "Banquier-Forever EU", name: "Banquier", cls: "Rogue", level: 1 }] : [],
    manual: demoScreen === "inconnus" ? [{ key: "frb:r2", label: "bilan de « Onyxia »" }] : [],
    history: [
      { at: t - 180, label: "Tournicoti", status: "updated", message: "fiche mise à jour · 12 patrons cochés" },
      { at: t - 180, label: "Brakka", status: "updated", message: "fiche mise à jour" },
      { at: t - 180, label: "bilan de « Vroum Vroum »", status: "updated", message: "enregistré · 9 présents, 4 objets" },
    ],
    report: { at: t - 180, items: ["Tournicoti", "Brakka", "bilan de « Vroum Vroum »"] },
    groups: [{ name: "Bouaouad", raids: 3, patterns: 14, bis: 22 }],
    frgAt: t - 40, hasFrg: true, lastPush: t - 180, lastPull: t - 40,
    lastError: demoScreen === "probleme" ? "le site ne répond pas (connexion impossible)" : null,
    readError: null, retryAt: demoScreen === "probleme" ? t + 120 : null,
  };
}

function retailGame(): GameView {
  return { ...game(), game: "retail", label: "Retail", enabled: false, site: "https://roster.sleyvazh.fr", install: retail, running: false, history: [], report: null, groups: [], hasFrg: false, lastPush: null, lastPull: null, lastError: null, retryAt: null, unknown: [], manual: [] };
}

let state: Status = {
  version: "0.1.0", now: now(), overall: demoScreen === "probleme" ? "error" : "active", tooltip: "Roster Companion",
  device: demoScreen === "appairage" ? null : { id: "d1", name: "PC-FLO", user: "Flo", linkedAt: now() - 3600 },
  setupDone: !["appairage", "dossiers"].includes(demoScreen), pausedUntil: null, settings, games: [game(), retailGame()],
  installs: [forever, retail, { ...forever, path: "C:\\Games\\World of Warcraft\\_classic_era_", dirName: "_classic_era_", version: "1.15.7.61000", game: null, test: false, addonVersion: null }],
  pairing: demoScreen === "appairage" ? { userCode: "KPTZ-RQMV", verifyUrl: "https://forever-roster.sleyvazh.fr/appairer?code=KPTZ-RQMV", expiresAt: now() + 582, status: "pending", message: null } : null,
  os: "windows",
};

const listeners = new Set<(s: Status) => void>();
const push = () => { state = { ...state, now: now() }; listeners.forEach(f => f(state)); };

const JOURNAL = [
  "2026-10-06T19:40:02Z  INFO Roster Companion 0.1.0 démarre (avec la session)",
  "2026-10-06T19:40:03Z  INFO dossiers trouvés : _classic_beta_ (Forever), _retail_ (Retail)",
  "2026-10-06T21:42:11Z  INFO sauvegarde lue (compte 12345678#1) : 3 blocs",
  "2026-10-06T21:42:12Z  INFO envoyé au site : Tournicoti, Brakka, bilan de « Vroum Vroum »",
  "2026-10-06T21:43:00Z  INFO données du site relevées : 1 groupe, 3 raids",
];

export async function demoInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise(r => setTimeout(r, 150));
  switch (cmd) {
    case "get_status": return state as T;
    case "journal": return JOURNAL as T;
    case "diagnostic": return `Roster Companion ${state.version} (démo)\n${JOURNAL.join("\n")}` as T;
    case "set_settings": state = { ...state, settings: args?.settings as Settings }; break;
    case "pause": state = { ...state, pausedUntil: now() + 3600, overall: "paused" }; break;
    case "pair_start": state = { ...state, pairing: { userCode: "KPTZ-RQMV", verifyUrl: "#", expiresAt: now() + 600, status: "pending", message: null } }; break;
    case "finish_setup": state = { ...state, setupDone: true }; break;
    case "resolve_unknown": state = { ...state, games: state.games.map(g => ({ ...g, unknown: [] })) }; break;
    case "send_manual": case "dismiss_manual": state = { ...state, games: state.games.map(g => ({ ...g, manual: [] })) }; break;
    case "ignored_list": return ["Banquier-Forever EU"] as T;
    case "unlink": state = { ...state, device: null, setupDone: false }; return null as T;
    default: break;
  }
  push();
  return undefined as T;
}

export function demoListen(fn: (s: Status) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
