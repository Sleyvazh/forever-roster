import {
  addDays, atTime, characterRoles, classColor, classRoles, dayKeyOf, dungeonByKey, dungeonOffReason, dungeonsFor, hasDungeonLevel, hhmmOf, levelsText, OUTING_NOTE_MAX, OUTING_ROLES,
  outingWhen, pickCharacterFor, type OutingPlaces, type Role,
} from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, del, get, patch, post, put } from "../api";
import { useGameText } from "../gameText";
import { QUARTERS } from "./DateTime";
import { ClassIcon, SpecIcon } from "./Icons";
import { NumberField } from "./NumberField";
import { RoleIcon } from "./RoleIcon";

/**
 * Onglet « Sorties » d'un groupe de Forever (maquette du 15/10, écran 2) : les sorties du jour et de demain, une carte
 * chacune ; inscription en un clic par rôle avec le perso qui a le niveau, complète → liste d'attente, carte grisée si
 * aucun de mes persos n'a le niveau ; « + Sortie » en une seule carte ; ma sortie se gère depuis sa carte.
 * Règles côté serveur : apps/api/src/lib/outings.ts. Classes CSS so-, sx-, dg-, pc-chip.
 */

type Guard = (fn: () => Promise<unknown>) => Promise<void>;
export interface OutingSignup {
  id: string; role: Role; name: string; cls: string; spec: string; guest: boolean; mine: boolean; creator: boolean;
  /** Vue du créateur et des officiers : nom du joueur (s'il diffère du perso) et MP possibles. */
  player?: string | null; dm?: "yes" | "dm-off" | "no-discord";
}
export interface Outing {
  id: string; dungeon: string; title: string; minLevel: number | null; maxLevel: number | null; zone: string;
  day: string; at: string | null; expiresAt: string; places: OutingPlaces; note: string;
  creator: { userId: string | null; name: string; me: boolean };
  signups: OutingSignup[]; waiting: OutingSignup[]; canManage: boolean;
}
interface MyChar { id: string; name: string; cls: string; spec1: string; spec2: string; level: number; isMain: boolean; inGroup: boolean }
export interface OutingsData {
  outings: Outing[]; canCreate: boolean; creators: "officers" | "members"; open: { mine: number; max: number };
  today: string; tomorrow: string; me: { characters: MyChar[] }; levels: number[];
}

const ROLES = OUTING_ROLES as readonly Role[];
const ROLE_WORD: Record<Role, string> = { Tank: "tank", Heal: "heal", DPS: "DPS" };
const placesOf = (p: OutingPlaces, r: Role) => (r === "Tank" ? p.tank : r === "Heal" ? p.heal : p.dps);
const total = (p: OutingPlaces) => p.tank + p.heal + p.dps;
const rangeOf = (o: { minLevel: number | null; maxLevel: number | null }) => (o.minLevel && o.maxLevel ? { min: o.minLevel, max: o.maxLevel } : null);
const dayLong = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const dayTitle = (day: string) => dayLong.format(new Date(`${day}T12:00:00Z`));
const rank = (n: number) => <>{n}<sup>{n === 1 ? "er" : "e"}</sup></>;
const errorOf = (e: unknown) => (e instanceof ApiError ? e.message : "Action impossible.");

/** Pastille de classe : icône de la spé dans un disque, ou disque de la couleur de classe et initiale (maquette). */
export function ClassDot({ cls, spec }: { cls: string; spec?: string }) {
  if (!cls) return <span className="cp" aria-hidden="true">?</span>;
  return (
    <span className={`cp${cls === "Shaman" ? " sha" : ""}`} style={{ "--cc": classColor(cls) } as CSSProperties} title={cls} aria-hidden="true">
      {spec ? <SpecIcon cls={cls} spec={spec} size={22} /> : <ClassIcon cls={cls} size={22} />}
    </span>
  );
}

/** Joueur : ce qu'il peut faire sur une sortie avec ses persos. */
function useMine(o: Outing, chars: MyChar[]) {
  return useMemo(() => {
    const range = rangeOf(o);
    const atLevel = chars.filter(c => !range || hasDungeonLevel(range, c.level));
    const entry = o.signups.find(s => s.mine) ?? o.waiting.find(s => s.mine) ?? null;
    const waiting = !!entry && o.waiting.some(s => s.id === entry.id);
    const free = (r: Role) => placesOf(o.places, r) - o.signups.filter(s => s.role === r).length;
    // Un bouton « + Brindille » par rôle libre, avec le perso qui a le niveau et tient ce rôle (main d'abord)
    const join = Object.fromEntries(ROLES.map(r => [r, !entry && free(r) > 0 ? pickCharacterFor(range, atLevel.filter(c => characterRoles(c).includes(r))) : null])) as Record<Role, MyChar | null>;
    const canJoin = ROLES.some(r => join[r]);
    // Pas de place pour mes persos (complète, ou mes rôles sont pleins) : la liste d'attente
    const waitWith = !entry && !canJoin && atLevel.length ? pickCharacterFor(range, atLevel) : null;
    return { atLevel, entry, waiting, join, canJoin, waitWith, complete: o.signups.length >= total(o.places) };
  }, [o, chars]);
}

