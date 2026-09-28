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

/* ---------- Types renvoyés par l'API ---------- */

export interface User {
  id: string; email: string | null; emailVerified: boolean; displayName: string; battletag: string | null;
  hasPassword: boolean; hasBattlenet: boolean; createdAt: string;
}
export interface Me { user: User | null; csrfToken: string | null; battlenetEnabled: boolean }

export interface Prof { name: string; skill: number }
export interface Character {
  id: string; userId: string; name: string; race: string; cls: string; spec1: string; spec2: string; level: number;
  talents: string; talentLink: string; talents2: string; talentLink2: string;
  professions: { prof1: Prof; prof2: Prof; cooking: number; fishing: number; firstAid: number };
  gear: Record<string, { cur?: string; q?: number | null; bis?: string; got?: boolean }>;
  legacy: Record<string, { name: string; rank: number; max: number }[]>;
  notes: string; sortOrder: number; updatedAt: string; owner?: string;
}

export type GroupRole = "owner" | "officer" | "member";
export interface GroupSummary { id: string; name: string; role: GroupRole; members: number }
export interface Member { userId: string; displayName: string; battletag: string | null; role: GroupRole; joinedAt: string }

export interface RaidSlot { group: number; pos: number; characterId: string }
export interface RaidChar { id: string; name: string; cls: string; spec1: string; level: number; race: string; owner: string }
export interface Coverage { id: string; covered: boolean; sources: number; missingGroups: number[] }
