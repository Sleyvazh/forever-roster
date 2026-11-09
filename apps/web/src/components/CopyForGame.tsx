import { get } from "../api";

type GameData = { text: string; groups: { name: string; raids: number; patterns: number; bis: number }[] };

/**
 * Copie les données de tous mes groupes pour l'addon (FRG pour Forever Roster, RRG pour l'addon Roster de WoW Retail :
 * l'adresse du site choisit le format). Le texte est demandé au serveur pendant le clic :
 * ClipboardItem avec une promesse garde l'autorisation de copier (Safari), sinon écriture classique.
 */
export async function copyGameData(): Promise<GameData> {
  const data = get<GameData>("/addon/export");
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": data.then(d => new Blob([d.text], { type: "text/plain" })) })]);
      return data;
    } catch { /* repli ci-dessous */ }
  }
  const d = await data;
  await navigator.clipboard.writeText(d.text);
  return d;
}
