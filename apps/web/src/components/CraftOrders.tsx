import { SKILL_LINE_NAMES } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, del, get, patch, post, type Character } from "../api";
import { NumberField } from "./NumberField";

/**
 * Commandes d'artisanat (lot F), en haut de l'onglet Artisans : demander une fabrication, la prendre
 * (« Je m'en charge »), la marquer faite. Classes CSS « co- ».
 */

interface Crafter { characterId: string; name: string; owner: string; userId: string }
interface Reagent { itemId: number; name: string; n: number; provided: boolean }
interface Order {
  id: string; spellId: number; recipeName: string; item: { id: number; name: string; quality: number } | null; quantity: number; note: string; reagents: Reagent[];
  status: "open" | "taken" | "done"; createdAt: string; takenAt: string | null; doneAt: string | null;
  requester: { id: string; name: string }; character: string | null; taker: { id: string; name: string } | null;
  crafters: Crafter[]; canCraft: boolean; mine: boolean; canManage: boolean;
}
interface RecipeHit { spellId: number; name: string; skillLine: number; reqSkill: number; itemId: number | null; itemName: string | null; quality: number | null; reagents: { itemId: number; n: number; name: string }[]; crafters: Crafter[] }
export interface OrderPrefill { spellId: number; name: string; key: number }

const STATUS: Record<Order["status"], string> = { open: "Ouverte", taken: "Prise", done: "Faite" };
const names = (list: Crafter[], max = 3) => list.length ? list.slice(0, max).map(c => c.name).join(", ") + (list.length > max ? ` +${list.length - max}` : "") : "";

