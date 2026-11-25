import {
  bisProfile, effectOptions, GEAR_SLOTS, gearHit, HIT_TARGETS, isObtainable, isPvp, mergeWeights, parseTalentLink, parseWeightsImport, proposeBis,
  RACE_HIT, RACES, rankSlot, scoreSelection, setBonuses, sourceLabel, talentHit, WEIGHT_KEYS,
  type BisFilters, type BisSource, type EffectOption, type BisItem, type BisProposal, type GearSlot, type HitTarget, type ItemDetails, type WeightKey, type Weights,
} from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { get, put, type Character, type GameItem, type GearEntry } from "../api";
import { useMe } from "../auth";
import { getLang, N, t, tn } from "../i18n";
import { DialogHead, Modal } from "./Dialog";
import { ItemIcon } from "./ItemTooltip";
import { ranksFrom, useTalentData } from "./TalentTrees";

/**
 * Module BiS, lot 2 (24/11/2026, maquettes validées par Flo) : dans la vue « Objectif BiS » de l'onglet Équipement, le
 * bandeau du toucher, « Proposer la BiS » (aperçu puis valider), la provenance, l'enchantement et le toucher sous chaque
 * objet, le tri « Classement BiS » de la fenêtre de choix, l'écran des poids (défaut, guilde, les miens, import Pawn) et
 * le récapitulatif des enchantements avec la liste de courses. Une icône du jeu devant chaque objet, partout.
 *
 * Lot 3 (25/11, maquette v2 validée) : chaque emplacement sur trois lignes (nom et score ; emplacement, niveau,
 * toucher ; pastilles de provenance, set, enchantement et gain), les emplacements sans objectif en pointillés avec
 * « En faire l'objectif », l'avancement des sets bonus par bonus au milieu, et la section « Objets à effet » à part.
 */

type Mode = "default" | "group" | "me";
type PvpChoice = "all" | "none" | number;
interface Prefs { target: HitTarget; pvp: PvpChoice; boe: boolean; mode: Mode | null; fxSeen: boolean; fxTab: "useful" | "other" }

const PREFS_KEY = (p: string) => `fr-bis-${p}`;
const DEFAULT_PREFS: Prefs = { target: "raid", pvp: "all", boe: true, mode: null, fxSeen: true, fxTab: "useful" };
function loadPrefs(p: string): Prefs {
  try { const v = JSON.parse(localStorage.getItem(PREFS_KEY(p)) ?? "null"); if (v && typeof v === "object") return { ...DEFAULT_PREFS, ...v }; } catch { /* stockage indisponible */ }
  return DEFAULT_PREFS;
}
function savePrefs(p: string, v: Prefs) { try { localStorage.setItem(PREFS_KEY(p), JSON.stringify(v)); } catch { /* stockage indisponible */ } }

interface WeightsResponse { profile: string; defaults: Weights; hitCap: number; group: Weights | null; me: Weights | null; canEditGroup: boolean }
export interface EnchantView {
  fr: string; en: string;
  recipe: { spellId: number; name: string; reqSkill: number } | null;
  /** Patron de la recette, ou l'arcanum lui-même : son icône. */
  item: Pick<GameItem, "id" | "name" | "quality" | "inventoryType" | "details"> | null;
  reagents: { n: number; item: Pick<GameItem, "id" | "name" | "quality" | "inventoryType" | "details"> }[];
}
interface EnchantsResponse { profile: string; slots: Partial<Record<GearSlot, { best: EnchantView; cheaper: EnchantView | null }>> }

