import { CLASS_SPECS, CLASSES, isValidCombo, RACE_NAMES, RACES, roleOf, type ClassName, type SpecDef } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, post, put, uploadImage, type Character, type GroupSummary } from "../api";
import { EDITOR_TAB_SLUG, editorTabFromSlug, LegacyTab, TalentsSection, type EditorTab } from "../components/CharacterEditor";
import { Professions } from "../components/Professions";
import { RoleIcon } from "../components/RoleIcon";
import { DialogHead, Modal } from "../components/Dialog";
import { ClassIcon, SpecIcon } from "../components/Icons";
import { ImageUpload, Portrait } from "../components/ImageUpload";
import { LockedLevel, LockIcon, levelLockText } from "../components/LevelLock";
import { NumberField } from "../components/NumberField";
import { Paperdoll } from "../components/Paperdoll";
import { ClassSpecPicker } from "../components/ClassSpecPicker";
import { GiveFicheDialog } from "../components/GiveFiche";
import { dayMonth } from "../guild";
import { useGameText } from "../gameText";
import { openSync, syncState } from "../syncPanel";
import { useAutosave } from "./CharactersPage";
import { N, t, tx } from "../i18n";

/**
 * Mes persos de Forever (refonte du 23/10) : la liste, puis la fiche. Au bureau, la fiche du perso choisi s'ouvre à droite ;
 * sur téléphone, deux écrans (/persos, puis /persos/:id avec « ← Mes persos »). L'essentiel tient en deux lignes (nom,
 * niveau, race, classe ; spé, off-spec, guilde, main ou alt) ; les talents, que l'addon remplit, sont repliés.
 * « + Ajouter un perso » : /persos/nouveau, nom, classe et spé. Roster (WoW Retail) garde CharactersPage.
 * L'ordre de la liste se change en glissant la poignée ⋮⋮ (ou flèches haut/bas) : il sert aussi sur l'Accueil.
 * Refonte du 09/11 (maquette-persos-modifier-le-profil.png) : plus d'onglet Profil ; l'en-tête montre l'identité en texte
 * (nom ; Niv. 60 · Druide · Tauren ; guilde · ★ main ; spé, off-spec, « Talents 31 / 20 / 0 › ») et l'état de la synchro ;
 * « ✎ Modifier le profil » déplie l'édition dans l'en-tête (identité, guilde, spé et off-spec en cartes, Ce perso), validée
 * par « Valider le profil ». Onglets Équipement (par défaut) · Métiers · Notes ; /persos/:id/profil ouvre l'édition.
 */

const TABS: [EditorTab, string][] = [["stuff", N("Équipement")], ["metiers", N("Métiers")], ["legacy", N("Notes")]];
const errorOf = (e: unknown, def: string) => (e instanceof ApiError ? e.message : def);

