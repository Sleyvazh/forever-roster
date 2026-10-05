import { CLASSES, RACES, type ClassName } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, patch, post, put, type Character, type GroupSummary } from "../api";
import { CharacterEditor, EDITOR_TAB_SLUG, editorTabFromSlug, type EditorTab } from "../components/CharacterEditor";
import { ClassIcon, FactionBadge, SpecIcon } from "../components/Icons";
import { Portrait } from "../components/ImageUpload";
import { StartSteps, WeekBand } from "../components/Week";

const TALENTS_RE = /^(\d{1,2}\/\d{1,2}\/\d{1,2})?$/;
const LINK_RE = /^(https:\/\/\S+)?$/;

/** Sauvegarde automatique : regroupe les modifications et n'envoie que les champs valides. */
function useAutosave(id: string | null, onSaved: (c: Character) => void) {
  const pending = useRef<Partial<Character>>({});
  const timer = useRef<number | undefined>(undefined);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error" | "held"; msg?: string }>({ kind: "idle" });

  const flush = async () => {
    if (!id) return;
    const body = { ...pending.current };
    const held: string[] = [];
    if (body.talents !== undefined && !TALENTS_RE.test(body.talents)) { held.push("répartition des talents"); delete body.talents; }
    if (body.talentLink !== undefined && !LINK_RE.test(body.talentLink)) { held.push("lien du build (https)"); delete body.talentLink; }
    if (body.talents2 !== undefined && !TALENTS_RE.test(body.talents2)) { held.push("répartition de l'off-spec"); delete body.talents2; }
    if (body.talentLink2 !== undefined && !LINK_RE.test(body.talentLink2)) { held.push("lien du build off-spec (https)"); delete body.talentLink2; }
    if (body.name !== undefined && !body.name.trim()) { held.push("nom"); delete body.name; }
    pending.current = Object.fromEntries(Object.entries(pending.current).filter(([k]) => !(k in body)));
    if (!Object.keys(body).length) { setStatus(held.length ? { kind: "held", msg: `À corriger avant enregistrement : ${held.join(", ")}.` } : { kind: "idle" }); return; }
    setStatus({ kind: "saving" });
    try {
      const r = await patch<{ character: Character }>(`/characters/${id}`, body);
      onSaved(r.character);
      setStatus(held.length ? { kind: "held", msg: `À corriger avant enregistrement : ${held.join(", ")}.` } : { kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof ApiError ? e.message : "Enregistrement impossible." });
    }
  };
  const queue = (p: Partial<Character>) => {
    pending.current = { ...pending.current, ...p };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
    setStatus({ kind: "saving" });
  };
  useEffect(() => () => { window.clearTimeout(timer.current); void flush(); /* enregistre avant de changer de perso */ }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return { queue, status };
}

export function CharactersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const groupsQ = useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups") });
  const myGroups = (groupsQ.data?.groups ?? []).map(g => ({ id: g.id, name: g.name }));
  const sections = [...myGroups.map(g => ({ key: g.id, name: g.name })), { key: "", name: "Sans groupe" }];
  const [local, setLocal] = useState<Character[]>([]);
  // Perso et onglet dans l'adresse : /persos/:charId/:tab (retour arrière, lien direct)
  const params = useParams();
  const nav = useNavigate();
  const tab = editorTabFromSlug(params.tab);
  const urlFor = (id: string, t: EditorTab = tab) => `/persos/${id}${t === "profil" ? "" : `/${EDITOR_TAB_SLUG[t]}`}`;
  const sel = params.charId && local.some(c => c.id === params.charId) ? params.charId : (local[0]?.id ?? null);
  const setSel = (id: string) => nav(urlFor(id));
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Garde la copie locale (en cours d'édition) des persos déjà affichés, ajoute/retire ceux qui ont changé côté serveur.
  // Le groupe (et main / alt) vient toujours du serveur : il change hors de la fiche (glisser, page du groupe, inscription)
  useEffect(() => { if (data) setLocal(prev => data.characters.map(sc => { const p = prev.find(x => x.id === sc.id); return p ? { ...p, group: sc.group } : sc; })); }, [data]);
  // Adresse sans perso (ou perso supprimé) : on montre le premier, sans ajouter d'étape à l'historique
  useEffect(() => {
    if (!data || !data.characters.length) return;
    if (!params.charId || !data.characters.some(c => c.id === params.charId)) nav(urlFor(data.characters[0]!.id), { replace: true });
  }, [data, params.charId]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = local.find(c => c.id === sel) ?? null;
  const saver = useAutosave(current?.id ?? null, saved => {
    qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: d.characters.map(c => c.id === saved.id ? saved : c) });
    void qc.invalidateQueries({ queryKey: ["week"] }); // classe ou spé renseignée : « à faire » à jour
  });

  const edit = (p: Partial<Character>) => {
    if (!current) return;
    setLocal(list => list.map(c => c.id === current.id ? { ...c, ...p } : c));
    saver.queue(p);
  };

  const add = async () => {
    setError(null);
    try {
      const r = await post<{ character: Character }>("/characters", { name: "Nouveau perso" });
      qc.setQueryData<{ characters: Character[] }>(["characters"], d => ({ characters: [...(d?.characters ?? []), r.character] }));
      void qc.invalidateQueries({ queryKey: ["week"] });
      nav(urlFor(r.character.id, "profil")); // un nouveau perso s'ouvre sur son identité
    } catch (e) { setError(e instanceof ApiError ? e.message : "Création impossible."); }
  };
  const remove = async () => {
    if (!current) return;
    await del(`/characters/${current.id}`);
    setConfirmDel(false);
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["week"] })]);
  };
  /** Change le groupe d'un perso (un seul groupe ; ses inscriptions restent) ou en fait le main de son groupe. */
  const moveTo = async (c: Character, to: string, main = false) => {
    setError(null);
    try {
      if (to) await put(`/groups/${to}/characters/${c.id}`, { assigned: true, ...(main && { main: true }) });
      else if (c.group) await put(`/groups/${c.group.id}/characters/${c.id}`, { assigned: false });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Changement impossible."); }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["group-chars"] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
  };
  const saveOrder = async (ids: string[]) => {
    setLocal(list => ids.map(id => list.find(c => c.id === id)!));
    try { await put("/characters/order", { ids }); } catch { await qc.invalidateQueries({ queryKey: ["characters"] }); }
  };

  if (isLoading) return <p className="muted">Chargement…</p>;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div><div className="eyebrow">Roster personnel</div><h1>Mes personnages</h1></div>
        {local.length > 0 && <button className="btn primary" type="button" onClick={() => void add()}>+ Ajouter un perso</button>}
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {local.length === 0 ? (
        <StartSteps onCreate={() => void add()} />
      ) : (<>
        <StartSteps compact onCreate={() => void add()} />
        <WeekBand />
        <div className="split">
          <aside className="stack">
            <p className="hint" style={{ margin: 0 }}>{myGroups.length ? "Glisse ⋮⋮ pour réordonner, ou vers un autre groupe pour l'y ranger." : "Glisse ⋮⋮ (ou flèches haut/bas) pour réordonner."}</p>
            <SortableList items={local} sections={myGroups.length ? sections : [{ key: "", name: "Mes persos" }]} selected={sel} onSelect={id => { setSel(id); setConfirmDel(false); }}
              onReorder={ids => void saveOrder(ids)} onMove={(id, to) => { const c = local.find(x => x.id === id); if (c) void moveTo(c, to); }} />
          </aside>
          {current && (
            <CharacterEditor
              key={current.id}
              character={current}
              editable
              tab={tab}
              onTab={t => nav(urlFor(current.id, t))}
              subhead={<GroupBar c={current} groups={myGroups} onMove={to => void moveTo(current, to)} onMain={() => current.group && void moveTo(current, current.group.id, true)} />}
              onChange={edit}
              onPortrait={portraitId => {
                setLocal(list => list.map(c => c.id === current.id ? { ...c, portraitId } : c));
                qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: d.characters.map(c => c.id === current.id ? { ...c, portraitId } : c) });
              }}
              footer={<>
                <span className={`small ${saver.status.kind === "error" || saver.status.kind === "held" ? "warnmsg" : "muted"}`} role="status">
                  {{ idle: "Les modifications sont enregistrées automatiquement.", saving: "Enregistrement…", saved: "Enregistré.", error: saver.status.msg, held: saver.status.msg }[saver.status.kind]}
                </span>
                {confirmDel
                  ? <span className="row small">Supprimer {current.name} définitivement ? <button className="btn danger sm" type="button" onClick={() => void remove()}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>
                  : <button className="btn ghost sm" type="button" onClick={() => setConfirmDel(true)}>Supprimer le perso</button>}
              </>}
            />
          )}
        </div>
      </>)}
    </div>
  );
}

