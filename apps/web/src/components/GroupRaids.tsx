import { DEFAULT_TARGETS, DIFFICULTY_LABEL, LOOT_MODE_LABEL, LOOT_MODES, RAID_SIZES, retailDefaultSize, SIGNUP_LABEL, WEEKDAYS, type LootMode, type RaidSize, type RetailDifficulty, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { del, get, patch, post } from "../api";
import { DAY_SHORT, DayStrip, habits, hhmm, isoOf, longDate, partsOf, TimeChips, TimeSelect, type Parts } from "./DateTime";
import { LootModePicker } from "./Loot";
import { NumberField } from "./NumberField";
import { RoleTag } from "./RoleIcon";
import { RetailFormat, RetailRaidChips } from "./RetailFormat";
import { useSite } from "../site";
import { useGameText } from "../gameText";

/**
 * Onglet Raids d'un groupe (lot E) : la liste d'abord (À venir / Passés), « + Nouveau raid » ouvre un formulaire
 * compact (la case « Chaque semaine » en fait un raid récurrent), et les raids récurrents se déplient à part.
 * Classes CSS « gr- ».
 */

export interface RaidSummary {
  id: string; name: string; scheduledAt: string | null; filled: number; size: number; difficulty?: RetailDifficulty | null; recurring: boolean; lootMode: LootMode;
  signups: Partial<Record<SignupStatus, number>>; mySignup: SignupStatus | null; roles: { Tank: number; Heal: number; DPS: number };
}
interface RaidTemplate { id: string; name: string; description: string; weekday: number; time: string; leadDays: number; active: boolean; lootMode: LootMode; srHidden: boolean; size: number; difficulty?: RetailDifficulty | null }
type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** Un raid est « passé » 6 h après son heure. */
const PAST_AFTER_MS = 6 * 3600e3;
const MONTH_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function GroupRaids({ groupId, canEdit, guard }: { groupId: string; canEdit: boolean; guard: Guard }) {
  const { data } = useQuery({ queryKey: ["raids", groupId], queryFn: () => get<{ raids: RaidSummary[] }>(`/groups/${groupId}/raids`) });
  const tpl = useQuery({ queryKey: ["raid-templates", groupId], queryFn: () => get<{ templates: RaidTemplate[] }>(`/groups/${groupId}/raid-templates`) });
  const [when, setWhen] = useState<"next" | "past">("next");
  const [form, setForm] = useState(false);
  const [showRec, setShowRec] = useState(false);
  const raids = data?.raids ?? [];
  const now = Date.now();
  const isPast = (r: RaidSummary) => !!r.scheduledAt && new Date(r.scheduledAt).getTime() < now - PAST_AFTER_MS;
  const next = raids.filter(r => !isPast(r)).sort((a, b) => (a.scheduledAt ?? "9").localeCompare(b.scheduledAt ?? "9"));
  const past = raids.filter(isPast).sort((a, b) => b.scheduledAt!.localeCompare(a.scheduledAt!));
  const list = when === "next" ? next : past;
  const templates = tpl.data?.templates ?? [];

  return (
    <div className="stack">
      <div className="gr-bar">
        <div className="seg" role="group" aria-label="Raids affichés">
          <button type="button" className={when === "next" ? "on" : ""} aria-pressed={when === "next"} onClick={() => setWhen("next")}>À venir ({next.length})</button>
          <button type="button" className={when === "past" ? "on" : ""} aria-pressed={when === "past"} onClick={() => setWhen("past")}>Passés ({past.length})</button>
        </div>
        <span style={{ flex: 1 }} />
        {(canEdit || templates.length > 0) && (
          <button type="button" className="btn ghost sm" aria-expanded={showRec} onClick={() => setShowRec(s => !s)}>↻ Récurrents ({templates.length})</button>
        )}
        {canEdit && !form && <button type="button" className="btn primary" onClick={() => setForm(true)}>+ Nouveau raid</button>}
      </div>
      {form && <NewRaid groupId={groupId} raids={raids} guard={guard} onClose={() => setForm(false)} />}
      {showRec && <RecurringList groupId={groupId} templates={templates} canEdit={canEdit} guard={guard} />}
      {list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{when === "next" ? (canEdit ? "Aucun raid prévu. Crée le premier avec « + Nouveau raid »." : "Aucun raid prévu.") : "Aucun raid passé."}</p>
      ) : (
        <div className="gr-list">{list.map(r => <RaidCard key={r.id} groupId={groupId} r={r} past={when === "past"} />)}</div>
      )}
    </div>
  );
}

