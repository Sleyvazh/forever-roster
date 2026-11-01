import {
  bankItemVerb, bankMoneyText, bankRequestOpen, dePrefix, bankSlotPos, BANK_COLS, BANK_REQUEST_MAX_OPEN, BANK_REQUEST_NOTE_MAX, BANK_REQUEST_REASON_MAX, BANK_REQUEST_STATUS_LABEL, BANK_ROWS, BANK_SLOTS, moneyParts, nameKey,
  type BankItem, type BankRequest, type BankRequestAction, type BankRequests, type GuildBankMove, type GuildBankMoneyMove, type GuildBankResponse, type GuildBankTab,
} from "@forever/game-data";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ApiError, patch, post } from "../api";
import { agoText, fetchBankLog, guildKeys, shortDay, useGuildBank, type BankLogCursor } from "../guild";
import { DialogHead, Modal, NotLinked, refreshGuild } from "./GuildMembers";
import { ItemHover, ItemIcon } from "./ItemTooltip";
import { NumberField } from "./NumberField";

/**
 * Guilde › Banque (lot « Banque », /groups/:id/membres/banque) : la banque de la guilde du jeu telle que l'addon l'a relevée
 * à sa dernière ouverture, visible par tous les membres, sans rien modifier. En-tête (qui a relevé, onglets plus anciens ou
 * jamais relevés, or), recherche dans tous les onglets, puces d'onglets (« Tout » + un onglet), puis la grille 14 × 7 de
 * l'onglet sur ordinateur (cases rangées comme la fenêtre du jeu, infobulle de l'objet) ou une liste (téléphone, « Tout »,
 * recherche), et le journal (objets, or) à droite ou dessous.
 * Demandes de retrait (patch du 5/11, maquette « Prêts pour la sortie ») : un clic sur une case ouvre un petit menu (objet,
 * quantité en banque, « Demander »), un bouton « Demander » par ligne de la liste ; la fenêtre « Demander à la banque » (quantité,
 * un mot) ; l'encadré « Demandes en cours » au-dessus du journal, visible par toute la guilde, avec les gestes de chacun
 * (officiers, propriétaire, banquiers : Préparer, Remise, Refuser ; le demandeur : Annuler) et « Terminées » (les 20 dernières).
 * Données : GET /api/groups/:id/guild/bank et /bank/log (types et textes des journaux dans packages/game-data/src/bank.ts),
 * POST /guild/bank/requests et PATCH /guild/bank/requests/:id.
 */

