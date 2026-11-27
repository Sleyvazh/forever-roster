/**
 * Quêtes de guilde (Forever, 27/11/2026, spec claude/quetes-guilde.md) : un membre publie une quête et fixe la récompense,
 * d'autres la prennent, la font et la rendent ; le donneur valide chaque preneur, remet la récompense en jeu (« C'est
 * remis ») et le preneur confirme (« Reçu »). Le site ne garde ni l'or ni les objets : il note qui a remis quoi.
 * Partagé par l'API (règles), le bot et le site (affichage).
 */

export const QUEST_TYPES = ["collect", "craft", "dungeon", "help", "other"] as const;
export type QuestType = (typeof QUEST_TYPES)[number];

/** Limites (choix de Flo : 1 à 40 places ; le reste, proposé dans la spec). */
export const QUEST_LIMITS = {
  title: 60, description: 300, objective: 80, rewardText: 80, note: 200,
  places: 40, objectiveQty: 999,
  rewardItems: 5, rewardItemQty: 200,
  /** Or : 99 999 po au plus (en cuivre). */
  rewardCopper: 99_999 * 10_000,
  openPerPlayer: 5, openPerGuild: 50,
} as const;

/** Rappels en MP (un seul chacun) et délai après lequel une récompense compte dans la fiabilité. */
export const QUEST_REMIND_VALIDATE_MS = 3 * 86400e3;
export const QUEST_REMIND_PAY_MS = 48 * 3600e3;
/** Quêtes terminées, closes ou annulées : effacées ce nombre de jours après leur dernière activité. */
export const QUEST_KEEP_DAYS = 365;

/**
 * Ligne d'un preneur : prise → rendue → validée → remise (par le donneur) → reçue (par le preneur).
 * abandoned : il a rendu sa place ; removed : un officier l'a retiré ; expired : l'échéance est passée avant son rendu.
 */
export const TAKER_STATES = ["taken", "turned_in", "validated", "paid", "received", "abandoned", "removed", "expired"] as const;
export type TakerState = (typeof TAKER_STATES)[number];
/** Preneur en cours (il occupe une place et la quête l'attend encore). */
export const ACTIVE_TAKER: readonly TakerState[] = ["taken", "turned_in", "validated", "paid"];
/** Preneur qui occupe une place (en cours, ou fini). */
export const SEATED_TAKER: readonly TakerState[] = [...ACTIVE_TAKER, "received"];

/**
 * État d'une quête :
 * - open : on peut la prendre (places libres, ni close, ni annulée, échéance pas passée) ;
 * - running : plus de nouveau preneur, mais des preneurs en cours ;
 * - done : plus personne en cours et au moins un preneur a reçu sa récompense ;
 * - closed : plus personne en cours, personne n'est allé au bout (close à la main ou échéance passée) ;
 * - cancelled : annulée par son donneur ou un officier.
 */
export type QuestState = "open" | "running" | "done" | "closed" | "cancelled";

export function questStateOf(
  q: { places: number; dueAt: Date | null; closedAt: Date | null; cancelledAt: Date | null },
  takers: readonly { state: TakerState }[],
  now = new Date(),
): QuestState {
  if (q.cancelledAt) return "cancelled";
  const seated = takers.filter(t => SEATED_TAKER.includes(t.state)).length;
  const accepting = !q.closedAt && !(q.dueAt && q.dueAt.getTime() <= now.getTime()) && seated < q.places;
  if (accepting) return "open";
  if (takers.some(t => ACTIVE_TAKER.includes(t.state))) return "running";
  return takers.some(t => t.state === "received") ? "done" : "closed";
}

/** Places libres d'une quête. */
export const freePlaces = (places: number, takers: readonly { state: TakerState }[]) =>
  Math.max(0, places - takers.filter(t => SEATED_TAKER.includes(t.state)).length);

/**
 * Fiabilité d'un joueur :
 * - done : ses quêtes faites (récompense reçue, ou validée) ;
 * - given : ses quêtes publiées (pas annulées) ;
 * - paid / owed : parmi les preneurs qu'il a validés il y a plus de 48 h (ou déjà payés), combien ont confirmé « Reçu ».
 */
export function reliability(
  asTaker: readonly { state: TakerState }[],
  asGiver: readonly { state: TakerState; validatedAt: Date | null }[],
  questsGiven: number,
  now = new Date(),
) {
  const done = asTaker.filter(t => t.state === "validated" || t.state === "paid" || t.state === "received").length;
  const due = asGiver.filter(t => t.state === "received" || t.state === "paid"
    || (t.state === "validated" && !!t.validatedAt && now.getTime() - t.validatedAt.getTime() >= QUEST_REMIND_PAY_MS));
  return { done, given: questsGiven, paid: due.filter(t => t.state === "received").length, owed: due.length };
}

/** Récompense lisible (Discord, MP) : « 3 po 20 pa · 5 × Potion · un enchantement ». */
export function rewardText(copper: number, items: readonly { name: string; qty: number }[], text: string, lang: "fr" | "en" = "fr") {
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  const [pg, ps, pc] = lang === "en" ? ["g", "s", "c"] : [" po", " pa", " pc"];
  const coins = [g && `${g}${pg}`, s && `${s}${ps}`, c && `${c}${pc}`].filter(Boolean).join(" ");
  return [coins, ...items.map(i => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)), text.trim()].filter(Boolean).join(" · ");
}
