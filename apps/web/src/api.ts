import type { SignupStatus } from "@forever/game-data";
import { getLang, t } from "./i18n";
/**
 * Client HTTP : cookies de session automatiques (même origine) + jeton CSRF sur les requêtes qui modifient. L'en-tête
 * X-Lang donne la langue de la page : l'API répond dans cette langue (messages d'erreur, résultats, e-mails).
 */

let csrfToken: string | null = null;
export const setCsrf = (t: string | null) => { csrfToken = t; };

export class ApiError extends Error {
  /** code : repère stable de l'erreur (le message suit la langue), par exemple « csrf ». */
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

/**
 * Requête à l'API. Un « Jeton CSRF invalide » (jeton pas encore reçu : page ouverte depuis un lien d'e-mail et
 * requête envoyée dès l'affichage, ou session changée dans un autre onglet) relit le jeton de la session, puis la
 * requête repart une fois.
 */
export async function api<T = unknown>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Lang": getLang() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(`/api${path}`, {
    method, headers, credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  const { error, code } = (data as { error?: string; code?: string } | null) ?? {};
  if (!res.ok && res.status === 403 && method !== "GET" && !retried && code === "csrf") {
    await api("GET", "/auth/me");
    return api<T>(method, path, body, true);
  }
  if (!res.ok) throw new ApiError(res.status, error ?? t("Erreur {status}", { status: res.status }), code);
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
    headers: { Accept: "application/json", "Content-Type": blob.type || "image/png", "X-Lang": getLang(), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? (res.status === 413 ? t("Image trop lourde.") : t("Erreur {status}", { status: res.status })));
  return data as T;
}
export const imageUrl = (id: string) => `/api/images/${id}`;

/* ---------- Types renvoyés par l'API ---------- */

export interface User {
  id: string; email: string | null; emailVerified: boolean; displayName: string; battletag: string | null;
  hasPassword: boolean; hasBattlenet: boolean; avatarId: string | null; discordUsername: string | null; discordReminders: boolean; createdAt: string;
  /** Roster : langue des noms du jeu (auto = navigateur) et accès anticipé tant que Roster est fermé. */
  gameLang: import("@forever/game-data").GameLangPref; rosterPreview: boolean;
  /** Forever : mes inscriptions faites en jeu peuvent passer par un officier avec Roster Companion (activé d'office). */
  gameRelay: boolean;
  /** Langue du site (auto = celle du navigateur). */
  lang: import("./i18n").LangPref;
  /** Admin du site (page des signalements) ; dernière version de l'addon vue à l'import. */
  siteAdmin?: boolean; addonVersion?: string | null;
}
export interface Me { user: User | null; csrfToken: string | null; battlenetEnabled: boolean; discordEnabled: boolean }