/** Même seuil que la mise en page : au plus 720 px, la liste remplace la grille. */
const PHONE = "(max-width: 720px)";
function usePhone() {
  return useSyncExternalStore(
    cb => { const m = window.matchMedia(PHONE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}

const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n > 1 ? ws : w}`;
/** Nom d'un onglet : celui du jeu, sinon « Onglet 3 ». */
const tabLabel = (t: Pick<GuildBankTab, "tab" | "name">) => t.name || `Onglet ${t.tab}`;
const itemName = (id: number, item?: BankItem) => item?.name ?? `Objet n° ${id}`;
const fmt = new Intl.NumberFormat("fr-FR");
/** « 12 po 30 pa » : les pièces à zéro sont omises (« 0 pc » seulement pour un montant nul). */
function moneyText(copper: number) {
  const { g, s, c } = moneyParts(copper);
  return [g && `${fmt.format(g)} po`, s && `${s} pa`, c && `${c} pc`].filter(Boolean).join(" ") || "0 pc";
}
/** Montant signé d'une ligne du journal de l'or (le jeu ne le dit pas toujours) et sa classe : in (entre), out (sort). */
function signed(m: GuildBankMoneyMove) {
  const { sign } = bankMoneyText(m.type);
  return { text: m.amount === null ? "un montant inconnu" : `${sign > 0 ? "+" : "−"}${moneyText(m.amount)}`, cls: m.amount === null ? "" : sign > 0 ? "in" : "out" };
}

/** Un objet dans un onglet (cases du même objet additionnées). */
interface Row { key: string; id: number; n: number; tab: number; item?: BankItem; name: string }

/** Ce qu'il faut pour « Demander » : mes demandes ouvertes par objet, si j'en ai déjà 5, et l'ouverture de la fenêtre. */
interface AskCtx { mine: Map<number, BankRequest>; full: boolean; open: (itemId: number) => void }
const errorOf = (e: unknown, def = "Action impossible.") => (e instanceof ApiError ? e.message : def);

function tabRows(t: GuildBankTab, objects: Record<number, BankItem>): Row[] {
  const rows = new Map<number, Row>();
  for (const s of [...t.slots].sort((a, b) => a.slot - b.slot)) {
    const r = rows.get(s.id);
    if (r) r.n += s.n; else rows.set(s.id, { key: `${t.tab}-${s.id}`, id: s.id, n: s.n, tab: t.tab, item: objects[s.id], name: itemName(s.id, objects[s.id]) });
  }
  return [...rows.values()];
}

/* ---------- Page ---------- */

export function GuildBank({ groupId, officer, onAdmin }: { groupId: string; officer: boolean; onAdmin?: () => void }) {
  const q = useGuildBank(groupId);
  const data = q.data;
  if (!data) return <p className="muted">{q.error ? "Banque indisponible pour l'instant." : "Chargement…"}</p>;
  if (!data.linked) return <NotLinked groupId={groupId} officer={officer} onAdmin={onAdmin} />;
  if (!data.bank) {
    return (
      <div className="so-empty">
        <h3>Pas encore de banque</h3>
        <p>La banque arrive quand un membre qui a l'addon à jour ouvre la banque de guilde en jeu, puis fait sa synchro.</p>
      </div>
    );
  }
  return <Bank groupId={groupId} bank={data.bank} objects={data.objects} lastMoney={data.lastMoney} requests={data.requests} />;
}

type TabSel = "all" | number;

/** Case choisie dans la grille : son onglet, son numéro, son objet, et où poser le petit menu dans le corps de la banque. */
interface PickedSlot { tab: number; slot: number; itemId: number; left: number; top: number }
const POP_WIDTH = 262;

function Bank({ groupId, bank, objects, lastMoney, requests }: {
  groupId: string; bank: NonNullable<GuildBankResponse["bank"]>; objects: Record<number, BankItem>; lastMoney: GuildBankMoneyMove[]; requests: BankRequests;
}) {
  const phone = usePhone();
  const { tabs } = bank;
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<PickedSlot | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  // null : le premier onglet (choisi par défaut, et si l'onglet choisi n'existe plus)
  const [sel, setSel] = useState<TabSel | null>(null);
  const cur: TabSel = sel === "all" ? "all" : (tabs.find(t => t.tab === sel) ?? tabs[0])?.tab ?? "all";
  const wanted = nameKey(query);
  const searching = wanted !== "";
  const tabOf = (n: number) => tabs.find(t => t.tab === n);
  const tabName = (n: number) => { const t = tabOf(n); return t ? tabLabel(t) : `Onglet ${n}`; };

  // Un objet par onglet, tous onglets confondus, triés par nom
  const all = useMemo(() => tabs.flatMap(t => tabRows(t, objects)).sort((a, b) => a.name.localeCompare(b.name, "fr") || a.tab - b.tab), [tabs, objects]);
  const found = useMemo(() => (wanted ? all.filter(r => nameKey(r.name).includes(wanted)) : all), [all, wanted]);

  // Demandes : combien il y en a de chaque objet dans la banque (tous onglets), mes demandes ouvertes par objet
  const totals = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tabs) for (const s of t.slots) m.set(s.id, (m.get(s.id) ?? 0) + s.n);
    return m;
  }, [tabs]);
  const ask: AskCtx = useMemo(() => ({
    mine: new Map(requests.open.filter(r => r.who.me).map(r => [r.itemId, r])), full: requests.myOpen >= BANK_REQUEST_MAX_OPEN, open: id => { setPick(null); setAsking(id); },
  }), [requests]);
  // Le petit menu d'une case : il disparaît si la grille n'est plus là (recherche, « Tout », téléphone) ou si la page change de taille
  useEffect(() => {
    if (!pick) return;
    const close = () => setPick(null);
    window.addEventListener("resize", close);
    return () => window.removeEventListener("resize", close);
  }, [pick]);
  const onPick = (p: Omit<PickedSlot, "left" | "top">, el: HTMLElement) => {
    const body = bodyRef.current?.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!body) return;
    setPick(cur => (cur && cur.tab === p.tab && cur.slot === p.slot ? null : {
      ...p, left: Math.max(0, Math.min(Math.round(r.left - body.left + 8), body.width - POP_WIDTH)), top: Math.round(r.bottom - body.top + 8),
    }));
  };
  const closePop = (refocus: boolean) => {
    const el = refocus ? bodyRef.current?.querySelector<HTMLElement>(".bk-slot.sel .bk-hv") : null;
    setPick(null);
    if (el) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };

  const choose = (k: TabSel) => { setSel(k); setPick(null); if (k !== "all") setQuery(""); };
  const stale = tabs.filter(t => t.at !== null && Date.parse(bank.at) - Date.parse(t.at) > 3600e3);
  const never = tabs.filter(t => t.at === null);

  let body: ReactNode;
  if (searching || cur === "all") {
    body = <>
      {found.length ? <ItemList rows={found} tabName={tabName} ask={ask} /> : <p className="muted" style={{ margin: 0 }}>{searching ? "Aucun objet ne correspond." : "Aucun objet relevé pour l'instant."}</p>}
      {searching && !!found.length && <SearchFoot rows={found} />}
    </>;
  } else {
    const t = tabOf(cur)!;
    body = t.at === null
      ? <div className="so-empty"><p>Personne n'a encore relevé cet onglet : il faut qu'un membre dont le rang le voit ouvre la banque avec l'addon.</p></div>
      : phone
        ? (t.slots.length ? <ItemList rows={tabRows(t, objects)} ask={ask} /> : <p className="muted" style={{ margin: 0 }}>Cet onglet est vide.</p>)
        : <SlotGrid tab={t} objects={objects} onPick={onPick} picked={pick?.tab === t.tab ? pick.slot : null} />;
  }

  return (
    <div className="stack">
      <div className="bk-head">
        <span className="muted small">
          Relevée{bank.by && <> par <b>{bank.by}</b></>} {agoText(bank.at)}
          {stale.map(t => <Fragment key={t.tab}> · onglet {tabLabel(t)} {agoText(t.at!)}</Fragment>)}
          {never.map(t => <Fragment key={t.tab}> · onglet {tabLabel(t)} jamais relevé</Fragment>)}
          {!!tabs.length && <> · {plural(tabs.length, "onglet")}</>}
        </span>
        <Gold copper={bank.money} at={bank.moneyAt} />
      </div>
      <input type="search" placeholder="Chercher un objet dans tous les onglets…" aria-label="Chercher un objet dans la banque" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="bk-tabs">
        <div className="seg" role="group" aria-label="Onglets de la banque">
          <button type="button" className={searching || cur === "all" ? "on" : ""} aria-pressed={searching || cur === "all"} onClick={() => choose("all")}>Tout <small>{tabs.reduce((s, t) => s + t.slots.length, 0)}</small></button>
          {tabs.map(t => {
            const on = !searching && cur === t.tab;
            return <button key={t.tab} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => choose(t.tab)}>{tabLabel(t)} <small>{t.slots.length}</small></button>;
          })}
        </div>
      </div>
      <div className="bk-main">
        <div className="bk-body" ref={bodyRef}>
          {body}
          {pick && !searching && !phone && cur === pick.tab && (
            <AskPop at={pick} item={objects[pick.itemId]} id={pick.itemId} total={totals.get(pick.itemId) ?? 0} ask={ask} onClose={closePop} />
          )}
        </div>
        <div className="bk-side">
          <RequestsBox groupId={groupId} requests={requests} objects={objects} />
          <Journal groupId={groupId} tabs={tabs} objects={objects} lastMoney={lastMoney} />
        </div>
      </div>
      {asking !== null && <AskDialog groupId={groupId} id={asking} item={objects[asking]} total={totals.get(asking) ?? 0} onClose={() => setAsking(null)} />}
    </div>
  );
}

/** Or de la banque : po, pa, pc aux trois couleurs des pièces. */
function Gold({ copper, at }: { copper: number | null; at: string | null }) {
  const title = at ? `Or relevé ${agoText(at)}` : undefined;
  if (copper === null) return <span className="bk-gold none small muted" role="group" aria-label="Or de la banque" title={title}>or inconnu</span>;
  const { g, s, c } = moneyParts(copper);
  return (
    <span className="bk-gold" role="group" aria-label="Or de la banque" title={title}>
      <span className="bk-g">{fmt.format(g)}<i> po</i></span> <span className="bk-s">{s}<i> pa</i></span> <span className="bk-c">{c}<i> pc</i></span>
    </span>
  );
}

/* ---------- Liste et grille ---------- */

/** Une ligne par objet (et par onglet quand tabName est donné) : icône, nom à la couleur de qualité, quantité. */
function ItemList({ rows, tabName, ask }: { rows: Row[]; tabName?: (n: number) => string; ask: AskCtx }) {
  return (
    <ul className="bk-list" aria-label="Objets">
      {rows.map(r => (
        <li key={r.key} className="ask">
          <ItemHover item={r.item}>
            <span className="bk-it">
              <ItemIcon item={r.item} size={32} />
              <span className={`bk-n${r.item ? ` q${r.item.quality}` : ""}`}>{r.name}{tabName && <small>{tabName(r.tab)}</small>}</span>
            </span>
          </ItemHover>
          <span className="bk-q num">× {r.n}</span>
          <AskButton id={r.id} name={r.name} ask={ask} />
        </li>
      ))}
    </ul>
  );
}

/** « Demander » d'une ligne : grisé quand j'ai déjà une demande ouverte pour cet objet, ou 5 demandes ouvertes. */
function AskButton({ id, name, ask }: { id: number; name: string; ask: AskCtx }) {
  const have = ask.mine.get(id);
  if (have) return <button type="button" className="btn sm" disabled title="Tu as déjà une demande ouverte pour cet objet" aria-label={`Demande en cours pour ${name}`}>Demandé</button>;
  return (
    <button type="button" className="btn sm" disabled={ask.full} title={ask.full ? `${BANK_REQUEST_MAX_OPEN} demandes ouvertes au plus : attends qu'elles soient traitées` : undefined}
      aria-label={`Demander ${name}`} onClick={() => ask.open(id)}>Demander</button>
  );
}