export function CraftOrders({ groupId, myId, prefill }: { groupId: string; myId?: string; prefill?: OrderPrefill | null }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["orders", groupId], queryFn: () => get<{ orders: Order[] }>(`/groups/${groupId}/orders`) });
  const [form, setForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (prefill) setForm(true); }, [prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => qc.invalidateQueries({ queryKey: ["orders", groupId] });
  const act = (o: Order, action: "take" | "release" | "done" | "reopen" | "reagents", provided?: number[]) => void patch(`/groups/${groupId}/orders/${o.id}`, { action, ...(provided && { provided }) })
    .then(refresh).catch(e => setError(e instanceof ApiError ? e.message : "Action impossible."));
  const remove = (o: Order) => void del(`/groups/${groupId}/orders/${o.id}`).then(refresh).catch(e => setError(e instanceof ApiError ? e.message : "Action impossible."));
  const orders = data?.orders ?? [];
  const open = orders.filter(o => o.status !== "done").length;

  return (
    <section className="stack co" aria-labelledby="co-title">
      <div className="co-head">
        <h3 id="co-title">Commandes <span className={`tag ${open ? "gold" : ""}`}>{open} en cours</span></h3>
        {!form && <button type="button" className="btn primary sm" onClick={() => setForm(true)}>+ Demander une fabrication</button>}
      </div>
      {form && <NewOrder key={prefill?.key ?? 0} groupId={groupId} prefill={prefill ?? null} onDone={() => { setForm(false); void refresh(); }} onCancel={() => setForm(false)} />}
      {error && <div className="alert error" role="alert">{error}</div>}
      {orders.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucune commande. Demande une fabrication : les artisans du groupe qui connaissent le patron la verront ici.</p> : (
        <div className="tscroll"><table className="data co-table">
          <thead><tr><th>Objet</th><th>Demandé par</th><th>Artisans</th><th>Statut</th><th /></tr></thead>
          <tbody>{orders.map(o => (
            <tr key={o.id} className={o.status === "done" ? "co-done" : undefined}>
              <td><span className={o.item ? `q${o.item.quality}` : ""} style={{ fontWeight: 600 }}>[{o.item?.name ?? o.recipeName}]</span>{o.quantity > 1 && <span className="num"> ×{o.quantity}</span>}
                {o.reagents.length > 0 && <Reagents o={o} myId={myId} onToggle={ids => act(o, "reagents", ids)} />}
                {o.note && <div className="small muted co-note">{o.note}</div>}</td>
              <td>{o.requester.name}{o.character && o.character !== o.requester.name && <span className="muted small"> · pour {o.character}</span>}</td>
              <td className="small">{o.crafters.length ? names(o.crafters) : <span className="warnmsg">personne ne connaît le patron</span>}</td>
              <td><span className={`rl-chip ${o.status === "done" ? "ok" : o.status === "taken" ? "" : "warn"}`}>{STATUS[o.status]}{o.taker && o.status !== "open" ? ` · ${o.taker.name}` : ""}</span></td>
              <td className="co-act">
                {o.status === "open" && !o.mine && <button type="button" className={`btn sm ${o.canCraft ? "primary" : "ghost"}`} onClick={() => act(o, "take")}>Je m'en charge</button>}
                {o.status === "taken" && o.taker?.id === myId && <><button type="button" className="btn sm primary" onClick={() => act(o, "done")}>Faite</button><button type="button" className="btn sm ghost" onClick={() => act(o, "release")}>Rendre</button></>}
                {o.status === "taken" && o.mine && o.taker?.id !== myId && <button type="button" className="btn sm" onClick={() => act(o, "done")}>Reçue</button>}
                {o.status === "open" && o.canManage && <button type="button" className="btn sm ghost" onClick={() => remove(o)}>Annuler</button>}
                {o.status === "done" && (o.canManage || o.taker?.id === myId) && <button type="button" className="btn sm ghost" onClick={() => remove(o)}>Archiver</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/** Composants de la commande : « fourni » coché par le demandeur ou l'artisan (les autres voient seulement). */
function Reagents({ o, myId, onToggle }: { o: Order; myId?: string; onToggle: (provided: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const can = o.status !== "done" && (o.mine || o.taker?.id === myId || o.canManage);
  const given = o.reagents.filter(r => r.provided).length;
  return (
    <div className="co-reag">
      <button type="button" className="co-reag-sum" aria-expanded={open} onClick={() => setOpen(x => !x)}>
        Composants : <b className={given === o.reagents.length ? "ok" : ""}>{given}/{o.reagents.length} fournis</b> {open ? "▴" : "▾"}
      </button>
      {open && (
        <ul>{o.reagents.map(r => (
          <li key={r.itemId}><label>
            <input type="checkbox" checked={r.provided} disabled={!can}
              onChange={() => onToggle(o.reagents.filter(x => (x.itemId === r.itemId ? !x.provided : x.provided)).map(x => x.itemId))} />
            <span className="num">{r.n}</span> × {r.name}
          </label></li>
        ))}</ul>
      )}
    </div>
  );
}

function NewOrder({ groupId, prefill, onDone, onCancel }: { groupId: string; prefill: OrderPrefill | null; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState(prefill?.name ?? ""), [debounced, setDebounced] = useState(prefill?.name ?? "");
  const [pick, setPick] = useState<RecipeHit | null>(null);
  const [qty, setQty] = useState(1);
  const [charId, setCharId] = useState("");
  const [note, setNote] = useState("");
  const [provided, setProvided] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);
  const hits = useQuery({ queryKey: ["order-recipes", groupId, debounced], enabled: debounced.length >= 2 && !pick,
    queryFn: () => get<{ recipes: RecipeHit[] }>(`/groups/${groupId}/orders/recipes?q=${encodeURIComponent(debounced)}`) });
  // Recette demandée depuis la liste des artisans : choisie d'office
  useEffect(() => { if (prefill && hits.data && !pick) { const h = hits.data.recipes.find(r => r.spellId === prefill.spellId); if (h) setPick(h); } }, [hits.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const myChars = mine.data?.characters ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setBusy(true); setError(null);
    try {
      await post(`/groups/${groupId}/orders`, { spellId: pick.spellId, quantity: qty, characterId: charId || null, note, provided });
      onDone();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Commande impossible."); } finally { setBusy(false); }
  };
  return (
    <form className="co-form" onSubmit={e => void submit(e)}>
      {!pick ? (
        <div className="fld"><label htmlFor="co-q">Objet à fabriquer</label>
          <input id="co-q" type="search" autoFocus placeholder="Flarecore Leggings, Major Healing Potion…" value={q} onChange={e => setQ(e.target.value)} />
          {debounced.length >= 2 && hits.data && (
            hits.data.recipes.length ? (
              <ul className="co-hits">{hits.data.recipes.map(r => (
                <li key={r.spellId}><button type="button" onClick={() => setPick(r)}>
                  <span className={r.quality != null ? `q${r.quality}` : ""} style={{ fontWeight: 600 }}>{r.itemName ?? r.name}</span>
                  <span className="muted small">{SKILL_LINE_NAMES[r.skillLine] ?? "?"} {r.reqSkill} · {r.crafters.length ? `connu par ${names(r.crafters)}` : "personne ne connaît le patron"}</span>
                </button></li>
              ))}</ul>
            ) : <p className="hint" style={{ margin: "6px 0 0" }}>Aucune recette trouvée.</p>
          )}
        </div>
      ) : (
        <div className="co-pick">
          <span><b className={pick.quality != null ? `q${pick.quality}` : ""}>[{pick.itemName ?? pick.name}]</b> <span className="muted small">{SKILL_LINE_NAMES[pick.skillLine] ?? "?"} {pick.reqSkill}</span><br />
            <span className="small">{pick.crafters.length ? <>Peuvent le faire : <b>{names(pick.crafters, 5)}</b></> : <span className="warnmsg">Personne dans le groupe ne connaît ce patron pour l'instant.</span>}</span></span>
          <button type="button" className="btn ghost sm" onClick={() => setPick(null)}>Changer</button>
        </div>
      )}
      {pick && (
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="fld" style={{ width: 130 }}><label htmlFor="co-qty">Quantité</label><NumberField id="co-qty" min={1} max={99} value={qty} onChange={setQty} /></div>
          <div className="fld" style={{ flex: "1 1 160px" }}><label htmlFor="co-char">Pour</label>
            <select id="co-char" value={charId} onChange={e => setCharId(e.target.value)}><option value="">—</option>{myChars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="fld" style={{ flex: "3 1 260px" }}><label htmlFor="co-note">Détails</label>
            <input id="co-note" type="text" maxLength={300} placeholder="Délai, pourboire, précisions…" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
      )}
      {pick && pick.reagents.length > 0 && (
        <fieldset className="co-reagpick">
          <legend className="lbl">Composants pour {qty} · coche ceux que tu fournis</legend>
          {pick.reagents.map(r => (
            <label key={r.itemId}><input type="checkbox" checked={provided.includes(r.itemId)}
              onChange={() => setProvided(p => (p.includes(r.itemId) ? p.filter(x => x !== r.itemId) : [...p, r.itemId]))} />
              <span className="num">{r.n * qty}</span> × {r.name}</label>
          ))}
        </fieldset>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row"><button type="submit" className="btn primary sm" disabled={!pick || busy}>Envoyer la commande</button><button type="button" className="btn ghost sm" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}
