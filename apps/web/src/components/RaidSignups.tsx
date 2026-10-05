import { CLASS_SPECS, SIGNUP_HINT, SIGNUP_LABEL, SIGNUP_STATUSES, type SignupStatus, type SpecDef } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, del, get, patch, put, type Character, type RaidSignup } from "../api";
import { useMe } from "../auth";
import { ClassIcon, SpecIcon } from "./Icons";

const ROLES = ["Tank", "Heal", "DPS"] as const;
const COMING: SignupStatus[] = ["present", "late"];

/** Bloc « Inscriptions » d'un raid : mon inscription en un clic, puis la liste des inscrits par rôle. */
export function RaidSignups({ groupId, raidId, signups, groupChars, canEdit }: {
  groupId: string; raidId: string; signups: RaidSignup[]; groupChars: Character[]; canEdit: boolean;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const myId = me.data?.user?.id;
  const mine = signups.find(s => s.mine);
  // Mes persos joués dans le groupe (main en tête) ; s'il n'y en a aucun, tous mes persos (s'inscrire l'ajoute au groupe)
  const allMine = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const here = groupChars.filter(c => c.userId === myId && c.cls).sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
  const myChars = here.length ? here : (allMine.data?.characters ?? []).filter(c => c.cls);

  const [charId, setCharId] = useState<string>("");
  const [spec, setSpec] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reprend mon inscription existante, sinon mon premier perso
  useEffect(() => {
    const c = (mine?.characterId && myChars.find(x => x.id === mine.characterId)) || myChars[0];
    setCharId(c?.id ?? "");
    setSpec(mine?.characterId === c?.id && mine?.spec ? mine.spec : c?.spec1 ?? "");
    setNote(mine?.note ?? "");
  }, [mine?.id, myChars.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const char = myChars.find(c => c.id === charId);
  const specs: SpecDef[] = char ? (CLASS_SPECS as Record<string, SpecDef[]>)[char.cls] ?? [] : [];
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raid", raidId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); } finally { setBusy(false); }
  };
  const signUp = (status: SignupStatus) => run(() => put(`/groups/${groupId}/raids/${raidId}/signup`, {
    status, characterId: status === "absent" && !charId ? null : charId || null, spec: spec || undefined, note,
  }));

  const coming = signups.filter(s => COMING.includes(s.status));
  const others = (st: SignupStatus) => signups.filter(s => s.status === st);
  const byRole = (r: string) => coming.filter(s => s.role === r);
  const noRole = coming.filter(s => !s.role);

  return (
    <section className="panel pad stack" aria-labelledby="su-title">
      <div className="row between">
        <h3 id="su-title" style={{ margin: 0 }}>Inscriptions</h3>
        <div className="counts">
          <span className="tag ok num">{coming.length} viennent</span>
          {ROLES.map(r => <span key={r} className={`role ${r}`}>{byRole(r).length} {r}</span>)}
          {others("tentative").length > 0 && <span className="tag num">{others("tentative").length} peut-être</span>}
        </div>
      </div>

      <div className="su-me">
        {myChars.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>Ajoute un perso (avec sa classe) dans « Mes persos » pour t'inscrire. Tu peux quand même te déclarer absent.</p>
        ) : (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="fld" style={{ flex: "1 1 180px" }}><label htmlFor="su-char">Perso</label>
              <select id="su-char" value={charId} onChange={e => { setCharId(e.target.value); setSpec(myChars.find(c => c.id === e.target.value)?.spec1 ?? ""); }}>
                {myChars.map(c => <option key={c.id} value={c.id}>{c.isMain ? "★ " : ""}{c.name} ({c.cls})</option>)}
              </select>
            </div>
            <div className="fld" style={{ flex: "1 1 150px" }}><label htmlFor="su-spec">Spé pour ce raid</label>
              <select id="su-spec" value={spec} onChange={e => setSpec(e.target.value)}>
                <option value="">—</option>
                {specs.map(d => <option key={d.name} value={d.name}>{d.name} ({d.role})</option>)}
              </select>
            </div>
            <div className="fld" style={{ flex: "2 1 200px" }}><label htmlFor="su-note">Note (facultatif)</label>
              <input id="su-note" type="text" maxLength={100} placeholder="Ex. j'arrive vers 21 h 15" value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
        )}
        <div className="su-status" role="group" aria-label="Mon statut">
          {SIGNUP_STATUSES.map(st => (
            <button key={st} type="button" className={`su-btn ${st}`} aria-pressed={mine?.status === st} title={SIGNUP_HINT[st]}
              disabled={busy || (st !== "absent" && myChars.length === 0)} onClick={() => void signUp(st)}>
              {SIGNUP_LABEL[st]}
            </button>
          ))}
          {mine && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void run(() => del(`/groups/${groupId}/raids/${raidId}/signup`))}>Me désinscrire</button>}
        </div>
        {mine && <p className="small muted" style={{ margin: 0 }}>Tu es inscrit : <b>{SIGNUP_LABEL[mine.status]}</b>{mine.characterName ? ` avec ${mine.characterName}${mine.spec ? ` (${mine.spec})` : ""}` : ""}. Clique un autre statut pour changer.</p>}
        {error && <div className="alert error" role="alert">{error}</div>}
      </div>

      <div className="su-roles">
        {ROLES.map(r => (
          <div key={r} className="su-col">
            <h4><span className={`role ${r}`}>{r}</span> <span className="num muted">{byRole(r).length}</span></h4>
            {byRole(r).length ? byRole(r).map(s => <Row key={s.id} s={s} canEdit={canEdit} groupId={groupId} raidId={raidId} onDone={refresh} />) : <p className="small muted" style={{ margin: 0 }}>Personne</p>}
          </div>
        ))}
      </div>
      {noRole.length > 0 && <Group title="Sans spé" list={noRole} canEdit={canEdit} groupId={groupId} raidId={raidId} onDone={refresh} />}
      {(["tentative", "alt", "bench", "absent"] as SignupStatus[]).map(st => others(st).length > 0 && (
        <Group key={st} title={SIGNUP_LABEL[st]} list={others(st)} canEdit={canEdit} groupId={groupId} raidId={raidId} onDone={refresh} compact={st === "absent"} />
      ))}
    </section>
  );
}

