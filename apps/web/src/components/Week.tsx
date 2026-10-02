import { SIGNUP_LABEL, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, put, type Character, type GroupRole } from "../api";
import { useMe } from "../auth";
import { useViewPref } from "../prefs";

/* ---------- Données (GET /api/week) ---------- */

export interface WeekRaid {
  id: string; groupId: string; groupName: string; name: string; scheduledAt: string;
  counts: { coming: number; tank: number; heal: number; dps: number; tentative: number };
  mine: { status: SignupStatus; characterId: string | null; characterName: string | null } | null;
}
export type WeekTodo =
  | { kind: "signup"; raidId: string; groupId: string; name: string; groupName: string; scheduledAt: string }
  | { kind: "sync"; characterId: string; name: string; days: number }
  | { kind: "incomplete"; characterId: string; name: string; missing: "classe" | "spé" };
export interface WeekData {
  raids: WeekRaid[]; todo: WeekTodo[];
  groups: { id: string; name: string; role: GroupRole; raids: number }[];
  steps: { character: boolean; group: boolean; addon: boolean };
}

export function useWeek() {
  const me = useMe();
  // Rechargé à chaque affichage (bandeau, onglet) : perso créé, groupe rejoint, synchro faite ailleurs
  return useQuery({ queryKey: ["week"], queryFn: () => get<WeekData>("/week"), staleTime: 5_000, refetchOnMount: "always", enabled: !!me.data?.user });
}
function useMyChars() {
  return useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
}

/* ---------- Dates ---------- */

