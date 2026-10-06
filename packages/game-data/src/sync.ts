/**
 * Roster Companion (lot K1) : appairage d'un appareil et synchro automatique entre l'addon et le site.
 * Partagé par l'API, le site et (pour les formats) l'appli.
 */

/** Lettres du code d'appairage : consonnes seulement (pas de mot gênant, pas de confusion 0/O ou 1/I). */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const USER_CODE_TTL_S = 600;
export const PAIR_POLL_INTERVAL_S = 5;

/** « kptz rqmv », « KPTZ-RQMV » → « KPTZ-RQMV » ; null si ce n'est pas un code valide. */
export function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length !== 8 || [...letters].some(c => !USER_CODE_ALPHABET.includes(c))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

/** Clé d'un perso du jeu (« Prénom-Royaume ») : retrouve sa fiche d'un envoi à l'autre, sur tous les appareils. */
export const addonKeyOf = (d: { name: string; realm: string }) => `${d.name}-${d.realm}`;

/** Ce qu'on reprend d'un export de perso (choix « Choisir quoi importer » du Ctrl+V). */
export const IMPORT_PARTS = ["identity", "gear", "professions", "recipes", "talents", "signups"] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

/**
 * Résultat d'un bloc importé (perso FRC ou bilan FRB).
 * unknown : perso que le site ne connaît pas, à créer ou ignorer (l'appli demande) ; ignored : ignoré exprès ;
 * kept : bilan non remplacé (celui du chef de raid est déjà enregistré) ; refused : pas le droit (bilan d'un membre).
 */
export type ImportStatus = "updated" | "created" | "unknown" | "ignored" | "skipped" | "kept" | "refused" | "error";
export interface ImportResult {
  key: string;
  kind: "character" | "raidlog";
  name: string;
  status: ImportStatus;
  message: string;
  /** Perso : classe et niveau lus en jeu (pour proposer la création). */
  cls?: string | null;
  level?: number;
  characterId?: string;
  raidId?: string;
}
