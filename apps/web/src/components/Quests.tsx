import { PRIMARY_PROFESSIONS, QUEST_LIMITS, zonedParts, type QuestType } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, del, get, post, put, type GameItem } from "../api";
import { useMe } from "../auth";
import { DateField, isoOf, TimeSelect } from "./DateTime";
import { DialogHead, Modal } from "./Dialog";
import { ItemIcon } from "./ItemTooltip";
import { NumberField } from "./NumberField";
import { getLang, N, t, tn, tx } from "../i18n";

/**
 * Quêtes de guilde (Forever, Guilde › Quêtes, 27/11/2026 ; maquette validée par Flo) : le tableau (Disponibles, En cours,
 * Terminées, filtres par type), « Mon journal » (à valider, prises, récompenses à remettre) et la fiabilité ; une quête
 * s'ouvre dans une fiche sur parchemin, comme la fenêtre de quête du jeu. Règles côté serveur : apps/api/src/lib/quests.ts.
 * `?quete=<id>` (lien des MP du bot) ouvre cette quête. Classes CSS « qu- ».
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
type TakerState = "taken" | "turned_in" | "validated" | "paid" | "received" | "abandoned" | "removed" | "expired";
type QuestState = "open" | "running" | "done" | "closed" | "cancelled";
interface QItem { id: number; name: string; quality: number; icon: string | null; qty: number }
interface Taker {
  id: string; userId: string; name: string; state: TakerState; note: string; rejectNote: string; disputed: boolean;
  takenAt: string; turnedInAt: string | null; validatedAt: string | null; paidAt: string | null; receivedAt: string | null;
}
export interface Quest {
  id: string; type: QuestType; title: string; description: string; state: QuestState;
  objective: { item: QItem | null; text: string };
  reward: { copper: number; items: QItem[]; text: string; label: string };
  places: number; free: number; minLevel: number | null; profession: string;
  dueAt: string | null; closedAt: string | null; cancelledAt: string | null; createdAt: string; updatedAt: string;
  creator: string; createdBy: string | null; takers: Taker[]; url: string;
}
interface Rel { done: number; given: number; paid: number; owed: number }
export interface QuestsData {
  quests: Quest[]; reliability: Record<string, Rel>; canCreate: boolean; creators: "officers" | "members"; officer: boolean;
  discord: { channel: string | null; quests: boolean } | null;
}

const TYPES: [QuestType, string, string][] = [
  ["collect", N("Collecte"), "M9 3h6l-1.5 3h-3z M8 6h8c3 2.5 4.5 5.5 4.5 9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4C3.5 11.5 5 8.5 8 6z"],
  ["craft", N("Artisanat"), "M14 3l7 7-3 3-7-7z M12.5 8.5L3 18l3 3 9.5-9.5"],
  ["dungeon", N("Donjon"), "M5 21V10a7 7 0 0 1 14 0v11 M3 21h18 M10 21v-5h4v5"],
  ["help", N("Coup de main"), "M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z M9 12l2 2 4-4"],
  ["other", N("Autre"), "M7 4h11a2 2 0 0 1 2 2v1h-4 M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7 M9 10h6M9 14h4"],
];
const typeOf = (k: QuestType) => TYPES.find(x => x[0] === k)!;
const ACTIVE: TakerState[] = ["taken", "turned_in", "validated", "paid"];
const errorOf = (e: unknown) => (e instanceof ApiError ? e.message : t("Action impossible."));
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(getLang() === "en" ? "en-GB" : "fr-FR", { timeZone: "Europe/Paris", ...o });
const dayTime = (iso: string) => fmt({ weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const shortDay = (iso: string) => fmt({ weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));

function TypeIcon({ type, size = 14 }: { type: QuestType; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={typeOf(type)[2]} /></svg>;
}
/** Marqueur du jeu : « ! » disponible, « ? » gris prise, « ? » jaune à valider ou rendue, coche finie. */
function Mark({ kind, size }: { kind: "!" | "?" | "?!" | "ok" | "off"; size?: "lg" | "sm" }) {
  const glyph = kind === "ok" ? "✓" : kind === "!" ? "!" : kind === "off" ? "·" : "?";
  return <span className={`qu-mk ${kind === "?" ? "grey" : kind === "ok" ? "ok" : kind === "off" ? "grey" : ""} ${size ?? ""}`} aria-hidden="true">{glyph}</span>;
}
/** Or comme en jeu : « 3 ● 20 ● ». */
export function Coins({ copper }: { copper: number }) {
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  const part = (n: number, k: "g" | "s" | "c", label: string) => (n ? <span className="qu-money" key={k}>{n}<span className={`qu-coin ${k}`} role="img" aria-label={label} /></span> : null);
  return <>{part(g, "g", t("po"))}{part(s, "s", t("pa"))}{part(c, "c", t("pc"))}</>;
}
function Reward({ q }: { q: Quest }) {
  return (
    <span className="qu-reward">
      <Coins copper={q.reward.copper} />
      {q.reward.items.map(i => <span key={i.id} className={`q${i.quality}`}>{i.qty > 1 ? `${i.qty} × ` : ""}[{i.name}]</span>)}
      {q.reward.text && <span className="qu-rtext">{q.reward.text}</span>}
    </span>
  );
}
const asItem = (i: QItem) => ({ quality: i.quality, details: { icon: i.icon ?? undefined }, inventoryType: 0 }) as unknown as Pick<GameItem, "quality" | "details" | "inventoryType">;
function Objective({ q, size = 30 }: { q: Quest; size?: number }) {
  const it = q.objective.item;
  return it
    ? <span className="qu-obj"><ItemIcon item={asItem(it)} size={size} /><span className={`q${it.quality}`}>{it.qty > 1 ? `${it.qty} × ` : ""}{it.name}</span></span>
    : <span className="qu-obj"><span className="qu-obj-none" aria-hidden="true"><TypeIcon type={q.type} size={16} /></span><span>{q.objective.text}</span></span>;
}

