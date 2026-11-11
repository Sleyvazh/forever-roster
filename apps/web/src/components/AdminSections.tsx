import { gameName, SKILL_LINE_NAMES, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { del, get, post, put, type Creators, type CraftersRecipe } from "../api";
import { CRAFTING } from "./GameData";
import { colon, dateLocale, N, t, tn, tx } from "../i18n";
import { ItemHover, ItemIcon } from "./ItemTooltip";
import { NumberField } from "./NumberField";
import { CraftOrders, type OrderPrefill } from "./CraftOrders";
import { useSite } from "../site";
import { LinkCodeBox, linkCommand } from "./DiscordLink";
import { TemplateChannel, useRaidTemplates } from "./TemplateChannel";
import { signupLabel } from "../i18n/game";
import { dayLong } from "../i18n/dates";

/**
 * Sections de l'administration d'une guilde et onglet Artisans, communs à Roster (pages/GroupPage.tsx) et à Forever Roster
 * (pages/GuildPages.tsx) : nom, invitations, salons Discord et relances, qui crée, journal, suppression, « Qui crafte quoi ? ».
 */

export interface Invite { id: string; maxUses: number; uses: number; expiresAt: string; createdAt: string }
export interface GroupEvent { id: number; type: string; actor: string | null; meta: Record<string, unknown>; createdAt: string }

export const fmt = { format: (d: Date) => new Intl.DateTimeFormat(dateLocale(), { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(d) };
export const EVENT_LABEL: Record<string, string> = {
  group_created: N("a créé la guilde"), group_renamed: N("a renommé la guilde"), group_joined: N("a rejoint la guilde"), group_left: N("a quitté la guilde"),
  group_member_removed: N("a retiré un membre"), group_role_changed: N("a changé un rôle"), invite_created: N("a créé une invitation"),
  invite_revoked: N("a révoqué une invitation"), raid_created: N("a créé un raid"), raid_deleted: N("a supprimé un raid"),
  raid_template_created: N("a créé un raid récurrent"), raid_template_updated: N("a modifié un raid récurrent"), raid_template_deleted: N("a supprimé un raid récurrent"),
  raid_roster_published: N("a publié une compo sur Discord"), raid_roster_unpublished: N("a retiré une compo de Discord"),
  group_discord_linked: N("a lié un salon Discord"), group_discord_unlinked: N("a délié le salon Discord"),
  template_discord_linked: N("a lié un salon Discord à un raid récurrent"), template_discord_unlinked: N("a rendu un raid récurrent au salon de la guilde"),
  group_character_changed: N("a modifié les persos d'un membre"), group_loot_settings: N("a changé les réglages du butin"), loot_history_imported: N("a importé un historique de butin"),
  group_nudge_settings: N("a changé les relances Discord"), raid_nudged: N("a relancé les sans-réponse"), raid_ask_sent: N("a demandé à un joueur de venir"),
  group_feedback_linked: N("a relié les avis d'un serveur Discord"), group_feedback_unlinked: N("a retiré les avis d'un serveur Discord"),
  group_outings_linked: N("a lié le salon des sorties"), group_outings_unlinked: N("a délié le salon des sorties"), group_creators: N("a changé qui crée les raids et les sorties"),
  // Lot « Guilde » (Forever) : guilde du jeu, annonces de la course, mains et alts
  guild_linked: N("a lié la guilde du jeu"), guild_unlinked: N("a délié la guilde du jeu"), guild_announces: N("a changé les annonces de la Course au 60"),
  guild_member_linked: N("a rattaché un perso"), guild_member_unlinked: N("a détaché un perso"),
  // Banque de la guilde : un banquier traite les demandes de retrait
  banker_set: N("a nommé un banquier"), banker_unset: N("a retiré un banquier"),
  // Copier-coller facultatif : inscription faite en jeu par un joueur, transmise par un officier (l'acteur est l'officier)
  signup_relayed: N("a transmis une inscription faite en jeu"),
  // Niveau des fiches : une fiche introuvable dans la liste du jeu, niveau fixé par un officier (ou rendu au joueur)
  character_level_fixed: N("a corrigé le niveau d'un perso"), character_level_released: N("a rendu la main sur le niveau d'un perso"),
  // Fiches (8/11) : un officier crée la fiche d'un joueur ; une fiche passe sur le compte d'un autre membre
  character_created_for: N("a créé la fiche d'un joueur"), character_given: N("a donné une fiche"),
};
const ANNOUNCE_LABEL: Record<string, string> = { none: "rien", sixty: N("les 60 seulement"), tens: N("tous les 10 niveaux") };
/** Jour court d'un raid dans le journal (« ven. 14/11 »), à l'heure de Paris. */
const RELAY_DAY = { format: (d: Date) => new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" }).format(d) };
/** Détail d'une ligne du journal : nom, guilde du jeu, perso, réglage, inscription transmise. */
export function eventDetail(e: GroupEvent) {
  const m = e.meta;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  if (e.type === "group_renamed" && str("from") && str("to")) return ` · ${str("from")} → ${str("to")}`;
  if (e.type === "guild_linked") return ` · ${str("guild") ?? "?"}${m.auto === true ? t(" (à son premier relevé)") : ""}${str("replaced") ? t(", à la place de {name}", { name: str("replaced")! }) : ""}`;
  if (e.type === "guild_unlinked") return ` · ${str("guild") ?? "?"}`;
  if (e.type === "guild_announces") { const a = ANNOUNCE_LABEL[str("announce") ?? ""]; return ` · ${a ? t(a) : str("announce") ?? ""}`; }
  if (e.type === "guild_member_linked") return ` · ${str("character") ?? "?"}${m.note === true ? t(" (note de guilde)") : str("to") === "new" ? t(" (joueur à part)") : ""}`;
  if (e.type === "guild_member_unlinked") return ` · ${str("character") ?? "?"}`;
  if (e.type === "character_level_fixed") {
    const from = typeof m.from === "number" ? m.from : null, to = typeof m.to === "number" ? m.to : null;
    return ` · ${str("character") ?? "?"}${to !== null ? `${colon()}${from !== null ? `${from} → ` : ""}${to}` : ""}`;
  }
  if (e.type === "character_level_released") return ` · ${str("character") ?? "?"}`;
  if (e.type === "character_created_for") {
    const lv = typeof m.level === "number" ? m.level : null;
    return ` · ${str("character") ?? "?"}${str("cls") || lv !== null ? ` (${[str("cls"), lv].filter(x => x !== null && x !== "").join(" ")})` : ""}${t(", pour {name}", { name: str("targetName") ?? "?" })}`;
  }
  if (e.type === "character_given") return ` · ${str("character") ?? "?"}${colon()}${str("fromName") ?? "?"} → ${str("targetName") ?? "?"}`;
  if (e.type === "signup_relayed") {
    // « · Greta : Peut-être (Onyxia, ven. 14/11) » : prénom du perso, réponse, raid et sa date (absente si le raid n'en a pas)
    const status = str("status"), at = str("at");
    const day = at && !Number.isNaN(Date.parse(at)) ? `, ${RELAY_DAY.format(new Date(at))}` : "";
    return ` · ${gameName(str("character") ?? "") || "?"}${colon()}${status ? signupLabel(status as SignupStatus) ?? status : "?"} (${str("raid") ?? "?"}${day})`;
  }
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
      <button className="btn ghost sm" type="button" onClick={() => setEditing(true)}>{t("Renommer")}</button>
    </div>
  );
  return (
    <form className="row" onSubmit={e => void submit(e)} style={{ alignItems: "flex-end", marginTop: 6 }}>
      <div className="fld" style={{ flex: "1 1 240px" }}>
        <label htmlFor="g-name">{t("Nom de la guilde")}</label>
        <input id="g-name" type="text" required minLength={2} maxLength={48} autoFocus value={value}
          onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Escape") cancel(); }} />
      </div>
      <button className="btn primary sm" type="submit" disabled={saving || value.trim().length < 2}>{t("Enregistrer")}</button>
      <button className="btn ghost sm" type="button" onClick={cancel}>{t("Annuler")}</button>
    </form>
  );
}

export function DeleteGroup({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return confirm
    ? <span className="row small">{t("Supprimer la guilde, ses raids et ses invitations ?")} <button className="btn danger sm" type="button" onClick={onDelete}>{t("Supprimer")}</button><button className="btn ghost sm" type="button" onClick={() => setConfirm(false)}>{t("Annuler")}</button></span>
    : <button className="btn ghost sm" type="button" onClick={() => setConfirm(true)}>{t("Supprimer la guilde")}</button>;
}

export type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** « Qui crafte quoi ? » : les patrons connus et recherchés par les persos du groupe. */
export function Crafters({ groupId, myId }: { groupId: string; myId?: string }) {
  const [input, setInput] = useState(""), [q, setQ] = useState(""), [prof, setProf] = useState("");
  const [prefill, setPrefill] = useState<OrderPrefill | null>(null);
  useEffect(() => { const timer = window.setTimeout(() => setQ(input.trim()), 300); return () => window.clearTimeout(timer); }, [input]);
  const params = new URLSearchParams({ ...(q.length >= 2 && { q }), ...(prof && { profession: prof }) });
  const { data, isLoading } = useQuery({
    queryKey: ["crafters", groupId, q, prof],
    queryFn: () => get<{ recipes: CraftersRecipe[]; total: number }>(`/groups/${groupId}/crafters?${params}`),
  });
  const names = (list: { name: string; owner: string }[]) => list.map(w => `${w.name} (${w.owner})`).join(", ");
  return (
    <div className="sec">
      <CraftOrders groupId={groupId} myId={myId} prefill={prefill} />
      <h3 style={{ margin: "8px 0 0" }}>{t("Qui crafte quoi ?")}</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="cr-q">{t("Recette ou objet")}</label>
          <input id="cr-q" type="search" placeholder={t("Warbear Woolies, Flask…")} value={input} onChange={e => setInput(e.target.value)} />
        </div>
        <div className="fld" style={{ flex: "1 1 160px" }}><label htmlFor="cr-p">{t("Métier")}</label>
          <select id="cr-p" value={prof} onChange={e => setProf(e.target.value)}>
            <option value="">{t("Tous")}</option>{[...CRAFTING].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? <p className="muted">{t("Chargement…")}</p> : !data?.recipes.length ? (
        <p className="muted">{q || prof ? t("Aucun membre n'a renseigné cette recette.") : t("Aucun patron renseigné pour l'instant. Chaque joueur les coche dans l'onglet Métiers de ses persos.")}</p>
      ) : (
        <div className="tscroll"><table className="data">
          <thead><tr><th>{t("Recette")}</th><th>{t("Métier")}</th><th>{t("Sait la faire")}</th><th>{t("La recherche")}</th><th /></tr></thead>
          <tbody>{data.recipes.map(r => (
            <tr key={r.spellId}>
              <td><ItemHover item={r.item} className="with-icon" link>{r.item && <ItemIcon item={r.item} size={22} />}<span className={r.item ? `q${r.item.quality}` : ""}>{r.name}</span></ItemHover>{r.enchant && <span className="muted small"> · {r.enchant}</span>}</td>
              <td className="small">{SKILL_LINE_NAMES[r.skillLine] ?? "?"} <span className="muted num">{r.reqSkill}</span></td>
              <td>{r.known.length ? names(r.known) : <span className="muted">—</span>}</td>
              <td className="small">{r.wanted.length ? names(r.wanted) : <span className="muted">—</span>}</td>
              <td>{r.known.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { setPrefill({ spellId: r.spellId, name: r.item?.name ?? r.name, key: Date.now() }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("Commander")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && data.total > data.recipes.length && <p className="hint">{tn(data.total, "{n} recette : affine la recherche pour voir la suite.", "{n} recettes : affine la recherche pour voir la suite.")}</p>}
    </div>
  );
}

export function Journal({ groupId }: { groupId: string }) {
  const { data } = useQuery({ queryKey: ["group-audit", groupId], queryFn: () => get<{ events: GroupEvent[] }>(`/groups/${groupId}/audit`) });
  if (!data) return <p className="muted">{t("Chargement…")}</p>;
  if (!data.events.length) return <p className="muted" style={{ margin: 0 }}>{t("Rien pour l'instant : les actions des officiers (invitations, raids, réglages) s'afficheront ici.")}</p>;
  return (
    <div className="tscroll"><table className="data">
      <thead><tr><th>{t("Date")}</th><th>{t("Qui")}</th><th>{t("Action")}</th></tr></thead>
      <tbody>{data.events.map(e => (
        <tr key={e.id}><td className="small muted">{fmt.format(new Date(e.createdAt))}</td><td>{e.actor ?? (typeof e.meta.by === "string" ? `${e.meta.by} (Discord)` : t("Compte supprimé"))}</td><td>{EVENT_LABEL[e.type] ? t(EVENT_LABEL[e.type]!) : e.type}{eventDetail(e)}</td></tr>
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
      <h3>{t("Invitations")}</h3>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-uses">{t("Utilisations max")}</label><NumberField id="i-uses" min={1} max={100} value={maxUses} onChange={setMaxUses} /></div>
        <div className="fld" style={{ width: 140 }}><label htmlFor="i-h">{t("Valable (heures)")}</label><NumberField id="i-h" min={1} max={720} step={24} value={hours} onChange={setHours} /></div>
        <button className="btn primary" type="button" onClick={() => void guard(async () => {
          const r = await post<{ invite: { url: string } }>(`/groups/${groupId}/invites`, { maxUses, expiresInHours: hours });
          setLink(r.invite.url); setCopied(false); await refresh();
        })}>{t("Créer un lien")}</button>
      </div>
      {link && (
        <div className="alert info stack" style={{ gap: 8 }}>
          <span>{t("Copie ce lien maintenant : pour des raisons de sécurité, il ne sera plus affiché.")}</span>
          <div className="row"><input type="text" readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label={t("Lien d'invitation")} style={{ flex: 1 }} />
            <button className="btn sm" type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? t("Copié") : t("Copier")}</button></div>
        </div>
      )}
      {!!data?.invites.length && (
        <div className="tscroll"><table className="data">
          <thead><tr><th>{t("Créée")}</th><th>{t("Utilisations")}</th><th>{t("Expire")}</th><th /></tr></thead>
          <tbody>{data.invites.map(i => (
            <tr key={i.id}><td className="small">{fmt.format(new Date(i.createdAt))}</td><td className="num">{i.uses}/{i.maxUses}</td><td className="small">{fmt.format(new Date(i.expiresAt))}</td>
              <td><button className="btn ghost sm" type="button" onClick={() => void guard(async () => { await del(`/groups/${groupId}/invites/${i.id}`); await refresh(); })}>{t("Révoquer")}</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

/** État d'un salon lié : son nom (#raids) quand le site le connaît, sinon « Lié ». */
export function ChannelTag({ linked, name }: { linked: boolean; name: string | null }) {
  if (!linked) return <span className="tag">{t("Non lié")}</span>;
  return name ? <span className="tag ok chan" title={`#${name}`}>#{name}</span> : <span className="tag ok">{t("Lié")}</span>;
}

/**
 * En tête de l'administration Discord : le lien pour inviter le bot sur son serveur (GET /api/discord/invite, qui renvoie
 * vers Discord), puis la suite : lier un salon avec le code du bouton juste en dessous. À n'afficher que tant que le salon
 * des raids du groupe n'est pas lié : le bot est alors déjà sur le serveur, et le bouton du dessous s'appelle « Changer de salon ».
 */
export function AddBot() {
  const game = useSite().game;
  return (
    <section className="stack admin-sec" aria-label={t("Ajouter le bot à ton serveur Discord")}>
      <div className="av-src">
        <span className="av-ico" aria-hidden="true">D</span>
        <div className="stack" style={{ flex: "1 1 260px", minWidth: 0, gap: 3 }}>
          <b>{t("Le bot n'est pas encore sur ton serveur Discord ?")}</b>
          <p className="small muted" style={{ margin: 0 }}>
            {tx("Ensuite, tape {el} dans le salon voulu : le code vient de « Générer un code de liaison », juste en dessous.", { el: <code>{linkCommand(game)} &lt;code&gt;</code> })}</p>
        </div>
        <a className="btn discord" href="/api/discord/invite" target="_blank" rel="noopener noreferrer">{t("Ajouter le bot")}</a>
      </div>
    </section>
  );
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
        <h3 id="dc-title" style={{ margin: 0 }}>{t("Salon Discord")}</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t("Le bot publie chaque raid à venir dans ce salon, avec des boutons d'inscription. Les inscriptions faites sur Discord et sur le site sont les mêmes. Les joueurs sans compte peuvent aussi s'inscrire (classe et spé), marqués ✱.")}</p>
      <p className="hint" style={{ margin: 0 }}>{t("Un raid récurrent peut aussi avoir son propre salon, renommé chaque semaine avec la date du raid : voir ci-dessous.")}{game === "forever" && t(" Les sorties donjon y sont aussi annoncées tant que leur salon n'est pas lié.")}</p>
      {!hasDiscord && (!linked || wantCode) && <div className="alert info">{tx("Pour lier un salon, lie d'abord ton propre Discord dans {el} : le bot vérifie que c'est bien un officier qui tape la commande.", { el: <Link to="/account">{t("Compte & sécurité")}</Link> })}</div>}
      <div className="row">
        <button className="btn primary sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/code`));
        }); }}>{linked ? t("Changer de salon") : t("Générer un code de liaison")}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>{t("Délier le salon")}</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game={game} code={code} intro={t("Dans le salon Discord voulu, tape cette commande")} label={t("Commande de liaison")}
        footer={<span className="small muted">{t("Une fois le salon lié, recharge cette page.")}</span>} />}
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
      <h4 id="rc-title" style={{ margin: 0 }}>{t("Salons des raids récurrents")}</h4>
      {data.templates.length === 0
        ? <p className="hint" style={{ margin: 0 }}>{tx("Aucun raid récurrent. Pour en créer un, coche « Chaque semaine » en créant un raid ({el}).", { el: <Link to={`/groups/${groupId}/raids`}>{t("onglet Raids")}</Link> })}</p>
        : data.templates.map(tpl => (
          <div key={tpl.id} className={`gr-recrow${tpl.active ? "" : " off"}`}>
            <span><b>{tpl.name}</b> <span className="muted">{t("chaque {day} {time}", { day: dayLong(tpl.weekday), time: tpl.time })}</span>
              {!tpl.active && <span className="tag" style={{ marginLeft: 6 }}>{t("En pause")}</span>}</span>
            <TemplateChannel groupId={groupId} t={tpl} canEdit guard={guard} refresh={refresh} groupLinked={groupLinked} />
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
        <h3 id="oc-title" style={{ margin: 0 }}>{t("Salon des commandes d'artisanat")}</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>{t("Facultatif. Le bot y poste chaque commande de l'onglet Artisans avec un bouton « Je m'en charge », et met le message à jour quand elle est prise ou faite.")}</p>
      {!hasDiscord && wantCode && <div className="alert info">{tx("Lie d'abord ton propre Discord dans {el} : le bot vérifie que c'est bien un officier qui tape la commande.", { el: <Link to="/account">{t("Compte & sécurité")}</Link> })}</div>}
      <div className="row">
        <button className="btn sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/orders-code`));
        }); }}>{linked ? t("Changer de salon") : t("Générer un code de liaison")}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord/orders`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>{t("Délier le salon")}</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game={game} code={code} intro={t("Dans le salon Discord des commandes, tape cette commande")} label={t("Commande de liaison du salon des commandes")} />}
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
        <h3 id="sc-title" style={{ margin: 0 }}>{t("Salon des sorties")}</h3>
        <ChannelTag linked={linked} name={name} />
      </div>
      <p className="hint" style={{ margin: 0 }}>{linked
        ? t("Une annonce par sortie donjon, avec des boutons pour s'inscrire ; elle est effacée 2 h après l'heure de la sortie.")
        : t("Facultatif. Sans lui, les sorties vont dans le salon de la guilde.")}</p>
      {!hasDiscord && wantCode && <div className="alert info">{tx("Lie d'abord ton propre Discord dans {el} : le bot vérifie que c'est bien un officier qui tape la commande.", { el: <Link to="/account">{t("Compte & sécurité")}</Link> })}</div>}
      <div className="row">
        <button className="btn sm" type="button" onClick={() => { setWantCode(true); if (hasDiscord) void guard(async () => {
          setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/discord/outings-code`));
        }); }}>{linked ? t("Changer de salon") : t("Générer un code de liaison")}</button>
        {linked && <button className="btn ghost sm" type="button" onClick={() => void guard(async () => {
          await del(`/groups/${groupId}/discord/outings`); setCode(null);
          await qc.invalidateQueries({ queryKey: ["group", groupId] });
        })}>{t("Délier le salon")}</button>}
      </div>
      {code && <LinkCodeBox key={code.code} game="forever" code={code} intro={t("Dans le salon Discord des sorties, tape cette commande")} label={t("Commande de liaison du salon des sorties")} />}
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
      {([["officers", t("Officiers")], ["members", t("Tous les membres")]] as const).map(([k, l]) => (
        <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => value !== k && on(k)}>{l}</button>
      ))}
    </div>
  );
  return (
    <section className="stack admin-sec" aria-labelledby="cr-title">
      <h3 id="cr-title" style={{ margin: 0 }}>{forever ? t("Qui crée les raids et les sorties") : t("Qui crée les raids")}</h3>
      <div className="cr-set">
        <span>{t("Qui peut créer des raids")}</span>{seg(t("Qui peut créer des raids"), creators.raids, v => save({ raids: v }))}
        {forever && <><span>{t("Qui peut créer des sorties")}</span>{seg(t("Qui peut créer des sorties"), creators.outings, v => save({ outings: v }))}</>}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {forever ? tx("Sur le site comme sur Discord ({raid} et {outing}).", { raid: "/raid", outing: "/sortie" }) : tx("Sur le site comme sur Discord ({raid}).", { raid: "/raid" })}
        {forever && t(" Une sortie se modifie ou s'annule par son créateur et par les officiers.")} {t("Un raid se modifie par les officiers ; un raid récurrent se crée par les officiers.")}
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
      <h4 style={{ margin: 0 }}>{t("Relances")}</h4>
      <div className="rr-set">
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.hours !== null} disabled={!linked} onChange={e => save({ hours: e.target.checked ? 48 : null })} />
          {t("Relancer en MP ceux qui n'ont pas répondu")}</label>
        <select aria-label={t("Délai de la relance")} value={s.hours ?? ""} disabled={!linked || s.hours === null} onChange={e => save({ hours: Number(e.target.value) as 24 | 48 | 72 })}>
          {s.hours === null && <option value="">—</option>}
          <option value={24}>{t("24 h avant")}</option><option value={48}>{t("48 h avant")}</option><option value={72}>{t("72 h avant")}</option>
        </select>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.officers} disabled={!linked || s.hours === null} onChange={e => save({ officers: e.target.checked })} />
          {t("Prévenir les officiers (liste des sans-réponse en MP)")}</label>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t("Une relance automatique par raid, aux membres sans aucune réponse qui ont lié leur Discord. Sur la page d'un raid, « Relancer maintenant » est possible une fois par heure, et la compo assistée propose « Demander » pour inviter un joueur précis.")}{!linked && t(" Il faut d'abord lier un salon.")}
      </p>
    </div>
  );
}
