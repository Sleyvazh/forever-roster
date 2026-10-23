import { classColor, MAX_LEVEL, RACE_MILESTONES, type RaceChar, type RaceDate, type RacePodiumPlace, type RaceRow } from "@forever/game-data";
import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { useGameText } from "../gameText";
import { daysUntil, dayMonth, dayTimeShort, hourMin, longDayTime, milestoneText, placeSuffix, raceDateText, useGuildRace } from "../guild";
import { ClassDot } from "./Outings";

/**
 * Course au 60 (Forever, lot « Guilde », maquette du 15/10, écran 3) : podium « Premiers 60 », premiers par classe et
 * classement, une ligne par joueur (son perso le plus avancé, ses alts à déplier) ou par perso (« Tous les persos »).
 * Dates exactes avec l'addon du joueur ; sans lui, jour du relevé de la liste de guilde (« vers le », en italique).
 */

/** Nom d'un perso dans la couleur de sa classe (assombrie sur le thème clair). */
export function CharName({ name, cls, as: Tag = "b", className }: { name: string; cls: string | null | undefined; as?: "b" | "span"; className?: string }) {
  return <Tag className={`cn${cls === "Shaman" ? " sha" : ""}${className ? ` ${className}` : ""}`} style={cls ? { "--cc": classColor(cls) } as CSSProperties : undefined}>{name}</Tag>;
}
/** « 7e », « 1re » avec l'exposant. */
export const Place = ({ n }: { n: number }) => <>{n}<sup>{placeSuffix(n)}</sup></>;

const ms = (d?: RaceDate | null) => (d?.at ? Date.parse(d.at) : Number.POSITIVE_INFINITY);
/** Même ordre que le serveur : niveau ; au 60, le premier arrivé ; sinon le % d'XP, puis le premier arrivé à ce niveau. */
function raceCmp(a: RaceChar, b: RaceChar) {
  if (a.level !== b.level) return b.level - a.level;
  if (a.level >= MAX_LEVEL) return ms(a.milestones[60] ?? a.last) - ms(b.milestones[60] ?? b.last);
  return (b.xpPct ?? -1) - (a.xpPct ?? -1) || ms(a.last) - ms(b.last);
}
/** Rangs « 1, 2, 2, 4 » d'une liste triée à nouveau (filtre « Mains »). */
function reRank<T>(list: T[], charOf: (x: T) => RaceChar) {
  const sorted = [...list].sort((a, b) => raceCmp(charOf(a), charOf(b)) || charOf(a).name.localeCompare(charOf(b).name));
  const out: { x: T; rank: number; tie: boolean }[] = [];
  sorted.forEach((x, i) => {
    const prev = out[i - 1];
    const same = !!prev && raceCmp(charOf(prev.x), charOf(x)) === 0;
    if (same) prev.tie = true;
    out.push({ x, rank: same ? prev.rank : i + 1, tie: same });
  });
  return out;
}

/** Niveau et barre d'XP (sans l'addon : barre en pointillés, pas de %). */
function Level({ c }: { c: RaceChar }) {
  const done = c.level >= MAX_LEVEL;
  return (
    <span className="rk-lvl" role="cell">
      <b>{c.level}</b>
      <span className="barwrap">
        {done ? <span className="xp done"><i style={{ width: "100%" }} /></span>
          : c.xpPct === null ? <span className="xp none" title="Sans l'addon : pas de pourcentage d'XP"><i style={{ width: 0 }} /></span>
          : <span className="xp" role="img" aria-label={`${c.xpPct} % du niveau`}><i style={{ width: `${c.xpPct}%` }} /></span>}
        <span className="pct">{done ? "✓" : c.xpPct === null ? "—" : `${c.xpPct} %`}</span>
      </span>
    </span>
  );
}

