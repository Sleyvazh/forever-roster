import { AttendanceTab } from "../components/RaidLog";
import { LOOT_MODE_LABEL, LOOT_MODES, RAID_SIZES, SIGNUP_LABEL, SKILL_LINE_NAMES, WEEKDAYS, type LootMode, type RaidSize, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, patch, post, put, type CraftersRecipe, type GroupRole, type Member } from "../api";
import { useMe } from "../auth";
import { CRAFTING } from "../components/GameData";
import { Portrait } from "../components/ImageUpload";
import { ItemHover, ItemIcon } from "../components/ItemTooltip";
import { NumberField } from "../components/NumberField";
import { GroupAddonExport } from "../components/GroupAddonExport";
import { GroupCharacters } from "../components/GroupRoster";
import { LootModePicker, LootSettingsPanel } from "../components/Loot";
import { PlayerSheet } from "../components/PlayerSheet";
import { ROLE_LABEL } from "./GroupsPage";

interface GroupDetail { group: { id: string; name: string; discordLinked: boolean }; role: GroupRole; members: Member[] }
interface Invite { id: string; maxUses: number; uses: number; expiresAt: string; createdAt: string }
interface RaidSummary { id: string; name: string; scheduledAt: string | null; filled: number; size: number; recurring: boolean; signups: Partial<Record<SignupStatus, number>>; mySignup: SignupStatus | null }
interface RaidTemplate { id: string; name: string; description: string; weekday: number; time: string; leadDays: number; active: boolean; generatedUntil: string | null; lootMode: LootMode; srHidden: boolean; size: RaidSize }
interface GroupEvent { id: number; type: string; actor: string | null; meta: Record<string, unknown>; createdAt: string }

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const EVENT_LABEL: Record<string, string> = {
  group_created: "a créé le groupe", group_renamed: "a renommé le groupe", group_joined: "a rejoint le groupe", group_left: "a quitté le groupe",
  group_member_removed: "a retiré un membre", group_role_changed: "a changé un rôle", invite_created: "a créé une invitation",
  invite_revoked: "a révoqué une invitation", raid_created: "a créé un raid", raid_deleted: "a supprimé un raid",
  raid_template_created: "a créé un raid récurrent", raid_template_updated: "a modifié un raid récurrent", raid_template_deleted: "a supprimé un raid récurrent",
  raid_roster_published: "a publié une compo sur Discord", raid_roster_unpublished: "a retiré une compo de Discord",
  group_discord_linked: "a lié un salon Discord", group_discord_unlinked: "a délié le salon Discord",
  group_character_changed: "a modifié les persos d'un membre", group_loot_settings: "a changé les réglages du butin",
  group_nudge_settings: "a changé les relances Discord", raid_nudged: "a relancé les sans-réponse", raid_ask_sent: "a demandé à un joueur de venir",
};

type GroupTab = "raids" | "members" | "characters" | "crafters" | "presence" | "admin";
const GROUP_TAB_SLUG: Record<GroupTab, string> = { raids: "raids", members: "membres", characters: "persos", crafters: "artisans", presence: "presence", admin: "admin" };

