import {
  bisProfile, GEAR_SLOTS, gearHit, HIT_TARGETS, hasEffect, isObtainable, isPvp, mergeWeights, parseTalentLink, parseWeightsImport, proposeBis,
  RACE_HIT, RACES, rankSlot, scoreSelection, sourceLabel, talentHit, usable, WEIGHT_KEYS,
  type BisFilters, type BisItem, type BisProposal, type GearSlot, type HitTarget, type ItemDetails, type WeightKey, type Weights,
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
 */

type Mode = "default" | "group" | "me";
type PvpChoice = "all" | "none" | number;
interface Prefs { target: HitTarget; pvp: PvpChoice; boe: boolean; mode: Mode | null }

const PREFS_KEY = (p: string) => `fr-bis-${p}`;
function loadPrefs(p: string): Prefs {
  try { const v = JSON.parse(localStorage.getItem(PREFS_KEY(p)) ?? "null"); if (v && typeof v === "object") return { target: "raid", pvp: "all", boe: true, mode: null, ...v }; } catch { /* stockage indisponible */ }
  return { target: "raid", pvp: "all", boe: true, mode: null };
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
    /** Objets à effet que la spé peut porter dans un emplacement (bijoux, relique) : à choisir soi-même. */
    effectCount: (slot: GearSlot) => (profile ? all.filter(it => hasEffect(it) && usable(it, profile, filters) && rankSlot([it], slot, profile, weights, 0, filters).effects.length).length : 0),
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

/* ---------- Sous chaque objet de la fiche ---------- */

export function BisSlotInfo({ bis, slot, itemId }: { bis: BisState; slot: GearSlot; itemId: number | null | undefined }) {
  const it = itemId ? bis.byId.get(itemId) : undefined;
  const src = sourceOf(it);
  const e = bis.enchants[slot];
  const en = getLang() === "en";
  if (!itemId) {
    const n = bis.effectCount(slot);
    return n ? <span className="bis-src t-warn">{tn(n, "objet à effet : à toi de choisir ({n})", "objets à effet : à toi de choisir ({n})")}</span> : null;
  }
  return (
    <>
      {src && <span className={`bis-src t-${src.tone}`}>{src.tone === "warn" ? "● " : ""}{src.text}</span>}
      {it && !isObtainable(it) && it.unobtainable && <span className="bis-src t-bad">{t("marqué non obtenable")}</span>}
      {it?.details.set && (() => {
        const pr = bis.objSets.progress.find(x => x.id === it.details.set!.id);
        return pr ? <span className="bis-set">{t("{set} {have}/{total}", { set: pr.name, have: pr.have, total: pr.total })}{pr.next ? ` · ${t("prochain bonus à {n}", { n: pr.next.n })}` : ""}</span> : null;
      })()}
      {e && <span className="bis-ench">+ {en ? e.best.en : e.best.fr}</span>}
    </>
  );
}
export function bisHitPill(bis: BisState, itemId: number | null | undefined) {
  const it = itemId ? bis.byId.get(itemId) : undefined;
  const h = it ? gearHit([it]) : 0;
  return h > 0 ? <span className="bis-hit num">{t("+{p} % toucher", { p: fmt(h) })}</span> : null;
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
      <p className="hint">{t("Les objectifs déjà obtenus restent en place ; bijoux et relique, objets à effet, sont à choisir toi-même.")}</p>
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