function Group({ title, list, compact, ...rest }: { title: string; list: RaidSignup[]; compact?: boolean; canEdit: boolean; groupId: string; raidId: string; onDone: () => Promise<unknown> }) {
  return (
    <div className="su-group">
      <h4>{title} <span className="num muted">{list.length}</span></h4>
      <div className={compact ? "su-inline" : "su-list"}>{list.map(s => <Row key={s.id} s={s} compact={compact} {...rest} />)}</div>
    </div>
  );
}

function Row({ s, canEdit, groupId, raidId, onDone, compact }: { s: RaidSignup; canEdit: boolean; groupId: string; raidId: string; onDone: () => Promise<unknown>; compact?: boolean }) {
  const base = `/groups/${groupId}/raids/${raidId}/signups/${s.id}`;
  return (
    <div className={`su-row${s.mine ? " mine" : ""}`} title={s.note || undefined}>
      {s.cls ? (s.spec ? <SpecIcon cls={s.cls} spec={s.spec} size={20} /> : <ClassIcon cls={s.cls} size={20} />) : <span className="su-dot" aria-hidden="true" />}
      <span className="su-who">
        <b>{s.characterName ?? s.displayName}{!s.userId && <span className="su-guest" title="Inscrit depuis Discord, sans compte sur le site" aria-label=" (sans compte)"> ✱</span>}</b>
        {!compact && <small>{[s.spec, s.characterName ? s.displayName : null, !s.userId ? "Discord" : null].filter(Boolean).join(" · ")}</small>}
      </span>
      {s.status === "late" && <span className="tag warn">Retard</span>}
      {s.note && !compact && <span className="su-note" aria-label={`Note : ${s.note}`}>✎</span>}
      {canEdit && !compact && (
        <span className="su-admin">
          <select aria-label={`Statut de ${s.displayName}`} value={s.status} onChange={e => void patch(base, { status: e.target.value }).then(onDone)}>
            {SIGNUP_STATUSES.map(st => <option key={st} value={st}>{SIGNUP_LABEL[st]}</option>)}
          </select>
          <button type="button" className="x" aria-label={`Retirer l'inscription de ${s.displayName}`} onClick={() => void del(base).then(onDone)}>×</button>
        </span>
      )}
    </div>
  );
}