/** Ce que voit ce compte : sa ligne de preneur, et si c'est son tour d'agir. */
const mineOf = (q: Quest, me: string | undefined) => q.takers.find(x => x.userId === me) ?? null;
function markOf(q: Quest, me: string | undefined): "!" | "?" | "?!" | "ok" | "off" {
  if (q.state === "cancelled" || q.state === "closed") return "off";
  if (q.state === "done") return "ok";
  const mine = mineOf(q, me);
  if (q.createdBy === me && q.takers.some(x => x.state === "turned_in")) return "?!";
  if (mine && ACTIVE.includes(mine.state)) return mine.state === "taken" ? "?" : "?!";
  return q.state === "open" ? "!" : "?";
}
const STATE_LABEL: Record<QuestState, string> = { open: N("Disponible"), running: N("En cours"), done: N("Terminée"), closed: N("Close"), cancelled: N("Annulée") };
const TAKER_LABEL: Record<TakerState, string> = {
  taken: N("Prise"), turned_in: N("Rendue · à valider"), validated: N("Validée · récompense à remettre"), paid: N("Récompense remise · à confirmer"),
  received: N("Récompense reçue"), abandoned: N("A rendu sa place"), removed: N("Retiré par un officier"), expired: N("Échéance passée"),
};

type Tab = "open" | "running" | "done";
const tabOf = (q: Quest): Tab => (q.state === "open" ? "open" : q.state === "running" ? "running" : "done");

export function QuestsTab({ groupId, guard }: { groupId: string; guard: Guard }) {
  const qc = useQueryClient();
  const me = useMe().data?.user?.id;
  const q = useQuery({ queryKey: ["quests", groupId], queryFn: () => get<QuestsData>(`/groups/${groupId}/quests`) });
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("open");
  const [type, setType] = useState<QuestType | "all">("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Quest | "new" | null>(null);
  const d = q.data;
  if (q.isLoading) return <p className="muted">{t("Chargement…")}</p>;
  if (!d) return <div className="alert error" role="alert">{t("Quêtes indisponibles pour l'instant.")}</div>;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["quests", groupId] }), qc.invalidateQueries({ queryKey: ["group", groupId] })]);
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("quete", id); else next.delete("quete");
    setParams(next, { replace: true });
  };
  const sel = d.quests.find(x => x.id === params.get("quete")) ?? null;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const wanted = norm(search.trim());
  const counts = { open: 0, running: 0, done: 0 } as Record<Tab, number>;
  for (const x of d.quests) counts[tabOf(x)]++;
  const list = d.quests.filter(x => tabOf(x) === tab && (type === "all" || x.type === type)
    && (!wanted || norm(`${x.title} ${x.creator} ${x.objective.item?.name ?? x.objective.text} ${x.description}`).includes(wanted)));
  const act = (fn: () => Promise<unknown>) => guard(async () => { await fn(); await refresh(); });

  return (
    <div className="stack qu" style={{ gap: 18 }}>
      <div className="qu-head">
        <Mark kind="!" size="lg" />
        <div className="qu-head-t">
          <h2 className="qu-h">{t("Tableau des quêtes")}</h2>
          <p className="hint" style={{ margin: 0 }}>{t("Des services entre membres. La récompense se remet en jeu ; le site note qui a remis quoi.")}</p>
        </div>
        {d.canCreate ? <button type="button" className="btn primary" onClick={() => setForm("new")}>{t("+ Nouvelle quête")}</button>
          : <p className="hint" style={{ margin: 0 }}>{t("Les officiers publient les quêtes ; tu peux les prendre ici ou sur Discord.")}</p>}
      </div>

      <div className="qu-filters">
        <div className="seg" role="group" aria-label={t("Statut")}>
          {([["open", t("Disponibles")], ["running", t("En cours")], ["done", t("Terminées")]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{l} <span className="qu-n">{counts[k]}</span></button>
          ))}
        </div>
        <div className="qu-chips" role="group" aria-label={t("Type")}>
          <button type="button" className={`qu-chip${type === "all" ? " on" : ""}`} aria-pressed={type === "all"} onClick={() => setType("all")}>{t("Tout")}</button>
          {TYPES.map(([k, l]) => <button key={k} type="button" className={`qu-chip${type === k ? " on" : ""}`} aria-pressed={type === k} onClick={() => setType(k)}><TypeIcon type={k} />{t(l)}</button>)}
        </div>
        <input type="search" className="qu-search" aria-label={t("Rechercher une quête")} placeholder={t("Cuir, Maraudon, un nom…")} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="qu-split">
        <section className="qu-grid" aria-label={t("Quêtes")}>
          {!list.length && <p className="hint qu-empty">{!d.quests.length
            ? tx("Aucune quête pour l'instant. Publie la première avec « + Nouvelle quête », ou sur Discord avec {cmd}.", { cmd: <code>/quete</code> })
            : t("Aucune quête ici.")}</p>}
          {list.map(x => <QuestCard key={x.id} q={x} me={me} onOpen={() => open(x.id)} onTake={() => act(() => post(`/groups/${groupId}/quests/${x.id}/take`))} />)}
        </section>
        <aside className="qu-side">
          <Journal d={d} me={me} onOpen={open} />
        </aside>
      </div>

      {sel && <QuestDialog groupId={groupId} q={sel} me={me} officer={d.officer} act={act} onClose={() => open(null)} onEdit={() => setForm(sel)} />}
      {form && <QuestForm groupId={groupId} edit={form === "new" ? null : form} discord={d.discord}
        onClose={() => setForm(null)} onSaved={async id => { setForm(null); await refresh(); open(id); }} />}
    </div>
  );
}

