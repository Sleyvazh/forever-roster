import type { GuildLinkResponse, LevelAnnounce } from "@forever/game-data";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { del, post, put } from "../api";
import { agoText, guildKeys, useGuildLink } from "../guild";
import { refreshGuild } from "./GuildMembers";
import { FactionBadge } from "./Icons";

/**
 * Administration d'une guilde de Forever (lot « Guilde ») : guilde du jeu liée (ou proposées) et « Délier » ; réglage des
 * annonces de la Course au 60 dans « Discord et relances ». Routes : /api/groups/:id/guild/link, /guild/announces.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
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
        <h3 id="gg-title" style={{ margin: 0 }}>Guilde du jeu</h3>
        {d && (d.link ? <span className="tag ok">Liée</span> : <span className="tag">Non liée</span>)}
      </div>
      {!d ? <p className="muted">Chargement…</p> : d.link ? <>
        <div className="gl-card">
          {faction(d.link.faction) ? <FactionBadge faction={faction(d.link.faction)!} size={30} /> : <span className="tag">{d.link.faction}</span>}
          <b>{d.link.name}</b>
          <small>{d.link.realm} · liée le {fmt.format(new Date(d.link.linkedAt))} par {d.link.linkedBy}{d.link.auto ? ", à son premier relevé" : ""}</small>
        </div>
        <dl className="gl-facts">
          <dt>Liste de guilde</dt>
          <dd>{d.link.roster ? <>{d.link.roster.total} membre{d.link.roster.total > 1 ? "s" : ""}, relevée par {d.link.roster.by} {agoText(d.link.roster.at)}{d.link.roster.complete ? "" : " (partielle)"}</> : <span className="muted">pas encore relevée</span>}</dd>
          <dt>Journal</dt>
          <dd>{d.link.journalAt ? `relevé ${agoText(d.link.journalAt)}` : <span className="muted">pas encore relevé</span>}</dd>
        </dl>
        <p className="hint" style={{ margin: 0 }}>
          Chaque membre qui a l'addon à jour envoie la liste à sa synchro ; la plus récente l'emporte. Les notes d'officier ne sont gardées que si
          l'envoyeur est officier ici et peut les lire en jeu. Un relevé d'une autre guilde du jeu est ignoré.
        </p>
        <div className="row">
          {confirm
            ? <span className="row small">Délier efface la liste, le journal et les niveaux (la course repart de zéro) ; les rattachements des persos restent.
                <button type="button" className="btn danger sm" onClick={() => void guard(async () => { await del(`/groups/${groupId}/guild/link`); await done(); })}>Délier</button>
                <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Annuler</button></span>
            : <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)}>Délier la guilde du jeu</button>}
        </div>
      </> : <>
        <p className="hint" style={{ margin: 0 }}>
          Le premier relevé d'un officier qui a l'addon à jour lie la guilde toute seule. S'il est officier de plusieurs guildes sur le site, la guilde du jeu est proposée ici.
        </p>
        {d.proposals.length > 0 && (
          <ul className="gd-list" aria-label="Guildes du jeu proposées">{d.proposals.map(p => (
            <li key={p.key} className="gl-card">
              {faction(p.faction) ? <FactionBadge faction={faction(p.faction)!} size={30} /> : <span className="tag">{p.faction}</span>}
              <span className="row between" style={{ gap: 8 }}><b>{p.name}</b>
                <button type="button" className="btn primary sm" onClick={() => void guard(async () => { await done(await post<GuildLinkResponse>(`/groups/${groupId}/guild/link`, { key: p.key })); })}>Lier</button></span>
              <small>{p.realm} · {p.members} membre{p.members > 1 ? "s" : ""} · proposée par {p.by} {agoText(p.at)}</small>
            </li>
          ))}</ul>
        )}
      </>}
    </section>
  );
}

const OPTIONS: [LevelAnnounce, string, string][] = [
  ["none", "Rien", "Le classement reste sur le site."],
  ["sixty", "Les 60 seulement", "Un message par 60 atteint. Par défaut."],
  ["tens", "Tous les 10 niveaux", "20, 30, 40, 50 et 60 : une ligne courte, le 60 en grand."],
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
      <h3 id="ann-t" style={{ margin: 0 }}>Annonces de la Course au 60</h3>
      {value && <>
        <fieldset className="ann" aria-labelledby="ann-t">
          {OPTIONS.map(([k, t, sub]) => (
            <label key={k}><input type="radio" name="ann" value={k} checked={value === k} onChange={() => save(k)} /><b>{t}</b><small>{sub}</small></label>
          ))}
        </fieldset>
        <p className="ann-prev">{value === "none" ? "Rien n'est publié sur Discord." : <>Aperçu : <b>🏆 Kaeldra Brisevent atteint le niveau 60</b>, 1<sup>re</sup> de la guilde, 9 jours après la sortie.
          {value === "tens" && <><br />⬆️ <b>Morwen Cendrevoile</b> atteint le niveau 50 · 4<sup>e</sup> de la guilde.</>}</>}</p>
      </>}
      <p className="hint" style={{ margin: 0 }}>Dans le salon de la guilde{linked ? "" : ", une fois lié"}. Rien n'est publié avant la sortie.</p>
    </section>
  );
}
