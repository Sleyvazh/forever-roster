import { CLASSES, GEAR_SLOTS, ITEM_QUALITIES, type ClassName } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { get, type Character, type GameItem, type GearEntry } from "../api";
import { ItemPicker, useGameVersion } from "./GameData";
import { ClassIcon, SpecIcon } from "./Icons";
import { FloatingTip, iconUsable, ItemIcon, ItemTooltipBody, useIconFailures } from "./ItemTooltip";
import { Portrait } from "./ImageUpload";

type Slot = (typeof GEAR_SLOTS)[number];
type View = "cur" | "bis";

/** Disposition de la fiche du jeu : colonne gauche, colonne droite, armes en bas. */
const LEFT: Slot[] = ["Head", "Neck", "Shoulder", "Back", "Chest", "Wrist"];
const RIGHT: Slot[] = ["Hands", "Waist", "Legs", "Feet", "Finger 1", "Finger 2", "Trinket 1", "Trinket 2"];
const WEAPONS: Slot[] = ["Main Hand", "Off Hand", "Ranged / Relic"];

const SLOT_FR: Record<Slot, string> = {
  Head: "Tête", Neck: "Cou", Shoulder: "Épaules", Back: "Dos", Chest: "Torse", Wrist: "Poignets",
  Hands: "Mains", Waist: "Taille", Legs: "Jambes", Feet: "Pieds", "Finger 1": "Doigt 1", "Finger 2": "Doigt 2",
  "Trinket 1": "Bijou 1", "Trinket 2": "Bijou 2", "Main Hand": "Main droite", "Off Hand": "Main gauche", "Ranged / Relic": "À distance / Relique",
};

/** Pictos provisoires, remplacés par les icônes du jeu quand elles seront servies par le serveur. */
const GLYPH: Record<Slot, string> = {
  Head: "head", Neck: "neck", Shoulder: "shoulder", Back: "back", Chest: "chest", Wrist: "wrist", Hands: "hands", Waist: "waist",
  Legs: "legs", Feet: "feet", "Finger 1": "ring", "Finger 2": "ring", "Trinket 1": "trinket", "Trinket 2": "trinket",
  "Main Hand": "weapon", "Off Hand": "shield", "Ranged / Relic": "ranged",
};

function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <symbol id="g-head" viewBox="0 0 24 24"><path d="M5 15a7 7 0 0 1 14 0v4H5z" /><path d="M9 19v-4h6v4M12 8V5" /></symbol>
      <symbol id="g-neck" viewBox="0 0 24 24"><path d="M6 3c0 6 3 9 6 9s6-3 6-9" /><path d="M12 12v2" /><circle cx="12" cy="17.5" r="3" /></symbol>
      <symbol id="g-shoulder" viewBox="0 0 24 24"><path d="M3 15c2-6 6-8 9-8s7 2 9 8l-4 2-5-3-5 3z" /><path d="M8 10l-1-3M16 10l1-3" /></symbol>
      <symbol id="g-back" viewBox="0 0 24 24"><path d="M8 4h8l3 16-7-3-7 3z" /><path d="M9 4c1 2 5 2 6 0" /></symbol>
      <symbol id="g-chest" viewBox="0 0 24 24"><path d="M7 4l5 2 5-2 3 4-3 3v9H7v-9L4 8z" /><path d="M12 6v14" /></symbol>
      <symbol id="g-wrist" viewBox="0 0 24 24"><path d="M6 7h12v10H6z" /><path d="M6 12h12M10 7v10M14 7v10" /></symbol>
      <symbol id="g-hands" viewBox="0 0 24 24"><path d="M8 21v-6L6 11V6.5a1 1 0 0 1 2 0V10h1V4.5a1 1 0 0 1 2 0V10h1V4.5a1 1 0 0 1 2 0V10h1V6.5a1 1 0 0 1 2 0V14l-2 2v5z" /></symbol>
      <symbol id="g-waist" viewBox="0 0 24 24"><path d="M3 9h18v6H3z" /><path d="M10 8h4v8h-4z" /></symbol>
      <symbol id="g-legs" viewBox="0 0 24 24"><path d="M7 3h10l-1 18h-3l-1-11-1 11H8z" /></symbol>
      <symbol id="g-feet" viewBox="0 0 24 24"><path d="M8 3h5v11l6 3v3H6l1-6z" /><path d="M8 8h5" /></symbol>
      <symbol id="g-ring" viewBox="0 0 24 24"><circle cx="12" cy="15" r="5.5" /><path d="M10 6.5l2-3 2 3-2 3z" /></symbol>
      <symbol id="g-trinket" viewBox="0 0 24 24"><path d="M12 3l7 7-7 11-7-11z" /><path d="M5 10h14M12 3v18" /></symbol>
      <symbol id="g-weapon" viewBox="0 0 24 24"><path d="M4 20l9-9" /><path d="M13 5l6 6-3 3-6-6z" /><path d="M15 3l1 2M21 9l-2-1" /></symbol>
      <symbol id="g-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" /></symbol>
      <symbol id="g-ranged" viewBox="0 0 24 24"><path d="M6 3c9 2 13 8 15 17" /><path d="M6 3l15 17" /><path d="M3 12l6-3" /></symbol>
    </svg>
  );
}

