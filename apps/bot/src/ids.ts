import { SIGNUP_STATUSES, type SignupStatus } from "@forever/game-data";

/**
 * Identifiants des boutons et menus (custom_id, 100 caractères max).
 * Forme : fr|<action>|<raidId>[|<statut>]. Le contenu est relu et validé à chaque clic :
 * n'importe qui peut forger un custom_id, le site revérifie donc tout de son côté.
 */
export type Action =
  | { a: "st"; raidId: string; status: SignupStatus }   // bouton de statut de l'annonce
  | { a: "chg"; raidId: string; status: SignupStatus }  // « changer de perso / spé »
  | { a: "off"; raidId: string }                        // se désinscrire
  | { a: "char"; raidId: string; status: SignupStatus } // menu : choix du perso
  | { a: "pick"; raidId: string; status: SignupStatus } // menu : perso + spé (valeur « persoId:spé »)
  | { a: "cls"; raidId: string; status: SignupStatus }  // menu (sans compte) : classe
  | { a: "gspec"; raidId: string; status: SignupStatus }; // menu (sans compte) : spé (valeur « classe:spé »)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITH_STATUS = new Set(["st", "chg", "char", "pick", "cls", "gspec"]);

export function encodeId(x: Action): string {
  return x.a === "off" ? `fr|off|${x.raidId}` : `fr|${x.a}|${x.raidId}|${x.status}`;
}

export function decodeId(id: string): Action | null {
  const [p, a, raidId, status, ...rest] = id.split("|");
  if (p !== "fr" || !a || !raidId || !UUID.test(raidId) || rest.length) return null;
  if (a === "off") return status === undefined ? { a, raidId } : null;
  if (!WITH_STATUS.has(a) || !(SIGNUP_STATUSES as readonly string[]).includes(status ?? "")) return null;
  return { a, raidId, status: status as SignupStatus } as Action;
}

/** Valeur « a:b » d'une option de menu (b peut contenir des espaces, jamais « : »). */
export function splitValue(v: string): [string, string] | null {
  const i = v.indexOf(":");
  if (i <= 0 || i === v.length - 1) return null;
  return [v.slice(0, i), v.slice(i + 1)];
}
