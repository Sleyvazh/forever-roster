import { POLL_MAX_LABEL, POLL_MAX_OPTIONS, POLL_MAX_QUESTION, POLL_MAX_SLOTS, pollEndText, slotText, zonedParts, type Role } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, del, get, post, put } from "../api";
import { DateField, isoOf, TimeSelect } from "./DateTime";
import { DialogHead, Modal } from "./Dialog";
import { getLang, N, t, tn, tx } from "../i18n";

/**
 * Sondages de la guilde sur le site (27/11/2026) : Forever, Guilde › Sondages ; Roster, onglet Sondages. Maquette B
 * choisie par Flo : la liste à gauche (ouverts, puis clos gardés 90 jours), le sondage choisi à droite ; « + Sondage »
 * dans une fenêtre (maquette C : Sondage / Disponibilités). Les mêmes sondages sont sur Discord (/sondage, /dispos) : un
 * vote ici compte là-bas, et l'inverse. Règles côté serveur : apps/api/src/lib/polls.ts. Classes CSS « pl- ».
 * `?sondage=<id>` (lien « Sur le site » du bot) ouvre ce sondage.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
interface PollOption { id: number; label: string; at: string | null; yes: number | null; maybe: number | null; no: number | null; roles: Record<Role, number> | null }
interface Vote { yes: number[]; maybe: number[] }
export interface Poll {
  id: string; kind: "choice" | "dates"; question: string; multi: boolean; anonymous: boolean; results: "live" | "end"; hidden: boolean;
  options: PollOption[]; voters: number; best: number | null; leaders: number[];
  closesAt: string | null; deadline: string; closedAt: string | null; createdAt: string;
  creator: string; createdBy: string | null; raidName: string;
  raid: { id: string; name: string; scheduledAt: string | null; url: string } | null;
  channelId: string | null; url: string;
  mine: Vote | null; canClose: boolean; canDelete: boolean; canRaid: boolean;
}
interface PollsData {
  polls: Poll[]; canCreate: boolean; creators: "officers" | "members";
  discord: { channel: string | null } | null;
  me: { name: string; role: Role | null };
}
interface Voter { name: string; role: Role | null; guest: boolean }

const ROLE_WORD: Record<Role, string> = { Tank: N("tank"), Heal: N("heal"), DPS: "DPS" };
const roleWord = (r: Role) => (r === "DPS" ? "DPS" : t(ROLE_WORD[r]));
const errorOf = (e: unknown) => (e instanceof ApiError ? e.message : t("Action impossible."));
const slot = (o: { at: string | null; label: string }) => (o.at ? slotText(new Date(o.at), getLang()) : o.label);
const endText = (iso: string) => pollEndText(new Date(iso), getLang());
const shortDay = (iso: string) => new Intl.DateTimeFormat(getLang() === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
const answered = (p: Poll) => !!p.mine && (p.kind === "dates" || p.mine.yes.length > 0);
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
/** Choix cité : « … » ou “…”. */
const quoted = (s: string) => (getLang() === "en" ? `“${s}”` : `« ${s} »`);

/** Résumé d'un sondage clos : le choix en tête, ou le raid créé, ou le meilleur créneau. */
function outcome(p: Poll) {
  if (p.raid) return t("Raid créé : {name}", { name: p.raid.name });
  if (p.kind === "dates") { const b = p.options.find(o => o.id === p.best); return b ? t("★ {slot}", { slot: slot(b) }) : t("Aucun « Oui »"); }
  const lead = p.options.filter(o => p.leaders.includes(o.id));
  if (!lead.length) return t("Aucun vote");
  return lead.length > 1 ? t("Ex æquo : {list}", { list: lead.map(o => quoted(o.label)).join(", ") }) : t("{label} l'emporte", { label: quoted(lead[0]!.label) });
}

