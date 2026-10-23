import { CLASS_SPECS, CLASSES, isValidCombo, RACE_NAMES, RACES, roleOf, type ClassName, type SpecDef } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, post, put, uploadImage, type Character, type GroupSummary } from "../api";
import { EDITOR_TAB_SLUG, editorTabFromSlug, LegacyTab, Metiers, TalentsSection, type EditorTab } from "../components/CharacterEditor";
import { ClassIcon, SpecIcon } from "../components/Icons";
import { ImageUpload, Portrait } from "../components/ImageUpload";
import { NumberField } from "../components/NumberField";
import { Paperdoll } from "../components/Paperdoll";
import { MyAbsences } from "../components/Absences";
import { ClassSpecPicker } from "../components/ClassSpecPicker";
import { useGameText } from "../gameText";
import { syncAge } from "../addonImport";
import { useAutosave } from "./CharactersPage";

/**
 * Mes persos de Forever (refonte du 23/10) : la liste, puis la fiche. Au bureau, la fiche du perso choisi s'ouvre à droite ;
 * sur téléphone, deux écrans (/persos, puis /persos/:id avec « ← Mes persos »). L'essentiel tient en deux lignes (nom,
 * niveau, race, classe ; spé, off-spec, guilde, main ou alt) ; les talents, que l'addon remplit, sont repliés.
 * « + Ajouter un perso » : /persos/nouveau, nom, classe et spé. Roster (WoW Retail) garde CharactersPage.
 */

const TABS: [EditorTab, string][] = [["profil", "Profil"], ["metiers", "Métiers"], ["stuff", "Équipement"], ["legacy", "Notes"]];
const errorOf = (e: unknown, def: string) => (e instanceof ApiError ? e.message : def);

export function MyCharsPage() {
  const qc = useQueryClient();
  const params = useParams();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const groups = (useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups") }).data?.groups ?? []).map(g => ({ id: g.id, name: g.name }));
  const [local, setLocal] = useState<Character[]>([]);
  // Copie locale en cours d'édition ; la guilde (main / alt) vient toujours du serveur ; une fiche modifiée ailleurs la remplace
  useEffect(() => { if (data) setLocal(prev => data.characters.map(sc => { const p = prev.find(x => x.id === sc.id); return !p || p.updatedAt !== sc.updatedAt ? sc : { ...p, group: sc.group }; })); }, [data]);
  const creating = params.charId === "nouveau";
  const picked = !creating && params.charId && local.some(c => c.id === params.charId) ? params.charId : null;
  const sel = picked ?? local[0]?.id ?? null;
  const tab = editorTabFromSlug(params.tab);
  const urlFor = (id: string, t: EditorTab = "profil") => `/persos/${id}${t === "profil" ? "" : `/${EDITOR_TAB_SLUG[t]}`}`;
  const current = local.find(c => c.id === sel) ?? null;
  const saver = useAutosave(current?.id ?? null, saved => {
    qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: d.characters.map(c => (c.id === saved.id ? saved : c)) });
    void qc.invalidateQueries({ queryKey: ["week"] });
  });
  const edit = (p: Partial<Character>) => {
    if (!current) return;
    setLocal(list => list.map(c => (c.id === current.id ? { ...c, ...p } : c)));
    saver.queue(p);
  };

  if (isLoading) return <p className="muted">Chargement…</p>;
  const head = (
    <div className="page-head">
      <div className="ph-t"><span className="eyebrow">Roster personnel</span><h1>Mes persos</h1></div>
      {!creating && local.length > 0 && <div className="row ph-acts"><Link className="btn primary" to="/persos/nouveau">+ Ajouter un perso</Link></div>}
    </div>
  );
  if (creating || !local.length) return (
    <div className="stack" style={{ gap: 16 }}>
      {local.length > 0 ? <Link className="mp-back" to={sel ? urlFor(sel) : "/persos"}>← Mes persos</Link> : head}
      <NewChar first={!local.length} onCreated={c => { qc.setQueryData<{ characters: Character[] }>(["characters"], d => ({ characters: [...(d?.characters ?? []), c] })); void qc.invalidateQueries({ queryKey: ["week"] }); nav(urlFor(c.id), { replace: true }); }} />
    </div>
  );
  return (
    <div className={`stack mp-page${picked ? " has-sel" : ""}`} style={{ gap: 16 }}>
      {head}
      <div className={`mp${picked ? " has-sel" : ""}`}>
        <div className="mp-list">
          {local.map(c => <CharCard key={c.id} c={c} current={c.id === sel} onClick={() => nav(urlFor(c.id, picked ? tab : "profil"))} />)}
          <MyAbsences />
        </div>
        {current && (
          <div className="stack mp-sheet" style={{ gap: 12 }}>
            <Link className="mp-back mp-phone" to="/persos">← Mes persos</Link>
            <CharSheet key={current.id} c={current} groups={groups} tab={tab} onTab={t => nav(urlFor(current.id, t))} onChange={edit} status={saver.status}
              onPortrait={portraitId => {
                setLocal(list => list.map(c => (c.id === current.id ? { ...c, portraitId } : c)));
                qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: d.characters.map(c => (c.id === current.id ? { ...c, portraitId } : c)) });
              }}
              onDeleted={() => { nav("/persos", { replace: true }); void Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["week"] })]); }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Carte d'un perso dans la liste : niveau, main (★), nom ; classe et spés ; « À compléter » sans classe ou sans spé. */
