import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, del, get, patch, post, type Report, type ReportStatus } from "../api";
import { useMe } from "../auth";
import { ReportDialog, ReportShot, ReportTags, reportDate, STATUS_LABEL } from "../components/Report";
import { SiteStatus } from "../components/SiteStatus";
import { useSite } from "../site";
import { N, t, tx } from "../i18n";

/** « Mes signalements » : ceux des deux adresses, avec la réponse de l'équipe. */
export function MyReportsPage() {
  const qc = useQueryClient();
  const site = useSite();
  const [writing, setWriting] = useState(false);
  const q = useQuery({ queryKey: ["reports-mine"], queryFn: () => get<{ reports: Report[] }>("/reports/mine") });
  // Réponses nouvelles : marquées lues à l'ouverture, mais encore signalées « Nouveau » pendant la lecture
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const list = q.data?.reports;
  useEffect(() => {
    const unseen = list?.filter(r => r.unseen).map(r => r.id) ?? [];
    if (!unseen.length) return;
    setFresh(prev => new Set([...prev, ...unseen]));
    void post("/reports/mine/seen").then(() => qc.invalidateQueries({ queryKey: ["reports-unseen"] }));
  }, [list, qc]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("Mes signalements")}</h1>
          <p className="hint" style={{ margin: "4px 0 0" }}>{t("Tes bugs, idées et questions, sur Forever Roster comme sur Roster. L'équipe te répond ici.")}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setWriting(true)}>{t("Nouveau signalement")}</button>
      </div>
      {q.isLoading && <p className="muted">{t("Chargement…")}</p>}
      {q.error && <div className="alert error">{t("Impossible de charger tes signalements.")}</div>}
      {list && !list.length && (
        <div className="panel empty">
          <p>{t("Aucun signalement pour l'instant. Un bug, une idée, une question ? Dis-le à l'équipe.")}</p>
          <button type="button" className="btn" onClick={() => setWriting(true)}>{t("Signaler un bug ou une idée")}</button>
        </div>
      )}
      {list?.map(r => (
        <article key={r.id} className="panel pad sg-item">
          <div className="row between">
            <ReportTags r={r} otherSite={r.game !== site.game} />
            <span className="small muted">{reportDate(r.createdAt)}</span>
          </div>
          <h3>{r.title}</h3>
          <p className="sg-body">{r.body}</p>
          {r.hasImage && <ReportShot id={r.id} />}
          {r.reply ? (
            <div className={`sg-reply ${fresh.has(r.id) ? "new" : ""}`}>
              <span className="small muted">{r.repliedBy ? t("Réponse de {name}", { name: r.repliedBy }) : t("Réponse")}{r.repliedAt ? ` · ${reportDate(r.repliedAt)}` : ""}{fresh.has(r.id) && <b className="sg-new"> {t("· Nouveau")}</b>}</span>
              <p className="sg-body">{r.reply}</p>
            </div>
          ) : <span className="small muted">{r.status === "new" ? t("Pas encore lu par l'équipe.") : t("Pas encore de réponse.")}</span>}
        </article>
      ))}
      {writing && <ReportDialog onClose={() => setWriting(false)} />}
    </div>
  );
}

type Filter = "open" | ReportStatus | "all";
const FILTERS: { f: Filter; label: string }[] = [
  { f: "open", label: N("À traiter") }, { f: "new", label: N("Nouveaux") }, { f: "wip", label: N("En cours") },
  { f: "done", label: N("Faits") }, { f: "refused", label: N("Refusés") }, { f: "all", label: N("Tous") },
];

