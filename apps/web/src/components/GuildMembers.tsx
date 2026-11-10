import { CLASS_NAMES, isValidCombo, RACE_NAMES, zonedParts, type GuildChar, type GuildMembersResponse, type GuildMove, type GuildPlayer, type GuildQuestion } from "@forever/game-data";
import { useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, del, patch, post, put, type GroupRole, type Member } from "../api";
import { useGameText } from "../gameText";
import { activeWithin, agoText, dayKey, dayMonth, fetchHistory, GUILD_QUERY_ROOTS, guildKeys, longDay, seenText, shortDay, useGuildLink, useGuildMembers } from "../guild";
import { useViewPref } from "../prefs";
import { useMe } from "../auth";
import { siteRights, SiteMembers } from "./GroupMembers";
import { GroupCharacters } from "./GroupRoster";
import { CharName, GuildRace } from "./GuildRace";
import { Portrait } from "./ImageUpload";
import { DialogHead, Modal } from "./Dialog";
import { ClassDot } from "./Outings";
import { PlayerSheet } from "./PlayerSheet";
import { RowMenu } from "./RowMenu";

import { N, t, tn, tx } from "../i18n";
/**
 * Page Guilde de Forever (lot « Guilde », refonte du 23/10) : Membres, Course au 60 et Historique (journal de guilde).
 * Membres (disposition A, 31/10) : une barre fixe en haut, « Par perso / Par joueur » à gauche et, en Par perso avec la
 * guilde du jeu liée, « Liste du jeu / Fiches du site » à droite ; Par perso d'abord. Par joueur : main et alts, bande
 * « À rattacher » des officiers, comptes du site ; Par perso : la liste de guilde du jeu, ou les fiches du site.
 * Les deux choix sont retenus dans le navigateur (guild-by, guild-chars-mode). Adresses : /groups/:id/membres (la vue
 * retenue), /membres/persos et /membres/joueurs (forcent la vue sans changer le choix retenu), ?vue=jeu|fiches (force le
 * mode), ?perso=<id> (ouvre toujours les fiches : ?vue=fiches s'ajoute à l'adresse), /membres/course, /membres/historique.
 * Données : GET /api/groups/:id/guild (types dans packages/game-data/src/guild.ts). Mains et alts : le lien d'un officier
 * prime ; « Est-ce ton perso ? » au joueur concerné.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
/** « membres » : la vue retenue (Par perso ou Par joueur) ; « persos » et « joueurs » la forcent. */
export type GuildView = "membres" | "joueurs" | "persos" | "course" | "historique";
type GuildBy = "persos" | "joueurs";
type CharsMode = "jeu" | "fiches";
const BY_VALUES: readonly GuildBy[] = ["persos", "joueurs"];
const MODE_VALUES: readonly CharsMode[] = ["jeu", "fiches"];

/** Barre fixe de Membres : « Par perso / Par joueur » à gauche, « Liste du jeu / Fiches du site » à droite (Par perso, guilde liée). */
function MembersBar({ by, onBy, mode, onMode }: { by: GuildBy; onBy: (b: GuildBy) => void; mode?: CharsMode; onMode: (m: CharsMode) => void }) {
  return (
    <div className="gm-bar">
      <div className="seg eq gm-by" role="group" aria-label={t("Par perso ou par joueur")}>
        <button type="button" className={by === "persos" ? "on" : ""} aria-pressed={by === "persos"} onClick={() => onBy("persos")}>{t("Par perso")}</button>
        <button type="button" className={by === "joueurs" ? "on" : ""} aria-pressed={by === "joueurs"} onClick={() => onBy("joueurs")}>{t("Par joueur")}</button>
      </div>
      {mode && (
        <div className="seg" role="group" aria-label={t("Persos : liste du jeu ou fiches du site")}>
          <button type="button" className={mode === "jeu" ? "on" : ""} aria-pressed={mode === "jeu"} onClick={() => onMode("jeu")}>{t("Liste du jeu")}</button>
          <button type="button" className={mode === "fiches" ? "on" : ""} aria-pressed={mode === "fiches"} onClick={() => onMode("fiches")}>{t("Fiches du site")}</button>
        </div>
      )}
    </div>
  );
}

const errorOf = (e: unknown) => (e instanceof ApiError ? e.message : t("Action impossible."));
const ROLE_LABEL: Record<GroupRole, string> = { owner: N("Propriétaire"), officer: N("Officier"), member: N("Membre") };
/** Tout ce qui vient de la guilde du jeu est à relire après une action (l'événement en direct « guild » suit pour les autres). */
export const refreshGuild = (qc: QueryClient, groupId: string) =>
  Promise.all(GUILD_QUERY_ROOTS.map(k => qc.invalidateQueries({ queryKey: [k, groupId] })));

/* ---------- Petits morceaux communs ---------- */

/**
 * Guilde du site pas encore liée à la guilde du jeu : ce qui la remplira, en une phrase. compact : une ligne discrète au-dessus
 * de ce que Membres montre en attendant (« persos » : les fiches du site, « joueurs » : les membres du site).
 */
export function NotLinked({ groupId, officer, onAdmin, compact }: { groupId: string; officer: boolean; onAdmin?: () => void; compact?: "persos" | "joueurs" }) {
  const link = useGuildLink(groupId, officer);
  const proposals = link.data?.proposals ?? [];
  if (compact) {
    return (
      <p className="gm-note" title={t("Elle arrive à la première synchro d'un officier qui a l'addon à jour, puis se tient à jour toute seule.")}>
        <i aria-hidden="true">i</i>
        <span><b>{t("Liste du jeu pas encore reçue")}</b> · {compact === "persos" ? t("en attendant, les fiches du site.") : t("en attendant, les membres du site.")}
          {officer && proposals.length > 0 && <> {proposed(proposals, onAdmin)}</>}
        </span>
      </p>
    );
  }
  return (
    <div className="so-empty">
      <h3>{t("Pas encore de liste de guilde")}</h3>
      <p>{t("Elle arrive à la première synchro d'un officier de la guilde qui a l'addon à jour, puis se tient à jour toute seule.")}</p>
      {officer && (proposals.length
        ? <p className="small">{proposed(proposals, onAdmin)}</p>
        : <p className="small muted">{onAdmin
          ? tx("Ce premier relevé lie la guilde du site à la guilde du jeu : tu le retrouves dans {admin}.", { admin: <button type="button" className="link" onClick={onAdmin}>{t("l'Administration")}</button> })
          : t("Ce premier relevé lie la guilde du site à la guilde du jeu.")}</p>)}
    </div>
  );
}

/** « 2 guildes du jeu sont proposées : la lier dans l'Administration. » */
function proposed(proposals: { name: string }[], onAdmin?: () => void) {
  const link = onAdmin ? <button type="button" className="link" onClick={onAdmin}>{t("la lier dans l'Administration")}</button> : t("la lier dans l'Administration");
  return proposals.length > 1
    ? tx("{n} guildes du jeu sont proposées : {link}.", { n: proposals.length, link })
    : tx("La guilde du jeu {name} est proposée : {link}.", { name: <b>{proposals[0]!.name}</b>, link });
}

