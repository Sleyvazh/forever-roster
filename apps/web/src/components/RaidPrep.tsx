import { classColor,
  bossKey, CLASSES, concerns, CONSUMABLE_TARGET_LABEL, CONSUMABLE_TARGETS, type BossSheet, type ClassName, type ConsumableLine, type ConsumableTarget, type RaidPrep, type Role,
} from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ApiError, get, put } from "../api";
import { syncAge } from "../addonImport";

/**
 * Onglet « Préparation » de la page du raid (lot G) : consommables demandés et qui est prêt, puis fiches de boss
 * (attributions). Repris du dernier raid du même nom ; l'addon les reçoit avec la synchro. Classes CSS « pr- ».
 * Aussi : choix du conseil du butin (onglet Butin, raid en loot council).
 */

interface RosterRow {
  signupId: string; characterId: string | null; name: string; cls: string; spec: string; role: Role | null; status: string;
  counts: Record<string, number> | null; source: "call" | "noaddon" | "sync" | "nocount" | "never"; at: string | null;
}
export interface PrepData {
  prep: RaidPrep; canEdit: boolean;
  known: BossSheet[]; instances: { key: string; name: string }[];
  items: Record<string, { id: number; name: string; quality: number }>;
  characters: { id: string; name: string; cls: string }[]; roster: RosterRow[];
  call: { at: string; by: string } | null;
  council: string[] | null; members: { userId: string; name: string; officer: boolean }[];
}

const clsColor = (cls: string) => classColor(cls);
const hm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

export const usePrep = (groupId: string, raidId: string) =>
  useQuery({ queryKey: ["prep", raidId], queryFn: () => get<PrepData>(`/groups/${groupId}/raids/${raidId}/prep`) });

/** Ce qui part au serveur (les noms des objets sont recopiés côté serveur). */
const body = (p: RaidPrep) => ({
  instance: p.instance,
  consumables: p.consumables.map(c => ({ itemId: c.itemId, n: c.n, for: c.for })),
  bosses: p.bosses.map(b => ({ name: b.name, encounterId: b.encounterId, npcIds: b.npcIds, rows: b.rows })),
});

