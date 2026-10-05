import { zonedParts, zonedTime } from "@forever/game-data";
import { useEffect, useRef, useState } from "react";

/**
 * Dates et heures des raids (lot E) : toujours en français, semaine du lundi, 24 h, à l'heure de Paris (le serveur de
 * jeu), quel que soit le navigateur. Remplace les champs date/heure natifs (mm/dd/yyyy, AM/PM selon le système).
 * Classes CSS « dt- ».
 */

export interface Parts { y: number; m: number; d: number; h: number; mi: number }
const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (p: { h: number; mi: number }) => `${pad(p.h)}:${pad(p.mi)}`;
export const partsOf = (iso: string | null | undefined): Parts | null => {
  if (!iso) return null;
  const z = zonedParts(new Date(iso));
  return { y: z.year, m: z.month, d: z.day, h: z.hour, mi: z.minute };
};
export const isoOf = (p: Parts) => zonedTime(p.y, p.m, p.d, p.h, p.mi)?.toISOString() ?? null;
/** 1 = lundi … 7 = dimanche */
const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
const addDays = (y: number, m: number, d: number, n: number) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const today = () => { const z = zonedParts(new Date()); return { y: z.year, m: z.month, d: z.day }; };
const key = (x: { y: number; m: number; d: number }) => x.y * 10000 + x.m * 100 + x.d;

export const DAY_SHORT: readonly string[] = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const DAY_LONG: readonly string[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS: readonly string[] = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
/** « mercredi 7 octobre, 20:30 » (année seulement si ce n'est pas l'année en cours). */
export function longDate(p: Parts | null) {
  if (!p) return "Date à choisir";
  const y = p.y !== today().y ? ` ${p.y}` : "";
  return `${DAY_LONG[weekdayOf(p.y, p.m, p.d) - 1]!} ${p.d} ${MONTHS[p.m - 1]!}${y}, ${hhmm(p)}`;
}
export const QUARTERS = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);

/** Habitudes du groupe tirées de ses raids : jours de la semaine et heures les plus fréquents. */
export function habits(dates: (string | null)[]) {
  const days = new Map<number, number>(), times = new Map<string, number>();
  for (const iso of dates) {
    const p = partsOf(iso);
    if (!p) continue;
    const wd = weekdayOf(p.y, p.m, p.d);
    days.set(wd, (days.get(wd) ?? 0) + 1);
    times.set(hhmm(p), (times.get(hhmm(p)) ?? 0) + 1);
  }
  const top = <K,>(m: Map<K, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return { days: top(days, 3), times: top(times, 4) };
}

/** Boutons des 14 prochains jours (jours habituels soulignés) et « Autre date » (calendrier). */
export function DayStrip({ value, onChange, habitDays = [] }: { value: Parts | null; onChange: (d: { y: number; m: number; d: number }) => void; habitDays?: number[] }) {
  const t = today();
  const days = Array.from({ length: 14 }, (_, i) => addDays(t.y, t.m, t.d, i));
  const inStrip = value && days.some(d => key(d) === key(value));
  const [cal, setCal] = useState(false);
  return (
    <div className="dt-strip-wrap">
      <div className="dt-strip" role="group" aria-label="Jour du raid">
        {days.map((d, i) => {
          const wd = weekdayOf(d.y, d.m, d.d);
          const on = !!value && key(value) === key(d);
          return (
            <button key={key(d)} type="button" className={`dt-day${on ? " on" : ""}${habitDays.includes(wd) ? " hab" : ""}`} aria-pressed={on}
              aria-label={`${DAY_LONG[wd - 1]} ${d.d} ${MONTHS[d.m - 1]}`} onClick={() => onChange(d)}>
              <small>{i === 0 ? "auj." : DAY_SHORT[wd - 1]}</small>{d.d}
            </button>
          );
        })}
      </div>
      <Popover open={cal} onClose={() => setCal(false)} button={
          <button type="button" className={`dt-chip${value && !inStrip ? " on" : ""}`} aria-expanded={cal} onClick={() => setCal(o => !o)}>
            {value && !inStrip ? `${value.d} ${MONTHS[value.m - 1]!.slice(0, 4)}.` : "Autre date"}
          </button>
        }>
          <Calendar value={value} habitDays={habitDays} onPick={d => { onChange(d); setCal(false); }} />
        </Popover>
    </div>
  );
}

/** Heures fréquentes en un clic, et toutes les autres (au quart d'heure) dans un menu. */
export function TimeChips({ value, onChange, fav = [] }: { value: string | null; onChange: (t: string) => void; fav?: string[] }) {
  const chips = [...new Set([...fav, "20:30", "21:00"])].slice(0, 4).sort();
  return (
    <div className="dt-times" role="group" aria-label="Heure du raid">
      {chips.map(t => <button key={t} type="button" className={`dt-chip num${value === t ? " on" : ""}`} aria-pressed={value === t} onClick={() => onChange(t)}>{t}</button>)}
      <TimeSelect value={value && !chips.includes(value) ? value : ""} onChange={onChange} placeholder="Autre heure…" />
    </div>
  );
}

export function TimeSelect({ value, onChange, placeholder, id }: { value: string; onChange: (t: string) => void; placeholder?: string; id?: string }) {
  return (
    <select id={id} className="dt-select num" value={value} onChange={e => e.target.value && onChange(e.target.value)} aria-label={id ? undefined : "Heure"}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
    </select>
  );
}

/** Calendrier d'un mois, semaine du lundi ; jours passés grisés, jours habituels du groupe marqués. */
export function Calendar({ value, onPick, habitDays = [], allowPast = false }: {
  value: Parts | null; onPick: (d: { y: number; m: number; d: number }) => void; habitDays?: number[]; allowPast?: boolean;
}) {
  const t = today();
  const [view, setView] = useState({ y: value?.y ?? t.y, m: value?.m ?? t.m });
  const first = weekdayOf(view.y, view.m, 1);
  const len = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: ({ y: number; m: number; d: number } | null)[] = [...Array(first - 1).fill(null), ...Array.from({ length: len }, (_, i) => ({ y: view.y, m: view.m, d: i + 1 }))];
  while (cells.length % 7) cells.push(null);
  const move = (n: number) => setView(v => { const m = v.m + n; return m < 1 ? { y: v.y - 1, m: 12 } : m > 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m }; });
  return (
    <div className="dt-cal">
      <div className="dt-cal-head">
        <button type="button" aria-label="Mois précédent" onClick={() => move(-1)}>‹</button>
        <b>{MONTHS[view.m - 1]![0]!.toUpperCase() + MONTHS[view.m - 1]!.slice(1)} {view.y}</b>
        <button type="button" aria-label="Mois suivant" onClick={() => move(1)}>›</button>
      </div>
      <div className="dt-grid" role="grid">
        {["lu", "ma", "me", "je", "ve", "sa", "di"].map(d => <small key={d}>{d}</small>)}
        {cells.map((c, i) => {
          if (!c) return <span key={`x${i}`} />;
          const past = !allowPast && key(c) < key(t);
          const on = !!value && key(value) === key(c);
          return (
            <button key={key(c)} type="button" disabled={past} aria-pressed={on}
              className={`dt-d${on ? " on" : ""}${key(c) === key(t) ? " today" : ""}${habitDays.includes(weekdayOf(c.y, c.m, c.d)) ? " hab" : ""}`}
              onClick={() => onPick(c)}>{c.d}</button>
          );
        })}
      </div>
    </div>
  );
}