function RaidCard({ groupId, r, past }: { groupId: string; r: RaidSummary; past: boolean }) {
  const t = useGameText();
  const p = partsOf(r.scheduledAt);
  const wd = p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() || 7 : 0;
  const coming = (r.signups.present ?? 0) + (r.signups.late ?? 0);
  const url = `/groups/${groupId}/raids/${r.id}`;
  return (
    <Link to={url} className={`gr-raid${past ? " past" : ""}`}>
      <span className="gr-date">
        {p ? <><small>{DAY_SHORT[wd - 1]}</small><b>{p.d}</b><span>{MONTH_SHORT[p.m - 1]}</span><span className="gr-time">{hhmm(p)}</span></> : <><small>date</small><b>?</b><span>à définir</span></>}
      </span>
      <span className="gr-main">
        <b className="gr-name">{r.name}</b>
        <span className="gr-tags">
          <span className="tag">{r.difficulty ? `${DIFFICULTY_LABEL[r.difficulty][t.lang]} · ${r.size}` : r.size}</span>
          {r.lootMode !== "journal" && !r.difficulty && <span className="tag gold">{LOOT_MODE_LABEL[r.lootMode]}</span>}
          {r.recurring && <span className="tag" title="Créé par un raid récurrent">↻ chaque semaine</span>}
        </span>
        <span className="gr-roles">
          <RoleTag role="Tank" text={`${r.roles.Tank} tank${r.roles.Tank > 1 ? "s" : ""}`}>{r.roles.Tank}</RoleTag>
          <RoleTag role="Heal" text={`${r.roles.Heal} heal${r.roles.Heal > 1 ? "s" : ""}`}>{r.roles.Heal}</RoleTag>
          <RoleTag role="DPS" text={`${r.roles.DPS} DPS`}>{r.roles.DPS}</RoleTag>
          <span className="muted small">{coming} viennent{r.signups.tentative ? ` · ${r.signups.tentative} peut-être` : ""}</span>
        </span>
      </span>
      <span className="gr-end">
        {r.mySignup ? <span className={`tag su-tag ${r.mySignup}`}>{SIGNUP_LABEL[r.mySignup]}</span> : !past && <span className="tag warn">À répondre</span>}
        <span className="num gr-places" title="Places de la compo">{r.filled}/{r.size}</span>
      </span>
    </Link>
  );
}