export function RaidPrepPanel({ groupId, raidId }: { groupId: string; raidId: string }) {
  const qc = useQueryClient();
  const q = usePrep(groupId, raidId);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: RaidPrep) => {
    setError(null);
    // Affichage immédiat, puis la version du serveur
    qc.setQueryData<PrepData>(["prep", raidId], d => (d ? { ...d, prep: next } : d));
    try { await put(`/groups/${groupId}/raids/${raidId}/prep`, body(next)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Enregistrement impossible."); }
    await qc.invalidateQueries({ queryKey: ["prep", raidId] });
  };
  if (!q.data) return null;
  const d = q.data;
  return (
    <div className="stack pr">
      {error && <div className="alert error" role="alert">{error}</div>}
      <Consumables d={d} save={save} />
      <Bosses d={d} save={save} />
    </div>
  );
}

/* ---------- Consommables ---------- */

function Consumables({ d, save }: { d: PrepData; save: (p: RaidPrep) => Promise<void> }) {
  const list = d.prep.consumables;
  const set = (consumables: ConsumableLine[]) => void save({ ...d.prep, consumables });
  const [adding, setAdding] = useState(false);
  return (
    <section className="stack" aria-labelledby="pr-cons">
      <div className="row between"><h3 id="pr-cons" style={{ margin: 0 }}>Consommables</h3>
        {d.canEdit && !adding && <button type="button" className="btn sm" onClick={() => setAdding(true)}>+ Consommable</button>}</div>
      {adding && <ItemSearch onPick={it => { setAdding(false); if (!list.some(c => c.itemId === it.id)) set([...list, { itemId: it.id, name: it.name, n: 1, for: "all" }]); }} onCancel={() => setAdding(false)} />}
      {list.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>{d.canEdit ? "Aucun consommable demandé. Ajoute flacons, potions ou nourriture : l'addon les compte dans les sacs de chacun." : "Aucun consommable demandé pour ce raid."}</p>
      ) : d.canEdit ? (
        <div className="pr-cons">
          {list.map((c, i) => (
            <div key={`${c.itemId}:${c.n}`} className="pr-crow">
              <span className={`q${d.items[c.itemId]?.quality ?? 1} pr-item`}>[{d.items[c.itemId]?.name ?? c.name}]</span>
              <input type="number" min={1} max={200} aria-label={`Quantité : ${c.name}`} defaultValue={c.n} className="num"
                onBlur={e => { const n = Math.min(200, Math.max(1, Number(e.target.value) || 1)); if (n !== c.n) set(list.map((x, j) => (j === i ? { ...x, n } : x))); }} />
              <select aria-label={`Pour qui : ${c.name}`} value={c.for} onChange={e => set(list.map((x, j) => (j === i ? { ...x, for: e.target.value as ConsumableTarget } : x)))}>
                {CONSUMABLE_TARGETS.map(t => <option key={t} value={t}>{CONSUMABLE_TARGET_LABEL[t]}</option>)}
              </select>
              <button type="button" className="pr-x" aria-label={`Retirer ${c.name}`} onClick={() => set(list.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <ul className="pr-clist">{list.map(c => <li key={c.itemId}><b className={`q${d.items[c.itemId]?.quality ?? 1}`}>[{d.items[c.itemId]?.name ?? c.name}]</b> ×{c.n} <span className="muted">· {CONSUMABLE_TARGET_LABEL[c.for]}</span></li>)}</ul>
      )}
      {list.length > 0 && <Readiness d={d} />}
    </section>
  );
}

function ItemSearch({ onPick, onCancel }: { onPick: (it: { id: number; name: string }) => void; onCancel: () => void }) {
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const hits = useQuery({ queryKey: ["consumable-search", debounced], enabled: debounced.length >= 2,
    queryFn: () => get<{ items: { id: number; name: string; quality: number }[] }>(`/gamedata/items?kind=consumable&limit=12&q=${encodeURIComponent(debounced)}`) });
  return (
    <div className="pr-search">
      <div className="row"><input type="search" autoFocus aria-label="Chercher un consommable" placeholder="Flask of the Titans, Major Healing Potion…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="btn ghost sm" onClick={onCancel}>Annuler</button></div>
      {debounced.length >= 2 && hits.data && (hits.data.items.length
        ? <ul className="pr-hits">{hits.data.items.map(it => <li key={it.id}><button type="button" className={`q${it.quality}`} onClick={() => onPick(it)}>[{it.name}]</button></li>)}</ul>
        : <p className="hint" style={{ margin: 0 }}>Aucun consommable trouvé.</p>)}
    </div>
  );
}

/** Qui est prêt : une colonne par consommable demandé, la quantité de chacun (appel en raid, sinon synchro). */
function Readiness({ d }: { d: PrepData }) {
  const list = d.prep.consumables;
  const rows = d.roster.filter(r => r.status !== "bench").map(r => {
    const need = list.map(c => concerns(c, { role: r.role, cls: r.cls, spec: r.spec }) ? c.n : 0);
    const has = list.map(c => (r.counts ? r.counts[c.itemId] ?? 0 : null));
    const ready = r.counts ? need.every((n, i) => !n || (has[i] ?? 0) >= n) : null;
    return { r, need, has, ready };
  });
  const ok = rows.filter(x => x.ready === true).length, missing = rows.filter(x => x.ready === false).length, unknown = rows.filter(x => x.ready === null).length;
  const source = (r: RosterRow) => {
    if (r.source === "call") return { text: `appel ${r.at ? hm.format(new Date(r.at)) : ""}`, old: false };
    if (r.source === "noaddon") return { text: "appel : pas de réponse", old: true };
    if (r.source === "sync") { const a = syncAge(r.at); return { text: a.text, old: Date.now() - new Date(r.at!).getTime() > 24 * 3600e3 }; }
    if (r.source === "nocount") return { text: "addon trop ancien ou synchro avant la liste", old: true };
    return { text: "jamais synchronisé", old: true };
  };
  return (
    <div className="stack pr-ready" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <b>Qui est prêt</b>
        <span className="tag ok">Prêts {ok}/{rows.length}</span>
        {missing > 0 && <span className="tag warn">Incomplets {missing}</span>}
        {unknown > 0 && <span className="tag bad">Pas comptés {unknown}</span>}
        <span className="muted small" style={{ marginLeft: "auto" }}>{d.call ? `Dernier appel en raid : ${day.format(new Date(d.call.at))} ${hm.format(new Date(d.call.at))} (${d.call.by})` : "Pas encore d'appel en raid : quantités de la dernière synchro."}</span>
      </div>
      {rows.length === 0 ? <p className="hint" style={{ margin: 0 }}>Personne d'inscrit pour l'instant.</p> : (
        <div className="tscroll"><table className="data pr-table">
          <thead><tr><th>Joueur</th>{list.map(c => <th key={c.itemId} className="c" title={c.name}>{short(c.name)} ×{c.n}</th>)}<th>Compté</th></tr></thead>
          <tbody>{rows.map(({ r, need, has }) => {
            const s = source(r);
            return (
              <tr key={r.signupId}>
                <td><span style={{ color: clsColor(r.cls), fontWeight: 600 }}>{r.name}</span>{r.status === "tentative" && <span className="muted small"> · peut-être</span>}</td>
                {r.counts ? list.map((c, i) => <td key={c.itemId} className={`c num ${!need[i] ? "pr-na" : (has[i] ?? 0) >= need[i]! ? "pr-ok" : has[i] ? "pr-low" : "pr-no"}`}>{need[i] ? has[i] : "—"}</td>)
                  : <td colSpan={list.length} className="muted small">{r.source === "noaddon" ? "pas d'addon (pas de réponse à l'appel)" : "pas encore compté"}</td>}
                <td className={`small ${s.old ? "warnmsg" : "muted"}`}>{s.text}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <p className="hint" style={{ margin: 0 }}>À la synchro, l'addon compte ces objets dans les sacs (et la banque si elle a été ouverte). En raid, le chef lance « Appel aux consommables » (onglet En raid de l'addon) : son résultat arrive avec sa synchro. On informe seulement.</p>
    </div>
  );
}
/** « Greater Fire Protection Potion » → « Greater Fire Protection… » pour l'en-tête du tableau. */
const short = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name);

/* ---------- Fiches de boss ---------- */

function Bosses({ d, save }: { d: PrepData; save: (p: RaidPrep) => Promise<void> }) {
  // Boss de l'instance (dans l'ordre), remplacés par les fiches remplies, puis les boss ajoutés à la main
  const list = useMemo(() => {
    const stored = new Map(d.prep.bosses.map(b => [bossKey(b.name), b]));
    const known = d.known.map(k => stored.get(bossKey(k.name)) ?? k);
    const knownKeys = new Set(d.known.map(k => bossKey(k.name)));
    return [...known, ...d.prep.bosses.filter(b => !knownKeys.has(bossKey(b.name)))];
  }, [d]);
  const visible = d.canEdit ? list : list.filter(b => b.rows.length);
  const [sel, setSel] = useState<string | null>(null);
  const cur = visible.find(b => bossKey(b.name) === sel) ?? visible.find(b => b.rows.length) ?? visible[0] ?? null;
  const [newBoss, setNewBoss] = useState("");

  const setSheet = (sheet: BossSheet) => {
    // Remplace la fiche (ou l'ajoute), dans l'ordre de la liste ; le serveur écarte les fiches vides des boss connus
    const k = bossKey(sheet.name);
    const order = new Map(list.map((b, i) => [bossKey(b.name), i]));
    const bosses = [...d.prep.bosses.filter(b => bossKey(b.name) !== k), sheet]
      .sort((a, b) => (order.get(bossKey(a.name)) ?? 999) - (order.get(bossKey(b.name)) ?? 999));
    void save({ ...d.prep, bosses });
  };
  const roster = new Set(d.roster.flatMap(r => (r.characterId ? [r.characterId] : [])));

  return (
    <section className="stack" aria-labelledby="pr-boss">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 id="pr-boss" style={{ margin: 0 }}>Fiches de boss</h3>
        {d.canEdit && (
          <label className="row small muted" style={{ gap: 6 }}>Boss de
            <select aria-label="Instance" value={d.prep.instance ?? ""} onChange={e => void save({ ...d.prep, instance: e.target.value || null })}>
              <option value="">Autre raid (boss à ajouter)</option>
              {d.instances.map(i => <option key={i.key} value={i.key}>{i.name}</option>)}
            </select></label>
        )}
      </div>
      <p className="hint" style={{ margin: 0 }}>Une fiche par boss, avec des lignes libres : des persos ou une consigne. En jeu, chacun voit sa tâche en ciblant le boss avant le pull ; le chef peut l'annoncer en /raid.</p>
      {visible.length === 0 ? <p className="hint" style={{ margin: 0 }}>{d.canEdit ? "Choisis l'instance ou ajoute un boss." : "Aucune fiche pour ce raid."}</p> : (
        <div className="pr-bosses">
          <div className="pr-blist" role="tablist" aria-label="Boss">
            {visible.map(b => (
              <button key={b.name} type="button" role="tab" aria-selected={cur?.name === b.name} className={`pr-b${b.rows.length ? "" : " empty"}`} onClick={() => setSel(bossKey(b.name))}>
                <span>{b.name}</span><small>{b.rows.length ? `${b.rows.length} ligne${b.rows.length > 1 ? "s" : ""}` : "vide"}</small>
              </button>
            ))}
          </div>
          {cur && <Sheet key={cur.name} sheet={cur} d={d} roster={roster} onChange={d.canEdit ? setSheet : null}
            onDrop={d.canEdit && !d.known.some(k => bossKey(k.name) === bossKey(cur.name)) ? () => void save({ ...d.prep, bosses: d.prep.bosses.filter(b => bossKey(b.name) !== bossKey(cur.name)) }) : null} />}
        </div>
      )}
      {d.canEdit && (
        <form className="row pr-newboss" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); const n = newBoss.trim(); if (!n) return; setNewBoss(""); setSel(bossKey(n));
          if (!list.some(b => bossKey(b.name) === bossKey(n))) setSheet({ name: n, encounterId: null, npcIds: [], rows: [] }); }}>
          <input type="text" maxLength={60} aria-label="Nouveau boss" placeholder="Boss d'un nouveau raid…" value={newBoss} onChange={e => setNewBoss(e.target.value)} />
          <button type="submit" className="btn ghost sm" disabled={!newBoss.trim()}>+ Boss</button>
        </form>
      )}
    </section>
  );
}

function Sheet({ sheet, d, roster, onChange, onDrop }: { sheet: BossSheet; d: PrepData; roster: Set<string>; onChange: ((s: BossSheet) => void) | null; onDrop: (() => void) | null }) {
  const charOf = new Map(d.characters.map(c => [c.id, c]));
  const setRows = (rows: BossSheet["rows"]) => onChange?.({ ...sheet, rows });
  const rows = sheet.rows;
  const first = rows.find(r => r.characterIds.length);
  const firstName = first ? charOf.get(first.characterIds[0]!)?.name : null;
  // Persos proposés : inscrits d'abord, puis le reste du groupe
  const options = [...d.characters].sort((a, b) => Number(roster.has(b.id)) - Number(roster.has(a.id)) || a.name.localeCompare(b.name));
  return (
    <div className="pr-sheet">
      <div className="pr-sh"><h4>{sheet.name}</h4>
        {onChange && <div className="row" style={{ gap: 6 }}>
          {rows.length > 0 && <button type="button" className="btn ghost sm" onClick={() => setRows([])}>Vider</button>}
          {onDrop && <button type="button" className="btn ghost sm" onClick={onDrop}>Retirer ce boss</button>}
        </div>}
      </div>
      {rows.length === 0 && !onChange && <p className="hint">Fiche vide.</p>}
      {rows.map((row, i) => (
        <div key={`${i}:${row.label}:${row.text}:${row.characterIds.join()}`} className="pr-arow">
          {onChange ? <input type="text" maxLength={40} aria-label="Intitulé" placeholder="Tank principal, Décurse…" defaultValue={row.label}
            onBlur={e => { if (e.target.value.trim() !== row.label) setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value.trim() } : r))); }} />
            : <b className="pr-lab">{row.label || "—"}</b>}
          <div className="pr-who">
            {row.characterIds.map(id => {
              const c = charOf.get(id);
              return (
                <span key={id} className="pr-pc" style={{ borderLeftColor: clsColor(c?.cls ?? "") }} title={roster.has(id) ? undefined : "Pas inscrit à ce raid"}>
                  {c?.name ?? "?"}{!roster.has(id) && <span className="warnmsg"> ⚠</span>}
                  {onChange && <button type="button" aria-label={`Retirer ${c?.name ?? ""}`} onClick={() => setRows(rows.map((r, j) => (j === i ? { ...r, characterIds: r.characterIds.filter(x => x !== id) } : r)))}>✕</button>}
                </span>
              );
            })}
            {onChange && row.characterIds.length < 10 && (
              <select aria-label={`Ajouter un perso : ${row.label || "ligne"}`} value="" onChange={e => { const id = e.target.value; if (id) setRows(rows.map((r, j) => (j === i ? { ...r, characterIds: [...r.characterIds, id] } : r))); }}>
                <option value="">+ perso</option>
                {options.filter(c => !row.characterIds.includes(c.id)).map(c => <option key={c.id} value={c.id}>{c.name}{roster.has(c.id) ? "" : " (pas inscrit)"}</option>)}
              </select>
            )}
            {onChange ? <input type="text" maxLength={120} className="pr-text" aria-label="Consigne" placeholder="ou une consigne" defaultValue={row.text}
              onBlur={e => { if (e.target.value.trim() !== row.text) setRows(rows.map((r, j) => (j === i ? { ...r, text: e.target.value.trim() } : r))); }} />
              : row.text && <span className="pr-pc txt">{row.text}</span>}
          </div>
          {onChange && <button type="button" className="pr-x" aria-label="Retirer la ligne" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}
        </div>
      ))}
      {onChange && rows.length < 12 && <div><button type="button" className="btn sm" onClick={() => setRows([...rows, { label: "", characterIds: [], text: "" }])}>+ Ligne</button></div>}
      {firstName && <p className="pr-prev">En jeu, <b>{firstName}</b> verra en ciblant {sheet.name} : « {first!.label || "ta tâche"} », et le reste de la fiche en dessous.</p>}
    </div>
  );
}

/* ---------- Conseil du butin (onglet Butin) ---------- */

type CouncilData = Pick<PrepData, "council" | "members" | "canEdit">;

/** Conseil choisi pour le raid (null : les officiers du groupe). Seul, sans le reste de la préparation (Roster : lot R3b). */
export function CouncilPicker({ groupId, raidId, retail = false }: { groupId: string; raidId: string; retail?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["council", raidId], queryFn: () => get<CouncilData>(`/groups/${groupId}/raids/${raidId}/council`) });
  const [error, setError] = useState<string | null>(null);
  if (!q.data) return null;
  const d = q.data;
  const chosen = new Set(d.council ?? d.members.filter(m => m.officer).map(m => m.userId));
  const save = (userIds: string[] | null) => void put(`/groups/${groupId}/raids/${raidId}/council`, { userIds })
    .then(() => Promise.all([qc.invalidateQueries({ queryKey: ["council", raidId] }), qc.invalidateQueries({ queryKey: ["prep", raidId] })]))
    .catch(e => setError(e instanceof ApiError ? e.message : "Enregistrement impossible."));
  if (!d.canEdit) {
    return <p style={{ margin: 0 }}>Conseil du butin : <b>{d.members.filter(m => chosen.has(m.userId)).map(m => m.name).join(", ") || "—"}</b></p>;
  }
  return (
    <section className="stack" aria-labelledby="pr-council" style={{ gap: 8 }}>
      <div className="row between"><h3 id="pr-council" style={{ margin: 0 }}>Conseil du butin</h3>
        {d.council && <button type="button" className="btn ghost sm" onClick={() => save(null)}>Revenir aux officiers</button>}</div>
      <p className="hint" style={{ margin: 0 }}>{d.council ? "Choisi pour ce raid (repris au prochain raid du même nom)." : "Par défaut : les officiers du groupe."} {retail
        ? "L'addon Roster le reçoit avec « Copier pour le jeu » : en jeu, réponses et votes ne vont qu'à ses membres et au chef de butin."
        : "En jeu, réponses et votes ne sont envoyés qu'à eux et au maître du butin."}</p>
      <div className="pr-council">
        {d.members.map(m => (
          <label key={m.userId} className="pr-cm">
            <input type="checkbox" checked={chosen.has(m.userId)} onChange={() => { const next = new Set(chosen); if (next.has(m.userId)) next.delete(m.userId); else next.add(m.userId); save([...next]); }} />
            {m.name}{m.officer && <span className="muted small"> · officier</span>}
          </label>
        ))}
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
    </section>
  );
}
