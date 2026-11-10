import { DEFAULT_TARGETS, DIFFICULTY_LABEL, lootModesOf, RAID_SIZES, retailDefaultSize, retailLootMode, type LootMode, type RaidSize, type RetailDifficulty, type SignupStatus } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { del, get, patch, post, type Character } from "../api";
import { DayStrip, habits, hhmm, isoOf, longDate, partsOf, TimeChips, TimeSelect, type Parts } from "./DateTime";
import { LootModePicker, LootModeTag } from "./Loot";
import { AnswerState, QuickAnswerButtons, useQuickAnswer } from "./QuickAnswer";
import { NumberField } from "./NumberField";
import { RoleTag } from "./RoleIcon";
import { RetailFormat, RetailRaidChips } from "./RetailFormat";
import { TemplateChannel, useRaidTemplates, type RaidTemplate } from "./TemplateChannel";
import { useSite } from "../site";
import { useGameText } from "../gameText";
import { t, tn } from "../i18n";
import { dayLong, dayShort, dayTitle, monthShort } from "../i18n/dates";
import { lootModeName } from "../i18n/game";

/**
 * Onglet Raids d'un groupe (lot E) : la liste d'abord (À venir / Passés), « + Nouveau raid » ouvre un formulaire
 * compact (la case « Chaque semaine » en fait un raid récurrent), et les raids récurrents se déplient à part.
 * Classes CSS « gr- ».
 */

export interface RaidSummary {
  id: string; name: string; scheduledAt: string | null; filled: number; size: number; difficulty?: RetailDifficulty | null; recurring: boolean; lootMode: LootMode;
  signups: Partial<Record<SignupStatus, number>>; mySignup: SignupStatus | null; roles: { Tank: number; Heal: number; DPS: number };
  /** Mon inscription : répondre depuis la carte garde le perso et la spé (refonte du 09/11). */
  mine?: { status: SignupStatus; characterId: string | null; spec: string | null } | null;
}
type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** Un raid est « passé » 6 h après son heure. */
const PAST_AFTER_MS = 6 * 3600e3;

