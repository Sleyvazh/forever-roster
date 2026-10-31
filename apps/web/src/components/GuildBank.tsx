import {
  bankItemVerb, bankMoneyText, bankSlotPos, BANK_COLS, BANK_ROWS, BANK_SLOTS, moneyParts, nameKey,
  type BankItem, type GuildBankMove, type GuildBankMoneyMove, type GuildBankResponse, type GuildBankTab,
} from "@forever/game-data";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { agoText, fetchBankLog, guildKeys, shortDay, useGuildBank } from "../guild";
import { NotLinked } from "./GuildMembers";
import { ItemHover, ItemIcon } from "./ItemTooltip";

/**
 * Guilde › Banque (lot « Banque », /groups/:id/membres/banque) : la banque de la guilde du jeu telle que l'addon l'a relevée
 * à sa dernière ouverture, visible par tous les membres, sans rien modifier. En-tête (qui a relevé, onglets plus anciens ou
 * jamais relevés, or), recherche dans tous les onglets, puces d'onglets (« Tout » + un onglet), puis la grille 14 × 7 de
 * l'onglet sur ordinateur (cases rangées comme la fenêtre du jeu, infobulle de l'objet) ou une liste (téléphone, « Tout »,
 * recherche), et le journal (objets, or) à droite ou dessous.
 * Données : GET /api/groups/:id/guild/bank et /bank/log (types et textes des journaux dans packages/game-data/src/bank.ts).
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
  return { text: m.amount === null ? "montant inconnu" : `${sign > 0 ? "+" : "−"}${moneyText(m.amount)}`, cls: m.amount === null ? "" : sign > 0 ? "in" : "out" };
}

/** Un objet dans un onglet (cases du même objet additionnées). */
interface Row { key: string; id: number; n: number; tab: number; item?: BankItem; name: string }

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
  return <Bank groupId={groupId} bank={data.bank} objects={data.objects} lastMoney={data.lastMoney} />;
}

type TabSel = "all" | number;

function Bank({ groupId, bank, objects, lastMoney }: { groupId: string; bank: NonNullable<GuildBankResponse["bank"]>; objects: Record<number, BankItem>; lastMoney: GuildBankMoneyMove[] }) {
  const phone = usePhone();
  const { tabs } = bank;
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

  const pick = (k: TabSel) => { setSel(k); if (k !== "all") setQuery(""); };
  const stale = tabs.filter(t => t.at !== null && Date.parse(bank.at) - Date.parse(t.at) > 3600e3);
  const never = tabs.filter(t => t.at === null);

  let body: ReactNode;
  if (searching || cur === "all") {
    body = <>
      {found.length ? <ItemList rows={found} tabName={tabName} /> : <p className="muted" style={{ margin: 0 }}>{searching ? "Aucun objet ne correspond." : "Aucun objet relevé pour l'instant."}</p>}
      {searching && !!found.length && <SearchFoot rows={found} />}
    </>;
  } else {
    const t = tabOf(cur)!;
    body = t.at === null
      ? <div className="so-empty"><p>Personne n'a encore relevé cet onglet : il faut qu'un membre dont le rang le voit ouvre la banque avec l'addon.</p></div>
      : phone
        ? (t.slots.length ? <ItemList rows={tabRows(t, objects)} /> : <p className="muted" style={{ margin: 0 }}>Cet onglet est vide.</p>)
        : <SlotGrid tab={t} objects={objects} />;
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
          <button type="button" className={searching || cur === "all" ? "on" : ""} aria-pressed={searching || cur === "all"} onClick={() => pick("all")}>Tout <small>{tabs.reduce((s, t) => s + t.slots.length, 0)}</small></button>
          {tabs.map(t => {
            const on = !searching && cur === t.tab;
            return <button key={t.tab} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => pick(t.tab)}>{tabLabel(t)} <small>{t.slots.length}</small></button>;
          })}
        </div>
      </div>
      <div className="bk-main">
        <div className="bk-body">{body}</div>
        <Journal groupId={groupId} tabs={tabs} objects={objects} lastMoney={lastMoney} />
      </div>
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
function ItemList({ rows, tabName }: { rows: Row[]; tabName?: (n: number) => string }) {
  return (
    <ul className="bk-list" aria-label="Objets">
      {rows.map(r => (
        <li key={r.key}>
          <ItemHover item={r.item}>
            <span className="bk-it">
              <ItemIcon item={r.item} size={32} />
              <span className={`bk-n${r.item ? ` q${r.item.quality}` : ""}`}>{r.name}{tabName && <small>{tabName(r.tab)}</small>}</span>
            </span>
          </ItemHover>
          <span className="bk-q num">× {r.n}</span>
        </li>
      ))}
    </ul>
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
function SlotGrid({ tab, objects }: { tab: GuildBankTab; objects: Record<number, BankItem> }) {
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
        return (
          <span key={slot} className="bk-slot" style={at}>
            {item
              ? <ItemHover item={item} className="bk-hv" label={label}>{inner}</ItemHover>
              : <span className="bk-hv" tabIndex={0} role="group" aria-label={label}>{inner}</span>}
          </span>
        );
      })}
    </div>
  );
}