export function GroupPage() {
  const { groupId = "", tab: tabSlug } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const myId = me.data?.user?.id;
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

  const tabs: [GroupTab, string][] = [["raids", "Raids"], ["members", `Membres (${members.length})`], ["characters", "Personnages"], ["crafters", "Artisans"], ["presence", "Présence & butin"], ...(isOfficer ? [["admin", "Administration"] as [GroupTab, string]] : [])];
  // Onglet dans l'adresse (/groups/:id/artisans…) : retour arrière, lien direct à partager
  const wanted = (Object.entries(GROUP_TAB_SLUG).find(([, s]) => s === tabSlug)?.[0] as GroupTab | undefined) ?? "raids";
  const tab: GroupTab = tabs.some(([k]) => k === wanted) ? wanted : "raids";
  const setTab = (t: GroupTab) => nav(`/groups/${groupId}${t === "raids" ? "" : `/${GROUP_TAB_SLUG[t]}`}`);

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
          {tab === "characters" && <GroupCharacters groupId={groupId} groupName={group.name} members={members} myId={myId} myRole={role} />}
          {tab === "crafters" && <Crafters groupId={groupId} />}
          {tab === "presence" && <AttendanceTab groupId={groupId} />}
          {tab === "admin" && isOfficer && (
            <div className="admin">
              <Invites groupId={groupId} guard={guard} />
              <LootSettingsPanel groupId={groupId} />
              <DiscordChannel groupId={groupId} linked={group.discordLinked} hasDiscord={!!me.data?.user?.discordUsername} guard={guard} />
              <section className="stack admin-sec"><h3>Journal du groupe</h3><Journal groupId={groupId} /></section>
              {isOwner && (
                <section className="stack admin-sec danger-zone">
                  <h3>Zone sensible</h3>
                  <p className="hint" style={{ margin: 0 }}>Supprime définitivement le groupe, ses raids, ses invitations et la liaison Discord. Les persos des membres ne sont pas touchés.</p>
                  <div><DeleteGroup onDelete={() => guard(async () => { await del(`/groups/${groupId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); })} /></div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
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
  const [loot, setLoot] = useState<{ mode: LootMode; hidden: boolean }>({ mode: "journal", hidden: false });
  const [size, setSize] = useState<RaidSize>(40);
  const create = (e: FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const r = await post<{ raid: { id: string } }>(`/groups/${groupId}/raids`, { name, scheduledAt: when ? new Date(when).toISOString() : null, lootMode: loot.mode, srHidden: loot.hidden, size });
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
          <div className="fld" style={{ flex: "0 0 auto" }}><span className="lbl">Format</span>
            <div className="seg" role="group" aria-label="Format du raid">{RAID_SIZES.map(n => <button key={n} type="button" className={size === n ? "on" : ""} aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>)}</div></div>
          <button className="btn primary" type="submit">Créer</button>
          <div className="fld" style={{ flex: "1 1 100%" }}><span className="lbl">Butin</span>
            <LootModePicker mode={loot.mode} hidden={loot.hidden} idPrefix="new" onChange={(mode, hidden) => setLoot({ mode, hidden })} /></div>
        </form>
      )}
      {!data?.raids.length ? <p className="muted">Aucun raid prévu.</p> : (
        <div className="tscroll"><table className="data">
          <thead><tr><th>Raid</th><th>Date</th><th>Inscrits</th><th>Moi</th><th>Places</th></tr></thead>
          <tbody>{data.raids.map(r => {
            const coming = (r.signups.present ?? 0) + (r.signups.late ?? 0);
            return (
              <tr key={r.id}>
                <td><Link to={`/groups/${groupId}/raids/${r.id}`}>{r.name}</Link>{r.recurring && <span className="muted small" title="Créé par un raid récurrent"> ↻</span>}</td>
                <td>{r.scheduledAt ? fmt.format(new Date(r.scheduledAt)) : <span className="muted">À définir</span>}</td>
                <td className="small"><span className="num">{coming}</span> viennent{r.signups.tentative ? <span className="muted"> · {r.signups.tentative} peut-être</span> : null}{r.signups.absent ? <span className="muted"> · {r.signups.absent} absent{r.signups.absent > 1 ? "s" : ""}</span> : null}</td>
                <td>{r.mySignup ? <span className={`tag su-tag ${r.mySignup}`}>{SIGNUP_LABEL[r.mySignup]}</span> : <Link className="small" to={`/groups/${groupId}/raids/${r.id}`}>S'inscrire</Link>}</td>
                <td className="num">{r.filled}/{r.size}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      <Recurring groupId={groupId} canEdit={canEdit} guard={guard} />
      <GroupAddonExport groupId={groupId} />
    </div>
  );
}

/** Raids récurrents : le site crée chaque semaine le raid suivant, et le bot l'annonce. */
function Recurring({ groupId, canEdit, guard }: { groupId: string; canEdit: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["raid-templates", groupId], queryFn: () => get<{ templates: RaidTemplate[] }>(`/groups/${groupId}/raid-templates`) });
  const [form, setForm] = useState<{ name: string; weekday: number; time: string; leadDays: number; description: string; lootMode: LootMode; srHidden: boolean; size: RaidSize }>({ name: "", weekday: 3, time: "21:00", leadDays: 7, description: "", lootMode: "journal", srHidden: false, size: 40 });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raid-templates", groupId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);
  const list = data?.templates ?? [];
  if (!canEdit && !list.length) return null;
  const created = (n: number) => setMsg(n ? `${n} raid${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""}.` : "Aucun nouveau raid dans la période choisie.");
  return (
    <section className="stack" aria-labelledby="rec-title" style={{ marginTop: 20 }}>
      <div><h3 id="rec-title" style={{ margin: 0 }}>Raids récurrents</h3>
        <p className="hint" style={{ margin: "4px 0 0" }}>Chaque semaine, le raid est créé automatiquement quelques jours à l'avance (heure de Paris), puis annoncé sur Discord si un salon est lié. Supprimer un raid créé ainsi ne le fait pas revenir.</p></div>
      {list.length > 0 && (
        <div className="tscroll"><table className="data">
          <thead><tr><th>Raid</th><th>Quand</th><th>Format</th><th>Créé</th><th>Butin</th><th>État</th>{canEdit && <th />}</tr></thead>
          <tbody>{list.map(t => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td>{WEEKDAYS[t.weekday - 1]} à {t.time.replace(":", " h ")}</td>
              <td className="num small">{t.size}</td>
              <td className="small">{t.leadDays} jour{t.leadDays > 1 ? "s" : ""} avant</td>
              <td className="small">{LOOT_MODE_LABEL[t.lootMode]}</td>
              <td>{t.active ? <span className="tag ok">Actif</span> : <span className="tag">En pause</span>}</td>
              {canEdit && <td className="row" style={{ flexWrap: "nowrap" }}>
                <button className="btn ghost sm" type="button" onClick={() => void guard(async () => { const r = await patch<{ created: number }>(`/groups/${groupId}/raid-templates/${t.id}`, { active: !t.active }); await refresh(); if (!t.active) created(r.created); else setMsg(null); })}>{t.active ? "Mettre en pause" : "Reprendre"}</button>
                <button className="btn ghost sm" type="button" aria-label={`Supprimer le raid récurrent ${t.name}`} onClick={() => void guard(async () => { await del(`/groups/${groupId}/raid-templates/${t.id}`); await refresh(); setMsg("Raid récurrent supprimé (les raids déjà créés restent)."); })}>Supprimer</button>
              </td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {canEdit && (
        <form className="row" style={{ alignItems: "flex-end" }} onSubmit={e => {
          e.preventDefault();
          void guard(async () => {
            const r = await post<{ created: number }>(`/groups/${groupId}/raid-templates`, form);
            setForm(f => ({ ...f, name: "", description: "" })); await refresh(); created(r.created);
          });
        }}>
          <div className="fld" style={{ flex: "2 1 180px" }}><label htmlFor="t-name">Raid récurrent</label><input id="t-name" type="text" required minLength={2} maxLength={60} placeholder="Molten Core" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div className="fld" style={{ flex: "1 1 130px" }}><label htmlFor="t-day">Jour</label>
            <select id="t-day" value={form.weekday} onChange={e => setForm({ ...form, weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
          <div className="fld" style={{ flex: "0 1 110px" }}><label htmlFor="t-time">Heure</label><input id="t-time" type="time" required value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></div>
          <div className="fld" style={{ flex: "0 1 150px" }}><label htmlFor="t-lead">Créé (jours avant)</label><NumberField id="t-lead" min={1} max={28} value={form.leadDays} onChange={leadDays => setForm({ ...form, leadDays })} /></div>
          <div className="fld" style={{ flex: "0 1 110px" }}><label htmlFor="t-size">Format</label>
            <select id="t-size" value={form.size} onChange={e => setForm({ ...form, size: Number(e.target.value) as RaidSize })}>{RAID_SIZES.map(n => <option key={n} value={n}>{n} joueurs</option>)}</select></div>
          <div className="fld" style={{ flex: "0 1 170px" }}><label htmlFor="t-loot">Butin</label>
            <select id="t-loot" value={form.lootMode} onChange={e => setForm({ ...form, lootMode: e.target.value as LootMode })}>{LOOT_MODES.map(m => <option key={m} value={m}>{LOOT_MODE_LABEL[m]}</option>)}</select></div>
          <div className="fld" style={{ flex: "1 1 100%" }}><label htmlFor="t-desc">Description (reprise dans chaque raid)</label><input id="t-desc" type="text" maxLength={1000} placeholder="Ex. Pull à 21 h 15, flasques obligatoires" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <button className="btn primary" type="submit">Ajouter</button>
        </form>
      )}
      {msg && <div className="alert ok" role="status">{msg}</div>}
    </section>
  );
}

function Members({ groupId, members, myRole, myId, guard }: { groupId: string; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", groupId] });
  const rank = { member: 0, officer: 1, owner: 2 };
  const [sheet, setSheet] = useState<string | null>(null);
  return (
    <div className="stack">
    <p className="hint" style={{ margin: 0 }}>Clique un nom pour voir sa fiche dans le groupe : persos, présence, butin.</p>
    <div className="tscroll"><table className="data">
      <thead><tr><th>Joueur</th><th>Battle.net</th><th>Rôle</th><th>Depuis</th><th /></tr></thead>
      <tbody>{members.map(m => (
        <tr key={m.userId} className={sheet === m.userId ? "ps-sel" : undefined}>
          <td><span className="with-icon" style={{ gap: 8 }}><span className="avatar" style={{ width: 26, height: 26 }}><Portrait id={m.avatarId} size={26} fallback={<span className="small">{m.displayName[0]}</span>} /></span>
            <button type="button" className="ps-link" aria-expanded={sheet === m.userId} onClick={() => setSheet(s => (s === m.userId ? null : m.userId))}>{m.displayName}</button>{m.userId === myId && <span className="tag gold">Toi</span>}</span></td>
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
    {sheet && <PlayerSheet key={sheet} groupId={groupId} userId={sheet} onClose={() => setSheet(null)} />}
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
              <td><ItemHover item={r.item} className="with-icon" link>{r.item && <ItemIcon item={r.item} size={22} />}<span className={r.item ? `q${r.item.quality}` : ""}>{r.name}</span></ItemHover>{r.enchant && <span className="muted small"> · {r.enchant}</span>}</td>
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
    <section className="stack admin-sec">
      <h3>Invitations</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-uses">Utilisations max</label><NumberField id="i-uses" min={1} max={100} value={maxUses} onChange={setMaxUses} /></div>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-h">Valable (heures)</label><NumberField id="i-h" min={1} max={720} step={24} value={hours} onChange={setHours} /></div>
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

/** Liaison du groupe à un salon Discord : code à usage unique à taper avec /forever-lier dans le salon voulu. */
function DiscordChannel({ groupId, linked, hasDiscord, guard }: { groupId: string; linked: boolean; hasDiscord: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const cmd = code ? `/forever-lier code:${code.code}` : "";
  return (
    <section className="stack admin-sec" aria-labelledby="dc-title">
      <div className="row between">
        <h3 id="dc-title" style={{ margin: 0 }}>Salon Discord</h3>
        <span className={`tag ${linked ? "ok" : ""}`}>{linked ? "Lié" : "Non lié"}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Le bot publie chaque raid à venir dans ce salon, avec des boutons d'inscription. Les inscriptions faites sur Discord et sur le site sont les mêmes.
        Les joueurs sans compte peuvent aussi s'inscrire (classe et spé), marqués ✱.
      </p>
      {!hasDiscord && <div className="alert info">Pour lier un salon, lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn primary sm" type="button" onClick={() => void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/code`)); setCopied(false);
        })}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>Délier le salon</button>}
      </div>
      {code && (
        <div className="alert info stack" style={{ gap: 8 }}>
          <span>Dans le salon Discord voulu, tape cette commande (valable jusqu'à {new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(code.expiresAt))}, une seule fois) :</span>
          <div className="row"><input type="text" readOnly value={cmd} onFocus={e => e.currentTarget.select()} aria-label="Commande de liaison" className="num" style={{ flex: 1 }} />
            <button className="btn sm" type="button" onClick={() => { void navigator.clipboard.writeText(cmd).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier"}</button></div>
          <span className="small muted">Une fois le salon lié, recharge cette page.</span>
        </div>
      )}
      <NudgeSettings groupId={groupId} linked={linked} guard={guard} />
    </section>
  );
}

/** Relance en MP des membres qui n'ont pas répondu (lot D2), et liste envoyée aux officiers. */
function NudgeSettings({ groupId, linked, guard }: { groupId: string; linked: boolean; guard: Guard }) {
  const qc = useQueryClient();
  type S = { hours: 24 | 48 | 72 | null; officers: boolean };
  const q = useQuery({ queryKey: ["nudge-settings", groupId], queryFn: () => get<{ settings: S }>(`/groups/${groupId}/nudge-settings`) });
  const s = q.data?.settings;
  if (!s) return null;
  const save = (b: Partial<S>) => void guard(async () => {
    await put(`/groups/${groupId}/nudge-settings`, b);
    await qc.invalidateQueries({ queryKey: ["nudge-settings", groupId] });
  });
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
      <h4 style={{ margin: 0 }}>Relances</h4>
      <div className="rr-set">
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.hours !== null} disabled={!linked} onChange={e => save({ hours: e.target.checked ? 48 : null })} />
          Relancer en MP ceux qui n'ont pas répondu
        </label>
        <select aria-label="Délai de la relance" value={s.hours ?? ""} disabled={!linked || s.hours === null} onChange={e => save({ hours: Number(e.target.value) as 24 | 48 | 72 })}>
          {s.hours === null && <option value="">—</option>}
          <option value={24}>24 h avant</option><option value={48}>48 h avant</option><option value={72}>72 h avant</option>
        </select>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.officers} disabled={!linked || s.hours === null} onChange={e => save({ officers: e.target.checked })} />
          Prévenir les officiers (liste des sans-réponse en MP)
        </label>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Une relance automatique par raid, aux membres sans aucune réponse qui ont lié leur Discord. Sur la page d'un raid, « Relancer maintenant » est possible une fois par heure,
        et la compo assistée propose « Demander » pour inviter un joueur précis.{!linked && " Il faut d'abord lier un salon."}
      </p>
    </div>
  );
}
