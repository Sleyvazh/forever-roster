import { CLASSES, RACES, SIGNUP_LABEL, SKILL_LINE_NAMES, type ClassName, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, patch, post, type Character, type CraftersRecipe, type GroupRole, type Member } from "../api";
import { useMe } from "../auth";
import { CharacterEditor } from "../components/CharacterEditor";
import { CRAFTING } from "../components/GameData";
import { Portrait } from "../components/ImageUpload";
import { ROLE_LABEL } from "./GroupsPage";

interface GroupDetail { group: { id: string; name: string }; role: GroupRole; members: Member[] }
interface Invite { id: string; maxUses: number; uses: number; expiresAt: string; createdAt: string }
interface RaidSummary { id: string; name: string; scheduledAt: string | null; filled: number; signups: Partial<Record<SignupStatus, number>>; mySignup: SignupStatus | null }
interface GroupEvent { id: number; type: string; actor: string | null; meta: Record<string, unknown>; createdAt: string }

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const EVENT_LABEL: Record<string, string> = {
  group_created: "a créé le groupe", group_renamed: "a renommé le groupe", group_joined: "a rejoint le groupe", group_left: "a quitté le groupe",
  group_member_removed: "a retiré un membre", group_role_changed: "a changé un rôle", invite_created: "a créé une invitation",
  invite_revoked: "a révoqué une invitation", raid_created: "a créé un raid", raid_deleted: "a supprimé un raid",
};