function CharCard({ c, current, onClick }: { c: Character; current: boolean; onClick: () => void }) {
  const t = useGameText();
  const specs = [c.spec1, c.spec2].filter(Boolean).map(s => t.spec(c.cls, s)).join(" / ");
  return (
    <button type="button" className="card" aria-current={current ? "true" : "false"} style={{ "--cc": t.color(c.cls) ?? "var(--line-2)" } as CSSProperties} onClick={onClick}>
      <span className="cav" aria-hidden="true">
        <Portrait id={c.portraitId} size={42} className="round"
          fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={30} /> : <ClassIcon cls={c.cls} size={30} />) : <span className="muted">?</span>} />
      </span>
      <span className="nm"><span className="lvl-pill num" title={`Niveau ${c.level}`}>{c.level}</span>{c.group?.isMain && <span className="gm-star" title={`Main dans ${c.group.name}`}>★</span>}{c.name}</span>
      {!c.cls || !c.spec1 ? <span className="tag warn">À compléter</span> : <span />}
      <span className="sub">{[t.cls(c.cls) || "Classe ?", specs || "pas de spé"].join(" · ")}</span>
    </button>
  );
}

/* ---------- Fiche ---------- */

type Status = { kind: "idle" | "saving" | "saved" | "error" | "held"; msg?: string };