/** Ligne du classement : un joueur (son perso le plus avancé) ou un perso. */
function RankRow({ rank, tie, c, me, sub, alts, open, onToggle, className = "" }: {
  rank: number | null; tie?: boolean; c: RaceChar; me: boolean; sub: string; alts?: number; open?: boolean; onToggle?: () => void; className?: string;
}) {
  const gt = useGameText();
  const last = raceDateText(c.last);
  const marks = RACE_MILESTONES.map(lv => ({ lv, ...milestoneText(c.milestones[lv]) }));
  return (
    <div className={`rk-r${me ? " me" : ""}${className ? ` ${className}` : ""}`} role="row">
      <span className={`rk-n${rank !== null && rank <= 3 ? " top" : ""}`} role="cell" title={tie ? "Ex æquo" : undefined}>{rank ?? ""}{tie ? <span className="sr-only"> ex æquo</span> : null}</span>
      <span className="rk-who" role="cell">
        <ClassDot cls={c.cls} size={className === "alt" ? undefined : "md"} />
        <span className="t">
          <span className="nm"><CharName name={c.name} cls={c.cls} />
            {!!alts && onToggle && <button type="button" className="rk-alts" aria-expanded={open} onClick={onToggle}>{open ? "−" : "+"} {alts} alt{alts > 1 ? "s" : ""}</button>}
          </span>
          <small>{[c.cls ? gt.cls(c.cls) : null, c.race, sub].filter(Boolean).join(" · ")}{c.left ? " · parti" : ""}</small>
        </span>
      </span>
      <Level c={c} />
      <span className={`rk-wk${c.weekGain ? "" : " zero"}`} role="cell">+{c.weekGain}</span>
      <span className={`rk-last${last.est ? " est" : ""}`} role="cell">{last.text}</span>
      {marks.map(m => <span key={m.lv} className={`rk-ms${m.none ? " none" : m.est ? " est" : ""}`} role="cell">{m.text}</span>)}
      <span className="rk-meta">
        <b>+{c.weekGain}</b> niveau{c.weekGain > 1 ? "x" : ""} cette semaine · dernière : <span className={last.est ? "ital" : ""}>{last.text}</span>
        {marks.some(m => !m.none) && <><br />{marks.filter(m => !m.none).map((m, i) => <Fragment key={m.lv}>{i > 0 && " · "}<span className="ms">{m.lv} {m.text}</span></Fragment>)}</>}
      </span>
    </div>
  );
}

const PAGE = 25;
type Filter = "all" | "class" | "mains";