export function MyCharsPage() {
  const qc = useQueryClient();
  const params = useParams();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const groups = (useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups") }).data?.groups ?? []).map(g => ({ id: g.id, name: g.name }));
  const [local, setLocal] = useState<Character[]>([]);
  // Copie locale en cours d'édition ; la guilde (main / alt) et le verrou du niveau (relevé en jeu, fixé par un officier)
  // viennent toujours du serveur ; une fiche modifiée ailleurs la remplace
  useEffect(() => { if (data) setLocal(prev => data.characters.map(sc => { const p = prev.find(x => x.id === sc.id); return !p || p.updatedAt !== sc.updatedAt ? sc : { ...p, group: sc.group, levelLock: sc.levelLock }; })); }, [data]);
  const creating = params.charId === "nouveau";
  const picked = !creating && params.charId && local.some(c => c.id === params.charId) ? params.charId : null;
  const sel = picked ?? local[0]?.id ?? null;
  // Plus d'onglet Profil : Équipement par défaut, et /persos/:id/profil (anciens liens) ouvre « Modifier le profil »
  const rawTab = editorTabFromSlug(params.tab);
  const tab: EditorTab = rawTab === "profil" ? "stuff" : rawTab;
  const urlFor = (id: string, tt: EditorTab = "stuff") => `/persos/${id}${tt === "stuff" ? "" : `/${EDITOR_TAB_SLUG[tt]}`}`;
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { if (params.tab === "profil" && sel) setEditing(sel); }, [params.tab, sel]);
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
  /** Nouvel ordre de la liste : gardé sur le compte (et repris sur l'Accueil). */
  const saveOrder = async (ids: string[]) => {
    const sorted = <T extends { id: string }>(list: T[]) => ids.map(id => list.find(c => c.id === id)).filter((c): c is T => !!c);
    setLocal(sorted);
    qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: sorted(d.characters) });
    try { await put("/characters/order", { ids }); } catch { await qc.invalidateQueries({ queryKey: ["characters"] }); }
  };

  if (isLoading) return <p className="muted">{t("Chargement…")}</p>;
  const head = (
    <div className="page-head">
      <div className="ph-t"><span className="eyebrow">{t("Roster personnel")}</span><h1>{t("Mes persos")}</h1></div>
      {/* Pendant « Modifier le profil », un seul doré : celui de « Valider le profil » */}
      {!creating && local.length > 0 && <div className="row ph-acts">{editing
        ? <button type="button" className="btn primary" disabled title={t("Valide ou annule d'abord le profil en cours")}>{t("+ Ajouter un perso")}</button>
        : <Link className="btn primary" to="/persos/nouveau">{t("+ Ajouter un perso")}</Link>}</div>}
    </div>
  );
  if (creating || !local.length) return (
    <div className="stack" style={{ gap: 16 }}>
      {local.length > 0 ? <Link className="mp-back" to={sel ? urlFor(sel) : "/persos"}>{t("← Mes persos")}</Link> : head}
      <NewChar first={!local.length} onCreated={c => { qc.setQueryData<{ characters: Character[] }>(["characters"], d => ({ characters: [...(d?.characters ?? []), c] })); void qc.invalidateQueries({ queryKey: ["week"] }); nav(urlFor(c.id), { replace: true }); }} />
    </div>
  );
  return (
    <div className={`stack mp-page${picked ? " has-sel" : ""}`} style={{ gap: 16 }}>
      {head}
      <div className={`mp${picked ? " has-sel" : ""}`}>
        <div className="mp-list">
          <SortableChars items={local} onReorder={ids => void saveOrder(ids)}
            render={c => <CharCard c={c} current={c.id === sel} onClick={() => { setEditing(null); nav(urlFor(c.id, picked ? tab : "stuff")); }} />} />
        </div>
        {current && (
          <div className="stack mp-sheet" style={{ gap: 12 }}>
            <Link className="mp-back mp-phone" to="/persos">{t("← Mes persos")}</Link>
            <CharSheet key={current.id} c={current} groups={groups} tab={tab} onTab={tt => nav(urlFor(current.id, tt))} onChange={edit} status={saver.status}
              editing={editing === current.id} onEditing={on => { setEditing(on ? current.id : null); if (!on && params.tab === "profil") nav(urlFor(current.id), { replace: true }); }}
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

/**
 * Liste réordonnable à la souris, au doigt (pointer events) et au clavier : poignée ⋮⋮ à gauche de chaque carte,
 * flèches haut/bas quand elle a le focus. L'ordre n'est envoyé qu'au lâcher.
 */
function SortableChars({ items, render, onReorder }: { items: Character[]; render: (c: Character) => ReactNode; onReorder: (ids: string[]) => void }) {
  const [order, setOrder] = useState<string[]>(items.map(c => c.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ids = items.map(c => c.id).join();
  useEffect(() => { if (!dragging) setOrder(ids ? ids.split(",") : []); }, [ids, dragging]);
  const byId = new Map(items.map(c => [c.id, c]));
  const move = (id: string, delta: number) => {
    const i = order.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next); onReorder(next);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!dragging || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-id]")].filter(n => n.dataset.id !== dragging);
    const before = rows.find(n => { const r = n.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const rest = order.filter(id => id !== dragging);
    rest.splice(before ? rest.indexOf(before.dataset.id!) : rest.length, 0, dragging);
    if (rest.join() !== order.join()) setOrder(rest);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(null);
    if (order.join() !== ids) onReorder(order);
  };
  if (items.length < 2) return <>{items.map(c => <div key={c.id}>{render(c)}</div>)}</>;
  return (
    <div className="roster" ref={listRef} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
      {order.map(id => byId.get(id)).filter((c): c is Character => !!c).map(c => (
        <div key={c.id} data-id={c.id} className={`item${dragging === c.id ? " dragging" : ""}`}>
          <button type="button" className="grip" aria-label={t("Déplacer {name} (flèches haut/bas)", { name: c.name })} title={t("Glisser pour changer l'ordre (ou flèches haut/bas)")}
            onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDragging(c.id); }}
            onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); move(c.id, -1); } if (e.key === "ArrowDown") { e.preventDefault(); move(c.id, 1); } }}>⋮⋮</button>
          {render(c)}
        </div>
      ))}
    </div>
  );
}

