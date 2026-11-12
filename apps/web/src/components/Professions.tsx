import { PRIMARY_PROFESSIONS, PROFESSION_SKILL_LINES } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, get, put, type Character, type GameItem, type GameRecipe, type Prof, type RecipeStatus } from "../api";
import { CRAFTING, useGameStatus, useGameVersion } from "./GameData";
import { ItemHover, ItemIcon } from "./ItemTooltip";
import { NumberField } from "./NumberField";
import { openSync, syncState } from "../syncPanel";
import { t, tn, tx } from "../i18n";
import { itemQualityLabel, professionTierText } from "../i18n/game";

/**
 * Onglet Métiers de Mes persos (refonte du 09/11, maquette-persos-metiers.png) : à gauche les cinq métiers en lignes
 * (Principaux : 2, Secondaires : Cooking, Fishing, First Aid) avec niveau, rang, patrons et barre ; à droite le métier choisi :
 * recherche, [Connus · 42][Recherchés · 2][Tous · 168] de même largeur, « Filtres ▾ » (source, type, rareté) et les patrons.
 * Ce que l'addon relève est en lecture : « ✓ Connu » ; « ☆ Je le recherche » / « ★ Recherché » se marque toujours (la guilde
 * le voit dans Artisans). « Modifier à la main » ouvre la saisie des métiers et des patrons connus.
 * Les bonus des métiers (Master Chef…) ne sont plus affichés : leurs effets réels ne sont pas connus.
 * `readOnly` (12/11) : la fiche d'un perso vue depuis la guilde (CharacterSheet). Rien à saisir ni à marquer : pas de
 * « Modifier à la main », « ✓ Connu » et « ★ Recherché » en texte.
 */

type Key = "prof1" | "prof2" | "cooking" | "fishing" | "firstAid";
type Mark = { spellId: number; status: RecipeStatus; skillLine: number };
type Filter = "known" | "wanted" | "all";
type Source = "all" | "item" | "trainer";
const SECONDARY: [Key, string][] = [["cooking", "Cooking"], ["fishing", "Fishing"], ["firstAid", "First Aid"]];
const FIRST = 5, MORE = 50;

