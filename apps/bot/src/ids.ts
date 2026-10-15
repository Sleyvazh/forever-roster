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
  | { a: "gspec"; raidId: string; status: SignupStatus } // menu (sans compte) : spé (valeur « classe:spé »)
  | { a: "ask"; askId: string; yes: boolean }            // réponse à « Demander à X » (MP) : fr|ay|<id> ou fr|an|<id>
  | { a: "otake"; orderId: string };                     // « Je m'en charge » d'une commande d'artisanat : fr|ot|<id>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITH_STATUS = new Set(["st", "chg", "char", "pick", "cls", "gspec"]);

export function encodeId(x: Action): string {
  if (x.a === "ask") return `fr|${x.yes ? "ay" : "an"}|${x.askId}`;
  if (x.a === "otake") return `fr|ot|${x.orderId}`;
  return x.a === "off" ? `fr|off|${x.raidId}` : `fr|${x.a}|${x.raidId}|${x.status}`;
}

export function decodeId(id: string): Action | null {
  const [p, a, raidId, status, ...rest] = id.split("|");
  if (p !== "fr" || !a || !raidId || !UUID.test(raidId) || rest.length) return null;
  if (a === "off") return status === undefined ? { a, raidId } : null;
  if (a === "ay" || a === "an") return status === undefined ? { a: "ask", askId: raidId, yes: a === "ay" } : null;
  if (a === "ot") return status === undefined ? { a: "otake", orderId: raidId } : null;
  if (!WITH_STATUS.has(a) || !(SIGNUP_STATUSES as readonly string[]).includes(status ?? "")) return null;
  return { a, raidId, status: status as SignupStatus } as Action;
}

/** Valeur « a:b » d'une option de menu (b peut contenir des espaces, jamais « : »). */
export function splitValue(v: string): [string, string] | null {
  const i = v.indexOf(":");
  if (i <= 0 || i === v.length - 1) return null;
  return [v.slice(0, i), v.slice(i + 1)];
}

/* ---------- Sorties donjon (Forever) ---------- */

export type OutingRole = "Tank" | "Heal" | "DPS";
/**
 * Boutons et menus d'une sortie : fr|oj|<sortie>|<T, H ou D> (rôle), fr|ow|<sortie> (« Me mettre en attente » : choix
 * du rôle), fr|owr|<sortie>|<rôle> (attente pour ce rôle), fr|oo|<sortie> (« Me retirer ») ; menus visibles par le
 * joueur seul : fr|och|<sortie>|<rôle>|<0 ou 1> (perso), fr|ocl|… (classe, sans compte), fr|osp|… (spé), le dernier
 * chiffre disant s'il s'agit de la liste d'attente.
 */
export type OutingAction =
  | { a: "join"; outingId: string; role: OutingRole; wait: boolean }
  | { a: "wait"; outingId: string }
  | { a: "leave"; outingId: string }
  | { a: "char" | "cls" | "spec"; outingId: string; role: OutingRole; wait: boolean };

const ROLE_CODE: Record<OutingRole, string> = { Tank: "T", Heal: "H", DPS: "D" };
const CODE_ROLE: Record<string, OutingRole> = { T: "Tank", H: "Heal", D: "DPS" };
const MENU_CODE = { char: "och", cls: "ocl", spec: "osp" } as const;

export function encodeOutingId(x: OutingAction): string {
  switch (x.a) {
    case "join": return `fr|${x.wait ? "owr" : "oj"}|${x.outingId}|${ROLE_CODE[x.role]}`;
    case "wait": return `fr|ow|${x.outingId}`;
    case "leave": return `fr|oo|${x.outingId}`;
    default: return `fr|${MENU_CODE[x.a]}|${x.outingId}|${ROLE_CODE[x.role]}|${x.wait ? 1 : 0}`;
  }
}

/** Identifiant d'une sortie, ou null (autre bouton, ou forme forgée). */
export function decodeOutingId(id: string): OutingAction | null {
  const [p, a, outingId, r, w, ...rest] = id.split("|");
  if (p !== "fr" || !a || !outingId || !UUID.test(outingId) || rest.length) return null;
  if (a === "ow" || a === "oo") return r === undefined ? { a: a === "ow" ? "wait" : "leave", outingId } : null;
  const role = r ? CODE_ROLE[r] : undefined;
  if (!role) return null;
  if (a === "oj" || a === "owr") return w === undefined ? { a: "join", outingId, role, wait: a === "owr" } : null;
  const menu = (Object.entries(MENU_CODE) as [keyof typeof MENU_CODE, string][]).find(([, code]) => code === a)?.[0];
  if (!menu || (w !== "0" && w !== "1")) return null;
  return { a: menu, outingId, role, wait: w === "1" };
}