/** Bouton + fenêtre flottante, fermée par Échap ou un clic à côté. */
function Popover({ open, onClose, button, children }: { open: boolean; onClose: () => void; button: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", esc); };
  }, [open, onClose]);
  return <span className="dt-pop-wrap" ref={ref}>{button}{open && <div className="dt-pop" role="dialog">{children}</div>}</span>;
}

/**
 * Champ date + heure (page du raid) : affiche « mercredi 7 octobre, 20:30 » ; un clic ouvre le calendrier et les heures.
 * `onChange` reçoit l'instant (ISO) ou null (« Sans date »).
 */
export function DateTimeField({ value, onChange, id, habitDays }: { value: string | null; onChange: (iso: string | null) => void; id?: string; habitDays?: number[] }) {
  const cur = partsOf(value);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Parts | null>(cur);
  useEffect(() => { if (open) setDraft(cur); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) list.current?.querySelector(".on")?.scrollIntoView({ block: "center" }); }, [open]);
  const time = draft ? hhmm(draft) : "20:30";
  return (
    <Popover open={open} onClose={() => setOpen(false)} button={
      <button id={id} type="button" className="dt-field" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{longDate(cur)}</span><span aria-hidden="true">▾</span>
      </button>
    }>
      <div className="dt-full">
        <Calendar value={draft} habitDays={habitDays} allowPast onPick={d => setDraft(p => ({ ...d, h: p?.h ?? 20, mi: p?.mi ?? 30 }))} />
        <div className="dt-tl" ref={list} role="listbox" aria-label="Heure">
          {QUARTERS.map(q => (
            <button key={q} type="button" role="option" aria-selected={q === time} className={`dt-t num${q === time ? " on" : ""}`}
              onClick={() => setDraft(p => { const [h, mi] = q.split(":").map(Number) as [number, number]; const b = p ?? { ...today(), h, mi }; return { ...b, h, mi }; })}>{q}</button>
          ))}
        </div>
        <div className="dt-foot">
          <span>{draft ? longDate(draft) : "Choisis un jour"} <span className="muted">(heure de Paris)</span></span>
          <span className="row" style={{ gap: 6 }}>
            {value && <button type="button" className="btn ghost sm" onClick={() => { onChange(null); setOpen(false); }}>Sans date</button>}
            <button type="button" className="btn primary sm" disabled={!draft} onClick={() => { if (draft) onChange(isoOf(draft)); setOpen(false); }}>Valider</button>
          </span>
        </div>
      </div>
    </Popover>
  );
}