/**
 * Carte d'un perso dans la liste (refonte du 09/11) : niveau, main (★), nom ; les spés sur la deuxième ligne, sans
 * troncature ; à droite l'âge de la synchro (« ● À jour · il y a 3 h », « ● Il y a 12 j », « ● Jamais ») ; « Spé à choisir »
 * en orange quand il manque la classe ou la spé.
 */
function CharCard({ c, current, onClick }: { c: Character; current: boolean; onClick: () => void }) {
  const gt = useGameText();
  const specs = [c.spec1, c.spec2].filter(Boolean).map(s => gt.spec(c.cls, s)).join(" · ");
  return (
    <button type="button" className="card" aria-current={current ? "true" : "false"} style={{ "--cc": gt.color(c.cls) ?? "var(--line-2)" } as CSSProperties} onClick={onClick}>
      <span className="cav" aria-hidden="true">
        <Portrait id={c.portraitId} size={42} className="round"
          fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={30} /> : <ClassIcon cls={c.cls} size={30} />) : <span>?</span>} />
      </span>
      <CardName c={c} />
      <SyncDot at={c.addonSyncedAt} />
      <span className={`sub${!c.cls || !c.spec1 ? " need" : ""}`}>{!c.cls || !c.spec1 ? t("Spé à choisir") : specs}</span>
    </button>
  );
}

/**
 * Nom sur la carte : texte qui coule (« ★ Tournicoti Tournicoton 36 »), l'étoile collée au premier mot et le niveau au
 * dernier, pour qu'un nom de Forever avec son nom de famille passe à la ligne entre deux mots, jamais l'étoile ou le
 * niveau seuls sur leur ligne.
 */
function CardName({ c }: { c: Character }) {
  const star = c.group?.isMain ? <span className="gm-star" title={t("Main dans {name}", { name: c.group.name })}>★</span> : null;
  const lvl = <span className="lvl-pill num" title={t("Niveau {n}", { n: c.level })}>{c.level}</span>;
  const words = c.name.trim().split(/\s+/);
  if (words.length < 2) return <span className="nm"><span className="nw">{star}{c.name}{lvl}</span></span>;
  const middle = words.slice(1, -1).join(" ");
  return (
    <span className="nm">
      <span className="nw">{star}{words[0]}</span> {middle && `${middle} `}<span className="nw">{words[words.length - 1]}{lvl}</span>
    </span>
  );
}

/** Âge de la synchro sur la carte (refonte 09/11) : vert à moins de 7 jours (« À jour » et l'âge), orange au-delà ou « Jamais ». */
function SyncDot({ at }: { at?: string | null }) {
  const s = syncState(at);
  if (s.tone === "ok") return <span className="sy-age ok mc-age" title={t("Synchro à jour · {ago}", { ago: s.ago ?? "" })}>{t("● À jour")}<small>{s.ago}</small></span>;
  return <span className="sy-age warn mc-age" title={s.ago ? t("Synchro {ago}", { ago: s.ago }) : t("Jamais synchronisé")}>● {s.ago ? s.label : t("Jamais")}<span className="sr-only"> {t("sans synchro")}</span></span>;
}

