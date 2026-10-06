import { AttendanceTab } from "../components/RaidLog";
import { classColor, ATTENDED, CLASSES, SKILL_LINE_NAMES, type AttendanceStatus, type ClassName } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, patch, post, put, type Character, type CraftersRecipe, type GroupRole, type Member } from "../api";
import { useMe } from "../auth";
import { CRAFTING } from "../components/GameData";
import { Portrait } from "../components/ImageUpload";
import { ItemHover, ItemIcon } from "../components/ItemTooltip";
import { NumberField } from "../components/NumberField";
import { GroupAddonExport } from "../components/GroupAddonExport";
import { GroupRaids } from "../components/GroupRaids";
import { CraftOrders, type OrderPrefill } from "../components/CraftOrders";
import { GroupCharacters } from "../components/GroupRoster";
import { LootSettingsPanel } from "../components/Loot";
import { PlayerSheet } from "../components/PlayerSheet";
import { ROLE_LABEL } from "./GroupsPage";
import { useSite } from "../site";
import type { Game } from "@forever/game-data";

interface GroupDetail { group: { id: string; name: string; game: Game; site: { name: string; origin: string }; discordLinked: boolean; ordersLinked: boolean }; role: GroupRole; members: Member[] }
interface Invite { id: string; maxUses: number; uses: number; expiresAt: string; createdAt: string }
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
  const site = useSite();
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
  // Un site, deux adresses : un groupe de l'autre jeu s'ouvre sur son site
  if (group.game !== site.game) return (
    <div className="panel lift pad stack" style={{ maxWidth: 620 }}>
      <h2 style={{ margin: 0 }}>{group.name}</h2>
      <p style={{ margin: 0 }}>Ce groupe est sur <b>{group.site.name}</b>. Ton compte y est le même.</p>
      <p style={{ margin: 0 }}><a className="btn primary" href={`${group.site.origin}/groups/${group.id}`}>Ouvrir sur {group.site.name}</a></p>
    </div>
  );

  const tabs: [GroupTab, string][] = [["raids", "Raids"], ["members", `Membres (${members.length})`], ["characters", "Personnages"],
    // Roster (WoW Retail) : métiers et relevés de l'addon viendront avec l'addon Retail (R3)
    ...(site.game === "retail" ? [] : [["crafters", "Artisans"], ["presence", "Présence & butin"]] as [GroupTab, string][]), ...(isOfficer ? [["admin", "Administration"] as [GroupTab, string]] : [])];
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
          {tab === "raids" && <GroupRaids groupId={groupId} canEdit={!!isOfficer} guard={guard} />}
          {tab === "members" && <Members groupId={groupId} members={members} myRole={role} myId={myId} guard={guard} />}
          {tab === "characters" && <GroupCharacters groupId={groupId} groupName={group.name} members={members} myId={myId} myRole={role} />}
          {tab === "crafters" && <Crafters groupId={groupId} myId={myId} />}
          {tab === "presence" && <AttendanceTab groupId={groupId} />}
          {tab === "admin" && isOfficer && (
            <Admin isOwner={isOwner} sections={{
              invites: <Invites groupId={groupId} guard={guard} />,
              loot: <LootSettingsPanel groupId={groupId} />,
              discord: <><DiscordChannel groupId={groupId} linked={group.discordLinked} hasDiscord={!!me.data?.user?.discordUsername} guard={guard} />
                <OrdersChannel groupId={groupId} linked={group.ordersLinked} hasDiscord={!!me.data?.user?.discordUsername} guard={guard} /></>,
              addon: <GroupAddonExport groupId={groupId} />,
              journal: <section className="stack admin-sec"><h3>Journal du groupe</h3><Journal groupId={groupId} /></section>,
              danger: (
                <section className="stack admin-sec danger-zone">
                  <h3>Zone sensible</h3>
                  <p className="hint" style={{ margin: 0 }}>Supprime définitivement le groupe, ses raids, ses invitations et la liaison Discord. Les persos des membres ne sont pas touchés.</p>
                  <div><DeleteGroup onDelete={() => guard(async () => { await del(`/groups/${groupId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); })} /></div>
                </section>
              ),
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

type AdminKey = "invites" | "loot" | "discord" | "addon" | "journal" | "danger";
const ADMIN_NAV: [AdminKey, string][] = [["invites", "Invitations"], ["loot", "Butin"], ["discord", "Discord et relances"], ["addon", "Données pour l'addon"], ["journal", "Journal"], ["danger", "Zone sensible"]];

/** Administration (lot E) : une petite navigation à gauche, une section à la fois. */
function Admin({ sections, isOwner }: { sections: Record<AdminKey, React.ReactNode>; isOwner: boolean }) {
  const [cur, setCur] = useState<AdminKey>("invites");
  const retail = useSite().game === "retail";
  const nav = ADMIN_NAV.filter(([k]) => (k !== "danger" || isOwner) && !(retail && (k === "loot" || k === "addon")));
  return (
    <div className="adm">
      <nav className="adm-nav" aria-label="Sections de l'administration">
        {nav.map(([k, l]) => <button key={k} type="button" className={`${cur === k ? "on" : ""}${k === "danger" ? " bad" : ""}`} aria-current={cur === k ? "true" : undefined} onClick={() => setCur(k)}>{l}</button>)}
      </nav>
      <div className="adm-body admin">{sections[cur]}</div>
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

function Members({ groupId, members, myRole, myId, guard }: { groupId: string; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", groupId] });
  const rank = { member: 0, officer: 1, owner: 2 };
  const [sheet, setSheet] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; action: "owner" | "remove" } | null>(null);
  // Main de chaque joueur dans le groupe (à la place de Battle.net, presque toujours vide)
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
  return (
    <div className="stack">
    <p className="hint" style={{ margin: 0 }}>Clique un nom pour voir sa fiche dans le groupe : persos, présence, butin.</p>
    <div className="tscroll"><table className="data mb-table">
      <thead><tr><th>Joueur</th><th>Main</th><th>Rôle</th><th title={nRaids ? `Sur les ${nRaids} derniers raids relevés par l'addon` : undefined}>Présence</th><th>Depuis</th><th /></tr></thead>
      <tbody>{members.map(m => {
        const main = mainOf.get(m.userId);
        const canRole = myRole === "owner" && m.userId !== myId;
        const canRemove = m.userId !== myId && rank[myRole] > rank[m.role];
        const asking = confirm?.userId === m.userId ? confirm.action : null;
        return (
        <tr key={m.userId} className={sheet === m.userId ? "ps-sel" : undefined}>
          <td><span className="with-icon" style={{ gap: 8 }}><span className="avatar" style={{ width: 26, height: 26 }}><Portrait id={m.avatarId} size={26} fallback={<span className="small">{m.displayName[0]}</span>} /></span>
            <button type="button" className="ps-link" aria-expanded={sheet === m.userId} onClick={() => setSheet(s => (s === m.userId ? null : m.userId))}>{m.displayName}</button>{m.userId === myId && <span className="tag gold">Toi</span>}</span></td>
          <td>{main ? <b style={{ color: classColor(main.cls) }}>{main.name}</b> : <span className="muted">—</span>}</td>
          <td>{m.role === "member" ? <span className="muted">{ROLE_LABEL[m.role]}</span> : <span className={`tag ${m.role === "owner" ? "gold" : ""}`}>{ROLE_LABEL[m.role]}</span>}</td>
          <td className="nowrap">{nRaids ? (() => { const n = presence(m.userId), pct = Math.round(n / nRaids * 100); return <><span className="rl-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} className={pct < 50 ? "low" : ""} /></span><span className="num small">{n}/{nRaids}</span></>; })() : <span className="muted">—</span>}</td>
          <td className="muted small">{fmt.format(new Date(m.joinedAt))}</td>
          <td className="mb-act">
            {asking === "owner" && <span className="row small">Lui donner le groupe ? Tu deviens officier. <button type="button" className="btn danger sm" onClick={() => void setRole(m, "owner")}>Transférer</button><button type="button" className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button></span>}
            {asking === "remove" && <span className="row small">Retirer {m.displayName} ? <button type="button" className="btn danger sm" onClick={() => void remove(m)}>Retirer</button><button type="button" className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button></span>}
            {!asking && (canRole || canRemove) && (
              <details className="mb-menu">
                <summary aria-label={`Actions pour ${m.displayName}`}>…</summary>
                <div className="mb-pop" role="menu">
                  {canRole && m.role === "member" && <button type="button" role="menuitem" onClick={() => void setRole(m, "officer")}>Nommer officier</button>}
                  {canRole && m.role === "officer" && <button type="button" role="menuitem" onClick={() => void setRole(m, "member")}>Repasser membre</button>}
                  {canRole && <button type="button" role="menuitem" onClick={() => setConfirm({ userId: m.userId, action: "owner" })}>Transférer la propriété…</button>}
                  {canRemove && <button type="button" role="menuitem" className="bad" onClick={() => setConfirm({ userId: m.userId, action: "remove" })}>Retirer du groupe…</button>}
                </div>
              </details>
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

/** « Qui crafte quoi ? » : les patrons connus et recherchés par les persos du groupe. */
function Crafters({ groupId, myId }: { groupId: string; myId?: string }) {
  const [input, setInput] = useState(""), [q, setQ] = useState(""), [prof, setProf] = useState("");
  const [prefill, setPrefill] = useState<OrderPrefill | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setQ(input.trim()), 300); return () => window.clearTimeout(t); }, [input]);
  const params = new URLSearchParams({ ...(q.length >= 2 && { q }), ...(prof && { profession: prof }) });
  const { data, isLoading } = useQuery({
    queryKey: ["crafters", groupId, q, prof],
    queryFn: () => get<{ recipes: CraftersRecipe[]; total: number }>(`/groups/${groupId}/crafters?${params}`),
  });
  const names = (list: { name: string; owner: string }[]) => list.map(w => `${w.name} (${w.owner})`).join(", ");
  return (
    <div className="sec">
      <CraftOrders groupId={groupId} myId={myId} prefill={prefill} />
      <h3 style={{ margin: "8px 0 0" }}>Qui crafte quoi ?</h3>
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
          <thead><tr><th>Recette</th><th>Métier</th><th>Sait la faire</th><th>La recherche</th><th /></tr></thead>
          <tbody>{data.recipes.map(r => (
            <tr key={r.spellId}>
              <td><ItemHover item={r.item} className="with-icon" link>{r.item && <ItemIcon item={r.item} size={22} />}<span className={r.item ? `q${r.item.quality}` : ""}>{r.name}</span></ItemHover>{r.enchant && <span className="muted small"> · {r.enchant}</span>}</td>
              <td className="small">{SKILL_LINE_NAMES[r.skillLine] ?? "?"} <span className="muted num">{r.reqSkill}</span></td>
              <td>{r.known.length ? names(r.known) : <span className="muted">—</span>}</td>
              <td className="small">{r.wanted.length ? names(r.wanted) : <span className="muted">—</span>}</td>
              <td>{r.known.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { setPrefill({ spellId: r.spellId, name: r.item?.name ?? r.name, key: Date.now() }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Commander</button>}</td>
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
  if (!data.events.length) return <p className="muted" style={{ margin: 0 }}>Rien pour l'instant : les actions des officiers (invitations, raids, réglages) s'afficheront ici.</p>;
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

/** Commande du bot pour lier un salon : la même, sous le nom du site (un seul bot pour les deux). */
const linkCommand = (game: Game) => (game === "retail" ? "/roster-lier" : "/forever-lier");

/** Liaison du groupe à un salon Discord : code à usage unique à taper avec /forever-lier (ou /roster-lier) dans le salon voulu. */
function DiscordChannel({ groupId, linked, hasDiscord, guard }: { groupId: string; linked: boolean; hasDiscord: boolean; guard: Guard }) {
  const game = useSite().game;
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [wantCode, setWantCode] = useState(false);
  const cmd = code ? `${linkCommand(game)} code:${code.code}` : "";
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
      {!hasDiscord && (!linked || wantCode) && <div className="alert info">Pour lier un salon, lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn primary sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/code`)); setCopied(false);
        }); }}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
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

/** Salon Discord des commandes d'artisanat (lot F) : même liaison par code que le salon des raids. */
function OrdersChannel({ groupId, linked, hasDiscord, guard }: { groupId: string; linked: boolean; hasDiscord: boolean; guard: Guard }) {
  const game = useSite().game;
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [wantCode, setWantCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = code ? `${linkCommand(game)} code:${code.code}` : "";
  return (
    <section className="stack admin-sec" aria-labelledby="oc-title">
      <div className="row between">
        <h3 id="oc-title" style={{ margin: 0 }}>Salon des commandes d'artisanat</h3>
        <span className={`tag ${linked ? "ok" : ""}`}>{linked ? "Lié" : "Non lié"}</span>
      </div>
      <p className="hint" style={{ margin: 0 }}>Facultatif. Le bot y poste chaque commande de l'onglet Artisans avec un bouton « Je m'en charge », et met le message à jour quand elle est prise ou faite.</p>
      {!hasDiscord && wantCode && <div className="alert info">Lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/orders-code`)); setCopied(false);
        }); }}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord/orders`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>Délier le salon</button>}
      </div>
      {code && (
        <div className="alert info stack" style={{ gap: 8 }}>
          <span>Dans le salon Discord des commandes, tape cette commande (valable jusqu'à {new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(code.expiresAt))}, une seule fois) :</span>
          <div className="row"><input type="text" readOnly value={cmd} onFocus={e => e.currentTarget.select()} aria-label="Commande de liaison du salon des commandes" className="num" style={{ flex: 1 }} />
            <button className="btn sm" type="button" onClick={() => { void navigator.clipboard.writeText(cmd).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier"}</button></div>
        </div>
      )}
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
