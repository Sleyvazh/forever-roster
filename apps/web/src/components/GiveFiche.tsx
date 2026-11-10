import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, get, post, type GroupDetail, type Member } from "../api";
import { useGameText } from "../gameText";
import { shortDay } from "../guild";
import { DialogHead, Modal } from "./Dialog";
import { Portrait } from "./ImageUpload";
import { t } from "../i18n";
import { roleLabel } from "../pages/GroupsPage";

/**
 * « Donner la fiche à… » (Forever, 8/11) : la fiche passe sur le compte d'un autre membre de la guilde où elle est rangée
 * (POST /groups/:id/characters/:cid/give). Le dialogue liste ses inscriptions à venir, qui la suivent (GET …/give).
 */

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
    } catch (x) { setErr(x instanceof ApiError ? x.message : t("Don impossible.")); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <Modal label="gf-t" onClose={onClose}>
        <div className="gd-body">
          <DialogHead id="gf-t" title={t("{name} est à {to}", { name: c.name, to: done.to })} onClose={onClose} />
          <p style={{ margin: 0 }}>{t("La fiche est dans ses persos, rangée dans {guild}.", { guild: groupName })}
            {done.moved.length > 0 && <> {t("Inscriptions passées avec elle : {list}.", { list: done.moved.join(", ") })}</>}
            {done.dropped.length > 0 && <> {t("{name} était déjà inscrit à {list} : son inscription est gardée.", { name: done.to, list: done.dropped.join(", ") })}</>}</p>
          <div className="row sg-actions"><button type="button" className="btn primary" onClick={onClose}>{t("Fermer")}</button></div>
        </div>
      </Modal>
    );
  }
  const what = c.cls ? `${gt.cls(c.cls)} ${c.level}` : t("Niveau {n}", { n: c.level });
  const sub = c.owner ? (c.isMain ? t("{what} · main de {owner} dans {guild}", { what, owner: c.owner, guild: groupName }) : t("{what} · alt de {owner} dans {guild}", { what, owner: c.owner, guild: groupName }))
    : t("{what} dans {guild}", { what, guild: groupName });
  return (
    <Modal label="gf-t" onClose={onClose}>
      <form onSubmit={e => void submit(e)}>
        <DialogHead id="gf-t" title={t("Donner {name} à…", { name: c.name })} sub={<span>{sub}</span>} onClose={onClose} />
        <input type="search" placeholder={t("Chercher un membre…")} aria-label={t("Chercher un membre")} value={q} onChange={e => setQ(e.target.value)} />
        <ul className="gd-list" aria-label={t("Membres de la guilde")}>
          {shown.map(m => (
            <li key={m.userId}><label className="gd-opt">
              <input type="radio" name="gf-to" value={m.userId} checked={to === m.userId} onChange={() => setTo(m.userId)} />
              <span className="avatar" style={{ width: 22, height: 22 }}><Portrait id={m.avatarId} size={22} fallback={<span style={{ fontSize: 11 }}>{m.displayName[0]}</span>} /></span>
              <span className="t"><span className="nm"><b>{m.displayName}</b></span><small>{roleLabel(m.role)}</small></span>
            </label></li>
          ))}
          {!shown.length && <li className="muted small">{list.length ? t("Personne ne correspond.") : t("Personne d'autre dans la guilde.")}</li>}
        </ul>
        <p className="hint" style={{ margin: 0 }}>
          {chosen ? t("La fiche passe sur le compte de {name}, rangée dans {guild} (son main s'il n'en a pas).", { name: chosen.displayName, guild: groupName })
            : t("La fiche passe sur le compte de ce membre, rangée dans {guild} (son main s'il n'en a pas).", { guild: groupName })}{" "}
          {up.length ? (chosen
            ? t("Ses inscriptions à venir la suivent : {list} ; si {name} y est déjà inscrit, son inscription à lui est gardée.", { list: up.map(u => `${u.name}${when(u)}`).join(", "), name: chosen.displayName })
            : t("Ses inscriptions à venir la suivent : {list} ; s'il y est déjà inscrit, son inscription à lui est gardée.", { list: up.map(u => `${u.name}${when(u)}`).join(", ") }))
            : t("Elle n'a pas d'inscription à venir.")}{" "}
          {t("Présence et butin passés restent sur la fiche. Noté au journal de la guilde.")}
        </p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={!to || busy}>{chosen ? t("Donner {name} à {to}", { name: c.name, to: chosen.displayName }) : t("Donner")}</button>
        </div>
      </form>
    </Modal>
  );
}