/* ---------- Fiche ---------- */

type Status = { kind: "idle" | "saving" | "saved" | "error" | "held"; msg?: string };

function CharSheet({ c, groups, tab, onTab, onChange, status, onPortrait, onDeleted, editing, onEditing }: {
  c: Character; groups: { id: string; name: string }[]; tab: EditorTab; onTab: (tt: EditorTab) => void; onChange: (p: Partial<Character>) => void;
  status: Status; onPortrait: (id: string | null) => void; onDeleted: () => void; editing: boolean; onEditing: (on: boolean) => void;
}) {
  const gt = useGameText();
  const [portrait, setPortrait] = useState(false);
  const [talents, setTalents] = useState(false);
  const [talManual, setTalManual] = useState(false);
  const color = gt.color(c.cls) ?? "var(--gold)";
  const age = syncState(c.addonSyncedAt);
  const face = <Portrait id={c.portraitId} size={44} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={34} /> : <ClassIcon cls={c.cls} size={34} />) : <span>?</span>} />;
  const saveText = { idle: null, saving: t("Enregistrement…"), saved: t("Enregistré ✓"), error: status.msg, held: status.msg }[status.kind];
  const specLine = (sp: string) => (
    <span className="fi-sp">{c.cls && <SpecIcon cls={c.cls} spec={sp} size={20} />}<b>{gt.spec(c.cls, sp)}</b>{roleOf(sp) && <RoleIcon role={roleOf(sp)} size={16} />}</span>
  );
  const split = (tt: string) => (tt ? tt.split("/").map(x => x.trim()).join(" / ") : null);
  return (
    <section className={`panel lift fi${editing ? " editing" : ""}`} style={{ "--cc": color } as CSSProperties} aria-label={t("Fiche de {name}", { name: c.name })}>
      <div className="fi-head">
        <button type="button" className="fi-face" aria-expanded={portrait} aria-label={t("Changer le portrait de {name}", { name: c.name })} title={t("Changer le portrait")} onClick={() => setPortrait(o => !o)}>{face}</button>
        <div className="fi-id">
          <h2>{c.name}{editing && <span className="tag gold fi-editing">{t("Modifier le profil")}</span>}</h2>
          {!editing && <>
            <div className="sub">{tx("Niv. {n}", { n: <b className="num">{c.level}</b> })} · <b className={`cn${c.cls === "Shaman" ? " sha" : ""}`}>{gt.cls(c.cls) || t("Classe ?")}</b>{c.race && ` · ${c.race}`}</div>
            <div className="sub fi-guild">{c.group ? <>{c.group.name} · {c.group.isMain ? <b className="fi-main">{t("★ main")}</b> : "alt"}</> : t("Sans guilde")}</div>
            <div className="fi-specs">
              {c.spec1 ? specLine(c.spec1) : <span className="fi-need">{t("Spé à choisir")}</span>}
              {c.spec2 && <><span>{t("off-spec")}</span>{specLine(c.spec2)}</>}
              {c.cls && <button type="button" className="fi-tal" aria-expanded={talents} aria-controls="fi-talents" onClick={() => setTalents(o => !o)}>
                {t("Talents")} {split(c.talents) ? <b className="num">{split(c.talents)}</b> : t("à remplir")} <span aria-hidden="true">{talents ? "▾" : "›"}</span></button>}
            </div>
          </>}
        </div>
        <div className="fi-state">
          {editing
            ? c.addonSyncedAt && <span className="sy-age ok">{t("● nom, niveau, classe et race suivent le jeu")}</span>
            : <>
              <span className={`sy-age ${age.tone}`}>● {age.tone === "ok" ? t("À jour") : age.ago ? t("{age} sans synchro", { age: age.label }) : t("Jamais synchronisé")}</span>
              {c.addonSyncedAt && age.tone === "ok" && <span className="fi-src">{tx("relevé par l'addon {ago}", { ago: age.ago })}</span>}
              {age.tone === "warn" && <button type="button" className="btn sm" onClick={openSync}>{t("Ouvrir la synchro")}</button>}
              <button type="button" className="btn fi-edit" onClick={() => onEditing(true)}>{t("✎ Modifier le profil")}</button>
            </>}
          {saveText && <span className={status.kind === "error" || status.kind === "held" ? "warnmsg" : undefined} role="status">{saveText}</span>}
        </div>
      </div>
      {c.origin && !editing && <OriginNote c={c} />}
      {portrait && (
        <div className="portrait-panel">
          <ImageUpload title={t("Portrait du perso")} hint={t("Une capture de la tête de ton perso en jeu, recadrée en 200 × 200. Visible par tes guildes.")} currentId={c.portraitId} round
            onUpload={async blob => { const r = await uploadImage<{ portraitId: string }>(`/characters/${c.id}/portrait`, blob); onPortrait(r.portraitId); setPortrait(false); }}
            onRemove={async () => { await del(`/characters/${c.id}/portrait`); onPortrait(null); }} />
          <button type="button" className="btn sm" onClick={() => setPortrait(false)}>{t("Fermer")}</button>
        </div>
      )}
      {editing && <ProfileEditor c={c} groups={groups} onChange={onChange} onDone={() => onEditing(false)} onDeleted={onDeleted} />}
      {talents && !editing && (
        <div className="fi-talents" id="fi-talents">
          <div className="fi-tal-head">
            <h3>{t("Talents")}</h3>
            {c.talentNodes?.length
              ? <span className={`sy-age ${age.tone}`}>{tx("● relevés par l'addon · {ago}", { ago: age.ago })}</span>
              : <span>{t("Pas encore relevés ·")} <button type="button" className="link" onClick={openSync}>{t("fais ta synchro")}</button></span>}
            <button type="button" className="btn sm" aria-pressed={talManual} onClick={() => setTalManual(m => !m)}>{talManual ? t("Terminer la saisie") : c.talentNodes?.length ? t("Modifier à la main") : t("Remplir à la main ›")}</button>
          </div>
          {/* Le conseil sur le niveau seulement si le joueur le change lui-même : une fois relevé en jeu, il suit le jeu */}
          <TalentsSection c={c} onChange={onChange} editable={talManual} readOnly={!talManual} folded levelHint={!c.addonSyncedAt && !c.levelLock ? "profile" : undefined} />
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} disabled={editing} onClick={() => onTab(k)}>{t(l)}</button>)}
      </div>
      <div className={`pane${editing ? " fi-off" : ""}`} inert={editing || undefined}>
        {tab === "metiers" && <Professions c={c} onChange={onChange} />}
        {tab === "stuff" && <Paperdoll c={c} onChange={onChange} editable fiche />}
        {tab === "legacy" && <LegacyTab c={c} onChange={onChange} />}
      </div>
    </section>
  );
}

