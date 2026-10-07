import {
  classColor, CLASSES, itemLinks, LOOT_COUNT_DAYS, lootCountLabel, lootModeHint, lootModeLabel, lootModesOf, retailLootMode,
  type ClassName, type LootCountBy, type LootCountMode, type LootMode, type LootSettings,
} from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, del, get, put, type Character } from "../api";
import { useSite } from "../site";

/**
 * Butin des raids (lot C2) : choix du mode, soft reserve d'un raid, réglages du groupe. Classes CSS « lt- ».
 * Roster (lot R3b) : journal ou conseil (distribution par l'addon Roster), pas de soft reserve.
 */

const clsColor = (cls: string) => classColor(cls);
const hm = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/* ---------- Choix du mode (création du raid, raids récurrents, page du raid) ---------- */

export function LootModePicker({ mode: raw, hidden, onChange, idPrefix = "lt" }: {
  mode: LootMode; hidden: boolean; onChange: (mode: LootMode, hidden: boolean) => void; idPrefix?: string;
}) {
  const game = useSite().game;
  // Roster : une ancienne soft reserve se lit comme un journal
  const mode = game === "retail" ? retailLootMode(raw) : raw;
  // Trois choix (deux sur Roster) en un sélecteur ; l'explication seulement pour le choix fait (lot E)
  return (
    <div className="lt-pick">
      <div className="seg" role="radiogroup" aria-label="Butin" id={`${idPrefix}-mode`}>
        {lootModesOf(game).map(m => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => onChange(m, hidden)}>{lootModeLabel(m, game)}</button>
        ))}
      </div>
      <p className="hint lt-hint">{lootModeHint(mode, game)}</p>
      {mode === "softres" && (
        <label className="lt-check"><input type="checkbox" checked={hidden} onChange={e => onChange(mode, e.target.checked)} />
          Réservations cachées jusqu'à la fermeture <span className="muted small">(sinon visibles de tous)</span></label>
      )}
    </div>
  );
}

export function LootModeTag({ mode }: { mode: LootMode }) {
  const game = useSite().game;
  const m = game === "retail" ? retailLootMode(mode) : mode;
  return m === "journal" ? null : <span className="tag gold">{lootModeLabel(m, game, true)}</span>;
}

/* ---------- Soft reserve d'un raid ---------- */

interface Reserver { characterId: string; name: string; cls: string; owner: string; isMain: boolean; mine: boolean; bonus: number }
interface SoftResView {
  settings: { count: number; srPlus: boolean; step: number; mainsFirst: boolean };
  closesAt: string | null; open: boolean; hidden: boolean; total: number;
  items: { item: { id: number; name: string; quality: number }; boss: string; reservers: Reserver[] }[];
}
interface Options { catalog: { id: number; name: string; quality: number; boss: string; seen: number }[]; search: { id: number; name: string; quality: number }[] }

