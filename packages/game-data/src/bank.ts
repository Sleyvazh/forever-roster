import type { ClassName } from "./core";
import type { ItemDetails } from "./items";

/**
 * Banque de guilde (Forever, lot « Banque ») : sur le site, on la consulte, tous les membres de la guilde la voient,
 * comme dans le jeu (onglets, cases, or, journaux), telle que l'addon l'a relevée à sa dernière ouverture (lignes B, T, I, X, O
 * du relevé FRL, docs/addon-format.md). Le site ne la modifie pas. Ce fichier : tailles et disposition de la fenêtre du jeu,
 * textes des journaux, demandes de retrait (limites, étapes), et types des réponses de l'API (routes /api/groups/:id/guild/bank…),
 * partagés tels quels avec le site.
 */

/* ---------- Tailles et disposition ---------- */

/** Onglets d'une banque de guilde. */
export const BANK_MAX_TABS = 8;
/** Cases d'un onglet : 14 colonnes de 7 lignes. */
export const BANK_SLOTS = 98;
export const BANK_COLS = 14;
export const BANK_ROWS = 7;

/**
 * Place d'une case (1 à 98) dans la fenêtre du jeu, colonne et ligne comptées depuis 0 en haut à gauche. La fenêtre a
 * 7 groupes de 2 colonnes, remplis de haut en bas : 1 à 7 puis 8 à 14 dans le premier groupe, 15 à 28 dans le suivant…
 */
export function bankSlotPos(slot: number): { col: number; row: number } {
  const group = Math.floor((slot - 1) / 14), i = (slot - 1) % 14;
  return { col: group * 2 + Math.floor(i / 7), row: i % 7 };
}

/* ---------- Or et textes des journaux ---------- */

/** Pièces d'or, d'argent et de cuivre d'un montant en cuivre. */
export function moneyParts(copper: number): { g: number; s: number; c: number } {
  const v = Math.max(0, Math.floor(copper) || 0);
  return { g: Math.floor(v / 10000), s: Math.floor(v / 100) % 100, c: v % 100 };
}

const ITEM_VERBS: Record<string, string> = { deposit: "a déposé", withdraw: "a retiré", move: "a déplacé" };
/** Verbe d'une ligne du journal d'un onglet (« Pikou a déposé… ») ; le type du jeu entre parenthèses s'il est inconnu. */
export const bankItemVerb = (type: string) => (Object.hasOwn(ITEM_VERBS, type) ? ITEM_VERBS[type]! : `(${type})`);

const MONEY_TEXTS: Record<string, { verb: string; sign: 1 | -1 }> = {
  deposit: { verb: "a déposé", sign: 1 },
  withdraw: { verb: "a retiré", sign: -1 },
  repair: { verb: "a payé des réparations", sign: -1 },
  buyTab: { verb: "a acheté un onglet", sign: -1 },
  withdrawForTab: { verb: "a retiré pour un onglet", sign: -1 },
  depositSummary: { verb: "a versé sa part du butin", sign: 1 },
};
/**
 * Texte d'une ligne du journal de l'or, et son sens : +1 l'or entre dans la banque, −1 il en sort. Le verbe est une
 * phrase qui suit le nom (« Vex a payé des réparations », puis le montant signé). Type inconnu : entre parenthèses, une sortie.
 */
export const bankMoneyText = (type: string): { verb: string; sign: 1 | -1 } => (Object.hasOwn(MONEY_TEXTS, type) ? MONEY_TEXTS[type]! : { verb: `(${type})`, sign: -1 });

/* ---------- Demandes de retrait ---------- */

/** Demandes ouvertes (en attente ou préparées) au plus par joueur ; une seule par objet. */
export const BANK_REQUEST_MAX_OPEN = 5;
/** Mot du demandeur, motif d'un refus : caractères au plus. */
export const BANK_REQUEST_NOTE_MAX = 80;
export const BANK_REQUEST_REASON_MAX = 120;
/** Une demande close est effacée 90 jours après sa clôture. */
export const BANK_REQUEST_KEEP_DAYS = 90;
/** Demandes closes montrées sous « Terminées ». */
export const BANK_REQUEST_DONE_SHOWN = 20;