function CharSheet({ c, groups, tab, onTab, onChange, status, onPortrait, onDeleted }: {
  c: Character; groups: { id: string; name: string }[]; tab: EditorTab; onTab: (t: EditorTab) => void; onChange: (p: Partial<Character>) => void;
  status: Status; onPortrait: (id: string | null) => void; onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const [portrait, setPortrait] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const color = gt.color(c.cls) ?? "var(--gold)";
  const age = syncAge(c.addonSyncedAt);
  const face = <Portrait id={c.portraitId} size={44} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={34} /> : <ClassIcon cls={c.cls} size={34} />) : <span className="muted">?</span>} />;
  /** Guilde du perso (une seule, ou aucune) ; main : il passe en tête pour les inscriptions. */
  const moveTo = async (to: string, main = false) => {
    setErr(null);
    try {
      if (to) await put(`/groups/${to}/characters/${c.id}`, { assigned: true, ...(main && { main: true }) });
      else if (c.group) await put(`/groups/${c.group.id}/characters/${c.id}`, { assigned: false });
    } catch (e) { setErr(errorOf(e, "Changement impossible.")); }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["group-chars"] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
  };
  const remove = async () => {
    try { await del(`/characters/${c.id}`); onDeleted(); } catch (e) { setErr(errorOf(e, "Suppression impossible.")); }
  };
  const saveText = { idle: null, saving: "Enregistrement…", saved: "Enregistré ✓", error: status.msg, held: status.msg }[status.kind];
  return (
    <section className="panel lift fi" style={{ "--cc": color } as CSSProperties} aria-label={`Fiche de ${c.name}`}>
      <div className="fi-head">
        <button type="button" className="fi-face" aria-expanded={portrait} aria-label={`Changer le portrait de ${c.name}`} title="Changer le portrait" onClick={() => setPortrait(o => !o)}>{face}</button>
        <div style={{ minWidth: 0 }}>
          <h2>{c.name}</h2>
          <div className="sub">Niv. {c.level} · <b className={`cn${c.cls === "Shaman" ? " sha" : ""}`}>{gt.cls(c.cls) || "Classe ?"}</b>{c.race && ` · ${c.race}`}{c.group && ` · ${c.group.name}${c.group.isMain ? " (main)" : ""}`}</div>
        </div>
        <div className="fi-state">
          {c.addonSyncedAt ? <span className={age.stale ? "warnmsg" : "ok-t"}>{age.text}</span> : <Link className="link" to="/addon">Pas encore synchronisé · l'addon</Link>}
          {saveText && <span className={status.kind === "error" || status.kind === "held" ? "warnmsg" : undefined} role="status">{saveText}</span>}
        </div>
      </div>
      {portrait && (
        <div className="portrait-panel">
          <ImageUpload title="Portrait du perso" hint="Une capture de la tête de ton perso en jeu, recadrée en 200 × 200. Visible par tes guildes." currentId={c.portraitId} round
            onUpload={async blob => { const r = await uploadImage<{ portraitId: string }>(`/characters/${c.id}/portrait`, blob); onPortrait(r.portraitId); setPortrait(false); }}
            onRemove={async () => { await del(`/characters/${c.id}/portrait`); onPortrait(null); }} />
          <button type="button" className="btn sm ghost" onClick={() => setPortrait(false)}>Fermer</button>
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => onTab(k)}>{l}</button>)}
      </div>
      {tab === "profil" ? (
        <div className="fi-body">
          <Essentials c={c} groups={groups} onChange={onChange} onGroup={to => void moveTo(to)} onMain={() => c.group && void moveTo(c.group.id, true)} />
          {err && <div className="alert error" role="alert">{err}</div>}
          <details className="fi-fold">
            <summary><h3>Talents</h3><span className="muted">{talentsLine(c)}</span></summary>
            <div className="fi-fold-in"><TalentsSection c={c} onChange={onChange} editable folded /></div>
          </details>
          <div className="fi-foot">
            {confirmDel
              ? <span className="row small">Supprimer {c.name} ? <button className="btn danger sm" type="button" onClick={() => void remove()}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>
              : <button type="button" className="btn ghost sm" onClick={() => setConfirmDel(true)}>Supprimer le perso</button>}
          </div>
        </div>
      ) : (
        <div className="pane">
          {tab === "metiers" && <Metiers c={c} onChange={onChange} editable />}
          {tab === "stuff" && <Paperdoll c={c} onChange={onChange} editable />}
          {tab === "legacy" && <LegacyTab c={c} onChange={onChange} />}
        </div>
      )}
    </section>
  );
}

/** « Protection 5/5/41 · Fury 31/20/0 · remplis par l'addon » */
function talentsLine(c: Character) {
  const parts = [c.spec1 && c.talents ? `${c.spec1} ${c.talents}` : null, c.spec2 && c.talents2 ? `${c.spec2} ${c.talents2}` : null].filter(Boolean);
  const src = c.talentNodes?.length ? "remplis par l'addon" : "remplis par l'addon à la prochaine synchro";
  return [...parts, parts.length && !c.talentNodes?.length ? null : src].filter(Boolean).join(" · ");
}