const DAY = 86400_000;
const hm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « ce soir 21:00 », « demain 21:00 », « samedi 21:00 », sinon la date. */
export function whenText(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (days === 0) return `${d.getHours() >= 17 ? "ce soir" : "aujourd'hui"} ${hm(d)}`;
  if (days === 1) return `demain ${hm(d)}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString("fr-FR", { weekday: "long" })} ${hm(d)}`;
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
/** « dans 2 h 14 », « dans 3 jours », « en cours ». */
export function untilText(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "en cours";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `dans ${min} min`;
  if (min < 24 * 60) return `dans ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
  const d = Math.round(ms / DAY);
  return `dans ${d} jour${d > 1 ? "s" : ""}`;
}

/** Raid mis en avant : le prochain (ou celui qui vient de commencer). */
export const nextRaid = (w?: WeekData) => w?.raids[0] ?? null;

/* ---------- Inscription en un clic ---------- */

const QUICK: SignupStatus[] = ["present", "tentative", "absent"];

function QuickSignup({ raid, chars }: { raid: WeekRaid; chars: Character[] }) {
  const qc = useQueryClient();
  const usable = chars.filter(c => c.cls);
  const [charId, setCharId] = useState(raid.mine?.characterId ?? usable[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (raid.mine?.characterId) setCharId(raid.mine.characterId); }, [raid.mine?.characterId]);
  const char = usable.find(c => c.id === charId);

  const signUp = async (status: SignupStatus) => {
    setBusy(true); setError(null);
    try {
      await put(`/groups/${raid.groupId}/raids/${raid.id}/signup`, { status, characterId: status === "absent" && !char ? null : char?.id ?? null, spec: char?.spec1 || undefined });
      await Promise.all([qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["raids", raid.groupId] }), qc.invalidateQueries({ queryKey: ["raid", raid.id] })]);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Inscription impossible."); }
    finally { setBusy(false); }
  };

  return (
    <div className="wk-signup">
      {usable.length > 1 && (
        <select aria-label={`Perso pour ${raid.name}`} value={charId} onChange={e => setCharId(e.target.value)}>
          {usable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <div className="wk-seg" role="group" aria-label={`Mon statut pour ${raid.name}`}>
        {QUICK.map(st => (
          <button key={st} type="button" className={`su-btn ${st}`} aria-pressed={raid.mine?.status === st}
            disabled={busy || (st !== "absent" && !char)} onClick={() => void signUp(st)}>{SIGNUP_LABEL[st]}</button>
        ))}
      </div>
      {raid.mine && !QUICK.includes(raid.mine.status) && <span className={`tag su-tag ${raid.mine.status}`}>{SIGNUP_LABEL[raid.mine.status]}</span>}
      {error && <span className="warnmsg small" role="alert">{error}</span>}
    </div>
  );
}

const Counts = ({ r }: { r: WeekRaid }) => (
  <span className="wk-counts num">
    <b>{r.counts.coming}</b> viennent · {r.counts.tank} tank{r.counts.tank > 1 ? "s" : ""} · {r.counts.heal} heal{r.counts.heal > 1 ? "s" : ""} · {r.counts.dps} DPS
    {r.counts.tentative > 0 && ` · ${r.counts.tentative} peut-être`}
  </span>
);

/* ---------- Bandeau de Mes persos ---------- */

/** En haut de Mes persos : prochain raid et inscription en un clic, et le nombre de choses à faire (détail : onglet Cette semaine). */
export function WeekBand() {
  const week = useWeek();
  const chars = useMyChars();
  const [mode, setMode] = useViewPref<"open" | "folded">("week-band", "open", ["open", "folded"]);
  const w = week.data;
  const r = nextRaid(w);
  const todo = w?.todo.length ?? 0;
  if (!w || (!r && !todo)) return null;

  const todoLink = todo > 0 && (
    <Link to="/semaine" className="wk-todo"><span className="n num">{todo}</span> à faire</Link>
  );

  if (mode === "folded" || !r) {
    return (
      <section className="wk-band folded" aria-label="Cette semaine">
        <span className="eyebrow">Cette semaine</span>
        {r ? <span className="wk-mini"><b>{r.name}</b> <span className="muted small">{whenText(r.scheduledAt)}{r.mine ? ` · ${SIGNUP_LABEL[r.mine.status]}` : " · pas inscrit"}</span></span>
          : <span className="muted small">Aucun raid dans les 7 jours.</span>}
        <span className="wk-tools">
          {todoLink}
          {r && <button type="button" className="wk-fold" aria-label="Déplier le bandeau" title="Déplier" onClick={() => setMode("open")}>▾</button>}
        </span>
      </section>
    );
  }

  return (
    <section className="wk-band" aria-label="Cette semaine">
      <div className="wk-raid">
        <span className="eyebrow">Prochain raid · {r.groupName}</span>
        <Link to={`/groups/${r.groupId}/raids/${r.id}`} className="wk-name">{r.name}<span className="wk-when num">{whenText(r.scheduledAt)} · {untilText(r.scheduledAt)}</span></Link>
        <Counts r={r} />
      </div>
      <QuickSignup raid={r} chars={chars.data?.characters ?? []} />
      <span className="wk-tools">
        {todoLink || <Link to="/semaine" className="wk-more small">Cette semaine →</Link>}
        <button type="button" className="wk-fold" aria-label="Réduire le bandeau" title="Réduire" onClick={() => setMode("folded")}>▴</button>
      </span>
    </section>
  );
}

/* ---------- Onglet Cette semaine ---------- */

function TodoItem({ t }: { t: WeekTodo }) {
  if (t.kind === "signup") return (
    <li className="wk-item signup"><span><b>{t.name}</b> {whenText(t.scheduledAt)} : pas encore de réponse<span className="sub">{t.groupName}</span></span>
      <Link className="btn sm" to={`/groups/${t.groupId}/raids/${t.raidId}`}>Répondre</Link></li>
  );
  if (t.kind === "sync") return (
    <li className="wk-item sync"><span><b>{t.name}</b> n'est pas synchronisé depuis {t.days} jours<span className="sub">En jeu : ta touche de synchro, Ctrl+C, puis Ctrl+V sur n'importe quelle page du site.</span></span>
      <Link className="btn sm" to="/addon">Comment ?</Link></li>
  );
  return (
    <li className="wk-item incomplete"><span><b>{t.name}</b> n'a pas de {t.missing}<span className="sub">Il en faut une pour s'inscrire aux raids.</span></span>
      <Link className="btn sm" to={`/persos/${t.characterId}`}>Compléter</Link></li>
  );
}

export function WeekPage() {
  const me = useMe();
  const week = useWeek();
  const chars = useMyChars();
  const w = week.data;
  if (week.isLoading || !w) return <p className="muted">Chargement…</p>;
  const [first, ...later] = w.raids;
  const myChars = chars.data?.characters ?? [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">{me.data?.user ? `Bonjour ${me.data.user.displayName}` : "Planning"}</div><h1>Cette semaine</h1></div></div>
      <div className="wk-grid">
        <div className="stack">
          {first ? (
            <section className="panel lift pad stack wk-hero" aria-label="Prochain raid">
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="eyebrow">Prochain raid · {first.groupName}</div>
                  <h2 className="wk-hero-name"><Link to={`/groups/${first.groupId}/raids/${first.id}`}>{first.name}</Link></h2>
                </div>
                <div className="wk-hero-when"><span className="small muted">{whenText(first.scheduledAt)}</span><b className="num">{untilText(first.scheduledAt)}</b></div>
              </div>
              <Counts r={first} />
              <QuickSignup raid={first} chars={myChars} />
              {later.length > 0 && (
                <ul className="wk-later">
                  {later.map(r => (
                    <li key={r.id}>
                      <span><Link to={`/groups/${r.groupId}/raids/${r.id}`}><b>{r.name}</b></Link> <span className="muted small">· {whenText(r.scheduledAt)} · {r.groupName}</span><br /><Counts r={r} /></span>
                      <QuickSignup raid={r} chars={myChars} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="panel pad"><h2 className="wk-h">Raids</h2><p className="muted" style={{ margin: 0 }}>Aucun raid prévu dans les 7 jours dans tes groupes.</p></section>
          )}
        </div>
        <div className="stack">
          <section className="panel pad stack" aria-label="À faire">
            <div className="row between"><h2 className="wk-h">À faire</h2><span className="muted small">{w.todo.length ? `${w.todo.length} chose${w.todo.length > 1 ? "s" : ""}` : "rien"}</span></div>
            {w.todo.length ? <ul className="wk-list">{w.todo.map((t, i) => <TodoItem key={i} t={t} />)}</ul>
              : <p className="muted" style={{ margin: 0 }}>Tout est à jour.</p>}
          </section>
          <section className="panel pad stack" aria-label="Mes groupes">
            <div className="row between"><h2 className="wk-h">Mes groupes</h2><Link to="/groups" className="small">Tous →</Link></div>
            {w.groups.length ? (
              <ul className="wk-groups">
                {w.groups.map(g => (
                  <li key={g.id}><Link to={`/groups/${g.id}`}>{g.name}</Link>{g.role !== "member" && <span className="tag gold">{g.role === "owner" ? "Chef" : "Officier"}</span>}
                    <span className="muted small">{g.raids ? `${g.raids} raid${g.raids > 1 ? "s" : ""} cette semaine` : "aucun raid cette semaine"}</span></li>
                ))}
              </ul>
            ) : <p className="muted" style={{ margin: 0 }}>Aucun groupe : ouvre le lien d'invitation de ton officier, ou crée ton groupe dans <Link to="/groups">Groupes</Link>.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- Démarrage ---------- */

const HIDE_STEPS = "fr-steps-hidden";

/** Les trois étapes : en grand quand le compte n'a aucun perso, sinon une ligne masquable tant qu'il en reste. */
export function StartSteps({ onCreate, compact }: { onCreate: () => void; compact?: boolean }) {
  const week = useWeek();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_STEPS) === "1"; } catch { return false; } });
  const s = week.data?.steps ?? { character: !compact, group: false, addon: false };
  const steps = [
    { done: s.character, title: "Crée ton perso", text: "Nom, race, classe et spé. Le reste peut attendre, ou venir de l'addon.",
      action: <button type="button" className="btn primary" onClick={onCreate}>+ Créer mon perso</button> },
    { done: s.group, title: "Rejoins ton groupe", text: "Ouvre le lien d'invitation donné par ton officier, ou crée ton propre groupe.",
      action: <Link className="btn" to="/groups">Créer un groupe</Link> },
    { done: s.addon, title: "Installe l'addon", optional: true, text: "Il remplit ta fiche depuis le jeu : équipement, métiers, talents.",
      action: <Link className="btn" to="/addon">Page Addon</Link> },
  ];
  const current = steps.findIndex(x => !x.done);

  if (compact) {
    if (hidden || current < 0 || !week.data) return null;
    const next = steps[current]!;
    return (
      <div className="steps-line" role="note" aria-label="Pour bien démarrer">
        {steps.map((x, i) => (
          <span key={x.title} className={`sl-step${x.done ? " done" : ""}`}>{x.done ? "✓" : <b className="num">{i + 1}</b>} {x.title}{x.optional && !x.done && <span className="muted small"> (facultatif)</span>}</span>
        ))}
        <span className="sl-action">{small(next.action)}</span>
        <button type="button" className="sl-hide" aria-label="Masquer ces étapes" title="Masquer" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_STEPS, "1"); } catch { /* masqué pour cette visite */ } }}>✕</button>
      </div>
    );
  }

  return (
    <div className="start">
      <h2>Trois étapes pour commencer</h2>
      <p className="muted">Ta fiche sert à ton groupe pour monter les raids : classe, spés, talents, métiers et objectifs BiS. Les étapes se cochent toutes seules.</p>
      <ol className="start-steps">
        {steps.map((x, i) => (
          <li key={x.title} className={x.done ? "done" : i === current ? "current" : ""}>
            <span className="n" aria-hidden="true">{x.done ? "✓" : i + 1}</span>
            <div><h3>{x.title}{x.optional && <span className="opt"> facultatif</span>}</h3><p>{x.text}</p></div>
            {!x.done && x.action}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Bouton d'étape en petite taille dans la ligne compacte. */
const small = (el: ReactElement<{ className?: string }>) => cloneElement(el, { className: `${el.props.className ?? ""} sm`.trim() });
