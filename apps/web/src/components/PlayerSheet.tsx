import { ATTENDANCE_LABEL, CLASSES, itemLinks, type AttendanceStatus, type ClassName, type GearStats } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get, type GroupRole } from "../api";
import { ClassIcon, SpecIcon } from "./Icons";
import { Portrait } from "./ImageUpload";

/** Fiche d'un joueur dans le groupe (lot D1) : persos joués ici, présence, banc, butin reçu. Classes CSS « ps- ». */

interface Sheet {
  member: { userId: string; displayName: string; avatarId: string | null; role: GroupRole; joinedAt: string; discordLinked: boolean };
  characters: { id: string; name: string; cls: string; spec1: string; spec2: string; level: number; portraitId: string | null; isMain: boolean; gearStats: GearStats }[];
  attendance: { raids: number; attended: number; benched: number; cells: { raidId: string; name: string; scheduledAt: string; status: AttendanceStatus | null }[] };
  loot: { itemId: number; name: string; quality: number; character: string; boss: string; raidName: string; raidId: string; at: number; bis: boolean }[];
}

const ROLE_NAME: Record<GroupRole, string> = { owner: "Propriétaire", officer: "Officier", member: "Membre" };
const CELL: Record<AttendanceStatus, string> = { present: "✓", late: "R", left: "P", bench: "B", absent: "✗" };
const day = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" });
const color = (cls: string) => CLASSES[cls as ClassName]?.color ?? "var(--line-2)";

export function PlayerSheet({ groupId, userId, onClose }: { groupId: string; userId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["player-sheet", groupId, userId], queryFn: () => get<Sheet>(`/groups/${groupId}/members/${userId}/sheet`) });
  if (isLoading || !data) return <p className="muted">Chargement…</p>;
  const { member: m, characters, attendance: a, loot } = data;
  const main = characters.find(c => c.isMain);
  const bis = main?.gearStats;
  return (
    <section className="ps" aria-label={`Fiche de ${m.displayName}`}>
      <header className="ps-head">
        <span className="avatar" style={{ width: 44, height: 44 }}><Portrait id={m.avatarId} size={44} fallback={<span>{m.displayName[0]}</span>} /></span>
        <div><h3>{m.displayName}</h3><span className="muted small">Membre depuis le {day.format(new Date(m.joinedAt))}{m.discordLinked ? " · Discord lié" : ""}</span></div>
        <span className="tag">{ROLE_NAME[m.role]}</span>
        <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onClose}>Fermer</button>
      </header>
      <div className="ps-kpis">
        <div><b className="num">{a.raids ? `${a.attended}/${a.raids}` : "—"}</b><span>raids venus</span></div>
        <div><b className="num">{a.benched}</b><span>fois sur le banc</span></div>
        <div><b className="num">{loot.length}</b><span>objet{loot.length > 1 ? "s" : ""} reçu{loot.length > 1 ? "s" : ""}</span></div>
        <div><b className="num">{bis ? `${bis.got}/${bis.total}` : "—"}</b><span>BiS du main</span></div>
      </div>
      <div className="ps-cols">
        <div>
          <h4 className="gm-sec">Persos dans le groupe</h4>
          {characters.length === 0 ? <p className="muted small">Aucun perso choisi pour ce groupe.</p> : (
            <ul className="ps-chars">
              {characters.map(c => (
                <li key={c.id}>
                  <Link to={`/persos/${c.id}`} className="ps-char">
                    <span className="gav" style={{ ["--cc" as string]: color(c.cls), width: 30, height: 30 }}>
                      <Portrait id={c.portraitId} size={30} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={22} /> : <ClassIcon cls={c.cls} size={22} />) : <span className="muted">?</span>} />
                    </span>
                    <span className="ps-cn">
                      <span>{c.isMain ? <span className="gm-star">★</span> : <span className="gm-alt">alt</span>}<b style={{ color: color(c.cls) }}>{c.name}</b></span>
                      <small>{[c.spec1, c.spec2].filter(Boolean).join(" · ") || c.cls || "À configurer"} · niv. {c.level}</small>
                    </span>
                    <span className="num small muted">{c.gearStats.ilvl != null ? `ilvl ${String(c.gearStats.ilvl).replace(".", ",")}` : ""}</span>
                    <span className="ps-prog"><span className="rl-bar" aria-hidden="true"><i style={{ width: `${Math.round(c.gearStats.got / c.gearStats.total * 100)}%` }} className={c.gearStats.got / c.gearStats.total < .5 ? "low" : ""} /></span>
                      <span className="num small">{c.gearStats.got}/{c.gearStats.total} BiS</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="gm-sec">Présence · {a.raids ? `${a.raids} derniers raids relevés` : "aucun raid relevé"}</h4>
          {a.raids > 0 && (
            <div className="ps-cells">
              {a.cells.map(c => (
                <Link key={c.raidId} to={`/groups/${groupId}/raids/${c.raidId}`} className={`ps-cell ${c.status ?? "none"}`} title={`${c.name} · ${day.format(new Date(c.scheduledAt))} · ${c.status ? ATTENDANCE_LABEL[c.status] : "ni inscrit ni vu"}`}>
                  {c.status ? CELL[c.status] : "·"}
                </Link>
              ))}
            </div>
          )}
          <h4 className="gm-sec" style={{ marginTop: 14 }}>Butin reçu</h4>
          {loot.length === 0 ? <p className="muted small" style={{ margin: "6px 0 0" }}>Rien de relevé pour l'instant.</p> : (
            <ul className="ps-loot">
              {loot.map((l, i) => (
                <li key={`${l.itemId}-${l.at}-${i}`}>
                  <a className={`q${l.quality}`} href={itemLinks(l.itemId).wowhead} target="_blank" rel="noopener noreferrer">[{l.name}]</a>
                  <span className="muted small"> · {l.character}{l.boss ? ` · ${l.boss}` : ""} · {l.raidName}</span>
                  {l.bis && <span className="rl-chip ok" style={{ marginLeft: 6 }}>BiS ✓</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
