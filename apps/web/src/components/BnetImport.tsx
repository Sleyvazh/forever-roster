import { RETAIL_MAX_LEVEL, type BnetCharacter } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, get, post, type Character } from "../api";
import { useGameText } from "../gameText";
import { meQuery } from "../me";

/**
 * R2b (Roster) : import des persos du compte Battle.net. Battle.net demande l'accord (liste des persos WoW),
 * le site garde la liste 30 minutes ; les persos au niveau maximum sont cochés, le reste au choix (décision de Flo).
 */

/** « Il y a 5 min » : dernière lecture chez Blizzard. */
export function bnetAge(at?: string | null) {
  if (!at) return "jamais lu chez Blizzard";
  const min = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
  if (min < 1) return "lu à l'instant";
  if (min < 60) return `lu il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `lu il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "lu hier" : `lu il y a ${d} jours`;
}

export function useBnetEnabled() {
  return !!useQuery(meQuery).data?.battlenetEnabled;
}

/** Bouton : part sur Battle.net (accord pour la liste des persos), retour sur Mes persos avec la liste. */
export function BnetImportButton({ small }: { small?: boolean }) {
  const enabled = useBnetEnabled();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  const go = async () => {
    setError(null); setBusy(true);
    try { const r = await post<{ url: string }>("/auth/battlenet/import"); window.location.assign(r.url); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Battle.net ne répond pas."); setBusy(false); }
  };
  return (
    <>
      <button type="button" className={`btn bnet${small ? " sm" : ""}`} disabled={busy} onClick={() => void go()}>Importer depuis Battle.net</button>
      {error && <span className="warnmsg small" role="alert">{error}</span>}
    </>
  );
}

const RETURN_MSG: Record<string, string> = {
  error: "Battle.net n'a pas donné la liste de tes persos. Réessaie dans un instant ; si ça recommence, vérifie que tu as bien accepté le partage des persos.",
  session: "Ta session a changé pendant le passage par Battle.net. Reconnecte-toi puis relance l'import.",
};

interface ImportResult { created: number; linked: number; failed: { name: string; reason: string }[]; characters: Character[] }

/** Liste de Battle.net : cases à cocher (niveau 90 cochés), puis import. `mode` : retour de Battle.net (?bnet=…). */
export function BnetImportPanel({ mode, onClose, onImported }: { mode: string; onClose: () => void; onImported: (chars: Character[]) => void }) {
  const t = useGameText();
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["bnet-import"], enabled: mode === "import", retry: false, staleTime: Infinity,
    queryFn: () => get<{ characters: BnetCharacter[]; expiresAt: string }>("/battlenet/import"),
  });
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const list = listQ.data?.characters ?? [];
  // Cochés d'office : niveau maximum, pas encore sur Roster
  useEffect(() => {
    if (listQ.data && !picked) setPicked(new Set(listQ.data.characters.filter(c => c.level >= RETAIL_MAX_LEVEL && !c.existing).map(c => c.id)));
  }, [listQ.data, picked]);

  if (mode !== "import") return (
    <div className="alert error stack" role="alert" style={{ gap: 8 }}>
      <span>{RETURN_MSG[mode] ?? RETURN_MSG.error}</span>
      <span className="row"><BnetImportButton small /><button type="button" className="btn ghost sm" onClick={onClose}>Fermer</button></span>
    </div>
  );

  const sel = picked ?? new Set<number>();
  const toggle = (id: number) => setPicked(() => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const run = async () => {
    setError(null); setBusy(true);
    try {
      const r = await post<ImportResult>("/battlenet/import", { ids: [...sel] });
      setResult(r);
      await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["bnet-import"] }), qc.invalidateQueries({ queryKey: ["week"] })]);
      setPicked(new Set());
      onImported(r.characters);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Import impossible."); }
    finally { setBusy(false); }
  };
  const until = listQ.data ? new Date(listQ.data.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section className="panel pad stack bi" aria-labelledby="bi-title">
      <div className="row between">
        <h3 id="bi-title" style={{ margin: 0 }}>Persos de ton compte Battle.net</h3>
        <button type="button" className="btn ghost sm" onClick={onClose}>Fermer</button>
      </div>
      {listQ.isLoading && <p className="muted" style={{ margin: 0 }}>Chargement…</p>}
      {listQ.error && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>{listQ.error instanceof ApiError ? listQ.error.message : "Liste indisponible."}</p>
          <span><BnetImportButton small /></span>
        </div>
      )}
      {result && (
        <div className="alert ok" role="status">
          {[result.created && `${result.created} perso${result.created > 1 ? "s" : ""} importé${result.created > 1 ? "s" : ""}`,
            result.linked && `${result.linked} fiche${result.linked > 1 ? "s" : ""} déjà là, reliée${result.linked > 1 ? "s" : ""} à Battle.net`].filter(Boolean).join(", ")}.
          {result.failed.length > 0 && <> Niveau d'objet pas lu pour {result.failed.map(f => `${f.name} (${f.reason})`).join(", ")}.</>}
        </div>
      )}
      {listQ.data && (<>
        <p className="hint" style={{ margin: 0 }}>Coche les persos à ajouter à Roster. Ceux au niveau {RETAIL_MAX_LEVEL} sont cochés ; les autres, si tu veux. Liste valable jusqu'à {until}.</p>
        {list.length === 0 ? <p className="muted" style={{ margin: 0 }}>Aucun perso de WoW Retail sur ce compte (région Europe).</p> : (
          <ul className="bi-list" role="list">
            {list.map(c => (
              <li key={c.id}>
                <label className={`bi-row${c.existing ? " here" : ""}`} style={{ ["--cc" as string]: t.color(c.cls) ?? "var(--line-2)" }}>
                  <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="lvl-pill num">{c.level}</span>
                  <span className="bi-name">{c.name}</span>
                  <span className="bi-sub">{t.cls(c.cls)} · {c.realm}</span>
                  {c.existing && <span className="tag" title="Une fiche de Roster porte déjà ce nom sur ce royaume : l'importer la relie à Battle.net">déjà sur Roster</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="row">
          <button type="button" className="btn primary" disabled={busy || sel.size === 0} onClick={() => void run()}>
            {sel.size ? `Importer ${sel.size} perso${sel.size > 1 ? "s" : ""}` : "Importer"}
          </button>
          <span className="hint">Niveau, niveau d'objet et spé active lus chez Blizzard ; la spé active devient la spé principale d'un nouveau perso.</span>
        </div>
      </>)}
    </section>
  );
}

/** « Mettre à jour » : relit le perso chez Blizzard (niveau, niveau d'objet, spé active). */
export function useBnetRefresh(onDone: (c: Character) => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ character: Character }>(`/battlenet/characters/${id}/refresh`);
      onDone(r.character);
      setMsg({ ok: true, text: "Mis à jour." });
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Blizzard ne répond pas." }); }
    finally { setBusy(false); }
  };
  return { busy, msg, run };
}

/** Officiers (Roster) : relit d'un coup les persos du groupe chez Blizzard, avant un raid par exemple. */
export function BnetGroupRefresh({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const enabled = useBnetEnabled();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!enabled) return null;
  const run = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ updated: number; fresh: number; failed: { name: string; reason: string }[] }>(`/battlenet/groups/${groupId}/refresh`);
      const parts = [`${r.updated} perso${r.updated > 1 ? "s" : ""} mis à jour`];
      if (r.fresh) parts.push(`${r.fresh} déjà lu${r.fresh > 1 ? "s" : ""} il y a moins de 10 min`);
      setMsg({ ok: !r.failed.length, text: `${parts.join(", ")}.${r.failed.length ? ` Pas lus : ${r.failed.map(f => `${f.name} (${f.reason})`).join(", ")}.` : ""}` });
      onDone();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Blizzard ne répond pas." }); }
    finally { setBusy(false); }
  };
  return (
    <div className="row bi-group">
      <button type="button" className="btn sm" disabled={busy} onClick={() => void run()}>{busy ? "Lecture chez Blizzard…" : "Mettre à jour le groupe"}</button>
      <span className="hint">Niveau, niveau d'objet et spé active de chaque perso du groupe, lus chez Blizzard.</span>
      {msg && <span className={`small ${msg.ok ? "muted" : "warnmsg"}`} role="status" style={{ flexBasis: "100%" }}>{msg.text}</span>}
    </div>
  );
}
