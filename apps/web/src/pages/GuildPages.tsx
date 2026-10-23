import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, del, get, patch, post, type GroupDetail } from "../api";
import { useMe } from "../auth";
import { useSite } from "../site";
import { rememberGuild } from "../nav";
import { agoText, useGuildLink, useGuildMembers } from "../guild";
import { GroupPage, OtherSite } from "./GroupPage";
import { HomePage } from "./HomePage";
import { GuildHead, InviteButton } from "../components/GuildHead";
import { GroupRaids, type RaidSummary } from "../components/GroupRaids";
import { GroupOutings } from "../components/Outings";
import { AttendanceTab } from "../components/RaidLog";
import { GuildMembersTab, type GuildView } from "../components/GuildMembers";
import { GuildLinkSection, RaceAnnounces } from "../components/GuildAdmin";
import { GroupFeedback } from "../components/GroupFeedback";
import { LootSettingsPanel } from "../components/Loot";
import { FactionBadge } from "../components/Icons";
import { NumberField } from "../components/NumberField";
import {
  Crafters, CreatorsSettings, DeleteGroup, DiscordChannel, fmt, GroupName, Journal, OrdersChannel, OutingsChannel, type Guard, type Invite,
} from "../components/AdminSections";

/**
 * Pages d'une guilde de Forever Roster (refonte du 23/10) : Accueil (/groups/:id), Sorties, Raids (À venir · Passés ·
 * Présence), Guilde (Joueurs · Course au 60 · Artisans · Historique) et Administration (6 sections). Les anciennes adresses
 * d'onglets redirigent ; /groups/:id/membres/course (lien du bot) mène à la Course au 60. Roster garde sa page à onglets.
 */

/** /groups/:groupId/… : Roster (WoW Retail) garde GroupPage, Forever Roster passe par la nouvelle navigation. */
export function GroupRoute({ tab, sub }: { tab?: string; sub?: string }) {
  const site = useSite();
  return site.game === "retail" ? <GroupPage /> : <ForeverGroupPage tab={tab} sub={sub} />;
}

function ForeverGroupPage({ tab: fixedTab, sub: fixedSub }: { tab?: string; sub?: string }) {
  const params = useParams();
  const groupId = params.groupId ?? "";
  const tab = fixedTab ?? params.tab;
  const sub = fixedSub ?? params.sub;
  const loc = useLocation();
  const site = useSite();
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["group", groupId], queryFn: () => get<GroupDetail>(`/groups/${groupId}`) });
  useEffect(() => { if (detail.data && detail.data.group.game === site.game) rememberGuild(groupId); }, [detail.data, groupId, site.game]);
  const guard: Guard = async fn => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
  };
  const base = `/groups/${groupId}`;
  // Anciennes adresses des onglets
  if (tab === "accueil") return <Navigate to={base} replace />;
  if (tab === "artisans") return <Navigate to={`${base}/membres/artisans`} replace />;
  if (tab === "presence") return <Navigate to={`${base}/raids/presence`} replace />;
  if (tab === "persos") return <Navigate to={`${base}/membres/persos${loc.search}`} replace />;

  if (detail.isLoading) return <p className="muted">Chargement…</p>;
  if (detail.error || !detail.data) return <div className="panel empty"><h2>Guilde introuvable</h2><Link to="/">Retour à l'accueil</Link></div>;
  if (detail.data.group.game !== site.game) return <OtherSite group={detail.data.group} />;
  const d = detail.data;
  const err = error && <div className="alert error" role="alert">{error}</div>;
  let page: ReactNode;
  if (!tab) page = <HomePage groupId={groupId} detail={d} />;
  else if (tab === "sorties") page = <OutingsPage groupId={groupId} d={d} creating={sub === "nouvelle"} guard={guard} />;
  else if (tab === "raids") page = <RaidsPage groupId={groupId} d={d} view={sub === "passes" ? "past" : sub === "presence" ? "presence" : "next"} guard={guard} />;
  else if (tab === "membres") page = <GuildPage groupId={groupId} d={d} view={(["persos", "course", "artisans", "historique"].includes(sub ?? "") ? sub : "joueurs") as GuildPageView} guard={guard} />;
  else if (tab === "admin" && d.role !== "member") page = <AdminPage groupId={groupId} d={d} guard={guard} />;
  else return <Navigate to={base} replace />;
  return <>{err}{page}</>;
}

/* ---------- Sorties ---------- */

