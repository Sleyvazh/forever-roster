import { CLASSES, RACES, type ClassName } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, del, get, patch, post, put, type Character } from "../api";
import { CharacterEditor } from "../components/CharacterEditor";
import { ClassIcon, FactionBadge, SpecIcon } from "../components/Icons";
import { Portrait } from "../components/ImageUpload";

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
  const [local, setLocal] = useState<Character[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Garde la copie locale (en cours d'édition) des persos déjà affichés, ajoute/retire ceux qui ont changé côté serveur.
  useEffect(() => { if (data) { setLocal(prev => data.characters.map(sc => prev.find(p => p.id === sc.id) ?? sc)); setSel(s => s && data.characters.some(c => c.id === s) ? s : data.characters[0]?.id ?? null); } }, [data]);

  const current = local.find(c => c.id === sel) ?? null;
  const saver = useAutosave(current?.id ?? null, saved => qc.setQueryData<{ characters: Character[] }>(["characters"], d => d && { characters: d.characters.map(c => c.id === saved.id ? saved : c) }));

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
      sessionStorage.setItem("fr-tab", "profil"); // un nouveau perso s'ouvre sur son identité
      setSel(r.character.id);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Création impossible."); }
  };
  const remove = async () => {
    if (!current) return;
    await del(`/characters/${current.id}`);
    setConfirmDel(false);
    await qc.invalidateQueries({ queryKey: ["characters"] });
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
        <button className="btn primary" type="button" onClick={() => void add()}>+ Ajouter un perso</button>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {local.length === 0 ? (
        <div className="panel empty">
          <h2>Aucun personnage pour l'instant</h2>
          <p>Ajoute ton premier perso : race, classe, spés, talents, métiers et objectifs BiS.</p>
          <button className="btn primary" type="button" onClick={() => void add()}>+ Ajouter un perso</button>
        </div>
      ) : (
        <div className="split">
          <aside className="stack">
            <p className="hint" style={{ margin: 0 }}>Glisse ⋮⋮ (ou flèches haut/bas) pour réordonner.</p>
            <SortableList items={local} selected={sel} onSelect={id => { setSel(id); setConfirmDel(false); }} onReorder={ids => void saveOrder(ids)} />
          </aside>
          {current && (
            <CharacterEditor
              key={current.id}
              character={current}
              editable
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
      )}
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
      <span className="nm"><span className="lvl-pill num" title={`Niveau ${c.level}`}>{c.level}</span>{c.name}</span>
      {race ? <FactionBadge faction={race.faction} /> : <span />}
      <span className="sub">{[c.cls, c.race].filter(Boolean).join(" · ") || "À configurer"}{specs && ` · ${specs}`}</span>
    </button>
  );
}

/** Liste réordonnable à la souris, au doigt (pointer events) et au clavier. */
function SortableList({ items, selected, onSelect, onReorder }: { items: Character[]; selected: string | null; onSelect: (id: string) => void; onReorder: (ids: string[]) => void }) {
  const [order, setOrder] = useState<string[]>(items.map(c => c.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!dragging) setOrder(items.map(c => c.id)); }, [items, dragging]);
  const byId = new Map(items.map(c => [c.id, c]));

  const move = (id: string, delta: number) => {
    const i = order.indexOf(id), j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; next.splice(j, 0, next.splice(i, 1)[0]!);
    setOrder(next); onReorder(next);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>("[data-id]")].filter(n => n.dataset.id !== dragging);
    const before = rows.find(n => { const r = n.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    const rest = order.filter(id => id !== dragging);
    const idx = before ? rest.indexOf(before.dataset.id!) : rest.length;
    rest.splice(idx, 0, dragging);
    if (rest.join() !== order.join()) setOrder(rest);
  };
  const end = () => { if (dragging) { setDragging(null); if (order.join() !== items.map(c => c.id).join()) onReorder(order); } };

  return (
    <div className="roster" ref={listRef} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}>
      {order.map(id => byId.get(id)).filter((c): c is Character => !!c).map(c => (
        <div key={c.id} data-id={c.id} className={`item${dragging === c.id ? " dragging" : ""}`}>
          <button type="button" className="grip" aria-label={`Déplacer ${c.name} (flèches haut/bas)`}
            onPointerDown={e => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDragging(c.id); }}
            onKeyDown={e => { if (e.key === "ArrowUp") { e.preventDefault(); move(c.id, -1); } if (e.key === "ArrowDown") { e.preventDefault(); move(c.id, 1); } }}>⋮⋮</button>
          <CharacterCard c={c} current={c.id === selected} onClick={() => onSelect(c.id)} />
        </div>
      ))}
    </div>
  );
}