/** « de » ou « d' » devant un nom : l'élision devant une voyelle ou un h (« de Kaeldra », « d'Offa », « d'Hélène »). */
export const dePrefix = (name: string) => (/^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(name) ? "d'" : "de ");
export const deNom = (name: string) => dePrefix(name) + name;

export type BankRequestStatus = "pending" | "prepared" | "done" | "refused" | "cancelled";
/** Ouverte : pas encore close (le joueur en a 5 au plus, une par objet). */
export const bankRequestOpen = (s: BankRequestStatus) => s === "pending" || s === "prepared";
export const BANK_REQUEST_STATUS_LABEL: Record<BankRequestStatus, string> = {
  pending: "En attente", prepared: "Préparée", done: "Remise", refused: "Refusée", cancelled: "Annulée",
};
/** Gestes d'une demande (PATCH /guild/bank/requests/:id) : les trois premiers pour ceux qui traitent, « cancel » pour le demandeur. */
export type BankRequestAction = "prepare" | "done" | "refuse" | "cancel";

/* ---------- Réponses de l'API (site) ---------- */

/** Objet de la banque, comme les objets des autres pages (infobulle : details). */
export interface BankItem {
  id: number; name: string; quality: number; itemLevel: number; reqLevel: number; kind: string; inventoryType: number;
  /** « era » : objet absent des fichiers du client Forever, complété avec Classic Era (stats possiblement différentes). */
  origin?: "forever" | "era";
  details?: ItemDetails;
  /** Fabriqué par une recette de métier. */
  crafted?: boolean;
}
/** Un onglet relevé : nom, date du relevé de ses cases (null : jamais lu, ou onglet que le rang du releveur ne voit pas) et ses cases occupées. */
export interface GuildBankTab {
  tab: number; name: string; at: string | null; by: string;
  slots: { slot: number; id: number; n: number }[];
}
/** Ligne du journal d'un onglet : dépôt, retrait ou déplacement d'un objet (tab1 → tab2 pour un déplacement). */
export interface GuildBankMove {
  id: number; tab: number; type: string; who: string;
  itemId: number | null; n: number | null; tab1: number | null; tab2: number | null;
  /** À l'heure près (journal du jeu). */
  at: string;
}
/** Ligne du journal de l'or (montant en cuivre ; null : le jeu ne l'a pas dit). */
export interface GuildBankMoneyMove { id: number; type: string; who: string; amount: number | null; at: string }

/**
 * Demande de retrait. who.name : le perso main du demandeur dans la guilde (sinon son pseudo du site). handledBy : prénom du perso
 * de celui qui l'a préparée ou close (null : personne encore, ou annulée). at : création ; updatedAt : dernier changement d'étape.
 */
export interface BankRequest {
  id: string; itemId: number; quantity: number; note: string; status: BankRequestStatus;
  who: { userId: string; name: string; cls: ClassName | null; me: boolean };
  handledBy: string | null; reason: string; at: string; updatedAt: string;
}
/** Demandes de la banque : en cours (toutes, la plus ancienne d'abord), les 20 dernières closes, mes demandes ouvertes. */
export interface BankRequests { open: BankRequest[]; done: BankRequest[]; canHandle: boolean; myOpen: number }

/** Banque de la guilde (GET /api/groups/:id/guild/bank). */
export interface GuildBankResponse {
  /** La guilde du site est liée à une guilde du jeu. */
  linked: boolean;
  /** Dernier relevé (null : aucun). money : or en cuivre ; moneyAt : date du dernier relevé de l'or. */
  bank: { at: string; by: string; money: number | null; moneyAt: string | null; tabs: GuildBankTab[] } | null;
  /** Objets des cases, par identifiant. */
  objects: Record<number, BankItem>;
  /** Les 2 derniers mouvements d'or. */
  lastMoney: GuildBankMoneyMove[];
  /** Demandes de retrait, visibles par tous les membres ; canHandle : je les traite (officier, propriétaire ou banquier). */
  requests: BankRequests;
}
/** Journaux de la banque (GET /api/groups/:id/guild/bank/log) : more, s'il y a des lignes plus anciennes. */
export interface GuildBankLogResponse { moves: GuildBankMove[]; money: GuildBankMoneyMove[]; objects: Record<number, BankItem>; more: boolean }