function OutingsPage({ groupId, d, creating, guard }: { groupId: string; d: GroupDetail; creating: boolean; guard: Guard }) {
  const nav = useNavigate();
  const { group } = d;
  const outings = (
    <GroupOutings groupId={groupId} guard={guard} creating={creating} headPlus
      channelName={group.outingsLinked ? group.outingsChannelName : group.discordChannelName} discordLinked={group.outingsLinked || group.discordLinked}
      onCreate={() => nav(`/groups/${groupId}/sorties/nouvelle`)} onClose={() => nav(`/groups/${groupId}/sorties`)} />
  );
  if (creating) return <div className="stack" style={{ gap: 12 }}><Link className="mp-back" to={`/groups/${groupId}/sorties`}>← Sorties</Link>{outings}</div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <GuildHead groupId={groupId} name={group.name} title="Sorties"
        actions={group.creators.canCreateOuting && <Link className="btn primary" to={`/groups/${groupId}/sorties/nouvelle`}>+ Sortie</Link>} />
      {outings}
    </div>
  );
}

/* ---------- Raids : À venir · Passés · Présence ---------- */

/** Un raid est « passé » 6 h après son heure (comme GroupRaids). */
const PAST_AFTER_MS = 6 * 3600e3;

function RaidsPage({ groupId, d, view, guard }: { groupId: string; d: GroupDetail; view: "next" | "past" | "presence"; guard: Guard }) {
  const nav = useNavigate();
  const officer = d.role !== "member";
  const [creating, setCreating] = useState(false);
  const raids = useQuery({ queryKey: ["raids", groupId], queryFn: () => get<{ raids: RaidSummary[] }>(`/groups/${groupId}/raids`) }).data?.raids;
  const now = Date.now();
  const past = (raids ?? []).filter(r => !!r.scheduledAt && Date.parse(r.scheduledAt) < now - PAST_AFTER_MS).length;
  const next = (raids?.length ?? 0) - past;
  const tabs: [typeof view, string, string][] = [["next", raids ? `À venir (${next})` : "À venir", ""], ["past", raids ? `Passés (${past})` : "Passés", "/passes"], ["presence", "Présence", "/presence"]];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <GuildHead groupId={groupId} name={d.group.name} title="Raids"
        actions={d.group.creators.canCreateRaid && view !== "presence" && !creating && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ Raid</button>} />
      <div className="panel lift">
        <div className="tabs" role="tablist">
          {tabs.map(([k, l, path]) => <button key={k} type="button" role="tab" className="tab" aria-selected={view === k} onClick={() => nav(`/groups/${groupId}/raids${path}`)}>{l}</button>)}
        </div>
        <div className="pane">
          {view === "presence" ? <AttendanceTab groupId={groupId} />
            : <GroupRaids groupId={groupId} canEdit={officer} canCreate={d.group.creators.canCreateRaid} guard={guard} discordLinked={d.group.discordLinked}
                when={view} creating={creating} onCloseForm={() => setCreating(false)} />}
        </div>
      </div>
    </div>
  );
}

/* ---------- Guilde : Joueurs · Course au 60 · Artisans · Historique ---------- */

type GuildPageView = GuildView | "artisans";
const GUILD_TABS: [GuildPageView, ReactNode, string][] = [
  ["joueurs", "Joueurs", ""], ["course", <>Course<span className="wide"> au 60</span></>, "/course"], ["artisans", "Artisans", "/artisans"], ["historique", "Historique", "/historique"],
];