export function GroupRaids({ groupId, canEdit, canCreate = canEdit, guard, discordLinked = true, when: whenProp, creating, onCloseForm }: {
  groupId: string; canEdit: boolean; /** Créer un raid : selon le réglage du groupe (officiers, ou tous les membres) */ canCreate?: boolean; guard: Guard; /** Salon Discord du groupe lié */ discordLinked?: boolean;
  /** Forever : À venir / Passés choisis par les onglets de la page Raids, et « + Raid » dans son en-tête. */
  when?: "next" | "past"; creating?: boolean; onCloseForm?: () => void;
}) {
  const { data } = useQuery({ queryKey: ["raids", groupId], queryFn: () => get<{ raids: RaidSummary[] }>(`/groups/${groupId}/raids`) });
  const tpl = useRaidTemplates(groupId);
  const [whenState, setWhen] = useState<"next" | "past">("next");
  const when = whenProp ?? whenState;
  const controlled = whenProp !== undefined;
  const [formState, setFormState] = useState(false);
  const form = creating ?? formState;
  const setForm = (v: boolean) => { if (!v) onCloseForm?.(); setFormState(v); };
  const [showRec, setShowRec] = useState(false);
  const raids = data?.raids ?? [];
  const now = Date.now();
  const isPast = (r: RaidSummary) => !!r.scheduledAt && new Date(r.scheduledAt).getTime() < now - PAST_AFTER_MS;
  const next = raids.filter(r => !isPast(r)).sort((a, b) => (a.scheduledAt ?? "9").localeCompare(b.scheduledAt ?? "9"));
  const past = raids.filter(isPast).sort((a, b) => b.scheduledAt!.localeCompare(a.scheduledAt!));
  const list = when === "next" ? next : past;
  const templates = tpl.data?.templates ?? [];
  // Répondre depuis chaque carte (refonte du 09/11) : mes persos rangés dans ce groupe (main en tête), puis sans groupe
  const myAll = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 }).data?.characters ?? [];
  const myChars = myAll.filter(c => !c.group || c.group.id === groupId)
    .sort((a, b) => Number(!!b.group?.isMain && b.group.id === groupId) - Number(!!a.group?.isMain && a.group.id === groupId));
  const mainId = myChars.find(c => c.group?.id === groupId && c.group.isMain)?.id ?? null;
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raids", groupId] }), qc.invalidateQueries({ queryKey: ["week"] }),
    qc.invalidateQueries({ queryKey: ["guild-home", groupId] }), qc.invalidateQueries({ queryKey: ["raid"] }), qc.invalidateQueries({ queryKey: ["characters"] })]);

  return (
    <div className="stack">
      {(!controlled || canEdit || templates.length > 0) && <div className="gr-bar">
        {!controlled && <div className="seg" role="group" aria-label={t("Raids affichés")}>
          <button type="button" className={when === "next" ? "on" : ""} aria-pressed={when === "next"} onClick={() => setWhen("next")}>{t("À venir ({n})", { n: next.length })}</button>
          <button type="button" className={when === "past" ? "on" : ""} aria-pressed={when === "past"} onClick={() => setWhen("past")}>{t("Passés ({n})", { n: past.length })}</button>
        </div>}
        <span style={{ flex: 1 }} />
        {(canEdit || templates.length > 0) && (
          <button type="button" className="btn ghost sm" aria-expanded={showRec} onClick={() => setShowRec(s => !s)}>{t("↻ Récurrents ({n})", { n: templates.length })}</button>
        )}
        {!controlled && canCreate && !form && <button type="button" className="btn primary" onClick={() => setForm(true)}>{t("+ Nouveau raid")}</button>}
      </div>}
      {form && <NewRaid groupId={groupId} raids={raids} guard={guard} weeklyAllowed={canEdit} onClose={() => setForm(false)} />}
      {showRec && <RecurringList groupId={groupId} templates={templates} canEdit={canEdit} guard={guard} groupLinked={discordLinked} />}
      {list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{when === "next" ? (canCreate && !controlled ? t("Aucun raid prévu. Crée le premier avec « + Nouveau raid ».") : t("Aucun raid prévu.")) : t("Aucun raid passé.")}</p>
      ) : (
        <div className="gr-list">{list.map(r => <RaidCard key={r.id} groupId={groupId} r={r} past={when === "past"} officer={canEdit} chars={myChars} mainId={mainId} refresh={refresh} />)}</div>
      )}
    </div>
  );
}

/**
 * Carte d'un raid (refonte du 09/11) : la carte entière ouvre le raid ; ma réponse à droite (« Sans réponse » en orange) et,
 * pour un raid à venir, Présent, Peut-être, Absent et « Autre » de même largeur ; les officiers voient « 5 placés sur 10 ».
 */
function RaidCard({ groupId, r, past, officer, chars, mainId, refresh }: {
  groupId: string; r: RaidSummary; past: boolean; officer: boolean; chars: Character[]; mainId: string | null; refresh: () => Promise<unknown>;
}) {
  const gt = useGameText();
  const p = partsOf(r.scheduledAt);
  const wd = p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() || 7 : 0;
  const coming = (r.signups.present ?? 0) + (r.signups.late ?? 0);
  const url = `/groups/${groupId}/raids/${r.id}`;
  const mine = r.mine ?? (r.mySignup ? { status: r.mySignup, characterId: null, spec: null } : null);
  const qa = useQuickAnswer({ groupId, raidId: r.id, mine, mainId, chars, refresh });
  return (
    <div className={`gr-raid${past ? " past" : ""}`}>
      <span className="gr-date">
        {p ? <><small>{dayShort(wd)}</small><b>{p.d}</b><span>{monthShort(p.m)}</span><span className="gr-time">{hhmm(p)}</span></> : <><small>{t("date")}</small><b>?</b><span>{t("à définir")}</span></>}
      </span>
      <span className="gr-main">
        <Link className="gr-name stretch" to={url}>{r.name}</Link>
        <span className="gr-tags">
          <span className="tag">{r.difficulty ? `${DIFFICULTY_LABEL[r.difficulty][gt.lang]} · ${r.size}` : r.size}</span>
          <LootModeTag mode={r.lootMode} />
          {r.recurring && <span className="tag" title={t("Créé par un raid récurrent")}>{t("↻ chaque semaine")}</span>}
        </span>
        <span className="gr-roles">
          <span className="gr-coming">{tn(coming, "{n} vient", "{n} viennent")}</span>
          <RoleTag role="Tank" text={tn(r.roles.Tank, "{n} tank", "{n} tanks")}>{r.roles.Tank}</RoleTag>
          <RoleTag role="Heal" text={tn(r.roles.Heal, "{n} heal", "{n} heals")}>{r.roles.Heal}</RoleTag>
          <RoleTag role="DPS" text={`${r.roles.DPS} DPS`}>{r.roles.DPS}</RoleTag>
          {r.signups.tentative ? <span>{t("{n} peut-être", { n: r.signups.tentative })}</span> : null}
        </span>
      </span>
      <span className="gr-end">
        {past ? (qa.status ? <AnswerState status={qa.status} /> : null) : <AnswerState status={qa.status} />}
        {officer && <span className="gr-places">{tn(r.filled, "{n} placé sur {size}", "{n} placés sur {size}", { size: r.size })}</span>}
      </span>
      {!past && <QuickAnswerButtons qa={qa} label={t("Ma réponse pour {raid}", { raid: r.name })} className="gr-ans" />}
    </div>
  );
}