export function CharacterCard({ c, current, onClick }: { c: Character; current?: boolean; onClick?: () => void }) {
  const cl = CLASSES[c.cls as ClassName];
  const race = RACES[c.race];
  const specs = [c.spec1, c.spec2].filter(Boolean).join(" / ");
  return (
    <button type="button" className="card" aria-current={current ? "true" : "false"} style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }} onClick={onClick}>
      <span className="cav" aria-hidden="true">
        <Portrait id={c.portraitId} size={42} className="round"
          fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={30} /> : <ClassIcon cls={c.cls} size={30} />) : <span className="muted">?</span>} />
      </span>
      <span className="nm"><span className="lvl-pill num" title={`Niveau ${c.level}`}>{c.level}</span>{c.group?.isMain && <span className="gm-star" title="Main dans ce groupe">★</span>}{c.group && !c.group.isMain && <span className="gm-alt">alt</span>}{c.name}</span>
      {race ? <FactionBadge faction={race.faction} /> : <span />}
      <span className="sub">{[c.cls, c.race].filter(Boolean).join(" · ") || "À configurer"}{specs && ` · ${specs}`}</span>
    </button>
  );
}

/**
 * Liste réordonnable à la souris, au doigt (pointer events) et au clavier, rangée par groupe (lot E) : une section par
 * groupe, puis « Sans groupe ». Lâcher un perso dans une autre section le change de groupe.
 */
