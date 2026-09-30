import { FloatingTip, ItemHover, ItemIcon, ItemTooltipBody } from "./ItemTooltip";
import { ITEM_QUALITIES, itemLinks, PROFESSION_SKILL_LINES, type GEAR_SLOTS } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { ApiError, get, put, type GameItem, type GameRecipe, type GameStatus, type RecipeStatus } from "../api";

const QUALITY_LABEL = [...ITEM_QUALITIES, "Artefact", "Héritage"];

/** État de la base du jeu (importée des tables du client). Tant qu'elle est vide, on garde la saisie libre. */
export function useGameStatus() {
  return useQuery({ queryKey: ["gamedata-status"], queryFn: () => get<GameStatus>("/gamedata/status"), staleTime: 10 * 60_000 });
}

/** Métiers qui ont des recettes (la cueillette, le dépeçage et la pêche n'en ont pas). */
export const CRAFTING = new Set(["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Leatherworking", "Mining", "Tailoring", "Cooking", "First Aid"]);

const ExtLink = ({ id }: { id: number }) => (
  <a className="ext" href={itemLinks(id).wowhead} target="_blank" rel="noopener noreferrer" title="Voir sur Wowhead" aria-label="Voir sur Wowhead">↗</a>
);

/* ---------------------------------------------------------------- Patrons */

type Source = "item" | "trainer" | "all";
type View = "all" | "marked" | "known" | "wanted" | "none";
const PAGE = 60;

/**
 * Carte dépliante « Patrons » sous un métier : chaque joueur coche ceux qu'il connaît
 * et marque ceux qu'il recherche. Les données ne sont chargées qu'à l'ouverture.
 */