function GuildPage({ groupId, d, view, guard }: { groupId: string; d: GroupDetail; view: GuildPageView; guard: Guard }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const myId = me.data?.user?.id;
  const { group, role, members } = d;
  const officer = role !== "member";
  const gm = useGuildMembers(groupId).data;
  const gg = gm?.link;
  const players = gm?.players.length ?? 0;
  const meta = gg ? <>
    {(gg.faction === "Horde" || gg.faction === "Alliance") && <FactionBadge faction={gg.faction} size={20} />}
    <span>{players} joueur{players > 1 ? "s" : ""}, {gm!.chars.length} perso{gm!.chars.length > 1 ? "s" : ""}</span>
    {gg.roster && <><span aria-hidden="true">·</span><span>liste relevée par {gg.roster.by} {agoText(gg.roster.at)}</span></>}
  </> : <span>{members.length} membre{members.length > 1 ? "s" : ""} sur le site</span>;
  const leave = () => void guard(async () => { await del(`/groups/${groupId}/members/${myId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/"); });
  const actions = officer
    ? <><InviteButton groupId={groupId} groupName={group.name} primary /><Link className="btn ghost" to={`/groups/${groupId}/admin`}>Administration</Link></>
    : <LeaveButton onLeave={leave} />;
  const tabOn = view === "persos" ? "joueurs" : view;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <GuildHead groupId={groupId} name={group.name} title="Guilde" meta={meta} actions={actions} />
      <div className="panel lift">
        <div className="tabs" role="tablist">
          {GUILD_TABS.map(([k, l, path]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tabOn === k} onClick={() => nav(`/groups/${groupId}/membres${path}`)}>{l}</button>)}
        </div>
        <div className="pane">
          {view === "artisans" ? <Crafters groupId={groupId} myId={myId} />
            : <GuildMembersTab groupId={groupId} groupName={group.name} view={view} members={members} myRole={role} myId={myId} guard={guard}
                onAdmin={officer ? () => nav(`/groups/${groupId}/admin?section=guilde`) : undefined} />}
        </div>
      </div>
    </div>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask
    ? <span className="row small">Quitter la guilde ? <button type="button" className="btn danger sm" onClick={onLeave}>Quitter</button><button type="button" className="btn ghost sm" onClick={() => setAsk(false)}>Annuler</button></span>
    : <button type="button" className="btn ghost sm" onClick={() => setAsk(true)}>Quitter la guilde</button>;
}

/* ---------- Administration : 6 sections ---------- */

type AdminKey = "invitations" | "guilde" | "discord" | "butin" | "avis" | "journal";
const ADMIN: [AdminKey, string][] = [["invitations", "Invitations"], ["guilde", "Guilde"], ["discord", "Discord"], ["butin", "Butin"], ["avis", "Avis"], ["journal", "Journal"]];

function AdminPage({ groupId, d, guard }: { groupId: string; d: GroupDetail; guard: Guard }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const myId = me.data?.user?.id;
  const hasDiscord = !!me.data?.user?.discordUsername;
  const { group, role } = d;
  // Lien « Voir sur le site » d'un avis dans Discord : ?avis=<id> ; anciens noms de section gardés
  const avis = params.has("avis") ? params.get("avis") || null : undefined;
  const raw = avis !== undefined ? "avis" : params.get("section");
  const picked = (raw === "guild" ? "guilde" : ADMIN.some(([k]) => k === raw) ? raw : null) as AdminKey | null;
  const cur: AdminKey = picked ?? "invitations";
  const go = (k: AdminKey) => setParams({ section: k }, { replace: false });
  const unseen = d.feedback?.unseen ?? 0;
  const invites = useQuery({ queryKey: ["invites", groupId], queryFn: () => get<{ invites: Invite[] }>(`/groups/${groupId}/invites`) }).data?.invites;
  const link = useGuildLink(groupId).data?.link;
  const subs: Record<AdminKey, string> = {
    invitations: invites ? (invites.length ? `${invites.length} lien${invites.length > 1 ? "s" : ""} actif${invites.length > 1 ? "s" : ""}` : "aucun lien actif") : "liens d'invitation",
    guilde: link ? `nom, guilde du jeu ${link.name}${role === "owner" ? ", suppression" : ""}` : "nom, guilde du jeu, suppression",
    discord: "salons, relances, annonces de la course",
    butin: "compte des objets reçus",
    avis: unseen ? `${unseen} à lire` : "avis du Discord",
    journal: "qui a fait quoi",
  };
  const sections: Record<AdminKey, ReactNode> = {
    invitations: <ForeverInvites groupId={groupId} guard={guard} invites={invites} />,
    guilde: <>
      <section className="stack admin-sec" aria-labelledby="gn-t">
        <h3 id="gn-t">Nom de la guilde</h3>
        <GroupName key={group.name} name={group.name} onSave={name => guard(async () => {
          await patch(`/groups/${groupId}`, { name });
          await Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["group-audit", groupId] })]);
        })} />
      </section>
      <GuildLinkSection groupId={groupId} guard={guard} />
      {role === "owner" ? (
        <section className="stack admin-sec danger-zone">
          <h3>Zone sensible</h3>
          <p className="hint" style={{ margin: 0 }}>Supprime la guilde du site, ses raids, ses invitations et la liaison Discord. Les persos des membres restent.</p>
          <div><DeleteGroup onDelete={() => guard(async () => { await del(`/groups/${groupId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/"); })} /></div>
        </section>
      ) : (
        <section className="stack admin-sec"><div><LeaveButton onLeave={() => void guard(async () => { await del(`/groups/${groupId}/members/${myId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/"); })} /></div></section>
      )}
    </>,
    discord: <>
      <DiscordChannel groupId={groupId} linked={group.discordLinked} name={group.discordChannelName} hasDiscord={hasDiscord} guard={guard} />
      <OutingsChannel groupId={groupId} linked={group.outingsLinked} name={group.outingsChannelName} hasDiscord={hasDiscord} guard={guard} />
      <RaceAnnounces groupId={groupId} linked={group.discordLinked} guard={guard} />
      <OrdersChannel groupId={groupId} linked={group.ordersLinked} name={group.ordersChannelName} hasDiscord={hasDiscord} guard={guard} />
      <CreatorsSettings groupId={groupId} creators={group.creators} guard={guard} />
    </>,
    butin: <LootSettingsPanel groupId={groupId} />,
    avis: <GroupFeedback groupId={groupId} groupName={group.name} focus={avis ?? null} />,
    journal: <section className="stack admin-sec"><h3>Journal de la guilde</h3><Journal groupId={groupId} /></section>,
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <GuildHead groupId={groupId} name={group.name} title="Administration" actions={<Link className="btn ghost sm" to={`/groups/${groupId}/membres`}>← Guilde</Link>} />
      <div className={`adm adm-f${picked ? " picked" : ""}`}>
        <nav className="adm-nav" aria-label="Sections de l'administration">
          {ADMIN.map(([k, l]) => (
            <button key={k} type="button" className={cur === k ? "on" : ""} aria-current={cur === k ? "true" : undefined} onClick={() => go(k)}>
              <b>{l}</b>{k === "avis" && !!unseen && <span className="av-badge">{unseen}</span>}<small>{subs[k]}</small><span className="adm-go" aria-hidden="true">›</span>
            </button>
          ))}
        </nav>
        <div className="adm-body admin">
          {picked && <button type="button" className="mp-back adm-back" onClick={() => setParams({}, { replace: false })}>← Administration</button>}
          {sections[cur]}
        </div>
      </div>
    </div>
  );
}

/** Invitations : un lien en un clic (5 utilisations, 3 jours), réglages repliés ; les liens actifs, à révoquer. */
function ForeverInvites({ groupId, guard, invites }: { groupId: string; guard: Guard; invites?: Invite[] }) {
  const qc = useQueryClient();
  const [maxUses, setMaxUses] = useState(5), [days, setDays] = useState(3);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["invites", groupId] });
  const create = () => void guard(async () => {
    const r = await post<{ invite: { url: string } }>(`/groups/${groupId}/invites`, { maxUses, expiresInHours: days * 24 });
    setLink(r.invite.url); setCopied(false); await refresh();
  });
  return (
    <section className="stack admin-sec" aria-labelledby="inv-t">
      <h3 id="inv-t">Invitations</h3>
      {link ? (
        <div className="inv-row">
          <div className="row nowrap"><input type="text" readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="Lien d'invitation" />
            <button className="btn primary sm" type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier"}</button></div>
          <p className="hint" style={{ margin: 0 }}>Copie-le maintenant : il ne sera plus affiché.</p>
        </div>
      ) : <div><button type="button" className="btn primary" onClick={create}>Créer un lien</button> <span className="hint">{maxUses} utilisation{maxUses > 1 ? "s" : ""} · {days} jour{days > 1 ? "s" : ""}</span></div>}
      <details className="ad-more">
        <summary>Réglages du lien</summary>
        <div className="row" style={{ padding: "0 14px 14px", alignItems: "flex-end" }}>
          <div className="fld" style={{ width: 140 }}><label htmlFor="i-uses">Utilisations</label><NumberField id="i-uses" min={1} max={100} value={maxUses} onChange={setMaxUses} /></div>
          <div className="fld" style={{ width: 140 }}><label htmlFor="i-days">Durée (jours)</label><NumberField id="i-days" min={1} max={30} value={days} onChange={setDays} /></div>
          {link && <button type="button" className="btn" onClick={create}>Nouveau lien</button>}
        </div>
      </details>
      {!!invites?.length && (
        <ul className="inv-list" aria-label="Liens actifs">{invites.map(i => (
          <li key={i.id}><span><b className="num">{i.uses}/{i.maxUses}</b> utilisé{i.uses > 1 ? "s" : ""} · expire {fmt.format(new Date(i.expiresAt))}</span>
            <button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/invites/${i.id}`); await refresh(); })}>Révoquer</button></li>
        ))}</ul>
      )}
    </section>
  );
}
