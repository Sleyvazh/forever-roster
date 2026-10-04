import { ATTENDANCE_LABEL, CLASSES, itemLinks, type AttendanceStatus, type ClassName } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get } from "../api";

/* ---------- Bilan d'un raid (page du raid) ---------- */

export interface RaidLogView {
  recorder: string; startedAt: string; endedAt: string; updatedAt: string;
  attendance: { name: string; characterId: string | null; cls: string; owner: string | null; status: AttendanceStatus; first: number | null; last: number | null }[];
  loot: { itemId: number; itemName: string; quality: number; boss: string; at: number; name: string; characterId: string | null; cls: string; bis: boolean }[];
}

const clsColor = (cls: string) => CLASSES[cls as ClassName]?.color;
const hm = (unix: number | null) => (unix ? new Date(unix * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");
const TONE: Record<AttendanceStatus, string> = { present: "ok", late: "warn", left: "warn", bench: "", absent: "bad" };

export const AttendanceChip = ({ s }: { s: AttendanceStatus }) => <span className={`rl-chip ${TONE[s]}`}>{ATTENDANCE_LABEL[s]}</span>;

export function RaidLogPanel({ log }: { log: RaidLogView | null | undefined }) {
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
              <thead><tr><th>Objet</th><th>Boss</th><th>À</th><th /></tr></thead>
              <tbody>
                {log.loot.map((l, i) => (
                  <tr key={`${l.itemId}-${l.at}-${i}`}>
                    <td><a className={`q${l.quality}`} href={itemLinks(l.itemId).wowhead} target="_blank" rel="noopener noreferrer">{l.itemName}</a></td>
                    <td className="muted">{l.boss || "—"}</td>
                    <td style={{ color: clsColor(l.cls) }}>{l.name}</td>
                    <td className="r">{l.bis && <span className="rl-chip ok" title="Objectif BiS de la fiche, coché « obtenu »">BiS ✓</span>}</td>
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
      <p className="hint" style={{ margin: 0 }}>En retard : arrivé plus de 10 min après l'heure prévue. Parti tôt : absent du dernier quart de la soirée. Un nouveau collage du bilan remplace celui-ci.</p>
    </section>
  );
}

/* ---------- Présence et butin du groupe (onglet) ---------- */

interface AttendanceResponse {
  raids: { id: string; name: string; scheduledAt: string }[];
  characters: { id: string; name: string; cls: string; owner: string; cells: (AttendanceStatus | null)[]; attended: number; loot: number;
    lastItem: { id: number; name: string; quality: number; raidName: string } | null }[];
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
          <th className="r">Objets</th><th>Dernier objet</th>
        </tr></thead>
        <tbody>
          {data.characters.map(c => {
            const pct = Math.round((c.attended / n) * 100);
            return (
              <tr key={c.id}>
                <td><span style={{ color: clsColor(c.cls), fontWeight: 600 }}>{c.name}</span> <span className="muted small">{c.owner}</span></td>
                <td className="nowrap"><span className="rl-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} className={pct < 50 ? "low" : ""} /></span><span className="num small">{c.attended}/{n}</span></td>
                {c.cells.map((s, i) => <td key={i} className={`c rl-cell ${s ?? ""}`} title={s ? ATTENDANCE_LABEL[s] : "Ni inscrit ni vu"}>{s ? CELL[s] : ""}</td>)}
                <td className="r num">{c.loot}</td>
                <td>{c.lastItem ? <a className={`q${c.lastItem.quality}`} href={itemLinks(c.lastItem.id).wowhead} target="_blank" rel="noopener noreferrer" title={c.lastItem.raidName}>{c.lastItem.name}</a> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