/** Formulaire compact : quoi, quel jour, quelle heure, combien, quel butin ; « Chaque semaine » en option. */
function NewRaid({ groupId, raids, guard, onClose, weeklyAllowed = true }: { groupId: string; raids: RaidSummary[]; guard: Guard; onClose: () => void; /** Raid récurrent : officiers seulement */ weeklyAllowed?: boolean }) {
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
  const tg = DEFAULT_TARGETS[size];
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
      <div className="row between"><h3 id="gr-new">{t("Nouveau raid")}</h3><button type="button" className="btn ghost sm" onClick={onClose}>{t("Fermer")}</button></div>
      <div className="gr-line"><label className="lbl" htmlFor="gr-name">{t("Nom")}</label>
        <div>
          <input id="gr-name" type="text" required minLength={2} maxLength={60} placeholder={retail ? t("Flèche du Vide") : t("Molten Core")} autoFocus value={name} onChange={e => setName(e.target.value)} />
          {retail && <RetailRaidChips value={name} onPick={n => { setName(n); setRf(f => ({ ...f, size: retailDefaultSize(f.difficulty, n) })); }} />}
          {recent.length > 0 && <div className="gr-chips"><span className="muted small">{t("Récents :")}</span>
            {recent.map(n => <button key={n} type="button" className={`dt-chip${name === n ? " on" : ""}`} onClick={() => setName(n)}>{n}</button>)}</div>}
        </div>
      </div>
      <div className="gr-line"><span className="lbl">{t("Jour")}</span>
        <div><DayStrip value={parts} onChange={setDay} habitDays={h.days} />
          {h.days.length > 0 && <p className="hint gr-hint">{t("Soulignés : les jours où la guilde raide d'habitude.")}</p>}</div>
      </div>
      <div className="gr-line"><span className="lbl">{t("Heure")}</span><TimeChips value={time} onChange={setTime} fav={h.times} /></div>
      <div className="gr-line"><span className="lbl">{retail ? t("Difficulté") : t("Format")}</span>
        {retail ? <RetailFormat name={name} difficulty={rf.difficulty} size={rf.size} idPrefix="gr" onChange={setRf} /> : (
        <div className="row" style={{ gap: 14 }}>
          <div className="seg" role="group" aria-label={t("Format du raid")}>{RAID_SIZES.map(n => <button key={n} type="button" className={size === n ? "on" : ""} aria-pressed={size === n} onClick={() => setSize(n)}>{n}</button>)}</div>
          <span className="muted small">{t("{tank} tanks · {heal} heals · {dps} DPS visés", { tank: tg.tank, heal: tg.heal, dps: tg.dps })}</span>
        </div>)}
      </div>
      <div className="gr-line"><span className="lbl">{t("Butin")}</span><LootModePicker mode={loot.mode} hidden={loot.hidden} idPrefix="gr" onChange={(mode, hidden) => setLoot({ mode, hidden })} /></div>
      {weeklyAllowed && <div className="gr-line"><span className="lbl">{t("Récurrent")}</span>
        <div className="row" style={{ gap: 12 }}>
          <label className="gr-tog"><input type="checkbox" checked={weekly} onChange={e => setWeekly(e.target.checked)} /><i aria-hidden="true" />
            {day ? t("Chaque semaine, le {day}", { day: dayLong(wd) }) : t("Chaque semaine")}</label>
          {weekly && <span className="row" style={{ gap: 8 }}><span className="muted small">{t("créé")}</span>
            <span style={{ width: 120 }}><NumberField id="gr-lead" min={1} max={28} value={lead} onChange={setLead} /></span>
            <span className="muted small">{t("jours avant · annoncé sur Discord si un salon est lié")}</span></span>}
        </div>
      </div>}
      <div className="gr-line"><span className="lbl">{t("Description")}</span>
        {desc === null
          ? <button type="button" className="gr-link" onClick={() => setDesc("")}>{t("+ Ajouter une description (visible sur Discord)")}</button>
          : <textarea aria-label={t("Description")} maxLength={1000} style={{ minHeight: 60 }} placeholder={t("Ex. Pull à 21 h 15, flasques obligatoires.")} value={desc} onChange={e => setDesc(e.target.value)} />}
      </div>
      <div className="gr-sum">
        <p><b>{name || t("Raid")}</b> · {parts ? longDate(parts) : t("date à choisir")} · {retail ? `${DIFFICULTY_LABEL[rf.difficulty][gt.lang]} · ` : ""}{tn(nPlayers, "{n} joueur", "{n} joueurs")} · {lootModeName(loot.mode, gt.game)}{weekly && <> · <b>{t("chaque semaine")}</b></>}</p>
        <div className="row"><button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={busy || name.trim().length < 2 || (weekly && !day)}>{t("Créer le raid")}</button></div>
      </div>
      {weekly && !day && <p className="hint" style={{ margin: 0 }}>{t("Choisis le jour du premier raid : il fixe le jour de la semaine.")}</p>}
    </form>
  );
}