export function RecipeCard({ characterId, profession, skill, editable }: { characterId: string; profession: string; skill: number; editable: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useGameStatus();
  const mine = useQuery({
    queryKey: ["char-recipes", characterId],
    queryFn: () => get<{ recipes: { spellId: number; status: RecipeStatus; skillLine: number }[] }>(`/characters/${characterId}/recipes`),
  });
  const list = useQuery({
    queryKey: ["recipes", profession],
    queryFn: () => get<{ recipes: GameRecipe[]; items: Record<number, GameItem> }>(`/gamedata/professions/${encodeURIComponent(profession)}/recipes`),
    enabled: open && !!status.data?.recipes,
    staleTime: 60 * 60_000,
  });

  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source>("item");
  const [category, setCategory] = useState("");
  const [quality, setQuality] = useState("");
  const [view, setView] = useState<View>(editable ? "all" : "marked");
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  const marks = useMemo(() => new Map((mine.data?.recipes ?? []).map(r => [r.spellId, r.status])), [mine.data]);
  const recipes = list.data?.recipes ?? [];
  const items = list.data?.items ?? {};
  const line = PROFESSION_SKILL_LINES[profession];
  const ofProfession = (mine.data?.recipes ?? []).filter(r => r.skillLine === line).map(r => r.status);
  const known = ofProfession.filter(s => s === "known").length, wanted = ofProfession.filter(s => s === "wanted").length;

  const categories = useMemo(() => [...new Set(recipes.map(r => r.category || (r.createdItemId && items[r.createdItemId]?.kind) || "").filter(Boolean))].sort(), [recipes, items]);
  const qualities = useMemo(() => [...new Set(recipes.map(r => (r.createdItemId ? items[r.createdItemId]?.quality : undefined)).filter((v): v is number => v !== undefined))].sort(), [recipes, items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recipes.filter(r => {
      const made = r.createdItemId ? items[r.createdItemId] : undefined;
      const mark = marks.get(r.spellId);
      if (view === "marked" && !mark) return false;
      if (view === "known" && mark !== "known") return false;
      if (view === "wanted" && mark !== "wanted") return false;
      if (view === "none" && mark) return false;
      // Un patron déjà coché reste visible même si le filtre de source l'exclurait
      if (source === "item" && !r.fromItem && !mark) return false;
      if (source === "trainer" && r.fromItem) return false;
      if (category && (r.category || made?.kind) !== category) return false;
      if (quality !== "" && made?.quality !== Number(quality)) return false;
      if (needle && !r.name.toLowerCase().includes(needle) && !made?.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [recipes, items, marks, q, source, category, quality, view]);
  useEffect(() => setShown(PAGE), [q, source, category, quality, view]);

  const setMark = async (spellId: number, next: RecipeStatus | null) => {
    setError(null);
    const key = ["char-recipes", characterId];
    const before = qc.getQueryData<{ recipes: { spellId: number; status: RecipeStatus; skillLine: number }[] }>(key);
    qc.setQueryData(key, { recipes: [...(before?.recipes ?? []).filter(r => r.spellId !== spellId), ...(next ? [{ spellId, status: next, skillLine: line }] : [])] });
    try { await put(`/characters/${characterId}/recipes/${spellId}`, { status: next }); }
    catch (e) { qc.setQueryData(key, before); setError(e instanceof ApiError ? e.message : "Enregistrement impossible."); }
  };

  const noData = status.data && !status.data.recipes;

  return (
    <details className="recipes" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span>Patrons</span>
        <span className="small muted">
          {mine.data ? <><b className="num">{known}</b> connu{known > 1 ? "s" : ""} · <b className="num">{wanted}</b> recherché{wanted > 1 ? "s" : ""}</> : "Afficher"}
        </span>
      </summary>
      <div className="recipes-body">
        {noData && <p className="hint">La base de données du jeu n'est pas encore importée sur ce serveur.</p>}
        {list.isLoading && <p className="hint">Chargement des recettes…</p>}
        {list.error && <p className="hint">Impossible de charger les recettes.</p>}
        {list.data && (
          <>
            {editable && (
              <div className="rfilters">
                <input type="search" aria-label="Chercher une recette" placeholder="Chercher (recette ou objet)…" value={q} onChange={e => setQ(e.target.value)} />
                <select aria-label="Source" value={source} onChange={e => setSource(e.target.value as Source)}>
                  <option value="item">Patrons (objets)</option><option value="trainer">Entraîneur</option><option value="all">Toutes les recettes</option>
                </select>
                <select aria-label="Type d'objet" value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">Tous les types</option>{categories.map(c => <option key={c}>{c}</option>)}
                </select>
                <select aria-label="Rareté" value={quality} onChange={e => setQuality(e.target.value)}>
                  <option value="">Toutes raretés</option>{qualities.map(v => <option key={v} value={v}>{QUALITY_LABEL[v]}</option>)}
                </select>
                <select aria-label="Affichage" value={view} onChange={e => setView(e.target.value as View)}>
                  <option value="all">Tout</option><option value="marked">Cochés ou recherchés</option><option value="known">Connus</option><option value="wanted">Recherchés</option><option value="none">Non cochés</option>
                </select>
              </div>
            )}
            {error && <div className="alert error" role="alert">{error}</div>}
            {!filtered.length ? <p className="hint">{editable ? "Aucune recette ne correspond aux filtres." : "Aucun patron renseigné."}</p> : (
              <ul className="rlist">
                {filtered.slice(0, shown).map(r => {
                  const made = r.createdItemId ? items[r.createdItemId] : undefined;
                  const mark = marks.get(r.spellId);
                  const tooHigh = skill < r.reqSkill;
                  return (
                    <li key={r.spellId} className={mark ? `on ${mark}` : ""}>
                      <label className="rcheck" title="Je connais ce patron">
                        <input type="checkbox" checked={mark === "known"} onChange={e => void setMark(r.spellId, e.target.checked ? "known" : null)} aria-label={`Je connais ${r.name}`} />
                      </label>
                      <div className="rmain">
                        <div className="rname">
                          <ItemHover item={made} className="with-icon">
                            {made && <ItemIcon item={made} size={20} />}
                            <span className={made ? `q${made.quality}` : ""}>{made && r.createdCount > 1 ? `${r.createdCount}× ` : ""}{r.name}</span>
                          </ItemHover>
                          {made && <ExtLink id={made.id} />}
                          {r.enchant && <span className="muted small"> · {r.enchant}</span>}
                        </div>
                        <div className="rmeta">
                          <span className={tooHigh ? "warn" : ""}>Requiert <span className="num">{r.reqSkill}</span></span>
                          <span>{r.fromItem ? "Patron" : "Entraîneur"}</span>
                          {r.reagents.length > 0 && (
                            <span className="reag">{r.reagents.map((x, k) => (
                              <span key={x.id}>{k > 0 && ", "}<ItemHover item={items[x.id]}>{x.n}× {items[x.id]?.name ?? `#${x.id}`}</ItemHover></span>
                            ))}</span>
                          )}
                        </div>
                      </div>
                      <button type="button" className={`rwant${mark === "wanted" ? " on" : ""}`} aria-pressed={mark === "wanted"}
                        title={mark === "wanted" ? "Retirer des recherchés" : "Je recherche ce patron"}
                        onClick={() => void setMark(r.spellId, mark === "wanted" ? null : "wanted")}>
                        {mark === "wanted" ? "★" : "☆"}<span className="sr-only">Recherché</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="row between small">
              <span className="muted">{filtered.length} recette{filtered.length > 1 ? "s" : ""} affichée{filtered.length > 1 ? "s" : ""} sur {recipes.length}</span>
              {filtered.length > shown && <button type="button" className="btn ghost sm" onClick={() => setShown(s => s + PAGE)}>Afficher plus</button>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- Sélecteur d'objet */

type Slot = (typeof GEAR_SLOTS)[number];

/**
 * Champ texte avec recherche dans la base du jeu (combobox accessible au clavier).
 * Choisir un résultat enregistre l'identifiant et la qualité ; taper librement reste possible.
 */
export function ItemPicker({ slot, label, name, itemId, quality, onChange, compareWith, compareLabel }: {
  slot: Slot; label: string; name: string; itemId?: number | null; quality?: number | null;
  onChange: (p: { name: string; id: number | null; quality?: number | null }) => void;
  /** Objet auquel comparer les résultats dans leur infobulle (celui qu'on remplacerait). */
  compareWith?: GameItem | null; compareLabel?: string;
}) {
  const status = useGameStatus();
  const enabled = !!status.data?.items;
  const listId = useId();
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(0);
  const [term, setTerm] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const search = useQuery({
    queryKey: ["items", slot, term],
    queryFn: () => get<{ items: GameItem[] }>(`/gamedata/items?slot=${encodeURIComponent(slot)}&q=${encodeURIComponent(term)}&limit=12`),
    enabled: enabled && focus && term.length >= 2,
    staleTime: 5 * 60_000,
  });
  const results = search.data?.items ?? [];
  const open = enabled && focus && term.length >= 2 && (results.length > 0 || search.isFetched);

  // La liste est en position fixe (un conteneur qui défile la couperait sinon). Elle s'ouvre vers le haut
  // quand il n'y a pas assez de place sous le champ, et ne dépasse jamais de l'écran.
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect(); if (!r) return;
      const below = innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 220 && above > below;
      const width = Math.min(Math.max(r.width, 280), innerWidth - 24);
      const left = Math.max(12, Math.min(r.left, innerWidth - width - 12));
      setRect(up
        ? { bottom: innerHeight - r.top + 4, left, width, maxHeight: Math.min(320, above) }
        : { top: r.bottom + 4, left, width, maxHeight: Math.min(320, below) });
    };
    place();
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  // Infobulle du résultat actif (souris ou flèches du clavier), à côté de la liste
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [tipRect, setTipRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!open) { setTipRect(null); return; }
    const el = optionRefs.current[active];
    setTipRect(el ? el.getBoundingClientRect() : null);
  }, [open, active, results, rect]);

  const type = (v: string) => {
    onChange({ name: v, id: null });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setTerm(v.trim()); setActive(0); }, 250);
  };
  const pick = (it: GameItem) => { onChange({ name: it.name, id: it.id, quality: it.quality }); setTerm(""); setFocus(false); };

  return (
    <div className="picker">
      <input ref={inputRef} type="text" role={enabled ? "combobox" : undefined} aria-label={label} maxLength={100}
        aria-expanded={enabled ? open : undefined} aria-controls={enabled ? listId : undefined} aria-autocomplete={enabled ? "list" : undefined}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        className={quality != null ? `q${quality}` : ""} value={name}
        placeholder={enabled ? "Chercher un objet…" : ""}
        onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
        onChange={e => type(e.target.value)}
        onKeyDown={e => {
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]!); }
          else if (e.key === "Escape") setFocus(false);
        }} />
      {itemId ? <ExtLink id={itemId} /> : null}
      {open && (
        <ul className="picker-list" id={listId} role="listbox" style={rect ?? undefined}>
          {!results.length && <li className="muted small" role="option" aria-selected={false}>Aucun objet trouvé pour cet emplacement.</li>}
          {results.map((it, i) => (
            <li key={it.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} ref={el => { optionRefs.current[i] = el; }}
              onMouseDown={e => { e.preventDefault(); pick(it); }} onMouseEnter={() => setActive(i)}>
              <ItemIcon item={it} size={28} />
              <span className="po-txt">
                <span className={`q${it.quality}`}>{it.name}</span>
                <small>{[it.kind, `niv. objet ${it.itemLevel}`, it.reqLevel ? `requiert ${it.reqLevel}` : "", it.origin === "era" ? "données Classic Era" : ""].filter(Boolean).join(" · ")}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && results[active] && tipRect && (
        <FloatingTip rect={tipRect}>
          <ItemTooltipBody item={results[active]!} compare={compareWith && compareWith.id !== results[active]!.id ? compareWith : null} compareLabel={compareLabel ?? "Par rapport à"} />
        </FloatingTip>
      )}
    </div>
  );
}
