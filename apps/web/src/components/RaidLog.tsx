import { classColor, ATTENDANCE_LABEL, CLASSES, itemLinks, LOOT_METHOD_LABEL, LOOT_RESPONSE_LABEL, type AttendanceStatus, type ClassName, type LootMethod, type LootResponse } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, put } from "../api";

/* ---------- Bilan d'un raid (page du raid) ---------- */

export interface RaidLogView {
  recorder: string; startedAt: string; endedAt: string; updatedAt: string;
  attendance: { name: string; characterId: string | null; cls: string; owner: string | null; status: AttendanceStatus; first: number | null; last: number | null }[];
  loot: { itemId: number; itemName: string; quality: number; boss: string; at: number; name: string; characterId: string | null; cls: string; bis: boolean;
    method: LootMethod | null; response: LootResponse | null; detail: string;
    /** Lot I : nom noté par l'addon, raison pour laquelle l'objet ne compte pas d'office, exclusion par un officier. */
    gameName: string; skip: string | null; excluded: boolean }[];
}

const clsColor = (cls: string) => classColor(cls);
const hm = (unix: number | null) => (unix ? new Date(unix * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");
const TONE: Record<AttendanceStatus, string> = { present: "ok", late: "warn", left: "warn", bench: "", absent: "bad" };

export const AttendanceChip = ({ s }: { s: AttendanceStatus }) => <span className={`rl-chip ${TONE[s]}`}>{ATTENDANCE_LABEL[s]}</span>;

export function RaidLogPanel({ log, groupId, raidId, officer }: { log: RaidLogView | null | undefined; groupId: string; raidId: string; officer: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = async (l: RaidLogView["loot"][number]) => {
    setError(null);
    try {
      await put(`/groups/${groupId}/raids/${raidId}/loot-exclusions`, { itemId: l.itemId, name: l.gameName, at: l.at, excluded: !l.excluded });
      await Promise.all([qc.invalidateQueries({ queryKey: ["raid", raidId] }), qc.invalidateQueries({ queryKey: ["attendance", groupId] }), qc.invalidateQueries({ queryKey: ["player-sheet", groupId] })]);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Changement impossible."); }
  };
  if (!log) {
    return (
      <section className="panel pad stack" aria-labelledby="rl-title">
        <h3 id="rl-title" style={{ margin: 0 }}>Bilan du raid</h3>
        <p className="hint" style={{ margin: 0 }}>
          Pas encore de bilan. Pendant le raid, l'addon relève tout seul la présence et le butin (données du site chargées en jeu avant).
          Après le raid, un officier fait sa synchro : ta touche, Ctrl+C, puis Ctrl+V sur le site.
        </p>
      </section>
    );
  }
  const came = log.attendance.filter(a => a.status !== "absent" && a.status !== "bench").length;
  const when = new Date(log.updatedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="panel pad stack" aria-labelledby="rl-title">
      <div className="row between">
        <h3 id="rl-title" style={{ margin: 0 }}>Bilan du raid</h3>
        <span className="hint">Relevé par l'addon de {log.recorder || "?"} · {hm(Math.floor(new Date(log.startedAt).getTime() / 1000))} → {hm(Math.floor(new Date(log.endedAt).getTime() / 1000))} · enregistré le {when}</span>
      </div>
      <div className="rl-grid">
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="rl-h">Butin <span className="muted small">{log.loot.length} objet{log.loot.length > 1 ? "s" : ""}</span></h4>
          {log.loot.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Aucun objet noté.</p> : (
            <div className="tscroll"><table className="data rl-table">
              <thead><tr><th>Objet</th><th>À</th><th /></tr></thead>
              <tbody>
                {log.loot.map((l, i) => (
                  <tr key={`${l.itemId}-${l.at}-${i}`}>
                    <td><a className={`q${l.quality}`} href={itemLinks(l.itemId).wowhead} target="_blank" rel="noopener noreferrer">{l.itemName}</a>
                      {l.boss && <div className="muted small">{l.boss}</div>}</td>
                    <td style={{ color: clsColor(l.cls) }}>{l.name}</td>
                    <td className="r"><div className="rl-tags">
                      {l.method && <span className="rl-chip" title={l.detail || undefined}>{l.method === "roll" && /^(MS|OS)\b/.test(l.detail) ? "jet" : LOOT_METHOD_LABEL[l.method]}{l.response ? ` · ${LOOT_RESPONSE_LABEL[l.response]}` : ""}{l.detail ? ` · ${l.detail}` : ""}</span>}
                      {l.bis && <span className="rl-chip ok" title="Objectif BiS de la fiche, coché « obtenu »">BiS ✓</span>}
                      {l.skip ? <span className="rl-chip muted" title="Ne compte pas dans les objets reçus (spé principale seulement)">ne compte pas · {l.skip}</span>
                        : l.excluded && <span className="rl-chip bad" title="Sorti du compte des objets reçus par un officier">ne compte pas</span>}
                      {officer && !l.skip && <button type="button" className="btn ghost xs rl-excl" onClick={() => void toggle(l)}
                        title={l.excluded ? "Remettre cet objet dans le compte des objets reçus" : "Sortir cet objet du compte des objets reçus (donné par erreur, désenchanté…)"}>{l.excluded ? "Compter" : "Ne pas compter"}</button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="rl-h">Présence <span className="muted small">{came} venu{came > 1 ? "s" : ""}</span></h4>
          <div className="tscroll"><table className="data rl-table">
            <thead><tr><th>Perso</th><th>Dans le raid</th><th className="r">Statut</th></tr></thead>
            <tbody>
              {log.attendance.map(a => (
                <tr key={`${a.name}-${a.characterId}`}>
                  <td style={{ color: clsColor(a.cls) }}>{a.name}{!a.characterId && <span className="muted small" title="Aucune fiche de ce nom dans le groupe"> · sans fiche</span>}</td>
                  <td className="muted">{a.first ? `${hm(a.first)} → ${hm(a.last)}` : "—"}</td>
                  <td className="r"><AttendanceChip s={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <p className="hint" style={{ margin: 0 }}>En retard : arrivé plus de 10 min après l'heure prévue. Parti tôt : absent du dernier quart de la soirée. Un nouveau collage du bilan remplace celui-ci (les objets sortis du compte le restent).</p>
      <p className="hint" style={{ margin: 0 }}>Objets reçus (onglet Présence &amp; butin, conseil en jeu) : comptent la soft reserve, les jets MS, le conseil BiS et Upgrade, et les objets notés sans méthode. Pas les jets OS, le jet libre, Off-Spec ni Transmo.</p>
    </section>
  );
}

/* ---------- Présence et butin du groupe (onglet) ---------- */

interface AttendanceResponse {
  raids: { id: string; name: string; scheduledAt: string }[];
  characters: { id: string; name: string; cls: string; owner: string; cells: (AttendanceStatus | null)[]; attended: number; loot: number; counted: number;
    lastItem: { id: number; name: string; quality: number; raidName: string } | null }[];
  /** Lot I : période et façon de compter les objets reçus (réglages du groupe). */
  count: { short: string; label: string; by: "player" | "character" };
}
const CELL: Record<AttendanceStatus, string> = { present: "✓", late: "R", left: "P", bench: "B", absent: "✗" };

export function AttendanceTab({ groupId }: { groupId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["attendance", groupId], queryFn: () => get<AttendanceResponse>(`/groups/${groupId}/attendance`) });
  if (isLoading || !data) return <p className="muted">Chargement…</p>;
  if (!data.raids.length) {
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Aucun raid relevé pour l'instant.</p>
        <p className="hint" style={{ margin: 0 }}>Pendant un raid prévu ici, l'addon relève tout seul qui est présent et le butin. Après le raid, un officier fait sa synchro (ta touche, Ctrl+C, puis Ctrl+V sur le site) : le bilan apparaît sur la page du raid et ici.</p>
      </div>
    );
  }
  const n = data.raids.length;
  return (
    <div className="stack">
      <p className="hint" style={{ margin: 0 }}>{n > 1 ? `Sur les ${n} derniers raids relevés.` : "Sur le dernier raid relevé."} ✓ présent · R en retard · P parti tôt · B banc · ✗ inscrit, absent · vide : ni inscrit ni vu.</p>
      <div className="tscroll"><table className="data rl-att">
        <thead><tr>
          <th>Perso</th><th>Présence</th>
          {data.raids.map(r => <th key={r.id} className="c" title={`${r.name} · ${new Date(r.scheduledAt).toLocaleDateString("fr-FR")}`}><Link to={`/groups/${groupId}/raids/${r.id}`}>{new Date(r.scheduledAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</Link></th>)}
          <th className="r" title={`Objets de spé principale reçus ${data.count.label}${data.count.by === "player" ? ", main et alts ensemble" : ", par perso"} (réglage : Administration → Butin)`}>Objets · {data.count.short}</th><th>Dernier objet</th>
        </tr></thead>
        <tbody>
          {data.characters.map(c => {
            const pct = Math.round((c.attended / n) * 100);
            return (
              <tr key={c.id}>
                <td><span style={{ color: clsColor(c.cls), fontWeight: 600 }}>{c.name}</span> <span className="muted small">{c.owner}</span></td>
                <td className="nowrap"><span className="rl-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} className={pct < 50 ? "low" : ""} /></span><span className="num small">{c.attended}/{n}</span></td>
                {c.cells.map((s, i) => <td key={i} className={`c rl-cell ${s ?? ""}`} title={s ? ATTENDANCE_LABEL[s] : "Ni inscrit ni vu"}>{s ? CELL[s] : ""}</td>)}
                <td className="r num" title={`${c.loot} objet${c.loot > 1 ? "s" : ""} relevé${c.loot > 1 ? "s" : ""} au total`}>{c.counted}</td>
                <td>{c.lastItem ? <a className={`q${c.lastItem.quality}`} href={itemLinks(c.lastItem.id).wowhead} target="_blank" rel="noopener noreferrer" title={c.lastItem.raidName}>{c.lastItem.name}</a> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
