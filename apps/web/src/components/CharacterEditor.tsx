import {
  CLASSES, LEGACY_TREES, PRIMARY_PROFESSIONS, PROFESSION_PAIRS, RACE_NAMES, RACES,
  SECONDARY_PROFESSIONS, CLASS_SPECS, isValidCombo, professionTier, roleOf, specDef, talentPointsAt, type ClassName, type Role, type SpecDef,
} from "@forever/game-data";
import { useState } from "react";
import type { Character, Prof } from "../api";
import { CRAFTING, RecipeCard } from "./GameData";
import { ClassIcon, SpecIcon } from "./Icons";
import { ImageUpload, Portrait } from "./ImageUpload";
import { del, uploadImage } from "../api";
import { Paperdoll } from "./Paperdoll";

type Tab = "profil" | "metiers" | "stuff" | "legacy";
const TABS: [Tab, string][] = [["profil", "Profil & talents"], ["metiers", "Métiers"], ["stuff", "Équipement"], ["legacy", "Legacy & notes"]];

export interface EditorProps {
  character: Character;
  editable: boolean;
  /** Reçoit uniquement les champs modifiés. */
  onChange: (patch: Partial<Character>) => void;
  footer?: React.ReactNode;
  /** Portrait changé (envoyé directement, hors sauvegarde automatique). */
  onPortrait?: (id: string | null) => void;
}

const Bar = ({ pct, color }: { pct: number; color?: string }) => (
  <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, ...(color ? { background: color } : {}) }} /></div>
);

export function CharacterEditor({ character: c, editable, onChange, footer, onPortrait }: EditorProps) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("fr-tab") as Tab) || "profil");
  const cl = CLASSES[c.cls as ClassName];
  const race = RACES[c.race];
  const roles = [...new Set([roleOf(c.spec1), roleOf(c.spec2)].filter(Boolean))];
  const pick = (t: Tab) => { setTab(t); sessionStorage.setItem("fr-tab", t); };

  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={`Fiche de ${c.name}`}>
      <div className="dhead" style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon">
            <Portrait id={c.portraitId} size={48} className="round head-portrait" fallback={c.cls ? <ClassIcon cls={c.cls} size={34} /> : null} />
            <span>{c.name}</span>
          </h2>
          <div className="line">
            Niv. <span className="num">{c.level}</span> · {c.race || "Race ?"} <span className="cls">{c.cls || "Classe ?"}</span>
            {race && ` · ${race.faction}`}{c.owner && ` · Joueur : ${c.owner}`}
          </div>
        </div>
        <div className="row">
          {!editable && <span className="tag warn">Lecture seule</span>}
          {roles.map(r => <span key={r} className={`role ${r}`}>{r}</span>)}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => pick(k)}>{l}{k === "legacy" && <span className="tag gold tab-tag">Aperçu</span>}</button>)}
      </div>
      <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="pane">
          {tab === "profil" && <Profil c={c} onChange={onChange} editable={editable} onPortrait={onPortrait} />}
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