function SortableList({ items, sections, selected, onSelect, onReorder, onMove }: {
  items: Character[]; sections: { key: string; name: string }[]; selected: string | null;
  onSelect: (id: string) => void; onReorder: (ids: string[]) => void; onMove: (id: string, to: string) => void;
}) {
  const secOfItem = (c: Character) => c.group?.id ?? "";
  const [order, setOrder] = useState<string[]>(items.map(c => c.id));
  const [secs, setSecs] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const base = () => Object.fromEntries(items.map(c => [c.id, secOfItem(c)]));
  useEffect(() => { if (!dragging) { setOrder(items.map(c => c.id)); setSecs(base()); } }, [items, dragging]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(items.map(c => [c.id, c]));
  const secOf = (id: string) => secs[id] ?? secOfItem(byId.get(id)!);

  const move = (id: string, delta: number) => {
    // Clavier : dans sa section seulement (le groupe se change dans la fiche)
    const same = order.filter(x => secOf(x) === secOf(id));
    const i = same.indexOf(id), j = i + delta;
    if (j < 0 || j >= same.length) return;
    const next = [...order]; const a = next.indexOf(id), b = next.indexOf(same[j]!);
    next[a] = same[j]!; next[b] = id;
    setOrder(next); onReorder(next);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !listRef.current) return;
    const sec = [...listRef.current.querySelectorAll<HTMLElement>("[data-sec]")].find(n => { const r = n.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom; });
    const target = sec?.dataset.sec ?? secOf(dragging);
    const rows = [...(sec ?? listRef.current).querySelectorAll<HTMLElement>("[data-id]")].filter(n => n.dataset.id !== dragging);
    const before = rows.find(n => { const r = n.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const rest = order.filter(id => id !== dragging);
    const last = [...rest].reverse().find(id => secOf(id) === target);
    const idx = before ? rest.indexOf(before.dataset.id!) : last ? rest.indexOf(last) + 1 : rest.length;
    rest.splice(idx, 0, dragging);
    if (rest.join() !== order.join()) setOrder(rest);
    if (target !== secOf(dragging)) setSecs(s => ({ ...s, [dragging]: target }));
  };
  const end = () => {
    if (!dragging) return;
    const id = dragging, from = secOfItem(byId.get(id)!), to = secOf(id);
    setDragging(null);
    if (order.join() !== items.map(c => c.id).join()) onReorder(order);
    if (to !== from) onMove(id, to);
  };

  return (
    <div className="roster" ref={listRef} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
      {sections.map(sec => {
        const list = order.filter(id => secOf(id) === sec.key).map(id => byId.get(id)).filter((c): c is Character => !!c);
        if (!list.length && !dragging && sec.key === "") return null;
        return (
          <div key={sec.key || "none"} className={`ch-sec${dragging && secOf(dragging) === sec.key ? " over" : ""}`} data-sec={sec.key}>
            <div className={`ch-sech${sec.key ? "" : " none"}`}><span>{sec.name}</span><small>{list.length ? `${list.length} perso${list.length > 1 ? "s" : ""}` : ""}</small></div>
            {list.map(c => (
              <div key={c.id} data-id={c.id} className={`item${dragging === c.id ? " dragging" : ""}`}>
                <button type="button" className="grip" aria-label={`Déplacer ${c.name} (flèches haut/bas)`}
                  onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDragging(c.id); }}
                  onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); move(c.id, -1); } if (e.key === "ArrowDown") { e.preventDefault(); move(c.id, 1); } }}>⋮⋮</button>
                <CharacterCard c={c} current={c.id === selected} onClick={() => onSelect(c.id)} />
              </div>
            ))}
            {!list.length && <p className="ch-drop">{dragging ? "Lâche ici pour ranger ce perso dans ce groupe" : "Aucun perso : glisse-en un ici, ou choisis ce groupe dans sa fiche."}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** En haut de la fiche : groupe du perso (un seul, ou aucun) et main / alt dans ce groupe. */
function GroupBar({ c, groups, onMove, onMain }: { c: Character; groups: { id: string; name: string }[]; onMove: (to: string) => void; onMain: () => void }) {
  if (!groups.length) return null;
  return (
    <div className="ch-gbar">
      <label className="lbl" htmlFor="ch-group">Groupe</label>
      <select id="ch-group" value={c.group?.id ?? ""} onChange={e => onMove(e.target.value)}>
        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        <option value="">Aucun groupe</option>
      </select>
      {c.group && (
        <div className="seg" role="group" aria-label="Main ou alt dans ce groupe">
          <button type="button" className={c.group.isMain ? "on" : ""} aria-pressed={c.group.isMain} onClick={() => { if (!c.group?.isMain) onMain(); }}>★ Main</button>
          <button type="button" className={c.group.isMain ? "" : "on"} aria-pressed={!c.group.isMain} disabled={c.group.isMain} title={c.group.isMain ? "Choisis un autre perso comme main pour passer celui-ci en alt" : undefined}>Alt</button>
        </div>
      )}
      <span className="hint ch-ghint">{c.group ? (c.group.isMain ? "Ton main est proposé en premier pour les inscriptions." : "Un seul main par groupe : en choisir un autre fait passer l'ancien en alt.") : "Sans groupe : il entre dans le groupe du premier raid où tu l'inscris."}</span>
    </div>
  );
}
