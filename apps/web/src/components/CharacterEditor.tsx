import { NumberField } from "./NumberField";
import {
  CLASSES, LEGACY_TREES, PRIMARY_PROFESSIONS, PROFESSION_PAIRS, RACE_NAMES, RACES,
  SECONDARY_PROFESSIONS, CLASS_SPECS, isValidCombo, parseTalentLink, professionTier, roleOf, specDef, talentPointsAt, type ClassName, type Role, type SpecDef,
} from "@forever/game-data";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Character, Prof } from "../api";
import { CRAFTING, RecipeCard } from "./GameData";
import { ClassIcon, SpecIcon } from "./Icons";
import { ImageUpload, Portrait } from "./ImageUpload";
import { del, uploadImage } from "../api";
import { Paperdoll } from "./Paperdoll";
import { ranksFrom, TalentTrees, useTalentData, type Talent, type TreeView } from "./TalentTrees";
import { useViewPref } from "../prefs";
import { syncAge } from "../addonImport";

type Tab = "profil" | "metiers" | "stuff" | "legacy";
export type EditorTab = Tab;
/** Onglets de la fiche dans l'adresse (/persos/:id/:onglet). */
export const EDITOR_TAB_SLUG: Record<Tab, string> = { profil: "profil", metiers: "metiers", stuff: "equipement", legacy: "notes" };
export const editorTabFromSlug = (slug?: string): Tab => (Object.entries(EDITOR_TAB_SLUG).find(([, s]) => s === slug)?.[0] as Tab | undefined) ?? "profil";
const TABS: [Tab, string][] = [["profil", "Profil & talents"], ["metiers", "Métiers"], ["stuff", "Équipement"], ["legacy", "Legacy & notes"]];

export interface EditorProps {
  character: Character;
  editable: boolean;
  /** Reçoit uniquement les champs modifiés. */
  onChange: (patch: Partial<Character>) => void;
  footer?: React.ReactNode;
  /** Portrait changé (envoyé directement, hors sauvegarde automatique). */
  onPortrait?: (id: string | null) => void;
  /** Onglet piloté par l'appelant (adresse de la page) ; sinon gardé le temps de la session. */
  tab?: Tab;
  onTab?: (t: Tab) => void;
  /** Bandeau sous l'en-tête (Mes persos : groupe et main / alt). */
  subhead?: React.ReactNode;
}

const Bar = ({ pct, color }: { pct: number; color?: string }) => (
  <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { background: color } : {}) }} /></div>
);

