import { AttendanceTab } from "../components/RaidLog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, del, get, patch, type GroupDetail } from "../api";
import { useMe } from "../auth";
import { GroupRaids } from "../components/GroupRaids";
import { GroupFeedback } from "../components/GroupFeedback";
import { GroupCharacters } from "../components/GroupRoster";
import { LootSettingsPanel } from "../components/Loot";
import { ROLE_LABEL } from "./GroupsPage";
import { useSite } from "../site";
import { SiteMembers } from "../components/GroupMembers";
import { CreatorsSettings, DeleteGroup, DiscordChannel, GroupName, Invites, Journal, OrdersChannel } from "../components/AdminSections";

/**
 * Page d'une guilde sur Roster (WoW Retail) : onglets Raids · Membres · Personnages · Présence & butin · Administration.
 * Forever Roster a sa propre navigation (refonte du 23/10, pages/GuildPages.tsx).
 */

type GroupTab = "raids" | "members" | "characters" | "presence" | "admin";
const GROUP_TAB_SLUG: Record<GroupTab, string> = { raids: "raids", members: "membres", characters: "persos", presence: "presence", admin: "admin" };

/** Une guilde de l'autre jeu s'ouvre sur son site (un site, deux adresses). */
export function OtherSite({ group }: { group: GroupDetail["group"] }) {
  return (
    <div className="panel lift pad stack" style={{ maxWidth: 620 }}>
      <h2 style={{ margin: 0 }}>{group.name}</h2>
      <p style={{ margin: 0 }}>Cette guilde est sur <b>{group.site.name}</b>. Ton compte y est le même.</p>
      <p style={{ margin: 0 }}><a className="btn primary" href={`${group.site.origin}/groups/${group.id}`}>Ouvrir sur {group.site.name}</a></p>
    </div>
  );
}

export function GroupPage() {
  const { groupId = "", tab: tabSlug } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const myId = me.data?.user?.id;
  const site = useSite();
  const [error, setError] = useState<string | null>(null);
  // Lien « Voir sur le site » d'un avis dans Discord : /groups/:id/admin?avis=<id>
  const [params] = useSearchParams();
  const avis = params.has("avis") ? params.get("avis") || null : undefined;

  const detail = useQuery({ queryKey: ["group", groupId], queryFn: () => get<GroupDetail>(`/groups/${groupId}`) });
  const isOfficer = detail.data && detail.data.role !== "member";
  const isOwner = detail.data?.role === "owner";

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
  };

  if (detail.isLoading) return <p className="muted">Chargement…</p>;
  if (detail.error || !detail.data) return <div className="panel empty"><h2>Guilde introuvable</h2><Link to="/groups">Retour aux guildes</Link></div>;
  const { group, role, members } = detail.data;
  if (group.game !== site.game) return <OtherSite group={group} />;

  const tabs: [GroupTab, string][] = [["raids", "Raids"], ["members", `Membres (${members.length})`], ["characters", "Personnages"], ["presence", "Présence & butin"]];
  if (isOfficer) tabs.push(["admin", "Administration"]);
  // Onglet dans l'adresse (/groups/:id/membres…) : retour arrière, lien direct à partager
  const wanted = (Object.entries(GROUP_TAB_SLUG).find(([, s]) => s === tabSlug)?.[0] as GroupTab | undefined) ?? "raids";
  const tab: GroupTab = tabs.some(([k]) => k === wanted) ? wanted : "raids";
  const setTab = (t: GroupTab) => nav(`/groups/${groupId}${t === "raids" ? "" : `/${GROUP_TAB_SLUG[t]}`}`);
  const unseen = detail.data.feedback?.unseen ?? 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div className="eyebrow"><Link to="/groups">Guildes</Link> · {ROLE_LABEL[role]}</div>
          {isOfficer
            ? <GroupName key={group.name} name={group.name} onSave={name => guard(async () => {
                await patch(`/groups/${groupId}`, { name });
                await Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["group-audit", groupId] })]);
              })} />
            : <h1>{group.name}</h1>}
        </div>
        <div className="row">
          {role !== "owner" && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/members/${myId}`); await qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); })}>Quitter la guilde</button>}
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="panel lift">
        <div className="tabs" role="tablist">
          {tabs.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{k === "admin" && !!unseen && <span className="av-badge" aria-label={`${unseen} avis avec du nouveau`}>{unseen}</span>}</button>)}
        </div>
        <div className="pane">
          {tab === "raids" && <GroupRaids groupId={groupId} canEdit={!!isOfficer} canCreate={group.creators.canCreateRaid} guard={guard} discordLinked={group.discordLinked} />}
          {tab === "members" && <SiteMembers groupId={groupId} members={members} myRole={role} myId={myId} guard={guard} hint="Clique un nom pour voir sa fiche dans la guilde : persos, présence, butin." />}
          {tab === "characters" && <GroupCharacters groupId={groupId} groupName={group.name} members={members} myId={myId} myRole={role} />}
          {tab === "presence" && <AttendanceTab groupId={groupId} />}
          {tab === "admin" && isOfficer && (
            <Admin isOwner={isOwner} unseen={unseen} initial={avis !== undefined ? "feedback" : undefined} sections={{
              invites: <Invites groupId={groupId} guard={guard} />,
              loot: <LootSettingsPanel groupId={groupId} />,
              discord: <><DiscordChannel groupId={groupId} linked={group.discordLinked} name={group.discordChannelName} hasDiscord={!!me.data?.user?.discordUsername} guard={guard} />
                <OrdersChannel groupId={groupId} linked={group.ordersLinked} name={group.ordersChannelName} hasDiscord={!!me.data?.user?.discordUsername} guard={guard} />
                <CreatorsSettings groupId={groupId} creators={group.creators} guard={guard} /></>,
              feedback: <GroupFeedback groupId={groupId} groupName={group.name} focus={avis ?? null} />,
              journal: <section className="stack admin-sec"><h3>Journal de la guilde</h3><Journal groupId={groupId} /></section>,
              danger: (
                <section className="stack admin-sec danger-zone">
                  <h3>Zone sensible</h3>
                  <p className="hint" style={{ margin: 0 }}>Supprime définitivement la guilde du site, ses raids, ses invitations et la liaison Discord. Les persos des membres ne sont pas touchés.</p>
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

type AdminKey = "invites" | "loot" | "discord" | "feedback" | "journal" | "danger";
const ADMIN_NAV: [AdminKey, string][] = [["invites", "Invitations"], ["loot", "Butin"], ["discord", "Discord et relances"], ["feedback", "Avis"], ["journal", "Journal"], ["danger", "Zone sensible"]];

/** Administration (lot E) : une petite navigation à gauche, une section à la fois. */
function Admin({ sections, isOwner, unseen, initial }: { sections: Record<AdminKey, React.ReactNode>; isOwner: boolean; unseen: number; initial?: AdminKey }) {
  const [cur, setCur] = useState<AdminKey>(initial ?? "invites");
  useEffect(() => { if (initial) setCur(initial); }, [initial]);
  const nav = ADMIN_NAV.filter(([k]) => k !== "danger" || isOwner);
  return (
    <div className="adm">
      <nav className="adm-nav" aria-label="Sections de l'administration">
        {nav.map(([k, l]) => <button key={k} type="button" className={`${cur === k ? "on" : ""}${k === "danger" ? " bad" : ""}`} aria-current={cur === k ? "true" : undefined} onClick={() => setCur(k)}>{l}{k === "feedback" && !!unseen && <span className="av-badge">{unseen}</span>}</button>)}
      </nav>
      <div className="adm-body admin">{sections[cur]}</div>
    </div>
  );
}