/** Raids récurrents : une ligne chacun, avec pause, modification et suppression. */
function RecurringList({ groupId, templates, canEdit, guard, groupLinked }: { groupId: string; templates: RaidTemplate[]; canEdit: boolean; guard: Guard; groupLinked: boolean }) {
  const qc = useQueryClient();
  const gt = useGameText();
  const [edit, setEdit] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["raid-templates", groupId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] })]);
  const created = (n: number) => setMsg(n ? tn(n, "{n} raid créé.", "{n} raids créés.") : null);
  return (
    <section className="stack gr-rec" aria-label={t("Raids récurrents")}>
      {templates.length === 0 && <p className="hint" style={{ margin: 0 }}>{t("Aucun raid récurrent. Coche « Chaque semaine » en créant un raid.")}</p>}
      {templates.map(tpl => edit === tpl.id ? (
        <TemplateEdit key={tpl.id} t={tpl} onCancel={() => setEdit(null)} onSave={body => guard(async () => {
          const r = await patch<{ created: number }>(`/groups/${groupId}/raid-templates/${tpl.id}`, body); setEdit(null); await refresh(); created(r.created);
        })} />
      ) : (
        <div key={tpl.id} className={`gr-recrow${tpl.active ? "" : " off"}`}>
          <span className="tag">↻</span>
          <span><b>{tpl.name}</b> <span className="muted">{t("chaque {day} {time}", { day: dayLong(tpl.weekday), time: tpl.time })} · {tpl.difficulty ? `${DIFFICULTY_LABEL[tpl.difficulty][gt.lang]} · ` : ""}{tpl.size} · {lootModeName(tpl.lootMode, gt.game, true)} · {tn(tpl.leadDays, "créé {n} jour avant", "créé {n} jours avant")}</span>
            {!tpl.active && <span className="tag" style={{ marginLeft: 6 }}>{t("En pause")}</span>}</span>
          {canEdit && <span className="row gr-recact">
            <button type="button" className="btn ghost sm" onClick={() => setEdit(tpl.id)}>{t("Modifier")}</button>
            <button type="button" className="btn ghost sm" onClick={() => void guard(async () => { const r = await patch<{ created: number }>(`/groups/${groupId}/raid-templates/${tpl.id}`, { active: !tpl.active }); await refresh(); if (!tpl.active) created(r.created); else setMsg(null); })}>{tpl.active ? t("Pause") : t("Reprendre")}</button>
            <button type="button" className="btn ghost sm" aria-label={t("Supprimer le raid récurrent {name}", { name: tpl.name })} onClick={() => void guard(async () => { await del(`/groups/${groupId}/raid-templates/${tpl.id}`); await refresh(); setMsg(t("Raid récurrent supprimé (les raids déjà créés restent).")); })}>{t("Supprimer")}</button>
          </span>}
          <TemplateChannel groupId={groupId} t={tpl} canEdit={canEdit} guard={guard} refresh={refresh} groupLinked={groupLinked} />
        </div>
      ))}
      {msg && <div className="alert ok" role="status">{msg}</div>}
    </section>
  );
}

