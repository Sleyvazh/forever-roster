import { type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, put, type Character } from "../api";
import { useMe } from "../auth";
import { useViewPref } from "../prefs";
import { RoleTag } from "./RoleIcon";
import { dateLocale, t, tn, tx } from "../i18n";
import { signupLabel } from "../i18n/game";

/* ---------- Données (GET /api/week) ---------- */

export interface WeekRaid {
  id: string; groupId: string; groupName: string; name: string; scheduledAt: string;
  counts: { coming: number; tank: number; heal: number; dps: number; tentative: number };
  mine: { status: SignupStatus; characterId: string | null; characterName: string | null } | null;
  /** Mon main dans le groupe du raid (choix par défaut pour s'inscrire). */
  mainId: string | null;
}
export type WeekTodo =
  | { kind: "signup"; raidId: string; groupId: string; name: string; groupName: string; scheduledAt: string }
  | { kind: "sync"; characterId: string; name: string; days: number }
  | { kind: "incomplete"; characterId: string; name: string; missing: "classe" | "spé" }
  | { kind: "assign"; groupId: string; groupName: string };
export interface WeekData {
  raids: WeekRaid[]; todo: WeekTodo[];
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
const hm = (d: Date) => d.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** « ce soir 21:00 », « demain 21:00 », « samedi 21:00 », sinon la date. */
export function whenText(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  if (days === 0) return d.getHours() >= 17 ? t("ce soir {time}", { time: hm(d) }) : t("aujourd'hui {time}", { time: hm(d) });
  if (days === 1) return t("demain {time}", { time: hm(d) });
  if (days > 1 && days < 7) return `${d.toLocaleDateString(dateLocale(), { weekday: "long" })} ${hm(d)}`;
  return d.toLocaleString(dateLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
/** « dans 2 h 14 », « dans 3 jours », « en cours ». */
export function untilText(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return t("en cours");
  const min = Math.round(ms / 60_000);
  if (min < 60) return t("dans {n} min", { n: min });
  if (min < 24 * 60) return t("dans {h} h {m}", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") });
  return tn(Math.round(ms / DAY), "dans {n} jour", "dans {n} jours");
}

/** Raid mis en avant : le prochain (ou celui qui vient de commencer). */
export const nextRaid = (w?: WeekData) => w?.raids[0] ?? null;

/* ---------- Inscription en un clic ---------- */

const QUICK: SignupStatus[] = ["present", "tentative", "absent"];

function QuickSignup({ raid, chars }: { raid: WeekRaid; chars: Character[] }) {
  const qc = useQueryClient();
  // Persos rangés dans le groupe du raid, ou sans groupe (un perso est rangé dans un seul groupe)
  const usable = chars.filter(c => c.cls && (!c.group || c.group.id === raid.groupId));
  // Main du groupe en tête de liste et choisi par défaut
  usable.sort((a, b) => Number(b.id === raid.mainId) - Number(a.id === raid.mainId));
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
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Inscription impossible.")); }
    finally { setBusy(false); }
  };

  return (
    <div className="wk-signup">
      {usable.length > 1 && (
        <select aria-label={t("Perso pour {raid}", { raid: raid.name })} value={charId} onChange={e => setCharId(e.target.value)}>
          {usable.map(c => <option key={c.id} value={c.id}>{c.id === raid.mainId ? `★ ${c.name}` : c.name}</option>)}
        </select>
      )}
      <div className="wk-seg" role="group" aria-label={t("Mon statut pour {raid}", { raid: raid.name })}>
        {QUICK.map(st => (
          <button key={st} type="button" className={`su-btn ${st}`} aria-pressed={raid.mine?.status === st}
            disabled={busy || (st !== "absent" && !char)} onClick={() => void signUp(st)}>{signupLabel(st)}</button>
        ))}
      </div>
      {raid.mine && !QUICK.includes(raid.mine.status) && <span className={`tag su-tag ${raid.mine.status}`}>{signupLabel(raid.mine.status)}</span>}
      {error && <span className="warnmsg small" role="alert">{error}</span>}
    </div>
  );
}

const Counts = ({ r }: { r: WeekRaid }) => (
  <span className="wk-counts">
    {tx(r.counts.coming > 1 ? "{n} viennent" : "{n} vient", { n: <b>{r.counts.coming}</b> })} · <RoleTag plain role="Tank" text={tn(r.counts.tank, "{n} tank", "{n} tanks")}><b>{r.counts.tank}</b></RoleTag> · <RoleTag plain role="Heal" text={tn(r.counts.heal, "{n} heal", "{n} heals")}><b>{r.counts.heal}</b></RoleTag> · <RoleTag plain role="DPS" text={`${r.counts.dps} DPS`}><b>{r.counts.dps}</b></RoleTag>
    {r.counts.tentative > 0 && <> · {tx("{n} peut-être", { n: <b>{r.counts.tentative}</b> })}</>}
  </span>
);

/* ---------- Bandeau de Mes persos ---------- */

function TodoItem({ t: item }: { t: Exclude<WeekTodo, { kind: "signup" }> }) {
  if (item.kind === "assign") return (
    <li className="wk-item assign"><span>{tx("Range un perso dans {guild}", { guild: <b>{item.groupName}</b> })}<span className="sub">{t("Tu n'y joues encore aucun perso : dans Mes persos, choisis sa guilde en haut de sa fiche (le premier devient ton main).")}</span></span>
      <Link className="btn sm" to="/persos">{t("Choisir")}</Link></li>
  );
  if (item.kind === "sync") return (
    <li className="wk-item sync"><span>{tx("{name} n'est pas synchronisé depuis {n} jours", { name: <b>{item.name}</b>, n: item.days })}<span className="sub">{t("En jeu : ta touche de synchro, Ctrl+C, puis Ctrl+V sur n'importe quelle page du site.")}</span></span>
      <Link className="btn sm" to="/addon">{t("Comment ?")}</Link></li>
  );
  return (
    <li className="wk-item incomplete"><span>{tx(item.missing === "classe" ? "{name} n'a pas de classe" : "{name} n'a pas de spé", { name: <b>{item.name}</b> })}<span className="sub">{t("Il en faut une pour s'inscrire aux raids.")}</span></span>
      <Link className="btn sm" to={`/persos/${item.characterId}`}>{t("Compléter")}</Link></li>
  );
}

/**
 * En haut de Mes persos : prochain raid et inscription en un clic. « N à faire » déplie les autres raids
 * de la semaine (inscription en un clic aussi) et le reste à faire. ▴ réduit le bandeau à une ligne.
 */
export function WeekBand() {
  const week = useWeek();
  const chars = useMyChars();
  const [mode, setMode] = useViewPref<"open" | "folded">("week-band", "open", ["open", "folded"]);
  const [details, setDetails] = useState(false);
  const w = week.data;
  const r = nextRaid(w);
  const later = w?.raids.slice(1) ?? [];
  const others = (w?.todo ?? []).filter((x): x is Exclude<WeekTodo, { kind: "signup" }> => x.kind !== "signup");
  const todo = w?.todo.length ?? 0;
  if (!w || (!r && !todo)) return null;
  const myChars = chars.data?.characters ?? [];
  const folded = mode === "folded" && !!r;
  const hasDetails = later.length > 0 || others.length > 0;

  const toggle = hasDetails && (
    <button type="button" className={todo ? "wk-todo" : "wk-more"} aria-expanded={details && !folded} aria-controls="wk-details"
      onClick={() => { if (folded) { setMode("open"); setDetails(true); } else setDetails(d => !d); }}>
      {todo ? tx("{n} à faire", { n: <span className="n num">{todo}</span> }) : tn(later.length, "{n} autre raid", "{n} autres raids")}
      <span aria-hidden="true">{details && !folded ? " ▴" : " ▾"}</span>
    </button>
  );

  return (
    <section className={`wk-band${folded ? " folded" : ""}`} aria-label={t("Cette semaine")}>
      <div className="wk-main">
        {folded ? (
          <>
            <span className="eyebrow">{t("Cette semaine")}</span>
            <span className="wk-mini"><b>{r!.name}</b> <span className="muted small">{whenText(r!.scheduledAt)}{` · ${r!.mine ? signupLabel(r!.mine.status) : t("pas de réponse")}`}</span></span>
          </>
        ) : r ? (
          <>
            <div className="wk-raid">
              <span className="eyebrow">{t("Prochain raid · {guild}", { guild: r.groupName })}</span>
              <Link to={`/groups/${r.groupId}/raids/${r.id}`} className="wk-name">{r.name}<span className="wk-when">{whenText(r.scheduledAt)} · {untilText(r.scheduledAt)}</span></Link>
              <Counts r={r} />
            </div>
            <QuickSignup raid={r} chars={myChars} />
          </>
        ) : (
          <><span className="eyebrow">{t("Cette semaine")}</span><span className="muted small">{t("Aucun raid dans les 7 jours.")}</span></>
        )}
        <span className="wk-tools">
          {toggle}
          {r && <button type="button" className="wk-fold" aria-label={folded ? t("Déplier le bandeau") : t("Réduire le bandeau")} title={folded ? t("Déplier") : t("Réduire")}
            onClick={() => { setMode(folded ? "open" : "folded"); setDetails(false); }}>{folded ? "▾" : "▴"}</button>}
        </span>
      </div>
      {details && !folded && (
        <div className="wk-details" id="wk-details">
          {later.length > 0 && (
            <>
              <div className="wk-sub">{t("Ensuite cette semaine")}</div>
              <ul className="wk-later">
                {later.map(x => (
                  <li key={x.id}>
                    <span><Link to={`/groups/${x.groupId}/raids/${x.id}`}><b>{x.name}</b></Link> <span className="muted small">· {whenText(x.scheduledAt)} · {x.groupName}</span>
                      {!x.mine && <span className="tag warn" style={{ marginLeft: 8 }}>{t("Pas de réponse")}</span>}<br /><Counts r={x} /></span>
                    <QuickSignup raid={x} chars={myChars} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="wk-sub">{t("À faire")}</div>
              <ul className="wk-list">{others.map(x => <TodoItem key={x.kind === "assign" ? `assign-${x.groupId}` : `${x.kind}-${x.characterId}`} t={x} />)}</ul>
            </>
          )}
        </div>
      )}
    </section>
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
    { done: s.character, title: t("Crée ton perso"), text: t("Nom, race, classe et spé. Le reste peut attendre, ou venir de l'addon."),
      action: <button type="button" className="btn primary" onClick={onCreate}>{t("+ Créer mon perso")}</button> },
    { done: s.group, title: t("Rejoins ta guilde"), text: t("Ouvre le lien d'invitation donné par ton officier, ou crée ta propre guilde."),
      action: <Link className="btn" to="/groups">{t("Créer une guilde")}</Link> },
    { done: s.addon, title: t("Installe l'addon"), optional: true, text: t("Il remplit ta fiche depuis le jeu : équipement, métiers, talents."),
      action: <Link className="btn" to="/addon">{t("Page Addon")}</Link> },
  ];
  const current = steps.findIndex(x => !x.done);

  if (compact) {
    // Plus que l'étape facultative (l'addon) : le bandeau disparaît de lui-même
    if (hidden || current < 0 || !week.data || steps.slice(current).every(x => x.optional)) return null;
    const next = steps[current]!;
    return (
      <div className="steps-line" role="note" aria-label={t("Pour bien démarrer")}>
        {steps.map((x, i) => (
          <span key={x.title} className={`sl-step${x.done ? " done" : ""}`}>{x.done ? "✓" : <b className="num">{i + 1}</b>} {x.title}{x.optional && !x.done && <span className="muted small"> {t("(facultatif)")}</span>}</span>
        ))}
        <span className="sl-action">{small(next.action)}</span>
        <button type="button" className="sl-hide" aria-label={t("Masquer ces étapes")} title={t("Masquer")} onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_STEPS, "1"); } catch { /* masqué pour cette visite */ } }}>✕</button>
      </div>
    );
  }

  return (
    <div className="start">
      <h2>{t("Trois étapes pour commencer")}</h2>
      <p className="muted">{t("Ta fiche sert à ta guilde pour monter les raids : classe, spés, talents, métiers et objectifs BiS. Les étapes se cochent toutes seules.")}</p>
      <ol className="start-steps">
        {steps.map((x, i) => (
          <li key={x.title} className={x.done ? "done" : i === current ? "current" : ""}>
            <span className="n" aria-hidden="true">{x.done ? "✓" : i + 1}</span>
            <div><h3>{x.title}{x.optional && <span className="opt"> {t("facultatif")}</span>}</h3><p>{x.text}</p></div>
            {!x.done && x.action}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Bouton d'étape en petite taille dans la ligne compacte. */
const small = (el: ReactElement<{ className?: string }>) => cloneElement(el, { className: `${el.props.className ?? ""} sm`.trim() });
