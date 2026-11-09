import { ATTENDED, classColor, type AttendanceStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { del, get, patch, put, type Character, type GroupRole, type Member } from "../api";
import { ROLE_LABEL } from "../pages/GroupsPage";
import { Portrait } from "./ImageUpload";
import { PlayerSheet } from "./PlayerSheet";
import { RowMenu } from "./RowMenu";

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
/** « 9 nov. », avec l'année si ce n'est pas celle-ci (« 9 nov. 2025 ») : dates courtes (refonte du 09/11). */
const DAY_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const shortDate = (iso: string) => { const d = new Date(iso); return (d.getFullYear() === new Date().getFullYear() ? DAY_MONTH : DAY_MONTH_YEAR).format(d); };
const RANK: Record<GroupRole, number> = { member: 0, officer: 1, owner: 2 };

/**
 * Le propriétaire nomme et rétrograde les officiers et transfère la guilde ; on retire un membre de rang inférieur ; les officiers
 * et le propriétaire nomment les banquiers (guildes Forever : un membre, ou quelqu'un resté banquier après un changement de rang).
 */
export const siteRights = (myRole: GroupRole, myId: string | undefined, m: Pick<Member, "userId" | "role" | "banker">) => ({
  role: myRole === "owner" && m.userId !== myId,
  remove: m.userId !== myId && RANK[myRole] > RANK[m.role],
  banker: RANK[myRole] >= 1 && (m.role === "member" || m.banker),
});

/**
 * Comptes de la guilde du site (onglet Membres de Roster ; sur Forever, sous la liste du jeu) : main, rôle, présence,
 * fiche du joueur, rôles du site et retrait. `only` : seulement ces comptes. `bankers` (guildes Forever) : le rôle « Banquier »,
 * qui traite les demandes de retrait de la banque, se voit et se donne depuis le menu « … ».
 */
export function SiteMembers({ groupId, members, myRole, myId, guard, only, hint, bankers }: {
  groupId: string; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard; only?: ReadonlySet<string>; hint?: string; bankers?: boolean;
}) {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["guild", groupId] })]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; action: "owner" | "remove" } | null>(null);
  // Main de chaque joueur dans la guilde (à la place de Battle.net, presque toujours vide)
  const charsQ = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[] }>(`/groups/${groupId}/characters`) });
  const mainOf = new Map((charsQ.data?.characters ?? []).filter(c => c.isMain).map(c => [c.userId, c]));
  // Présence sur les derniers raids relevés (lot F) : un raid compte si l'un de ses persos y était (banc compris)
  const attQ = useQuery({ queryKey: ["attendance", groupId], queryFn: () => get<{ raids: { id: string }[]; characters: { userId: string; cells: (AttendanceStatus | null)[] }[] }>(`/groups/${groupId}/attendance`) });
  const nRaids = attQ.data?.raids.length ?? 0;
  const presence = (userId: string) => {
    const mine = (attQ.data?.characters ?? []).filter(c => c.userId === userId);
    return Array.from({ length: nRaids }, (_, i) => mine.some(c => { const s = c.cells[i]; return !!s && ATTENDED.includes(s); })).filter(Boolean).length;
  };
  const setRole = (m: Member, role: GroupRole) => guard(async () => { await patch(`/groups/${groupId}/members/${m.userId}`, { role }); setConfirm(null); await refresh(); });
  const remove = (m: Member) => guard(async () => { await del(`/groups/${groupId}/members/${m.userId}`); setConfirm(null); await refresh(); });
  const setBanker = (m: Member, banker: boolean) => guard(async () => { await put(`/groups/${groupId}/members/${m.userId}/banker`, { banker }); await refresh(); });
  const list = only ? members.filter(m => only.has(m.userId)) : members;
  return (
    <div className="stack">
    {hint && <p className="hint" style={{ margin: 0 }}>{hint}</p>}
    <div className="tscroll"><table className="data mb-table">
      <thead><tr><th>Joueur</th><th>Main</th><th>Rôle</th><th title={nRaids ? `Sur les ${nRaids} derniers raids relevés par l'addon` : undefined}>Présence</th><th>Depuis</th><th /></tr></thead>
      <tbody>{list.map(m => {
        const main = mainOf.get(m.userId);
        const rights = siteRights(myRole, myId, m);
        const can = { ...rights, banker: !!bankers && rights.banker };
        const asking = confirm?.userId === m.userId ? confirm.action : null;
        return (
        <tr key={m.userId} className={[sheet === m.userId ? "ps-sel" : "", m.userId === myId ? "me" : ""].filter(Boolean).join(" ") || undefined}>
          <td><span className="with-icon" style={{ gap: 8 }}><span className="avatar" style={{ width: 26, height: 26 }}><Portrait id={m.avatarId} size={26} fallback={<span className="small">{m.displayName[0]}</span>} /></span>
            <button type="button" className="ps-link stretch" aria-expanded={sheet === m.userId} onClick={() => setSheet(s => (s === m.userId ? null : m.userId))}>{m.displayName}</button>{m.userId === myId && <span className="tag gold">Toi</span>}</span></td>
          <td>{main ? <b style={{ color: classColor(main.cls) }}>{main.name}</b> : <span className="muted">—</span>}</td>
          <td>{m.role === "member" ? (bankers && m.banker ? <span className="tag">Banquier</span> : <span className="muted">{ROLE_LABEL[m.role]}</span>) : <span className={`tag ${m.role === "owner" ? "gold" : ""}`}>{ROLE_LABEL[m.role]}</span>}</td>
          <td className="nowrap">{nRaids ? (() => { const n = presence(m.userId), pct = Math.round(n / nRaids * 100); return <><span className="rl-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} className={pct < 50 ? "low" : ""} /></span><span className="num small">{n}/{nRaids}</span></>; })() : <span className="muted">—</span>}</td>
          <td className="nowrap" title={new Date(m.joinedAt).toLocaleString("fr-FR")}>{shortDate(m.joinedAt)}</td>
          <td className="mb-act">
            {asking === "owner" && <span className="row small">Lui donner la guilde ? Tu deviens officier. <button type="button" className="btn danger sm" onClick={() => void setRole(m, "owner")}>Transférer</button><button type="button" className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button></span>}
            {asking === "remove" && <span className="row small">Retirer {m.displayName} ? <button type="button" className="btn danger sm" onClick={() => void remove(m)}>Retirer</button><button type="button" className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button></span>}
            {!asking && (can.role || can.remove || can.banker) && (
              <RowMenu label={`Actions pour ${m.displayName}`}>{close => <>
                {can.role && m.role === "member" && <button type="button" role="menuitem" onClick={() => { close(); void setRole(m, "officer"); }}>Nommer officier</button>}
                {can.role && m.role === "officer" && <button type="button" role="menuitem" onClick={() => { close(); void setRole(m, "member"); }}>Repasser membre</button>}
                {can.banker && <button type="button" role="menuitem" onClick={() => { close(); void setBanker(m, !m.banker); }}>{m.banker ? "Retirer banquier" : "Nommer banquier"}</button>}
                {can.role && <button type="button" role="menuitem" onClick={() => { close(); setConfirm({ userId: m.userId, action: "owner" }); }}>Transférer la propriété…</button>}
                {can.remove && <button type="button" role="menuitem" className="bad" onClick={() => { close(); setConfirm({ userId: m.userId, action: "remove" }); }}>Retirer de la guilde…</button>}
              </>}</RowMenu>
            )}
          </td>
        </tr>
        );
      })}</tbody>
    </table></div>
    {sheet && <PlayerSheet key={sheet} groupId={groupId} userId={sheet} officer={myRole !== "member"} onClose={() => setSheet(null)} />}
    </div>
  );
}