/**
 * Fiche créée par un officier, ou donnée par un autre compte (8/11) : une ligne en haut de la fiche, jusqu'à ce que le joueur la
 * modifie ou la synchronise avec l'addon.
 */
function OriginNote({ c }: { c: Character }) {
  const o = c.origin!;
  return (
    <p className="gm-note fi-origin">
      <i aria-hidden="true">i</i>
      {o.kind === "created"
        ? <span><b>{tx("Fiche créée par {by}", { by: o.by })}</b>{c.group ? t(", officier de {name},", { name: c.group.name }) : ""} {tx("le {dayMonth}, d'après la liste du jeu. Complète-la (race, spé, talents) ou fais ta synchro avec l'addon : elle sera retrouvée.", { dayMonth: dayMonth(o.at) })}</span>
        : <span><b>{tx("Fiche donnée par {by}", { by: o.by })}</b> {c.group ? t("le {date}, rangée dans {name}.", { date: dayMonth(o.at), name: c.group.name }) : t("le {date}.", { date: dayMonth(o.at) })} {t("Ses inscriptions à venir sont maintenant les tiennes.")}</span>}
    </p>
  );
}

/**
 * « Modifier le profil » (refonte du 09/11) : Identité (nom, niveau, classe, race — en pointillé avec cadenas quand l'addon
 * les relève), Guilde et [★ Main | Alt], Spé et Off-spec en cartes de même largeur (la spé choisie est désactivée dans
 * l'off-spec), Ce perso (Donner… neutre, Supprimer… en rouge avec dialogue), puis [Annuler] [Valider le profil].
 * Rien n'est enregistré avant « Valider le profil ».
 */