function TemplateEdit({ t: tpl, onSave, onCancel }: { t: RaidTemplate; onSave: (b: Partial<RaidTemplate>) => Promise<void>; onCancel: () => void }) {
  const game = useSite().game;
  const retail = game === "retail";
  // Roster : journal ou conseil (une ancienne soft reserve repart en journal)
  const [f, setF] = useState({ name: tpl.name, weekday: tpl.weekday, time: tpl.time, leadDays: tpl.leadDays, size: tpl.size, lootMode: retail ? retailLootMode(tpl.lootMode) as LootMode : tpl.lootMode, description: tpl.description,
    ...(retail && { difficulty: tpl.difficulty ?? "normal" }) });
  return (
    <form className="gr-recedit" onSubmit={e => { e.preventDefault(); void onSave(f); }}>
      <div className="fld" style={{ flex: "2 1 180px" }}><label htmlFor={`te-n-${tpl.id}`}>{t("Nom")}</label><input id={`te-n-${tpl.id}`} type="text" required minLength={2} maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="fld" style={{ flex: "1 1 120px" }}><label htmlFor={`te-d-${tpl.id}`}>{t("Jour")}</label>
        <select id={`te-d-${tpl.id}`} value={f.weekday} onChange={e => setF({ ...f, weekday: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map(wd => <option key={wd} value={wd}>{dayTitle(wd)}</option>)}</select></div>
      <div className="fld" style={{ flex: "0 1 100px" }}><label htmlFor={`te-t-${tpl.id}`}>{t("Heure")}</label><TimeSelect id={`te-t-${tpl.id}`} value={f.time} onChange={time => setF({ ...f, time })} /></div>
      <div className="fld" style={{ flex: "0 1 120px" }}><label htmlFor={`te-l-${tpl.id}`}>{t("Jours avant")}</label><NumberField id={`te-l-${tpl.id}`} min={1} max={28} value={f.leadDays} onChange={leadDays => setF({ ...f, leadDays })} /></div>
      <div className="fld" style={{ flex: "0 1 auto" }}><span className="lbl">{retail ? t("Difficulté") : t("Format")}</span>
        {retail
          ? <RetailFormat name={f.name} difficulty={f.difficulty ?? "normal"} size={f.size} idPrefix={`te-${tpl.id}`} onChange={x => setF({ ...f, ...x })} />
          : <div className="seg">{RAID_SIZES.map(n => <button key={n} type="button" className={f.size === n ? "on" : ""} onClick={() => setF({ ...f, size: n })}>{n}</button>)}</div>}</div>
      <div className="fld" style={{ flex: retail ? "0 1 250px" : "0 1 150px" }}><label htmlFor={`te-b-${tpl.id}`}>{t("Butin")}</label>
        <select id={`te-b-${tpl.id}`} value={f.lootMode} onChange={e => setF({ ...f, lootMode: e.target.value as LootMode })}>{lootModesOf(game).map(m => <option key={m} value={m}>{lootModeName(m, game)}</option>)}</select></div>
      <div className="fld" style={{ flex: "1 1 100%" }}><label htmlFor={`te-x-${tpl.id}`}>{t("Description (reprise dans chaque raid)")}</label><input id={`te-x-${tpl.id}`} type="text" maxLength={1000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div>
      <div className="row"><button type="submit" className="btn primary sm">{t("Enregistrer")}</button><button type="button" className="btn ghost sm" onClick={onCancel}>{t("Annuler")}</button></div>
    </form>
  );
}
