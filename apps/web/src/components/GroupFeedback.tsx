import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, del, get, patch, post, type FeedbackStatus, type GroupFeedbackItem } from "../api";
import { useSite } from "../site";
import { reportDate, STATUS_LABEL, STATUS_TAG } from "./Report";
import { N, t, tn, tx } from "../i18n";

/**
 * Avis du Discord suivis par le groupe (Administration → Avis), pour le chef et les officiers : ils arrivent par
 * /feedback sur le serveur Discord relié (/feedback-config regler … groupe:<ce groupe>). Statut, fil de la conversation,
 * réponse envoyée en MP à l'auteur par le bot, suppression. Un avis anonyme ne montre jamais son auteur.
 */

type Filter = "open" | FeedbackStatus | "all";
const FILTERS: { f: Filter; label: string }[] = [
  { f: "open", label: N("Ouverts") }, { f: "done", label: N("Faits") }, { f: "refused", label: N("Refusés") }, { f: "all", label: N("Tous") },
];
const MAX_REPLY = 1500;

interface Data {
  feedbacks: GroupFeedbackItem[]; counts: Partial<Record<FeedbackStatus, number>>;
  sources: { guildName: string; allowAnonymous: boolean }[]; keepDays: number;
}

export function GroupFeedback({ groupId, groupName, focus }: { groupId: string; groupName: string; focus: string | null }) {
  const qc = useQueryClient();
  const site = useSite();
  const [filter, setFilter] = useState<Filter>("open");
  const q = useQuery({ queryKey: ["feedback", groupId, filter], queryFn: () => get<Data>(`/groups/${groupId}/feedback?status=${filter}`) });
  // Nouveautés vues à l'ouverture : la pastille part, les « Nouveau » restent affichés pendant la lecture
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const list = q.data?.feedbacks;
  useEffect(() => {
    const unseen = list?.flatMap(f => [...(f.unseen ? [f.id] : []), ...f.messages.filter(m => m.unseen).map(m => `m${m.id}`)]) ?? [];
    if (!unseen.length) return;
    setFresh(prev => new Set([...prev, ...unseen]));
    void post(`/groups/${groupId}/feedback/seen`).then(() => qc.invalidateQueries({ queryKey: ["group", groupId] }));
  }, [list, groupId, qc]);
  // Lien du message Discord (?avis=…) : l'avis est montré même s'il n'est plus ouvert
  useEffect(() => {
    if (focus && q.data && filter !== "all" && !q.data.feedbacks.some(f => f.id === focus)) setFilter("all");
  }, [focus, q.data, filter]);

  const c = q.data?.counts ?? {};
  const count = (f: Filter) => f === "all" ? Object.values(c).reduce((a, b) => a + (b ?? 0), 0) : f === "open" ? (c.new ?? 0) + (c.wip ?? 0) : c[f] ?? 0;
  const sources = q.data?.sources ?? [];
  return (
    <section className="stack admin-sec">
      <div className="row between">
        <h3>{t("Avis du Discord")}</h3>
        <div className="seg" role="group" aria-label={t("Filtrer les avis")}>
          {FILTERS.map(x => <button key={x.f} type="button" className={filter === x.f ? "on" : ""} aria-pressed={filter === x.f} onClick={() => setFilter(x.f)}>{t(x.label)} <span className="muted">{count(x.f)}</span></button>)}
        </div>
      </div>
      {q.data && (sources.length ? <Sources groupId={groupId} sources={sources} /> : (
        <div className="alert info av-how">
          <b>{t("Pas de serveur Discord relié.")}</b> {tx("Sur votre serveur, un membre qui peut le gérer lance {el} avec {el2} et {el3}. La liste ne propose que les guildes liées à ce serveur (salon des raids ou des commandes, onglet « Discord et relances »).", { el: <code>/feedback-config regler</code>, el2: <code>site: {site.name}</code>, el3: <code>guilde: {groupName}</code> })}</div>
      ))}
      {q.isLoading && <p className="muted">{t("Chargement…")}</p>}
      {q.error && <div className="alert error">{t("Impossible de charger les avis.")}</div>}
      {list && !list.length && <p className="muted" style={{ margin: 0 }}>{filter === "open" ? t("Aucun avis à traiter.") : t("Rien ici.")}</p>}
      {list?.map(f => <FeedbackCard key={f.id} groupId={groupId} f={f} fresh={fresh} focus={f.id === focus} keepDays={q.data!.keepDays} />)}
    </section>
  );
}

