import { ARMOR_TYPED_SLOTS, INVENTORY_LABEL, INVENTORY_LABEL_EN, itemRowStats, itemSearchText, itemSubclass, mainArmorSubclass, matchesSearch, subclassText, type GEAR_SLOTS } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { get, type Character, type GameItem, type GearEntry } from "../api";
import { DialogHead, Modal } from "./Dialog";
import { ItemPicker, useGameStatus, useGameVersion } from "./GameData";
import { FloatingTip, ItemIcon, ItemTooltipBody } from "./ItemTooltip";
import { useGameText } from "../gameText";
import { getLang, N, t, tn } from "../i18n";
import { itemQualityLabels } from "../i18n/game";

type Slot = (typeof GEAR_SLOTS)[number];
type View = "cur" | "bis";
/** Objet de la liste d'un emplacement : la classe et la sous-classe du jeu servent au filtre « Type ». */
type SlotItem = GameItem & { classId: number; subclassId: number };
type SortKey = "il" | "req" | "name";

/** Lignes affichées d'un coup, puis « Afficher la suite ». */
const PAGE = 50;
const MAX_LEVEL = 60;
const QUALITIES: [number, string][] = [[0, N("Toutes")], [2, N("Vert et +")], [3, N("Bleu et +")], [4, N("Épique")]];
const QUALITY_SCOPE: Record<number, string> = { 0: N("toutes qualités"), 2: N("vert et plus"), 3: N("bleu et plus"), 4: N("épiques") };
const COLS: [SortKey, string][] = [["name", N("Objet")], ["il", N("Niv.")], ["req", N("Req.")]];

/** Type affiché d'un objet (« Cuir », « Épée », « Tenu en main gauche ») ; vide pour un cou, un doigt ou un bijou. */
function typeOf(it: SlotItem, slot: Slot) {
  const en = getLang() === "en";
  if (it.classId === 4 && it.subclassId === 0) return slot === "Off Hand" ? (en ? INVENTORY_LABEL_EN : INVENTORY_LABEL)[it.inventoryType] ?? "" : "";
  return subclassText(itemSubclass(it), getLang());
}
/** Arme : à une main, deux mains, main droite (sous le type, dans la ligne). */
const handOf = (it: SlotItem, slot: Slot) =>
  it.classId === 2 && (slot === "Main Hand" || slot === "Off Hand") ? (getLang() === "en" ? INVENTORY_LABEL_EN : INVENTORY_LABEL)[it.inventoryType] ?? "" : "";

interface TypeInfo { label: string; def: boolean; off: boolean; order: number }

/**
 * Liste des objets d'un emplacement (feuille d'équipement de Mes persos, 15/11, maquette A choisie par Flo) : une fenêtre
 * par-dessus la fiche, avec tous les objets de l'emplacement que le perso peut porter, un champ qui filtre la liste à chaque
 * lettre (nom, type ou caractéristique : « agi », « endu »), un menu « Filtres » (type, qualité, niveau requis) et un clic
 * pour choisir. Au départ : vert et plus, jusqu'au niveau du perso (vue Équipé) ou tous niveaux (Objectif BiS), et sur les
 * pièces d'armure le type principal de la classe à ce niveau (mainArmorSubclass) ; les types qu'elle ne peut pas porter
 * sont grisés. Ce que la base ne connaît pas se saisit encore à la main (« Introuvable ? Le saisir à la main »).
 */