export function PollsTab({ groupId, guard }: { groupId: string; guard: Guard }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["polls", groupId], queryFn: () => get<PollsData>(`/groups/${groupId}/polls`) });
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const detail = useRef<HTMLDivElement>(null);
  const d = q.data;
  if (q.isLoading) return <p className="muted">{t("Chargement…")}</p>;
  if (!d) return <div className="alert error" role="alert">{t("Sondages indisponibles pour l'instant.")}</div>;
  const open = d.polls.filter(p => !p.closedAt), closed = d.polls.filter(p => p.closedAt);
  const wanted = params.get("sondage");
  const sel = d.polls.find(p => p.id === wanted) ?? open.find(p => !answered(p)) ?? open[0] ?? closed[0] ?? null;
  const pick = (id: string) => {
    const next = new URLSearchParams(params); next.set("sondage", id); setParams(next, { replace: true });
    // Téléphone : la liste est au-dessus du sondage
    if (window.matchMedia("(max-width: 860px)").matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ["polls", groupId] });
  const item = (p: Poll) => (
    <button key={p.id} type="button" role="listitem" className={`pl-li${sel?.id === p.id ? " on" : ""}`} aria-current={sel?.id === p.id} onClick={() => pick(p.id)}>
      <span aria-hidden="true">{p.kind === "dates" ? "📅" : "📊"}</span>
      <span style={{ minWidth: 0 }}>
        <span className="q">{p.question}</span>
        <span className="m">
          {p.closedAt ? <span>{outcome(p)} · {t("clos le {day}", { day: shortDay(p.closedAt) })}</span>
            : <>{answered(p) ? <span className="pl-tag done">{p.kind === "dates" ? t("Répondu") : t("Voté")}</span> : <span className="pl-tag todo">{t("À répondre")}</span>}
              <span>{p.closesAt ? t("fin {day}", { day: shortDay(p.closesAt) }) : t("sans date de fin")}</span></>}
        </span>
      </span>
    </button>
  );
  return (
    <div className="pl-split">
      <div className="stack pl-side">
        {d.canCreate ? <button type="button" className="btn primary" onClick={() => setCreating(true)}>{t("+ Sondage")}</button>
          : <p className="hint" style={{ margin: 0 }}>{d.creators === "officers" ? t("Les officiers posent les sondages ; tu réponds ici ou sur Discord.") : t("Tu réponds ici ou sur Discord.")}</p>}
        {!d.polls.length && <p className="hint pl-empty">{tx("Aucun sondage pour l'instant. Sur Discord, {poll} pose une question et {dates} demande les soirs où chacun peut raider.", { poll: <code>/sondage</code>, dates: <code>/dispos</code> })}</p>}
        {!!open.length && <><p className="pl-sec">{t("Ouverts · {n}", { n: open.length })}</p><div className="pl-list" role="list">{open.map(item)}</div></>}
        {!!closed.length && <><p className="pl-sec">{t("Clos · gardés 90 jours")}</p><div className="pl-list" role="list">{closed.map(item)}</div></>}
      </div>
      <div ref={detail} className="pl-main">
        {sel ? <PollCard key={sel.id} groupId={groupId} poll={sel} me={d.me} onChange={refresh} guard={guard} />
          : <div className="pl-card pl-none"><p className="hint">{t("Choisis un sondage dans la liste, ou pose le premier.")}</p></div>}
      </div>
      {creating && <PollDialog groupId={groupId} discord={d.discord} onClose={() => setCreating(false)} onCreated={async id => { setCreating(false); await refresh(); pick(id); }} />}
    </div>
  );
}

/* ---------- Un sondage ---------- */

