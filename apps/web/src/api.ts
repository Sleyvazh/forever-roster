/** Client HTTP : cookies de session automatiques (même origine) + jeton CSRF sur les requêtes qui modifient. */

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => { csrfToken = t; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Erreur ${res.status}`);
  if (data && typeof data === "object" && "csrfToken" in data) setCsrf((data as { csrfToken: string | null }).csrfToken);
  return data as T;
}

export const get = <T,>(p: string) => api<T>("GET", p);
export const post = <T,>(p: string, b: unknown = {}) => api<T>("POST", p, b);
export const patch = <T,>(p: string, b: unknown) => api<T>("PATCH", p, b);
export const put = <T,>(p: string, b: unknown) => api<T>("PUT", p, b);
export const del = <T,>(p: string, b?: unknown) => api<T>("DELETE", p, b);

/** Envoi d'une image en binaire brut (le serveur la ré-encode). */
export async function uploadImage<T>(path: string, blob: Blob): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT", credentials: "same-origin", body: blob,
    headers: { Accept: "application/json", "Content-Type": blob.type || "image/png", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? (res.status === 413 ? "Image trop lourde." : `Erreur ${res.status}`));
  return data as T;
}
export const imageUrl = (id: string) => `/api/images/${id}`;

/* ---------- Types renvoyés par l'API ---------- */

export interface User {
  id: string; email: string | null; emailVerified: boolean; displayName: string; battletag: string | null;
  hasPassword: boolean; hasBattlenet: boolean; avatarId: string | null; discordUsername: string | null; discordReminders: boolean; createdAt: string;
}
export interface Me { user: User | null; csrfToken: string | null; battlenetEnabled: boolean; discordEnabled: boolean }

export interface Prof { name: string; skill: number }
export interface Character {
  id: string; userId: string; name: string; race: string; cls: string; spec1: string; spec2: string; level: number;
  talents: string; talentLink: string; talents2: string; talentLink2: string;
  professions: { prof1: Prof; prof2: Prof; cooking: number; fishing: number; firstAid: number };
  gear: Record<string, GearEntry>;
  legacy: Record<string, { name: string; rank: number; max: number }[]>;
  notes: string; portraitId: string | null; sortOrder: number; updatedAt: string; owner?: string;
  /** Talents lus en jeu par l'addon (null tant qu'aucun export). */
  talentNodes?: import("@forever/game-data").ExportedTalentNode[] | null;
  /** Dans la liste des persos d'un groupe : niveau d'objet moyen et BiS obtenus. */
  gearStats?: import("@forever/game-data").GearStats;
}

export interface GearEntry { cur?: string; curId?: number | null; q?: number | null; bis?: string; bisId?: number | null; bisQ?: number | null; got?: boolean }

/* ---------- Données du jeu ---------- */

/** origin « era » : objet absent des fichiers du client Forever, complété avec Classic Era (stats possiblement différentes). */
export interface GameItem {
  id: number; name: string; quality: number; itemLevel: number; reqLevel: number; kind: string; inventoryType: number; origin?: "forever" | "era";
  details?: import("@forever/game-data").ItemDetails;
  /** Fabriqué par une recette de métier : l'infobulle charge alors « Où l'obtenir ». */
  crafted?: boolean;
}
export interface ItemSources {
  crafted: { spellId: number; recipe: string; profession: string; reqSkill: number; trainer: boolean;
    patterns: { id: number; name: string; quality: number }[]; crafters: { name: string; owner: string; mine: boolean }[]; wanted?: { name: string; owner: string; mine: boolean }[] }[];
}
export interface GameRecipe {
  spellId: number; skillLine: number; name: string; reqSkill: number; trivialLow: number; trivialHigh: number; category: string;
  createdItemId: number | null; createdCount: number; enchant: string | null; reagents: { id: number; n: number }[]; taughtBy: number[]; fromItem: boolean;
}
export interface GameStatus { build: string | null; importedAt: string | null; items: number; recipes: number }
export type RecipeStatus = "known" | "wanted";
export interface Crafter { characterId: string; name: string; owner: string }
export interface CraftersRecipe {
  spellId: number; name: string; skillLine: number; reqSkill: number; enchant: string | null;
  item: GameItem | null; known: Crafter[]; wanted: Crafter[];
}

export type GroupRole = "owner" | "officer" | "member";
export interface GroupSummary { id: string; name: string; role: GroupRole; members: number }
export interface Member { userId: string; displayName: string; battletag: string | null; avatarId: string | null; role: GroupRole; joinedAt: string }

export interface RaidSignup {
  id: string; userId: string | null; discordUserId: string | null; displayName: string; characterId: string | null; characterName: string | null;
  cls: string; spec: string; role: "Tank" | "Heal" | "DPS" | null; status: import("@forever/game-data").SignupStatus; note: string; createdAt: string; mine: boolean;
}
/** Place dans la compo : un perso du site ou un inscrit sans compte (inscription libre depuis Discord). */
export interface RaidSlot { group: number; pos: number; characterId?: string; signupId?: string }
export const slotKey = (s: { characterId?: string; signupId?: string }) => (s.characterId ? `c:${s.characterId}` : `s:${s.signupId}`);
export interface RaidChar { id: string; name: string; cls: string; spec1: string; level: number; race: string; owner: string }
export interface Coverage { id: string; covered: boolean; sources: number; missingGroups: number[] }