interface Shown { name: string; id: number | null; quality: number | null; item?: GameItem }

function shownFor(g: GearEntry, view: View, items: Record<number, GameItem>): Shown | null {
  const name = (view === "bis" ? g.bis || g.cur : g.cur)?.trim();
  if (!name) return null;
  const useBis = view === "bis" && !!g.bis?.trim();
  const id = (useBis ? g.bisId : g.curId) ?? null;
  const item = id ? items[id] : undefined;
  const quality = item?.quality ?? (useBis ? g.bisQ : g.q) ?? null;
  return { name, id, quality, item };
}

/** Onglet Équipement présenté comme la fiche de personnage du jeu. */
export function Paperdoll({ c, onChange, editable }: { c: Character; onChange: (p: Partial<Character>) => void; editable: boolean }) {
  const [view, setView] = useState<View>("cur");
  const [open, setOpen] = useState<Slot | null>(null);
  const [tip, setTip] = useState<{ slot: Slot; rect: DOMRect } | null>(null);
  const cls = CLASSES[c.cls as ClassName];

  const ids = [...new Set(GEAR_SLOTS.flatMap(s => [c.gear[s]?.curId, c.gear[s]?.bisId]).filter((v): v is number => !!v))].sort((a, b) => a - b);
  const v = useGameVersion();
  useIconFailures(); // réaffiche le pictogramme d'emplacement si une icône est introuvable
  const itemsQ = useQuery({
    queryKey: ["items-batch", ids.join(","), v],
    queryFn: () => get<{ items: Record<number, GameItem> }>(`/gamedata/items/batch?ids=${ids.join(",")}&v=${v}`),
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
  });
  const items = itemsQ.data?.items ?? {};

  const setSlot = (slot: Slot, patch: Partial<GearEntry>) => onChange({ gear: { ...c.gear, [slot]: { ...c.gear[slot], ...patch } } });

  const got = GEAR_SLOTS.filter(s => c.gear[s]?.got).length;
  const levels = GEAR_SLOTS.map(s => shownFor(c.gear[s] ?? {}, view, items)?.item?.itemLevel).filter((v): v is number => !!v);
  const avg = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(1).replace(".", ",") : "—";
  const epics = GEAR_SLOTS.filter(s => (c.gear[s]?.bisId ? items[c.gear[s]!.bisId!]?.quality : c.gear[s]?.bisQ) === 4).length;

  const slotEl = (slot: Slot) => {
    const g = c.gear[slot] ?? {};
    const shown = shownFor(g, view, items);
    const iconOk = iconUsable(shown?.item?.details?.icon);
    const act = () => { setTip(null); if (editable) setOpen(o => (o === slot ? null : slot)); };
    return (
      <div key={slot} role="button" tabIndex={0} className="gslot" aria-expanded={editable ? open === slot : undefined}
        aria-label={`${SLOT_FR[slot]} : ${shown ? shown.name : "vide"}${g.got ? ", BiS obtenu" : ""}`}
        onClick={act}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } }}
        onMouseEnter={e => shown && setTip({ slot, rect: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => setTip(null)}
        onFocus={e => shown && setTip({ slot, rect: e.currentTarget.getBoundingClientRect() })}
        onBlur={() => setTip(null)}>
        <span className={`gicon${shown ? "" : " none"}${iconOk ? " has-img" : ""}`} style={shown?.quality != null ? { ["--qc" as string]: `var(--q${shown.quality})` } : undefined}>
          {iconOk ? <ItemIcon item={shown!.item} size={42} /> : <svg aria-hidden="true"><use href={`#g-${GLYPH[slot]}`} /></svg>}
          {g.got && <span className="got" aria-hidden="true">✓</span>}
        </span>
        <span className="gtxt">
          <span className={`gname${shown?.quality != null ? ` q${shown.quality}` : ""}`} style={shown ? undefined : { color: "var(--ink-3)" }}>{shown ? shown.name : "Vide"}</span>
          <span className="gmeta"><span>{SLOT_FR[slot]}</span>{shown?.item && <span className="num">{shown.item.itemLevel}</span>}</span>
        </span>
      </div>
    );
  };

  return (
    <div className="sec">
      <Sprite />
      <div className="gear-top">
        <h3 style={{ margin: 0 }}>Équipement</h3>
        <div className="theme-seg" role="group" aria-label="Vue">
          {/* Pas de <button> : la fiche en lecture seule est dans un fieldset désactivé, et la vue doit rester changeable. */}
          {(["cur", "bis"] as View[]).map(v => (
            <span key={v} role="button" tabIndex={0} aria-pressed={view === v} onClick={() => setView(v)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(v); } }}>
              {v === "cur" ? "Équipé" : "Objectif BiS"}
            </span>
          ))}
        </div>
      </div>
      <div className="doll">
        <div className="dcol left">{LEFT.map(slotEl)}</div>
        <aside className="portrait" aria-label="Résumé de l'équipement" style={cls ? { ["--cc" as string]: cls.color } : undefined}>
          <div className={`crest${c.portraitId ? " has-portrait" : ""}`} aria-hidden="true">
            <Portrait id={c.portraitId} size={104} className="round"
              fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={64} /> : <ClassIcon cls={c.cls} size={64} />) : "?"} />
            {c.portraitId && c.cls && <span className="crest-badge">{c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={30} /> : <ClassIcon cls={c.cls} size={30} />}</span>}
          </div>
          <div>
            <div className="spec">{c.spec1 || c.cls || "Spé ?"}</div>
            {c.spec2 && <div className="small muted">Off-spec : {c.spec2}</div>}
          </div>
          <div className="pstats">
            <div className="pstat"><span>BiS obtenus</span><b>{got}/{GEAR_SLOTS.length}</b></div>
            <div className="pbar" aria-hidden="true"><i style={{ width: `${Math.round(got / GEAR_SLOTS.length * 100)}%` }} /></div>
            <div className="pstat"><span>Niveau d'objet moyen</span><b>{avg}</b></div>
            <div className="pstat"><span>Épiques visés</span><b>{epics}</b></div>
          </div>
          {editable && <div className="small muted">Clique sur un emplacement pour choisir l'objet.</div>}
        </aside>
        <div className="dcol right">{RIGHT.map(slotEl)}</div>
        <div className="dweapons">{WEAPONS.map(slotEl)}</div>
        {editable && open && <SlotEditor slot={open} g={c.gear[open] ?? {}} items={items} onSet={p => setSlot(open, p)} onClose={() => setOpen(null)} />}
      </div>
      {tip && <ItemTip slot={tip.slot} rect={tip.rect} g={c.gear[tip.slot] ?? {}} view={view} items={items}
        owned={new Set(GEAR_SLOTS.map(s => shownFor(c.gear[s] ?? {}, view, items)?.name).filter((n): n is string => !!n))} />}
    </div>
  );
}