function PollCard({ groupId, poll: p, me, onChange, guard }: { groupId: string; poll: Poll; me: PollsData["me"]; onChange: () => Promise<unknown>; guard: Guard }) {
  const qc = useQueryClient();
  const [who, setWho] = useState<{ options: { id: number; yes: Voter[]; maybe: Voter[] }[]; none: Voter[] } | null>(null);
  const [ask, setAsk] = useState<"close" | "delete" | null>(null);
  const [raid, setRaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closed = !!p.closedAt;
  const base = `/groups/${groupId}/polls/${p.id}`;
  const mine = p.mine ?? { yes: [], maybe: [] };
  /** Vote enregistré : la liste se recharge (compteurs), « Qui a voté ? » aussi s'il est ouvert. */
  const save = (fn: () => Promise<unknown>) => void guard(async () => {
    setBusy(true);
    try {
      await fn();
      await onChange();
      if (who) setWho(await get(`${base}/voters`));
    } finally { setBusy(false); }
  });
  const choose = (id: number) => {
    if (closed || busy) return;
    const has = mine.yes.includes(id);
    const yes = has ? mine.yes.filter(x => x !== id) : p.multi ? [...mine.yes, id] : [id];
    save(() => put(`${base}/vote`, { yes }));
  };
  const answer = (id: number, a: "yes" | "maybe" | "no") => {
    if (closed || busy) return;
    const yes = mine.yes.filter(x => x !== id), maybe = mine.maybe.filter(x => x !== id);
    if (a === "yes") yes.push(id); else if (a === "maybe") maybe.push(id);
    save(() => put(`${base}/dates`, { yes, maybe }));
  };
  const toggleWho = () => void guard(async () => { setWho(who ? null : await get(`${base}/voters`)); });
  const total = p.options.reduce((n, o) => n + (o.yes ?? 0), 0);
  const meta = [
    t("Posé par {name}", { name: p.creator }),
    ...(p.kind === "dates" ? [t("réponds pour chaque créneau")] : [p.anonymous ? t("vote anonyme") : t("vote public"), p.multi ? t("plusieurs choix") : t("un seul choix")]),
    ...(p.hidden ? [t("résultats à la fin")] : []),
    closed ? t("clos le {when}", { when: endText(p.closedAt!) }) : p.closesAt ? t("se termine {when}", { when: endText(p.closesAt) }) : t("jusqu'à ce qu'il soit clos"),
  ];
  const canWho = !p.anonymous && !p.hidden && p.voters > 0;
  return (
    <article className="pl-card sel" aria-labelledby={`pl-q-${p.id}`}>
      <header className="pl-h">
        <span className="ic" aria-hidden="true">{p.kind === "dates" ? "📅" : "📊"}</span>
        <div style={{ minWidth: 0 }}>
          <h3 id={`pl-q-${p.id}`}>{p.question}</h3>
          <p className="pl-meta">{meta.join(" · ")} · {p.channelId ? <span className="dc">{t("aussi sur Discord")}</span> : <span>{t("site seulement")}</span>}</p>
        </div>
        {closed ? <span className="pl-tag">{t("Clos")}</span> : answered(p) ? <span className="pl-tag done">{p.kind === "dates" ? t("Répondu") : t("Tu as voté")}</span> : <span className="pl-tag todo">{t("À répondre")}</span>}
      </header>

      {p.kind === "choice" ? (
        <div className="pl-opts" role="group" aria-label={t("Choix")}>
          {p.options.map(o => {
            const on = mine.yes.includes(o.id);
            const lead = p.leaders.includes(o.id) && (closed || p.voters >= 2);
            return (
              <button key={o.id} type="button" className={`pl-opt${on ? " mine" : ""}`} disabled={closed || busy} aria-pressed={on}
                style={{ "--p": `${o.yes === null ? 0 : pct(o.yes, total)}%` } as CSSProperties} onClick={() => choose(o.id)}>
                <span className={`mk${p.multi ? " sq" : ""}`} aria-hidden="true">{on ? "✓" : ""}</span>
                <span className="l">{o.label}{lead && <span aria-label={t("en tête")}> 🏆</span>}</span>
                {o.yes !== null && <span className="n">{o.yes} · {pct(o.yes, total)} %</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="pl-grid" role="table" aria-label={t("Créneaux")}>
          <div className="pl-gr pl-gh" role="row">
            <span role="columnheader">{t("Créneau")}</span><span role="columnheader">{closed ? "" : t("Ta réponse")}</span>
            <span role="columnheader" className="c">{t("Oui")}</span><span role="columnheader" className="c">{t("Si besoin")}</span><span role="columnheader" className="c">{t("Non")}</span>
            <span role="columnheader">{t("Oui par rôle")}</span>
          </div>
          {p.options.map(o => {
            const a = mine.yes.includes(o.id) ? "yes" : mine.maybe.includes(o.id) ? "maybe" : p.mine ? "no" : null;
            return (
              <div key={o.id} role="row" className={`pl-gr${o.id === p.best ? " best" : ""}`}>
                <span role="cell" className="pl-slot">{o.id === p.best && <span className="star" aria-label={t("meilleur créneau")}>★ </span>}{slot(o)}</span>
                <span role="cell">{!closed && (
                  <span className="seg" role="group" aria-label={t("Ta réponse pour {slot}", { slot: slot(o) })}>
                    {([["yes", t("Oui")], ["maybe", t("Si besoin")], ["no", t("Non")]] as const).map(([k, l]) => (
                      <button key={k} type="button" className={a === k ? `on ${k}` : ""} aria-pressed={a === k} disabled={busy} onClick={() => answer(o.id, k)}>{l}</button>
                    ))}
                  </span>
                )}</span>
                <span role="cell" className="c num" data-l={t("Oui")}>{o.yes}</span>
                <span role="cell" className="c num" data-l={t("Si besoin")}>{o.maybe}</span>
                <span role="cell" className="c num" data-l={t("Non")}>{o.no}</span>
                <span role="cell" className={`pl-roles${o.roles && o.roles.Tank + o.roles.Heal + o.roles.DPS > 0 ? "" : " none"}`}>{o.roles && o.roles.Tank + o.roles.Heal + o.roles.DPS > 0
                  ? <><b className="t">TANK</b> {o.roles.Tank} · <b className="h">HEAL</b> {o.roles.Heal} · {o.roles.DPS} DPS</> : "—"}</span>
              </div>
            );
          })}
        </div>
      )}

      {p.raid && <p className="pl-raid">🗓️ {tx("Raid créé : {link}", { link: <a href={p.raid.url}>{p.raid.name}{p.raid.scheduledAt ? ` · ${slot({ at: p.raid.scheduledAt, label: "" })}` : ""}</a> })}</p>}

      <div className="pl-foot">
        <p className="hint">
          {p.kind === "choice"
            ? <>{tn(p.voters, "{n} vote", "{n} votes")}{closed ? "" : p.hidden ? ` · ${t("les résultats s'affichent à la fin")}` : ` · ${p.multi ? t("chaque clic coche ou décoche un choix") : t("clique un autre choix pour changer d'avis, le tien pour le retirer")}`}</>
            : <>{tn(p.voters, "{n} réponse", "{n} réponses")}{p.best ? ` · ${t("★ meilleur créneau : le plus de « Oui », puis de « Si besoin »")}` : ""}
              {!closed && <> · {tx("tu réponds avec {name}", { name: <b>{me.name}</b> })}{me.role ? ` (${roleWord(me.role)})` : ""}</>}</>}
        </p>
        <div className="row">
          {canWho && <button type="button" className="btn sm ghost" aria-expanded={!!who} onClick={toggleWho}>{p.kind === "dates" ? t("Qui a répondu ?") : t("Qui a voté ?")}</button>}
          {p.canRaid && !!p.best && <button type="button" className="btn sm primary" onClick={() => setRaid(true)}>{t("Créer le raid sur ★")}</button>}
          {p.raid && <a className="btn sm" href={p.raid.url}>{t("Voir le raid")}</a>}
          {ask === null && p.canClose && <button type="button" className="btn sm ghost" onClick={() => setAsk("close")}>🔒 {p.kind === "dates" ? t("Clore") : t("Clore le sondage")}</button>}
          {ask === null && p.canDelete && <button type="button" className="btn sm ghost" onClick={() => setAsk("delete")}>{t("Effacer")}</button>}
          {ask && <span className="row small pl-ask">
            {ask === "close" ? t("Clore ? Les votes s'arrêtent, les résultats restent.") : t("Effacer ce sondage, ses votes et son message Discord ?")}
            <button type="button" className="btn danger sm" onClick={() => void guard(async () => {
              if (ask === "close") await post(`${base}/close`, {}); else await del(base);
              setAsk(null); await qc.invalidateQueries({ queryKey: ["polls", groupId] });
            })}>{ask === "close" ? t("Clore") : t("Effacer")}</button>
            <button type="button" className="btn ghost sm" onClick={() => setAsk(null)}>{t("Annuler")}</button>
          </span>}
        </div>
      </div>

      {notice && <div className="alert ok" role="status">{notice}</div>}
      {who && <Voters poll={p} data={who} />}
      {raid && <RaidDialog groupId={groupId} poll={p} onClose={() => setRaid(false)} onDone={async msg => {
        setRaid(false); setNotice(msg);
        await Promise.all([onChange(), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);
      }} />}
    </article>
  );
}

function Voters({ poll: p, data }: { poll: Poll; data: { options: { id: number; yes: Voter[]; maybe: Voter[] }[]; none: Voter[] } }) {
  const names = (l: Voter[]) => l.map(v => `${v.name}${v.guest ? " ✱" : ""}`).join(", ");
  const guests = [...data.options.flatMap(o => [...o.yes, ...o.maybe]), ...data.none].some(v => v.guest);
  return (
    <div className="pl-who">
      {p.options.map(o => {
        const x = data.options.find(y => y.id === o.id) ?? { yes: [], maybe: [] };
        return p.kind === "choice"
          ? <span key={o.id}><b>{o.label}</b> ({x.yes.length}){x.yes.length ? ` · ${names(x.yes)}` : ""}</span>
          : <span key={o.id}><b>{slot(o)}</b> · ✅ {x.yes.length ? names(x.yes) : "—"}{x.maybe.length ? <> · 🤔 {names(x.maybe)}</> : null}</span>;
      })}
      {p.kind === "dates" && !!data.none.length && <span><b>{t("Aucun créneau")}</b> · ❌ {names(data.none)}</span>}
      {guests && <span className="hint">{t("✱ a répondu depuis Discord, sans compte du site")}</span>}
    </div>
  );
}

/* ---------- Créer le raid sur ★ ---------- */

function RaidDialog({ groupId, poll: p, onClose, onDone }: { groupId: string; poll: Poll; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState(p.raidName);
  const [at, setAt] = useState(p.options.find(o => o.id === p.best)?.at ?? p.options[0]?.at ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSending(true);
    try {
      const r = await post<{ raid: { name: string }; hasChannel: boolean }>(`/groups/${groupId}/polls/${p.id}/raid`, { name, scheduledAt: at });
      await onDone(r.hasChannel ? t("Raid « {name} » créé ; son annonce part dans le salon des raids. Le sondage est clos.", { name: r.raid.name }) : t("Raid « {name} » créé. Le sondage est clos.", { name: r.raid.name }));
    } catch (x) { setErr(errorOf(x)); setSending(false); }
  };
  return (
    <Modal label="pl-raid-t" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <DialogHead id="pl-raid-t" title={t("Créer le raid")} sub={p.question} onClose={onClose} />
        <div className="fld"><label htmlFor="pl-rn">{t("Nom du raid")}</label><input id="pl-rn" value={name} maxLength={60} required minLength={2} onChange={e => setName(e.target.value)} placeholder={t("Ex. Onyxia")} /></div>
        <div className="fld"><label htmlFor="pl-rs">{t("Créneau")}</label>
          <select id="pl-rs" value={at} onChange={e => setAt(e.target.value)}>
            {p.options.map(o => <option key={o.id} value={o.at ?? ""}>{o.id === p.best ? "★ " : ""}{slot(o)} · {t("{yes} oui, {maybe} si besoin", { yes: o.yes ?? 0, maybe: o.maybe ?? 0 })}</option>)}
          </select>
        </div>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={sending}>{t("Créer le raid")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- « + Sondage » (maquette C) ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (iso: string) => { const z = zonedParts(new Date(iso)); return `${z.year}-${pad(z.month)}-${pad(z.day)}`; };
const plusDays = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number) as [number, number, number]; const x = new Date(Date.UTC(y, m - 1, d + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
const isoAt = (day: string, time: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return isoOf({ y, m, d, h, mi });
};
interface Slot { day: string; time: string }

function PollDialog({ groupId, discord, onClose, onCreated }: { groupId: string; discord: PollsData["discord"]; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const today = dayOf(new Date().toISOString());
  const [kind, setKind] = useState<"choice" | "dates">("choice");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [slots, setSlots] = useState<Slot[]>([1, 2, 3].map(n => ({ day: plusDays(today, n), time: "21:00" })));
  const [anonymous, setAnonymous] = useState(true);
  const [multi, setMulti] = useState(false);
  const [results, setResults] = useState<"live" | "end">("live");
  const [endOn, setEndOn] = useState(false);
  const [end, setEnd] = useState<Slot>({ day: plusDays(today, 2), time: "20:00" });
  const [raidName, setRaidName] = useState("");
  const [toDiscord, setToDiscord] = useState(!!discord);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Toujours une case vide en bas tant qu'il reste de la place (comme une liste qu'on tape)
  useEffect(() => {
    if (choices.length < POLL_MAX_OPTIONS && choices[choices.length - 1]!.trim()) setChoices(c => [...c, ""]);
  }, [choices]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSending(true);
    try {
      const options = kind === "choice"
        ? choices.map(c => c.trim()).filter(Boolean).map(label => ({ label }))
        : slots.map(s => ({ label: "", at: isoAt(s.day, s.time) }));
      const r = await post<{ poll: { id: string } }>(`/groups/${groupId}/polls`, {
        kind, question, options, multi, anonymous, results, raidName, discord: toDiscord,
        closesAt: endOn ? isoAt(end.day, end.time) : null,
      });
      await onCreated(r.poll.id);
    } catch (x) { setErr(errorOf(x)); } finally { setSending(false); }
  };
  const lastSlot = slots[slots.length - 1];
  return (
    <Modal label="pl-new-t" onClose={onClose} className="pl-dlg">
      <form className="stack" onSubmit={submit}>
        <DialogHead id="pl-new-t" title={t("Nouveau sondage")} onClose={onClose} />
        <div className="seg pl-kind" role="group" aria-label={t("Sorte de sondage")}>
          <button type="button" className={kind === "choice" ? "on" : ""} aria-pressed={kind === "choice"} onClick={() => { setKind("choice"); setEndOn(false); }}>📊 {t("Sondage")}</button>
          <button type="button" className={kind === "dates" ? "on" : ""} aria-pressed={kind === "dates"} onClick={() => { setKind("dates"); setEndOn(false); }}>📅 {t("Disponibilités")}</button>
        </div>
        <div className="fld"><label htmlFor="pl-q">{t("Question")}</label>
          <input id="pl-q" value={question} maxLength={POLL_MAX_QUESTION} required onChange={e => setQuestion(e.target.value)}
            placeholder={kind === "dates" ? t("Quel soir pour Onyxia la semaine prochaine ?") : t("Quel donjon jeudi soir ?")} /></div>

        {kind === "choice" ? (
          <fieldset className="pl-fs"><legend>{t("Choix · {min} à {max}", { min: 2, max: POLL_MAX_OPTIONS })}</legend>
            {choices.map((c, i) => (
              <div key={i} className="pl-opt-in">
                <span className="num" aria-hidden="true">{i + 1}</span>
                <input value={c} maxLength={POLL_MAX_LABEL} aria-label={t("Choix {n}", { n: i + 1 })} placeholder={i >= 2 ? t("Un autre choix…") : ""} onChange={e => setChoices(l => l.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="pl-x" aria-label={t("Retirer le choix {n}", { n: i + 1 })} disabled={choices.length <= 2} onClick={() => setChoices(l => l.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </fieldset>
        ) : (
          <fieldset className="pl-fs"><legend>{t("Créneaux · {min} à {max} (heure de Paris)", { min: 2, max: POLL_MAX_SLOTS })}</legend>
            {slots.map((s, i) => (
              <div key={i} className="pl-slot-in">
                <span className="num" aria-hidden="true">{i + 1}</span>
                <DateField value={s.day} min={today} onChange={day => setSlots(l => l.map((x, j) => (j === i ? { ...x, day } : x)))} />
                <TimeSelect value={s.time} onChange={time => setSlots(l => l.map((x, j) => (j === i ? { ...x, time } : x)))} />
                <button type="button" className="pl-x" aria-label={t("Retirer le créneau {n}", { n: i + 1 })} disabled={slots.length <= 2} onClick={() => setSlots(l => l.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {slots.length < POLL_MAX_SLOTS && lastSlot && <button type="button" className="btn sm ghost" style={{ justifySelf: "start" }}
              onClick={() => setSlots(l => [...l, { day: plusDays(lastSlot.day, 1), time: lastSlot.time }])}>{t("+ Un créneau (le lendemain, même heure)")}</button>}
          </fieldset>
        )}

        {kind === "choice" ? (
          <div className="pl-two">
            <div className="stack" style={{ gap: 8 }}>
              <label className="pl-chk"><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />{t("Vote anonyme")}</label>
              <label className="pl-chk"><input type="checkbox" checked={multi} onChange={e => setMulti(e.target.checked)} />{t("Plusieurs choix par personne")}</label>
            </div>
            <div className="stack" style={{ gap: 6 }}><b className="pl-lb">{t("Résultats")}</b>
              <div className="seg" role="group" aria-label={t("Résultats")}>
                <button type="button" className={results === "live" ? "on" : ""} aria-pressed={results === "live"} onClick={() => setResults("live")}>{t("En direct")}</button>
                <button type="button" className={results === "end" ? "on" : ""} aria-pressed={results === "end"} onClick={() => setResults("end")}>{t("À la fin")}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="fld"><label htmlFor="pl-rname">{t("Nom du raid (pour « Créer le raid sur ★ »)")}</label>
            <input id="pl-rname" value={raidName} maxLength={60} onChange={e => setRaidName(e.target.value)} placeholder={t("Ex. Onyxia")} /></div>
        )}

        <div className="stack" style={{ gap: 6 }}><b className="pl-lb">{t("Fin")}</b>
          <div className="row">
            <div className="seg" role="group" aria-label={t("Fin")}>
              <button type="button" className={!endOn ? "on" : ""} aria-pressed={!endOn} onClick={() => setEndOn(false)}>{kind === "dates" ? t("Au premier créneau") : t("Quand je le clos")}</button>
              <button type="button" className={endOn ? "on" : ""} aria-pressed={endOn} onClick={() => setEndOn(true)}>{t("Le")}</button>
            </div>
            {endOn && <><DateField value={end.day} min={today} onChange={day => setEnd(x => ({ ...x, day }))} /><TimeSelect value={end.time} onChange={time => setEnd(x => ({ ...x, time }))} /></>}
          </div>
          {kind === "choice" && !endOn && <p className="hint" style={{ margin: 0 }}>{t("Il se clôt tout seul au bout de 30 jours.")}</p>}
        </div>
        {kind === "dates" && <p className="hint" style={{ margin: 0 }}>{t("Chacun répond Oui, Si besoin ou Non pour chaque créneau. Les réponses sont visibles de la guilde (« Qui a répondu ? »).")}</p>}

        {discord
          ? <label className="pl-chk"><input type="checkbox" checked={toDiscord} onChange={e => setToDiscord(e.target.checked)} />{tx("Le poser aussi sur Discord, dans {channel}", { channel: <b>#{discord.channel ?? t("salon des raids")}</b> })}</label>
          : <p className="hint" style={{ margin: 0 }}>{t("Aucun salon Discord lié aux raids de la guilde : le sondage reste sur le site.")}</p>}
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row pl-acts">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={sending}>{t("Poser le sondage")}</button>
        </div>
      </form>
    </Modal>
  );
}
