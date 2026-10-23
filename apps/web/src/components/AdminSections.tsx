import { SKILL_LINE_NAMES, WEEKDAYS } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { del, get, post, put, type Creators, type CraftersRecipe } from "../api";
import { CRAFTING } from "./GameData";
import { ItemHover, ItemIcon } from "./ItemTooltip";
import { NumberField } from "./NumberField";
import { CraftOrders, type OrderPrefill } from "./CraftOrders";
import { useSite } from "../site";
import { LinkCodeBox } from "./DiscordLink";
import { TemplateChannel, useRaidTemplates } from "./TemplateChannel";

/**
 * Sections de l'administration d'une guilde et onglet Artisans, communs à Roster (pages/GroupPage.tsx) et à Forever Roster
 * (pages/GuildPages.tsx) : nom, invitations, salons Discord et relances, qui crée, journal, suppression, « Qui crafte quoi ? ».
 */

export interface Invite { id: string; maxUses: number; uses: number; expiresAt: string; createdAt: string }
export interface GroupEvent { id: number; type: string; actor: string | null; meta: Record<string, unknown>; createdAt: string }

export const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
export const EVENT_LABEL: Record<string, string> = {
  group_created: "a créé la guilde", group_renamed: "a renommé la guilde", group_joined: "a rejoint la guilde", group_left: "a quitté la guilde",
  group_member_removed: "a retiré un membre", group_role_changed: "a changé un rôle", invite_created: "a créé une invitation",
  invite_revoked: "a révoqué une invitation", raid_created: "a créé un raid", raid_deleted: "a supprimé un raid",
  raid_template_created: "a créé un raid récurrent", raid_template_updated: "a modifié un raid récurrent", raid_template_deleted: "a supprimé un raid récurrent",
  raid_roster_published: "a publié une compo sur Discord", raid_roster_unpublished: "a retiré une compo de Discord",
  group_discord_linked: "a lié un salon Discord", group_discord_unlinked: "a délié le salon Discord",
  template_discord_linked: "a lié un salon Discord à un raid récurrent", template_discord_unlinked: "a rendu un raid récurrent au salon de la guilde",
  group_character_changed: "a modifié les persos d'un membre", group_loot_settings: "a changé les réglages du butin", loot_history_imported: "a importé un historique de butin",
  group_nudge_settings: "a changé les relances Discord", raid_nudged: "a relancé les sans-réponse", raid_ask_sent: "a demandé à un joueur de venir",
  group_feedback_linked: "a relié les avis d'un serveur Discord", group_feedback_unlinked: "a retiré les avis d'un serveur Discord",
  group_outings_linked: "a lié le salon des sorties", group_outings_unlinked: "a délié le salon des sorties", group_creators: "a changé qui crée les raids et les sorties",
  // Lot « Guilde » (Forever) : guilde du jeu, annonces de la course, mains et alts
  guild_linked: "a lié la guilde du jeu", guild_unlinked: "a délié la guilde du jeu", guild_announces: "a changé les annonces de la Course au 60",
  guild_member_linked: "a rattaché un perso", guild_member_unlinked: "a détaché un perso",
};
const ANNOUNCE_LABEL: Record<string, string> = { none: "rien", sixty: "les 60 seulement", tens: "tous les 10 niveaux" };
/** Détail d'une ligne du journal : nom, guilde du jeu, perso, réglage. */
export function eventDetail(e: GroupEvent) {
  const m = e.meta;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  if (e.type === "group_renamed" && str("from") && str("to")) return ` · ${str("from")} → ${str("to")}`;
  if (e.type === "guild_linked") return ` · ${str("guild") ?? "?"}${m.auto === true ? " (à son premier relevé)" : ""}${str("replaced") ? `, à la place de ${str("replaced")}` : ""}`;
  if (e.type === "guild_unlinked") return ` · ${str("guild") ?? "?"}`;
  if (e.type === "guild_announces") return ` · ${ANNOUNCE_LABEL[str("announce") ?? ""] ?? str("announce") ?? ""}`;
  if (e.type === "guild_member_linked") return ` · ${str("character") ?? "?"}${m.note === true ? " (note de guilde)" : str("to") === "new" ? " (joueur à part)" : ""}`;
  if (e.type === "guild_member_unlinked") return ` · ${str("character") ?? "?"}`;
  return str("name") ? ` · ${str("name")}` : "";
}


/** Titre du groupe, modifiable sur place par les officiers et le propriétaire. */
export function GroupName({ name, onSave }: { name: string; onSave: (name: string) => Promise<void> }) {
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
        <label htmlFor="g-name">Nom de la guilde</label>
        <input id="g-name" type="text" required minLength={2} maxLength={48} autoFocus value={value}
          onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Escape") cancel(); }} />
      </div>
      <button className="btn primary sm" type="submit" disabled={saving || value.trim().length < 2}>Enregistrer</button>
      <button className="btn ghost sm" type="button" onClick={cancel}>Annuler</button>
    </form>
  );
}

