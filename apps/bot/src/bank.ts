import { deNom } from "@forever/game-data";
import { ButtonStyle, ComponentType } from "discord.js";
import type { BankNotice, InternalApi } from "./api";
import { langOf, tr, type Lang } from "./i18n";
import { escapeMd, type Row } from "./render";
import type { Logger } from "./sync";

/**
 * Demandes de retrait à la banque de la guilde (Forever) : MP au demandeur quand sa demande est préparée (« à récupérer auprès
 * de Kaeldra ») ou refusée (avec le motif s'il y en a un). Le site ne remet au bot que les MP qu'il peut envoyer (Discord lié,
 * « Messages privés du bot » gardés). Rendu pur (testé sans Discord) et relève.
 */

const linkRow = (url: string, lang: Lang): Row => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: tr(lang, "Voir la banque"), url }] });
/** Le motif sans ponctuation finale : le message se termine par son propre point (« Plus de stock. » donne « … : Plus de stock. », pas « stock.. »). */
const reasonText = (reason: string) => reason.replace(/[\s.!?…]+$/u, "").trim();

export function renderBankNotice(n: BankNotice): { content: string; components: Row[] } {
  const lang = langOf(n);
  const what = `${n.quantity} × ${escapeMd(n.item)}`;
  const reason = reasonText(n.reason);
  const content = n.kind === "prepared"
    ? n.by ? (lang === "en" ? tr(lang, "Ta demande de {what} est prête : à récupérer auprès de {by}.", { what, by: escapeMd(n.by) })
      : `Ta demande de ${what} est prête : à récupérer auprès ${escapeMd(deNom(n.by))}.`)
      : tr(lang, "Ta demande de {what} est prête : à récupérer auprès d'un officier ou d'un banquier de la guilde.", { what })
    : reason ? tr(lang, "Ta demande de {what} a été refusée : {reason}.", { what, reason: escapeMd(reason) })
      : tr(lang, "Ta demande de {what} a été refusée.", { what });
  return { content: content.slice(0, 2000), components: [linkRow(n.url, lang)] };
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
