import { CLASS_NAMES, zonedParts, type GuildChar, type GuildMembersResponse, type GuildMove, type GuildPlayer, type GuildQuestion } from "@forever/game-data";
import { useInfiniteQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, del, patch, post, put, type GroupRole, type Member } from "../api";
import { useGameText } from "../gameText";
import { activeWithin, agoText, dayKey, dayMonth, fetchHistory, GUILD_QUERY_ROOTS, guildKeys, longDay, seenText, shortDay, useGuildLink, useGuildMembers } from "../guild";
import { siteRights, SiteMembers } from "./GroupMembers";
import { GroupCharacters } from "./GroupRoster";
import { CharName, GuildRace } from "./GuildRace";
import { Portrait } from "./ImageUpload";
import { ClassDot } from "./Outings";
import { PlayerSheet } from "./PlayerSheet";
import { RowMenu } from "./RowMenu";

/**
 * Page Guilde de Forever (lot « Guilde », refonte du 23/10) : Joueurs (main et alts, bande « À rattacher » des officiers,
 * comptes du site ; « Par perso » : la liste de guilde du jeu, ou les fiches du site), Course au 60 et Historique (journal
 * de guilde). Adresses : /groups/:id/membres (Joueurs), /membres/persos, /membres/course, /membres/historique.
 * Données : GET /api/groups/:id/guild (types dans packages/game-data/src/guild.ts). Mains et alts : le lien d'un officier
 * prime ; « Est-ce ton perso ? » au joueur concerné.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
export type GuildView = "joueurs" | "persos" | "course" | "historique";
/** « Par joueur » (Joueurs) ou « Par perso » (Persos) : la même vue, deux lectures. */
function ByToggle({ groupId, view }: { groupId: string; view: GuildView }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const go = (persos: boolean) => {
    const q = new URLSearchParams(params); if (!persos) { q.delete("vue"); q.delete("perso"); }
    navigate(`/groups/${groupId}/membres${persos ? "/persos" : ""}${q.size ? `?${q}` : ""}`);
  };
  return (
    <div className="seg" role="group" aria-label="Par joueur ou par perso">
      <button type="button" className={view === "joueurs" ? "on" : ""} aria-pressed={view === "joueurs"} onClick={() => go(false)}>Par joueur</button>
      <button type="button" className={view === "persos" ? "on" : ""} aria-pressed={view === "persos"} onClick={() => go(true)}>Par perso</button>
    </div>
  );
}