export interface Prof { name: string; skill: number }
export interface Character {
  id: string; userId: string; name: string; realm: string; race: string; cls: string; spec1: string; spec2: string; level: number;
  talents: string; talentLink: string; talents2: string; talentLink2: string;
  professions: { prof1: Prof; prof2: Prof; cooking: number; fishing: number; firstAid: number };
  gear: Record<string, GearEntry>;
  legacy: Record<string, { name: string; rank: number; max: number }[]>;
  notes: string; portraitId: string | null; sortOrder: number; updatedAt: string; owner?: string;
  /** Talents lus en jeu par l'addon (null tant qu'aucun export). */
  talentNodes?: import("@forever/game-data").ExportedTalentNode[] | null;
  /** Dernière mise à jour depuis l'addon. */
  addonSyncedAt?: string | null;
  /** Lot K1 : perso du jeu lié à la fiche (« Prénom-Royaume »), retenu par l'import de l'addon. */
  addonKey?: string | null;
  /** Lot « Guilde » : GUID du perso en jeu (addon 1.6.2), clé de la liste de guilde. */
  guid?: string | null;
  /** R2b (Roster) : lu chez Blizzard (import Battle.net ou « Mettre à jour »). */
  realmSlug?: string; ilvl?: number | null; activeSpec?: string; bnet?: boolean; bnetSyncedAt?: string | null;
  /** Dans la liste des persos d'un groupe : perso principal (main) de son joueur dans ce groupe. */
  isMain?: boolean;
  /** Dans Mes persos : groupe où le perso est rangé (un seul, ou aucun) et s'il y est le main. */
  group?: { id: string; name: string; isMain: boolean } | null;
  /** Dans la liste des persos d'un groupe : niveau d'objet moyen et BiS obtenus. */
  gearStats?: import("@forever/game-data").GearStats;
  /** Niveau verrouillé (7/11) : relevé en jeu (liste de guilde), ou fixé par un officier ; absent ou null : libre. */
  levelLock?: import("@forever/game-data").FicheLevelLock | null;
  /** Fiche créée par un officier ou donnée par un autre compte (8/11), jusqu'à ce que son joueur la modifie ou la synchronise. */
  origin?: { kind: "created" | "given"; by: string; at: string } | null;
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
export interface GroupSummary {
  id: string; name: string; role: GroupRole; members: number; discordLinked: boolean; upcoming: number;
  nextRaid: { id: string; name: string; scheduledAt: string; coming: number; mine: SignupStatus | null } | null;
  roles: { tank: number; heal: number; dps: number };
}
export interface Member { userId: string; displayName: string; battletag: string | null; avatarId: string | null; role: GroupRole; joinedAt: string; banker: boolean }
/** Qui crée les raids et les sorties (réglage des officiers). */
export type Creators = "officers" | "members";
/** Une guilde du site (GET /groups/:id). */
export interface GroupDetail {
  group: {
    id: string; name: string; game: import("@forever/game-data").Game; site: { name: string; origin: string };
    /** Salons liés et leur nom (null : inconnu, rapporté par le bot sous peu). */
    discordLinked: boolean; discordChannelName: string | null; ordersLinked: boolean; ordersChannelName: string | null;
    outingsLinked: boolean; outingsChannelName: string | null;
    /** Langue du bot sur Discord (annonces, MP, réponses) : choisie à la création (langue de la page), puis par les officiers. */
    lang: "fr" | "en";
    /** Qui crée les raids et les sorties, et si je le peux. */
    creators: { raids: Creators; outings: Creators; canCreateRaid: boolean; canCreateOuting: boolean };
  };
  role: GroupRole;
  /** Je suis banquier (Forever) : je traite les demandes de retrait à la banque, comme les officiers. */
  banker: boolean;
  members: Member[];
  /** Chef et officiers : avis Discord suivis par la guilde (null pour un membre). */
  feedback: { linked: boolean; unseen: number } | null;
}

export interface RaidSignup {
  id: string; userId: string | null; discordUserId: string | null; displayName: string; characterId: string | null; characterName: string | null;
  /** Royaume du perso inscrit (Roster : « Prénom-Royaume » de l'export pour l'addon). */
  characterRealm?: string | null;
  cls: string; spec: string; role: "Tank" | "Heal" | "DPS" | null; status: import("@forever/game-data").SignupStatus; note: string; createdAt: string; mine: boolean;
}
/** Place dans la compo : un perso du site ou un inscrit sans compte (inscription libre depuis Discord). */
export interface RaidSlot { group: number; pos: number; characterId?: string; signupId?: string }
export const slotKey = (s: { characterId?: string; signupId?: string }) => (s.characterId ? `c:${s.characterId}` : `s:${s.signupId}`);
export interface RaidChar { id: string; name: string; cls: string; spec1: string; level: number; race: string; owner: string }
export interface Coverage { id: string; covered: boolean; sources: number; missingGroups: number[] }

/* ---------- Signalements (bug, idée, question) ---------- */

export type ReportKind = "bug" | "idea" | "question";
export type ReportArea = "site" | "addon" | "bot" | "companion";
export type ReportStatus = "new" | "wip" | "done" | "refused";
/** Avis Discord suivi par un groupe (Administration → Avis) : mêmes statuts que les signalements. */
export type FeedbackStatus = ReportStatus;
export interface FeedbackMessage { id: number; from: "team" | "author"; name: string | null; text: string; source: "discord" | "site"; delivered: boolean | null; createdAt: string; unseen: boolean }
export interface GroupFeedbackItem {
  id: string; anonymous: boolean; author: string | null; text: string; status: FeedbackStatus; reachable: boolean;
  createdAt: string; closedAt: string | null; authorAt: string; unseen: boolean; messages: FeedbackMessage[];
}
/** « État du site » (admins) : le bot Discord, la dernière sauvegarde de nuit, les 5 dernières alertes (la plus récente d'abord). */
export interface SiteStatus {
  /** watched : false quand il n'y a pas de bot sur ce serveur (ni dernier signe de vie, ni coupure). */
  bot: { watched: boolean; lastSeenAt: string | null; down: boolean; downSince: string | null };
  backup: { at: string | null; bytes: number | null; late: boolean };
  alerts: { at: string; kind: "bot_down" | "bot_up" | "backup_late" | "backup_ok"; text: string }[];
}
export interface Report {
  id: string; author: string; game: import("@forever/game-data").Game; kind: ReportKind; area: ReportArea; title: string; body: string;
  page: string; browser: string; addonVersion: string | null; hasImage: boolean;
  status: ReportStatus; reply: string; repliedAt: string | null; repliedBy: string | null; unseen: boolean; createdAt: string; updatedAt: string;
}