/** Page des admins du site : l'état du site (bot, sauvegarde, alertes), puis tous les signalements, statut, réponse au joueur. */
export function AdminReportsPage() {
  const me = useMe();
  const [params] = useSearchParams();
  const focus = params.get("id");
  const [filter, setFilter] = useState<Filter>("open");
  const admin = !!me.data?.user?.siteAdmin;
  const q = useQuery({
    queryKey: ["reports-admin", filter], enabled: admin,
    queryFn: () => get<{ reports: Report[]; counts: Partial<Record<ReportStatus, number>>; channel: boolean }>(`/reports/admin?status=${filter}`),
  });
  // Lien du message Discord (?id=) : le signalement est montré même s'il n'est plus « à traiter »
  useEffect(() => {
    if (focus && q.data && filter !== "all" && !q.data.reports.some(r => r.id === focus)) setFilter("all");
  }, [focus, q.data, filter]);

  if (!admin) return <div className="empty"><h2>{t("Réservé aux admins du site")}</h2><p className="muted">{t("Pour signaler un bug ou une idée, passe par le menu de ton compte.")}</p></div>;
  const c = q.data?.counts ?? {};
  const count = (f: Filter) => f === "all" ? Object.values(c).reduce((a, b) => a + (b ?? 0), 0) : f === "open" ? (c.new ?? 0) + (c.wip ?? 0) : c[f] ?? 0;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("Administration du site")}</h1>
          <p className="hint" style={{ margin: "4px 0 0" }}>{t("Réservé aux admins : l'état des services et les signalements des joueurs.")}</p>
        </div>
      </div>
      <SiteStatus />
      <div>
        <h2>{t("Signalements")}</h2>
        <p className="hint" style={{ margin: "4px 0 0" }}>{t("Bugs, idées et questions des joueurs, sur les deux adresses. Ta réponse s'affiche dans « Mes signalements » de son auteur.")}</p>
      </div>
      {q.data && !q.data.channel && <div className="alert info">{tx("Aucun salon Discord pour l'instant : tape {el} dans le salon privé des admins pour y recevoir chaque signalement.", { el: <code>/signalements-lier</code> })}</div>}
      <div className="seg sg-filters" role="group" aria-label={t("Filtrer")}>
        {FILTERS.map(x => <button key={x.f} type="button" className={filter === x.f ? "on" : ""} aria-pressed={filter === x.f} onClick={() => setFilter(x.f)}>{t(x.label)} <span className="muted">{count(x.f)}</span></button>)}
      </div>
      {q.isLoading && <p className="muted">{t("Chargement…")}</p>}
      {q.data && !q.data.reports.length && <p className="muted">{t("Rien ici.")}</p>}
      {q.data?.reports.map(r => <AdminReport key={r.id} r={r} focus={r.id === focus} />)}
    </div>
  );
}

function AdminReport({ r, focus }: { r: Report; focus: boolean }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const [reply, setReply] = useState(r.reply);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: "center" }); }, [focus]);
  useEffect(() => setReply(r.reply), [r.reply]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["reports-admin"] }); if (ok) setMsg({ ok: true, text: ok }); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("Action impossible.") }); }
    finally { setBusy(false); }
  };
  const setStatus = (status: ReportStatus) => run(() => patch(`/reports/admin/${r.id}`, { status }));
  // Répondre fait passer un signalement « Nouveau » à « En cours » (il reste modifiable)
  const sendReply = () => run(() => patch(`/reports/admin/${r.id}`, { reply, ...(r.status === "new" && reply.trim() && { status: "wip" }) }), reply.trim() ? t("Réponse envoyée : le joueur la voit dans « Mes signalements ».") : t("Réponse retirée."));

  return (
    <article ref={ref} className={`panel pad sg-item ${focus ? "focus" : ""}`}>
      <div className="row between">
        <ReportTags r={r} otherSite />
        <span className="small muted">{r.author} · {reportDate(r.createdAt)}</span>
      </div>
      <h3>{r.title}</h3>
      <p className="sg-body">{r.body}</p>
      <p className="small muted sg-meta">
        {r.page && tx("Page {page}", { page: <code>{r.page}</code> })}{r.browser && <> · {r.browser}</>}{r.addonVersion && <> · {t("addon {v}", { v: r.addonVersion })}</>}
      </p>
      {r.hasImage && <ReportShot id={r.id} />}
      <div className="sg-admin">
        <div className="fld">
          <label htmlFor={`st-${r.id}`}>{t("Statut")}</label>
          <select id={`st-${r.id}`} value={r.status} disabled={busy} onChange={e => void setStatus(e.target.value as ReportStatus)}>
            {(Object.keys(STATUS_LABEL) as ReportStatus[]).map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
          </select>
        </div>
        <div className="fld">
          <label htmlFor={`sg-${r.id}`}>{t("Réponse au joueur")}{r.repliedBy ? (r.unseen ? t(" (dernière : {name}, pas encore lue)", { name: r.repliedBy }) : t(" (dernière : {name}, lue)", { name: r.repliedBy })) : ""}</label>
          <textarea id={`sg-${r.id}`} maxLength={2000} value={reply} placeholder={t("Visible sur le site seulement, dans « Mes signalements ».")} onChange={e => setReply(e.target.value)} />
        </div>
      </div>
      <div className="row between">
        <span className="row">
          <button type="button" className="btn primary sm" disabled={busy || reply.trim() === r.reply.trim()} onClick={() => void sendReply()}>{r.reply ? t("Modifier la réponse") : t("Répondre")}</button>
          {msg && <span className="small" role="status" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</span>}
        </span>
        {confirmDel
          ? <span className="row small">{t("Supprimer ce signalement (et son message Discord) ?")} <button className="btn danger sm" type="button" disabled={busy} onClick={() => void run(() => del(`/reports/admin/${r.id}`))}>{t("Supprimer")}</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>{t("Annuler")}</button></span>
          : <button className="btn ghost sm" type="button" onClick={() => setConfirmDel(true)}>{t("Supprimer")}</button>}
      </div>
    </article>
  );
}