/** Podium « Premiers 60 » (grand sur la page de la course, mini sur l'accueil). */
export function Podium({ places, mini }: { places: RacePodiumPlace[]; mini?: boolean }) {
  // Deuxième à gauche, premier au centre, troisième à droite (les ex æquo gardent leur place écrite sur la marche)
  const steps = [places[1] ?? null, places[0] ?? null, places[2] ?? null];
  return (
    <div className={`pod${mini ? " mini" : ""}`} role="list" aria-label={mini ? "Les trois premiers" : "Premiers 60"}>
      {steps.map((p, i) => {
        const pos = ([2, 1, 3] as const)[i]!;
        if (!p) return (
          <div key={pos} className={`pod-step p${pos}`} role="listitem">
            <span className="pod-lv">—</span>{!mini && <span className="pod-when">à prendre</span>}
            <span className="pod-base" aria-hidden="true">{pos}</span>
          </div>
        );
        const done = !p.racing;
        return (
          <div key={pos} className={`pod-step p${pos}`} role="listitem" aria-label={`${p.place}${placeSuffix(p.place)} : ${p.char.name}`}>
            <ClassDot cls={p.char.cls} size={mini ? "md" : "lg"} />
            <CharName name={p.char.name} cls={p.char.cls} as="span" />
            <span className={`pod-lv${done ? " done" : ""}`}>{done ? `${MAX_LEVEL} ✓` : p.char.xpPct !== null ? `${p.char.level} · ${p.char.xpPct} %` : p.char.level}</span>
            {!mini && <span className="pod-when">{p.racing ? "encore en course" : <>
              {p.reached?.at ? (p.reached.exact ? `${dayMonth(p.reached.at)} à ${hourMin(p.reached.at)}` : <i>vers le {dayMonth(p.reached.at)}</i>) : "date inconnue"}
              {p.days !== null && <><br />en {p.days} jour{p.days > 1 ? "s" : ""}</>}{p.char.left && <><br />parti de la guilde</>}
            </>}</span>}
            <span className="pod-base" aria-hidden="true">{p.place}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Carte d'attente avant la sortie (et sur l'accueil, en court). */
export function RaceNotStarted({ startsAt }: { startsAt: string }) {
  const d = daysUntil(startsAt);
  return (
    <div className="so-empty">
      <h3>{d > 1 ? `La course part dans ${d} jours` : d === 1 ? "La course part demain" : "La course part cette nuit"}</h3>
      <p>Départ à la sortie, <b>{longDayTime(startsAt)}</b>. Rien à faire : les niveaux viennent de la liste de guilde, relevée par l'addon de n'importe quel membre.</p>
      <p className="small muted">Avec l'addon, en plus : % d'XP et l'heure exacte de chaque niveau.</p>
    </div>
  );
}

/** Membres › Course au 60. `nav` : la barre des sous-vues (avec un texte à droite), `empty` : carte « pas encore liée ». */
export function GuildRace({ groupId, nav, empty }: { groupId: string; nav: (right?: ReactNode) => ReactNode; empty: ReactNode }) {
  const gt = useGameText();
  const q = useGuildRace(groupId);
  const [filter, setFilter] = useState<Filter>("all");
  const [flat, setFlat] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const r = q.data;
  if (!r) return <div className="stack">{nav()}<p className="muted">{q.error ? "Course indisponible pour l'instant." : "Chargement…"}</p></div>;
  if (!r.linked) return <div className="stack">{nav()}{empty}</div>;
  if (!r.started) return <div className="stack">{nav()}<RaceNotStarted startsAt={r.startsAt} /></div>;

  const start = <span className="muted small">Départ {dayTimeShort(r.startsAt)}{r.day && <> · <b className="c60-day">jour {r.day}</b></>}</span>;
  const myRow = r.rows.find(x => x.me);
  const myClass = myRow?.best.cls ?? null;
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Une ligne par joueur : son perso le plus avancé (ou son main, filtre « Mains »)
  type P = { row: RaceRow; line: RaceChar; others: RaceChar[]; rank: number; tie: boolean };
  let players: P[] = r.rows.map(row => ({ row, line: row.best, others: row.alts, rank: row.rank, tie: row.tie }));
  if (filter === "mains") {
    players = reRank(r.rows.map(row => {
      const chars = [row.best, ...row.alts];
      const main = chars.find(c => c.isMain) ?? row.best;
      return { row, line: main, others: chars.filter(c => c !== main) };
    }), x => x.line).map(({ x, rank, tie }) => ({ ...x, rank, tie }));
  } else if (filter === "class") players = players.filter(p => p.line.cls === myClass);
  // Une ligne par perso
  let chars = r.chars.map(c => ({ ...c }));
  if (filter === "mains") chars = reRank(r.chars.filter(c => c.char.isMain), c => c.char).map(({ x, rank, tie }) => ({ ...x, rank, tie, mainName: null }));
  else if (filter === "class") chars = chars.filter(c => c.char.cls === myClass);

  const total = flat ? chars.length : players.length;
  const count = flat
    ? `${total} perso${total > 1 ? "s" : ""}${filter === "mains" ? " · les mains" : " · mains et alts mélangés"}`
    : `${total} joueur${total > 1 ? "s" : ""} · une ligne chacun, avec ${filter === "mains" ? "son main" : "son perso le plus avancé"}`;
  const noAddon = (flat ? chars.map(c => c.char) : players.map(p => p.line)).some(c => !c.addon);
  const cut = all ? Number.POSITIVE_INFINITY : PAGE;
  const mineHidden = (list: { me: boolean }[]) => !all && list.findIndex(x => x.me) >= PAGE;

  const head = (
    <div className="rk-h" role="row">
      <span className="c" role="columnheader">#</span><span role="columnheader">{flat ? "Perso" : "Joueur"}</span><span role="columnheader">Niveau</span>
      <span className="c" role="columnheader" title="Niveaux pris sur les 7 derniers jours">Semaine</span><span role="columnheader">Dernière montée</span>
      {RACE_MILESTONES.map(lv => <span key={lv} className="c" role="columnheader">{lv}</span>)}
    </div>
  );
  const playerRows = (list: P[]) => list.map(p => {
    const key = p.row.player;
    const mainName = [p.line, ...p.others].find(c => c.isMain)?.name ?? p.line.name;
    return (
      <Fragment key={key}>
        <RankRow rank={p.rank} tie={p.tie} c={p.line} me={p.row.me} sub={[p.row.me ? "toi" : null, !p.line.addon ? "sans addon" : null].filter(Boolean).join(" · ")}
          alts={p.others.length} open={open.has(key)} onToggle={() => toggle(key)} />
        {open.has(key) && p.others.map(c => <RankRow key={c.guid} rank={null} c={c} me={false} className="alt" sub={c.isMain ? "main" : `alt de ${mainName}`} />)}
      </Fragment>
    );
  });

  return (
    <div className="stack">
      {nav(start)}
      <div className="c60-top">
        <section className="hm-card" aria-labelledby="pod-t">
          <div className="hm-h"><h3 id="pod-t">Premiers 60</h3><span className="muted small">{r.podium.frozen ? "figé" : `${Math.min(3, r.podium.sixties)} sur 3`}</span></div>
          <Podium places={r.podium.places} />
          <p className="pod-cap">{r.podium.frozen ? "Figé au troisième 60 : il reste en place après la course." : "Le podium se fige au troisième 60, puis reste en place après la course."}</p>
        </section>
        <section className="hm-card" aria-labelledby="pcls-t">
          <div className="hm-h"><h3 id="pcls-t">Premiers par classe</h3></div>
          {r.firstByClass.length ? (
            <ul className="pcls">{r.firstByClass.map(f => (
              <li key={f.cls} className={f.me ? "me" : undefined}><ClassDot cls={f.cls} />
                <span className="t"><CharName name={f.char.name} cls={f.cls} as="span" /><small>{gt.cls(f.cls)}</small></span>
                <span className="num">{f.char.level >= MAX_LEVEL ? `${MAX_LEVEL} ✓` : f.char.level}</span></li>
            ))}</ul>
          ) : <p className="hm-none">Personne pour l'instant.</p>}
        </section>
      </div>
      <div className="rk-tools">
        <div className="seg" role="group" aria-label="Filtre du classement">
          {([["all", "Tous"], ["class", "Ma classe"], ["mains", "Mains"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} disabled={k === "class" && !myClass}
              title={k === "class" && !myClass ? "Aucun de tes persos n'est dans la course" : undefined} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <span className="rk-count muted small">{count}</span>
        <button type="button" className="btn ghost sm" aria-pressed={flat} onClick={() => setFlat(f => !f)}>{flat ? "Une ligne par joueur" : "Tous les persos"}</button>
      </div>
      {total === 0 ? <p className="muted" style={{ margin: 0 }}>{filter === "class" ? "Personne d'autre de ta classe pour l'instant." : "Personne dans la course pour l'instant : les niveaux arrivent avec la liste de guilde."}</p> : (
        <div className="rk" role="table" aria-label={flat ? "Classement, une ligne par perso" : "Classement, une ligne par joueur"}>
          {head}
          {flat ? <>
            {chars.slice(0, cut).map(c => <RankRow key={c.char.guid} rank={c.rank} tie={c.tie} c={c.char} me={c.me} sub={[c.mainName ? `alt de ${c.mainName}` : null, c.me ? "toi" : null, !c.char.addon ? "sans addon" : null].filter(Boolean).join(" · ")} />)}
            {mineHidden(chars) && chars.filter(c => c.me).slice(0, 1).map(c => <RankRow key={c.char.guid} rank={c.rank} tie={c.tie} c={c.char} me sub="toi" />)}
          </> : <>
            {playerRows(players.slice(0, cut))}
            {mineHidden(players.map(p => ({ me: p.row.me }))) && playerRows(players.filter(p => p.row.me))}
          </>}
          {total > PAGE && !all && <button type="button" className="rk-more" onClick={() => setAll(true)}>Voir les {total - PAGE} suivants</button>}
        </div>
      )}
      {noAddon && <p className="rk-legend"><i>En italique</i> : sans l'addon, d'après la liste de guilde. « ≈ 8/11 » se lit « vers le 8/11 » : c'est le jour du relevé. Pas de % d'XP.</p>}
    </div>
  );
}