function Profil({ c, onChange, editable, onPortrait }: SubProps) {
  const cl = CLASSES[c.cls as ClassName];
  const race = RACES[c.race];
  const classes = race ? race.classes : (Object.keys(CLASSES) as ClassName[]);
  const bad = !!(c.race && c.cls && !isValidCombo(c.race, c.cls));
  const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? [];
  const avail = talentPointsAt(c.level);
  const slug = cl?.slug ?? "warrior";

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
          <div className="fld"><label htmlFor="f-level">Niveau</label><input id="f-level" className="num" type="number" min={1} max={60} value={c.level} onChange={e => onChange({ level: Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)) })} /></div>
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

      {editable && onPortrait && (
        <div className="sec">
          <h3>Portrait</h3>
          <ImageUpload title="Tête du perso" hint="Une capture de ton perso en jeu (PNG, JPEG ou WebP), recadrée en 200 × 200. Visible par les membres de tes groupes."
            currentId={c.portraitId}
            onUpload={async blob => { const r = await uploadImage<{ portraitId: string }>(`/characters/${c.id}/portrait`, blob); onPortrait(r.portraitId); }}
            onRemove={async () => { await del(`/characters/${c.id}/portrait`); onPortrait(null); }} />
        </div>
      )}

      <div className="sec" style={{ ["--cc" as string]: cl?.color ?? "var(--gold)" }}>
        <h3>Talents <small><span className="num">{avail}</span> point{avail > 1 ? "s" : ""} disponible{avail > 1 ? "s" : ""} au niv. {c.level} · 51 au niv. 60</small></h3>
        {!cl && <p className="hint">Choisis une classe pour afficher les spés et les arbres.</p>}
        {cl && (
          <div className="builds">
            <Build id="main" title="Spé principale" cls={c.cls} specs={specs} spec={c.spec1} talents={c.talents} link={c.talentLink}
              onChange={p => onChange({ ...(p.spec !== undefined && { spec1: p.spec }), ...(p.talents !== undefined && { talents: p.talents }), ...(p.link !== undefined && { talentLink: p.link }) })} />
            <Build id="off" title="Off-spec" cls={c.cls} specs={specs} spec={c.spec2} talents={c.talents2} link={c.talentLink2}
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

/** Un build : intitulé de spé (avec son rôle), répartition des points et lien vers le calculateur. */
function Build({ id, title, cls, specs, spec, talents, link, onChange }: {
  id: string; title: string; cls: string; specs: readonly SpecDef[]; spec: string; talents: string; link: string;
  onChange: (p: { spec?: string; talents?: string; link?: string }) => void;
}) {
  const cl = CLASSES[cls as ClassName];
  const def = specDef(cls, spec);
  const split = (talents || "0/0/0").split("/").map(n => parseInt(n, 10) || 0);
  const total = split.reduce((a, b) => a + b, 0);
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
        <div className="fld"><label htmlFor={`f-tal-${id}`}>Répartition (ex. 9/37/5)</label>
          <input id={`f-tal-${id}`} className="num" type="text" placeholder="0/0/0" pattern="\d{1,2}/\d{1,2}/\d{1,2}" value={talents} onChange={e => onChange({ talents: e.target.value })} />
        </div>
        <div className="fld" style={{ gridColumn: "1 / -1" }}><label htmlFor={`f-link-${id}`}>Lien du build (https uniquement)</label>
          <input id={`f-link-${id}`} type="url" placeholder={`https://foreverchanges.pro/talents/${cl?.slug ?? ""}…`} value={link} onChange={e => onChange({ link: e.target.value })} />
        </div>
      </div>
      {cl && (
        <div className="stack" style={{ gap: 8 }}>
          {cl.trees.map((t, i) => (
            <div className={`trow${def?.tree === i ? " main" : ""}`} key={t}><span>{t}</span><Bar pct={(split[i] ?? 0) / 51 * 100} /><b>{split[i] ?? 0}</b></div>
          ))}
        </div>
      )}
      <div className="row small">
        <span className="muted">Total <span className="num">{total}</span>/51</span>
        {/^https:\/\//.test(link) && <a className="btn sm" href={link} target="_blank" rel="noopener noreferrer">Ouvrir le build</a>}
      </div>
      {total > 51 && <div className="warnmsg">{total} points au total : le maximum au niveau 60 est de 51.</div>}
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
          <input id={`${k}-s`} className="num" type="number" min={0} max={300} value={p.skill} onChange={e => onSet({ ...p, skill: Math.min(300, Math.max(0, parseInt(e.target.value, 10) || 0)) })} />
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
                  <input id={`sec-${k}`} className="num" type="number" min={0} max={300} value={pr[k]} onChange={e => set({ [k]: Math.min(300, Math.max(0, parseInt(e.target.value, 10) || 0)) })} />
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
                    <input type="number" className="num" aria-label="Rang" min={0} max={10} value={p.rank} onChange={e => setTree(t.key, list.map((x, j) => j === i ? { ...x, rank: Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0)) } : x))} />
                    <input type="number" className="num" aria-label="Rang max" min={1} max={10} value={p.max} onChange={e => setTree(t.key, list.map((x, j) => j === i ? { ...x, max: Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 1)) } : x))} />
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