function Sources({ groupId, sources }: { groupId: string; sources: Data["sources"] }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = sources.map(s => s.guildName);
  const unlink = async () => {
    setError(null);
    try { await del(`/groups/${groupId}/feedback-link`); await qc.invalidateQueries({ queryKey: ["feedback", groupId] }); await qc.invalidateQueries({ queryKey: ["group", groupId] }); setConfirm(false); }
    catch (e) { setError(e instanceof ApiError ? e.message : t("Action impossible.")); }
  };
  return (
    <div className="av-src">
      <span className="av-ico" aria-hidden="true">D</span>
      <p className="small" style={{ margin: 0, flex: "1 1 260px" }}>
        {tx("Arrivent du serveur Discord {el} (/feedback et son bouton). Seuls le chef et les officiers les voient", { el: <b>{names.join(", ")}</b> })}{sources.some(s => s.allowAnonymous) ? t(" ; un avis anonyme reste anonyme ici aussi.") : "."}
      </p>
      {confirm
        ? <span className="row small">{t("Ne plus recevoir les avis ici ? Ceux déjà reçus restent.")} <button className="btn danger sm" type="button" onClick={() => void unlink()}>{t("Ne plus recevoir")}</button><button className="btn ghost sm" type="button" onClick={() => setConfirm(false)}>{t("Annuler")}</button></span>
        : <button className="btn ghost sm" type="button" onClick={() => setConfirm(true)}>{t("Ne plus recevoir")}</button>}
      {error && <span className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
    </div>
  );
}

function FeedbackCard({ groupId, f, fresh, focus, keepDays }: { groupId: string; f: GroupFeedbackItem; fresh: ReadonlySet<string>; focus: boolean; keepDays: number }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const isNew = fresh.has(f.id) || f.messages.some(m => fresh.has(`m${m.id}`));
  const [open, setOpen] = useState(focus || isNew);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { if (focus) { setOpen(true); ref.current?.scrollIntoView({ block: "center" }); } }, [focus]);
  // Du nouveau (avis ou réponse de l'auteur) : ouvert d'office
  useEffect(() => { if (isNew) setOpen(true); }, [isNew]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["feedback", groupId] }); if (ok) setMsg({ ok: true, text: ok }); return true; }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("Action impossible.") }); return false; }
    finally { setBusy(false); }
  };
  const send = async () => {
    if (await run(() => post(`/groups/${groupId}/feedback/${f.id}/reply`, { text: reply.trim() }), t("Réponse envoyée : le bot la transmet en MP à l'auteur."))) setReply("");
  };
  const who = f.anonymous ? <span className="av-anon">{t("Anonyme")}</span> : <b>{f.author ?? "?"}</b>;
  const n = 1 + f.messages.length;
  return (
    <article ref={ref} className={`av-item${open ? " open" : ""}${focus ? " focus" : ""}`}>
      <div className="row between">
        <button type="button" className="av-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {isNew && <span className="av-dot" title={t("Nouveau pour toi")} />}
          <span className={`tag ${STATUS_TAG[f.status]}`}>{t(STATUS_LABEL[f.status])}</span>
          {who}
          <span className="small muted">· {reportDate(f.createdAt)} · {tn(n, "{n} message", "{n} messages")}{!f.reachable && <> · <span style={{ color: "var(--bad)" }}>{t("auteur plus joignable")}</span></>}</span>
        </button>
        {open ? (
          <span className="row av-ctl">
            <select aria-label={t("Statut de l'avis")} value={f.status} disabled={busy} onChange={e => void run(() => patch(`/groups/${groupId}/feedback/${f.id}`, { status: e.target.value }))}>
              {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
            </select>
            {confirmDel
              ? <span className="row small">{t("Supprimer l'avis (et son message dans Discord) ?")} <button className="btn danger sm" type="button" disabled={busy} onClick={() => void run(() => del(`/groups/${groupId}/feedback/${f.id}`))}>{t("Supprimer")}</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>{t("Annuler")}</button></span>
              : <button className="btn ghost sm" type="button" onClick={() => setConfirmDel(true)}>{t("Supprimer")}</button>}
          </span>
        ) : <button type="button" className="av-toggle" onClick={() => setOpen(true)}>{t("Ouvrir")}</button>}
      </div>
      {!open && <p className="av-ex">{f.text}</p>}
      {open && (
        <>
          <div className="av-thread">
            <div className={`av-msg${fresh.has(f.id) ? " new" : ""}`}>
              <span className="small muted"><b>{t("Avis")}</b> · {reportDate(f.createdAt)}{fresh.has(f.id) && <b className="sg-new"> {t("· Nouveau")}</b>}</span>
              <p>{f.text}</p>
            </div>
            {f.messages.map(m => {
              const isFresh = fresh.has(`m${m.id}`);
              return (
                <div key={m.id} className={`av-msg ${m.from}${isFresh ? " new" : ""}`}>
                  <span className="small muted">
                    {m.from === "team"
                      ? <><b>{m.name ?? t("L'équipe")}</b> {m.source === "site" ? t("(depuis le site)") : t("(depuis Discord)")}</>
                      : <b>{f.anonymous ? t("L'auteur répond") : t("{v} répond", { v: m.name ?? f.author ?? "L'auteur" })}</b>}
                    {" "}· {reportDate(m.createdAt)}
                    {m.from === "team" && <> · {m.delivered === null ? t("envoi en cours…") : m.delivered ? <span style={{ color: "var(--ok)" }}>{t("envoyée en MP")}</span> : <span style={{ color: "var(--bad)" }}>{t("non remise (MP fermés)")}</span>}</>}
                    {isFresh && <b className="sg-new"> {t("· Nouveau")}</b>}
                  </span>
                  <p>{m.text}</p>
                </div>
              );
            })}
          </div>
          {f.reachable ? (
            <>
              <textarea aria-label={t("Ta réponse")} maxLength={MAX_REPLY} value={reply} disabled={busy} onChange={e => setReply(e.target.value)}
                placeholder={t("Ta réponse : le bot l'envoie en MP à l'auteur (sans que tu saches qui il est si l'avis est anonyme) et la note sous l'avis dans Discord.")} />
              <div className="row between">
                <span className="small muted">{tx("Réponse possible tant que l'avis est ouvert, puis {keepDays} jours après « Fait » ou « Refusé ».", { keepDays: keepDays })}</span>
                <span className="row">
                  {msg && <span className="small" role="status" style={{ color: msg.ok ? "var(--ok)" : "var(--bad)" }}>{msg.text}</span>}
                  <button type="button" className="btn primary sm" disabled={busy || reply.trim().length < 2} onClick={() => void send()}>{t("Répondre")}</button>
                </span>
              </div>
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>{t("L'auteur n'est plus joignable : l'avis est clos depuis plus de {n} jours. Il reste lisible ici.", { n: keepDays })}{msg && !msg.ok && <span style={{ color: "var(--bad)" }}> {msg.text}</span>}</p>
          )}
        </>
      )}
    </article>
  );
}