/** « Est-ce ton perso ? » : un officier a rattaché ce perso à mon compte. */
export function QuestionBand({ groupId, questions }: { groupId: string; questions: GuildQuestion[] }) {
  const qc = useQueryClient();
  const gt = useGameText();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!questions.length) return null;
  const answer = async (q: GuildQuestion, yes: boolean) => {
    setBusy(q.guid); setErr(null);
    try { await post(`/groups/${groupId}/guild/members/${q.guid}/answer`, { yes }); await refreshGuild(qc, groupId); }
    catch (e) { setErr(errorOf(e)); }
    finally { setBusy(null); }
  };
  return (
    <>
      {questions.map(q => (
        <section key={q.guid} className="gm-act yours" aria-label={t("Est-ce ton perso ? {name}", { name: q.name })}>
          <ClassDot cls={q.cls} size="md" />
          <span className="t"><b>{t("Est-ce ton perso ?")}</b>
            <small>{tx("{who} a rattaché {char}, {what}, à ton compte.", { who: q.by ?? t("Un officier"), char: <CharName name={q.name} cls={q.cls} as="span" />, what: q.cls ? `${gt.cls(q.cls)} ${q.level}` : t("niveau {n}", { n: q.level }) })}</small></span>
          <span className="row">
            <button type="button" className="btn primary sm" disabled={busy === q.guid} onClick={() => void answer(q, true)}>{t("Oui, c'est moi")}</button>
            <button type="button" className="btn ghost sm" disabled={busy === q.guid} onClick={() => void answer(q, false)}>{t("Non")}</button>
          </span>
        </section>
      ))}
      {err && <div className="alert error" role="alert">{err}</div>}
    </>
  );
}

export { DialogHead, Modal } from "./Dialog";

/** Ce que dit la petite ligne d'un perso : classe et niveau, rang. */
function useCharLine() {
  const gt = useGameText();
  return (c: Pick<GuildChar, "cls" | "level">) => (c.cls ? `${gt.cls(c.cls)} ${c.level}` : t("Niveau {n}", { n: c.level }));
}

type Dialog = { kind: "attach"; guids: string[] } | { kind: "main"; key: string } | { kind: "claim"; guid: string } | { kind: "fiche"; guid: string } | null;

/**
 * « Rattacher X à… » (officiers) : un joueur de la guilde, un membre du site sans perso reconnu (8/11), un perso à rattacher, ou
 * un nouveau joueur dont X est le main. Plusieurs persos cochés (8/11) : tous au même joueur ; « Nouveau joueur » : le plus
 * haut niveau est son main, les autres ses alts.
 */