const errorOf = (e: unknown) => (e instanceof ApiError ? e.message : "Action impossible.");
/** Tout ce qui vient de la guilde du jeu est à relire après une action (l'événement en direct « guild » suit pour les autres). */
export const refreshGuild = (qc: QueryClient, groupId: string) =>
  Promise.all(GUILD_QUERY_ROOTS.map(k => qc.invalidateQueries({ queryKey: [k, groupId] })));
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n > 1 ? ws : w}`;

/* ---------- Petits morceaux communs ---------- */

/** Guilde du site pas encore liée à la guilde du jeu : ce qui la remplira, en une phrase. */
export function NotLinked({ groupId, officer, onAdmin }: { groupId: string; officer: boolean; onAdmin?: () => void }) {
  const link = useGuildLink(groupId, officer);
  const proposals = link.data?.proposals ?? [];
  return (
    <div className="so-empty">
      <h3>Pas encore de liste de guilde</h3>
      <p>Elle arrive à la première synchro d'un officier de la guilde qui a l'addon à jour, puis se tient à jour toute seule.</p>
      {officer && (proposals.length
        ? <p className="small">{proposals.length > 1 ? `${proposals.length} guildes du jeu sont proposées` : <>La guilde du jeu <b>{proposals[0]!.name}</b> est proposée</>} : {onAdmin ? <button type="button" className="link" onClick={onAdmin}>la lier dans l'Administration</button> : "la lier dans l'Administration"}.</p>
        : <p className="small muted">Ce premier relevé lie la guilde du site à la guilde du jeu{onAdmin ? <> : tu le retrouves dans <button type="button" className="link" onClick={onAdmin}>l'Administration</button></> : null}.</p>)}
    </div>
  );
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
        <section key={q.guid} className="gm-act yours" aria-label={`Est-ce ton perso ? ${q.name}`}>
          <ClassDot cls={q.cls} size="md" />
          <span className="t"><b>Est-ce ton perso ?</b>
            <small>{q.by ?? "Un officier"} a rattaché <CharName name={q.name} cls={q.cls} as="span" />, {q.cls ? `${gt.cls(q.cls)} ` : "niveau "}{q.level}, à ton compte.</small></span>
          <span className="row">
            <button type="button" className="btn primary sm" disabled={busy === q.guid} onClick={() => void answer(q, true)}>Oui, c'est moi</button>
            <button type="button" className="btn ghost sm" disabled={busy === q.guid} onClick={() => void answer(q, false)}>Non</button>
          </span>
        </section>
      ))}
      {err && <div className="alert error" role="alert">{err}</div>}
    </>
  );
}

/** Fenêtre modale native (focus piégé, Échap) ; la retirer de la page suffit à la fermer. */
function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return <dialog ref={ref} className="sg-dialog gd" aria-labelledby={label} onClose={onClose}>{children}</dialog>;
}
function DialogHead({ id, title, sub, onClose }: { id: string; title: ReactNode; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="row between sg-head">
      <div style={{ minWidth: 0 }}><h2 id={id}>{title}</h2>{sub && <p className="gd-sub">{sub}</p>}</div>
      <button type="button" className="pi-close" aria-label="Fermer" onClick={onClose}>✕</button>
    </div>
  );
}

/** Ce que dit la petite ligne d'un perso : classe et niveau, rang. */
function useCharLine() {
  const gt = useGameText();
  return (c: Pick<GuildChar, "cls" | "level">) => `${c.cls ? `${gt.cls(c.cls)} ` : "Niveau "}${c.level}`;
}

type Dialog = { kind: "attach"; guid: string } | { kind: "main"; key: string } | { kind: "claim"; guid: string } | null;

/** « Rattacher X à… » (officiers) : un joueur de la guilde, un perso à rattacher, ou un nouveau joueur dont X est le main. */
function AttachDialog({ groupId, data, guid, myId, onClose }: { groupId: string; data: GuildMembersResponse; guid: string; myId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const line = useCharLine();
  const byGuid = useMemo(() => new Map(data.chars.map(c => [c.guid, c])), [data]);
  const c = byGuid.get(guid);
  const suggestion = data.unattached.find(u => u.guid === guid)?.suggestion ?? null;
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
  const needle = q.trim().toLowerCase();
  type Opt = { key: string; main: GuildChar; sub: string; account: GuildPlayer["account"] };
  const players: Opt[] = data.players.filter(p => p.key !== c.player && byGuid.has(p.main)).map(p => {
    const main = byGuid.get(p.main)!;
    return { key: p.key, main, account: p.account, sub: [main.rank, p.account ? `compte ${p.account.displayName}` : "sans compte", p.alts.length ? plural(p.alts.length, "alt") : null].filter(Boolean).join(" · ") };
  });
  const band: Opt[] = data.unattached.filter(u => u.guid !== guid && byGuid.has(u.guid)).map(u => ({ key: `m:${u.guid}`, main: byGuid.get(u.guid)!, account: null, sub: `${byGuid.get(u.guid)!.rank} · à rattacher` }));
  const match = (o: Opt) => !needle || `${o.main.name} ${o.account?.displayName ?? ""}`.toLowerCase().includes(needle);
  const all = [...players, ...band];
  const top = all.filter(o => suggested.has(o.key));
  const rest = all.filter(o => !suggested.has(o.key) && match(o)).sort((a, b) => a.main.name.localeCompare(b.main.name));
  const chosen = all.find(o => o.key === to) ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!to) return;
    setBusy(true); setErr(null);
    try { await put(`/groups/${groupId}/guild/members/${guid}/link`, { to }); await refreshGuild(qc, groupId); onClose(); }
    catch (x) { setErr(errorOf(x)); setBusy(false); }
  };
  const opt = (o: Opt) => (
    <li key={o.key}><label className="gd-opt">
      <input type="radio" name="gd-to" value={o.key} checked={to === o.key} onChange={() => setTo(o.key)} />
      <ClassDot cls={o.main.cls} />
      <span className="t"><span className="nm"><CharName name={o.main.name} cls={o.main.cls} /><span className="lvn">{o.main.level}</span></span><small>{o.sub}</small></span>
    </label></li>
  );
  const why = suggestion ? `${suggestion.from === "officerNote" ? "note d'officier" : "note de guilde"} « ${suggestion.note} »` : c.note ? `note « ${c.note} »` : "pas de note de guilde";
  return (
    <Modal label="gd-t" onClose={onClose}>
      <form onSubmit={e => void submit(e)}>
        <DialogHead id="gd-t" title={<>Rattacher {c.name} à…</>} sub={<><ClassDot cls={c.cls} /><span>{line(c)} · {why}</span></>} onClose={onClose} />
        <input type="search" placeholder="Chercher un joueur ou un perso…" aria-label="Chercher un joueur ou un perso" value={q} onChange={e => setQ(e.target.value)} />
        <ul className="gd-list" aria-label="Joueurs de la guilde">
          {top.length > 0 && <><li className="gd-group">Suggéré par la note</li>{top.map(opt)}{rest.length > 0 && <li className="gd-group">Autres joueurs</li>}</>}
          {rest.map(opt)}
          {!top.length && !rest.length && <li className="muted small">Personne ne correspond.</li>}
        </ul>
        <label className="gd-opt new">
          <input type="radio" name="gd-to" value="new" checked={to === "new"} onChange={() => setTo("new")} />
          <span className="t"><b>Nouveau joueur</b><small>{c.firstName} est son main</small></span>
        </label>
        {chosen?.account && chosen.account.userId !== myId && <p className="hint" style={{ margin: 0 }}>{chosen.account.displayName} a un compte : « Est-ce ton perso ? » s'affichera à sa prochaine visite (Oui / Non).</p>}
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!to || busy}>{to === "new" ? "En faire un joueur à part" : chosen ? `Rattacher à ${chosen.account?.displayName ?? chosen.main.firstName}` : "Rattacher"}</button>
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
        <DialogHead id="gm-t" title={p.me ? "Ton main" : `Main de ${p.account?.displayName ?? byGuid.get(p.main)?.firstName ?? "ce joueur"}`} sub="Le main mène sa ligne dans Joueurs et dans la course ; les autres persos sont ses alts." onClose={onClose} />
        <ul className="gd-list" aria-label="Persos du joueur">{chars.map(c => (
          <li key={c.guid}><label className="gd-opt">
            <input type="radio" name="gm-main" value={c.guid} checked={guid === c.guid} onChange={() => setGuid(c.guid)} />
            <ClassDot cls={c.cls} />
            <span className="t"><span className="nm"><CharName name={c.name} cls={c.cls} /><span className="lvn">{c.level}</span></span><small>{line(c)} · {c.rank}</small></span>
          </label></li>
        ))}</ul>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || guid === p.main}>Choisir comme main</button>
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
        <DialogHead id="gc-t" title={<>{c.name} est à toi ?</>} sub={<><ClassDot cls={c.cls} /><span>{line(c)} · {c.rank}</span></>} onClose={onClose} />
        <p style={{ margin: 0 }}>Il rejoint tes persos dans la guilde : ta ligne dans Joueurs et dans la course. Un officier peut toujours corriger.</p>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div className="row sg-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void claim()}>Oui, c'est mon perso</button>
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
  const [dialog, setDialog] = useState<Dialog>(null);
  const officer = myRole !== "member";
  const data = q.data;
  // Ligne au-dessus de la vue : « Par joueur / Par perso » (Joueurs) et un texte à droite (départ de la course…)
  const nav = (right?: ReactNode, toggle = false) => (toggle || right ? <div className="subnav">{toggle && <ByToggle groupId={groupId} view={view} />}{right}</div> : null);
  const empty = <NotLinked groupId={groupId} officer={officer} onAdmin={onAdmin} />;

  let body: ReactNode;
  if (view === "course") return <GuildRace groupId={groupId} nav={nav} empty={empty} />;
  if (view === "historique") body = <History groupId={groupId} nav={nav} empty={empty} linked={data ? !!data.link : null} />;
  else if (!data) body = <div className="stack"><p className="muted">{q.error ? "Liste de guilde indisponible pour l'instant." : "Chargement…"}</p></div>;
  else if (view === "persos") body = <Chars groupId={groupId} groupName={groupName} data={data} nav={nav} empty={empty} members={members} myRole={myRole} myId={myId} openDialog={setDialog} guard={guard} />;
  else body = (
    <div className="stack">
      <QuestionBand groupId={groupId} questions={data.questions} />
      {data.link ? <Players groupId={groupId} data={data} members={members} myRole={myRole} myId={myId} guard={guard} openDialog={setDialog} />
        : <>{nav(undefined, true)}{empty}<h4 className="gm-sec">Membres du site <span className="num">{members.length}</span></h4>
          <SiteMembers groupId={groupId} members={members} myRole={myRole} myId={myId} guard={guard} /></>}
    </div>
  );
  return (
    <>
      {body}
      {data && dialog?.kind === "attach" && <AttachDialog groupId={groupId} data={data} guid={dialog.guid} myId={myId} onClose={() => setDialog(null)} />}
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

  return (
    <>
      <div className="row gc-tools">
        <input type="search" placeholder="Chercher un joueur ou un perso…" aria-label="Chercher un joueur ou un perso" value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 220px" }} />
        <ByToggle groupId={groupId} view="joueurs" />
      </div>
      {!data.me.player && <p className="hint" style={{ margin: 0 }}>Tu n'es pas dans la liste ? Fais ta synchro avec l'addon à jour, ou « C'est mon perso » dans le menu « … ».</p>}
      <div className="gp" role="table" aria-label="Joueurs de la guilde">
        <div className="gp-h" role="row"><span role="columnheader">Joueur · main</span><span role="columnheader">Rang</span><span role="columnheader">Alts</span><span role="columnheader">Connexion</span><span role="columnheader">Compte du site</span><span /></div>
        {shown.map(p => {
          const main = byGuid.get(p.main)!;
          const alts = p.alts.map(g => byGuid.get(g)).filter((c): c is GuildChar => !!c);
          const chars = [main, ...alts];
          const seen = seenText(p.online, p.lastOnlineAt);
          const m = p.account ? memberOf.get(p.account.userId) : undefined;
          const can = m ? siteRights(myRole, myId, m) : { role: false, remove: false };
          const asking = m && ask?.userId === m.userId ? ask.action : null;
          const actions = (close: () => void) => {
            const out: ReactNode[] = [];
            const item = (key: string, label: string, fn: () => void, bad = false) => out.push(<button key={key} type="button" role="menuitem" className={bad ? "bad" : undefined} onClick={() => { close(); fn(); }}>{label}</button>);
            if (p.account) item("sheet", sheet === p.account.userId ? "Fermer la fiche" : "Voir la fiche", () => setSheet(s => (s === p.account!.userId ? null : p.account!.userId)));
            if (chars.length > 1 && (officer || p.me)) item("main", "Choisir le main…", () => openDialog({ kind: "main", key: p.key }));
            if (officer) for (const c of chars) item(`a${c.guid}`, chars.length > 1 ? `Rattacher ${c.name} à…` : "Rattacher à…", () => openDialog({ kind: "attach", guid: c.guid }));
            if (!p.account && claimable(main)) item("claim", "C'est mon perso", () => openDialog({ kind: "claim", guid: main.guid }));
            if (m && can.role && m.role === "member") item("off", "Nommer officier", () => void setRole(m, "officer"));
            if (m && can.role && m.role === "officer") item("mem", "Repasser membre", () => void setRole(m, "member"));
            if (m && can.role) item("own", "Transférer la propriété…", () => setAsk({ userId: m.userId, action: "owner" }));
            if (m && can.remove) item("rm", "Retirer de la guilde…", () => setAsk({ userId: m.userId, action: "remove" }), true);
            return out;
          };
          return (
            <Fragment key={p.key}>
              <div className={`gp-r${p.me ? " me" : ""}`} role="row">
                <span className="gp-who" role="cell">
                  <ClassDot cls={main.cls} size="md" />
                  <span className="t">
                    <span className="nm"><CharName name={main.name} cls={main.cls} /><span className="lvn">{main.level}</span>{p.me && <span className="tag gold">Toi</span>}</span>
                    <small>{[main.cls ? gt.cls(main.cls) : null, main.race].filter(Boolean).join(" · ") || "Classe inconnue"}</small>
                  </span>
                </span>
                <span className={`gp-rank${main.rankIndex <= 1 ? " off" : ""}`} role="cell" title={main.rank}>{main.rank}</span>
                <span className={`gp-alts${alts.length ? "" : " nil"}`} role="cell">
                  {alts.length ? alts.map(a => <span key={a.guid} className="ac" title={`${a.name}, niveau ${a.level}`}><ClassDot cls={a.cls} /><CharName name={a.name} cls={a.cls} as="span" /><span className="lvn">{a.level}</span></span>)
                    : <span className="none" aria-label="Aucun alt">—</span>}
                </span>
                <span className={`gp-seen ${seen.state}`} role="cell"><i aria-hidden="true" />{seen.text}</span>
                {p.account
                  ? <button type="button" className="gp-acc" role="cell" aria-expanded={sheet === p.account.userId} onClick={() => setSheet(s => (s === p.account!.userId ? null : p.account!.userId))}
                      title={`Fiche de ${p.account.displayName}`}>
                      <span className="avatar" style={{ width: 20, height: 20 }}><Portrait id={p.account.avatarId} size={20} fallback={<span style={{ fontSize: 10 }}>{p.account.displayName[0]}</span>} /></span>
                      <span>{p.account.displayName}</span>
                    </button>
                  : <span className="gp-acc no" role="cell">sans compte</span>}
                <PlayerMenu label={`Actions pour ${main.name}`} build={actions} />
              </div>
              {asking && m && (
                <div className="gp-ask" role="row">
                  {asking === "owner" ? <>Donner la guilde à {m.displayName} ? Tu deviens officier.<button type="button" className="btn danger sm" onClick={() => void setRole(m, "owner")}>Transférer</button></>
                    : <>Retirer {m.displayName} de la guilde sur le site ? Rien ne change en jeu.<button type="button" className="btn danger sm" onClick={() => void remove(m)}>Retirer</button></>}
                  <button type="button" className="btn ghost sm" onClick={() => setAsk(null)}>Annuler</button>
                </div>
              )}
              {p.account && sheet === p.account.userId && (
                <div className="gp-sheet" role="row"><PlayerSheet key={sheet} groupId={groupId} userId={sheet} officer={myRole !== "member"} onClose={() => setSheet(null)} /></div>
              )}
            </Fragment>
          );
        })}
        {!rows.length && <p className="muted" style={{ margin: 0, padding: "12px" }}>{needle ? "Personne ne correspond." : "Personne dans la liste pour l'instant."}</p>}
        {rows.length > shown.length && <button type="button" className="rk-more" onClick={() => setAll(true)}>Voir les {rows.length - shown.length} autres joueurs</button>}
      </div>
      {officer && data.unattached.length > 0 && <AttachBand groupId={groupId} data={data} openDialog={openDialog} />}
      {siteOnly.length > 0 && (
        <section className="stack" style={{ gap: 8 }} aria-labelledby="gp-site">
          <h4 className="gm-sec" id="gp-site">Sur le site, sans perso dans la liste du jeu <span className="num">{siteOnly.length}</span></h4>
          <SiteMembers groupId={groupId} members={members} only={new Set(siteOnly.map(m => m.userId))} myRole={myRole} myId={myId} guard={guard}
            hint="Leurs persos n'ont pas encore été reconnus : l'addon à jour les rattache à leur prochaine synchro." />
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
      <div className="gq-h"><h3 id="gq-t">À rattacher <span className="num">{data.unattached.length}</span></h3>
        <span className="muted small">Persos sans joueur ; les notes de guilde suggèrent leur main.</span></div>
      <ul className="gq-list">
        {data.unattached.map(u => {
          const c = byGuid.get(u.guid);
          if (!c) return null;
          const s = u.suggestion;
          const src = s ? `${s.from === "officerNote" ? "note d'officier" : "note de guilde"} « ${s.note} »` : `${c.joinedAt ? `arrivée ${c.joinedApprox ? "vers le" : "le"} ${dayMonth(c.joinedAt)}` : "nouveau"} · ${c.note ? `note « ${c.note} »` : "pas de note"}`;
          return (
            <li key={u.guid} className="gq-item">
              <ClassDot cls={c.cls} size="md" />
              <span className="t"><span className="nm"><CharName name={c.name} cls={c.cls} /><span className="lvn">{c.level}</span></span><small>{src}</small></span>
              {s?.target ? <span className="gq-sug">Alt de <b>{s.target.name}</b> ?</span>
                : s?.candidates.length ? <span className="gq-sug">Alt de qui ? {s.candidates.length} persos portent ce nom.</span>
                : <span className="gq-sug muted">Aucune suggestion</span>}
              <span className="gq-acts">
                {s?.target ? <>
                  <button type="button" className="btn sm primary" disabled={busy === u.guid} onClick={() => void accept(u.guid)}>Accepter</button>
                  <button type="button" className="btn ghost sm" onClick={() => openDialog({ kind: "attach", guid: u.guid })}>Autre…</button>
                </> : <button type="button" className="btn sm" onClick={() => openDialog({ kind: "attach", guid: u.guid })}>{s?.candidates.length ? "Choisir…" : "Rattacher à…"}</button>}
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

const LEVELS: [string, number, number][] = [["Tous", 1, 60], ["1-29", 1, 29], ["30-49", 30, 49], ["50-60", 50, 60]];
const CHARS_PAGE = 100;

function Chars({ groupId, groupName, data, nav, empty, members, myRole, myId, openDialog, guard }: {
  groupId: string; groupName: string; data: GuildMembersResponse; nav: (right?: ReactNode, toggle?: boolean) => ReactNode; empty: ReactNode; members: Member[]; myRole: GroupRole; myId?: string;
  openDialog: (d: Dialog) => void; guard: Guard;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const [params, setParams] = useSearchParams();
  const linked = !!data.link;
  const sheets = !linked || params.get("vue") === "fiches" || params.has("perso");
  const setSheets = (on: boolean) => setParams(p => { if (on) p.set("vue", "fiches"); else { p.delete("vue"); p.delete("perso"); } return p; }, { replace: true });
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
  const mode = linked && (
    <div className="seg" role="group" aria-label="Persos : liste du jeu ou fiches du site">
      <button type="button" className={sheets ? "" : "on"} aria-pressed={!sheets} onClick={() => setSheets(false)}>Liste du jeu</button>
      <button type="button" className={sheets ? "on" : ""} aria-pressed={sheets} onClick={() => setSheets(true)}>Fiches du site</button>
    </div>
  );
  if (sheets) {
    return (
      <div className="stack">
        {nav(mode || undefined, true)}
        {!linked && empty}
        <GroupCharacters groupId={groupId} groupName={groupName} members={members} myId={myId} myRole={myRole} />
      </div>
    );
  }
  const playerText = (c: GuildChar) => {
    if (!c.player) return <span className="tag warn">à rattacher</span>;
    const p = players.get(c.player);
    if (p?.account) return p.account.displayName;
    if (p && p.main !== c.guid) return <span>{byGuid.get(p.main)?.name ?? "—"} <span className="muted small">sans compte</span></span>;
    return <span className="muted">sans compte</span>;
  };
  return (
    <div className="stack">
      {nav(mode || undefined, true)}
      <div className="row gc-tools">
        <input type="search" placeholder="Nom, note…" aria-label="Chercher un perso" value={q} onChange={e => setQ(e.target.value)} style={{ flex: "1 1 180px" }} />
        <select aria-label="Classe" value={cls} onChange={e => setCls(e.target.value)} style={{ width: "auto" }}>
          <option value="">Toutes les classes</option>{CLASS_NAMES.map(c => <option key={c} value={c}>{gt.cls(c)}</option>)}
        </select>
        <div className="seg" role="group" aria-label="Niveau">
          {LEVELS.map(([l], i) => <button key={l} type="button" className={lv === i ? "on" : ""} aria-pressed={lv === i} onClick={() => setLv(i)}>{l}</button>)}
        </div>
        <select aria-label="Rang" value={rank} onChange={e => setRank(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: "auto" }}>
          <option value="">Tous les rangs</option>{ranks.map(([i, r]) => <option key={i} value={i}>{r}</option>)}
        </select>
        <label className="gr-tog" style={{ paddingTop: 0 }}><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /><i aria-hidden="true" />Actifs depuis moins de 7 jours</label>
      </div>
      <div className="tscroll"><table className="data gx-table">
        <thead><tr><th>Perso</th><th>Niv.</th><th>Rang</th><th>Joueur</th><th>Note de guilde</th>
          {officer && <th>Note d'officier <span className="tag" style={{ fontSize: 9, padding: "2px 4px" }}>officiers</span></th>}<th>Connexion</th><th /></tr></thead>
        <tbody>{shown.map(c => {
          const seen = seenText(c.online, c.lastOnlineAt);
          const p = c.player ? players.get(c.player) : undefined;
          const count = p ? 1 + p.alts.length : 1;
          const actions = (close: () => void) => {
            const out: ReactNode[] = [];
            const add = (k: string, label: string, fn: () => void) => out.push(<button key={k} type="button" role="menuitem" onClick={() => { close(); fn(); }}>{label}</button>);
            if (officer) add("a", "Rattacher à…", () => openDialog({ kind: "attach", guid: c.guid }));
            if (c.link && c.link.source !== "account" && (officer || (c.mine && c.link.source === "declared"))) add("d", "Détacher de son joueur", () => void detach(c));
            if (c.player && !c.isMain && count > 1 && (officer || c.mine)) add("m", "En faire le main", () => void setMain(c));
            if (claimable(c)) add("c", "C'est mon perso", () => openDialog({ kind: "claim", guid: c.guid }));
            return out;
          };
          return (
            <tr key={c.guid} className={c.mine ? "ps-sel" : undefined}>
              <td><span className="gx-name"><ClassDot cls={c.cls} />{c.player && !c.isMain && <span className="gm-alt">alt</span>}<CharName name={c.name} cls={c.cls} />{c.mine && <span className="tag gold">Toi</span>}</span></td>
              <td className="num">{c.level}</td>
              <td className="small">{c.rank}</td>
              <td className="small">{playerText(c)}</td>
              <td className="small gx-note">{c.note || <span className="muted">—</span>}</td>
              {officer && <td className="small gx-note">{c.officerNote || <span className="muted">—</span>}</td>}
              <td className={`small nowrap${seen.state === "on" ? " ok-c" : ""}`}>{seen.text}</td>
              <td className="mb-act">
                <PlayerMenu label={`Actions pour ${c.name}`} build={actions} />
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {!list.length && <p className="muted" style={{ margin: 0 }}>Aucun perso ne correspond.</p>}
      {list.length > shown.length && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setAll(true)}>Voir les {list.length - shown.length} autres</button>}
      <p className="hint" style={{ margin: 0 }}>{plural(list.length, "perso")} sur {data.chars.length}{active ? " · actifs depuis moins de 7 jours" : ""}</p>
    </div>
  );
}

/* ---------- Historique ---------- */

const MOVE: Record<GuildMove["kind"], { cls: string; s: string; label: string }> = {
  join: { cls: "in", s: "+", label: "Arrivée" }, leave: { cls: "out", s: "−", label: "Départ" }, remove: { cls: "out", s: "−", label: "Renvoi" },
  promote: { cls: "up", s: "↑", label: "Promotion" }, demote: { cls: "down", s: "↓", label: "Rétrogradation" },
};
/** Ce qui s'est passé, en peu de mots (les noms complets viennent du journal du jeu). */
export function moveText(m: GuildMove) {
  return m.kind === "join" ? "rejoint la guilde" : m.kind === "promote" || m.kind === "demote" ? `passe ${m.rank ?? (m.kind === "promote" ? "au rang supérieur" : "au rang inférieur")}` : "quitte la guilde";
}
function moveDetail(m: GuildMove) {
  if (m.kind === "join") return m.by ? `invitation de ${m.by}` : null;
  if (m.kind === "promote" || m.kind === "demote") return m.by ? `par ${m.by}` : null;
  return [m.kind === "remove" && m.by ? `renvoi par ${m.by}` : null, m.who.level ? `niveau ${m.who.level}` : null, m.who.joinedAt ? `arrivée le ${dayMonth(m.who.joinedAt)}` : null].filter(Boolean).join(" · ") || null;
}
export const MoveSign = ({ m }: { m: GuildMove }) => <span className="s" aria-label={MOVE[m.kind].label}>{MOVE[m.kind].s}</span>;
export const moveClass = (m: GuildMove) => MOVE[m.kind].cls;
/** Heure d'un événement du journal : le jeu ne la donne qu'à l'heure près (« il y a N heures »). */
const hourText = (iso: string) => `vers ${zonedParts(new Date(iso)).hour} h`;

function History({ groupId, nav, empty, linked }: { groupId: string; nav: (right?: ReactNode, toggle?: boolean) => ReactNode; empty: ReactNode; linked: boolean | null }) {
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
        <div className="seg" role="group" aria-label="Événements">
          {([["all", "Tout"], ["joins", "Arrivées"], ["leaves", "Départs"], ["ranks", "Rangs"]] as const).map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        {first && <span className="muted small">{first.journal ? `Journal de guilde relevé par l'addon${first.since ? ` · depuis le ${dayMonth(first.since)}` : ""}` : "Journal de guilde pas encore relevé"}</span>}
      </div>
      {!q.data ? <p className="muted">{q.error ? "Historique indisponible pour l'instant." : "Chargement…"}</p>
        : !moves.length ? <p className="muted" style={{ margin: 0 }}>{first?.journal ? "Rien de ce genre dans le journal pour l'instant." : "Le journal de guilde arrive avec la synchro d'un membre qui a l'addon à jour."}</p>
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
                    <time dateTime={m.at} title={`${shortDay(m.at)}, à l'heure près (journal du jeu)`}>{hourText(m.at)}</time>
                  </li>
                );
              })}</ul>
            </Fragment>
          ))}</div>
        )}
      {q.hasNextPage && <button type="button" className="btn ghost sm" style={{ justifySelf: "start" }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Plus ancien</button>}
    </div>
  );
}