/** Une provenance lisible et son ton (vert : connue, orange : à trouver, rouge : JcJ). */
export function sourceOf(it: BisItem | undefined): { text: string; tone: "ok" | "warn" | "bad" } | null {
  if (!it) return null;
  const lang = getLang();
  if (isPvp(it)) return { text: it.pvpRank ? t("JcJ · rang {n}", { n: it.pvpRank }) : t("JcJ"), tone: "bad" };
  if (it.source && it.source.from !== "auto") return { text: sourceLabel(it.source, lang), tone: "ok" };
  if (it.source) return { text: sourceLabel(it.source, lang), tone: it.seen ? "ok" : "warn" };
  if (it.seen) return { text: t("vu en jeu · provenance à trouver"), tone: "warn" };
  return { text: t("pas encore vu en jeu"), tone: "warn" };
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString(getLang() === "en" ? "en-US" : "fr-FR");

/** Tout ce dont la vue « Objectif BiS » a besoin, pour un perso dont la spé a un profil BiS (null sinon). */
export function useBis(c: Character, on: boolean, items: Record<number, GameItem>) {
  const profile = bisProfile(c.cls, c.spec1);
  const key = profile?.key ?? "";
  const enabled = on && !!profile;
  const groupId = c.group?.id;
  const itemsQ = useQuery({ queryKey: ["bis-items", key], enabled, staleTime: 5 * 60_000, queryFn: () => get<{ items: BisItem[] }>(`/bis/${key}/items`) });
  const weightsQ = useQuery({ queryKey: ["bis-weights", key, groupId ?? ""], enabled, staleTime: 60_000,
    queryFn: () => get<WeightsResponse>(`/bis/${key}/weights${groupId ? `?groupId=${groupId}` : ""}`) });
  const enchQ = useQuery({ queryKey: ["bis-enchants", key], enabled, staleTime: 10 * 60_000, queryFn: () => get<EnchantsResponse>(`/bis/${key}/enchants`) });
  const talentsQ = useTalentData(c.cls, enabled);
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(key));
  const setPrefs = (p: Partial<Prefs>) => setPrefsState(old => { const v = { ...old, ...p }; savePrefs(key, v); return v; });
  const [whatIf, setWhatIf] = useState<number | null>(null);

  // Toucher hors équipement : talents (lien ou relevé de l'addon) et race
  const talentPart = useMemo(() => {
    const talents = talentsQ.data?.talents ?? [];
    const link = c.talentLink ? parseTalentLink(c.talentLink) : null;
    const ranks = ranksFrom(talents, { nodes: c.talentNodes ?? null, blocks: link?.ok ? link.blocks : null });
    const list = ranks ? talents.map(tt => ({ name: tt.name, rank: ranks.get(tt.id) ?? 0 })).filter(x => x.rank > 0) : [];
    const hit = talentHit(c.cls, list);
    const reach = list.find(x => x.name === "Nature's Reach");
    return { hit, label: reach ? t("Nature's Reach {r}/2 · {p} % (lu sur tes talents)", { r: reach.rank, p: fmt(hit) }) : hit ? t("Talents · {p} %", { p: fmt(hit) }) : "" };
  }, [talentsQ.data, c.talentLink, c.talentNodes, c.cls]);
  const raceHit = RACE_HIT[c.race] ?? 0;
  const baseHit = whatIf ?? talentPart.hit + raceHit;
  const cap = HIT_TARGETS[prefs.target];

  const w = weightsQ.data;
  const mode: Mode = prefs.mode ?? (w?.me ? "me" : w?.group ? "group" : "default");
  const weights = useMemo(() => w ? mergeWeights(w.defaults, mode !== "default" ? w.group : null, mode === "me" ? w.me : null) : profile?.weights ?? {}, [w, mode, profile]);
  const faction = RACES[c.race]?.faction ?? null;
  const filters: BisFilters = { faction, level: 60, pvp: prefs.pvp, noBoe: !prefs.boe };
  const all = itemsQ.data?.items ?? [];
  const byId = useMemo(() => new Map(all.map(it => [it.id, it])), [all]);

  // Toucher de l'objectif BiS actuel (objets de la base, chiffrés), bonus de set compris
  const objective = GEAR_SLOTS.map(s => { const id = c.gear[s]?.bisId; return id ? (byId.get(id) ?? (items[id] as { details?: ItemDetails } | undefined)) : null; });
  const objHit = gearHit(objective);
  const hitOf = (id?: number | null) => (id ? gearHit([byId.get(id) ?? (items[id] as { details?: ItemDetails } | undefined)]) : 0);
  /** Toucher qui manque encore pour un emplacement, sans compter l'objet qu'il porte. */
  const roomFor = (slot: GearSlot) => Math.max(0, cap - baseHit - (objHit - hitOf(c.gear[slot]?.bisId)));

  // Objectif actuel en objets du module (bonus de set compris) : score, sets, toucher
  const objItems = GEAR_SLOTS.map(s => { const id = c.gear[s]?.bis?.trim() ? c.gear[s]?.bisId : null; return id ? byId.get(id) ?? null : null; });
  const objKey = objItems.map(o => o?.id ?? 0).join(",");
  const objSel = useMemo(() => scoreSelection(objItems, weights, Math.max(0, cap - baseHit)), [objKey, weights, cap, baseHit]); // eslint-disable-line react-hooks/exhaustive-deps
  const objScore = objSel.total;
  // Ce que tu portes, chiffré pareil : pour le gain de chaque emplacement et le total « À gagner »
  const curItems = GEAR_SLOTS.map(s => { const id = c.gear[s]?.curId; return id ? byId.get(id) ?? null : null; });
  const curKey = curItems.map(o => o?.id ?? 0).join(",");
  const curScore = useMemo(() => scoreSelection(curItems, weights, Math.max(0, cap - baseHit)).total, [curKey, weights, cap, baseHit]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = (slot: GearSlot, list: (BisItem | null)[]) => GEAR_SLOTS.filter(s => s !== slot).map(s => list[GEAR_SLOTS.indexOf(s)]);
  /** Score d'un objet dans un emplacement (bonus de set compris avec le reste de l'objectif) ; null : objet à effet ou inconnu. */
  const slotScore = (slot: GearSlot, it: BisItem | null | undefined) => {
    if (!profile || !it) return null;
    const r = rankSlot([it], slot, profile, weights, roomFor(slot), { ...filters, includeUnobtainable: true, pvp: "all", noBoe: false, faction: null }, others(slot, objItems));
    return r.scored[0]?.score ?? (r.effects[0] ? { ...r.effects[0].score, effect: true } : null);
  };
  /** Objets visés sans provenance connue (ni graine, ni addon, ni admin ; JcJ exclu). */
  const unknownSources = objItems.filter((it): it is BisItem => !!it && !isPvp(it) && !it.source).length;

  return {
    objScore, objSets: objSel.sets, profile, ready: enabled && itemsQ.isSuccess, loading: enabled && itemsQ.isPending, all, byId, weights, weightsData: w, mode, prefs, setPrefs,
    filters, cap, baseHit, talentPart, raceHit, whatIf, setWhatIf, objHit, roomFor, enchants: enchQ.data?.slots ?? {},
    rank: (slot: GearSlot) => (profile ? rankSlot(all, slot, profile, weights, roomFor(slot), filters, GEAR_SLOTS.filter(s => s !== slot).map(s => objItems[GEAR_SLOTS.indexOf(s)])) : { scored: [], effects: [] }),
    propose: (): BisProposal | null => {
      if (!profile) return null;
      const fixed: Partial<Record<GearSlot, BisItem>> = {};
      for (const s of GEAR_SLOTS) { const g = c.gear[s]; const it = g?.got && g.bisId ? byId.get(g.bisId) : undefined; if (it) fixed[s] = it; }
      return proposeBis(all, profile, weights, { hitHave: baseHit, hitCap: cap, filters, fixed });
    },
    curScore, slotScore, unknownSources, objItems,
    /** Section « Objets à effet » : par emplacement, vus en jeu seulement si la case est cochée. */
    effectGroups: () => (profile ? effectOptions(all, profile, weights, Math.max(0, cap - baseHit - objHit), filters, prefs.fxSeen) : []),
  };
}
export type BisState = ReturnType<typeof useBis>;

/* ---------- Bandeau du toucher ---------- */

export function BisBar({ bis, onPropose, onWeights }: { bis: BisState; onPropose: () => void; onWeights: () => void }) {
  const id = useId();
  const total = bis.baseHit + bis.objHit;
  const miss = Math.max(0, bis.cap - total);
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / bis.cap) * 100))}%`;
  const talentsLabel = bis.whatIf != null ? t("Et si : {p} %", { p: fmt(bis.whatIf) }) : bis.talentPart.label || (bis.raceHit ? t("Race · {p} %", { p: fmt(bis.raceHit) }) : "");
  const modeLabel = bis.mode === "me" ? t("Poids : les miens") : bis.mode === "group" ? t("Poids : la guilde") : t("Poids : défaut");
  return (
    <div className="bis-bar" role="group" aria-label={t("BiS : toucher et réglages")}>
      <div className="bis-top">
        <span>{bis.prefs.target === "raid" ? t("Toucher contre un boss de raid") : t("Toucher contre un boss de donjon")}</span>
        <b className="bis-big num">{fmt(total)} % / {bis.cap} %</b>
        <span className={miss > 0 ? "t-warn" : "t-ok"}>{miss > 0
          ? t("● il manque {p} % : les objets avec du toucher passent devant", { p: fmt(miss) })
          : t("● cap atteint : le toucher en plus ne compte plus")}</span>
        <span className="grow1" />
        <button type="button" className="btn" onClick={onWeights}>{modeLabel} <span aria-hidden="true">▾</span></button>
        <button type="button" className="btn primary" onClick={onPropose} disabled={!bis.ready}>{t("Proposer la BiS")}</button>
      </div>
      <div className="bis-hbar" aria-hidden="true">
        {bis.baseHit > 0 && <i className="b-tal" style={{ width: pct(bis.baseHit) }}>{talentsLabel}</i>}
        {bis.objHit > 0 && <i className="b-gear" style={{ width: pct(Math.min(bis.objHit, bis.cap - bis.baseHit)) }}>{t("Objectif BiS · {p} %", { p: fmt(bis.objHit) })}</i>}
        {miss > 0 && <i className="b-miss">{fmt(miss)} %</i>}
      </div>
      <div className="bis-top bis-opts">
        <label htmlFor={`${id}-wi`}>{t("Et si… (talents, race, buffs)")}</label>
        <input id={`${id}-wi`} type="range" min={0} max={bis.cap} step={0.5} value={bis.baseHit} onChange={e => bis.setWhatIf(Number(e.target.value))} />
        <span className="num">{fmt(bis.baseHit)} %</span>
        {bis.whatIf != null && <button type="button" className="link" onClick={() => bis.setWhatIf(null)}>{t("Revenir à mes talents")}</button>}
        <span className="bis-gap" />
        <span id={`${id}-tg`}>{t("Cible")}</span>
        <div className="seg eq" role="group" aria-labelledby={`${id}-tg`}>
          {(["raid", "dungeon"] as HitTarget[]).map(k => (
            <button key={k} type="button" className={bis.prefs.target === k ? "on" : ""} aria-pressed={bis.prefs.target === k} onClick={() => bis.setPrefs({ target: k })}>
              {k === "raid" ? t("Boss de raid · {p} %", { p: HIT_TARGETS.raid }) : t("Donjon · {p} %", { p: HIT_TARGETS.dungeon })}</button>
          ))}
        </div>
        <span className="bis-gap" />
        <label className="sr-only" htmlFor={`${id}-pvp`}>{t("Objets JcJ")}</label>
        <select id={`${id}-pvp`} value={String(bis.prefs.pvp)} onChange={e => bis.setPrefs({ pvp: e.target.value === "all" || e.target.value === "none" ? e.target.value : Number(e.target.value) })}>
          <option value="all">{t("JcJ : tous les rangs")}</option>
          <option value="none">{t("JcJ : aucun")}</option>
          {[6, 8, 10, 12, 13, 14].map(r => <option key={r} value={r}>{t("JcJ : jusqu'au rang {n}", { n: r })}</option>)}
        </select>
        <label className="bis-check"><input type="checkbox" checked={bis.prefs.boe} onChange={e => bis.setPrefs({ boe: e.target.checked })} /> {t("Objets BoE")}</label>
        {bis.filters.faction && <span className="bis-chip">{bis.filters.faction === "Horde" ? t("Horde") : t("Alliance")}</span>}
      </div>
    </div>
  );
}

/* ---------- Chaque emplacement de la fiche (lot 3, 25/11) ---------- */

const KIND_GLYPH: Record<BisSource["kind"], string> = { drop: "☠", raid: "☠", world: "☠", vendor: "◈", craft: "⚒", quest: "⚑", reputation: "✪", pvp: "⚔", other: "•" };

/**
 * Texte d'un emplacement de la vue Objectif BiS : nom et score ; emplacement, niveau, toucher et « provenance inconnue » ;
 * puis les pastilles. `empty` : pas d'objectif, l'objet affiché est celui que tu portes.
 */
export function BisSlotText({ bis, slot, g, name, quality, level, slotName, empty }: {
  bis: BisState; slot: GearSlot; g: GearEntry; name: string | null; quality: number | null; level: number | null; slotName: string; empty: boolean;
}) {
  const en = getLang() === "en";
  const it = !empty && g.bisId ? bis.byId.get(g.bisId) : undefined;
  const worn = g.curId ? bis.byId.get(g.curId) : undefined;
  const sc = empty ? bis.slotScore(slot, worn) : bis.slotScore(slot, it);
  const wornSc = !empty && worn && worn.id !== it?.id ? bis.slotScore(slot, worn) : null;
  const got = !!g.got || (!!it && g.curId === it.id);
  // Gain seulement face à un objet porté (face à un emplacement vide, il répéterait le score)
  const gain = it && sc && !sc.effect && !got && worn && wornSc ? Math.round(sc.total - (wornSc.effect ? wornSc.base : wornSc.total)) : 0;
  const hit = it ? gearHit([it]) : 0;
  const src = it ? sourceOf(it) : null;
  const known = src && !(src.tone === "warn" && !it?.source);
  const pr = it?.details.set ? bis.objSets.progress.find(x => x.id === it.details.set!.id) : undefined;
  const e = !empty ? bis.enchants[slot] : undefined;
  return (
    <span className="gtxt">
      <span className="bis-l1">
        <span className={`gname${quality != null && !empty ? ` q${quality}` : ""}`}>{name ?? t("Vide")}{got && <span className="tag ok gbis">{t("BiS")}</span>}</span>
        {sc && <span className="bis-sc num">{sc.effect ? t("effet") : fmt(sc.total)}</span>}
      </span>
      <span className="gmeta">
        <span>{slotName}</span>
        {level != null && <span className="num">{t("niv. {n}", { n: level })}</span>}
        {hit > 0 && <span className="bis-hit num">{t("+{p} % toucher", { p: fmt(hit) })}</span>}
        {empty ? <><b className="t-warn">{t("pas d'objectif")}</b>{name && <span>{t("tu portes cet objet")}</span>}</>
          : it && !known ? <span className="t-warn">{src?.text === t("pas encore vu en jeu") ? src.text : t("provenance inconnue")}</span> : null}
        {it && !isObtainable(it) && it.unobtainable && <span className="t-bad">{t("marqué non obtenable")}</span>}
      </span>
      {!empty && (known || pr || e || gain > 0 || got) && (
        <span className="bis-chips">
          {known && src && it && <span className={`bis-ch src t-${src.tone === "bad" ? "bad" : "ink"}`} title={src.text}>
            <span aria-hidden="true">{isPvp(it) ? KIND_GLYPH.pvp : KIND_GLYPH[it.source?.kind ?? "other"]} </span>{src.text}</span>}
          {pr && <span className="bis-ch set">◆ {t("{set} {have}/{total}", { set: pr.name.replace(/ (Raiment|Armor|Garb|Battlegear|Regalia|Vestments)$/, ""), have: pr.have, total: pr.total })}</span>}
          {e && <span className="bis-ch ench" title={en ? e.best.en : e.best.fr}>✦ {en ? e.best.en : e.best.fr}</span>}
          {gain > 0 && <span className="bis-ch up">▲ {t("+{n} sur ton objet", { n: gain })}</span>}
          {got && <span className="bis-ch">✓ {t("obtenu")}</span>}
        </span>
      )}
    </span>
  );
}

/** Sous un emplacement sans objectif : en faire l'objectif (l'objet porté) ou en choisir un autre. */
export function BisEmptyActions({ g, onAdopt, onChoose }: { g: GearEntry; onAdopt: () => void; onChoose: () => void }) {
  return (
    <div className="bis-acts">
      {g.cur?.trim() && <button type="button" className="link" onClick={onAdopt}>{t("En faire l'objectif")}</button>}
      <button type="button" className="link" onClick={onChoose}>{g.cur?.trim() ? t("Choisir un autre objet") : t("Choisir un objet")}</button>
    </div>
  );
}

/** Milieu de la fiche : ton équipement chiffré, le gain, l'avancement des sets bonus par bonus, les provenances manquantes. */
export function BisMidPanel({ bis }: { bis: BisState }) {
  const loc = getLang() === "en" ? "en-US" : "fr-FR";
  const diff = Math.round(bis.objScore - bis.curScore);
  // Le pourcentage n'a de sens que si tu portes déjà l'essentiel de ton équipement
  const pct = bis.curScore > 0 ? Math.round((bis.objScore / bis.curScore - 1) * 100) : null;
  return (
    <>
      <div className="pstat"><span>{t("Ton équipement actuel")}</span><b className="num">{Math.round(bis.curScore).toLocaleString(loc)}</b></div>
      {diff > 0 && <div className="pstat"><span>{t("À gagner")}</span><b className="num t-ok">+{diff.toLocaleString(loc)}{pct != null && pct <= 100 ? ` (+${pct} %)` : ""}</b></div>}
      {bis.objSets.progress.map(st => {
        const all = setBonusesOf(bis, st.id);
        return (
          <div key={st.id} className="bis-setp">
            <div className="bis-setn"><b>{st.name}</b><span className="bis-pips" aria-hidden="true">{Array.from({ length: st.total }, (_, i) => <i key={i} className={i < st.have ? "on" : ""} />)}</span><b className="num">{st.have}/{st.total}</b></div>
            <ul>
              {all.map((b, i) => {
                const on = b.n <= st.have;
                return (
                  <li key={i} className={on ? "on" : "next"}><span className="num">({b.n})</span>
                    <span><span className="bis-btext" title={b.text}>{b.text}</span>{!on && <small>{tn(b.n - st.have, "encore {n} pièce", "encore {n} pièces")}</small>}</span>
                    <span className="num">{bonusLabel(b.stats, bis.weights)}</span></li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {bis.unknownSources > 0 && <p className="bis-unk">● {tn(bis.unknownSources, "{n} objet visé n'a pas encore de provenance connue : elle est recherchée chaque semaine.", "{n} objets visés n'ont pas encore de provenance connue : elle est recherchée chaque semaine.")}</p>}
    </>
  );
}
/** Ce que vaut un bonus de set avec tes poids : points, toucher, ou « effet » (non chiffré). */
function bonusLabel(stats: Partial<Record<WeightKey, number>> | null, w: Weights) {
  if (!stats) return t("effet");
  if (stats.hit) return t("+{p} % toucher", { p: fmt(stats.hit) });
  const v = Object.entries(stats).reduce((n, [k, x]) => n + (w[k as WeightKey] ?? 0) * x, 0);
  return v > 0 ? `+${fmt(v)}` : "0";
}
function setBonusesOf(bis: BisState, setId: number) {
  const it = bis.objItems.find(o => o?.details.set?.id === setId);
  return it ? setBonuses(it.details.set) : [];
}

/* ---------- Section « Objets à effet » (lot 3, 25/11) ---------- */

const TRIGGER_FR: Record<number, string> = { 0: "Utiliser :", 1: "Équipé :", 2: "Chances quand vous touchez :" };

export function BisEffects({ bis, onAim }: { bis: BisState; onAim: (slot: GearSlot, it: BisItem) => void }) {
  const id = useId();
  const groups = bis.effectGroups();
  const [more, setMore] = useState<Record<string, boolean>>({});
  const tab = bis.prefs.fxTab;
  const count = (useful: boolean) => groups.reduce((n, g) => n + g.items.filter(x => x.useful === useful).length, 0);
  const shown = groups.map(g => ({ ...g, items: g.items.filter(x => x.useful === (tab === "useful")) })).filter(g => g.items.length);
  const spec = bis.profile?.focus === "tank" ? t("Utiles au tank") : t("Utiles au Félin");
  return (
    <section className="bis-fx" aria-labelledby={`${id}-h`}>
      <div className="bis-fx-head">
        <h4 id={`${id}-h`}>{t("Objets à effet")}</h4>
        <div className="seg eq" role="group" aria-label={t("Effets")}>
          <button type="button" className={tab === "useful" ? "on" : ""} aria-pressed={tab === "useful"} onClick={() => bis.setPrefs({ fxTab: "useful" })}>{spec} · {count(true)}</button>
          <button type="button" className={tab === "other" ? "on" : ""} aria-pressed={tab === "other"} onClick={() => bis.setPrefs({ fxTab: "other" })}>{t("Autres")} · {count(false)}</button>
        </div>
        <span className="grow1" />
        <label className="bis-check"><input type="checkbox" checked={bis.prefs.fxSeen} onChange={e => bis.setPrefs({ fxSeen: e.target.checked })} /> {t("Vus en jeu seulement")}</label>
      </div>
      <p className="hint">{t("Leur effet se déclenche ou s'utilise : il ne compte pas dans le score. Le chiffre est celui de l'objet sans son effet.")}</p>
      {!shown.length ? <p className="hint">{t("Aucun objet à effet ici pour l'instant.")}</p> : shown.map(gr => {
        const open = more[gr.slot];
        const list = open ? gr.items : gr.items.slice(0, 5);
        const pair = gr.slot === "Finger 1" ? (["Finger 1", "Finger 2"] as GearSlot[]) : gr.slot === "Trinket 1" ? (["Trinket 1", "Trinket 2"] as GearSlot[]) : [gr.slot];
        return (
          <div key={gr.slot} className="bis-fx-grp">
            <p className="eyebrow">{gr.slot === "Finger 1" ? t("Doigts") : gr.slot === "Trinket 1" ? t("Bijoux") : slotLabel(gr.slot)}</p>
            <ul>
              {list.map(x => <BisEffectRow key={x.item.id} x={x} pair={pair} onAim={onAim} />)}
            </ul>
            {gr.items.length > 5 && <button type="button" className="link" onClick={() => setMore(m => ({ ...m, [gr.slot]: !open }))}>
              {open ? t("Voir moins") : tn(gr.items.length - 5, "Voir {n} autre objet", "Voir les {n} autres objets")}</button>}
          </div>
        );
      })}
    </section>
  );
}
function BisEffectRow({ x, pair, onAim }: { x: EffectOption; pair: GearSlot[]; onAim: (slot: GearSlot, it: BisItem) => void }) {
  const src = sourceOf(x.item);
  const en = getLang() === "en";
  return (
    <li className="bis-fx-row">
      <ItemIcon item={x.item} size={36} />
      <span className="bis-fx-txt">
        <span><span className={`bis-fx-n q${x.item.quality}`}>{x.item.name}</span> <span className="num">{t("niv. {n}", { n: x.item.itemLevel })}</span></span>
        {x.effects.map((e, i) => <span key={i} className="bis-fx-e"><b>{en ? ["Use:", "Equip:", "Chance on hit:"][e.trigger] ?? "" : TRIGGER_FR[e.trigger] ?? ""}</b> {e.text}</span>)}
      </span>
      <span className="bis-fx-s"><small>{t("sans l'effet")}</small><b className="num">{fmt(x.score.total)}</b></span>
      <span className={`bis-fx-src t-${src?.tone === "ok" ? "ink" : src?.tone ?? "ink"}`}>{src?.text}</span>
      <span className="bis-fx-act">
        {pair.map(s => <button key={s} type="button" className="btn sm" onClick={() => onAim(s, x.item)}>{pair.length > 1 ? slotLabel(s) : t("Viser")}</button>)}
      </span>
    </li>
  );
}

/* ---------- Proposer la BiS : aperçu puis valider ---------- */

export function BisProposalDialog({ bis, c, onApply, onClose }: {
  bis: BisState; c: Character; onApply: (gear: Record<string, GearEntry>) => void; onClose: () => void;
}) {
  const id = useId();
  // Calculée une fois à l'ouverture : cocher ou décocher une ligne ne relance pas le calcul
  const [proposal] = useState(() => bis.propose());
  const rows = useMemo(() => GEAR_SLOTS.flatMap(s => {
    const p = proposal?.slots[s];
    if (!p) return [];
    const g = c.gear[s] ?? {};
    return [{ slot: s, item: p.item, score: p.score, same: g.bisId === p.item.id, curName: g.bis?.trim() || "" }];
  }), [proposal, c.gear]);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const changes = rows.filter(r => !r.same && !off[r.slot]);
  const apply = () => {
    const gear = { ...c.gear };
    for (const r of changes) {
      const g = gear[r.slot] ?? {};
      gear[r.slot] = { ...g, bis: r.item.name, bisId: r.item.id, bisQ: r.item.quality, got: !!g.curId && g.curId === r.item.id };
    }
    // Deux mains proposée : l'objectif de la main gauche se vide
    const mh = changes.find(r => r.slot === "Main Hand");
    if (mh && mh.item.inventoryType === 17 && gear["Off Hand"]?.bis) gear["Off Hand"] = { ...gear["Off Hand"], bis: "", bisId: null, bisQ: null, got: false };
    onApply(gear);
    onClose();
  };
  return (
    <Modal label={`${id}-h`} onClose={onClose} className="bis-dlg">
      <DialogHead id={`${id}-h`} title={t("Proposer la BiS")} onClose={onClose}
        sub={proposal ? t("Toucher de la BiS : {p} % sur {cap} % · score {s}", { p: fmt(Math.min(proposal.totalHit, bis.cap)), cap: bis.cap, s: fmt(proposal.total) }) : undefined} />
      {!rows.length ? <p className="hint">{t("Aucun objet obtenable à proposer pour l'instant.")}</p> : (
        <ul className="bis-plist">
          {rows.map(r => (
            <li key={r.slot} className={r.same ? "same" : ""}>
              <label>
                <input type="checkbox" disabled={r.same} checked={!r.same && !off[r.slot]} onChange={e => setOff(o => ({ ...o, [r.slot]: !e.target.checked }))} />
                <span className="bis-pslot">{slotLabel(r.slot)}</span>
                <ItemIcon item={r.item} size={32} />
                <span className="bis-pname"><span className={`q${r.item.quality}`}>{r.item.name}</span>
                  <small>{r.same ? t("déjà ton objectif") : r.curName ? t("remplace {name}", { name: r.curName }) : t("emplacement vide")}{r.score.hit > 0 ? ` · ${t("+{p} % toucher", { p: fmt(r.score.hit) })}` : ""}</small></span>
                <span className="num">{fmt(r.score.total)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!!proposal?.sets.length && (
        <div className="bis-sets">
          {proposal.sets.map(st => (
            <p key={st.id}><b>{t("{set} {have}/{total}", { set: st.name, have: st.have, total: st.total })}</b>
              {st.unlocked.length ? ` · ${st.unlocked.map(b => `(${b.n}) ${b.stats ? b.text : t("{text} (non chiffré)", { text: b.text })}`).join(" · ")}` : ""}</p>
          ))}
        </div>
      )}
      <p className="hint">{t("Les objectifs déjà obtenus restent en place ; les objets à effet sont à choisir toi-même, dans la section « Objets à effet ».")}</p>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>{t("Annuler")}</button>
        <button type="button" className="btn primary" disabled={!changes.length} onClick={apply}>
          {changes.length ? tn(changes.length, "Appliquer {n} changement", "Appliquer {n} changements") : t("Rien à changer")}</button>
      </div>
    </Modal>
  );
}

const SLOT_LABEL_FR: Record<GearSlot, string> = {
  Head: "Tête", Neck: "Cou", Shoulder: "Épaules", Back: "Dos", Chest: "Torse", Wrist: "Poignets", Hands: "Mains", Waist: "Taille", Legs: "Jambes",
  Feet: "Pieds", "Finger 1": "Doigt 1", "Finger 2": "Doigt 2", "Trinket 1": "Bijou 1", "Trinket 2": "Bijou 2", "Main Hand": "Main droite",
  "Off Hand": "Main gauche", "Ranged / Relic": "Relique",
};
const slotLabel = (s: GearSlot) => (getLang() === "en" ? s : SLOT_LABEL_FR[s]);

/* ---------- Poids ---------- */

const WEIGHT_LABELS: Partial<Record<WeightKey, string>> = {
  str: N("Force (1 point)"), agi: N("Agilité (1 point)"), ap: N("Puissance d'attaque"), crit: N("Critique (1 %)"), hit: N("Toucher (1 %, jusqu'au cap)"),
  wdps: N("DPS de l'arme (1 point)"), exp: N("Expertise (1 point)"), sta: N("Endurance"), armor: N("Armure"), def: N("Défense"), dodge: N("Esquive"),
};

export function BisWeightsDialog({ bis, c, onClose }: { bis: BisState; c: Character; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const w = bis.weightsData;
  const [tab, setTab] = useState<"me" | "group">("me");
  const base = tab === "me" ? w?.me : w?.group;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(base ?? {}).map(([k, v]) => [k, String(v).replace(".", ",")])));
  const [pawn, setPawn] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const keys = WEIGHT_KEYS.filter(k => WEIGHT_LABELS[k] && (w?.defaults[k] !== undefined || ["armor", "def", "dodge"].indexOf(k) < 0));
  const switchTab = (k: "me" | "group") => {
    setTab(k); setMsg(null);
    const src = k === "me" ? w?.me : w?.group;
    setDraft(Object.fromEntries(Object.entries(src ?? {}).map(([kk, v]) => [kk, String(v).replace(".", ",")])));
  };
  const parsed = (): Weights | null => {
    const out: Weights = {};
    for (const [k, v] of Object.entries(draft)) {
      if (!v.trim()) continue;
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n)) return null;
      out[k as WeightKey] = n;
    }
    return out;
  };
  const doImport = () => {
    const r = parseWeightsImport(pawn);
    if (!r.ok) { setMsg({ tone: "bad", text: t(r.error) }); return; }
    setDraft(d => ({ ...d, ...Object.fromEntries(Object.entries(r.weights).map(([k, v]) => [k, String(v).replace(".", ",")])) }));
    setMsg({ tone: "ok", text: tn(Object.keys(r.weights).length, "{n} caractéristique reconnue", "{n} caractéristiques reconnues") });
  };
  const save = async (weights: Weights | null) => {
    setBusy(true); setMsg(null);
    try {
      const key = bis.profile!.key;
      await put(tab === "me" ? `/bis/${key}/weights/me` : `/bis/${key}/weights/group/${c.group!.id}`, { weights: weights && Object.keys(weights).length ? weights : null });
      await qc.invalidateQueries({ queryKey: ["bis-weights", key] });
      bis.setPrefs({ mode: tab === "me" ? (weights ? "me" : null) : bis.prefs.mode });
      setMsg({ tone: "ok", text: weights ? t("Poids enregistrés") : t("Poids remis à zéro") });
    } catch (e) { setMsg({ tone: "bad", text: (e as Error).message }); } finally { setBusy(false); }
  };
  const p = parsed();
  return (
    <Modal label={`${id}-h`} onClose={onClose} className="bis-dlg">
      <DialogHead id={`${id}-h`} title={t("Poids · {spec}", { spec: c.spec1 })} onClose={onClose} />
      <div className="bis-top">
        <span id={`${id}-use`}>{t("J'utilise")}</span>
        <div className="seg eq" role="group" aria-labelledby={`${id}-use`}>
          {(["default", "group", "me"] as Mode[]).map(m => (
            <button key={m} type="button" className={bis.mode === m ? "on" : ""} aria-pressed={bis.mode === m}
              disabled={(m === "group" && !w?.group) || (m === "me" && !w?.me)} onClick={() => bis.setPrefs({ mode: m })}>
              {m === "default" ? t("Défaut") : m === "group" ? t("Guilde") : t("Les miens")}</button>
          ))}
        </div>
        {w?.canEditGroup && <>
          <span className="grow1" />
          <div className="seg eq" role="group" aria-label={t("Poids à modifier")}>
            <button type="button" className={tab === "me" ? "on" : ""} aria-pressed={tab === "me"} onClick={() => switchTab("me")}>{t("Modifier les miens")}</button>
            <button type="button" className={tab === "group" ? "on" : ""} aria-pressed={tab === "group"} onClick={() => switchTab("group")}>{t("Modifier ceux de la guilde")}</button>
          </div>
        </>}
      </div>
      <table className="bis-wtable">
        <thead><tr><th>{t("Caractéristique")}</th><th>{t("Défaut")}</th><th>{t("Guilde")}</th><th>{tab === "me" ? t("Les miens") : t("Guilde (modifier)")}</th></tr></thead>
        <tbody>
          {keys.map(k => (
            <tr key={k}>
              <td>{t(WEIGHT_LABELS[k]!)}</td>
              <td className="num">{w?.defaults[k] !== undefined ? fmt(w.defaults[k]!) : "—"}</td>
              <td className="num">{w?.group?.[k] !== undefined ? fmt(w.group[k]!) : "—"}</td>
              <td><input aria-label={t(WEIGHT_LABELS[k]!)} inputMode="decimal" value={draft[k] ?? ""} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="ic-lab" htmlFor={`${id}-pawn`}>{t("Importer depuis un site de simulation")}</label>
      <textarea id={`${id}-pawn`} className="bis-pawn" rows={3} placeholder={'( Pawn: v1: "Feral": Agility=2.1, Strength=2, HitPercent=20 )'} value={pawn} onChange={e => setPawn(e.target.value)} />
      {msg && <p className={msg.tone === "ok" ? "t-ok" : "t-bad"} role="status">{msg.text}</p>}
      {!p && <p className="t-bad" role="status">{t("Un poids n'est pas un nombre.")}</p>}
      <div className="row between">
        <button type="button" className="btn sm" onClick={doImport} disabled={!pawn.trim()}>{t("Importer")}</button>
        <span className="grow1" />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => save(null)}>{tab === "me" ? t("Revenir à la guilde") : t("Revenir aux valeurs par défaut")}</button>
        <button type="button" className="btn primary sm" disabled={busy || !p} onClick={() => p && save(p)}>{tab === "me" ? t("Enregistrer mes poids") : t("Enregistrer pour la guilde")}</button>
      </div>
    </Modal>
  );
}

/* ---------- Récapitulatif des enchantements et liste de courses ---------- */

export function BisEnchants({ bis, c }: { bis: BisState; c: Character }) {
  const en = getLang() === "en";
  const [copied, setCopied] = useState(false);
  const rows = GEAR_SLOTS.flatMap(s => {
    const e = bis.enchants[s];
    if (!e) return [];
    // Seulement les emplacements de l'objectif qui sont remplis (tête et jambes partagent l'arcanum)
    if (!c.gear[s]?.bis?.trim()) return [];
    return [{ slot: s, e }];
  });
  const shopping = useMemo(() => {
    const m = new Map<number, { n: number; item: EnchantView["reagents"][number]["item"] }>();
    for (const r of rows) {
      const best = r.e.best;
      if (best.recipe) for (const g of best.reagents) { const cur = m.get(g.item.id); m.set(g.item.id, { n: (cur?.n ?? 0) + g.n, item: g.item }); }
      else if (best.item) { const cur = m.get(best.item.id); m.set(best.item.id, { n: (cur?.n ?? 0) + 1, item: best.item }); }
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.item.name.localeCompare(b.item.name));
  }, [rows]);
  if (!rows.length) return null;
  const copy = async () => {
    const text = shopping.map(s => `${s.n} × ${s.item.name}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* presse-papiers refusé */ }
  };
  return (
    <div className="bis-recap">
      <div className="bis-card">
        <p className="eyebrow">{t("Enchantements de la BiS")}</p>
        <ul className="bis-elist">
          {rows.map(({ slot, e }) => (
            <li key={slot}>
              <span className="bis-eslot">{slotLabel(slot)}</span>
              <ItemIcon item={e.best.item ?? { quality: 1, inventoryType: 0, details: {} }} size={28} />
              <span>{en ? e.best.en : e.best.fr}
                {e.cheaper && <small> · {t("moins cher : {name}", { name: en ? e.cheaper.en : e.cheaper.fr })}</small>}
                {!e.best.recipe && !e.best.item && <small> · {t("recette pas encore dans la base")}</small>}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="bis-card">
        <p className="eyebrow">{t("Liste de courses")}</p>
        {!shopping.length ? <p className="hint">{t("Les recettes de ces enchantements ne sont pas encore dans la base.")}</p> : (
          <ul className="bis-elist">
            {shopping.map(s => (
              <li key={s.item.id}><span className="num bis-qty">{s.n}</span><ItemIcon item={s.item} size={28} /><span className={`q${s.item.quality}`}>{s.item.name}</span></li>
            ))}
          </ul>
        )}
        <p className="hint">{t("Composants tirés des recettes d'Enchantement de la base, pour un enchantement par emplacement.")}</p>
        {!!shopping.length && <button type="button" className="btn sm" onClick={copy}>{copied ? t("✓ Copié") : t("Copier la liste")}</button>}
      </div>
    </div>
  );
}

/* ---------- Correction d'un objet (admins du site) ---------- */

export function useSiteAdmin() {
  const me = useMe();
  return !!me.data?.user?.siteAdmin;
}

/** Bascule « non obtenable » d'un objet (admin du site), depuis la fenêtre de choix. */
export async function toggleUnobtainable(profileKey: string, it: BisItem, qc: ReturnType<typeof useQueryClient>) {
  await put(`/bis/items/${it.id}`, { unobtainable: !it.unobtainable });
  await qc.invalidateQueries({ queryKey: ["bis-items", profileKey] });
}