/** Formulaire compact : quoi, quel jour, quelle heure, combien, quel butin ; « Chaque semaine » en option. */
function NewRaid({ groupId, raids, guard, onClose }: { groupId: string; raids: RaidSummary[]; guard: Guard; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const recent = useMemo(() => [...new Set([...raids].sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? "")).map(r => r.name))].slice(0, 5), [raids]);
  const h = useMemo(() => habits(raids.map(r => r.scheduledAt)), [raids]);
  const [name, setName] = useState("");
  const [day, setDay] = useState<{ y: number; m: number; d: number } | null>(null);
  const [time, setTime] = useState<string>(h.times[0] ?? "20:30");
  const [size, setSize] = useState<RaidSize>(40);
  // Roster (WoW Retail) : difficulté et effectif au lieu de 10 / 20 / 40
  const retail = useSite().game === "retail";
  const gt = useGameText();
  const [rf, setRf] = useState<{ difficulty: RetailDifficulty; size: number }>({ difficulty: "normal", size: retailDefaultSize("normal") });
  const [loot, setLoot] = useState<{ mode: LootMode; hidden: boolean }>({ mode: "journal", hidden: false });
  const [weekly, setWeekly] = useState(false);
  const [lead, setLead] = useState(7);
  const [desc, setDesc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parts: Parts | null = day ? { ...day, ...(() => { const [hh, mi] = time.split(":").map(Number) as [number, number]; return { h: hh, mi }; })() } : null;
  const t = DEFAULT_TARGETS[size];
  const nPlayers = retail ? rf.size : size;
  const wd = day ? new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay() || 7 : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    void guard(async () => {
      const r = await post<{ raid: { id: string } }>(`/groups/${groupId}/raids`, {
        name, scheduledAt: parts ? isoOf(parts) : null, ...(retail ? rf : { size }), lootMode: loot.mode, srHidden: loot.hidden,
        ...(desc?.trim() && { description: desc.trim() }), ...(weekly && { weekly: { leadDays: lead } }),
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ["raids", groupId] }), qc.invalidateQueries({ queryKey: ["raid-templates", groupId] })]);
      nav(`/groups/${groupId}/raids/${r.raid.id}`);
    }).finally(() => setBusy(false));
  };

  return (
    <form className="gr-form" onSubmit={submit} aria-labelledby="gr-new">
      <div className="row between"><h3 id="gr-new">Nouveau raid</h3><button type="button" className="btn ghost sm" onClick={onClose}>Fermer</button></div>
      <div className="gr-line"><label className="lbl" htmlFor="gr-name">Nom</label>
        <div>
          <input id="gr-name" type="text" required minLength={2} maxLength={60} placeholder={retail ? "Flèche du Vide" : "Molten Core"} autoFocus value={name} onChange={e => setName(e.target.value)} />
          {retail && <RetailRaidChips value={name} onPick={n => { setName(n); setRf(f => ({ ...f, size: retailDefaultSize(f.difficulty, n) })); }} />}
          {recent.length > 0 && <div className="gr-chips"><span className="muted small">Récents :</span>
            {recent.map(n => <button key={n} type="button" className={`dt-chip${name === n ? " on" : ""}`} onClick={() => setName(n)}>{n}</button>)}</div>}
        </div>
      </div>
      <div className="gr-line"><span className="lbl">Jour</span>
        <div><DayStrip value={parts} onChange={setDay} habitDays={h.days} />
          {h.days.length > 0 && <p className="hint gr-hint">Soulignés : les jours où le groupe raide d'habitude.</p>}</div>
      </div>
      <div className="gr-line"><span className="lbl">Heure</span><TimeChips value={time} onChange={setTime} fav={h.times} /></div>
      <div className="gr-line"><span className="lbl">{retail ? "Difficulté" : "Format"}</span>
        {retail ? <RetailFormat name={name} difficulty={rf.difficulty} size={rf.size} idPrefix="gr" onChange={setRf} /> : (
        <div className="row" style={{ gap: 14 }}>
          <div className="seg" role="group" aria-label="Format du raid">{RAID_SIZES.map(n => <button key={n} type="button" className={size === n ? "on" : ""} aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>)}</div>
          <span className="muted small">{t.tank} tanks · {t.heal} heals · {t.dps} DPS visés</span>
        </div>)}
      </div>
      {!retail && <div className="gr-line"><span className="lbl">Butin</span><LootModePicker mode={loot.mode} hidden={loot.hidden} idPrefix="gr" onChange={(mode, hidden) => setLoot({ mode, hidden })} /></div>}
      <div className="gr-line"><span className="lbl">Récurrent</span>
        <div className="row" style={{ gap: 12 }}>
          <label className="gr-tog"><input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} /><i aria-hidden="true" />
            Chaque semaine{day ? `, le ${WEEKDAYS[wd - 1]!.toLowerCase()}` : ""}</label>
          {weekly && <span className="row" style={{ gap: 8 }}><span className="muted small">créé</span>
            <span style={{ width: 120 }}><NumberField id="gr-lead" min={1} max={28} value={lead} onChange={setLead} /></span>
            <span className="muted small">jours avant · annoncé sur Discord si un salon est lié</span></span>}
        </div>
      </div>
      <div className="gr-line"><span className="lbl">Description</span>
        {desc === null
          ? <button type="button" className="gr-link" onClick={() => setDesc("")}>+ Ajouter une description (visible sur Discord)</button>
          : <textarea aria-label="Description" maxLength={1000} style={{ minHeight: 60 }} placeholder="Ex. Pull à 21 h 15, flasques obligatoires." value={desc} onChange={e => setDesc(e.target.value)} />}
      </div>
      <div className="gr-sum">
        <p><b>{name || "Raid"}</b> · {parts ? longDate(parts) : "date à choisir"} · {retail ? `${DIFFICULTY_LABEL[rf.difficulty][gt.lang]} · ` : ""}{nPlayers} joueurs{retail ? "" : ` · ${LOOT_MODE_LABEL[loot.mode]}`}{weekly && <> · <b>chaque semaine</b></>}</p>
        <div className="row"><button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || name.trim().length < 2 || (weekly && !day)}>Créer le raid</button></div>
      </div>
      {weekly && !day && <p className="hint" style={{ margin: 0 }}>Choisis le jour du premier raid : il fixe le jour de la semaine.</p>}
    </form>
  );
}

