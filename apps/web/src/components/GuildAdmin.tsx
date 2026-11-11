import type { GuildLinkResponse, LevelAnnounce } from "@forever/game-data";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { del, post, put } from "../api";
import { agoText, guildKeys, useGuildLink } from "../guild";
import { refreshGuild } from "./GuildMembers";
import { FactionBadge } from "./Icons";
import { dateLocale, N, t, tn, tx } from "../i18n";

/**
 * Administration d'une guilde de Forever (lot « Guilde ») : guilde du jeu liée (ou proposées) et « Délier » ; réglage des
 * annonces de la Course au 60 dans « Discord et relances ». Routes : /api/groups/:id/guild/link, /guild/announces.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
const longDate = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(iso));
const faction = (f: string) => (f === "Alliance" || f === "Horde" ? f : null);

/** Section « Guilde du jeu » : le lien, ce qui a été relevé, « Délier » ; sans lien, les guildes du jeu proposées. */
export function GuildLinkSection({ groupId, guard }: { groupId: string; guard: Guard }) {
  const qc = useQueryClient();
  const q = useGuildLink(groupId);
  const [confirm, setConfirm] = useState(false);
  const d = q.data;
  const done = async (r?: GuildLinkResponse) => { if (r) qc.setQueryData(guildKeys.link(groupId), r); setConfirm(false); await refreshGuild(qc, groupId); };
  return (
    <section className="stack admin-sec" aria-labelledby="gg-title">
      <div className="row between">
        <h3 id="gg-title" style={{ margin: 0 }}>{t("Guilde du jeu")}</h3>
        {d && (d.link ? <span className="tag ok">{t("Liée")}</span> : <span className="tag">{t("Non liée")}</span>)}
      </div>
      {!d ? <p className="muted">{t("Chargement…")}</p> : d.link ? <>
        <div className="gl-card">
          {faction(d.link.faction) ? <FactionBadge faction={faction(d.link.faction)!} size={30} /> : <span className="tag">{d.link.faction}</span>}
          <b>{d.link.name}</b>
          <small>{tx("{realm} · liée le {date} par {linkedBy}", { realm: d.link.realm, date: longDate(d.link.linkedAt), linkedBy: d.link.linkedBy })}{d.link.auto ? t(", à son premier relevé") : ""}</small>
        </div>
        <dl className="gl-facts">
          <dt>{t("Liste de guilde")}</dt>
          <dd>{d.link.roster ? <>{tn(d.link.roster.total, "{n} membre, relevée par {by} {ago}", "{n} membres, relevée par {by} {ago}", { by: d.link.roster.by, ago: agoText(d.link.roster.at) })}{d.link.roster.complete ? "" : <> {t("(partielle)")}</>}</> : <span className="muted">{t("pas encore relevée")}</span>}</dd>
          <dt>{t("Journal")}</dt>
          <dd>{d.link.journalAt ? t("relevé {ago}", { ago: agoText(d.link.journalAt) }) : <span className="muted">{t("pas encore relevé")}</span>}</dd>
        </dl>
        <p className="hint" style={{ margin: 0 }}>{t("La liste la plus récente, envoyée par n'importe quel membre qui a l'addon, l'emporte.")}</p>
        <div className="row">
          {confirm
            ? <span className="row small">{t("Délier efface la liste, le journal et les niveaux (la course repart de zéro) ; les rattachements des persos restent.")}<button type="button" className="btn danger sm" onClick={() => void guard(async () => { await del(`/groups/${groupId}/guild/link`); await done(); })}>{t("Délier")}</button>
                <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>{t("Annuler")}</button></span>
            : <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)}>{t("Délier la guilde du jeu")}</button>}
        </div>
      </> : <>
        <p className="hint" style={{ margin: 0 }}>{t("La synchro d'un officier qui a l'addon à jour lie la guilde toute seule ; sinon, elle est proposée ici.")}</p>
        {d.proposals.length > 0 && (
          <ul className="gd-list" aria-label={t("Guildes du jeu proposées")}>{d.proposals.map(p => (
            <li key={p.key} className="gl-card">
              {faction(p.faction) ? <FactionBadge faction={faction(p.faction)!} size={30} /> : <span className="tag">{p.faction}</span>}
              <span className="row between" style={{ gap: 8 }}><b>{p.name}</b>
                <button type="button" className="btn primary sm" onClick={() => void guard(async () => { await done(await post<GuildLinkResponse>(`/groups/${groupId}/guild/link`, { key: p.key })); })}>{t("Lier")}</button></span>
              <small>{p.realm} · {tn(p.members, "{n} membre", "{n} membres")} · {t("proposée par {by} {ago}", { by: p.by, ago: agoText(p.at) })}</small>
            </li>
          ))}</ul>
        )}
      </>}
    </section>
  );
}

const OPTIONS: [LevelAnnounce, string, string][] = [
  ["none", N("Rien"), N("Le classement reste sur le site.")],
  ["sixty", N("Les 60 seulement"), N("Un message par 60 atteint. Par défaut.")],
  ["tens", N("Tous les 10 niveaux"), N("20, 30, 40, 50 et 60 : une ligne courte, le 60 en grand.")],
];

/** « Discord et relances » : annonces de la Course au 60 dans le salon de la guilde. */
export function RaceAnnounces({ groupId, linked, guard }: { groupId: string; linked: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const q = useGuildLink(groupId);
  const value = q.data?.announce;
  const save = (announce: LevelAnnounce) => void guard(async () => {
    await put(`/groups/${groupId}/guild/announces`, { announce });
    qc.setQueryData<GuildLinkResponse>(guildKeys.link(groupId), d => (d ? { ...d, announce } : d));
  });
  return (
    <section className="stack admin-sec" aria-labelledby="ann-t">
      <h3 id="ann-t" style={{ margin: 0 }}>{t("Annonces de la Course au 60")}</h3>
      {value && <>
        <fieldset className="ann" aria-labelledby="ann-t">
          {OPTIONS.map(([k, tt, sub]) => (
            <label key={k}><input type="radio" name="ann" value={k} checked={value === k} onChange={() => save(k)} /><b>{t(tt)}</b><small>{t(sub)}</small></label>
          ))}
        </fieldset>
        <p className="ann-prev">{value === "none" ? t("Rien n'est publié sur Discord.") : <>{tx("Aperçu : {el}, 1{el2} de la guilde, 9 jours après la sortie.", { el: <b>{t("🏆 Kaeldra Brisevent atteint le niveau 60")}</b>, el2: <sup>{t("re")}</sup> })}{value === "tens" && <><br />{tx("⬆️ {el} atteint le niveau 50 · 4{el2} de la guilde.", { el: <b>{t("Morwen Cendrevoile")}</b>, el2: <sup>{t("e")}</sup> })}</>}</>}</p>
      </>}
      <p className="hint" style={{ margin: 0 }}>{linked ? t("Dans le salon de la guilde. Rien n'est publié avant la sortie.") : t("Dans le salon de la guilde, une fois lié. Rien n'est publié avant la sortie.")}</p>
    </section>
  );
}