export function Professions({ c, onChange, readOnly = false }: { c: Character; onChange: (p: Partial<Character>) => void; readOnly?: boolean }) {
  const pr = c.professions;
  const synced = syncState(c.addonSyncedAt);
  const [manual, setManual] = useState(false);
  const entries: { key: Key; name: string; skill: number; primary: boolean }[] = [
    { key: "prof1", name: pr.prof1.name, skill: pr.prof1.skill, primary: true },
    { key: "prof2", name: pr.prof2.name, skill: pr.prof2.skill, primary: true },
    ...SECONDARY.map(([k, n]) => ({ key: k, name: n, skill: pr[k as "cooking"] as number, primary: false })),
  ];
  const [sel, setSel] = useState<Key>(() => entries.find(e => e.name && e.skill > 0)?.key ?? "prof1");
  const mine = useQuery({ queryKey: ["char-recipes", c.id], queryFn: () => get<{ recipes: Mark[] }>(`/characters/${c.id}/recipes`) });
  const marks = mine.data?.recipes ?? [];
  const count = (name: string, s: RecipeStatus) => (name ? marks.filter(m => m.skillLine === PROFESSION_SKILL_LINES[name] && m.status === s).length : 0);
  const cur = entries.find(e => e.key === sel)!;
  const setProf = (k: "prof1" | "prof2", p: Prof) => onChange({ professions: { ...pr, [k]: p } });
  const setSkill = (k: Key, skill: number) => (k === "prof1" || k === "prof2" ? setProf(k, { ...pr[k], skill }) : onChange({ professions: { ...pr, [k]: skill } }));

  const row = (e: (typeof entries)[number]) => {
    const learnt = !!e.name && e.skill > 0;
    const known = count(e.name, "known"), wanted = count(e.name, "wanted");
    const sub = learnt ? [professionTierText(e.skill), known ? tn(known, "{n} patron", "{n} patrons") : null, wanted ? tn(wanted, "{n} recherché", "{n} recherchés") : null].filter(Boolean).join(" · ") : t("Non appris");
    return (
      <li key={e.key}>
        <button type="button" className={`pf-row${learnt ? "" : " none"}`} aria-current={sel === e.key ? "true" : undefined} onClick={() => setSel(e.key)}>
          <span className="pf-n">{e.name || (e.primary ? t("Métier principal") : e.name)}</span>
          <b className="pf-s num">{learnt ? e.skill : "—"}</b>
          <small className="pf-sub">{e.primary && !e.name ? t("Pas encore choisi") : sub}</small>
          <span className={`pf-bar${learnt ? "" : " none"}`} aria-hidden="true"><i style={{ width: `${Math.min(100, e.skill / 3)}%` }} /></span>
        </button>
      </li>
    );
  };

  return (
    <div className="pf">
      <aside className="pf-side" aria-label={t("Métiers du perso")}>
        <h4 className="pf-h">{t("Principaux")}</h4>
        <ul className="pf-list">{entries.filter(e => e.primary).map(row)}</ul>
        <h4 className="pf-h">{t("Secondaires")}</h4>
        <ul className="pf-list">{entries.filter(e => !e.primary).map(row)}</ul>
        <div className="pf-src">
          {c.addonSyncedAt
            ? <span className={`sy-age ${synced.tone}`}>{tx("● relevés par l'addon · {ago}", { ago: synced.ago })}</span>
            : readOnly ? <span>{t("Pas encore relevés par l'addon")}</span>
            : <span>{t("Pas encore relevés ·")} <button type="button" className="link" onClick={openSync}>{t("fais ta synchro")}</button></span>}
          {!readOnly && <button type="button" className="btn sm" aria-pressed={manual} onClick={() => setManual(m => !m)}>{manual ? t("Terminer la saisie") : t("Modifier à la main")}</button>}
        </div>
      </aside>
      <section className="pf-main" aria-labelledby="pf-title">
        <div className="pf-title">
          <h3 id="pf-title">{cur.name || t("Métier principal")}</h3>
          {cur.name && cur.skill > 0 && <span>{professionTierText(cur.skill)} · <b className="num">{cur.skill}</b>/300</span>}
        </div>
        {manual && (
          <div className="pf-edit">
            {(cur.key === "prof1" || cur.key === "prof2") && (
              <div className="fld"><label htmlFor={`${cur.key === "prof1" ? "p1" : "p2"}-n`}>{t("Métier")}</label>
                <select id={`${cur.key === "prof1" ? "p1" : "p2"}-n`} value={pr[cur.key].name} onChange={e => setProf(cur.key as "prof1", { ...pr[cur.key as "prof1"], name: e.target.value })}>
                  <option value="">—</option>{Object.keys(PRIMARY_PROFESSIONS).map(n => <option key={n} disabled={n !== pr[cur.key as "prof1"].name && n === pr[cur.key === "prof1" ? "prof2" : "prof1"].name}>{n}</option>)}
                </select></div>
            )}
            <div className="fld"><label htmlFor={`${cur.key === "prof1" ? "p1" : cur.key === "prof2" ? "p2" : `sec-${cur.key}`}-s`}>{t("Compétence")}</label>
              <NumberField id={`${cur.key === "prof1" ? "p1" : cur.key === "prof2" ? "p2" : `sec-${cur.key}`}-s`} min={0} max={300} step={5} value={cur.skill} onChange={v => setSkill(cur.key, v)} /></div>
          </div>
        )}
        {!cur.name ? <p className="pf-empty">{readOnly ? t("Pas encore choisi") : t("Choisis ce métier avec « Modifier à la main », ou fais ta synchro : l'addon le relève.")}</p>
          : !CRAFTING.has(cur.name) ? <p className="pf-empty">{tx("{name} n'a pas de patrons.", { name: cur.name })}</p>
          : <Recipes key={cur.name} characterId={c.id} profession={cur.name} skill={cur.skill} marks={marks} manual={manual} readOnly={readOnly} />}
      </section>
    </div>
  );
}