/** Raids récurrents : une ligne chacun, avec pause, modification et suppression. */
function RecurringList({ groupId, templates, canEdit, guard }: { groupId: string; templates: RaidTemplate[]; canEdit: boolean; guard: Guard }) {
  const qc = useQueryClient();
  const gt = useGameText();
  const [edit, setEdit] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raid-templates", groupId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);
  const created = (n: number) => setMsg(n ? `${n} raid${n > 1 ? "s" : ""} créé${n > 1 ? "s" : ""}.` : null);
  return (
    <section className="stack gr-rec" aria-label="Raids récurrents">
      {templates.length === 0 && <p className="hint" style={{ margin: 0 }}>Aucun raid récurrent. Coche « Chaque semaine » en créant un raid.</p>}
      {templates.map(t => edit === t.id ? (
        <TemplateEdit key={t.id} t={t} onCancel={() => setEdit(null)} onSave={body => guard(async () => {
          const r = await patch<{ created: number }>(`/groups/${groupId}/raid-templates/${t.id}`, body); setEdit(null); await refresh(); created(r.created);
        })} />
      ) : (
        <div key={t.id} className={`gr-recrow${t.active ? "" : " off"}`}>
          <span className="tag">↻</span>
          <span><b>{t.name}</b> <span className="muted">chaque {WEEKDAYS[t.weekday - 1]?.toLowerCase()} {t.time} · {t.difficulty ? `${DIFFICULTY_LABEL[t.difficulty][gt.lang]} · ` : ""}{t.size}{t.difficulty ? "" : ` · ${LOOT_MODE_LABEL[t.lootMode]}`} · créé {t.leadDays} jour{t.leadDays > 1 ? "s" : ""} avant</span>
            {!t.active && <span className="tag" style={{ marginLeft: 6 }}>En pause</span>}</span>
          {canEdit && <span className="row gr-recact">
            <button type="button" className="btn ghost sm" onClick={() => setEdit(t.id)}>Modifier</button>
            <button type="button" className="btn ghost sm" onClick={() => void guard(async () => { const r = await patch<{ created: number }>(`/groups/${groupId}/raid-templates/${t.id}`, { active: !t.active }); await refresh(); if (!t.active) created(r.created); else setMsg(null); })}>{t.active ? "Pause" : "Reprendre"}</button>
            <button type="button" className="btn ghost sm" aria-label={`Supprimer le raid récurrent ${t.name}`} onClick={() => void guard(async () => { await del(`/groups/${groupId}/raid-templates/${t.id}`); await refresh(); setMsg("Raid récurrent supprimé (les raids déjà créés restent)."); })}>Supprimer</button>
          </span>}
        </div>
      ))}
      {msg && <div className="alert ok" role="status">{msg}</div>}
    </section>
  );
}

function TemplateEdit({ t, onSave, onCancel }: { t: RaidTemplate; onSave: (b: Partial<RaidTemplate>) => Promise<void>; onCancel: () => void }) {
  const retail = useSite().game === "retail";
  const [f, setF] = useState({ name: t.name, weekday: t.weekday, time: t.time, leadDays: t.leadDays, size: t.size, lootMode: t.lootMode, description: t.description,
    ...(retail && { difficulty: t.difficulty ?? "normal" }) });
  return (
    <form className="gr-recedit" onSubmit={e => { e.preventDefault(); void onSave(f); }}>
      <div className="fld" style={{ flex: "2 1 180px" }}><label htmlFor={`te-n-${t.id}`}>Nom</label><input id={`te-n-${t.id}`} type="text" required minLength={2} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="fld" style={{ flex: "1 1 120px" }}><label htmlFor={`te-d-${t.id}`}>Jour</label>
        <select id={`te-d-${t.id}`} value={f.weekday} onChange={e => setF({ ...f, weekday: Number(e.target.value) })}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
      <div className="fld" style={{ flex: "0 1 100px" }}><label htmlFor={`te-t-${t.id}`}>Heure</label><TimeSelect id={`te-t-${t.id}`} value={f.time} onChange={time => setF({ ...f, time })} /></div>
      <div className="fld" style={{ flex: "0 1 120px" }}><label htmlFor={`te-l-${t.id}`}>Jours avant</label><NumberField id={`te-l-${t.id}`} min={1} max={28} value={f.leadDays} onChange={leadDays => setF({ ...f, leadDays })} /></div>
      <div className="fld" style={{ flex: "0 1 auto" }}><span className="lbl">{retail ? "Difficulté" : "Format"}</span>
        {retail
          ? <RetailFormat name={f.name} difficulty={f.difficulty ?? "normal"} size={f.size} idPrefix={`te-${t.id}`} onChange={x => setF({ ...f, ...x })} />
          : <div className="seg">{RAID_SIZES.map(n => <button key={n} type="button" className={f.size === n ? "on" : ""} onClick={() => setF({ ...f, size: n })}>{n}</button>)}</div>}</div>
      {!retail && <div className="fld" style={{ flex: "0 1 150px" }}><label htmlFor={`te-b-${t.id}`}>Butin</label>
        <select id={`te-b-${t.id}`} value={f.lootMode} onChange={e => setF({ ...f, lootMode: e.target.value as LootMode })}>{LOOT_MODES.map(m => <option key={m} value={m}>{LOOT_MODE_LABEL[m]}</option>)}</select></div>}
      <div className="fld" style={{ flex: "1 1 100%" }}><label htmlFor={`te-x-${t.id}`}>Description (reprise dans chaque raid)</label><input id={`te-x-${t.id}`} type="text" maxLength={1000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
      <div className="row"><button type="submit" className="btn primary sm">Enregistrer</button><button type="button" className="btn ghost sm" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}