function QuestCard({ q, me, onOpen, onTake }: { q: Quest; me: string | undefined; onOpen: () => void; onTake: () => void }) {
  const mine = mineOf(q, me);
  const seats = q.places - q.free;
  const canTake = q.state === "open" && q.createdBy !== me && !(mine && (ACTIVE.includes(mine.state) || mine.state === "received" || mine.state === "removed"));
  const status = mine && ACTIVE.includes(mine.state) ? t(TAKER_LABEL[mine.state]) : q.state !== "open" ? t(STATE_LABEL[q.state]) : q.createdBy === me ? t("Ta quête") : "";
  return (
    <article className={`qu-card ${q.state}`}>
      <div className="qu-card-top">
        <Mark kind={markOf(q, me)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <button type="button" className="qu-title" onClick={onOpen}>{q.title}</button>
          <div className="qu-by">{q.creator} · <TypeIcon type={q.type} size={12} /> {t(typeOf(q.type)[1])}</div>
        </div>
      </div>
      {q.description && <p className="qu-desc">{q.description}</p>}
      <div className="qu-hair" />
      <Objective q={q} />
      <div className="qu-line"><span className="qu-lbl">{t("Récompense")}</span><Reward q={q} /></div>
      <div className="qu-foot">
        <div className="stack" style={{ gap: 5 }}>
          <span className="qu-meta">{[q.minLevel ? t("Niv. {n}+", { n: q.minLevel }) : "", q.profession, q.dueAt ? t("avant {day}", { day: shortDay(q.dueAt) }) : "",
            q.places === 1 ? t("1 place") : ""].filter(Boolean).join(" · ")}</span>
          {q.places > 1 && <span className="qu-seats" title={t("{n} places sur {total}", { n: seats, total: q.places })}>
            {Array.from({ length: Math.min(q.places, 10) }, (_, i) => <span key={i} className={i < seats ? "on" : ""} />)}
            <span className="qu-meta">{t("{n} / {total} places", { n: seats, total: q.places })}</span></span>}
        </div>
        {canTake ? <button type="button" className="btn sm qu-take" onClick={onTake}>{t("Prendre")}</button>
          : status ? <button type="button" className="qu-status" onClick={onOpen}>{status}</button> : null}
      </div>
    </article>
  );
}

/* ---------- Mon journal et fiabilité ---------- */

function Journal({ d, me, onOpen }: { d: QuestsData; me: string | undefined; onOpen: (id: string) => void }) {
  const mineGiven = d.quests.filter(q => q.createdBy === me && q.state !== "cancelled");
  const toValidate = mineGiven.flatMap(q => q.takers.filter(x => x.state === "turned_in").map(x => ({ q, x })));
  const toPay = mineGiven.flatMap(q => q.takers.filter(x => x.state === "validated" || (x.state === "paid" && x.disputed)).map(x => ({ q, x })));
  const taken = d.quests.filter(q => q.state !== "cancelled").flatMap(q => q.takers.filter(x => x.userId === me && ACTIVE.includes(x.state)).map(x => ({ q, x })));
  const rel = (me && d.reliability[me]) || { done: 0, given: 0, paid: 0, owed: 0 };
  const row = (key: string, mark: "?" | "?!", q: Quest, sub: ReactNode) => (
    <button key={key} type="button" className="qu-jrow" onClick={() => onOpen(q.id)}>
      <Mark kind={mark} size="sm" /><span style={{ minWidth: 0 }}><span className="qu-jt">{q.title}</span><span className="qu-meta">{sub}</span></span>
    </button>
  );
  const empty = !toValidate.length && !toPay.length && !taken.length;
  return (
    <>
      <section className="qu-panel gold">
        <h3 className="qu-h3">{t("Mon journal")}</h3>
        <div className="qu-hair" />
        {empty && <p className="hint" style={{ margin: 0 }}>{t("Rien en cours. Prends une quête au tableau, ou publies-en une.")}</p>}
        {!!toValidate.length && <><p className="qu-lbl">{t("À valider")}</p>{toValidate.map(({ q, x }) => row(x.id, "?!", q, t("{name} dit l'avoir faite", { name: x.name })))}</>}
        {!!taken.length && <><p className="qu-lbl">{t("Prises")}</p>{taken.map(({ q, x }) => row(x.id, x.state === "taken" ? "?" : "?!", q, t("Pour {name} · {state}", { name: q.creator, state: t(TAKER_LABEL[x.state]) })))}</>}
        {!!toPay.length && <><p className="qu-lbl">{t("Récompense à remettre")}</p>{toPay.map(({ q, x }) => row(x.id, "?!", q,
          <>{x.disputed ? t("{name} dit ne pas l'avoir reçue", { name: x.name }) : t("à {name}", { name: x.name })} · {q.reward.label}</>))}</>}
      </section>
      <section className="qu-panel">
        <h3 className="qu-h4">{t("Ta fiabilité")}</h3>
        <div className="qu-rel">
          <div><b>{rel.done}</b><span>{t("faites")}</span></div>
          <div><b>{rel.given}</b><span>{t("données")}</span></div>
          <div><b className={!rel.owed ? "" : rel.paid < rel.owed ? "warn" : "ok"}>{rel.owed ? `${rel.paid}/${rel.owed}` : "—"}</b><span>{t("payées")}</span></div>
        </div>
        <p className="hint" style={{ margin: 0 }}>{t("Visible par la guilde sur la fiche de chaque joueur. « Payées » : récompenses confirmées par leurs preneurs, 48 h après la validation.")}</p>
      </section>
    </>
  );
}

/** Fiabilité d'un joueur sur sa fiche de la guilde (quêtes faites, données, récompenses payées). */
export function QuestReliability({ groupId, userId }: { groupId: string; userId: string }) {
  const q = useQuery({ queryKey: ["quests", groupId], queryFn: () => get<QuestsData>(`/groups/${groupId}/quests`), staleTime: 60_000 });
  const r = q.data?.reliability[userId];
  if (!r || (!r.done && !r.given)) return null;
  return <span className="qu-meta">{t("Quêtes : {done} faites · {given} données", { done: r.done, given: r.given })}{r.owed ? ` · ${t("payées {paid}/{owed}", { paid: r.paid, owed: r.owed })}` : ""}</span>;
}

/* ---------- Une quête (fiche sur parchemin) ---------- */

function QuestDialog({ groupId, q, me, officer, act, onClose, onEdit }: {
  groupId: string; q: Quest; me: string | undefined; officer: boolean; act: (fn: () => Promise<unknown>) => Promise<void>; onClose: () => void; onEdit: () => void;
}) {
  const base = `/groups/${groupId}/quests/${q.id}`;
  const mine = mineOf(q, me);
  const giver = q.createdBy === me;
  const [note, setNote] = useState("");
  const [reject, setReject] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [ask, setAsk] = useState<"cancel" | "close" | null>(null);
  const live = q.state === "open" || q.state === "running";
  const canTake = q.state === "open" && !giver && !(mine && (ACTIVE.includes(mine.state) || mine.state === "received" || mine.state === "removed"));
  const seated = q.takers.filter(x => x.state !== "abandoned" && x.state !== "removed" && x.state !== "expired");

  const takerActions = (x: Taker) => {
    if (giver) {
      if (x.state === "taken") return <><button type="button" className="btn sm primary" onClick={() => act(() => post(`${base}/takers/${x.id}/validate`))}>{t("Valider")}</button>
        <button type="button" className="btn sm ghost" onClick={() => act(() => del(`${base}/takers/${x.id}`))}>{t("Retirer")}</button></>;
      if (x.state === "turned_in") return <><button type="button" className="btn sm primary" onClick={() => act(() => post(`${base}/takers/${x.id}/validate`))}>{t("Valider")}</button>
        <button type="button" className="btn sm" onClick={() => { setReject(x.id); setRejectNote(""); }}>{t("Pas encore")}</button></>;
      if (x.state === "validated" || (x.state === "paid" && x.disputed)) return <button type="button" className="btn sm primary" onClick={() => act(() => post(`${base}/takers/${x.id}/paid`))}>{x.disputed ? t("C'est remis (à nouveau)") : t("C'est remis")}</button>;
      return null;
    }
    if (officer && ["taken", "turned_in", "validated"].includes(x.state)) return <button type="button" className="btn sm ghost" onClick={() => act(() => del(`${base}/takers/${x.id}`))}>{t("Retirer")}</button>;
    return null;
  };

  return (
    <Modal label="qu-d-t" onClose={onClose} className="qu-dlg">
      <div className="qu-dlg-body">
        <div className="qu-frame">
          <article className="qu-parch">
            <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "nowrap" }}>
              <Mark kind={markOf(q, me)} size="lg" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 id="qu-d-t" className="qu-ptitle">{q.title}</h2>
                <p className="qu-pmeta">{tx("Donnée par {name}", { name: <b>{q.creator}</b> })} · {t(typeOf(q.type)[1])}
                  {q.minLevel ? ` · ${t("Niv. {n}+", { n: q.minLevel })}` : ""}{q.profession ? ` · ${q.profession}` : ""}
                  {q.dueAt ? ` · ${t("avant {day}", { day: dayTime(q.dueAt) })}` : ""}</p>
              </div>
              <button type="button" className="pi-close qu-x" aria-label={t("Fermer")} onClick={onClose}>✕</button>
            </div>
            {q.description && <section><h3 className="qu-ph">{t("Description")}</h3><p className="qu-ptext">{q.description}</p></section>}
            <section><h3 className="qu-ph">{t("Objectif")}</h3><Objective q={q} size={40} /></section>
            <section><h3 className="qu-ph">{t("Récompense")}</h3>
              <p className="qu-ptext small">{giver ? t("Ce que tu remets en jeu à chaque preneur validé :") : tx("Tu recevras de {name}, en jeu :", { name: q.creator })}</p>
              <div className="qu-preward"><Reward q={q} /></div></section>
            <p className="qu-pfoot">{t(STATE_LABEL[q.state])} · {tn(q.places, "{n} place", "{n} places")}{q.places > 1 ? ` · ${t("{n} prises", { n: q.places - q.free })}` : ""}</p>
          </article>
        </div>

        <aside className="stack qu-dside">
          <section className="qu-panel gold">
            {canTake && <>
              <h3 className="qu-h3">{t("Cette quête t'intéresse ?")}</h3>
              <p className="hint" style={{ margin: 0 }}>{t("En la prenant, tu préviens {name} que tu t'en occupes. Tu la rends ici (ou sur Discord) quand c'est fait.", { name: q.creator })}</p>
              <button type="button" className="btn primary" onClick={() => act(() => post(`${base}/take`))}>{t("Prendre la quête")}</button>
            </>}
            {mine?.state === "taken" && <form className="stack" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); void act(() => post(`${base}/turn-in`, { note })); }}>
              <h3 className="qu-h3">{t("Tu as pris cette quête")}</h3>
              {mine.rejectNote && <p className="alert warn" style={{ margin: 0 }}>{t("{name} : « {note} »", { name: q.creator, note: mine.rejectNote })}</p>}
              <label className="fld"><span>{t("Un mot pour {name} · facultatif", { name: q.creator })}</span>
                <input type="text" value={note} maxLength={QUEST_LIMITS.note} onChange={e => setNote(e.target.value)} placeholder={t("Je te les envoie par courrier.")} /></label>
              <div className="row"><button type="submit" className="btn primary">{t("Je l'ai faite")}</button>
                <button type="button" className="btn ghost" onClick={() => act(() => post(`${base}/abandon`))}>{t("Rendre ma place")}</button></div>
            </form>}
            {mine?.state === "turned_in" && <>
              <h3 className="qu-h3">{t("Tu as rendu la quête")}</h3>
              <p className="hint" style={{ margin: 0 }}>{t("{name} doit maintenant la valider. Pense à lui envoyer ce qu'il faut en jeu, par courrier ou par échange.", { name: q.creator })}</p>
              <button type="button" className="btn ghost" onClick={() => act(() => post(`${base}/undo-turn-in`))}>{t("Annuler mon rendu")}</button>
            </>}
            {(mine?.state === "validated" || mine?.state === "paid") && <>
              <h3 className="qu-h3">{mine.state === "paid" ? t("{name} dit t'avoir remis la récompense", { name: q.creator }) : t("Quête validée")}</h3>
              <p className="hint" style={{ margin: 0 }}>{mine.state === "paid" ? (mine.disputed ? t("Tu as dit ne pas l'avoir reçue : {name} est prévenu.", { name: q.creator }) : t("Tu l'as bien reçue en jeu ?"))
                : t("{name} va te remettre {reward} en jeu. Confirme quand tu l'as.", { name: q.creator, reward: q.reward.label })}</p>
              <div className="row"><button type="button" className="btn primary" onClick={() => act(() => post(`${base}/received`, { ok: true }))}>{t("Reçu")}</button>
                {mine.state === "paid" && !mine.disputed && <button type="button" className="btn" onClick={() => act(() => post(`${base}/received`, { ok: false }))}>{t("Pas reçu")}</button>}</div>
            </>}
            {mine?.state === "received" && <><h3 className="qu-h3">{t("Quête terminée")}</h3><p className="hint" style={{ margin: 0 }}>{t("Récompense reçue. Merci pour la guilde !")}</p></>}
            {giver && <>
              <h3 className="qu-h3">{t("Ta quête")}</h3>
              {!seated.length && <p className="hint" style={{ margin: 0 }}>{live ? t("Personne ne l'a encore prise.") : t("Personne ne l'a faite.")}</p>}
            </>}
            {!canTake && !mine && !giver && <p className="hint" style={{ margin: 0 }}>{q.state === "running" ? t("Toutes les places sont prises.") : t(STATE_LABEL[q.state])}</p>}

            {!!seated.length && (giver || officer || mine) && <div className="stack" style={{ gap: 8 }}>
              <p className="qu-lbl">{tn(seated.length, "{n} preneur", "{n} preneurs")}</p>
              {seated.map(x => (
                <div key={x.id} className="qu-taker">
                  <div style={{ minWidth: 0 }}><b>{x.name}</b><span className={`qu-tstate ${x.state}`}>{t(TAKER_LABEL[x.state])}{x.disputed ? ` · ${t("pas reçue")}` : ""}</span>
                    {x.note && <span className="qu-meta">« {x.note} »</span>}</div>
                  <div className="row" style={{ gap: 6 }}>{takerActions(x)}</div>
                  {reject === x.id && <form className="row qu-reject" onSubmit={e => { e.preventDefault(); void act(() => post(`${base}/takers/${x.id}/reject`, { note: rejectNote })).then(() => setReject(null)); }}>
                    <input type="text" value={rejectNote} maxLength={QUEST_LIMITS.note} aria-label={t("Un mot pour {name}", { name: x.name })} placeholder={t("Il en manque 5.")} onChange={e => setRejectNote(e.target.value)} />
                    <button type="submit" className="btn sm">{t("Envoyer")}</button></form>}
                </div>
              ))}
            </div>}

            {(giver || officer) && live && <div className="row qu-owner">
              {giver && <button type="button" className="btn sm" onClick={onEdit}>{t("Modifier")}</button>}
              {q.state === "open" && <button type="button" className="btn sm" onClick={() => setAsk("close")}>{t("Clore")}</button>}
              <button type="button" className="btn sm danger" onClick={() => setAsk("cancel")}>{t("Annuler la quête")}</button>
            </div>}
            {ask && <div className="alert warn qu-ask" role="alertdialog" aria-label={t("Confirmer")}>
              <p style={{ margin: 0 }}>{ask === "cancel" ? t("Annuler la quête ? Ses preneurs sont prévenus.") : t("Clore la quête ? Plus personne ne pourra la prendre ; ceux qui l'ont prise vont au bout.")}</p>
              <div className="row"><button type="button" className="btn sm primary" onClick={() => { setAsk(null); void act(() => (ask === "cancel" ? del(base) : post(`${base}/close`))); }}>{ask === "cancel" ? t("Annuler la quête") : t("Clore")}</button>
                <button type="button" className="btn sm ghost" onClick={() => setAsk(null)}>{t("Retour")}</button></div>
            </div>}
          </section>

          {mine && <Steps x={mine} giver={q.creator} />}
        </aside>
      </div>
    </Modal>
  );
}