/** Les patrons du métier choisi : Connus (par défaut), Recherchés, Tous ; recherche et filtres. */
function Recipes({ characterId, profession, skill, marks, manual, readOnly }: { characterId: string; profession: string; skill: number; marks: Mark[]; manual: boolean; readOnly: boolean }) {
  const qc = useQueryClient();
  const status = useGameStatus();
  const v = useGameVersion();
  const list = useQuery({
    queryKey: ["recipes", profession, v],
    queryFn: () => get<{ recipes: GameRecipe[]; items: Record<number, GameItem> }>(`/gamedata/professions/${encodeURIComponent(profession)}/recipes?v=${v}`),
    enabled: !!status.data?.recipes, staleTime: 60 * 60_000,
  });
  const line = PROFESSION_SKILL_LINES[profession];
  const markOf = useMemo(() => new Map(marks.filter(m => m.skillLine === line).map(m => [m.spellId, m.status])), [marks, line]);
  const [filter, setFilter] = useState<Filter>("known");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>("all");
  const [category, setCategory] = useState("");
  const [quality, setQuality] = useState("");
  const [shown, setShown] = useState(FIRST);
  const [err, setErr] = useState<string | null>(null);
  const filters = useRef<HTMLDivElement>(null);
  useEffect(() => setShown(FIRST), [q, filter, source, category, quality]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!filters.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const recipes = list.data?.recipes ?? [];
  const items = list.data?.items ?? {};
  const madeOf = (r: GameRecipe) => (r.createdItemId ? items[r.createdItemId] : undefined);
  const categories = useMemo(() => [...new Set(recipes.map(r => r.category || madeOf(r)?.kind || "").filter(Boolean))].sort(), [recipes, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const qualities = useMemo(() => [...new Set(recipes.map(r => madeOf(r)?.quality).filter((x): x is number => x !== undefined))].sort(), [recipes, items]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { known: recipes.filter(r => markOf.get(r.spellId) === "known").length, wanted: recipes.filter(r => markOf.get(r.spellId) === "wanted").length, all: recipes.length };
  const needle = q.trim().toLowerCase();
  const filtered = recipes.filter(r => {
    const mark = markOf.get(r.spellId), made = madeOf(r);
    if (filter === "known" && mark !== "known") return false;
    if (filter === "wanted" && mark !== "wanted") return false;
    if (source === "item" && !r.fromItem) return false;
    if (source === "trainer" && r.fromItem) return false;
    if (category && (r.category || made?.kind) !== category) return false;
    if (quality !== "" && made?.quality !== Number(quality)) return false;
    if (needle && !r.name.toLowerCase().includes(needle) && !made?.name.toLowerCase().includes(needle)) return false;
    return true;
  }).sort((a, b) => b.reqSkill - a.reqSkill || a.name.localeCompare(b.name));
  const nFilters = [source !== "all", !!category, quality !== ""].filter(Boolean).length;

  const setMark = async (spellId: number, next: RecipeStatus | null) => {
    setErr(null);
    const key = ["char-recipes", characterId];
    const before = qc.getQueryData<{ recipes: Mark[] }>(key);
    qc.setQueryData(key, { recipes: [...(before?.recipes ?? []).filter(r => r.spellId !== spellId), ...(next ? [{ spellId, status: next, skillLine: line }] : [])] });
    try { await put(`/characters/${characterId}/recipes/${spellId}`, { status: next }); void qc.invalidateQueries({ queryKey: ["item-sources"] }); }
    catch (e) { qc.setQueryData(key, before); setErr(e instanceof ApiError ? t("Pas enregistré · {message}", { message: e.message }) : t("Pas enregistré · connexion perdue. Réessaie.")); }
  };

  if (status.data && !status.data.recipes) return <p className="pf-empty">{t("La base de données du jeu n'est pas encore importée sur ce serveur.")}</p>;
  return (
    <div className="pf-recipes">
      <div className="pf-tools">
        <input type="search" aria-label={t("Chercher un patron")} placeholder={t("Chercher un patron ou un objet…")} value={q} onChange={e => setQ(e.target.value)} />
        <div className="seg eq" role="group" aria-label={t("Patrons affichés")}>
          {([["known", t("Connus")], ["wanted", t("Recherchés")], ["all", t("Tous")]] as const).map(([k, l]) => (
            <button key={k} type="button" className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} · {list.data ? counts[k] : "…"}</button>
          ))}
        </div>
        <div className="pf-filters" ref={filters}>
          <button type="button" className="btn" aria-expanded={open} aria-controls="pf-filters" onClick={() => setOpen(o => !o)}>{t("Filtres")}{nFilters ? ` · ${nFilters}` : ""} <span aria-hidden="true">▾</span></button>
          {open && (
            <div className="pf-pop" id="pf-filters">
              <div className="fld"><label htmlFor="pf-src">{t("Source")}</label>
                <select id="pf-src" value={source} onChange={e => setSource(e.target.value as Source)}><option value="all">{t("Patrons et entraîneur")}</option><option value="item">{t("Patrons")}</option><option value="trainer">{t("Entraîneur")}</option></select></div>
              <div className="fld"><label htmlFor="pf-cat">{t("Type d'objet")}</label>
                <select id="pf-cat" value={category} onChange={e => setCategory(e.target.value)}><option value="">{t("Tous les types")}</option>{categories.map(x => <option key={x}>{x}</option>)}</select></div>
              <div className="fld"><label htmlFor="pf-q">{t("Rareté")}</label>
                <select id="pf-q" value={quality} onChange={e => setQuality(e.target.value)}><option value="">{t("Toutes")}</option>{qualities.map(x => <option key={x} value={x}>{itemQualityLabel(x)}</option>)}</select></div>
            </div>
          )}
        </div>
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {list.isLoading ? <p className="pf-empty">{t("Chargement des patrons…")}</p> : !filtered.length ? (
        <p className="pf-empty">{filter === "known" && !needle && !nFilters ? t("Aucun patron connu pour l'instant : l'addon les relève à la synchro.") : filter === "wanted" && !needle && !nFilters ? (readOnly ? t("Aucun patron recherché.") : t("Aucun patron recherché : marque-les dans « Tous ».")) : t("Aucun patron ne correspond.")}</p>
      ) : (
        <ul className="pf-rl" aria-label={t("Patrons de {profession}", { profession: profession })}>
          {filtered.slice(0, shown).map(r => {
            const made = madeOf(r), mark = markOf.get(r.spellId);
            return (
              <li key={r.spellId} className={mark ? mark : undefined}>
                <ItemHover item={made} className="pf-item" link>
                  {made ? <ItemIcon item={made} size={28} /> : <span className="pf-noicon" aria-hidden="true" />}
                  <span className={made ? `q${made.quality}` : ""}>{made && r.createdCount > 1 ? `${r.createdCount}× ` : ""}{r.name}</span>
                </ItemHover>
                <span className={`pf-req num${skill < r.reqSkill ? " warn" : ""}`}>{t("Comp. {n}", { n: r.reqSkill })}</span>
                <span className="tag">{r.fromItem ? t("Patron") : t("Entraîneur")}</span>
                <span className="pf-mark">
                  {readOnly ? (mark === "known" ? <span className="pf-known">{t("✓ Connu")}</span> : mark === "wanted" ? <span className="pf-wanted">{t("★ Recherché")}</span> : null)
                    : mark === "known"
                    ? (manual
                      ? <button type="button" className="btn sm pf-k on" aria-pressed="true" aria-label={t("Je connais {name}", { name: r.name })} onClick={() => void setMark(r.spellId, null)}>{t("✓ Connu")}</button>
                      : <span className="pf-known">{t("✓ Connu")}</span>)
                    : <>
                      {manual && <button type="button" className="btn sm pf-k" aria-pressed="false" aria-label={t("Je connais {name}", { name: r.name })} onClick={() => void setMark(r.spellId, "known")}>{t("Je le connais")}</button>}
                      <button type="button" className={`btn sm pf-w${mark === "wanted" ? " on" : ""}`} aria-pressed={mark === "wanted"} aria-label={t("Je recherche {name}", { name: r.name })}
                        onClick={() => void setMark(r.spellId, mark === "wanted" ? null : "wanted")}>{mark === "wanted" ? t("★ Recherché") : t("☆ Je le recherche")}</button>
                    </>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length > shown && (
        <p className="pf-more">{tn(filtered.length - shown, "{n} autre", "{n} autres")} · <button type="button" className="link" onClick={() => setShown(s => s + MORE)}>{t("Afficher la suite ›")}</button></p>
      )}
    </div>
  );
}