/** Petit menu d'une case de la grille (bureau) : l'objet, ce qu'il y en a dans la banque, « Demander ». */
function AskPop({ at, item, id, total, ask, onClose }: { at: PickedSlot; item?: BankItem; id: number; total: number; ask: AskCtx; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const name = itemName(id, item);
  const have = ask.mine.get(id);
  // Le focus passe au menu (et l'infobulle de la case s'efface) ; Échap le ferme, un clic ailleurs aussi
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => { const t = e.target as Element; if (!ref.current?.contains(t) && !t.closest(".bk-slot")) close.current(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(true); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, []);
  return (
    <div className="bk-pop" ref={ref} role="dialog" aria-label={name} style={{ left: at.left, top: at.top }}>
      <div className="top">
        <ItemIcon item={item} size={36} />
        <span className="nm"><span className={item ? `q${item.quality}` : undefined}>{name}</span><small><b className="num">{fmt.format(total)}</b> dans la banque</small></span>
      </div>
      <button type="button" className="btn primary sm" disabled={!!have || ask.full} onClick={() => ask.open(id)}
        title={have ? "Tu as déjà une demande ouverte pour cet objet" : ask.full ? `${BANK_REQUEST_MAX_OPEN} demandes ouvertes au plus` : undefined}>
        {have ? "Demande en cours" : "Demander"}
      </button>
    </div>
  );
}

/** Bas de la recherche : nombre de lignes, total, et le premier objet trouvé dans plusieurs onglets. */
function SearchFoot({ rows }: { rows: Row[] }) {
  const total = rows.reduce((s, r) => s + r.n, 0);
  const first = rows.find(r => rows.some(o => o !== r && o.id === r.id));
  const same = first ? rows.filter(r => r.id === first.id) : [];
  return (
    <p className="hint" style={{ margin: 0 }}>
      {rows.length} objet{rows.length > 1 ? "s" : ""} trouvé{rows.length > 1 ? "s" : ""} · {fmt.format(total)} au total
      {first && ` (${first.name} : ${fmt.format(same.reduce((s, r) => s + r.n, 0))}, dans ${same.length} onglets)`}
    </p>
  );
}

/** La fenêtre du jeu : 14 colonnes de 7 cases, rangées par groupes de deux colonnes (bankSlotPos). */
function SlotGrid({ tab, objects, onPick, picked }: { tab: GuildBankTab; objects: Record<number, BankItem>; onPick: (p: { tab: number; slot: number; itemId: number }, el: HTMLElement) => void; picked: number | null }) {
  const bySlot = new Map(tab.slots.map(s => [s.slot, s]));
  return (
    <div className="bk-grid" role="group" aria-label={tab.name ? `Onglet ${tab.name}` : tabLabel(tab)}
      style={{ gridTemplateColumns: `repeat(${BANK_COLS}, var(--bk-cell))`, gridTemplateRows: `repeat(${BANK_ROWS}, var(--bk-cell))` }}>
      {Array.from({ length: BANK_SLOTS }, (_, i) => {
        const slot = i + 1, { col, row } = bankSlotPos(slot), s = bySlot.get(slot);
        const at = { gridColumn: col + 1, gridRow: row + 1 };
        if (!s) return <span key={slot} className="bk-slot" style={at} />;
        const item = objects[s.id], label = `${itemName(s.id, item)} × ${s.n}`;
        const inner = <><ItemIcon item={item} size={36} />{s.n > 1 && <b aria-hidden="true">{s.n}</b>}</>;
        const choose = (el: HTMLElement) => onPick({ tab: tab.tab, slot, itemId: s.id }, el);
        return (
          <span key={slot} className={`bk-slot${picked === slot ? " sel" : ""}`} style={at}>
            {item
              ? <ItemHover item={item} className="bk-hv" label={label} onActivate={choose}>{inner}</ItemHover>
              : <span className="bk-hv" tabIndex={0} role="button" aria-label={label} title={label} onClick={e => choose(e.currentTarget)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(e.currentTarget); } }}>{inner}</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- Demandes de retrait ---------- */

const requestUrl = (groupId: string, id?: string) => `/groups/${groupId}/guild/bank/requests${id ? `/${id}` : ""}`;

/** « Demandes en cours (3) » : visibles par toute la guilde, avec les gestes de chacun ; en dessous « Terminées » (les 20 dernières). */
function RequestsBox({ groupId, requests, objects }: { groupId: string; requests: BankRequests; objects: Record<number, BankItem> }) {
  const { open, done, canHandle } = requests;
  const [fold, setFold] = useState(false);
  return (
    <section className="hm-card rq-box" aria-labelledby="rq-t">
      <div className="hm-h">
        <h3 id="rq-t">Demandes en cours ({open.length})</h3>
        <span className="hint">visibles par toute la guilde</span>
      </div>
      {open.length
        ? <ul className="rq-list" aria-label="Demandes en cours">{open.map(r => <RequestRow key={r.id} groupId={groupId} r={r} item={objects[r.itemId]} canHandle={canHandle} />)}</ul>
        : <p className="hm-none">Aucune demande en cours. Pour en faire une, choisis un objet de la banque.</p>}
      {done.length > 0 && (
        <>
          <button type="button" className="gm-fold rq-fold" aria-expanded={fold} aria-controls="rq-done" onClick={() => setFold(f => !f)}>
            <span className="car" aria-hidden="true">{fold ? "▾" : "▸"}</span><b>Terminées ({done.length})</b>
          </button>
          {fold && <ul className="rq-list" id="rq-done" aria-label="Demandes terminées">{done.map(r => <RequestRow key={r.id} groupId={groupId} r={r} item={objects[r.itemId]} canHandle={false} />)}</ul>}
        </>
      )}
    </section>
  );
}

/**
 * Une demande : qui, combien de quoi, le mot du demandeur, l'étape et les gestes. Ceux qui traitent : Préparer (en attente),
 * Remise (en attente ou préparée), Refuser (avec un motif facultatif) ; le demandeur : Annuler tant qu'elle n'est pas préparée.
 * Sa propre demande en attente n'a que « Annuler ». Les droits sont revérifiés par l'API à chaque geste.
 */
function RequestRow({ groupId, r, item, canHandle }: { groupId: string; r: BankRequest; item?: BankItem; canHandle: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const name = itemName(r.itemId, item);
  const isOpen = bankRequestOpen(r.status);
  // Sa propre demande en attente : seulement « Annuler » (un officier ou un banquier se sert lui-même, ou la fait traiter par un autre)
  const handle = canHandle && isOpen && !(r.who.me && r.status === "pending");
  const cancel = r.who.me && r.status === "pending";
  const run = async (action: BankRequestAction, why = "") => {
    setBusy(true); setErr(null);
    try { await patch(requestUrl(groupId, r.id), { action, reason: why }); await refreshGuild(qc, groupId); setRefusing(false); }
    catch (e) { setErr(errorOf(e)); void refreshGuild(qc, groupId); }
    finally { setBusy(false); }
  };
  const when = <time dateTime={r.at} title={shortDay(r.at)}>{agoText(r.at)}</time>;
  const by = r.handledBy ? <b>{r.handledBy}</b> : null;
  // L'heure en haut à droite d'une demande préparée (la ligne du bas est déjà pleine), sinon en bas
  const timeTop = r.status === "prepared";
  return (
    <li className={r.who.me ? "mine" : undefined}>
      <ItemIcon item={item} size={32} />
      <div className="rq-l1">
        <b>{r.who.name}</b>
        {r.who.me && <span className="tag gold">Toi</span>}
        <span className={`bk-n${item ? ` q${item.quality}` : ""}`}><span className="num">{fmt.format(r.quantity)} ×</span> {name}</span>
        {timeTop && when}
      </div>
      {r.note ? <p className="rq-n">« {r.note} »</p> : <span />}
      <div className="rq-l3">
        {r.status === "pending" && <span className="tag warn">{BANK_REQUEST_STATUS_LABEL.pending}</span>}
        {r.status === "prepared" && <>
          <span className="tag gold">{BANK_REQUEST_STATUS_LABEL.prepared}</span>
          {by && <span className="why">par {by} · à récupérer auprès {dePrefix(r.handledBy!)}{by}</span>}
        </>}
        {r.status === "done" && <><span className="tag ok">{BANK_REQUEST_STATUS_LABEL.done}</span>{by && <span className="why">par {by}</span>}</>}
        {r.status === "refused" && <><span className="tag bad">{BANK_REQUEST_STATUS_LABEL.refused}</span><span className="why">{by && <>par {by}</>}{r.reason && <>{by && " · "}{r.reason}</>}</span></>}
        {r.status === "cancelled" && <span className="tag">{BANK_REQUEST_STATUS_LABEL.cancelled}</span>}
        {!timeTop && <span className="why">· {agoText(isOpen ? r.at : r.updatedAt)}</span>}
        {(handle || cancel) && !refusing && (
          <span className="rq-btns">
            {handle && r.status === "pending" && <button type="button" className="btn sm primary" disabled={busy} aria-label={`Préparer ${name} pour ${r.who.name}`} onClick={() => void run("prepare")}>Préparer</button>}
            {handle && <button type="button" className={`btn sm${r.status === "prepared" ? " primary" : ""}`} disabled={busy} aria-label={`Marquer ${name} remis à ${r.who.name}`} onClick={() => void run("done")}>Remise</button>}
            {handle && <button type="button" className="btn sm danger" disabled={busy} aria-label={`Refuser ${name} à ${r.who.name}`} onClick={() => setRefusing(true)}>Refuser</button>}
            {cancel && <button type="button" className="btn sm ghost" disabled={busy} aria-label={`Annuler ma demande de ${name}`} onClick={() => void run("cancel")}>Annuler</button>}
          </span>
        )}
      </div>
      {refusing && (
        <form className="rq-refuse" onSubmit={e => { e.preventDefault(); void run("refuse", reason.trim()); }}>
          <input type="text" value={reason} maxLength={BANK_REQUEST_REASON_MAX} placeholder="Motif (facultatif)" aria-label={`Motif du refus (facultatif) pour ${r.who.name}`} autoFocus onChange={e => setReason(e.target.value)} />
          <button type="submit" className="btn sm danger" disabled={busy}>Refuser la demande</button>
          <button type="button" className="btn sm ghost" disabled={busy} onClick={() => { setRefusing(false); setReason(""); }}>Retour</button>
        </form>
      )}
      {err && <div className="alert error rq-err" role="alert">{err}</div>}
    </li>
  );
}

/** « Demander à la banque » : combien (de 1 au total en banque, tous onglets) et un mot facultatif. */
function AskDialog({ groupId, id, item, total, onClose }: { groupId: string; id: number; item?: BankItem; total: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [n, setN] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = itemName(id, item);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (total < 1) return;
    setBusy(true); setErr(null);
    try { await post(requestUrl(groupId), { itemId: id, quantity: n, note: note.trim() }); await refreshGuild(qc, groupId); onClose(); }
    catch (x) { setErr(errorOf(x)); void refreshGuild(qc, groupId); setBusy(false); }
  };
  return (
    <Modal label="rq-dt" onClose={onClose}>
      <form className="rq-form" onSubmit={e => void submit(e)}>
        <DialogHead id="rq-dt" title="Demander à la banque" onClose={onClose}
          sub={<><ItemIcon item={item} size={30} /><span><b className={item ? `q${item.quality}` : undefined}>{name}</b> · {fmt.format(total)} dans la banque</span></>} />
        <div className="fld">
          <label htmlFor="rq-n">Quantité</label>
          <div className="rq-q">
            <NumberField id="rq-n" value={Math.min(n, Math.max(total, 1))} min={1} max={Math.max(total, 1)} onChange={setN} label="Quantité" />
            <span className="hint">de 1 à {fmt.format(total)} (tous les onglets)</span>
          </div>
        </div>
        <div className="fld">
          <label htmlFor="rq-m">Un mot (facultatif)</label>
          <input id="rq-m" type="text" maxLength={BANK_REQUEST_NOTE_MAX} value={note} placeholder="À quoi ça sert, qui doit récupérer…" onChange={e => setNote(e.target.value)} />
          <span className="hint">{BANK_REQUEST_NOTE_MAX} caractères au plus</span>
        </div>
        <p className="gm-note"><i>i</i><span>Un officier ou un banquier prépare ta demande. Le bot te prévient en message privé quand elle est prête.</span></p>
        <p className="hint" style={{ margin: 0 }}>{BANK_REQUEST_MAX_OPEN} demandes ouvertes au plus, une seule par objet.</p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || total < 1}>Envoyer la demande</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Journal ---------- */

function Journal({ groupId, tabs, objects, lastMoney }: { groupId: string; tabs: GuildBankTab[]; objects: Record<number, BankItem>; lastMoney: GuildBankMoneyMove[] }) {
  const [kind, setKind] = useState<"items" | "money">("items");
  // Pages de 50 lignes : la suivante commence après la dernière ligne reçue (sa date et son identifiant)
  const q = useInfiniteQuery({
    queryKey: guildKeys.bankLog(groupId, kind),
    queryFn: ({ pageParam }) => fetchBankLog(groupId, kind, pageParam),
    initialPageParam: undefined as BankLogCursor | undefined,
    getNextPageParam: (last): BankLogCursor | undefined => {
      const row = last.more ? (last.moves.at(-1) ?? last.money.at(-1)) : undefined;
      return row && { before: row.at, beforeId: row.id };
    },
  });
  const pages = q.data?.pages ?? [];
  const moves = pages.flatMap(p => p.moves), money = pages.flatMap(p => p.money);
  const known = useMemo(() => Object.assign({}, objects, ...pages.map(p => p.objects)) as Record<number, BankItem>, [objects, pages]);
  const tabName = (n: number | null) => { const t = tabs.find(x => x.tab === n); return t ? tabLabel(t) : `Onglet ${n ?? "?"}`; };
  const empty = kind === "items" ? !moves.length : !money.length;
  return (
    <section className="bk-journal stack" aria-labelledby="bk-j-t">
      <h4 className="gm-sec" id="bk-j-t">Journal</h4>
      <div className="row between">
        <div className="seg" role="group" aria-label="Journal de la banque">
          <button type="button" className={kind === "items" ? "on" : ""} aria-pressed={kind === "items"} onClick={() => setKind("items")}>Objets</button>
          <button type="button" className={kind === "money" ? "on" : ""} aria-pressed={kind === "money"} onClick={() => setKind("money")}>Or</button>
        </div>
        <span className="small muted">{kind === "items" ? "le jeu en montre 50 par onglet" : "le jeu en montre 50"}</span>
      </div>
      {!q.data ? <p className="muted" style={{ margin: 0 }}>{q.error ? "Journal indisponible pour l'instant." : "Chargement…"}</p>
        : empty ? <p className="muted" style={{ margin: 0 }}>Aucun mouvement relevé pour l'instant.</p>
        : (
          <ul className="bk-log">
            {kind === "items"
              ? moves.map(m => <ItemMove key={m.id} m={m} objects={known} tabName={tabName} />)
              : money.map(m => <MoneyMove key={m.id} m={m} />)}
          </ul>
        )}
      {q.hasNextPage && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Plus ancien</button>}
      {kind === "items" && !!lastMoney.length && (
        <p className="bk-last small muted">
          Or : {lastMoney.map((m, i) => <Fragment key={m.id}>{i > 0 && " · "}<MoneyText m={m} /> ({agoText(m.at)})</Fragment>)}
        </p>
      )}
    </section>
  );
}

const When = ({ at }: { at: string }) => <time dateTime={at} title={`${shortDay(at)}, à l'heure près (journal du jeu)`}>{agoText(at)}</time>;

/** « Pikou a déposé 20 × Major Healing Potion », en dessous l'onglet (« Équipement → Officiers » pour un déplacement). */
function ItemMove({ m, objects, tabName }: { m: GuildBankMove; objects: Record<number, BankItem>; tabName: (n: number | null) => string }) {
  // « 5 × objet inconnu » avec une quantité, « un objet inconnu » sans
  const what = m.itemId ? itemName(m.itemId, objects[m.itemId]) : m.n ? "objet inconnu" : "un objet inconnu";
  const cls = m.type === "deposit" ? "in" : m.type === "withdraw" ? "out" : "";
  return (
    <li>
      <span><b>{m.who}</b> <span className={cls}>{bankItemVerb(m.type)}</span> {m.n ? `${m.n} × ` : ""}{what}</span>
      <When at={m.at} />
      <small>{m.type === "move" && m.tab1 && m.tab2 ? `${tabName(m.tab1)} → ${tabName(m.tab2)}` : tabName(m.tab)}</small>
    </li>
  );
}

/** « **Vex** a payé des réparations −12 po 30 pa » : le sens (l'or entre ou sort) donne la couleur du montant. */
function MoneyText({ m }: { m: GuildBankMoneyMove }) {
  const s = signed(m);
  return <><b>{m.who}</b> {bankMoneyText(m.type).verb} <span className={s.cls}>{s.text}</span></>;
}

function MoneyMove({ m }: { m: GuildBankMoneyMove }) {
  return (
    <li>
      <span><MoneyText m={m} /></span>
      <When at={m.at} />
    </li>
  );
}