/* ---------- Journal ---------- */

function Journal({ groupId, tabs, objects, lastMoney }: { groupId: string; tabs: GuildBankTab[]; objects: Record<number, BankItem>; lastMoney: GuildBankMoneyMove[] }) {
  const [kind, setKind] = useState<"items" | "money">("items");
  // Une page peut dépasser 50 lignes (le serveur finit l'heure en cours) : la suivante commence à la date de la dernière ligne reçue
  const q = useInfiniteQuery({
    queryKey: guildKeys.bankLog(groupId, kind),
    queryFn: ({ pageParam }) => fetchBankLog(groupId, kind, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => (last.more ? (last.moves.at(-1) ?? last.money.at(-1))?.at : undefined),
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
        <span className="small muted">{kind === "items" ? "50 derniers mouvements par onglet" : "50 derniers mouvements"}</span>
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
          Or : {lastMoney.map((m, i) => {
            const s = signed(m), t = bankMoneyText(m.type);
            // « +50 po Kaeldra », « −12 po réparations de Gorrak »
            return <Fragment key={m.id}>{i > 0 && " · "}<b className={s.cls}>{s.text}</b> {m.type === "deposit" || m.type === "withdraw" ? m.who : `${t.verb} de ${m.who}`} ({agoText(m.at)})</Fragment>;
          })}
        </p>
      )}
    </section>
  );
}

const When = ({ at }: { at: string }) => <time dateTime={at} title={`${shortDay(at)}, à l'heure près (journal du jeu)`}>{agoText(at)}</time>;

/** « Pikou a déposé 20 × Major Healing Potion », en dessous l'onglet (« Équipement → Officiers » pour un déplacement). */
function ItemMove({ m, objects, tabName }: { m: GuildBankMove; objects: Record<number, BankItem>; tabName: (n: number | null) => string }) {
  const what = m.itemId ? itemName(m.itemId, objects[m.itemId]) : "un objet inconnu";
  const cls = m.type === "deposit" ? "in" : m.type === "withdraw" ? "out" : "";
  return (
    <li>
      <span><b>{m.who}</b> <span className={cls}>{bankItemVerb(m.type)}</span> {m.n ? `${m.n} × ` : ""}{what}</span>
      <When at={m.at} />
      <small>{m.type === "move" && m.tab1 && m.tab2 ? `${tabName(m.tab1)} → ${tabName(m.tab2)}` : tabName(m.tab)}</small>
    </li>
  );
}

/** « Vex réparations −12 po 30 pa » : le sens (entre ou sort) donne la couleur. */
function MoneyMove({ m }: { m: GuildBankMoneyMove }) {
  const s = signed(m);
  return (
    <li>
      <span><b>{m.who}</b> {bankMoneyText(m.type).verb} <span className={s.cls}>{s.text}</span></span>
      <When at={m.at} />
    </li>
  );
}
