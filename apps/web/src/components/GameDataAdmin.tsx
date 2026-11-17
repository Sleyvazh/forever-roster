import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, del, get, post, type GameDataAdmin as Data } from "../api";
import { dateLocale, t, tn } from "../i18n";

/**
 * « Données du jeu » (page des admins du site, lot D2) : le dernier import, les correctifs du serveur gardés par le site
 * (et ceux qui attendent le prochain import), les contributeurs qui peuvent envoyer le cache de leur jeu, les derniers
 * envois. Choix de Flo (17/11) : contributeurs de confiance seulement, nommés ici.
 */
const when = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const num = (n: number) => n.toLocaleString(dateLocale());

export function GameDataAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-gamedata"], queryFn: () => get<Data>("/admin/gamedata") });
  const [who, setWho] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-gamedata"] });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!who.trim()) return;
    setBusy(true); setError(null);
    try { await post("/admin/gamedata/contributors", { who: who.trim() }); setWho(""); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Enregistrement impossible.")); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setError(null);
    try { await del(`/admin/gamedata/contributors/${id}`); await refresh(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Enregistrement impossible.")); }
  };

  return (
    <section className="panel pad ss gd-admin" aria-labelledby="gd-title">
      <div className="row between">
        <h2 id="gd-title">{t("Données du jeu")}</h2>
        <span className="small muted">{t("importées chaque nuit s'il y a du nouveau")}</span>
      </div>
      {q.isLoading && <p className="muted">{t("Chargement…")}</p>}
      {q.error && <div className="alert error">{t("Impossible de charger les données du jeu.")}</div>}
      {d && <>
        <div className="ss-cards">
          <div className="ss-card">
            <h3 className="ss-k">{t("Dernier import")}</h3>
            {d.status.importedAt ? <>
              <b className="ss-v"><i className="ss-dot ok" aria-hidden="true" />{t("Client {build}", { build: d.status.build ?? "?" })}</b>
              <span className="small muted">{t("le {when} · {n} objets", { when: when(d.status.importedAt), n: num(d.status.items) })}</span>
            </> : <b className="ss-v"><i className="ss-dot warn" aria-hidden="true" />{t("Jamais importées")}</b>}
          </div>
          <div className="ss-card">
            <h3 className="ss-k">{t("Correctifs du serveur")}</h3>
            <b className="ss-v"><i className={`ss-dot ${d.hotfixes.sinceImport ? "warn" : "ok"}`} aria-hidden="true" />{tn(d.hotfixes.total, "{n} ligne gardée", "{n} lignes gardées", { n: num(d.hotfixes.total) })}</b>
            <span className="small muted">{d.hotfixes.sinceImport
              ? tn(d.hotfixes.sinceImport, "{n} arrivée depuis l'import : au prochain import", "{n} arrivées depuis l'import : au prochain import", { n: num(d.hotfixes.sinceImport) })
              : t("toutes importées")}</span>
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <h3 className="gd-h">{t("Contributeurs")}</h3>
          <p className="hint" style={{ margin: 0 }}>{t("Ils envoient le cache de leur jeu (page Addon, ou Roster Companion). Un cache peut être fabriqué à la main : nomme seulement des joueurs de confiance.")}</p>
          <ul className="gd-contrib">
            {d.contributors.map(c => (
              <li key={c.id}>
                <span className="gd-who"><b>{c.name}</b>{c.email && <span className="muted"> · {c.email}</span>}</span>
                <span className="small muted">{c.lastAt ? t("dernier envoi le {when}", { when: when(c.lastAt) }) : t("aucun envoi")}</span>
                {c.admin ? <span className="tag gold">{t("admin du site")}</span>
                  : <button type="button" className="btn sm ghost" aria-label={t("Retirer {name} des contributeurs", { name: c.name })} onClick={() => void remove(c.id)}>{t("Retirer")}</button>}
              </li>
            ))}
          </ul>
          <form className="gd-add" onSubmit={e => void add(e)}>
            <label htmlFor="gd-who" className="lbl">{t("Ajouter un contributeur")}</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="gd-who" value={who} onChange={e => setWho(e.target.value)} placeholder={t("Adresse e-mail ou pseudo du compte")} maxLength={320} />
              <button type="submit" className="btn" disabled={busy || !who.trim()}>{t("Ajouter")}</button>
            </div>
          </form>
          {error && <div className="alert error" role="alert">{error}</div>}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <h3 className="gd-h">{t("Derniers envois")}</h3>
          {d.uploads.length ? (
            <ul className="ss-alerts gd-uploads">
              {d.uploads.map((u, i) => (
                <li key={i}>
                  <time dateTime={u.at}>{when(u.at)}</time>
                  <span>{u.name ?? t("compte supprimé")} · {u.via === "app" ? t("par Roster Companion") : t("depuis la page Addon")} · {t("client {build}", { build: u.build })}</span>
                  <span className="small">{tn(u.newRows, "{n} nouvelle", "{n} nouvelles", { n: num(u.newRows) })} / {num(u.rows)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>{t("Aucun envoi pour l'instant.")}</p>}
        </div>
      </>}
    </section>
  );
}