export function CharacterEditor({ character: c, editable, onChange, footer, onPortrait, tab: tabProp, onTab, subhead }: EditorProps) {
  const [tabState, setTab] = useState<Tab>(() => (sessionStorage.getItem("fr-tab") as Tab) || "profil");
  const tab = tabProp ?? tabState;
  const cl = CLASSES[c.cls as ClassName];
  const race = RACES[c.race];
  const roles = [...new Set([roleOf(c.spec1), roleOf(c.spec2)].filter(Boolean))];
  const pick = (t: Tab) => { if (onTab) { onTab(t); return; } setTab(t); sessionStorage.setItem("fr-tab", t); };
  const [portraitOpen, setPortraitOpen] = useState(false);
  const canPortrait = editable && !!onPortrait;
  const face = <Portrait id={c.portraitId} size={64} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={44} /> : <ClassIcon cls={c.cls} size={44} />) : null} />;

  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={`Fiche de ${c.name}`}>
      <div className="dhead" style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon">
            {canPortrait ? (
              <button type="button" className="hportrait" aria-expanded={portraitOpen} aria-controls="portrait-panel"
                aria-label={`Changer le portrait de ${c.name}`} title="Changer le portrait" onClick={() => setPortraitOpen(o => !o)}>
                {face}
                <span className="hp-cam" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                </span>
              </button>
            ) : <span className="hportrait static">{face}</span>}
            <span>{c.name}</span>
          </h2>
          <div className="line">
            Niv. <span className="num">{c.level}</span> · <span className="cls">{c.cls || "Classe ?"}</span> · {c.race || "Race ?"}
            {race && ` · ${race.faction}`}{c.owner && ` · Joueur : ${c.owner}`}
          </div>
          {editable && <SyncLine at={c.addonSyncedAt} />}
        </div>
        <div className="row">
          {!editable && <span className="tag warn">Lecture seule</span>}
          {roles.map(r => <span key={r} className={`role ${r}`}>{r}</span>)}
        </div>
      </div>
      {canPortrait && portraitOpen && (
        <div className="portrait-panel" id="portrait-panel">
          <ImageUpload title="Portrait du perso" hint="Une capture de la tête de ton perso en jeu (PNG, JPEG ou WebP), recadrée en 200 × 200. Visible par les membres de tes groupes."
            currentId={c.portraitId} round
            onUpload={async blob => { const r = await uploadImage<{ portraitId: string }>(`/characters/${c.id}/portrait`, blob); onPortrait!(r.portraitId); setPortraitOpen(false); }}
            onRemove={async () => { await del(`/characters/${c.id}/portrait`); onPortrait!(null); }} />
          <button type="button" className="btn sm ghost" onClick={() => setPortraitOpen(false)}>Fermer</button>
        </div>
      )}
      {subhead}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => pick(k)}>{l}{k === "legacy" && <span className="tag gold tab-tag">Aperçu</span>}</button>)}
      </div>
      <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="pane">
          {tab === "profil" && <Profil c={c} onChange={onChange} editable={editable} />}
          {tab === "metiers" && <Metiers c={c} onChange={onChange} editable={editable} />}
          {tab === "stuff" && <Paperdoll c={c} onChange={onChange} editable={editable} />}
          {tab === "legacy" && <LegacyTab c={c} onChange={onChange} />}
        </div>
      </fieldset>
      {footer && <div className="foot">{footer}</div>}
    </section>
  );
}

type SubProps = { c: Character; onChange: EditorProps["onChange"]; editable?: boolean; onPortrait?: EditorProps["onPortrait"] };