export function GroupPage() {
  const { groupId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const myId = me.data?.user?.id;
  const [tab, setTab] = useState<"raids" | "members" | "characters" | "crafters" | "journal">("raids");
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ["group", groupId], queryFn: () => get<GroupDetail>(`/groups/${groupId}`) });
  const isOfficer = detail.data && detail.data.role !== "member";
  const isOwner = detail.data?.role === "owner";

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
  };

  if (detail.isLoading) return <p className="muted">Chargement…</p>;
  if (detail.error || !detail.data) return <div className="panel empty"><h2>Groupe introuvable</h2><Link to="/groups">Retour aux groupes</Link></div>;
  const { group, role, members } = detail.data;

  const tabs: [typeof tab, string][] = [["raids", "Raids"], ["members", `Membres (${members.length})`], ["characters", "Personnages"], ["crafters", "Artisans"], ...(isOfficer ? [["journal", "Journal"] as [typeof tab, string]] : [])];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div className="eyebrow"><Link to="/groups">Groupes</Link> · {ROLE_LABEL[role]}</div>
          {isOfficer
            ? <GroupName key={group.name} name={group.name} onSave={name => guard(async () => {
                await patch(`/groups/${groupId}`, { name });
                await Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["group-audit", groupId] })]);
              })} />
            : <h1>{group.name}</h1>}
        </div>
        <div className="row">
          {role !== "owner" && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/members/${myId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); })}>Quitter le groupe</button>}
          {isOwner && <DeleteGroup onDelete={() => guard(async () => { await del(`/groups/${groupId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); })} />}
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="panel lift">
        <div className="tabs" role="tablist">
          {tabs.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="pane">
          {tab === "raids" && <Raids groupId={groupId} canEdit={!!isOfficer} guard={guard} />}
          {tab === "members" && <Members groupId={groupId} members={members} myRole={role} myId={myId} guard={guard} />}
          {tab === "characters" && <GroupCharacters groupId={groupId} />}
          {tab === "crafters" && <Crafters groupId={groupId} />}
          {tab === "journal" && <Journal groupId={groupId} />}
        </div>
      </div>
      {isOfficer && <Invites groupId={groupId} guard={guard} />}
    </div>
  );
}

/** Titre du groupe, modifiable sur place par les officiers et le propriétaire. */
function GroupName({ name, onSave }: { name: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const cancel = () => { setValue(name); setEditing(false); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (next === name) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(next); } finally { setSaving(false); }
  };
  if (!editing) return (
    <div className="row" style={{ alignItems: "baseline" }}>
      <h1>{name}</h1>
      <button className="btn ghost sm" type="button" onClick={() => setEditing(true)}>Renommer</button>
    </div>
  );
  return (
    <form className="row" onSubmit={e => void submit(e)} style={{ alignItems: "flex-end", marginTop: 6 }}>
      <div className="fld" style={{ flex: "1 1 240px" }}>
        <label htmlFor="g-name">Nom du groupe</label>
        <input id="g-name" type="text" required minLength={2} maxLength={48} autoFocus value={value}
          onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Escape") cancel(); }} />
      </div>
      <button className="btn primary sm" type="submit" disabled={saving || value.trim().length < 2}>Enregistrer</button>
      <button className="btn ghost sm" type="button" onClick={cancel}>Annuler</button>
    </form>
  );
}

function DeleteGroup({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm
    ? <span className="row small">Supprimer le groupe, ses raids et ses invitations ? <button className="btn danger sm" type="button" onClick={onDelete}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirm(false)}>Annuler</button></span>
    : <button className="btn ghost sm" type="button" onClick={() => setConfirm(true)}>Supprimer le groupe</button>;
}

type Guard = (fn: () => Promise<unknown>) => Promise<void>;

function Raids({ groupId, canEdit, guard }: { groupId: string; canEdit: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ["raids", groupId], queryFn: () => get<{ raids: RaidSummary[] }>(`/groups/${groupId}/raids`) });
  const [name, setName] = useState(""), [when, setWhen] = useState("");
  const create = (e: FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const r = await post<{ raid: { id: string } }>(`/groups/${groupId}/raids`, { name, scheduledAt: when ? new Date(when).toISOString() : null });
      await qc.invalidateQueries({ queryKey: ["raids", groupId] });
      nav(`/groups/${groupId}/raids/${r.raid.id}`);
    });
  };
  return (
    <div className="sec">
      {canEdit && (
        <form className="row" onSubmit={create} style={{ alignItems: "flex-end" }}>
          <div className="fld" style={{ flex: "2 1 200px" }}><label htmlFor="r-name">Nouveau raid</label><input id="r-name" type="text" required minLength={2} maxLength={60} placeholder="Molten Core" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld" style={{ flex: "1 1 200px" }}><label htmlFor="r-when">Date</label><input id="r-when" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></div>
          <button className="btn primary" type="submit">Créer</button>
        </form>
      )}
      {!data?.raids.length ? <p className="muted">Aucun raid prévu.</p> : (
        <div className="tscroll"><table className="data">
          <thead><tr><th>Raid</th><th>Date</th><th>Inscrits</th><th>Moi</th><th>Places</th></tr></thead>
          <tbody>{data.raids.map(r => {
            const coming = (r.signups.present ?? 0) + (r.signups.late ?? 0);
            return (
              <tr key={r.id}>
                <td><Link to={`/groups/${groupId}/raids/${r.id}`}>{r.name}</Link></td>
                <td>{r.scheduledAt ? fmt.format(new Date(r.scheduledAt)) : <span className="muted">À définir</span>}</td>
                <td className="small"><span className="num">{coming}</span> viennent{r.signups.tentative ? <span className="muted"> · {r.signups.tentative} peut-être</span> : null}{r.signups.absent ? <span className="muted"> · {r.signups.absent} absent{r.signups.absent > 1 ? "s" : ""}</span> : null}</td>
                <td>{r.mySignup ? <span className={`tag su-tag ${r.mySignup}`}>{SIGNUP_LABEL[r.mySignup]}</span> : <Link className="small" to={`/groups/${groupId}/raids/${r.id}`}>S'inscrire</Link>}</td>
                <td className="num">{r.filled}/40</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Members({ groupId, members, myRole, myId, guard }: { groupId: string; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", groupId] });
  const rank = { member: 0, officer: 1, owner: 2 };
  return (
    <div className="tscroll"><table className="data">
      <thead><tr><th>Joueur</th><th>Battle.net</th><th>Rôle</th><th>Depuis</th><th /></tr></thead>
      <tbody>{members.map(m => (
        <tr key={m.userId}>
          <td><span className="with-icon" style={{ gap: 8 }}><span className="avatar" style={{ width: 26, height: 26 }}><Portrait id={m.avatarId} size={26} fallback={<span className="small">{m.displayName[0]}</span>} /></span>{m.displayName}{m.userId === myId && <span className="tag gold">Toi</span>}</span></td>
          <td className="muted">{m.battletag ?? "—"}</td>
          <td>
            {myRole === "owner" && m.userId !== myId ? (
              <select aria-label={`Rôle de ${m.displayName}`} value={m.role} style={{ width: "auto" }}
                onChange={e => void guard(async () => { await patch(`/groups/${groupId}/members/${m.userId}`, { role: e.target.value }); await refresh(); })}>
                <option value="member">Membre</option><option value="officer">Officier</option><option value="owner">Propriétaire (transfert)</option>
              </select>
            ) : ROLE_LABEL[m.role]}
          </td>
          <td className="muted small">{fmt.format(new Date(m.joinedAt))}</td>
          <td>{m.userId !== myId && rank[myRole] > rank[m.role] && (
            <button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/members/${m.userId}`); await refresh(); })}>Retirer</button>
          )}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function GroupCharacters({ groupId }: { groupId: string }) {
  const { data } = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[] }>(`/groups/${groupId}/characters`) });
  const [open, setOpen] = useState<string | null>(null);
  const opened = data?.characters.find(c => c.id === open);
  if (!data) return <p className="muted">Chargement…</p>;
  if (!data.characters.length) return <p className="muted">Les membres n'ont pas encore de personnages.</p>;
  return (
    <div className="stack">
      <div className="tscroll"><table className="data">
        <thead><tr><th>Perso</th><th>Joueur</th><th>Niv.</th><th>Race / classe</th><th>Spés</th><th>Métiers</th></tr></thead>
        <tbody>{data.characters.map(c => {
          const cl = CLASSES[c.cls as ClassName];
          return (
            <tr key={c.id}>
              <td><button type="button" className="btn ghost sm" style={{ borderColor: cl?.color }} onClick={() => setOpen(o => o === c.id ? null : c.id)}>{c.name}</button></td>
              <td>{c.owner}</td>
              <td className="num">{c.level}</td>
              <td>{c.race} <span style={{ color: cl?.color }}>{c.cls}</span> {RACES[c.race] && <span className={`fac ${RACES[c.race]!.faction}`}>{RACES[c.race]!.faction === "Alliance" ? "A" : "H"}</span>}</td>
              <td>{[c.spec1, c.spec2].filter(Boolean).join(" / ")}</td>
              <td className="small">{[c.professions.prof1, c.professions.prof2].filter(p => p.name).map(p => `${p.name} ${p.skill}`).join(" · ")}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {opened && <CharacterEditor character={opened} editable={false} onChange={() => {}} />}
    </div>
  );
}

/** « Qui crafte quoi ? » : les patrons connus et recherchés par les persos du groupe. */
function Crafters({ groupId }: { groupId: string }) {
  const [input, setInput] = useState(""), [q, setQ] = useState(""), [prof, setProf] = useState("");
  useEffect(() => { const t = window.setTimeout(() => setQ(input.trim()), 300); return () => window.clearTimeout(t); }, [input]);
  const params = new URLSearchParams({ ...(q.length >= 2 && { q }), ...(prof && { profession: prof }) });
  const { data, isLoading } = useQuery({
    queryKey: ["crafters", groupId, q, prof],
    queryFn: () => get<{ recipes: CraftersRecipe[]; total: number }>(`/groups/${groupId}/crafters?${params}`),
  });
  const names = (list: { name: string; owner: string }[]) => list.map(w => `${w.name} (${w.owner})`).join(", ");
  return (
    <div className="sec">
      <p className="hint" style={{ margin: 0 }}>Retrouve qui sait fabriquer un objet pour lui envoyer les composants, et quels patrons les membres recherchent.</p>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="cr-q">Recette ou objet</label>
          <input id="cr-q" type="search" placeholder="Warbear Woolies, Flask…" value={input} onChange={e => setInput(e.target.value)} />
        </div>
        <div className="fld" style={{ flex: "1 1 160px" }}><label htmlFor="cr-p">Métier</label>
          <select id="cr-p" value={prof} onChange={e => setProf(e.target.value)}>
            <option value="">Tous</option>{[...CRAFTING].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? <p className="muted">Chargement…</p> : !data?.recipes.length ? (
        <p className="muted">{q || prof ? "Aucun membre n'a renseigné cette recette." : "Aucun patron renseigné pour l'instant. Chaque joueur les coche dans l'onglet Métiers de ses persos."}</p>
      ) : (
        <div className="tscroll"><table className="data">
          <thead><tr><th>Recette</th><th>Métier</th><th>Sait la faire</th><th>La recherche</th></tr></thead>
          <tbody>{data.recipes.map(r => (
            <tr key={r.spellId}>
              <td><span className={r.item ? `q${r.item.quality}` : ""}>{r.name}</span>{r.enchant && <span className="muted small"> · {r.enchant}</span>}</td>
              <td className="small">{SKILL_LINE_NAMES[r.skillLine] ?? "?"} <span className="muted num">{r.reqSkill}</span></td>
              <td>{r.known.length ? names(r.known) : <span className="muted">—</span>}</td>
              <td className="small">{r.wanted.length ? names(r.wanted) : <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && data.total > data.recipes.length && <p className="hint">{data.total} recettes : affine la recherche pour voir la suite.</p>}
    </div>
  );
}

function Journal({ groupId }: { groupId: string }) {
  const { data } = useQuery({ queryKey: ["group-audit", groupId], queryFn: () => get<{ events: GroupEvent[] }>(`/groups/${groupId}/audit`) });
  if (!data) return <p className="muted">Chargement…</p>;
  return (
    <div className="tscroll"><table className="data">
      <thead><tr><th>Date</th><th>Qui</th><th>Action</th></tr></thead>
      <tbody>{data.events.map(e => (
        <tr key={e.id}><td className="small muted">{fmt.format(new Date(e.createdAt))}</td><td>{e.actor ?? "Compte supprimé"}</td><td>{EVENT_LABEL[e.type] ?? e.type}{typeof e.meta.name === "string" ? ` · ${e.meta.name}` : ""}{e.type === "group_renamed" && typeof e.meta.from === "string" && typeof e.meta.to === "string" ? ` · ${e.meta.from} → ${e.meta.to}` : ""}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function Invites({ groupId, guard }: { groupId: string; guard: Guard }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["invites", groupId], queryFn: () => get<{ invites: Invite[] }>(`/groups/${groupId}/invites`) });
  const [maxUses, setMaxUses] = useState(5), [hours, setHours] = useState(72);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["invites", groupId] });

  return (
    <section className="panel pad stack">
      <h3>Invitations</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-uses">Utilisations max</label><input id="i-uses" className="num" type="number" min={1} max={100} value={maxUses} onChange={e => setMaxUses(Number(e.target.value) || 1)} /></div>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-h">Valable (heures)</label><input id="i-h" className="num" type="number" min={1} max={720} value={hours} onChange={e => setHours(Number(e.target.value) || 1)} /></div>
        <button className="btn primary" type="button" onClick={() => void guard(async () => {
          const r = await post<{ invite: { url: string } }>(`/groups/${groupId}/invites`, { maxUses, expiresInHours: hours });
          setLink(r.invite.url); setCopied(false); await refresh();
        })}>Créer un lien</button>
      </div>
      {link && (
        <div className="alert info stack" style={{ gap: 8 }}>
          <span>Copie ce lien maintenant : pour des raisons de sécurité, il ne sera plus affiché.</span>
          <div className="row"><input type="text" readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Lien d'invitation" style={{ flex: 1 }} />
            <button className="btn sm" type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier"}</button></div>
        </div>
      )}
      {!!data?.invites.length && (
        <div className="tscroll"><table className="data">
          <thead><tr><th>Créée</th><th>Utilisations</th><th>Expire</th><th /></tr></thead>
          <tbody>{data.invites.map(i => (
            <tr key={i.id}><td className="small">{fmt.format(new Date(i.createdAt))}</td><td className="num">{i.uses}/{i.maxUses}</td><td className="small">{fmt.format(new Date(i.expiresAt))}</td>
              <td><button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/invites/${i.id}`); await refresh(); })}>Révoquer</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