function ProfileEditor({ c, groups, onChange, onDone, onDeleted }: {
  c: Character; groups: { id: string; name: string }[]; onChange: (p: Partial<Character>) => void; onDone: () => void; onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const gt = useGameText();
  const synced = !!c.addonSyncedAt;
  const [d, setD] = useState({ name: c.name, level: c.level, race: c.race, cls: c.cls, spec1: c.spec1, spec2: c.spec2 });
  const [guild, setGuild] = useState(c.group?.id ?? "");
  const [main, setMain] = useState(c.group?.isMain ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (p: Partial<typeof d>) => setD(x => ({ ...x, ...p }));
  const race = RACES[d.race];
  const classes = race ? race.classes : (Object.keys(CLASSES) as ClassName[]);
  const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[d.cls] ?? [];
  const bad = !!(d.race && d.cls && !isValidCombo(d.race, d.cls));
  const setClass = (cls: string) => {
    const sp: readonly string[] = CLASSES[cls as ClassName]?.specs ?? [];
    set({ cls, spec1: sp.includes(d.spec1) ? d.spec1 : "", spec2: sp.includes(d.spec2) ? d.spec2 : "" });
  };
  const setRace = (r: string) => set(!d.cls || isValidCombo(r, d.cls) ? { race: r } : { race: r, cls: "", spec1: "", spec2: "" });
  // L'Alt d'un main se choisit en prenant un autre perso comme main (le serveur garde un main par joueur)
  const wasMainHere = !!c.group?.isMain && c.group.id === guild;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const patch = Object.fromEntries(Object.entries(d).filter(([k, v]) => c[k as keyof typeof d] !== v)) as Partial<Character>;
      if (Object.keys(patch).length) onChange(patch);
      const groupChanged = guild !== (c.group?.id ?? "");
      if (groupChanged || (guild && main && !c.group?.isMain)) {
        if (guild) await put(`/groups/${guild}/characters/${c.id}`, { assigned: true, ...(main && { main: true }) });
        else if (c.group) await put(`/groups/${c.group.id}/characters/${c.id}`, { assigned: false });
        await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["group-chars"] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
      }
      onDone();
    } catch (e) { setErr(errorOf(e, t("Pas enregistré · connexion perdue. Réessaie."))); setBusy(false); }
  };
  const remove = async () => {
    try { await del(`/characters/${c.id}`); onDeleted(); } catch (e) { setErr(errorOf(e, t("Suppression impossible."))); setDeleting(false); }
  };
  const card = (sp: SpecDef, on: boolean, disabled: boolean, pick: () => void) => (
    <button key={sp.name} type="button" className={`pe-spec${on ? " on" : ""}`} aria-pressed={on} disabled={disabled} onClick={pick}>
      {d.cls && <SpecIcon cls={d.cls} spec={sp.name} size={22} />}<span>{gt.spec(d.cls, sp.name)}</span><RoleIcon role={sp.role} size={16} />
    </button>
  );
  const lockChip = (label: string, value: ReactNode) => <span className="pe-lock" title={t("{label} relevé par l'addon", { label: label })}>{value}<LockIcon /></span>;
  return (
    <div className="pe" role="group" aria-label={t("Modifier le profil")}>
      <div className="pe-row">
        <span className="pe-lab">{t("Identité")}</span>
        {synced ? (
          <div className="pe-locks">
            {lockChip(t("Nom"), c.name)}{lockChip(t("Niveau"), tx("Niv. {n}", { n: <b className="num">{c.level}</b> }))}
            {lockChip(t("Classe"), <b className={`cn${c.cls === "Shaman" ? " sha" : ""}`}>{gt.cls(c.cls) || t("Classe ?")}</b>)}{lockChip(t("Race"), c.race || t("Race ?"))}
            <span className="pe-note ok">{t("relevés par l'addon")}</span>
          </div>
        ) : (
          <div className="pe-id">
            <div className="fld"><label htmlFor="f-name">{t("Nom")}</label><input id="f-name" type="text" maxLength={40} value={d.name} onChange={e => set({ name: e.target.value })} /></div>
            <div className="fld pe-lv"><label htmlFor="f-level">{t("Niveau")}</label>
              {c.levelLock ? <LockedLevel id="f-level" value={c.level} describedBy="f-level-src" />
                : <NumberField id="f-level" min={1} max={60} value={d.level} onChange={level => set({ level })} />}</div>
            <div className="fld"><label htmlFor="f-cls">{t("Classe")}</label>
              <select id="f-cls" value={d.cls} onChange={e => setClass(e.target.value)} className={!d.cls ? "need" : undefined} aria-describedby="f-cls-hint">
                <option value="">{t("Choisir…")}</option>
                {classes.map(k => <option key={k} value={k}>{gt.cls(k)}</option>)}
              </select></div>
            <div className="fld"><label htmlFor="f-race">{t("Race")}</label>
              <select id="f-race" value={d.race} onChange={e => setRace(e.target.value)}>
                <option value="">{t("Choisir…")}</option>
                {RACE_NAMES.map(r => <option key={r} value={r}>{r}</option>)}
              </select></div>
            <p className="pe-hint" id="f-cls-hint">{race ? t("Classes possibles pour {race}. ", { race: d.race }) : ""}{t("Changer de classe efface la spé et l'off-spec.")}</p>
          </div>
        )}
      </div>
      {c.levelLock && <p className="lv-src" id="f-level-src"><LockIcon /><span>{levelLockText(c.levelLock, c.name)}</span></p>}
      {bad && <p className="warnmsg" style={{ margin: 0 }}>{tx("{race} ne peut pas être {v} dans WoW Forever.", { race: d.race, v: gt.cls(d.cls) })}</p>}
      <div className="pe-row">
        <label className="pe-lab" htmlFor="f-guild">{t("Guilde")}</label>
        <div className="pe-guild">
          <select id="f-guild" value={guild} onChange={e => { setGuild(e.target.value); setMain(false); }}>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="">{t("Aucune")}</option>
          </select>
          <div className="seg eq" role="group" aria-label={t("Main ou alt dans la guilde")}>
            <button type="button" className={guild && (main || wasMainHere) ? "on" : ""} aria-pressed={!!guild && (main || wasMainHere)} disabled={!guild} onClick={() => setMain(true)}>{t("★ Main")}</button>
            <button type="button" className={guild && !main && !wasMainHere ? "on" : ""} aria-pressed={!!guild && !main && !wasMainHere} disabled={!guild || wasMainHere}
              title={wasMainHere ? t("Choisis un autre perso comme main pour passer celui-ci en alt") : undefined} onClick={() => setMain(false)}>{t("Alt")}</button>
          </div>
        </div>
      </div>
      <div className="pe-row">
        <span className="pe-lab" id="pe-spec">{t("Spé")}</span>
        {d.cls ? <div className="pe-specs" role="group" aria-labelledby="pe-spec" style={{ "--n": specs.length } as CSSProperties}>
          {specs.map(sp => card(sp, d.spec1 === sp.name, false, () => set({ spec1: sp.name, spec2: d.spec2 === sp.name ? "" : d.spec2 })))}
        </div> : <p className="pe-hint">{t("Choisis d'abord la classe.")}</p>}
      </div>
      {d.cls && !d.spec1 && <p className="warnmsg pe-need">{t("Il faut une spé pour s'inscrire aux raids et aux sorties.")}</p>}
      <div className="pe-row">
        <span className="pe-lab" id="pe-off">{t("Off-spec")}</span>
        {d.cls ? <div className="pe-specs" role="group" aria-labelledby="pe-off" style={{ "--n": specs.length + 1 } as CSSProperties}>
          <button type="button" className={`pe-spec none${!d.spec2 ? " on" : ""}`} aria-pressed={!d.spec2} onClick={() => set({ spec2: "" })}><span>{t("Aucune")}</span></button>
          {specs.map(sp => card(sp, d.spec2 === sp.name, d.spec1 === sp.name, () => set({ spec2: sp.name })))}
        </div> : <p className="pe-hint">{t("Choisis d'abord la classe.")}</p>}
      </div>
      <div className="pe-row">
        <span className="pe-lab">{t("Ce perso")}</span>
        <div className="pe-acts">
          {c.group && <button type="button" className="btn" onClick={() => setGiving(true)}>{t("Donner à un autre joueur…")}</button>}
          <button type="button" className="btn danger" onClick={() => setDeleting(true)}>{t("Supprimer le perso…")}</button>
        </div>
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      <div className="pe-foot">
        <button type="button" className="btn" disabled={busy} onClick={onDone}>{t("Annuler")}</button>
        <button type="button" className="btn primary" disabled={busy || !d.name.trim() || bad} onClick={() => void save()}>{t("Valider le profil")}</button>
      </div>
      {giving && c.group && <GiveFicheDialog groupId={c.group.id} groupName={c.group.name} c={{ ...c, isMain: c.group.isMain }} onClose={() => setGiving(false)} closeOnDone />}
      {deleting && (
        <Modal label="pe-del-t" onClose={() => setDeleting(false)}>
          <DialogHead id="pe-del-t" title={t("Supprimer {name} ?", { name: c.name })} onClose={() => setDeleting(false)} />
          <p>{t("Sa fiche, son équipement, ses métiers et ses inscriptions à venir disparaissent. Ce n'est pas réversible ; la prochaine synchro de l'addon recréerait la fiche.")}</p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setDeleting(false)}>{t("Annuler")}</button>
            <button type="button" className="btn danger" onClick={() => void remove()}>{t("Supprimer {name}", { name: c.name })}</button>
          </div>
        </Modal>
      )}
    </div>
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
    catch (err) { setError(errorOf(err, t("Création impossible."))); setBusy(false); }
  };
  return (
    <section className="wl-card panel lift" aria-labelledby="nc-t">
      <div className="wl-top"><h2 id="nc-t" style={{ fontSize: 26, color: "var(--gold)" }}>{first ? t("Ton premier perso") : t("Nouveau perso")}</h2></div>
      <form className="wl-form" onSubmit={e => void submit(e)}>
        <div className="wl-row">
          <div className="fld"><label htmlFor="nc-n">{t("Nom du perso")}</label><input id="nc-n" type="text" required maxLength={40} autoFocus value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld wl-lv"><label htmlFor="nc-lv">{t("Niveau")}</label><NumberField id="nc-lv" min={1} max={60} value={level} onChange={setLevel} /></div>
        </div>
        <ClassSpecPicker cls={cls} spec={spec} onCls={c => { setCls(c); setSpec(""); }} onSpec={setSpec} idPrefix="nc" />
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="wl-go">
          <button type="submit" className="btn primary wl-btn" disabled={busy || !name.trim() || !cls || !spec}>{t("Créer le perso")}</button>
          <span className="hint">{t("Talents, métiers et équipement viendront de l'addon.")}</span>
        </div>
      </form>
    </section>
  );
}