function Profil({ c, onChange, editable }: SubProps) {
  const cl = CLASSES[c.cls as ClassName];
  const race = RACES[c.race];
  const classes = race ? race.classes : (Object.keys(CLASSES) as ClassName[]);
  const bad = !!(c.race && c.cls && !isValidCombo(c.race, c.cls));
  const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? [];
  const avail = talentPointsAt(c.level);
  const slug = cl?.slug ?? "warrior";
  const [view, setView] = useViewPref<TreeView>("trees", "gauges", ["gauges", "grid"]);
  const tdata = useTalentData(c.cls, !!cl);
  const talents = tdata.data?.talents ?? [];

  const setClass = (cls: string) => {
    const sp: readonly string[] = CLASSES[cls as ClassName]?.specs ?? [];
    onChange({ cls, spec1: sp.includes(c.spec1) ? c.spec1 : "", spec2: sp.includes(c.spec2) ? c.spec2 : "" });
  };
  const setRace = (r: string) => {
    const ok = !c.cls || isValidCombo(r, c.cls);
    onChange(ok ? { race: r } : { race: r, cls: "", spec1: "", spec2: "" });
  };

  return (
    <>
      <div className="sec">
        <h3>Identité</h3>
        <div className="grid">
          <div className="fld"><label htmlFor="f-name">Nom</label><input id="f-name" type="text" maxLength={40} value={c.name} onChange={e => onChange({ name: e.target.value })} /></div>
          <div className="fld"><label htmlFor="f-level">Niveau</label><NumberField id="f-level" min={1} max={60} value={c.level} onChange={level => onChange({ level })} /></div>
          <div className="fld"><label htmlFor="f-race">Race</label>
            <select id="f-race" value={c.race} onChange={e => setRace(e.target.value)}>
              <option value="">Choisir…</option>
              {RACE_NAMES.map(r => <option key={r} value={r}>{r} ({RACES[r]!.faction})</option>)}
            </select>
          </div>
          <div className="fld"><label htmlFor="f-cls">Classe</label>
            <select id="f-cls" value={c.cls} onChange={e => setClass(e.target.value)}>
              <option value="">Choisir…</option>
              {classes.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        </div>
        {bad && <div className="warnmsg">{c.race} ne peut pas être {c.cls} dans WoW Forever.</div>}
        {race && <div className="bonus"><span className="lbl">Raciaux {c.race}</span><br />{race.racials}</div>}
      </div>

      <div className="sec" style={{ ["--cc" as string]: cl?.color ?? "var(--gold)" }}>
        <div className="row between" style={{ alignItems: "baseline" }}>
          <h3>Talents <small><span className="num">{avail}</span> point{avail > 1 ? "s" : ""} disponible{avail > 1 ? "s" : ""} au niv. {c.level} · 51 au niv. 60</small></h3>
          {cl && talents.length > 0 && (
            <div className="seg" role="group" aria-label="Affichage des arbres">
              {([["gauges", "Jauges"], ["grid", "Arbres"]] as const).map(([k, l]) => (
                <button key={k} type="button" className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {!cl && <p className="hint">Choisis une classe pour afficher les spés et les arbres.</p>}
        {cl && editable && (
          <BuildImport cls={c.cls} avail={avail}
            onApply={(which, link, split) => onChange(which === "main" ? { talentLink: link, talents: split } : { talentLink2: link, talents2: split })} />
        )}
        {cl && (
          <div className={`builds${view === "gauges" ? " two" : ""}`}>
            <Build id="main" title="Spé principale" view={view} tree={talents} nodes={c.talentNodes} cls={c.cls} specs={specs} spec={c.spec1} talents={c.talents} link={c.talentLink} avail={avail} level={c.level}
              onChange={p => onChange({ ...(p.spec !== undefined && { spec1: p.spec }), ...(p.talents !== undefined && { talents: p.talents }), ...(p.link !== undefined && { talentLink: p.link }) })} />
            <Build id="off" title="Off-spec" view={view} tree={talents} cls={c.cls} specs={specs} spec={c.spec2} talents={c.talents2} link={c.talentLink2} avail={avail} level={c.level}
              onChange={p => onChange({ ...(p.spec !== undefined && { spec2: p.spec }), ...(p.talents !== undefined && { talents2: p.talents }), ...(p.link !== undefined && { talentLink2: p.link }) })} />
          </div>
        )}
        <div className="row">
          <a className="btn sm ghost" href={`https://foreverchanges.pro/talents/${slug}`} target="_blank" rel="noopener noreferrer">Calculateur de talents</a>
          <a className="btn sm ghost" href={`https://foreverchanges.pro/class/${slug}`} target="_blank" rel="noopener noreferrer">Changements de classe</a>
        </div>
      </div>
    </>
  );
}

const ROLES: Role[] = ["Tank", "Heal", "DPS"];

/** Un build : intitulé de spé (avec son rôle), répartition des points, lien vers le calculateur et arbres. */
function Build({ id, title, view, tree: treeTalents, nodes, cls, specs, spec, talents, link, avail, level, onChange }: {
  id: string; title: string; view: TreeView; tree: Talent[]; nodes?: Character["talentNodes"];
  cls: string; specs: readonly SpecDef[]; spec: string; talents: string; link: string; avail: number; level: number;
  onChange: (p: { spec?: string; talents?: string; link?: string }) => void;
}) {
  const cl = CLASSES[cls as ClassName];
  const def = specDef(cls, spec);
  const split = (talents || "0/0/0").split("/").map(n => parseInt(n, 10) || 0);
  const total = split.reduce((a, b) => a + b, 0);
  const parsed = link ? parseTalentLink(link) : null;
  // Rangs talent par talent : le lien du calculateur s'il est de cette classe, sinon le dernier export de l'addon
  const linkOk = parsed?.ok && parsed.cls === cls;
  const ranks = view === "grid" && treeTalents.length
    ? ranksFrom(treeTalents, linkOk ? { blocks: parsed.blocks } : { nodes: nodes?.map(n => ({ id: n.id, rank: n.rank })) })
    : null;
  /** Lien collé : la répartition suit automatiquement s'il vient du calculateur pour cette classe. */
  const setLink = (value: string) => {
    const r = parseTalentLink(value);
    onChange(r.ok && r.cls === cls ? { link: value, talents: r.split } : { link: value });
  };
  return (
    <div className="build">
      <div className="build-head">
        <h4 className="with-icon">{def && <SpecIcon cls={cls} spec={spec} size={26} />}<span>{title}</span></h4>
        {def && <span className={`role ${def.role}`}>{def.role}</span>}
      </div>
      <div className="grid">
        <div className="fld"><label htmlFor={`f-spec-${id}`}>Intitulé de la spé</label>
          <select id={`f-spec-${id}`} value={spec} onChange={e => onChange({ spec: e.target.value })}>
            <option value="">—</option>
            {ROLES.map(r => {
              const list = specs.filter(d => d.role === r);
              return list.length ? <optgroup key={r} label={r}>{list.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}</optgroup> : null;
            })}
          </select>
        </div>
        <div className="fld"><label htmlFor={`f-tal-${id}`}>Répartition</label>
          <input id={`f-tal-${id}`} className="num" type="text" placeholder="ex. 9/37/5" pattern="\d{1,2}/\d{1,2}/\d{1,2}" value={talents} onChange={e => onChange({ talents: e.target.value })} />
        </div>
        <div className="fld" style={{ gridColumn: "1 / -1" }}><label htmlFor={`f-link-${id}`}>Lien du build</label>
          <input id={`f-link-${id}`} type="url" placeholder={`https://foreverchanges.pro/talents/${cl?.slug ?? ""}…`} value={link} onChange={e => setLink(e.target.value)} />
        </div>
      </div>
      {parsed?.ok && parsed.cls && parsed.cls !== cls && <div className="warnmsg">Ce lien est un build {parsed.cls} : la répartition n'a pas été reprise.</div>}
      {cl && <TalentTrees cls={cls} points={split} mainTree={def?.tree} view={view} ranks={ranks} talents={treeTalents} />}
      {view === "grid" && treeTalents.length > 0 && !ranks && (
        <div className="hint">{linkOk ? "Ce lien ne correspond pas aux arbres actuels de Forever (build d'une ancienne version ?)." : "Colle le lien du calculateur, ou importe tes talents depuis l'addon, pour voir l'arbre talent par talent."}</div>
      )}
      <div className="row small">
        <span className="muted">Total <span className="num">{total}</span>/51</span>
        {/^https:\/\//.test(link) && <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">Ouvrir le build</a>}
      </div>
      {total > avail && (avail < 51 && total <= 51
        ? <div className="hint">Ce build compte {total} points, mais le perso est niveau {level} ({avail} point{avail > 1 ? "s" : ""}) : pense à mettre à jour son niveau dans « Identité ».</div>
        : <div className="warnmsg">{total} points au total : le maximum est de 51 au niveau 60.</div>)}
    </div>
  );
}

/** Coller un lien du calculateur : répartition détectée, erreurs signalées, puis application à l'une des deux spés. */
function BuildImport({ cls, avail, onApply }: { cls: string; avail: number; onApply: (which: "main" | "off", link: string, split: string) => void }) {
  const [value, setValue] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const r = value.trim() ? parseTalentLink(value) : null;
  const trees = CLASSES[cls as ClassName]?.trees ?? [];
  let problem: string | null = null, info: string | null = null;
  if (r?.ok) {
    const total = r.points.reduce((a, b) => a + b, 0);
    if (r.cls !== cls) problem = `Ce build est pour la classe ${r.cls ?? "inconnue"}, ce perso est ${cls}.`;
    else if (total > avail) problem = `${total} points : c'est plus que les ${avail} disponibles à ce niveau.`;
    else info = total < avail ? `${avail - total} point${avail - total > 1 ? "s" : ""} non dépensé${avail - total > 1 ? "s" : ""} (${total}/${avail}).` : `Build complet : ${total}/${avail} points.`;
  }
  const top = r?.ok ? r.points.indexOf(Math.max(...r.points)) : -1;
  const apply = (which: "main" | "off") => {
    if (!r?.ok || problem) return;
    onApply(which, value.trim(), r.split);
    setDone(`Build appliqué à ${which === "main" ? "la spé principale" : "l'off-spec"}.`); setValue("");
  };
  return (
    <div className="bimport">
      <label htmlFor="f-import">Importer un build ForeverChanges</label>
      <input id="f-import" type="url" placeholder="Colle ici le lien copié depuis le calculateur de talents…" value={value}
        onChange={e => { setValue(e.target.value); setDone(null); }} />
      {done && !value && <div className="okmsg" role="status">{done}</div>}
      {r && (
        <div className={`bi-result ${r.ok && !problem ? "ok" : "bad"}`} aria-live="polite">
          {!r.ok ? <span className="bi-msg bad">{r.error}</span> : (
            <>
              <div className="bi-head">
                <span className="num bi-split">{r.points.map((p, i) => <b key={i} className={i === top && p ? "top" : ""}>{i ? "/" : ""}{p}</b>)}</span>
                {r.cls && trees[top] && r.cls === cls && <span>arbre principal <strong>{trees[top]}</strong></span>}
              </div>
              {problem && <span className="bi-msg bad">{problem}</span>}
              {info && <span className="bi-msg ok">{info}</span>}
              <div className="row">
                <button type="button" className="btn sm primary" disabled={!!problem} onClick={() => apply("main")}>Appliquer à la spé principale</button>
                <button type="button" className="btn sm" disabled={!!problem} onClick={() => apply("off")}>Appliquer à l'off-spec</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProfCard({ k, p, other, onSet, characterId, editable }: { k: string; p: Prof; other: string; onSet: (p: Prof) => void; characterId: string; editable: boolean }) {
  const pair = p.name && PROFESSION_PAIRS.some(([a, b]) => (a === p.name && b === other) || (b === p.name && a === other));
  return (
    <div className="prof">
      <div className="two">
        <div className="fld"><label htmlFor={`${k}-n`}>Métier principal</label>
          <select id={`${k}-n`} value={p.name} onChange={e => onSet({ ...p, name: e.target.value })}><option value="">—</option>{Object.keys(PRIMARY_PROFESSIONS).map(n => <option key={n}>{n}</option>)}</select>
        </div>
        <div className="fld"><label htmlFor={`${k}-s`}>Compétence</label>
          <NumberField id={`${k}-s`} min={0} max={300} step={5} value={p.skill} onChange={skill => onSet({ ...p, skill })} />
        </div>
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <div style={{ ["--cc" as string]: "var(--gold)" }}><Bar pct={p.skill / 3} /></div>
        <div className="row between small"><span className="tier">{professionTier(p.skill)}</span><span className="num muted">{p.skill}/300</span></div>
      </div>
      {p.name && <div className="bonus">{PRIMARY_PROFESSIONS[p.name]}</div>}
      {pair && <div className="okmsg">Paire récolte + artisanat cohérente avec {other}.</div>}
      {CRAFTING.has(p.name) && <RecipeCard key={p.name} characterId={characterId} profession={p.name} skill={p.skill} editable={editable} />}
    </div>
  );
}

function Metiers({ c, onChange, editable = false }: SubProps) {
  const pr = c.professions;
  const set = (patch: Partial<Character["professions"]>) => onChange({ professions: { ...pr, ...patch } });
  return (
    <>
      <div className="sec">
        <h3>Métiers principaux <small>Apprenti 75 · Compagnon 150 · Expert 225 · Artisan 300</small></h3>
        <div className="profs">
          <ProfCard k="p1" p={pr.prof1} other={pr.prof2.name} onSet={p => set({ prof1: p })} characterId={c.id} editable={editable} />
          <ProfCard k="p2" p={pr.prof2} other={pr.prof1.name} onSet={p => set({ prof2: p })} characterId={c.id} editable={editable} />
        </div>
      </div>
      <div className="sec">
        <h3>Métiers secondaires</h3>
        <div className="profs">
          {(Object.keys(SECONDARY_PROFESSIONS) as (keyof typeof SECONDARY_PROFESSIONS)[]).map(k => (
            <div className="prof" key={k}>
              <div className="two">
                <div className="fld"><span className="lbl">{SECONDARY_PROFESSIONS[k].name}</span><span className="tier">{professionTier(pr[k])}</span></div>
                <div className="fld"><label htmlFor={`sec-${k}`}>Compétence</label>
                  <NumberField id={`sec-${k}`} min={0} max={300} step={5} value={pr[k]} onChange={v => set({ [k]: v })} />
                </div>
              </div>
              <div style={{ ["--cc" as string]: "var(--gold)" }}><Bar pct={pr[k] / 3} /></div>
              <div className="bonus">{SECONDARY_PROFESSIONS[k].bonus}</div>
              {CRAFTING.has(SECONDARY_PROFESSIONS[k].name) && <RecipeCard characterId={c.id} profession={SECONDARY_PROFESSIONS[k].name} skill={pr[k]} editable={editable} />}
            </div>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>Nouveau dans Forever : chaque métier a 3 objets de camp qui donnent un buff horaire. Le premier se débloque à 20 de compétence.</p>
      </div>
    </>
  );
}

function LegacyTab({ c, onChange }: SubProps) {
  const setTree = (k: string, list: { name: string; rank: number; max: number }[]) => onChange({ legacy: { ...c.legacy, [k]: list } });
  return (
    <>
      <div className="sec">
        <h3>Legacy <small>21 perks connus, 6 encore cachés</small></h3>
        <div className="alert info">Section en aperçu : le système Legacy sera précisé à la prochaine phase de la bêta, et cette page sera complétée à ce moment-là. Tes notes sont bien enregistrées en attendant.</div>
        <div className="trees">
          {LEGACY_TREES.map(t => {
            const list = c.legacy[t.key] ?? [];
            return (
              <div className="tree" key={t.key}>
                <h4>{t.name}</h4><p className="hint" style={{ margin: 0 }}>{t.desc}</p>
                {list.map((p, i) => (
                  <div className="perk" key={i}>
                    <input type="text" aria-label="Nom du perk" placeholder="Nom du perk" maxLength={60} value={p.name} onChange={e => setTree(t.key, list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                    <NumberField label="Rang" stepper={false} min={0} max={10} value={p.rank} onChange={rank => setTree(t.key, list.map((x, j) => j === i ? { ...x, rank } : x))} />
                    <NumberField label="Rang max" stepper={false} min={1} max={10} value={p.max} onChange={max => setTree(t.key, list.map((x, j) => j === i ? { ...x, max } : x))} />
                    <button type="button" className="x" aria-label="Retirer ce perk" onClick={() => setTree(t.key, list.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button" className="btn sm ghost" onClick={() => setTree(t.key, [...list, { name: "", rank: 0, max: 5 }])}>+ Perk</button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="sec">
        <h3>Notes</h3>
        <textarea aria-label="Notes" maxLength={5000} placeholder="Objectifs, route de leveling, rôle en raid…" value={c.notes} onChange={e => onChange({ notes: e.target.value })} />
      </div>
    </>
  );
}

/**
 * Dernière synchro de l'addon (lot F) : la mise à jour se fait par Ctrl+V sur n'importe quelle page,
 * la fiche rappelle seulement comment et depuis quand.
 */
function SyncLine({ at }: { at?: string | null }) {
  const age = syncAge(at);
  return (
    <div className={`ce-sync${age.stale ? " stale" : ""}`}>
      {at
        ? <><b>Addon</b> · {age.text} · en jeu : ta touche, Ctrl+C, puis Ctrl+V ici</>
        : <><b>Addon</b> · jamais synchronisé · <Link to="/addon">installer et synchroniser</Link></>}
    </div>
  );
}