/** Suivi d'un preneur : Prise → Rendue → Validée → Remise → Reçue. */
function Steps({ x, giver }: { x: Taker; giver: string }) {
  const order: TakerState[] = ["taken", "turned_in", "validated", "paid", "received"];
  const at = order.indexOf(x.state);
  const steps: [string, string | null][] = [
    [t("Prise"), x.takenAt], [t("Rendue"), x.turnedInAt], [t("Validée par {name}", { name: giver }), x.validatedAt], [t("Récompense remise"), x.paidAt], [t("Reçue"), x.receivedAt],
  ];
  if (at < 0) return null;
  return (
    <section className="qu-panel">
      <h3 className="qu-h4">{t("Suivi")}</h3>
      <ol className="qu-steps">
        {steps.map(([label, when], i) => <li key={i} className={i <= at ? "done" : i === at + 1 ? "now" : ""}><b>{label}</b>{when && i <= at && <span className="qu-meta">{dayTime(when)}</span>}</li>)}
      </ol>
    </section>
  );
}

/* ---------- Publier, modifier ---------- */

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => { const z = zonedParts(d); return `${z.year}-${pad(z.month)}-${pad(z.day)}`; };
const plusDays = (day: string, n: number) => { const [y, m, dd] = day.split("-").map(Number) as [number, number, number]; const x = new Date(Date.UTC(y, m - 1, dd + n)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
const isoAt = (day: string, time: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return isoOf({ y, m, d, h, mi });
};
type Due = "none" | "tonight" | "3d" | "7d" | "date";

function ItemSearch({ label, onPick }: { label: string; onPick: (it: { id: number; name: string; quality: number; details?: { icon?: string } }) => void }) {
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  useEffect(() => { const timer = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(timer); }, [q]);
  const hits = useQuery({ queryKey: ["any-item-search", debounced], enabled: debounced.length >= 2,
    queryFn: () => get<{ items: { id: number; name: string; quality: number; details?: { icon?: string } }[] }>(`/gamedata/items?kind=any&limit=10&q=${encodeURIComponent(debounced)}`) });
  return (
    <div className="qu-isearch">
      <input type="search" aria-label={label} placeholder={t("Nom de l'objet (en anglais), ex. Thick Leather")} value={q} onChange={e => setQ(e.target.value)} />
      {debounced.length >= 2 && hits.data && (hits.data.items.length
        ? <ul className="qu-hits">{hits.data.items.map(it => <li key={it.id}><button type="button" className={`q${it.quality}`} onClick={() => { onPick(it); setQ(""); }}>
          <ItemIcon item={{ quality: it.quality, details: it.details ?? {}, inventoryType: 0 } as unknown as GameItem} size={22} />[{it.name}]</button></li>)}</ul>
        : <p className="hint" style={{ margin: 0 }}>{t("Aucun objet trouvé.")}</p>)}
    </div>
  );
}

interface PickedItem { id: number; name: string; quality: number; icon: string | null }

function QuestForm({ groupId, edit, discord, onClose, onSaved }: {
  groupId: string; edit: Quest | null; discord: QuestsData["discord"]; onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const engaged = !!edit?.takers.some(x => x.state !== "abandoned" && x.state !== "removed");
  const today = dayOf(new Date());
  const [type, setType] = useState<QuestType>(edit?.type ?? "collect");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [objItem, setObjItem] = useState<PickedItem | null>(edit?.objective.item ?? null);
  const [objQty, setObjQty] = useState(edit?.objective.item?.qty ?? 1);
  const [objText, setObjText] = useState(edit?.objective.text ?? "");
  const c = edit?.reward.copper ?? 0;
  const [gold, setGold] = useState(Math.floor(c / 10000)), [silver, setSilver] = useState(Math.floor((c % 10000) / 100)), [copper, setCopper] = useState(c % 100);
  const [items, setItems] = useState<(PickedItem & { qty: number })[]>(edit?.reward.items ?? []);
  const [addItem, setAddItem] = useState(false);
  const [rewardText, setRewardText] = useState(edit?.reward.text ?? "");
  const [places, setPlaces] = useState(edit?.places ?? 1);
  const [minLevel, setMinLevel] = useState<number | null>(edit?.minLevel ?? null);
  const [profession, setProfession] = useState(edit?.profession ?? "");
  const [due, setDue] = useState<Due>(edit?.dueAt ? "date" : "none");
  const [dueDay, setDueDay] = useState(edit?.dueAt ? dayOf(new Date(edit.dueAt)) : plusDays(today, 3));
  const [dueTime, setDueTime] = useState(edit?.dueAt ? (() => { const z = zonedParts(new Date(edit.dueAt!)); return `${pad(z.hour)}:${pad(z.minute)}`; })() : "21:00");
  const [toDiscord, setToDiscord] = useState(!!discord);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const dueIso = () => {
    if (due === "none") return null;
    if (due === "tonight") return isoAt(today, "23:59");
    if (due === "3d") return isoAt(plusDays(today, 3), "23:59");
    if (due === "7d") return isoAt(plusDays(today, 7), "23:59");
    return isoAt(dueDay, dueTime);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSending(true);
    try {
      const body = {
        type, title, description, objectiveItemId: objItem?.id ?? null, objectiveQty: objItem ? objQty : null, objectiveText: objItem ? "" : objText,
        rewardCopper: gold * 10000 + silver * 100 + copper, rewardItems: items.map(i => ({ itemId: i.id, qty: i.qty })), rewardText,
        places, minLevel, profession, dueAt: dueIso(),
      };
      const r = edit ? await put<{ quest: { id: string } }>(`/groups/${groupId}/quests/${edit.id}`, body)
        : await post<{ quest: { id: string } }>(`/groups/${groupId}/quests`, { ...body, discord: toDiscord });
      await onSaved(r.quest.id);
    } catch (x) { setErr(errorOf(x)); } finally { setSending(false); }
  };
  const step = (n: number, title: string, children: ReactNode) => (
    <div className="qu-step"><span className="qu-num" aria-hidden="true">{n}</span><fieldset disabled={engaged && n !== 4 && n !== 1} className="qu-fs"><legend className="qu-h3">{title}</legend>{children}</fieldset></div>
  );

  return (
    <Modal label="qu-f-t" onClose={onClose} className="qu-fdlg">
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        <DialogHead id="qu-f-t" title={<span className="row" style={{ gap: 10 }}><Mark kind="!" />{edit ? t("Modifier la quête") : t("Nouvelle quête")}</span>} onClose={onClose}
          sub={engaged ? t("Quelqu'un l'a déjà prise : seuls la description, les places et l'échéance changent.") : undefined} />
        {step(1, t("La quête"), <>
          <div className="fld"><label htmlFor="qu-title">{t("Titre")}</label>
            <input type="text" id="qu-title" value={title} maxLength={QUEST_LIMITS.title} required disabled={engaged} onChange={e => setTitle(e.target.value)} placeholder={t("Du cuir pour mes sacoches")} /></div>
          <div className="qu-chips" role="group" aria-label={t("Type")}>
            {TYPES.map(([k, l]) => <button key={k} type="button" disabled={engaged} className={`qu-chip${type === k ? " on" : ""}`} aria-pressed={type === k} onClick={() => setType(k)}><TypeIcon type={k} />{t(l)}</button>)}
          </div>
          <div className="fld"><label htmlFor="qu-desc">{t("Description · facultative")}</label>
            <textarea id="qu-desc" rows={2} value={description} maxLength={QUEST_LIMITS.description} onChange={e => setDescription(e.target.value)} /></div>
        </>)}
        {step(2, t("Objectif"), <>
          {objItem
            ? <div className="row qu-picked"><ItemIcon item={asItem({ ...objItem, qty: 1 })} size={30} /><span className={`q${objItem.quality}`} style={{ flex: 1 }}>{objItem.name}</span>
              <NumberField value={objQty} min={1} max={QUEST_LIMITS.objectiveQty} onChange={setObjQty} label={t("Quantité")} />
              <button type="button" className="btn sm ghost" onClick={() => setObjItem(null)}>{t("Changer")}</button></div>
            : <>
              <ItemSearch label={t("Objet à rapporter")} onPick={it => setObjItem({ id: it.id, name: it.name, quality: it.quality, icon: it.details?.icon ?? null })} />
              <div className="fld"><label htmlFor="qu-objt">{t("… ou une phrase")}</label>
                <input type="text" id="qu-objt" value={objText} maxLength={QUEST_LIMITS.objective} onChange={e => setObjText(e.target.value)} placeholder={t("Vaincre Mor'Ladim")} /></div>
            </>}
          <p className="hint" style={{ margin: 0 }}>{objItem ? t("Objet du jeu : le preneur le rapporte, tu valides quand tu l'as reçu.") : t("En texte libre, c'est toi qui valides quand c'est fait.")}</p>
        </>)}
        {step(3, t("Récompense"), <>
          <div className="row qu-coins-in">
            <label className="row qu-coinf"><NumberField value={gold} min={0} max={99999} onChange={setGold} label={t("Pièces d'or")} stepper={false} className="qu-coin-in" /><span className="qu-coin g" aria-hidden="true" /></label>
            <label className="row qu-coinf"><NumberField value={silver} min={0} max={99} onChange={setSilver} label={t("Pièces d'argent")} stepper={false} className="qu-coin-in" /><span className="qu-coin s" aria-hidden="true" /></label>
            <label className="row qu-coinf"><NumberField value={copper} min={0} max={99} onChange={setCopper} label={t("Pièces de cuivre")} stepper={false} className="qu-coin-in" /><span className="qu-coin c" aria-hidden="true" /></label>
            {items.length < QUEST_LIMITS.rewardItems && !addItem && <button type="button" className="btn sm ghost qu-dash" onClick={() => setAddItem(true)}>{t("+ Un objet")}</button>}
          </div>
          {items.map((i, n) => <div key={i.id} className="row qu-picked"><ItemIcon item={asItem({ ...i, qty: 1 })} size={26} /><span className={`q${i.quality}`} style={{ flex: 1 }}>{i.name}</span>
            <NumberField value={i.qty} min={1} max={QUEST_LIMITS.rewardItemQty} onChange={v => setItems(l => l.map((x, j) => (j === n ? { ...x, qty: v } : x)))} label={t("Quantité")} />
            <button type="button" className="btn sm ghost" aria-label={t("Retirer {name}", { name: i.name })} onClick={() => setItems(l => l.filter((_, j) => j !== n))}>✕</button></div>)}
          {addItem && <ItemSearch label={t("Objet offert")} onPick={it => { setItems(l => (l.some(x => x.id === it.id) ? l : [...l, { id: it.id, name: it.name, quality: it.quality, icon: it.details?.icon ?? null, qty: 1 }])); setAddItem(false); }} />}
          <div className="fld"><label htmlFor="qu-rt">{t("Autre chose · facultatif")}</label>
            <input type="text" id="qu-rt" value={rewardText} maxLength={QUEST_LIMITS.rewardText} onChange={e => setRewardText(e.target.value)} placeholder={t("Ex. : un enchantement d'arme offert")} /></div>
          <p className="hint" style={{ margin: 0 }}>{t("Au moins une récompense. Le site ne la garde pas : tu la remets toi-même en jeu, une fois la quête validée.")}</p>
        </>)}
        {step(4, t("Qui et quand"), <>
          <div className="qu-two">
            <div className="stack" style={{ gap: 6 }}><b className="pl-lb">{t("Places")}</b>
              <div className="row" style={{ gap: 6 }}>
                <NumberField value={places} min={1} max={QUEST_LIMITS.places} onChange={setPlaces} label={t("Places")} />
                {[5, 10, 20, 40].map(n => <button key={n} type="button" className={`qu-chip sm${places === n ? " on" : ""}`} aria-pressed={places === n} onClick={() => setPlaces(n)}>{n}</button>)}
              </div>
              <span className="hint">{places === 1 ? t("De 1 à 40. Avec 1 place, le premier qui la prend la garde.") : t("{n} joueurs peuvent la prendre ; chacun est validé et reçoit la récompense.", { n: places })}</span>
            </div>
            <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
              <div className="fld"><label htmlFor="qu-lvl">{t("Niveau mini")}</label>
                <input type="text" id="qu-lvl" inputMode="numeric" disabled={engaged} value={minLevel ?? ""} style={{ width: 80 }} onChange={e => { const v = parseInt(e.target.value, 10); setMinLevel(Number.isFinite(v) ? Math.max(1, Math.min(60, v)) : null); }} /></div>
              <div className="fld" style={{ flex: 1 }}><label htmlFor="qu-prof">{t("Métier")}</label>
                <select id="qu-prof" disabled={engaged} value={profession} onChange={e => setProfession(e.target.value)}><option value="">{t("Aucun")}</option>
                  {Object.keys(PRIMARY_PROFESSIONS).map(n => <option key={n}>{n}</option>)}<option>Cooking</option><option>First Aid</option><option>Fishing</option><option>Lockpicking</option></select></div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}><b className="pl-lb">{t("Échéance")}</b>
            <div className="seg" role="group" aria-label={t("Échéance")}>
              {([["none", t("Aucune")], ["tonight", t("Ce soir")], ["3d", t("3 jours")], ["7d", t("7 jours")], ["date", t("Le")]] as [Due, string][]).map(([k, l]) =>
                <button key={k} type="button" className={due === k ? "on" : ""} aria-pressed={due === k} onClick={() => setDue(k)}>{l}</button>)}
            </div>
            {due === "date" && <><DateField value={dueDay} min={today} onChange={setDueDay} /><TimeSelect value={dueTime} onChange={setDueTime} /></>}
          </div>
        </>)}
        {!edit && step(5, t("Annonce"), discord
          ? <label className="pl-chk"><input type="checkbox" checked={toDiscord} onChange={e => setToDiscord(e.target.checked)} />{tx("Annoncer sur Discord, dans {channel}", { channel: <b>#{discord.channel ?? (discord.quests ? t("salon des quêtes") : t("salon de la guilde"))}</b> })}</label>
          : <p className="hint" style={{ margin: 0 }}>{t("Aucun salon Discord lié à la guilde : la quête reste sur le site.")}</p>)}
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={sending}>{edit ? t("Enregistrer") : t("Publier la quête")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Carte « Quêtes » de l'accueil de la guilde : ce qui t'attend, puis les 3 dernières quêtes que tu peux prendre. */
export function QuestsHomeCard({ groupId, base }: { groupId: string; base: string }) {
  const me = useMe().data?.user?.id;
  const q = useQuery({ queryKey: ["quests", groupId], queryFn: () => get<QuestsData>(`/groups/${groupId}/quests`), staleTime: 30_000 });
  const d = q.data;
  if (!d) return null;
  const todo = d.quests.filter(x => x.state !== "cancelled" && ((x.createdBy === me && x.takers.some(y => y.state === "turned_in" || y.state === "validated" || (y.state === "paid" && y.disputed)))
    || x.takers.some(y => y.userId === me && y.state === "paid" && !y.disputed)));
  const avail = d.quests.filter(x => x.state === "open" && x.createdBy !== me && !x.takers.some(y => y.userId === me && ACTIVE.includes(y.state)));
  if (!todo.length && !avail.length) return null;
  const link = (id: string) => `${base}/membres/quetes?quete=${id}`;
  return (
    <section className="hm-card qu-home" aria-labelledby="hm-qu">
      <div className="hm-h"><h3 id="hm-qu">{t("Quêtes")}</h3><Link className="link" to={`${base}/membres/quetes`}>{t("Tableau des quêtes →")}</Link></div>
      <ul className="qu-hl">
        {todo.slice(0, 3).map(x => <li key={x.id} className="todo"><Mark kind="?!" size="sm" /><Link to={link(x.id)}>{x.title}</Link><span className="qu-meta">{t("à toi de jouer")}</span></li>)}
        {avail.slice(0, 3).map(x => <li key={x.id}><Mark kind="!" size="sm" /><Link to={link(x.id)}>{x.title}</Link><span className="qu-meta">{x.creator}</span><span className="qu-reward sm"><Coins copper={x.reward.copper} /></span></li>)}
      </ul>
      {avail.length > 3 && <p className="hint" style={{ margin: 0 }}>{tn(avail.length - 3, "+ {n} autre disponible", "+ {n} autres disponibles")}</p>}
    </section>
  );
}