function AttachDialog({ groupId, data, guids, members, myId, onClose, onDone }: {
  groupId: string; data: GuildMembersResponse; guids: string[]; members: Member[]; myId?: string; onClose: () => void; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const line = useCharLine();
  const byGuid = useMemo(() => new Map(data.chars.map(c => [c.guid, c])), [data]);
  const picked = guids.map(g => byGuid.get(g)).filter((c): c is GuildChar => !!c).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const c = picked[0];
  const many = picked.length > 1;
  const suggestion = !many && c ? data.unattached.find(u => u.guid === c.guid)?.suggestion ?? null : null;
  const playerOf = useMemo(() => {
    const m = new Map<string, GuildPlayer>();
    for (const p of data.players) for (const g of [p.main, ...p.alts]) m.set(g, p);
    return m;
  }, [data]);
  const suggested = new Set([suggestion?.target?.guid, ...(suggestion?.candidates.map(x => x.guid) ?? [])].filter(Boolean).map(g => (g && playerOf.get(g)?.key) ?? `m:${g}`));
  const [q, setQ] = useState("");
  const [to, setTo] = useState<string | null>(suggestion?.target ? (playerOf.get(suggestion.target.guid)?.key ?? `m:${suggestion.target.guid}`) : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return null;
  const pickedSet = new Set(picked.map(x => x.guid));
  const needle = q.trim().toLowerCase();
  type Opt = { key: string; main: GuildChar | null; name: string; sub: string; account: { userId: string; displayName: string; avatarId: string | null } | null };
  const players: Opt[] = data.players.filter(p => !(!many && p.key === c.player) && byGuid.has(p.main) && !pickedSet.has(p.main)).map(p => {
    const main = byGuid.get(p.main)!;
    return { key: p.key, main, name: main.name, account: p.account, sub: [main.rank, p.account ? t("compte {name}", { name: p.account.displayName }) : t("sans compte"), p.alts.length ? tn(p.alts.length, "{n} alt", "{n} alts") : null].filter(Boolean).join(" · ") };
  });
  // Membres du site sans perso reconnu dans la liste : un compte à qui rattacher (« Est-ce ton perso ? » lui sera posé)
  const accounts = new Set(data.players.map(p => p.account?.userId).filter(Boolean));
  const site: Opt[] = members.filter(m => !accounts.has(m.userId)).map(m => ({
    key: `u:${m.userId}`, main: null, name: m.displayName, account: { userId: m.userId, displayName: m.displayName, avatarId: m.avatarId }, sub: t("compte du site · {role} · aucun perso reconnu", { role: t(ROLE_LABEL[m.role]) }),
  }));
  const band: Opt[] = data.unattached.filter(u => !pickedSet.has(u.guid) && byGuid.has(u.guid)).map(u => ({ key: `m:${u.guid}`, main: byGuid.get(u.guid)!, name: byGuid.get(u.guid)!.name, account: null, sub: `${byGuid.get(u.guid)!.rank} · ${t("à rattacher")}` }));
  const match = (o: Opt) => !needle || `${o.name} ${o.account?.displayName ?? ""}`.toLowerCase().includes(needle);
  const all = [...site, ...players, ...band];
  const top = all.filter(o => suggested.has(o.key));
  const siteRest = site.filter(o => !suggested.has(o.key) && match(o)).sort((a, b) => a.name.localeCompare(b.name));
  const rest = [...players, ...band].filter(o => !suggested.has(o.key) && match(o)).sort((a, b) => a.name.localeCompare(b.name));
  const chosen = all.find(o => o.key === to) ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!to) return;
    setBusy(true); setErr(null);
    try {
      if (many) await put(`/groups/${groupId}/guild/members/link`, { guids: picked.map(x => x.guid), to });
      else await put(`/groups/${groupId}/guild/members/${c.guid}/link`, { to });
      await refreshGuild(qc, groupId); onDone?.(); onClose();
    } catch (x) { setErr(errorOf(x)); setBusy(false); }
  };
  const opt = (o: Opt) => (
    <li key={o.key}><label className="gd-opt">
      <input type="radio" name="gd-to" value={o.key} checked={to === o.key} onChange={() => setTo(o.key)} />
      {o.main ? <ClassDot cls={o.main.cls} />
        : <span className="avatar" style={{ width: 22, height: 22 }}><Portrait id={o.account?.avatarId ?? null} size={22} fallback={<span style={{ fontSize: 11 }}>{o.name[0]}</span>} /></span>}
      <span className="t"><span className="nm">{o.main ? <><CharName name={o.main.name} cls={o.main.cls} /><span className="lvn">{o.main.level}</span></> : <b>{o.name}</b>}</span><small>{o.sub}</small></span>
    </label></li>
  );
  const why = suggestion ? (suggestion.from === "officerNote" ? t("note d'officier « {note} »", { note: suggestion.note }) : t("note de guilde « {note} »", { note: suggestion.note }))
    : c.note ? t("note « {note} »", { note: c.note }) : t("pas de note de guilde");
  const title = many ? t("Rattacher {n} persos à…", { n: picked.length }) : t("Rattacher {name} à…", { name: c.name });
  const sub = many ? <span>{picked.map(x => `${x.name} (${line(x)})`).join(", ")}</span> : <><ClassDot cls={c.cls} /><span>{line(c)} · {why}</span></>;
  const who = chosen?.account?.displayName ?? chosen?.main?.firstName;
  return (
    <Modal label="gd-t" onClose={onClose}>
      <form onSubmit={e => void submit(e)}>
        <DialogHead id="gd-t" title={title} sub={sub} onClose={onClose} />
        <input type="search" placeholder={t("Chercher un joueur ou un perso…")} aria-label={t("Chercher un joueur ou un perso")} value={q} onChange={e => setQ(e.target.value)} />
        <ul className="gd-list" aria-label={t("Joueurs de la guilde")}>
          {top.length > 0 && <><li className="gd-group">{t("Suggéré par la note")}</li>{top.map(opt)}</>}
          {siteRest.length > 0 && <><li className="gd-group">{t("Sur le site, sans perso dans la liste")}</li>{siteRest.map(opt)}</>}
          {rest.length > 0 && (top.length > 0 || siteRest.length > 0) && <li className="gd-group">{t("Joueurs de la liste")}</li>}
          {rest.map(opt)}
          {!top.length && !siteRest.length && !rest.length && <li className="muted small">{t("Personne ne correspond.")}</li>}
        </ul>
        <label className="gd-opt new">
          <input type="radio" name="gd-to" value="new" checked={to === "new"} onChange={() => setTo("new")} />
          <span className="t"><b>{t("Nouveau joueur")}</b><small>{many ? (picked.length > 2 ? t("{main} est son main, {alts} ses alts", { main: c.name, alts: picked.slice(1).map(x => x.name).join(", ") }) : t("{main} est son main, {alts} son alt", { main: c.name, alts: picked[1]!.name }))
            : t("{main} est son main", { main: c.firstName })}</small></span>
        </label>
        {chosen?.account && chosen.account.userId !== myId && <p className="hint" style={{ margin: 0 }}>{many
          ? t("{name} a un compte : « Est-ce ton perso ? » s'affichera pour chacun à sa prochaine visite (Oui / Non).", { name: chosen.account.displayName })
          : t("{name} a un compte : « Est-ce ton perso ? » s'affichera à sa prochaine visite (Oui / Non).", { name: chosen.account.displayName })}</p>}
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={!to || busy}>{to === "new" ? t("En faire un joueur à part") : who ? (many ? t("Rattacher les {n} à {name}", { n: picked.length, name: who }) : t("Rattacher à {name}", { name: who })) : t("Rattacher")}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * « Créer sa fiche… » (officiers, 8/11) : la fiche du site d'un perso de la liste qu'aucune fiche ne retrouve, sur le compte d'un
 * membre de la guilde du site ; elle arrive tout de suite dans ses persos, rangée ici (son main s'il n'en a pas).
 */
function FicheDialog({ groupId, groupName, data, guid, members, myName, onClose }: {
  groupId: string; groupName: string; data: GuildMembersResponse; guid: string; members: Member[]; myName: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const line = useCharLine();
  const c = data.chars.find(x => x.guid === guid);
  const owner = c?.player?.startsWith("u:") ? c.player.slice(2) : "";
  const [userId, setUserId] = useState(members.some(m => m.userId === owner) ? owner : "");
  const [name, setName] = useState(c?.name ?? "");
  const [race, setRace] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return null;
  const races = RACE_NAMES.filter(r => !c.cls || isValidCombo(r, c.cls));
  const who = members.find(m => m.userId === userId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await post(`/groups/${groupId}/guild/members/${c.guid}/fiche`, { userId, name: name.trim(), race });
      await Promise.all([refreshGuild(qc, groupId), qc.invalidateQueries({ queryKey: ["group-chars", groupId] })]);
      onClose();
    } catch (x) { setErr(errorOf(x)); setBusy(false); }
  };
  return (
    <Modal label="gfc-t" onClose={onClose}>
      <form className="stack" style={{ gap: 12 }} onSubmit={e => void submit(e)}>
        <DialogHead id="gfc-t" title={t("Créer la fiche de {name}", { name: c.name })} sub={<><ClassDot cls={c.cls} /><span>{line(c)} · {c.rank}</span></>} onClose={onClose} />
        <div className="fld"><label htmlFor="gfc-u">{t("À qui est ce perso ?")}</label>
          <select id="gfc-u" value={userId} onChange={e => setUserId(e.target.value)} required>
            <option value="" disabled>{t("Choisir un membre du site…")}</option>
            {[...members].sort((a, b) => a.displayName.localeCompare(b.displayName)).map(m => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
          </select>
        </div>
        <div className="row" style={{ gap: 12, alignItems: "end" }}>
          <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="gfc-n">{t("Nom de la fiche")}</label>
            <input id="gfc-n" type="text" value={name} maxLength={40} onChange={e => setName(e.target.value)} required /></div>
          <div className="fld" style={{ flex: "1 1 160px" }}><label htmlFor="gfc-r">{t("Race")} <span className="muted small">{t("(facultatif)")}</span></label>
            <select id="gfc-r" value={race} onChange={e => setRace(e.target.value)}>
              <option value="">—</option>{races.map(r => <option key={r} value={r}>{r}</option>)}
            </select></div>
        </div>
        <p className="hint" style={{ margin: 0 }}>{who
          ? t("Classe et niveau viennent de la liste du jeu (le niveau la suivra). La fiche arrive tout de suite dans les persos de {name}, rangée dans {guild} (son main s'il n'en a pas), avec « Créée par {me} ». {name} la complète, la donne ou la supprime ; son addon la retrouvera à sa première synchro. Noté au journal de la guilde.", { name: who.displayName, guild: groupName, me: myName })
          : t("Classe et niveau viennent de la liste du jeu (le niveau la suivra). La fiche arrive tout de suite dans les persos de ce membre, rangée dans {guild} (son main s'il n'en a pas), avec « Créée par {me} ». Il la complète, la donne ou la supprime ; son addon la retrouvera à sa première synchro. Noté au journal de la guilde.", { guild: groupName, me: myName })}</p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy || !userId || !name.trim()}>{who ? t("Créer la fiche pour {name}", { name: who.displayName }) : t("Créer la fiche")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Choix du main d'un joueur (officiers, ou le joueur lui-même). */
function MainDialog({ groupId, data, pkey, onClose }: { groupId: string; data: GuildMembersResponse; pkey: string; onClose: () => void }) {
  const qc = useQueryClient();
  const line = useCharLine();
  const p = data.players.find(x => x.key === pkey);
  const byGuid = new Map(data.chars.map(c => [c.guid, c]));
  const [guid, setGuid] = useState(p?.main ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!p) return null;
  const chars = [p.main, ...p.alts].map(g => byGuid.get(g)).filter((c): c is GuildChar => !!c);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await put(`/groups/${groupId}/guild/players/${encodeURIComponent(p.key)}/main`, { guid }); await refreshGuild(qc, groupId); onClose(); }
    catch (x) { setErr(errorOf(x)); setBusy(false); }
  };
  return (
    <Modal label="gm-t" onClose={onClose}>
      <form onSubmit={e => void submit(e)}>
        <DialogHead id="gm-t" title={p.me ? t("Ton main") : t("Main de {name}", { name: p.account?.displayName ?? byGuid.get(p.main)?.firstName ?? t("ce joueur") })} sub={t("Le main mène sa ligne dans la vue Par joueur et dans la course ; les autres persos sont ses alts.")} onClose={onClose} />
        <ul className="gd-list" aria-label={t("Persos du joueur")}>{chars.map(c => (
          <li key={c.guid}><label className="gd-opt">
            <input type="radio" name="gm-main" value={c.guid} checked={guid === c.guid} onChange={() => setGuid(c.guid)} />
            <ClassDot cls={c.cls} />
            <span className="t"><span className="nm"><CharName name={c.name} cls={c.cls} /><span className="lvn">{c.level}</span></span><small>{line(c)} · {c.rank}</small></span>
          </label></li>
        ))}</ul>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy || guid === p.main}>{t("Choisir comme main")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** « C'est mon perso » : un perso qui n'est à personne rejoint mon compte. */
function ClaimDialog({ groupId, c, onClose }: { groupId: string; c: GuildChar; onClose: () => void }) {
  const qc = useQueryClient();
  const line = useCharLine();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const claim = async () => {
    setBusy(true); setErr(null);
    try { await post(`/groups/${groupId}/guild/members/${c.guid}/claim`); await refreshGuild(qc, groupId); onClose(); }
    catch (x) { setErr(errorOf(x)); setBusy(false); }
  };
  return (
    <Modal label="gc-t" onClose={onClose}>
      <div className="gd-body">
        <DialogHead id="gc-t" title={t("{name} est à toi ?", { name: c.name })} sub={<><ClassDot cls={c.cls} /><span>{line(c)} · {c.rank}</span></>} onClose={onClose} />
        <p style={{ margin: 0 }}>{t("Il rejoint tes persos dans la guilde : ta ligne dans la vue Par joueur et dans la course. Un officier peut toujours corriger.")}</p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void claim()}>{t("Oui, c'est mon perso")}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Peut-on dire « C'est mon perso » ? Perso seul ou à rattacher, ou main d'un joueur sans compte qui n'est lié à personne. */
const claimable = (c: GuildChar) => !c.mine && (!c.player || c.player.startsWith("m:") || (c.player.startsWith("p:") && !c.link && c.isMain));

/* ---------- Onglet ---------- */

export function GuildMembersTab({ groupId, groupName, view, members, myRole, myId, guard, onAdmin }: {
  groupId: string; groupName: string; view: GuildView; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard; onAdmin?: () => void;
}) {
  const q = useGuildMembers(groupId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [byPref, setByPref] = useViewPref<GuildBy>("guild-by", "persos", BY_VALUES);
  const [modePref, setModePref] = useViewPref<CharsMode>("guild-chars-mode", "jeu", MODE_VALUES);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** Persos cochés dans Liste du jeu (officiers, 8/11) : « Rattacher à… » une fois pour tous. */
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const myName = useMe().data?.user?.displayName ?? t("toi");
  const officer = myRole !== "member";
  const data = q.data;
  // Ligne au-dessus de Course au 60 : un texte à droite (départ de la course…)
  const nav = (right?: ReactNode) => (right ? <div className="subnav">{right}</div> : null);
  const empty = <NotLinked groupId={groupId} officer={officer} onAdmin={onAdmin} />;
  // Par perso ou Par joueur : l'adresse explicite l'emporte, sinon le choix retenu. Un clic le retient et mène à l'adresse explicite.
  const by: GuildBy = view === "persos" || view === "joueurs" ? view : byPref;
  const chooseBy = (b: GuildBy) => {
    setByPref(b);
    const p = new URLSearchParams(params); if (b === "joueurs") { p.delete("vue"); p.delete("perso"); }
    navigate(`/groups/${groupId}/membres/${b}${p.size ? `?${p}` : ""}`);
  };
  // Liste du jeu ou fiches du site : ?perso= → fiches, sinon ?vue=, sinon le choix retenu ; guilde du jeu pas liée → fiches
  const linked = !!data?.link;
  const vue = params.get("vue");
  const mode: CharsMode = !linked || params.has("perso") ? "fiches" : vue === "fiches" || vue === "jeu" ? vue : modePref;
  const chooseMode = (m: CharsMode) => {
    setModePref(m);
    setParams(p => { p.set("vue", m); if (m === "jeu") p.delete("perso"); return p; }, { replace: true });
  };
  // ?perso= ouvre les fiches, et GroupCharacters le retire de l'adresse une fois la fiche ouverte : sans ?vue=fiches, le choix
  // retenu (« Liste du jeu ») reprendrait la place et la fiche disparaîtrait (ancienne adresse /groups/:id/persos?perso=…)
  useEffect(() => {
    if (params.has("perso") && params.get("vue") !== "fiches") setParams(p => { p.set("vue", "fiches"); return p; }, { replace: true });
  }, [params, setParams]);

  let body: ReactNode;
  if (view === "course") return <GuildRace groupId={groupId} nav={nav} empty={empty} />;
  if (view === "historique") body = <History groupId={groupId} nav={nav} empty={empty} linked={data ? !!data.link : null} />;
  else body = (
    <div className="stack">
      <MembersBar by={by} onBy={chooseBy} mode={by === "persos" && linked ? mode : undefined} onMode={chooseMode} />
      {!data ? <p className="muted">{q.error ? t("Liste de guilde indisponible pour l'instant.") : t("Chargement…")}</p>
        : by === "persos" ? <Chars groupId={groupId} groupName={groupName} data={data} sheets={mode === "fiches"} notLinked={<NotLinked groupId={groupId} officer={officer} onAdmin={onAdmin} compact="persos" />} members={members} myRole={myRole} myId={myId} openDialog={setDialog} guard={guard} sel={sel} setSel={setSel} />
        : <>
          <QuestionBand groupId={groupId} questions={data.questions} />
          {data.link ? <Players groupId={groupId} data={data} members={members} myRole={myRole} myId={myId} guard={guard} openDialog={setDialog} />
            : <><NotLinked groupId={groupId} officer={officer} onAdmin={onAdmin} compact="joueurs" /><h4 className="gm-sec">{t("Membres du site")} <span className="num">{members.length}</span></h4>
              <SiteMembers groupId={groupId} members={members} myRole={myRole} myId={myId} guard={guard} bankers /></>}
        </>}
    </div>
  );
  return (
    <>
      {body}
      {data && dialog?.kind === "attach" && <AttachDialog groupId={groupId} data={data} guids={dialog.guids} members={members} myId={myId} onClose={() => setDialog(null)} onDone={() => setSel(new Set())} />}
      {data && dialog?.kind === "fiche" && <FicheDialog groupId={groupId} groupName={groupName} data={data} guid={dialog.guid} members={members} myName={myName} onClose={() => setDialog(null)} />}
      {data && dialog?.kind === "main" && <MainDialog groupId={groupId} data={data} pkey={dialog.key} onClose={() => setDialog(null)} />}
      {data && dialog?.kind === "claim" && (() => { const c = data.chars.find(x => x.guid === dialog.guid); return c ? <ClaimDialog groupId={groupId} c={c} onClose={() => setDialog(null)} /> : null; })()}
    </>
  );
}

/* ---------- Joueurs ---------- */

const PLAYERS_PAGE = 50;

function Players({ groupId, data, members, myRole, myId, guard, openDialog }: {
  groupId: string; data: GuildMembersResponse; members: Member[]; myRole: GroupRole; myId?: string; guard: Guard; openDialog: (d: Dialog) => void;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const officer = data.canManage;
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ userId: string; action: "owner" | "remove" } | null>(null);
  const byGuid = useMemo(() => new Map(data.chars.map(c => [c.guid, c])), [data]);
  const memberOf = new Map(members.map(m => [m.userId, m]));
  const accounts = new Set(data.players.map(p => p.account?.userId).filter(Boolean));
  const siteOnly = members.filter(m => !accounts.has(m.userId));
  const needle = q.trim().toLowerCase();
  const rows = data.players.filter(p => byGuid.has(p.main))
    .filter(p => !needle || [p.main, ...p.alts].some(g => byGuid.get(g)?.name.toLowerCase().includes(needle)) || p.account?.displayName.toLowerCase().includes(needle));
  const shown = all ? rows : rows.slice(0, PLAYERS_PAGE);
  const refreshSite = () => Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), refreshGuild(qc, groupId)]);
  const setRole = (m: Member, role: GroupRole) => guard(async () => { await patch(`/groups/${groupId}/members/${m.userId}`, { role }); setAsk(null); await refreshSite(); });
  const remove = (m: Member) => guard(async () => { await del(`/groups/${groupId}/members/${m.userId}`); setAsk(null); setSheet(null); await refreshSite(); });
  const setBanker = (m: Member, banker: boolean) => guard(async () => { await put(`/groups/${groupId}/members/${m.userId}/banker`, { banker }); await refreshSite(); });

  return (
    <>
      <div className="row gc-tools">
        <input type="search" placeholder={t("Chercher un joueur ou un perso…")} aria-label={t("Chercher un joueur ou un perso")} value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
      </div>
      {!data.me.player && <p className="hint" style={{ margin: 0 }}>{t("Tu n'es pas dans la liste ? Fais ta synchro avec l'addon à jour, ou « C'est mon perso » dans le menu « … ».")}</p>}
      <div className="gp" role="table" aria-label={t("Joueurs de la guilde")}>
        <div className="gp-h" role="row"><span role="columnheader">{t("Joueur · main")}</span><span role="columnheader">{t("Rang")}</span><span role="columnheader">{t("Alts")}</span><span role="columnheader">{t("Connexion")}</span><span role="columnheader">{t("Compte du site")}</span><span /></div>
        {shown.map(p => {
          const main = byGuid.get(p.main)!;
          const alts = p.alts.map(g => byGuid.get(g)).filter((c): c is GuildChar => !!c);
          const chars = [main, ...alts];
          const seen = seenText(p.online, p.lastOnlineAt);
          const m = p.account ? memberOf.get(p.account.userId) : undefined;
          const can = m ? siteRights(myRole, myId, m) : { role: false, remove: false, banker: false };
          const asking = m && ask?.userId === m.userId ? ask.action : null;
          const actions = (close: () => void) => {
            const out: ReactNode[] = [];
            const item = (key: string, label: string, fn: () => void, bad = false) => out.push(<button key={key} type="button" role="menuitem" className={bad ? "bad" : undefined} onClick={() => { close(); fn(); }}>{label}</button>);
            if (p.account) item("sheet", sheet === p.account.userId ? t("Fermer la fiche") : t("Voir la fiche"), () => setSheet(s => (s === p.account!.userId ? null : p.account!.userId)));
            if (chars.length > 1 && (officer || p.me)) item("main", t("Choisir le main…"), () => openDialog({ kind: "main", key: p.key }));
            if (officer) for (const c of chars) item(`a${c.guid}`, chars.length > 1 ? t("Rattacher {name} à…", { name: c.name }) : t("Rattacher à…"), () => openDialog({ kind: "attach", guids: [c.guid] }));
            if (officer) for (const c of chars.filter(x => !x.fiche)) item(`f${c.guid}`, chars.length > 1 ? t("Créer la fiche de {name}…", { name: c.name }) : t("Créer sa fiche…"), () => openDialog({ kind: "fiche", guid: c.guid }));
            if (!p.account && claimable(main)) item("claim", t("C'est mon perso"), () => openDialog({ kind: "claim", guid: main.guid }));
            if (m && can.role && m.role === "member") item("off", t("Nommer officier"), () => void setRole(m, "officer"));
            if (m && can.role && m.role === "officer") item("mem", t("Repasser membre"), () => void setRole(m, "member"));
            if (m && can.banker) item("bq", m.banker ? t("Retirer banquier") : t("Nommer banquier"), () => void setBanker(m, !m.banker));
            if (m && can.role) item("own", t("Transférer la propriété…"), () => setAsk({ userId: m.userId, action: "owner" }));
            if (m && can.remove) item("rm", t("Retirer de la guilde…"), () => setAsk({ userId: m.userId, action: "remove" }), true);
            return out;
          };
          return (
            <Fragment key={p.key}>
              <div className={`gp-r${p.me ? " me" : ""}${p.account ? " open" : ""}`} role="row">
                <span className="gp-who" role="cell">
                  <ClassDot cls={main.cls} size="md" />
                  <span className="t">
                    <span className="nm">
                      {/* Toute la ligne ouvre la fiche du joueur (refonte du 09/11) : le nom est un bouton étiré sur la ligne */}
                      {p.account
                        ? <button type="button" className="gp-open" aria-expanded={sheet === p.account.userId} onClick={() => setSheet(s => (s === p.account!.userId ? null : p.account!.userId))}
                            title={t("Fiche de {name}", { name: p.account.displayName })}><CharName name={main.name} cls={main.cls} /></button>
                        : <CharName name={main.name} cls={main.cls} />}
                      <span className="lvn">{main.level}</span>{p.me && <span className="tag gold">{t("Toi")}</span>}{m?.banker && m.role === "member" && <span className="tag">{t("Banquier")}</span>}</span>
                    <small>{[main.cls ? gt.cls(main.cls) : null, main.race].filter(Boolean).join(" · ") || t("Classe inconnue")}</small>
                  </span>
                </span>
                <span className={`gp-rank${main.rankIndex <= 1 ? " off" : ""}`} role="cell" title={main.rank}>{main.rank}</span>
                <span className={`gp-alts${alts.length ? "" : " nil"}`} role="cell">
                  {alts.length ? alts.map(a => <span key={a.guid} className="ac" title={t("{name}, niveau {level}", { name: a.name, level: a.level })}><ClassDot cls={a.cls} /><CharName name={a.name} cls={a.cls} as="span" /><span className="lvn">{a.level}</span></span>)
                    : <span className="none" aria-label={t("Aucun alt")}>—</span>}
                </span>
                <span className={`gp-seen ${seen.state}`} role="cell"><i aria-hidden="true" />{seen.text}</span>
                {p.account
                  ? <span className="gp-acc" role="cell">
                      <span className="avatar" style={{ width: 20, height: 20 }}><Portrait id={p.account.avatarId} size={20} fallback={<span style={{ fontSize: 10 }}>{p.account.displayName[0]}</span>} /></span>
                      <span>{p.account.displayName}</span>
                    </span>
                  : <span className="gp-acc no" role="cell">{t("sans compte")}</span>}
                <PlayerMenu label={t("Actions pour {name}", { name: main.name })} build={actions} />
              </div>
              {asking && m && (
                <div className="gp-ask" role="row">
                  {asking === "owner" ? <>{t("Donner la guilde à {name} ? Tu deviens officier.", { name: m.displayName })}<button type="button" className="btn danger sm" onClick={() => void setRole(m, "owner")}>{t("Transférer")}</button></>
                    : <>{t("Retirer {name} de la guilde sur le site ? Rien ne change en jeu.", { name: m.displayName })}<button type="button" className="btn danger sm" onClick={() => void remove(m)}>{t("Retirer")}</button></>}
                  <button type="button" className="btn ghost sm" onClick={() => setAsk(null)}>{t("Annuler")}</button>
                </div>
              )}
              {p.account && sheet === p.account.userId && (
                <div className="gp-sheet" role="row"><PlayerSheet key={sheet} groupId={groupId} userId={sheet} officer={myRole !== "member"} onClose={() => setSheet(null)} /></div>
              )}
            </Fragment>
          );
        })}
        {!rows.length && <p className="muted" style={{ margin: 0, padding: "12px" }}>{needle ? t("Personne ne correspond.") : t("Personne dans la liste pour l'instant.")}</p>}
        {rows.length > shown.length && <button type="button" className="rk-more" onClick={() => setAll(true)}>{t("Voir les {n} autres joueurs", { n: rows.length - shown.length })}</button>}
      </div>
      {officer && data.unattached.length > 0 && <AttachBand groupId={groupId} data={data} openDialog={openDialog} />}
      {siteOnly.length > 0 && (
        <section className="stack" style={{ gap: 8 }} aria-labelledby="gp-site">
          <h4 className="gm-sec" id="gp-site">{t("Sur le site, sans perso dans la liste du jeu")} <span className="num">{siteOnly.length}</span></h4>
          <SiteMembers groupId={groupId} members={members} only={new Set(siteOnly.map(m => m.userId))} myRole={myRole} myId={myId} guard={guard} bankers
            hint={t("Leurs persos n'ont pas encore été reconnus : l'addon à jour, ou une fiche du site à leur nom, les rattache ; un officier peut aussi le faire (« Rattacher à… »).")} />
        </section>
      )}
    </>
  );
}

/** Menu « … » d'un joueur, construit à l'ouverture ; aucun menu s'il n'y a rien à faire. */
function PlayerMenu({ label, build }: { label: string; build: (close: () => void) => ReactNode[] }) {
  const probe = build(() => {});
  if (!probe.length) return <span />;
  return <RowMenu label={label}>{close => build(close)}</RowMenu>;
}

/** Bande « À rattacher » (officiers) : persos arrivés depuis peu, ou dont une note propose le main. */
function AttachBand({ groupId, data, openDialog }: { groupId: string; data: GuildMembersResponse; openDialog: (d: Dialog) => void }) {
  const qc = useQueryClient();
  const byGuid = new Map(data.chars.map(c => [c.guid, c]));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const accept = async (guid: string) => {
    setBusy(guid); setErr(null);
    try { await post(`/groups/${groupId}/guild/members/${guid}/accept`, {}); await refreshGuild(qc, groupId); }
    catch (e) { setErr(errorOf(e)); }
    finally { setBusy(null); }
  };
  return (
    <section className="gq" aria-labelledby="gq-t">
      <div className="gq-h"><h3 id="gq-t">{t("À rattacher")} <span className="num">{data.unattached.length}</span></h3>
        <span className="muted small">{t("Persos sans joueur ; les notes de guilde suggèrent leur main.")}</span></div>
      <ul className="gq-list">
        {data.unattached.map(u => {
          const c = byGuid.get(u.guid);
          if (!c) return null;
          const s = u.suggestion;
          const src = s ? (s.from === "officerNote" ? t("note d'officier « {note} »", { note: s.note }) : t("note de guilde « {note} »", { note: s.note }))
            : `${c.joinedAt ? (c.joinedApprox ? t("arrivée vers le {date}", { date: dayMonth(c.joinedAt) }) : t("arrivée le {date}", { date: dayMonth(c.joinedAt) })) : t("nouveau")} · ${c.note ? t("note « {note} »", { note: c.note }) : t("pas de note")}`;
          return (
            <li key={u.guid} className="gq-item">
              <ClassDot cls={c.cls} size="md" />
              <span className="t"><span className="nm"><CharName name={c.name} cls={c.cls} /><span className="lvn">{c.level}</span></span><small>{src}</small></span>
              {s?.target ? <span className="gq-sug">{tx("Alt de {name} ?", { name: <b>{s.target.name}</b> })}</span>
                : s?.candidates.length ? <span className="gq-sug">{t("Alt de qui ? {n} persos portent ce nom.", { n: s.candidates.length })}</span>
                : <span className="gq-sug muted">{t("Aucune suggestion")}</span>}
              <span className="gq-acts">
                {s?.target ? <>
                  <button type="button" className="btn sm primary" disabled={busy === u.guid} onClick={() => void accept(u.guid)}>{t("Accepter")}</button>
                  <button type="button" className="btn ghost sm" onClick={() => openDialog({ kind: "attach", guids: [u.guid] })}>{t("Autre…")}</button>
                </> : <button type="button" className="btn sm" onClick={() => openDialog({ kind: "attach", guids: [u.guid] })}>{s?.candidates.length ? t("Choisir…") : t("Rattacher à…")}</button>}
              </span>
            </li>
          );
        })}
      </ul>
      {err && <div className="alert error" role="alert">{err}</div>}
    </section>
  );
}

/* ---------- Persos ---------- */

const LEVELS: [string, number, number][] = [[N("Tous"), 1, 60], ["1-29", 1, 29], ["30-49", 30, 49], ["50-60", 50, 60]];
const CHARS_PAGE = 100;

/** Par perso : la liste de guilde du jeu, ou (sheets) les fiches du site. Le choix se fait dans la barre de Membres. */
function Chars({ groupId, groupName, data, sheets, notLinked, members, myRole, myId, openDialog, guard, sel, setSel }: {
  groupId: string; groupName: string; data: GuildMembersResponse; sheets: boolean; notLinked: ReactNode; members: Member[]; myRole: GroupRole; myId?: string;
  openDialog: (d: Dialog) => void; guard: Guard; sel: ReadonlySet<string>; setSel: (s: ReadonlySet<string>) => void;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const linked = !!data.link;
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const [lv, setLv] = useState(0);
  const [rank, setRank] = useState<number | "">("");
  const [active, setActive] = useState(false);
  const [all, setAll] = useState(false);
  const officer = data.canManage;
  const players = new Map(data.players.map(p => [p.key, p]));
  const byGuid = new Map(data.chars.map(c => [c.guid, c]));
  const ranks = [...new Map(data.chars.map(c => [c.rankIndex, c.rank])).entries()].sort((a, b) => a[0] - b[0]);
  const needle = q.trim().toLowerCase();
  const [min, max] = [LEVELS[lv]![1], LEVELS[lv]![2]];
  const list = data.chars
    .filter(c => (!needle || `${c.name} ${c.note} ${c.officerNote ?? ""}`.toLowerCase().includes(needle)) && (!cls || c.cls === cls) && c.level >= min && c.level <= max
      && (rank === "" || c.rankIndex === rank) && (!active || activeWithin(c, 7)))
    .sort((a, b) => b.level - a.level || a.rankIndex - b.rankIndex || a.name.localeCompare(b.name));
  const shown = all ? list : list.slice(0, CHARS_PAGE);
  const detach = (c: GuildChar) => guard(async () => { await del(`/groups/${groupId}/guild/members/${c.guid}/link`); await refreshGuild(qc, groupId); });
  const setMain = (c: GuildChar) => guard(async () => { await put(`/groups/${groupId}/guild/players/${encodeURIComponent(c.player!)}/main`, { guid: c.guid }); await refreshGuild(qc, groupId); });
  if (sheets) {
    return (
      <>
        {!linked && notLinked}
        <GroupCharacters groupId={groupId} groupName={groupName} members={members} myId={myId} myRole={myRole} byPlayer={false} />
      </>
    );
  }
  const playerText = (c: GuildChar) => {
    if (!c.player) return <span className="tag warn">{t("à rattacher")}</span>;
    const p = players.get(c.player);
    if (p?.account) return c.fiche?.byName && c.link?.source === "account"
      ? <span>{p.account.displayName} <span className="muted small" title={t("Retrouvé par sa fiche du site, à son nom")}>{t("· fiche")}</span></span>
      : p.account.displayName;
    if (p && p.main !== c.guid) return <span>{byGuid.get(p.main)?.name ?? "—"} <span className="muted small">{t("sans compte")}</span></span>;
    return <span className="muted">{t("sans compte")}</span>;
  };
  // Cases à cocher (officiers) : persos encore dans la liste, dans l'ordre de la liste
  const picked = data.chars.filter(c => sel.has(c.guid));
  const toggle = (guid: string) => { const n = new Set(sel); if (n.has(guid)) n.delete(guid); else n.add(guid); setSel(n); };
  const allShown = shown.length > 0 && shown.every(c => sel.has(c.guid));
  const toggleAll = () => { const n = new Set(sel); for (const c of shown) { if (allShown) n.delete(c.guid); else n.add(c.guid); } setSel(n); };
  return (
    <>
      <div className="row gc-tools">
        <input type="search" placeholder={t("Nom, note…")} aria-label={t("Chercher un perso")} value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 180px" }} />
        <select aria-label={t("Classe")} value={cls} onChange={e => setCls(e.target.value)} style={{ width: "auto" }}>
          <option value="">{t("Toutes les classes")}</option>{CLASS_NAMES.map(c => <option key={c} value={c}>{gt.cls(c)}</option>)}
        </select>
        <div className="seg" role="group" aria-label={t("Niveau")}>
          {LEVELS.map(([l], i) => <button key={l} type="button" className={lv === i ? "on" : ""} aria-pressed={lv === i} onClick={() => setLv(i)}>{i === 0 ? t(l) : l}</button>)}
        </div>
        <select aria-label={t("Rang")} value={rank} onChange={e => setRank(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: "auto" }}>
          <option value="">{t("Tous les rangs")}</option>{ranks.map(([i, r]) => <option key={i} value={i}>{r}</option>)}
        </select>
        <label className="gr-tog" style={{ paddingTop: 0 }}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><i aria-hidden="true" />{t("Actifs depuis moins de 7 jours")}</label>
      </div>
      {officer && picked.length > 0 && (
        <div className="gm-act gx-sel" role="region" aria-label={t("Persos cochés")}>
          <b>{tn(picked.length, "{n} perso coché", "{n} persos cochés")}</b>
          <span className="muted gx-sel-names">{picked.map(c => c.name).join(", ")}</span>
          <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
            <button type="button" className="btn sm primary" onClick={() => openDialog({ kind: "attach", guids: picked.map(c => c.guid) })}>{t("Rattacher à…")}</button>
            <button type="button" className="btn ghost sm" onClick={() => setSel(new Set())}>{t("Tout décocher")}</button>
          </span>
        </div>
      )}
      <div className="tscroll"><table className={`data gx-table${officer ? " ck" : ""}`}>
        <thead><tr>{officer && <th className="gx-ck"><input type="checkbox" aria-label={t("Tout cocher")} checked={allShown} onChange={toggleAll} /></th>}<th>{t("Perso")}</th><th>{t("Niv.")}</th><th>{t("Rang")}</th><th>{t("Joueur")}</th><th>{t("Note de guilde")}</th>
          {officer && <th>{t("Note d'officier")} <span className="tag" style={{ fontSize: 9, padding: "2px 4px" }}>{t("officiers")}</span></th>}<th>{t("Connexion")}</th><th /></tr></thead>
        <tbody>{shown.map(c => {
          const seen = seenText(c.online, c.lastOnlineAt);
          const p = c.player ? players.get(c.player) : undefined;
          const count = p ? 1 + p.alts.length : 1;
          const actions = (close: () => void) => {
            const out: ReactNode[] = [];
            const add = (k: string, label: string, fn: () => void) => out.push(<button key={k} type="button" role="menuitem" onClick={() => { close(); fn(); }}>{label}</button>);
            if (officer) add("a", t("Rattacher à…"), () => openDialog({ kind: "attach", guids: [c.guid] }));
            if (officer && !c.fiche) add("f", t("Créer sa fiche…"), () => openDialog({ kind: "fiche", guid: c.guid }));
            if (c.link && c.link.source !== "account" && (officer || (c.mine && c.link.source === "declared"))) add("d", t("Détacher de son joueur"), () => void detach(c));
            if (c.player && !c.isMain && count > 1 && (officer || c.mine)) add("m", t("En faire le main"), () => void setMain(c));
            if (claimable(c)) add("c", t("C'est mon perso"), () => openDialog({ kind: "claim", guid: c.guid }));
            return out;
          };
          return (
            <tr key={c.guid} className={[c.mine ? "ps-sel" : "", sel.has(c.guid) ? "gx-on" : ""].filter(Boolean).join(" ") || undefined}>
              {officer && <td className="gx-ck"><input type="checkbox" aria-label={t("Cocher {name}", { name: c.name })} checked={sel.has(c.guid)} onChange={() => toggle(c.guid)} /></td>}
              <td className="gx-nm"><span className="gx-name"><ClassDot cls={c.cls} />{c.player && !c.isMain && <span className="gm-alt">{t("alt")}</span>}<CharName name={c.name} cls={c.cls} />{c.mine && <span className="tag gold">{t("Toi")}</span>}</span></td>
              <td className="num gx-lv">{c.level}</td>
              <td className="small gx-rank">{c.rank}</td>
              <td className="small gx-pl">{playerText(c)}</td>
              <td className="small gx-note">{c.note || <span className="muted">—</span>}</td>
              {officer && <td className="small gx-note">{c.officerNote || <span className="muted">—</span>}</td>}
              <td className={`small nowrap gx-seen${seen.state === "on" ? " ok-c" : ""}`}>{seen.text}</td>
              <td className="mb-act">
                <PlayerMenu label={t("Actions pour {name}", { name: c.name })} build={actions} />
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {!list.length && <p className="muted" style={{ margin: 0 }}>{t("Aucun perso ne correspond.")}</p>}
      {list.length > shown.length && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setAll(true)}>{t("Voir les {n} autres", { n: list.length - shown.length })}</button>}
      <p className="hint" style={{ margin: 0 }}>{tn(list.length, "{n} perso sur {total}", "{n} persos sur {total}", { total: data.chars.length })}{active ? t(" · actifs depuis moins de 7 jours") : ""}</p>
    </>
  );
}

/* ---------- Historique ---------- */

const MOVE: Record<GuildMove["kind"], { cls: string; s: string; label: string }> = {
  join: { cls: "in", s: "+", label: N("Arrivée") }, leave: { cls: "out", s: "−", label: N("Départ") }, remove: { cls: "out", s: "−", label: N("Renvoi") },
  promote: { cls: "up", s: "↑", label: N("Promotion") }, demote: { cls: "down", s: "↓", label: N("Rétrogradation") },
};
/** Ce qui s'est passé, en peu de mots (les noms complets viennent du journal du jeu). */
export function moveText(m: GuildMove) {
  if (m.kind === "join") return t("rejoint la guilde");
  if (m.kind === "promote" || m.kind === "demote") return m.rank ? t("passe {rank}", { rank: m.rank }) : m.kind === "promote" ? t("passe au rang supérieur") : t("passe au rang inférieur");
  return t("quitte la guilde");
}
function moveDetail(m: GuildMove) {
  if (m.kind === "join") return m.by ? t("invitation de {name}", { name: m.by }) : null;
  if (m.kind === "promote" || m.kind === "demote") return m.by ? t("par {name}", { name: m.by }) : null;
  return [m.kind === "remove" && m.by ? t("renvoi par {name}", { name: m.by }) : null, m.who.level ? t("niveau {n}", { n: m.who.level }) : null, m.who.joinedAt ? t("arrivée le {date}", { date: dayMonth(m.who.joinedAt) }) : null].filter(Boolean).join(" · ") || null;
}
export const MoveSign = ({ m }: { m: GuildMove }) => <span className="s" aria-label={t(MOVE[m.kind].label)}>{MOVE[m.kind].s}</span>;
export const moveClass = (m: GuildMove) => MOVE[m.kind].cls;
/** Heure d'un événement du journal : le jeu ne la donne qu'à l'heure près (« il y a N heures »). */
const hourText = (iso: string) => t("vers {h} h", { h: zonedParts(new Date(iso)).hour });

function History({ groupId, nav, empty, linked }: { groupId: string; nav: (right?: ReactNode) => ReactNode; empty: ReactNode; linked: boolean | null }) {
  const [kind, setKind] = useState<"all" | "joins" | "leaves" | "ranks">("all");
  const q = useInfiniteQuery({
    queryKey: guildKeys.history(groupId, kind),
    queryFn: ({ pageParam }) => fetchHistory(groupId, kind, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => (last.more ? last.moves.at(-1)?.at : undefined),
  });
  if (linked === false) return <div className="stack">{nav()}{empty}</div>;
  const first = q.data?.pages[0];
  const moves = q.data?.pages.flatMap(p => p.moves) ?? [];
  const days: { key: string; at: string; list: GuildMove[] }[] = [];
  for (const m of moves) {
    const k = dayKey(m.at);
    const d = days.at(-1);
    if (d?.key === k) d.list.push(m); else days.push({ key: k, at: m.at, list: [m] });
  }
  return (
    <div className="stack">
      {nav()}
      <div className="row between">
        <div className="seg" role="group" aria-label={t("Événements")}>
          {([["all", t("Tout")], ["joins", t("Arrivées")], ["leaves", t("Départs")], ["ranks", t("Rangs")]] as const).map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        {first && <span className="muted small">{first.journal ? (first.since ? t("Journal de guilde relevé par l'addon · depuis le {date}", { date: dayMonth(first.since) }) : t("Journal de guilde relevé par l'addon")) : t("Journal de guilde pas encore relevé")}</span>}
      </div>
      {!q.data ? <p className="muted">{q.error ? t("Historique indisponible pour l'instant.") : t("Chargement…")}</p>
        : !moves.length ? <p className="muted" style={{ margin: 0 }}>{first?.journal ? t("Rien de ce genre dans le journal pour l'instant.") : t("Le journal de guilde arrive avec la synchro d'un membre qui a l'addon à jour.")}</p>
        : (
          <div className="gh-wrap">{days.map(d => (
            <Fragment key={d.key}>
              <h4 className="gh-day">{longDay(d.at)}</h4>
              <ul className="gh">{d.list.map(m => {
                const detail = moveDetail(m);
                return (
                  <li key={m.id} className={moveClass(m)}>
                    <MoveSign m={m} /><ClassDot cls={m.who.cls} />
                    <span className="t"><CharName name={m.who.name} cls={m.who.cls} /> {moveText(m)}{detail && <small>{detail}</small>}</span>
                    <time dateTime={m.at} title={t("{day}, à l'heure près (journal du jeu)", { day: shortDay(m.at) })}>{hourText(m.at)}</time>
                  </li>
                );
              })}</ul>
            </Fragment>
          ))}</div>
        )}
      {q.hasNextPage && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("Plus ancien")}</button>}
    </div>
  );
}
