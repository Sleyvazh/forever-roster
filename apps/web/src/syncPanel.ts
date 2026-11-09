/**
 * Panneau Synchro (refonte du 09/11, lot 1) : ouverture depuis n'importe où (bouton de la barre du haut, Accueil, fiche),
 * touche de synchro du joueur retenue dans ce navigateur, et état de la synchro d'un perso (vert, ou orange à 7 jours).
 */
const OPEN = "fr-sync-open";

/** Ouvre le panneau Synchro (écouté par SyncPanel, monté dans la barre du haut). */
export function openSync() {
  window.dispatchEvent(new Event(OPEN));
}
export function onOpenSync(fn: () => void) {
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

/**
 * Touche de synchro rapide lue dans le dernier export collé (ligne B, addon 1.6.6) : gardée dans ce navigateur pour l'étape 1
 * du panneau (« ta touche de synchro F9 »). Rien de grave si le stockage est indisponible : l'étape le dit autrement.
 */
const KEY = "fr-sync-key";
export function rememberedSyncKey(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function rememberSyncKey(key: string | null | undefined) {
  if (!key) return;
  try { localStorage.setItem(KEY, key); } catch { /* stockage indisponible : la touche n'est pas retenue */ }
}

/** Un perso est « en retard » à partir de 7 jours sans synchro (ou jamais synchronisé). */
export const STALE_DAYS = 7;

export interface SyncState {
  /** ok : vert ; warn : orange (7 jours ou plus, ou jamais). */
  tone: "ok" | "warn";
  /** « À jour », « Il y a 12 j », « Jamais ». */
  label: string;
  /** « il y a 3 h », « hier »… (null : jamais synchronisé). */
  ago: string | null;
}

export function syncState(at: string | null | undefined, now = Date.now()): SyncState {
  if (!at) return { tone: "warn", label: "Jamais", ago: null };
  const h = Math.max(0, (now - Date.parse(at)) / 3600e3);
  const d = Math.floor(h / 24);
  const ago = h < 1 ? "à l'instant" : h < 24 ? `il y a ${Math.floor(h)} h` : d === 1 ? "hier" : `il y a ${d} j`;
  return d >= STALE_DAYS ? { tone: "warn", label: `Il y a ${d} j`, ago } : { tone: "ok", label: "À jour", ago };
}
export const isStale = (at: string | null | undefined) => syncState(at).tone === "warn";
