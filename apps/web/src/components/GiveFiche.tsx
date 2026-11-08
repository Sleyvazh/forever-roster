import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, get, post, type GroupDetail, type Member } from "../api";
import { useGameText } from "../gameText";
import { shortDay } from "../guild";
import { DialogHead, Modal } from "./Dialog";
import { Portrait } from "./ImageUpload";

/**
 * « Donner la fiche à… » (Forever, 8/11) : la fiche passe sur le compte d'un autre membre de la guilde où elle est rangée
 * (POST /groups/:id/characters/:cid/give). Le dialogue liste ses inscriptions à venir, qui la suivent (GET …/give).
 */

const ROLE: Record<Member["role"], string> = { owner: "Propriétaire", officer: "Officier", member: "Membre" };
interface Upcoming { kind: "raid" | "outing"; id: string; name: string; at: string | null }

export function GiveFicheDialog({ groupId, groupName, c, members, onClose, closeOnDone }: {
  groupId: string; groupName: string;
  c: { id: string; name: string; cls: string; level: number; userId: string; owner?: string | null; isMain?: boolean };
  /** Membres de la guilde du site (lus ici s'ils ne sont pas donnés). */
  members?: Member[];
  onClose: () => void;
  /** Mes persos : la fiche quitte la liste, le dialogue se ferme sans récapitulatif. */
  closeOnDone?: boolean;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const groupQ = useQuery({ queryKey: ["group", groupId], queryFn: () => get<GroupDetail>(`/groups/${groupId}`), enabled: !members });
  const preview = useQuery({ queryKey: ["give", groupId, c.id], queryFn: () => get<{ upcoming: Upcoming[] }>(`/groups/${groupId}/characters/${c.id}/give`) });
  const list = (members ?? groupQ.data?.members ?? []).filter(m => m.userId !== c.userId);
  const [q, setQ] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ to: string; moved: string[]; dropped: string[] } | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = list.filter(m => !needle || m.displayName.toLowerCase().includes(needle)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const chosen = list.find(m => m.userId === to) ?? null;
  const up = preview.data?.upcoming ?? [];
  const when = (u: Upcoming) => (u.at ? ` (${shortDay(u.at)})` : "");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!to) return;
    setBusy(true); setErr(null);
    try {
      const r = await post<{ to: string; moved: string[]; dropped: string[] }>(`/groups/${groupId}/characters/${c.id}/give`, { to });
      // La fiche change de compte : persos, guilde, raids et sorties sont à relire partout
      if (closeOnDone) { onClose(); void qc.invalidateQueries({ predicate: x => x.queryKey[0] !== "give" }); return; }
      await qc.invalidateQueries({ predicate: x => x.queryKey[0] !== "give" });
      setDone(r);
    } catch (x) { setErr(x instanceof ApiError ? x.message : "Don impossible."); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal label="gf-t" onClose={onClose}>
        <div className="gd-body">
          <DialogHead id="gf-t" title={<>{c.name} est à {done.to}</>} onClose={onClose} />
          <p style={{ margin: 0 }}>La fiche est dans ses persos, rangée dans {groupName}.
            {done.moved.length > 0 && <> Inscriptions passées avec elle : {done.moved.join(", ")}.</>}
            {done.dropped.length > 0 && <> {done.to} était déjà inscrit à {done.dropped.join(", ")} : son inscription est gardée.</>}</p>
          <div className="row sg-actions"><button type="button" className="btn primary" onClick={onClose}>Fermer</button></div>
        </div>
      </Modal>
    );
  }
  const sub = `${c.cls ? `${gt.cls(c.cls)} ` : "Niveau "}${c.level}${c.owner ? ` · ${c.isMain ? "main" : "alt"} de ${c.owner}` : ""} dans ${groupName}`;
  return (
    <Modal label="gf-t" onClose={onClose}>
      <form onSubmit={e => void submit(e)}>
        <DialogHead id="gf-t" title={<>Donner {c.name} à…</>} sub={<span>{sub}</span>} onClose={onClose} />
        <input type="search" placeholder="Chercher un membre…" aria-label="Chercher un membre" value={q} onChange={e => setQ(e.target.value)} />
        <ul className="gd-list" aria-label="Membres de la guilde">
          {shown.map(m => (
            <li key={m.userId}><label className="gd-opt">
              <input type="radio" name="gf-to" value={m.userId} checked={to === m.userId} onChange={() => setTo(m.userId)} />
              <span className="avatar" style={{ width: 22, height: 22 }}><Portrait id={m.avatarId} size={22} fallback={<span style={{ fontSize: 11 }}>{m.displayName[0]}</span>} /></span>
              <span className="t"><span className="nm"><b>{m.displayName}</b></span><small>{ROLE[m.role]}</small></span>
            </label></li>
          ))}
          {!shown.length && <li className="muted small">{list.length ? "Personne ne correspond." : "Personne d'autre dans la guilde."}</li>}
        </ul>
        <p className="hint" style={{ margin: 0 }}>
          La fiche passe sur le compte de {chosen?.displayName ?? "ce membre"}, rangée dans {groupName} (son main s'il n'en a pas).{" "}
          {up.length ? <>Ses inscriptions à venir la suivent : {up.map(u => `${u.name}${when(u)}`).join(", ")} ; si {chosen?.displayName ?? "il"} y est déjà inscrit, son inscription à lui est gardée.</> : "Elle n'a pas d'inscription à venir."}{" "}
          Présence et butin passés restent sur la fiche. Noté au journal de la guilde.
        </p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!to || busy}>{chosen ? `Donner ${c.name} à ${chosen.displayName}` : "Donner"}</button>
        </div>
      </form>
    </Modal>
  );
}