function SlotEditor({ slot, g, items, onSet, onClose }: { slot: Slot; g: GearEntry; items: Record<number, GameItem>; onSet: (p: Partial<GearEntry>) => void; onClose: () => void }) {
  const cur = g.curId ? items[g.curId] : null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [slot]);
  return (
    <div className="gedit" ref={ref} role="region" aria-label={`Modifier : ${SLOT_FR[slot]}`}>
      <div className="row between"><b>{SLOT_FR[slot]}</b><button type="button" className="btn sm ghost" onClick={onClose}>Fermer</button></div>
      <div className="grid">
        <div className="fld"><span className="lbl">Équipé</span>
          <ItemPicker slot={slot} label={`Équipé : ${SLOT_FR[slot]}`} name={g.cur ?? ""} itemId={g.curId} quality={g.q} compareWith={cur} compareLabel="Par rapport à"
            onChange={p => onSet({ cur: p.name, curId: p.id, ...(p.quality !== undefined && { q: p.quality }) })} />
        </div>
        <div className="fld"><label htmlFor={`gq-${slot}`}>Qualité (saisie libre)</label>
          <select id={`gq-${slot}`} value={g.q ?? ""} onChange={e => onSet({ q: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">—</option>{ITEM_QUALITIES.map((q, i) => <option key={q} value={i}>{q}</option>)}
          </select>
        </div>
        <div className="fld"><span className="lbl">Objectif BiS</span>
          <ItemPicker slot={slot} label={`Objectif BiS : ${SLOT_FR[slot]}`} name={g.bis ?? ""} itemId={g.bisId} quality={g.bisQ} compareWith={cur} compareLabel="Gain par rapport à"
            onChange={p => onSet({ bis: p.name, bisId: p.id, bisQ: p.quality ?? (p.id ? g.bisQ : null) })} />
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!g.got} onChange={e => onSet({ got: e.target.checked })} /> BiS obtenu
        </label>
      </div>
    </div>
  );
}

function ItemTip({ slot, rect, g, view, items, owned }: { slot: Slot; rect: DOMRect; g: GearEntry; view: View; items: Record<number, GameItem>; owned: Set<string> }) {
  const shown = shownFor(g, view, items);
  if (!shown) return null;
  const other = view === "cur" ? g.bis?.trim() : null;
  const status = g.got ? <div className="t-ok">✓ BiS obtenu</div> : other && other !== shown.name ? <div className="t-warn">Objectif : {other}</div> : null;
  // Objet de la base : infobulle complète, comparée à l'objectif (vue Équipé) ou à l'objet équipé (vue BiS)
  if (shown.item) {
    const cur = g.curId ? items[g.curId] : undefined, bis = g.bisId ? items[g.bisId] : undefined;
    const compare = view === "cur" ? (bis && bis.id !== shown.item.id ? bis : null) : (cur && cur.id !== shown.item.id ? cur : null);
    return (
      <FloatingTip rect={rect}>
        <ItemTooltipBody item={shown.item} owned={owned} compare={compare}
          compareLabel={view === "cur" ? "Par rapport à l'objectif BiS" : "Gain par rapport à l'équipé"} note={status} />
      </FloatingTip>
    );
  }
  return (
    <FloatingTip rect={rect}>
      <div className={`t-name${shown.quality != null ? ` tq${shown.quality}` : ""}`}>{shown.name}</div>
      <div className="t-row">{SLOT_FR[slot]}</div>
      <div className="t-src">Saisie libre (pas encore choisi dans la base)</div>
      {status}
    </FloatingTip>
  );
}
