import { ButtonStyle, ComponentType } from "discord.js";
import type { BankNotice, InternalApi } from "./api";
import { escapeMd, type Row } from "./render";
import type { Logger } from "./sync";

/**
 * Demandes de retrait à la banque de la guilde (Forever) : MP au demandeur quand sa demande est préparée (« à récupérer auprès
 * de Kaeldra ») ou refusée (avec le motif s'il y en a un). Le site ne remet au bot que les MP qu'il peut envoyer (Discord lié,
 * « Messages privés du bot » gardés). Rendu pur (testé sans Discord) et relève.
 */

const linkRow = (url: string): Row => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir la banque", url }] });
/** « de Kaeldra », « d'Offa » : l'élision devant une voyelle ou un h. */
const deNom = (name: string) => (/^[aeiouyhàâäéèêëîïôöùûüœ]/i.test(name) ? `d'${name}` : `de ${name}`);

export function renderBankNotice(n: BankNotice): { content: string; components: Row[] } {
  const what = `${n.quantity} × ${escapeMd(n.item)}`;
  const content = n.kind === "prepared"
    ? `Ta demande de ${what} est prête : à récupérer auprès ${n.by ? deNom(escapeMd(n.by)) : "d'un officier ou d'un banquier de la guilde"}.`
    : `Ta demande de ${what} a été refusée${n.reason ? ` : ${escapeMd(n.reason)}` : ""}.`;
  return { content: content.slice(0, 2000), components: [linkRow(n.url)] };
}

/** MP à un joueur : true s'il est parti, false si ses MP sont fermés (ou plus de serveur en commun). */
export type DirectMessage = (discordUserId: string, payload: ReturnType<typeof renderBankNotice>, what: string) => Promise<boolean>;

/**
 * Relève des MP de la banque : un par demande préparée ou refusée, pris une seule fois sur le site. Un envoi qui échoue
 * (MP fermés) est abandonné : le demandeur voit l'étape sur le site. L'envoi réussi est confirmé au site.
 */
export function createBankNotices(api: Pick<InternalApi, "claimBankNotices" | "bankNoticeSent">, dm: DirectMessage, log: Logger) {
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { notices } = await api.claimBankNotices();
      for (const n of notices) {
        if (!(await dm(n.discordUserId, renderBankNotice(n), "MP de la banque"))) continue;
        await api.bankNoticeSent(n.id).catch(e => log.warn(`Envoi du MP de la banque non confirmé (${n.id})`, e instanceof Error ? e.message : e));
      }
    } finally { running = false; }
  }
  return { tick };
}