export function DeleteGroup({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm
    ? <span className="row small">Supprimer la guilde, ses raids et ses invitations ? <button className="btn danger sm" type="button" onClick={onDelete}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirm(false)}>Annuler</button></span>
    : <button className="btn ghost sm" type="button" onClick={() => setConfirm(true)}>Supprimer la guilde</button>;
}

export type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** « Qui crafte quoi ? » : les patrons connus et recherchés par les persos du groupe. */
export function Crafters({ groupId, myId }: { groupId: string; myId?: string }) {
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

export function Journal({ groupId }: { groupId: string }) {
  const { data } = useQuery({ queryKey: ["group-audit", groupId], queryFn: () => get<{ events: GroupEvent[] }>(`/groups/${groupId}/audit`) });
  if (!data) return <p className="muted">Chargement…</p>;
  if (!data.events.length) return <p className="muted" style={{ margin: 0 }}>Rien pour l'instant : les actions des officiers (invitations, raids, réglages) s'afficheront ici.</p>;
  return (
    <div className="tscroll"><table className="data">
      <thead><tr><th>Date</th><th>Qui</th><th>Action</th></tr></thead>
      <tbody>{data.events.map(e => (
        <tr key={e.id}><td className="small muted">{fmt.format(new Date(e.createdAt))}</td><td>{e.actor ?? (typeof e.meta.by === "string" ? `${e.meta.by} (Discord)` : "Compte supprimé")}</td><td>{EVENT_LABEL[e.type] ?? e.type}{eventDetail(e)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

export function Invites({ groupId, guard }: { groupId: string; guard: Guard }) {
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

/** État d'un salon lié : son nom (#raids) quand le site le connaît, sinon « Lié ». */
export function ChannelTag({ linked, name }: { linked: boolean; name: string | null }) {
  if (!linked) return <span className="tag">Non lié</span>;
  return name ? <span className="tag ok chan" title={`#${name}`}>#{name}</span> : <span className="tag ok">Lié</span>;
}

/** Liaison du groupe à un salon Discord : code à usage unique à taper avec /forever-lier (ou /roster-lier) dans le salon voulu. */
export function DiscordChannel({ groupId, linked, name, hasDiscord, guard }: { groupId: string; linked: boolean; name: string | null; hasDiscord: boolean; guard: Guard }) {
  const game = useSite().game;
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [wantCode, setWantCode] = useState(false);
  return (
    <section className="stack admin-sec" aria-labelledby="dc-title">
      <div className="row between">
        <h3 id="dc-title" style={{ margin: 0 }}>Salon Discord</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Le bot publie chaque raid à venir dans ce salon, avec des boutons d'inscription. Les inscriptions faites sur Discord et sur le site sont les mêmes.
        Les joueurs sans compte peuvent aussi s'inscrire (classe et spé), marqués ✱.
      </p>
      <p className="hint" style={{ margin: 0 }}>Un raid récurrent peut aussi avoir son propre salon, renommé chaque semaine avec la date du raid : voir ci-dessous.{game === "forever" && " Les sorties donjon y sont aussi annoncées tant que leur salon n'est pas lié."}</p>
      {!hasDiscord && (!linked || wantCode) && <div className="alert info">Pour lier un salon, lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn primary sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/code`));
        }); }}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>Délier le salon</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game={game} code={code} intro="Dans le salon Discord voulu, tape cette commande" label="Commande de liaison"
        footer={<span className="small muted">Une fois le salon lié, recharge cette page.</span>} />}
      <TemplateChannels groupId={groupId} groupLinked={linked} guard={guard} />
      <NudgeSettings groupId={groupId} linked={linked} guard={guard} />
    </section>
  );
}

/**
 * Salon de chaque raid récurrent (le même réglage que dans l'onglet Raids, « ↻ Récurrents ») : tous les salons Discord
 * du groupe au même endroit.
 */
export function TemplateChannels({ groupId, groupLinked, guard }: { groupId: string; groupLinked: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const { data } = useRaidTemplates(groupId);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raid-templates", groupId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);
  if (!data) return null;
  return (
    <section className="stack" aria-labelledby="rc-title" style={{ gap: 8, borderTop: "1px dashed var(--line-2)", paddingTop: 12 }}>
      <h4 id="rc-title" style={{ margin: 0 }}>Salons des raids récurrents</h4>
      {data.templates.length === 0
        ? <p className="hint" style={{ margin: 0 }}>Aucun raid récurrent. Pour en créer un, coche «&nbsp;Chaque semaine&nbsp;» en créant un raid (<Link to={`/groups/${groupId}/raids`}>onglet Raids</Link>).</p>
        : data.templates.map(t => (
          <div key={t.id} className={`gr-recrow${t.active ? "" : " off"}`}>
            <span><b>{t.name}</b> <span className="muted">chaque {WEEKDAYS[t.weekday - 1]?.toLowerCase()} {t.time}</span>
              {!t.active && <span className="tag" style={{ marginLeft: 6 }}>En pause</span>}</span>
            <TemplateChannel groupId={groupId} t={t} canEdit guard={guard} refresh={refresh} groupLinked={groupLinked} />
          </div>
        ))}
    </section>
  );
}

/** Salon Discord des commandes d'artisanat (lot F) : même liaison par code que le salon des raids. */
export function OrdersChannel({ groupId, linked, name, hasDiscord, guard }: { groupId: string; linked: boolean; name: string | null; hasDiscord: boolean; guard: Guard }) {
  const game = useSite().game;
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [wantCode, setWantCode] = useState(false);
  return (
    <section className="stack admin-sec" aria-labelledby="oc-title">
      <div className="row between">
        <h3 id="oc-title" style={{ margin: 0 }}>Salon des commandes d'artisanat</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>Facultatif. Le bot y poste chaque commande de l'onglet Artisans avec un bouton « Je m'en charge », et met le message à jour quand elle est prise ou faite.</p>
      {!hasDiscord && wantCode && <div className="alert info">Lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/orders-code`));
        }); }}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord/orders`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>Délier le salon</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game={game} code={code} intro="Dans le salon Discord des commandes, tape cette commande" label="Commande de liaison du salon des commandes" />}
    </section>
  );
}

/** Salon des sorties donjon (Forever) : facultatif, lié par code comme celui des commandes ; sans lui, le salon du groupe. */
export function OutingsChannel({ groupId, linked, name, hasDiscord, guard }: { groupId: string; linked: boolean; name: string | null; hasDiscord: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [wantCode, setWantCode] = useState(false);
  return (
    <section className="stack admin-sec" aria-labelledby="sc-title">
      <div className="row between">
        <h3 id="sc-title" style={{ margin: 0 }}>Salon des sorties</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>{linked
        ? "Une annonce par sortie donjon, avec des boutons pour s'inscrire ; elle est effacée 2 h après l'heure de la sortie."
        : "Facultatif. Sans lui, les sorties vont dans le salon de la guilde."}</p>
      {!hasDiscord && wantCode && <div className="alert info">Lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      <div className="row">
        <button className="btn sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/outings-code`));
        }); }}>{linked ? "Changer de salon" : "Générer un code de liaison"}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord/outings`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>Délier le salon</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game="forever" code={code} intro="Dans le salon Discord des sorties, tape cette commande" label="Commande de liaison du salon des sorties" />}
    </section>
  );
}

/** Qui peut créer les raids et les sorties (site, /raid et /sortie) : les officiers, ou tous les membres. */
export function CreatorsSettings({ groupId, creators, guard }: { groupId: string; creators: { raids: Creators; outings: Creators }; guard: Guard }) {
  const qc = useQueryClient();
  const forever = useSite().game === "forever";
  const save = (b: Partial<{ raids: Creators; outings: Creators }>) => void guard(async () => {
    await put(`/groups/${groupId}/creators`, b);
    await qc.invalidateQueries({ queryKey: ["group", groupId] });
  });
  const seg = (label: string, value: Creators, on: (v: Creators) => void) => (
    <div className="seg" role="group" aria-label={label}>
      {([["officers", "Officiers"], ["members", "Tous les membres"]] as const).map(([k, l]) => (
        <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => value !== k && on(k)}>{l}</button>
      ))}
    </div>
  );
  return (
    <section className="stack admin-sec" aria-labelledby="cr-title">
      <h3 id="cr-title" style={{ margin: 0 }}>{forever ? "Qui crée les raids et les sorties" : "Qui crée les raids"}</h3>
      <div className="cr-set">
        <span>Qui peut créer des raids</span>{seg("Qui peut créer des raids", creators.raids, v => save({ raids: v }))}
        {forever && <><span>Qui peut créer des sorties</span>{seg("Qui peut créer des sorties", creators.outings, v => save({ outings: v }))}</>}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Sur le site comme sur Discord ({forever ? "/raid et /sortie" : "/raid"}).{forever && " Une sortie se modifie ou s'annule par son créateur et par les officiers."} Un raid se modifie par les officiers ; un raid récurrent se crée par les officiers.
      </p>
    </section>
  );
}

/** Relance en MP des membres qui n'ont pas répondu (lot D2), et liste envoyée aux officiers. */
export function NudgeSettings({ groupId, linked, guard }: { groupId: string; linked: boolean; guard: Guard }) {
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
