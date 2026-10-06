/**
 * Enregistrements automatiques en attente (fiche de perso, 0,7 s après la dernière modification).
 * Un import de l'addon (Ctrl+V) les envoie d'abord : sinon une modification encore en attente, partie après l'import,
 * remettrait l'ancien équipement par-dessus celui du jeu.
 */
const flushers = new Set<() => Promise<void>>();
export function registerAutosave(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}
export async function flushAutosaves() {
  await Promise.all([...flushers].map(f => f().catch(() => undefined)));
}