export function SoftReservePanel({ groupId, raidId, myChars, officer }: { groupId: string; raidId: string; myChars: Character[]; officer: boolean }) {
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ["softres", raidId], queryFn: () => get<SoftResView>(`/groups/${groupId}/raids/${raidId}/soft-reserves`) });
  const [charId, setCharId] = useState("");
  const [q, setQ] = useState(""), [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!charId && myChars[0]) setCharId(myChars[0].id); }, [myChars, charId]);
  const options = useQuery({
    queryKey: ["loot-options", raidId, debounced], enabled: adding,
    queryFn: () => get<Options>(`/groups/${groupId}/raids/${raidId}/loot-options${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`),
  });
  const v = view.data;
  if (!v) return null;

  const char = myChars.find(c => c.id === charId);
  const mineFor = (cid: string) => v.items.filter(i => i.reservers.some(r => r.characterId === cid)).length;
  const used = char ? mineFor(char.id) : 0;
  const full = used >= v.settings.count;
  const run = async (fn: () => Promise<SoftResView>) => {
    setError(null);
    try { qc.setQueryData(["softres", raidId], await fn()); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
  };
  const reserve = (itemId: number) => char && run(() => put<SoftResView>(`/groups/${groupId}/raids/${raidId}/soft-reserves`, { characterId: char.id, itemId }));
  const remove = (characterId: string, itemId: number) => run(() => del<SoftResView>(`/groups/${groupId}/raids/${raidId}/soft-reserves?characterId=${characterId}&itemId=${itemId}`));
  const reserved = new Set(v.items.filter(i => i.reservers.some(r => r.characterId === char?.id)).map(i => i.item.id));
  const closes = v.closesAt ? hm.format(new Date(v.closesAt)) : null;

  const pickList = (list: { id: number; name: string; quality: number; boss?: string }[], title: string) => list.length > 0 && (
    <div className="lt-opts">
      <div className="lt-sub">{title}</div>
      <ul>
        {list.map(o => (
          <li key={`${title}-${o.id}-${o.boss ?? ""}`}>
            <a className={`q${o.quality}`} href={itemLinks(o.id).wowhead} target="_blank" rel="noopener noreferrer">[{o.name}]</a>
            {o.boss && <span className="muted small"> · {o.boss}</span>}
            <button type="button" className="btn sm" style={{ marginLeft: "auto" }} disabled={!char || full || reserved.has(o.id) || !v.open}
              onClick={() => void reserve(o.id)}>{reserved.has(o.id) ? "★ Réservé" : "Réserver"}</button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className="panel pad stack" aria-labelledby="sr-title">
      <div className="row between">
        <h3 id="sr-title" style={{ margin: 0 }}>Soft reserve</h3>
        <span className="hint">{v.settings.count} réservation{v.settings.count > 1 ? "s" : ""} par perso{v.settings.srPlus && ` · SR+ : +${v.settings.step} par raid réservé sans l'avoir eu`}
          {" · "}{v.open ? (closes ? `ferme ${closes}` : "ouvert") : <b>fermé</b>}</span>
      </div>
      {v.hidden && <p className="hint" style={{ margin: 0 }}>Réservations cachées jusqu'à la fermeture : tu ne vois que les tiennes ({v.total} au total).</p>}

      {myChars.length > 0 && v.open && (
        <div className="row lt-me">
          <b>Mes réservations</b><span className="tag gold num">{used}/{v.settings.count}</span>
          {myChars.length > 1 && (
            <select aria-label="Perso qui réserve" value={charId} onChange={e => setCharId(e.target.value)}>
              {myChars.map(c => <option key={c.id} value={c.id}>{c.isMain ? "★ " : ""}{c.name}</option>)}
            </select>
          )}
          {!adding
            ? <button type="button" className="btn sm primary" disabled={full} onClick={() => setAdding(true)}>{full ? "Limite atteinte" : "Réserver un objet"}</button>
            : <button type="button" className="btn ghost sm" onClick={() => { setAdding(false); setQ(""); }}>Fermer</button>}
        </div>
      )}
      {adding && (
        <div className="lt-add stack">
          <input type="search" aria-label="Chercher un objet" placeholder="Nom de l'objet (2 lettres au moins)…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          {options.data && (
            <>
              {pickList(options.data.catalog, "Vus tomber dans ce raid")}
              {pickList(options.data.search, "Autres objets")}
              {!options.data.catalog.length && !options.data.search.length && (
                <p className="hint" style={{ margin: 0 }}>{debounced.length >= 2 ? "Aucun objet trouvé." : "Le site apprend le butin de chaque raid grâce aux bilans de l'addon. En attendant, cherche l'objet par son nom."}</p>
              )}
            </>
          )}
        </div>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}

      {v.items.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucune réservation pour l'instant.</p> : (
        <div className="tscroll"><table className="data lt-table">
          <thead><tr><th>Objet</th><th>Boss</th><th>Réservé par</th></tr></thead>
          <tbody>{v.items.map(i => (
            <tr key={i.item.id}>
              <td><a className={`q${i.item.quality}`} href={itemLinks(i.item.id).wowhead} target="_blank" rel="noopener noreferrer">[{i.item.name}]</a>
                {i.reservers.length > 1 && <span className="tag warn" style={{ marginLeft: 8 }}>{i.reservers.length} SR</span>}</td>
              <td className="muted small">{i.boss || "—"}</td>
              <td><span className="lt-who">{i.reservers.map(r => (
                <span key={r.characterId} className={`lt-res${r.mine ? " mine" : ""}`} title={`${r.owner}${r.isMain ? " · main" : " · alt"}`}>
                  {r.isMain ? "★ " : ""}<b style={{ color: clsColor(r.cls) }}>{r.name}</b>
                  {r.bonus > 0 && <span className="lt-bonus">+{r.bonus}</span>}
                  {(r.mine || officer) && (v.open || officer) && <button type="button" className="lt-x" aria-label={`Retirer la réservation de ${r.name}`} onClick={() => void remove(r.characterId, i.item.id)}>×</button>}
                </span>
              ))}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="hint" style={{ margin: 0 }}>En raid, les réservants d'un objet le jouent aux dés (bonus SR+ ajouté). Plusieurs réservations du même objet : « 2 SR ».</p>
    </section>
  );
}

/* ---------- Réglages du butin (Administration) ---------- */

/** Aujourd'hui à Paris (AAAA-MM-JJ) : début d'une nouvelle saison. */
const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

export function LootSettingsPanel({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const retail = useSite().game === "retail";
  const { data } = useQuery({ queryKey: ["loot-settings", groupId], queryFn: () => get<{ settings: LootSettings }>(`/groups/${groupId}/loot-settings`) });
  const [s, setS] = useState<LootSettings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data && !s) setS(data.settings); }, [data, s]);
  if (!s) return null;
  // Chaque réglage s'enregistre dès qu'il change (lot E), comme le reste du site
  const change = async (next: LootSettings) => {
    setS(next); setMsg(null);
    try {
      const r = await put<{ settings: LootSettings }>(`/groups/${groupId}/loot-settings`, next);
      qc.setQueryData(["loot-settings", groupId], r); setS(r.settings);
      setMsg({ ok: true, text: "Enregistré." });
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Enregistrement impossible." }); }
  };
  const setS2 = (next: LootSettings) => void change(next);
  return (
    <section className="stack admin-sec" aria-labelledby="lt-set">
      <h3 id="lt-set">Butin</h3>
      {retail
        ? <p className="hint" style={{ margin: 0 }}>Le mode (journal, ou conseil : distribution par l'addon Roster) se choisit à la création de chaque raid. Pas de soft reserve sur Roster. Ici, le compte des objets reçus.</p>
        : <p className="hint" style={{ margin: 0 }}>Le mode (journal, loot council, soft reserve) se choisit à la création de chaque raid. Ici, les réglages communs.</p>}
      {!retail && <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ flex: "0 1 170px" }}><label htmlFor="lt-count">Réservations par perso</label>
          <select id="lt-count" value={s.srCount} onChange={e => setS2({ ...s, srCount: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
        <div className="fld" style={{ flex: "0 1 200px" }}><label htmlFor="lt-close">Fermeture SR</label>
          <select id="lt-close" value={s.srCloseMinutes} onChange={e => setS2({ ...s, srCloseMinutes: Number(e.target.value) })}>
            {[[0, "à l'heure du raid"], [30, "30 min avant"], [60, "1 h avant"], [120, "2 h avant"], [1440, "la veille"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <label className="lt-check"><input type="checkbox" checked={s.srPlus} onChange={e => setS2({ ...s, srPlus: e.target.checked })} /> SR+ : bonus au jet</label>
        {s.srPlus && <div className="fld" style={{ flex: "0 1 140px" }}><label htmlFor="lt-step">Bonus par raid</label>
          <select id="lt-step" value={s.srPlusStep} onChange={e => setS2({ ...s, srPlusStep: Number(e.target.value) })}>{[5, 10, 15, 20, 25].map(n => <option key={n} value={n}>+{n}</option>)}</select></div>}
        <label className="lt-check"><input type="checkbox" checked={s.mainsFirst} onChange={e => setS2({ ...s, mainsFirst: e.target.checked })} /> Mains avant alts</label>
      </div>}
      <h4 className="gm-sec" style={{ marginTop: 6 }}>Objets reçus</h4>
      {retail
        ? <p className="hint" style={{ margin: 0 }}>Compte montré au conseil du butin (colonne « Reçus » de l'addon Roster) et dans l'onglet Présence &amp; butin, d'après les bilans des raids. Comptent le conseil BiS et Upgrade, les jets MS, les objets donnés par le chef de butin et ceux seulement notés ; pas les jets OS, le jet libre, Off-Spec, Transmo ni les objets gardés par le chef de butin. Corrections : fiche du joueur (onglet Membres) et bilan de chaque raid.</p>
        : <p className="hint" style={{ margin: 0 }}>Compte montré au conseil du butin (addon) et dans l'onglet Présence &amp; butin. Comptent la soft reserve, les jets MS, le conseil BiS et Upgrade, et les objets notés sans méthode ; pas les jets OS, le jet libre, Off-Spec ni Transmo. Corrections : fiche du joueur (onglet Membres) et bilan de chaque raid.</p>}
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ flex: "0 1 200px" }}><label htmlFor="lt-cm">Période</label>
          <select id="lt-cm" value={s.countMode} onChange={e => setS2({ ...s, countMode: e.target.value as LootCountMode })}>
            <option value="season">Saison</option><option value="days">{LOOT_COUNT_DAYS} derniers jours</option><option value="raids">Derniers raids</option>
          </select></div>
        {s.countMode === "season" && <>
          <div className="fld" style={{ flex: "0 1 180px" }}><label htmlFor="lt-ss">Début de la saison</label>
            <input id="lt-ss" type="date" value={s.seasonStart ?? ""} max={todayParis()} onChange={e => setS2({ ...s, seasonStart: e.target.value || null })} /></div>
          <button type="button" className="btn sm" onClick={() => setS2({ ...s, seasonStart: todayParis() })} title="Le compte repart de zéro aujourd'hui ; l'historique reste">Nouvelle saison aujourd'hui</button>
        </>}
        {s.countMode === "raids" && <div className="fld" style={{ flex: "0 1 160px" }}><label htmlFor="lt-cr">Nombre de raids</label>
          <select id="lt-cr" value={s.countRaids} onChange={e => setS2({ ...s, countRaids: Number(e.target.value) })}>{[3, 5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} derniers</option>)}</select></div>}
        <div className="fld" style={{ flex: "0 1 220px" }}><label htmlFor="lt-cb">Compter par</label>
          <select id="lt-cb" value={s.countBy} onChange={e => setS2({ ...s, countBy: e.target.value as LootCountBy })}>
            <option value="player">Joueur (main et alts)</option><option value="character">Perso</option>
          </select></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Compte actuel : objets reçus {lootCountLabel(s)}{s.countBy === "player" ? ", main et alts ensemble" : ", perso par perso"}.</p>
      {msg && (msg.ok ? <span className="small muted" role="status">{msg.text}</span> : <div className="alert error" role="alert">{msg.text}</div>)}
      {retail
        ? <p className="hint" style={{ margin: 0 }}>Conseil : les officiers du groupe le forment, sauf choix fait pour un raid (onglet Butin du raid). En jeu, le chef de butin reçoit les objets ; chaque joueur répond BiS, Upgrade, Off-Spec ou Transmo, le conseil vote, ou le chef de butin lance les jets (MS / OS, jet libre).</p>
        : <p className="hint" style={{ margin: 0 }}>Loot council : les officiers du groupe forment le conseil. En jeu, chaque joueur répond BiS, Upgrade, Off-Spec ou Transmo ; le conseil vote, objet par objet.</p>}
    </section>
  );
}