export function ItemChooser({ c, slot, slotLabel, view, g, current, onSet, onClose }: {
  c: Character; slot: Slot; slotLabel: string; view: View; g: GearEntry;
  /** Objet équipé dans l'emplacement : les infobulles de la liste s'y comparent. */
  current?: GameItem | null;
  onSet: (p: Partial<GearEntry>, item?: GameItem) => void; onClose: () => void;
}) {
  const gt = useGameText();
  const id = useId();
  const status = useGameStatus();
  const noBase = !!status.data && !status.data.items;
  const v = useGameVersion();
  const bis = view === "bis";
  const level = Math.max(1, Math.min(MAX_LEVEL, c.level || MAX_LEVEL));

  // Filtres de départ
  const defLevel: "char" | "all" = bis || level >= MAX_LEVEL ? "all" : "char";
  const [q, setQ] = useState("");
  const [quality, setQuality] = useState(2);
  const [lvl, setLvl] = useState(defLevel);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "il", desc: true });
  const [shown, setShown] = useState(PAGE);
  const [pop, setPop] = useState(false);
  const [manual, setManual] = useState(false);
  const maxReq = lvl === "char" ? level : MAX_LEVEL;

  const list = useQuery({
    queryKey: ["items-slot", slot, maxReq, quality, v],
    queryFn: () => get<{ items: SlotItem[]; truncated: boolean }>(`/gamedata/items/slot?slot=${encodeURIComponent(slot)}&maxReq=${maxReq}&minQuality=${quality}&v=${v}`),
    enabled: !noBase,
    staleTime: 10 * 60_000,
    placeholderData: prev => prev,
  });
  const all = useMemo(() => list.data?.items ?? [], [list.data]);

  // Types présents : sur les pièces d'armure, le type principal de la classe au départ, ceux qu'elle ne porte pas grisés
  const main = (ARMOR_TYPED_SLOTS as readonly string[]).includes(slot) ? mainArmorSubclass(c.cls, bis ? MAX_LEVEL : level) : null;
  const types = useMemo(() => {
    const m = new Map<string, TypeInfo>();
    for (const it of all) {
      const label = typeOf(it, slot);
      if (!label || m.has(label)) continue;
      const armor = it.classId === 4 && it.subclassId >= 1 && it.subclassId <= 4;
      m.set(label, { label, def: main == null || !armor || it.subclassId === main, off: main != null && armor && it.subclassId > main, order: it.classId * 100 + it.subclassId });
    }
    return [...m.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [all, slot, main]);
  const isOn = (ti: TypeInfo) => !ti.off && (picked[ti.label] ?? ti.def);
  const on = useMemo(() => new Map(types.map(ti => [ti.label, !ti.off && (picked[ti.label] ?? ti.def)])), [types, picked]);

  const search = useMemo(() => new Map(all.map(it => [it.id, itemSearchText(it)])), [all]);
  const filtered = useMemo(() => {
    const rows = all.filter(it => {
      const label = typeOf(it, slot);
      if (label && !on.get(label)) return false;
      return !q.trim() || matchesSearch(search.get(it.id) ?? "", q);
    });
    const dir = sort.desc ? -1 : 1;
    const by = (a: SlotItem, b: SlotItem) => sort.key === "name" ? a.name.localeCompare(b.name) : sort.key === "req" ? a.reqLevel - b.reqLevel : a.itemLevel - b.itemLevel;
    return rows.sort((a, b) => dir * by(a, b) || b.itemLevel - a.itemLevel || b.quality - a.quality || a.name.localeCompare(b.name));
  }, [all, on, q, sort, search, slot]);
  useEffect(() => setShown(PAGE), [q, quality, lvl, picked, sort]);

  // Le champ reçoit le focus à l'ouverture (pas sur un écran tactile : le clavier cacherait la liste)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!matchMedia("(pointer: coarse)").matches) inputRef.current?.focus(); }, []);

  // Menu « Filtres » : se ferme d'un clic ailleurs, ou avec Échap sans fermer la fenêtre (.ic-tools)
  const popRef = useRef<HTMLDivElement>(null);
  const popBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!pop) return;
    const out = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node) && !popBtn.current?.contains(e.target as Node)) setPop(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [pop]);

  const reset = () => { setQuality(2); setLvl(defLevel); setPicked({}); setSort({ key: "il", desc: true }); };

  // Infobulle de la ligne survolée (ou atteinte au clavier), comparée à l'objet équipé
  const [tip, setTip] = useState<{ item: SlotItem; rect: DOMRect } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rows = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".ic-row") ?? [])];
  const rowKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const els = rows(), i = els.indexOf(e.currentTarget);
    if (e.key === "ArrowDown") { e.preventDefault(); els[i + 1]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? els[i - 1] : inputRef.current)?.focus(); }
  };

  const choose = (it: SlotItem) => {
    if (bis) onSet({ bis: it.name, bisId: it.id, bisQ: it.quality, ...(it.id !== g.bisId && { got: !!g.curId && g.curId === it.id }) }, it);
    else onSet({ cur: it.name, curId: it.id, q: it.quality }, it);
    onClose();
  };
  const clear = () => {
    onSet(bis ? { bis: "", bisId: null, bisQ: null, got: false } : { cur: "", curId: null, q: null });
    onClose();
  };
  const has = !!(bis ? g.bis?.trim() : g.cur?.trim());
  const mine = bis ? g.bisId : g.curId;

  // Ce que montre la liste : « Cuir · jusqu'au niveau 50 · vert et plus · 412 objets »
  const onTypes = types.filter(isOn);
  const scope = [
    types.length > 1 && (onTypes.length === types.length ? t("tous les types") : onTypes.length ? onTypes.map(ti => ti.label).join(", ") : t("aucun type")),
    maxReq < MAX_LEVEL ? t("jusqu'au niveau {n}", { n: maxReq }) : t("tous niveaux"),
    t(QUALITY_SCOPE[quality]!),
  ].filter(Boolean).join(" · ");

  const lang = getLang();
  const who = t("{name}, {cls} niv. {n}", { name: c.name, cls: gt.cls(c.cls) || t("Classe ?"), n: c.level });
  return (
    <Modal label={`${id}-h`} onClose={onClose} className="ic">
      <DialogHead id={`${id}-h`} title={slotLabel} sub={<span><b>{bis ? t("Objectif BiS") : t("Objet équipé")}</b> · {who}</span>} onClose={onClose} />
      {noBase ? <p className="hint">{t("La base de données du jeu n'est pas encore importée sur ce serveur.")}</p> : <>
        <div className="ic-tools" onKeyDown={e => { if (pop && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPop(false); popBtn.current?.focus(); } }}>
          <input ref={inputRef} type="search" aria-label={t("Filtrer la liste des objets")} placeholder={t("Filtrer : nom ou caractéristique (agi, endu…)")}
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); rows()[0]?.focus(); } }} />
          <button ref={popBtn} type="button" className="btn" aria-expanded={pop} aria-controls={`${id}-pop`} onClick={() => setPop(p => !p)}>
            {t("Filtres")} <span aria-hidden="true">▾</span></button>
          {pop && (
            <div className="ic-pop" id={`${id}-pop`} ref={popRef} role="group" aria-label={t("Filtres")}>
              {types.length > 1 && <>
                <span className="ic-lab" id={`${id}-ty`}>{t("Type")}</span>
                <div className="ic-checks" role="group" aria-labelledby={`${id}-ty`}>
                  {types.map(ti => (
                    <label key={ti.label} className={ti.off ? "off" : ""} title={ti.off ? t("Ta classe ne peut pas porter ce type à ce niveau.") : undefined}>
                      <input type="checkbox" checked={isOn(ti)} disabled={ti.off} onChange={e => setPicked(p => ({ ...p, [ti.label]: e.target.checked }))} /> {ti.label}
                    </label>
                  ))}
                </div>
                {types.some(ti => ti.off) && <small className="hint">{t("Grisés : ta classe ne peut pas les porter.")}</small>}
              </>}
              <span className="ic-lab" id={`${id}-qu`}>{t("Qualité")}</span>
              <div className="seg eq" role="group" aria-labelledby={`${id}-qu`}>
                {QUALITIES.map(([n, l]) => <button key={n} type="button" className={quality === n ? "on" : ""} aria-pressed={quality === n} onClick={() => setQuality(n)}>{t(l)}</button>)}
              </div>
              {level < MAX_LEVEL && <>
                <span className="ic-lab" id={`${id}-lv`}>{t("Niveau requis")}</span>
                <div className="seg eq" role="group" aria-labelledby={`${id}-lv`}>
                  <button type="button" className={lvl === "char" ? "on" : ""} aria-pressed={lvl === "char"} onClick={() => setLvl("char")}>{t("Jusqu'au {n} (le perso)", { n: level })}</button>
                  <button type="button" className={lvl === "all" ? "on" : ""} aria-pressed={lvl === "all"} onClick={() => setLvl("all")}>{t("Tous")}</button>
                </div>
              </>}
              <button type="button" className="link ic-reset" onClick={reset}>{t("Revenir aux filtres de départ")}</button>
            </div>
          )}
        </div>
        <p className="ic-scope" aria-live="polite">{scope} · <b>{tn(filtered.length, "{n} objet", "{n} objets")}</b></p>
        <div className="ic-th">
          <span />
          {COLS.map(([k, l]) => (
            <button key={k} type="button" className={sort.key === k ? "on" : ""} aria-pressed={sort.key === k} title={t("Trier")}
              onClick={() => setSort(s => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: k !== "name" }))}>
              {t(l)}{sort.key === k && <span aria-hidden="true"> {sort.desc ? "▾" : "▴"}</span>}
            </button>
          ))}
          <span>{t("Caractéristiques")}</span>
        </div>
        {list.isPending ? <p className="ic-msg">{t("Chargement des objets…")}</p>
          : list.isError ? <p className="ic-msg">{t("Impossible de charger les objets.")}</p>
          : !filtered.length ? <p className="ic-msg">{t("Aucun objet ne correspond aux filtres.")}</p>
          : (
            <ul className="ic-list" ref={listRef} aria-label={t("Objets : {slot}", { slot: slotLabel })} onScroll={() => setTip(null)}>
              {filtered.slice(0, shown).map(it => {
                const type = [typeOf(it, slot), handOf(it, slot)].filter(Boolean).join(" · ");
                const stats = itemRowStats(it.details, lang).join(" · ");
                const isCur = !!g.curId && g.curId === it.id, isBis = !!g.bisId && g.bisId === it.id;
                // Infobulle à côté du pointeur (comme sur les sites de base de données) ; au clavier, à droite du nom
                const atPointer = (e: MouseEvent) => setTip({ item: it, rect: new DOMRect(e.clientX + 6, e.clientY + 10, 0, 0) });
                const atName = (el: HTMLElement) => setTip({ item: it, rect: (el.querySelector(".ic-name > span") ?? el).getBoundingClientRect() });
                return (
                  <li key={it.id}>
                    <button type="button" className={`ic-row${mine === it.id ? " on" : ""}`}
                      aria-label={[it.name, t("niv. {n}", { n: it.itemLevel }), it.reqLevel ? t("requiert {n}", { n: it.reqLevel }) : "", isCur ? t("équipé") : "", isBis ? t("objectif BiS") : ""].filter(Boolean).join(", ")}
                      onClick={() => choose(it)} onKeyDown={rowKey}
                      onMouseEnter={atPointer} onMouseMove={atPointer} onMouseLeave={() => setTip(null)}
                      onFocus={e => { if (e.currentTarget.matches(":focus-visible")) atName(e.currentTarget); }} onBlur={() => setTip(null)}>
                      <ItemIcon item={it} size={36} />
                      <span className="ic-name">
                        <span className={`q${it.quality}`}>{it.name}</span>
                        {(isCur || isBis) && <span className="ic-tags">{isCur && <span className="tag gold">{t("Équipé")}</span>}{isBis && <span className="tag ok">{t("Objectif BiS")}</span>}</span>}
                        <small>{type}<span className="ic-ph">{type && " · "}{t("niv. {n}", { n: it.itemLevel })}{it.reqLevel ? ` · ${t("req. {n}", { n: it.reqLevel })}` : ""}</span></small>
                        {stats && <small className="ic-ph ic-st">{stats}</small>}
                      </span>
                      <span className="ic-n num">{it.itemLevel}</span>
                      <span className="ic-n num">{it.reqLevel || "—"}</span>
                      <span className="ic-st">{stats}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        {list.data?.truncated && <p className="hint ic-cut">{t("Liste coupée aux {n} objets du plus haut niveau : resserre les filtres (qualité, niveau).", { n: list.data.items.length })}</p>}
      </>}
      {(manual || noBase) && (
        <div className="ic-manual" role="group" aria-label={t("Saisie à la main")}>
          {bis
            ? <div className="fld"><span className="lbl">{t("Objectif BiS")}</span>
              <ItemPicker slot={slot} label={t("Objectif BiS : {slot}", { slot: slotLabel })} name={g.bis ?? ""} itemId={g.bisId} quality={g.bisQ} compareWith={current} compareLabel={t("Gain par rapport à")}
                onChange={p => onSet({ bis: p.name, bisId: p.id, bisQ: p.quality ?? (p.id ? g.bisQ : null) })} /></div>
            : <>
              <div className="fld"><span className="lbl">{t("Équipé")}</span>
                <ItemPicker slot={slot} label={t("Équipé : {v}", { v: slotLabel })} name={g.cur ?? ""} itemId={g.curId} quality={g.q} compareWith={current} compareLabel={t("Par rapport à")}
                  onChange={p => onSet({ cur: p.name, curId: p.id, ...(p.quality !== undefined && { q: p.quality }) })} /></div>
              <div className="fld"><label htmlFor={`${id}-q`}>{t("Qualité (saisie libre)")}</label>
                <select id={`${id}-q`} value={g.q ?? ""} onChange={e => onSet({ q: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">—</option>{itemQualityLabels().slice(0, 6).map((ql, i) => <option key={i} value={i}>{ql}</option>)}
                </select></div>
            </>}
        </div>
      )}
      <div className="ic-foot">
        {!noBase && filtered.length > shown && <button type="button" className="link" onClick={() => setShown(s => s + PAGE)}>{t("Afficher la suite ›")}</button>}
        {bis && has && <label className="ic-got"><input type="checkbox" checked={!!g.got} onChange={e => onSet({ got: e.target.checked })} /> {t("BiS obtenu")}</label>}
        <span className="grow1" />
        {has && <button type="button" className="btn ghost sm" onClick={clear}>{t("Retirer l'objet")}</button>}
        {!noBase && <button type="button" className="link" aria-expanded={manual} onClick={() => setManual(m => !m)}>{manual ? t("Masquer la saisie à la main") : t("Introuvable ? Le saisir à la main")}</button>}
      </div>
      {tip && <FloatingTip rect={tip.rect}>
        <ItemTooltipBody item={tip.item} compare={current && current.id !== tip.item.id ? current : null} compareLabel={bis ? t("Gain par rapport à") : t("Par rapport à")} />
      </FloatingTip>}
    </Modal>
  );
}