/* ---------- Liste ---------- */

export function GroupOutings({ groupId, guard, channelName, discordLinked, creating, onCreate, onClose }: {
  groupId: string; guard: Guard; channelName: string | null; discordLinked: boolean; creating: boolean; onCreate: () => void; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({ queryKey: ["outings", groupId], queryFn: () => get<OutingsData>(`/groups/${groupId}/outings`) });
  const [filter, setFilter] = useState<"all" | "me" | "mine">("all");
  if (isLoading || !data) return <p className="muted">Chargement…</p>;
  if (creating && data.canCreate) return <div className="stack"><NewOuting groupId={groupId} data={data} channelName={channelName} discordLinked={discordLinked} onClose={onClose} /></div>;

  const chars = data.me.characters;
  const forMe = (o: Outing) => {
    const range = rangeOf(o);
    return o.signups.some(s => s.mine) || o.waiting.some(s => s.mine) || chars.some(c => !range || hasDungeonLevel(range, c.level));
  };
  const counts = { all: data.outings.length, me: data.outings.filter(forMe).length, mine: data.outings.filter(o => o.creator.me).length };
  const shown = data.outings.filter(o => (filter === "me" ? forMe(o) : filter === "mine" ? o.creator.me : true));
  const days = [...new Set(shown.map(o => (o.day < data.today ? data.today : o.day)))].sort();
  const plus = data.canCreate && <button type="button" className="btn primary" onClick={onCreate}>+ Sortie</button>;
  const bar = (withPlus: boolean) => (
    <div className="so-bar">
      <div className="seg" role="group" aria-label="Sorties affichées">
        {([["all", "Toutes"], ["me", "Pour moi"], ["mine", "Les miennes"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} ({counts[k]})</button>
        ))}
      </div>
      <span className="grow1" />
      {withPlus && plus}
    </div>
  );

  if (!data.outings.length) return (
    <div className="stack">
      {bar(false)}
      <div className="so-empty">
        <h3>Aucune sortie aujourd'hui ni demain</h3>
        {data.canCreate
          ? <><p>Propose la tienne : le donjon est trié pour ton perso, et la guilde la voit ici, sur Discord et en jeu.</p>
            <button type="button" className="btn primary" onClick={onCreate}>+ Proposer une sortie</button></>
          : <p>Dans ce groupe, les officiers proposent les sorties : elles apparaîtront ici, sur Discord et en jeu.</p>}
      </div>
    </div>
  );

  return (
    <div className="stack">
      {bar(true)}
      {!shown.length && <p className="muted" style={{ margin: 0 }}>{filter === "mine" ? "Tu n'as proposé aucune sortie." : "Aucune sortie pour tes persos aujourd'hui ni demain."}</p>}
      {days.map(day => (
        <section key={day} className="stack" style={{ gap: 8 }} aria-label={day === data.today ? "Aujourd'hui" : "Demain"}>
          <h3 className="so-day">{day === data.today ? "Aujourd'hui" : "Demain"} <small>{dayTitle(day)}</small></h3>
          <div className="so-list">
            {shown.filter(o => (o.day < data.today ? data.today : o.day) === day).map(o => (
              <OutingCard key={o.id} groupId={groupId} o={o} chars={chars} guard={guard} discordLinked={discordLinked} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Ma sortie est dépliée sur un écran large ; sur téléphone, « Gérer » la déplie. */
const wide = () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 641px)").matches;

function OutingCard({ groupId, o, chars, guard, discordLinked }: { groupId: string; o: Outing; chars: MyChar[]; guard: Guard; discordLinked: boolean }) {
  const qc = useQueryClient();
  const m = useMine(o, chars);
  const [open, setOpen] = useState(() => o.creator.me && wide());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const w = outingWhen(o.at ? new Date(o.at) : null, o.day);
  const n = o.signups.length, t = total(o.places);
  const refresh = () => qc.invalidateQueries({ queryKey: ["outings", groupId] });
  const act = (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    return fn().then(refresh, e => setErr(errorOf(e))).finally(() => setBusy(false));
  };
  const join = (role: Role, c: MyChar, wait = false) => act(() => put(`/groups/${groupId}/outings/${o.id}/signup`, { role, characterId: c.id, wait }));
  const leave = () => act(() => del(`/groups/${groupId}/outings/${o.id}/signup`));
  const kind = o.creator.me ? "mine" : m.entry ? "in" : m.canJoin ? "can" : !m.atLevel.length ? "dim" : "";
  const waitRole = m.waitWith ? characterRoles(m.waitWith)[0] ?? "DPS" : null;
  const byLine = <span className="so-with">par <b>{o.creator.me ? "toi" : o.creator.name}</b></span>;
  const sideButton = m.waiting || !!m.waitWith;

  return (
    <article className={`so-card ${kind}`} aria-label={`${o.title}, ${w.day.toLowerCase()} ${w.time ?? "dès que complet"}`}>
      <div className="so-when"><small>{w.day}</small>{w.time ? <b>{w.time}</b> : <span className="asap">Dès que complet</span>}</div>
      <div className="so-head">
        <span className="so-name">{o.title}</span>
        {o.minLevel && <span className="so-lv">{levelsText(o.minLevel, o.maxLevel)}</span>}
        {o.zone && <span className="so-zone">{o.zone}</span>}
      </div>
      <div className="so-side">
        <span className="so-count"><b>{n}</b>/{t}</span>
        {m.waiting ? <>
          <span className="so-wait">{rank(o.waiting.findIndex(s => s.mine) + 1)} en attente</span>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void leave()}>Quitter l'attente</button>
        </> : <>
          {m.complete && <span className={`tag${o.creator.me ? " ok" : ""}`}>Complète</span>}
          {m.waitWith && waitRole
            ? <button type="button" className="btn sm" disabled={busy} onClick={() => void join(waitRole, m.waitWith!, true)}>Me mettre en attente</button>
            : byLine}
        </>}
      </div>
      <div className="so-roles">
        {ROLES.filter(r => placesOf(o.places, r) > 0).map(r => {
          const list = o.signups.filter(s => s.role === r);
          const free = Math.max(0, placesOf(o.places, r) - list.length);
          const c = m.join[r];
          return (
            <span key={r} className="so-rg">
              <RoleIcon role={r} size={18} />
              <span className="so-slots">
                {list.map(s => (
                  <span key={s.id} className={`so-slot${s.mine ? " me" : ""}`}><ClassDot cls={s.cls} spec={s.spec} />{s.name}
                    {s.guest && <span className="guest" title="Inscrit depuis Discord, sans compte"> ✱</span>}</span>
                ))}
                {Array.from({ length: free }, (_, i) => (i === 0 && c
                  ? <button key={i} type="button" className="so-join" title={`T'inscrire avec ${c.name}`} disabled={busy} onClick={() => void join(r, c)}>+ {c.name}</button>
                  : <span key={i} className="so-free">libre</span>))}
              </span>
            </span>
          );
        })}
      </div>
      <div className="so-foot">
        {o.note && <span className="so-note">« {o.note} »</span>}
        {sideButton && byLine}
        {m.entry && !m.waiting && !o.creator.me && (
          <span className="so-mine">Tu viens en {ROLE_WORD[m.entry.role]} avec {m.entry.name} · <button type="button" className="link" disabled={busy} onClick={() => void leave()}>Me retirer</button></span>
        )}
        {m.waiting && m.entry && <span className="so-mine">{m.entry.name} prendra la première place libérée, un MP te préviendra.</span>}
        {kind === "dim" && !m.entry && <span className="so-why">Aucun de tes persos n'a le niveau.</span>}
        {!m.waiting && o.waiting.length > 0 && <span>{o.waiting.length} en attente</span>}
        {o.canManage && !open && <button type="button" className={`link${o.creator.me ? "" : " so-manage"}`} onClick={() => setOpen(true)}>{o.creator.me ? "Gérer ma sortie" : "Gérer"}</button>}
        {err && <span className="so-why" role="alert">{err}</span>}
      </div>
      {o.canManage && open && <Manage groupId={groupId} o={o} guard={guard} discordLinked={discordLinked} />}
    </article>
  );
}

/* ---------- Gestion (créateur, officiers) ---------- */

function Manage({ groupId, o, guard, discordLinked }: { groupId: string; o: Outing; guard: Guard; discordLinked: boolean }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<null | "time" | "places" | "cancel">(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["outings", groupId] });
  const t = total(o.places);
  const others = o.signups.filter(s => !s.mine).length;
  const remove = (s: OutingSignup) => void guard(async () => { await del(`/groups/${groupId}/outings/${o.id}/signups/${s.id}`); await refresh(); });
  if (panel === "time") return <div className="sx"><TimePanel groupId={groupId} o={o} others={others} onDone={() => setPanel(null)} guard={guard} /></div>;
  if (panel === "places") return <div className="sx"><PlacesPanel groupId={groupId} o={o} onDone={() => setPanel(null)} guard={guard} /></div>;
  if (panel === "cancel") return <div className="sx"><CancelPanel groupId={groupId} o={o} others={others} discordLinked={discordLinked} onDone={() => setPanel(null)} guard={guard} /></div>;

  const detail = (s: OutingSignup) => {
    if (s.mine) return "toi";
    const dm = s.dm === "yes" ? "MP oui" : s.dm === "dm-off" ? "MP coupés · pas de MP" : "Discord non lié · pas de MP";
    if (s.guest) return `Discord, sans compte · ${dm}`;
    return s.player ? `joueur ${s.player} · ${dm}` : dm;
  };
  const at = o.at ? new Date(o.at) : null;
  const addon = o.creator.me ? "ton addon" : `l'addon de ${o.creator.name}`;
  const gone = discordLinked ? "La sortie et son message Discord disparaissent" : "La sortie disparaît";
  return (
    <div className="sx">
      <div className="sx-h">Inscrits <span className="num">{o.signups.length}/{t}</span></div>
      <ul className="sx-list">
        {[...o.signups].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role)).map(s => (
          <li key={s.id} className={s.mine ? "me" : undefined}>
            <RoleIcon role={s.role} size={18} /><ClassDot cls={s.cls} spec={s.spec} />
            <span className="t"><b className={`cn${s.cls === "Shaman" ? " sha" : ""}`} style={{ "--cc": classColor(s.cls) ?? "var(--ink)" } as CSSProperties}>{s.name}</b><small title={detail(s)}>{detail(s)}</small></span>
            {!s.creator ? <button type="button" className="x" aria-label={`Retirer ${s.name}`} onClick={() => remove(s)}>Retirer</button> : <span />}
          </li>
        ))}
      </ul>
      {o.waiting.length > 0 && <>
        <div className="sx-h">Liste d'attente <span className="num">{o.waiting.length}</span></div>
        <ul className="sx-list wait">
          {o.waiting.map((s, i) => (
            <li key={s.id}>
              <span className="pos">{i + 1}</span><ClassDot cls={s.cls} spec={s.spec} />
              <span className="t"><b className={`cn${s.cls === "Shaman" ? " sha" : ""}`} style={{ "--cc": classColor(s.cls) ?? "var(--ink)" } as CSSProperties}>{s.name}</b>
                <small>{s.role} · prend la première place libérée, prévenu en MP</small></span>
              <button type="button" className="x" aria-label={`Retirer ${s.name}`} onClick={() => remove(s)}>Retirer</button>
            </li>
          ))}
        </ul>
      </>}
      <p className="sx-life">
        {at
          ? <>À <b>{hhmmOf(new Date(at.getTime() - 15 * 60e3))}</b>, un MP à chaque inscrit. À <b>{hhmmOf(at)}</b>, {addon} affiche « Inviter les {t - 1} ». {gone} à <b>{hhmmOf(new Date(o.expiresAt))}</b>.</>
          : <>Complète, {o.creator.me ? "un MP te prévient" : `un MP prévient ${o.creator.name}`} et {addon} affiche « Inviter les {t - 1} ». {gone} à la fin de la journée.</>}
      </p>
      <div className="sx-acts">
        <button type="button" className="btn sm" onClick={() => setPanel("time")}>Changer l'heure</button>
        <button type="button" className="btn sm" onClick={() => setPanel("places")}>Places et note</button>
        <span className="grow1" />
        <button type="button" className="btn danger sm" onClick={() => setPanel("cancel")}>Annuler la sortie</button>
      </div>
    </div>
  );
}

const ASAP = "asap";
/** Heures proposées autour de l'heure actuelle de la sortie (passées exclues aujourd'hui). */
function timeChips(day: string, today: string, around: string | null) {
  const base = around ? Number(around.slice(0, 2)) * 60 + Number(around.slice(3)) : 21 * 60;
  const now = Date.now();
  return [-30, 0, 30, 60, 90].map(d => base + d).filter(mn => mn >= 0 && mn < 24 * 60)
    .map(mn => `${String(Math.floor(mn / 60)).padStart(2, "0")}:${String(mn % 60).padStart(2, "0")}`)
    .filter(tm => day !== today || (atTime(day, tm)?.getTime() ?? 0) > now);
}

function TimePanel({ groupId, o, others, onDone, guard }: { groupId: string; o: Outing; others: number; onDone: () => void; guard: Guard }) {
  const qc = useQueryClient();
  const today = dayKeyOf(new Date());
  const days = [today, addDays(today, 1)];
  const cur = o.at ? hhmmOf(new Date(o.at)) : ASAP;
  const [day, setDay] = useState(o.day < today ? today : o.day);
  const [time, setTime] = useState(cur);
  const chips = timeChips(day, today, o.at ? cur : null);
  const label = (d: string, tm: string) => `${d === today ? "" : "demain "}${tm === ASAP ? "dès que complet" : tm}`;
  const changed = day !== o.day || time !== cur;
  const save = () => void guard(async () => {
    await put(`/groups/${groupId}/outings/${o.id}/time`, { day, at: time === ASAP ? null : atTime(day, time)!.toISOString() });
    await qc.invalidateQueries({ queryKey: ["outings", groupId] });
    onDone();
  });
  return (
    <div className="sx-panel">
      <div className="sx-h">Changer l'heure</div>
      <div className="seg day-seg" role="group" aria-label="Jour">
        {days.map((d, i) => <button key={d} type="button" className={day === d ? "on" : ""} aria-pressed={day === d} onClick={() => setDay(d)}>{i === 0 ? "Aujourd'hui" : "Demain"}</button>)}
      </div>
      <div className="gr-chips" style={{ marginTop: 0 }} role="group" aria-label="Heure">
        {[ASAP, ...chips].map(tm => <button key={tm} type="button" className={`dt-chip${time === tm ? " on" : ""}`} aria-pressed={time === tm} onClick={() => setTime(tm)}>{tm === ASAP ? "Dès que complet" : tm}</button>)}
        <select className="dt-select" aria-label="Autre heure" value={time !== ASAP && !chips.includes(time) ? time : ""} onChange={e => e.target.value && setTime(e.target.value)}>
          <option value="">Autre…</option>
          {QUARTERS.filter(q => day !== today || (atTime(day, q)?.getTime() ?? 0) > Date.now()).map(q => <option key={q} value={q}>{q}</option>)}
        </select>
      </div>
      {changed && <p className="sx-diff"><s>{label(o.day, cur)}</s> → {label(day, time)}</p>}
      <p className="small muted">{others === 0 ? "Personne d'autre n'est inscrit pour l'instant."
        : others === 1 ? "L'inscrit reste inscrit et reçoit un MP avec l'ancienne et la nouvelle heure."
        : `Les ${others} inscrits restent inscrits et reçoivent un MP avec l'ancienne et la nouvelle heure.`}</p>
      <div className="sx-acts">
        <button type="button" className="btn primary sm" disabled={!changed} onClick={save}>Valider {time === ASAP ? "« dès que complet »" : time}</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Retour</button>
      </div>
    </div>
  );
}

/** Places par rôle : le DPS se déduit, le total reste à 5 ; `keep` : rôle qui garde au moins une place. */
function PlacesFields({ places, onChange, keep }: { places: OutingPlaces; onChange: (p: OutingPlaces) => void; keep?: Role | null }) {
  const min = (r: Role) => (keep === r ? 1 : 0);
  const set = (tank: number, heal: number) => onChange({ tank, heal, dps: 5 - tank - heal });
  const dpsMin = min("DPS");
  return (
    <div className="places">
      <span className="place"><RoleIcon role="Tank" size={18} /><NumberField label="Places tank" min={min("Tank")} max={5 - places.heal - dpsMin} value={places.tank} onChange={v => set(v, places.heal)} /></span>
      <span className="place"><RoleIcon role="Heal" size={18} /><NumberField label="Places heal" min={min("Heal")} max={5 - places.tank - dpsMin} value={places.heal} onChange={v => set(places.tank, v)} /></span>
      <span className="place"><RoleIcon role="DPS" size={18} /><span className="dps num" aria-label="Places DPS">{places.dps}</span></span>
      <span className="missing">5 en tout</span>
    </div>
  );
}

function PlacesPanel({ groupId, o, onDone, guard }: { groupId: string; o: Outing; onDone: () => void; guard: Guard }) {
  const qc = useQueryClient();
  const [places, setPlaces] = useState(o.places);
  const [note, setNote] = useState(o.note);
  const creatorRole = o.signups.find(s => s.creator)?.role ?? null;
  const save = () => void guard(async () => {
    await patch(`/groups/${groupId}/outings/${o.id}`, { places, note });
    await qc.invalidateQueries({ queryKey: ["outings", groupId] });
    onDone();
  });
  return (
    <div className="sx-panel">
      <div className="sx-h">Places et note</div>
      <PlacesFields places={places} onChange={setPlaces} keep={creatorRole} />
      <div className="note-wrap">
        <input type="text" maxLength={OUTING_NOTE_MAX} aria-label="Note" placeholder="Ex. Quête de VanCleef" value={note} onChange={e => setNote(e.target.value)} />
        <span className="cnt">{note.length}/{OUTING_NOTE_MAX}</span>
      </div>
      <p className="small muted">Une place de plus va au premier en attente pour ce rôle ; un rôle ne descend pas sous ses inscrits.</p>
      <div className="sx-acts">
        <button type="button" className="btn primary sm" onClick={save}>Enregistrer</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Retour</button>
      </div>
    </div>
  );
}

function CancelPanel({ groupId, o, others, discordLinked, onDone, guard }: { groupId: string; o: Outing; others: number; discordLinked: boolean; onDone: () => void; guard: Guard }) {
  const qc = useQueryClient();
  const who = [others ? (others === 1 ? "L'inscrit" : `Les ${others} inscrits`) : null, o.waiting.length ? "la liste d'attente" : null].filter(Boolean).join(" et ");
  const plural = others > 1 || (!!others && !!o.waiting.length);
  return (
    <div className="sx-panel bad">
      <div className="sx-h">Annuler la sortie</div>
      <p>Annuler <b>{o.title}</b> {o.at ? `de ${hhmmOf(new Date(o.at))}` : "(dès que complet)"} ?{" "}
        {who ? `${who} ${plural ? "sont prévenus" : "est prévenu"} en MP${discordLinked ? ", et le message Discord est effacé" : ""}.` : discordLinked ? "Le message Discord est effacé." : ""}</p>
      <div className="sx-acts">
        <button type="button" className="btn danger sm" onClick={() => void guard(async () => { await del(`/groups/${groupId}/outings/${o.id}`); await qc.invalidateQueries({ queryKey: ["outings", groupId] }); })}>Annuler la sortie</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>Garder</button>
      </div>
    </div>
  );
}

/* ---------- « + Sortie » ---------- */

const OTHER = "other";
const CHIP_TIMES = ["19:30", "20:00", "20:30", "21:30", "22:00"];
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

function NewOuting({ groupId, data, channelName, discordLinked, onClose }: { groupId: string; data: OutingsData; channelName: string | null; discordLinked: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const gt = useGameText();
  const chars = useMemo(() => [...data.me.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || b.level - a.level), [data.me.characters]);
  const [charId, setCharId] = useState(() => pickCharacterFor(null, chars)?.id ?? null);
  const me = chars.find(c => c.id === charId) ?? null;
  const sorted = useMemo(() => dungeonsFor(me?.level ?? 60, data.levels), [me?.level, data.levels]);
  const [dungeon, setDungeon] = useState<string | null>(() => sorted.fit[0]?.dungeon.key ?? null);
  const [listOpen, setListOpen] = useState(true);
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const [title, setTitle] = useState("");
  const now = new Date();
  const [day, setDay] = useState(data.today);
  const defaultTime = (atTime(data.today, "21:00")?.getTime() ?? 0) > now.getTime() + 5 * 60e3 ? "21:00" : ASAP;
  const [time, setTime] = useState(defaultTime);
  const [places, setPlaces] = useState<OutingPlaces>({ tank: 1, heal: 1, dps: 3 });
  const [role, setRole] = useState<Role>(() => (me ? characterRoles(me)[0] ?? "DPS" : "DPS"));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Changer de perso retrie la liste ; un donjon qui n'est plus à son niveau est remplacé par le premier qui l'est
  useEffect(() => {
    if (!me) return;
    setRole(r => (characterRoles(me).includes(r) ? r : characterRoles(me)[0] ?? "DPS"));
    if (dungeon && dungeon !== OTHER && !sorted.fit.some(c => c.dungeon.key === dungeon)) { setDungeon(sorted.fit[0]?.dungeon.key ?? null); setListOpen(true); }
  }, [me, sorted]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mon rôle garde au moins une place
  useEffect(() => {
    if (placesOf(places, role) > 0) return;
    setPlaces(p => (role === "Tank" ? { tank: 1, heal: p.heal, dps: 4 - p.heal } : role === "Heal" ? { tank: p.tank, heal: 1, dps: 4 - p.tank } : { tank: Math.max(0, p.tank - 1), heal: p.heal, dps: 1 }));
  }, [role, places]);

  if (!chars.length) return (
    <section className="gr-form" aria-labelledby="so-new">
      <div className="row between"><h3 id="so-new">Nouvelle sortie</h3><button type="button" className="btn ghost sm" onClick={onClose}>Fermer</button></div>
      <p className="hint" style={{ margin: 0 }}>Ajoute d'abord un perso de WoW Forever (avec sa classe et son niveau) dans « Mes persos » : la liste des donjons est triée pour lui.</p>
    </section>
  );

  const chosen = dungeon && dungeon !== OTHER ? dungeonByKey(dungeon) : null;
  const countOf = (key: string) => [...sorted.fit, ...sorted.off].find(c => c.dungeon.key === key)?.count ?? 0;
  const who = (n: number) => (n === 0 ? <>personne n'a le niveau</> : <><b>{n}</b> {plural(n, "perso a", "persos ont")} le niveau</>);
  const match = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase());
  const fit = sorted.fit.filter(c => match(c.dungeon.name));
  const offAll = sorted.off.filter(c => match(c.dungeon.name));
  const off = q.trim() || more ? offAll : offAll.slice(0, 3);
  const isToday = day === data.today;
  const chipTimes = ["21:00", ...CHIP_TIMES].filter(tm => !isToday || (atTime(day, tm)?.getTime() ?? 0) > now.getTime());
  const chipLabel = (tm: string) => (tm === ASAP ? "Dès que complet" : tm === "21:00" ? (isToday ? "Ce soir 21:00" : "Demain 21:00") : tm);
  const whenText = time === ASAP ? `${isToday ? "aujourd'hui" : "demain"}, dès que complet` : `${isToday ? (Number(time.slice(0, 2)) >= 17 ? "ce soir" : "aujourd'hui") : "demain"} ${time}`;
  const titleOk = dungeon === OTHER ? title.trim().length >= 2 : !!chosen;
  const part = (r: Role, n: number, word: string, words: string) => (n ? `${n} ${plural(n, word, words)}${role === r ? " (toi)" : ""}` : null);
  const summary = [part("Tank", places.tank, "tank", "tanks"), part("Heal", places.heal, "heal", "heals"), part("DPS", places.dps, "DPS", "DPS")].filter(Boolean).join(", ");
  const name = dungeon === OTHER ? title.trim() || "Autre" : chosen?.name ?? "Donjon à choisir";
  const full = data.open.mine >= data.open.max;

  const pick = (key: string) => { setDungeon(key); setListOpen(false); setQ(""); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!me || !titleOk) return;
    setBusy(true); setErr(null);
    post(`/groups/${groupId}/outings`, {
      dungeon, title: dungeon === OTHER ? title.trim() : null, day, at: time === ASAP ? null : atTime(day, time)?.toISOString() ?? null,
      note: note.trim(), places, characterId: me.id, role,
    }).then(async () => { await qc.invalidateQueries({ queryKey: ["outings", groupId] }); onClose(); }, ex => setErr(errorOf(ex))).finally(() => setBusy(false));
  };

  return (
    <form className="gr-form" aria-labelledby="so-new" onSubmit={submit}>
      <div className="row between"><h3 id="so-new">Nouvelle sortie</h3><button type="button" className="btn ghost sm" onClick={onClose}>Fermer</button></div>
      <div className="gr-line"><span className="lbl">Perso</span>
        <div className="pc-chips" role="group" aria-label="Mon perso">
          {chars.map(c => (
            <button key={c.id} type="button" className="pc-chip" aria-pressed={c.id === charId} onClick={() => setCharId(c.id)}>
              <ClassDot cls={c.cls} spec={c.spec1} /><b>{c.name}</b><small>{c.level}{c.isMain ? " ★" : ""}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="gr-line"><span className="lbl">Donjon</span>
        <div>
          {!listOpen && dungeon ? (
            <>
              <div className="dg-chosen">
                {chosen
                  ? <span className="t"><b>{chosen.name} <span className="lvn">{chosen.min}-{chosen.max}</span></b><small>{chosen.zone} · {countOf(chosen.key)} {plural(countOf(chosen.key), "perso", "persos")} de la guilde {plural(countOf(chosen.key), "a", "ont")} le niveau</small></span>
                  : <span className="t"><b>Autre</b><small>quête de groupe, élite… avec un titre libre</small></span>}
                <button type="button" className="btn ghost sm" onClick={() => setListOpen(true)}>Changer</button>
              </div>
              {dungeon === OTHER && <input className="dg-title" type="text" maxLength={40} required aria-label="Titre de la sortie" placeholder="Ex. Élite de la Vallée" value={title} onChange={e => setTitle(e.target.value)} autoFocus />}
            </>
          ) : (
            <>
              <div className="dg-search"><input type="search" placeholder="Chercher un donjon…" aria-label="Chercher un donjon" value={q} onChange={e => setQ(e.target.value)} /></div>
              <ul className="dg-list" role="listbox" aria-label="Donjons">
                {fit.length > 0 && <li className="dg-sub" role="presentation"><span>À ton niveau · {me?.name} {me?.level}</span><span>trié pour ce perso</span></li>}
                {fit.map(c => (
                  <li key={c.dungeon.key} role="presentation">
                    <button type="button" className="dg" role="option" aria-selected={dungeon === c.dungeon.key} onClick={() => pick(c.dungeon.key)}>
                      <span className="n">{c.dungeon.name}<span className="lv">{c.dungeon.min}-{c.dungeon.max}</span></span>
                      <span className="z">{c.dungeon.zone}</span>
                      <span className="who">{who(c.count)}</span>
                    </button>
                  </li>
                ))}
                {off.length > 0 && <li className="dg-sub" role="presentation"><span>Pas à ton niveau</span></li>}
                {off.map(c => (
                  <li key={c.dungeon.key} role="presentation">
                    <button type="button" className="dg off" role="option" aria-selected={false} aria-disabled="true" tabIndex={-1}>
                      <span className="n">{c.dungeon.name}<span className="lv">{c.dungeon.min}-{c.dungeon.max}</span></span>
                      <span className="z">{c.dungeon.zone} · <span className="why">{dungeonOffReason(c, me?.name ?? "")}</span></span>
                      <span className="who">{who(c.count)}</span>
                    </button>
                  </li>
                ))}
                {!q.trim() && !more && offAll.length > off.length && (
                  <li role="presentation"><button type="button" className="dg-more" onClick={() => setMore(true)}>Voir les {offAll.length - off.length} autres donjons</button></li>
                )}
                {!fit.length && !off.length && <li className="dg-sub" role="presentation"><span>Aucun donjon ne s'appelle ainsi</span></li>}
                <li role="presentation">
                  <button type="button" className="dg other" role="option" aria-selected={dungeon === OTHER} onClick={() => pick(OTHER)}>
                    <span className="n">Autre (quête de groupe, élite…)</span><span className="z">avec un titre libre</span>
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="gr-line"><span className="lbl">Quand</span>
        <div>
          <div className="seg day-seg" role="group" aria-label="Jour">
            {[data.today, data.tomorrow].map((d, i) => (
              <button key={d} type="button" className={day === d ? "on" : ""} aria-pressed={day === d} onClick={() => { setDay(d); if (d === data.today && time !== ASAP && (atTime(d, time)?.getTime() ?? 0) <= Date.now()) setTime(ASAP); }}>{i === 0 ? "Aujourd'hui" : "Demain"}</button>
            ))}
          </div>
          <div className="gr-chips" role="group" aria-label="Heure">
            {[ASAP, ...chipTimes].map(tm => <button key={tm} type="button" className={`dt-chip${time === tm ? " on" : ""}`} aria-pressed={time === tm} onClick={() => setTime(tm)}>{chipLabel(tm)}</button>)}
            <select className="dt-select" aria-label="Autre heure" value={time !== ASAP && !chipTimes.includes(time) ? time : ""} onChange={e => e.target.value && setTime(e.target.value)}>
              <option value="">Autre…</option>
              {QUARTERS.filter(tm => !isToday || (atTime(day, tm)?.getTime() ?? 0) > now.getTime()).map(tm => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="gr-line"><span className="lbl">Places</span>
        <div>
          <PlacesFields places={places} onChange={setPlaces} keep={role} />
          <div className="myrole">Toi :
            <div className="seg" role="group" aria-label="Mon rôle">
              {ROLES.map(r => <button key={r} type="button" className={role === r ? "on" : ""} aria-pressed={role === r} disabled={!me || !classRoles(me.cls).includes(r)} onClick={() => setRole(r)}>{r}</button>)}
            </div>
            {me && <span className="muted small">{me.spec1 ? `d'après sa spé, ${gt.spec(me.cls, me.spec1)}` : "d'après sa classe"}</span>}
          </div>
        </div>
      </div>
      <div className="gr-line"><label className="lbl" htmlFor="so-note">Note</label>
        <div className="note-wrap">
          <input id="so-note" type="text" maxLength={OUTING_NOTE_MAX} placeholder="Ex. Quête de VanCleef" value={note} onChange={e => setNote(e.target.value)} />
          <span className="cnt">{note.length}/{OUTING_NOTE_MAX}</span>
        </div>
      </div>
      <div className="gr-sum">
        <p><b>{name}</b> · {whenText} · {summary}</p>
        <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || !titleOk || full}>Publier</button></div>
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      <p className="hint" style={{ margin: 0 }}>
        {discordLinked ? <>Publiée ici, dans <b>{channelName ? `#${channelName}` : "le salon du groupe"}</b> sur Discord, et en jeu à la prochaine synchro.</> : "Publiée ici, et en jeu à la prochaine synchro."}
        {full && <><br /><b>Tu as déjà {data.open.max} sorties ouvertes :</b> attends qu'une soit passée, ou annules-en une.</>}
      </p>
    </form>
  );
}
