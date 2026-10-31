/**
 * Journaux du jeu (journal de guilde, journaux de la banque) : le jeu ne donne qu'un « il y a N heures », la date d'une
 * ligne n'est connue qu'à l'heure près et la même ligne est relue à chaque relevé. Date d'une ligne et rapprochement avec
 * les lignes déjà gardées, communs à guild-import.ts (journal de guilde) et guild-bank.ts (journaux de la banque).
 */

const HOUR = 3600e3;
/** Deux lectures de la même ligne (« il y a N heures ») diffèrent de moins d'une heure ; marge de 2 h. */
export const GAME_LOG_TOLERANCE = 2 * HOUR;
/** Une ligne plus ancienne que ça vient d'un « il y a » démesuré (le relevé ne borne pas les heures). */
const EARLIEST_LOG = Date.UTC(2000, 0, 1);

/** Date d'une ligne lue à l'instant `readAt` (ms) : « il y a N heures » ; null si la date est impossible ou d'avant 2000 (ligne à sauter). */
export function gameLogDate(readAt: number, hoursAgo: number): Date | null {
  const date = new Date(readAt - hoursAgo * HOUR);
  return date.getTime() >= EARLIEST_LOG ? date : null; // une date impossible (NaN) ne passe pas la comparaison
}

/**
 * Lignes reçues rapprochées des lignes déjà gardées (même clé, à 2 h près, la plus proche, chacune ne sert qu'une fois) :
 * `fresh` les lignes à ajouter (de la plus ancienne à la plus récente), `earlier` les lignes gardées à reculer (la lecture
 * la plus proche de l'événement est la plus ancienne : « il y a » est arrondi en dessous). Deux lignes identiques d'un même
 * relevé sont deux événements : seules les lignes déjà gardées servent de modèle, jamais les lignes reçues entre elles.
 */
export function matchGameLog<I extends { key: string; at: Date }>(incoming: readonly I[], stored: readonly { id: number; key: string; at: Date }[]) {
  const byKey = new Map<string, { id: number; at: Date }[]>();
  for (const s of stored) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
  const used = new Set<number>();
  const fresh: I[] = [], earlier: { id: number; at: Date }[] = [];
  for (const e of [...incoming].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    let best: { id: number; at: Date } | null = null;
    for (const s of byKey.get(e.key) ?? []) {
      if (used.has(s.id)) continue;
      const d = Math.abs(s.at.getTime() - e.at.getTime());
      if (d <= GAME_LOG_TOLERANCE && (!best || d < Math.abs(best.at.getTime() - e.at.getTime()))) best = s;
    }
    if (!best) { fresh.push(e); continue; }
    used.add(best.id);
    if (e.at.getTime() < best.at.getTime()) earlier.push({ id: best.id, at: e.at });
  }
  return { fresh, earlier };
}