/** L'essentiel en deux lignes : nom, niveau, race, classe ; spé, off-spec, guilde, main ou alt. */
function Essentials({ c, groups, onChange, onGroup, onMain }: {
  c: Character; groups: { id: string; name: string }[]; onChange: (p: Partial<Character>) => void; onGroup: (to: string) => void; onMain: () => void;
}) {
  const gt = useGameText();
  const race = RACES[c.race];
  const classes = race ? race.classes : (Object.keys(CLASSES) as ClassName[]);
  const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? [];
  const bad = !!(c.race && c.cls && !isValidCombo(c.race, c.cls));
  const setClass = (cls: string) => {
    const sp: readonly string[] = CLASSES[cls as ClassName]?.specs ?? [];
    onChange({ cls, spec1: sp.includes(c.spec1) ? c.spec1 : "", spec2: sp.includes(c.spec2) ? c.spec2 : "" });
  };
  const setRace = (r: string) => onChange(!c.cls || isValidCombo(r, c.cls) ? { race: r } : { race: r, cls: "", spec1: "", spec2: "" });
  const role = (s: string) => { const r = roleOf(s); return r ? <span className={`role xs ${r}`}>{r}</span> : null; };
  const specSelect = (id: string, label: string, value: string, key: "spec1" | "spec2", empty: string) => (
    <div className="fld"><label htmlFor={id}>{label}</label>
      <div className="sel-role">
        <select id={id} value={value} onChange={e => onChange({ [key]: e.target.value })} disabled={!c.cls} className={key === "spec1" && c.cls && !value ? "need" : undefined}>
          <option value="">{empty}</option>
          {specs.map(s => <option key={s.name} value={s.name}>{gt.spec(c.cls, s.name)}</option>)}
        </select>{value && role(value)}
      </div>
    </div>
  );
  return (
    <>
      <div className="fi-grid">
        <div className="fld"><label htmlFor="f-name">Nom</label><input id="f-name" type="text" maxLength={40} value={c.name} onChange={e => onChange({ name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="f-level">Niveau</label><NumberField id="f-level" min={1} max={60} value={c.level} onChange={level => onChange({ level })} /></div>
        <div className="fld"><label htmlFor="f-race">Race</label>
          <select id="f-race" value={c.race} onChange={e => setRace(e.target.value)}>
            <option value="">Choisir…</option>
            {RACE_NAMES.map(r => <option key={r} value={r}>{r}</option>)}
          </select></div>
        <div className="fld"><label htmlFor="f-cls">Classe</label>
          <select id="f-cls" value={c.cls} onChange={e => setClass(e.target.value)} className={!c.cls ? "need" : undefined}>
            <option value="">Choisir…</option>
            {classes.map(k => <option key={k} value={k}>{gt.cls(k)}</option>)}
          </select></div>
        {specSelect("f-spec", "Spé", c.spec1, "spec1", "Choisir…")}
        {specSelect("f-off", "Off-spec", c.spec2, "spec2", "Aucune")}
        <div className="fld"><label htmlFor="f-guild">Guilde</label>
          <select id="f-guild" value={c.group?.id ?? ""} onChange={e => onGroup(e.target.value)}>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="">Aucune</option>
          </select></div>
        <div className="fld"><span className="lbl">Dans la guilde</span>
          <div className="seg" role="group" aria-label="Main ou alt dans la guilde">
            <button type="button" className={c.group?.isMain ? "on" : ""} aria-pressed={!!c.group?.isMain} disabled={!c.group} onClick={() => { if (c.group && !c.group.isMain) onMain(); }}>★ Main</button>
            <button type="button" className={c.group && !c.group.isMain ? "on" : ""} aria-pressed={!!c.group && !c.group.isMain} disabled={!c.group || c.group.isMain}
              title={c.group?.isMain ? "Choisis un autre perso comme main pour passer celui-ci en alt" : undefined}>Alt</button>
          </div></div>
      </div>
      {bad && <p className="warnmsg" style={{ margin: 0 }}>{c.race} ne peut pas être {gt.cls(c.cls)} dans WoW Forever.</p>}
      {c.cls && !c.spec1 && <p className="hint warnmsg" style={{ margin: "-6px 0 0" }}>Il faut une spé pour s'inscrire aux raids et aux sorties.</p>}
    </>
  );
}

/* ---------- Nouveau perso : nom, classe, spé ---------- */

function NewChar({ first, onCreated }: { first: boolean; onCreated: (c: Character) => void }) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [cls, setCls] = useState<ClassName | "">("");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { onCreated((await post<{ character: Character }>("/characters", { name: name.trim(), level, cls, spec1: spec })).character); }
    catch (err) { setError(errorOf(err, "Création impossible.")); setBusy(false); }
  };
  return (
    <section className="wl-card panel lift" aria-labelledby="nc-t">
      <div className="wl-top"><h2 id="nc-t" style={{ fontSize: 26, color: "var(--gold)" }}>{first ? "Ton premier perso" : "Nouveau perso"}</h2></div>
      <form className="wl-form" onSubmit={e => void submit(e)}>
        <div className="wl-row">
          <div className="fld"><label htmlFor="nc-n">Nom du perso</label><input id="nc-n" type="text" required maxLength={40} autoFocus value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld wl-lv"><label htmlFor="nc-lv">Niveau</label><NumberField id="nc-lv" min={1} max={60} value={level} onChange={setLevel} /></div>
        </div>
        <ClassSpecPicker cls={cls} spec={spec} onCls={c => { setCls(c); setSpec(""); }} onSpec={setSpec} idPrefix="nc" />
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="wl-go">
          <button type="submit" className="btn primary wl-btn" disabled={busy || !name.trim() || !cls || !spec}>Créer le perso</button>
          <span className="hint">Talents, métiers et équipement viendront de l'addon.</span>
        </div>
      </form>
    </section>
  );
}
