import { SIGNUP_LABEL } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, get, post, type GroupSummary } from "../api";
import { whenText } from "../components/Week";
import { RoleTag } from "../components/RoleIcon";

export const ROLE_LABEL = { owner: "Propriétaire", officer: "Officier", member: "Membre" } as const;

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

/** Formulaire de création (dans la page vide, ou sous le bouton « Créer un groupe »). */
function CreateForm({ autoFocus, onCancel }: { autoFocus?: boolean; onCancel?: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    try {
      const r = await post<{ group: { id: string } }>("/groups", { name });
      await qc.invalidateQueries({ queryKey: ["groups"] });
      nav(`/groups/${r.group.id}`);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Création impossible."); }
  };
  return (
    <form className="g-create" onSubmit={create}>
      <div className="fld"><label htmlFor="g-name">Nom du groupe</label>
        <input id="g-name" type="text" required minLength={2} maxLength={48} autoFocus={autoFocus} value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Les Tournicotis" /></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row">
        <button className="btn primary" type="submit">Créer</button>
        {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}

function GroupCard({ g }: { g: GroupSummary }) {
  const officer = g.role !== "member";
  const base = `/groups/${g.id}`;
  const n = g.nextRaid;
  const links: [string, string][] = [["Raids", base], ["Membres", `${base}/membres`], ["Personnages", `${base}/persos`], ["Artisans", `${base}/artisans`],
    ...(officer ? [["Administration", `${base}/admin`] as [string, string]] : [])];
  return (
    <article className="gc-card" aria-labelledby={`g-${g.id}`}>
      <div className="gc-head">
        <span className="gc-emblem" aria-hidden="true"><span>{g.name.trim().charAt(0).toUpperCase()}</span></span>
        <div style={{ minWidth: 0 }}>
          <Link id={`g-${g.id}`} to={base} className="gc-name">{g.name}</Link>
          <div className="gc-meta"><b>{g.members}</b> membre{g.members > 1 ? "s" : ""} · {g.upcoming ? <><b>{g.upcoming}</b> raid{g.upcoming > 1 ? "s" : ""} à venir</> : "aucun raid à venir"}{g.discordLinked && " · Discord lié"}</div>
        </div>
        <span className={`tag ${officer ? "gold" : ""}`}>{ROLE_LABEL[g.role]}</span>
      </div>
      {n ? (
        <Link to={`${base}/raids/${n.id}`} className="gc-next">
          <span><span className="lbl">Prochain raid</span><br /><b>{n.name}</b> · {whenText(n.scheduledAt)} · {plural(n.coming, "inscrit")}</span>
          {n.mine ? <span className={`tag su-tag ${n.mine}`}>{SIGNUP_LABEL[n.mine]}</span> : <span className="tag warn">Pas de réponse</span>}
        </Link>
      ) : (
        <div className="gc-next none">Aucun raid prévu.{officer && <> <Link to={base}>Créer un raid</Link></>}</div>
      )}
      <div className="gc-roles">Roster : <RoleTag role="Tank" text={plural(g.roles.tank, "tank")}>{g.roles.tank}</RoleTag><RoleTag role="Heal" text={plural(g.roles.heal, "heal")}>{g.roles.heal}</RoleTag><RoleTag role="DPS" text={`${g.roles.dps} DPS`}>{g.roles.dps}</RoleTag></div>
      <nav className="gc-links" aria-label={`Onglets de ${g.name}`}>{links.map(([l, to]) => <Link key={l} to={to}>{l}</Link>)}</nav>
    </article>
  );
}

export function GroupsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups") });
  const [creating, setCreating] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!creating) return;
    const close = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node)) setCreating(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setCreating(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [creating]);
  const groups = data?.groups ?? [];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div><div className="eyebrow">Guildes et groupes</div><h1>Groupes</h1></div>
        {groups.length > 0 && (
          <div className="g-actions" ref={pop}>
            <span className="g-join hint">Pour rejoindre un groupe : ouvre le lien d'invitation de ton officier.</span>
            <button type="button" className="btn primary" aria-expanded={creating} aria-controls="g-create-pop" onClick={() => setCreating(c => !c)}>+ Créer un groupe</button>
            {creating && <div className="g-pop" id="g-create-pop"><CreateForm autoFocus onCancel={() => setCreating(false)} /></div>}
          </div>
        )}
      </div>
      {isLoading ? <p className="muted">Chargement…</p> : groups.length === 0 ? (
        <div className="g-empty">
          <section className="panel pad stack">
            <h2>Rejoindre un groupe</h2>
            <p className="muted" style={{ margin: 0 }}>Demande le lien d'invitation à un officier de ta guilde, puis ouvre-le : tu arrives directement dans le groupe.</p>
          </section>
          <section className="panel pad stack">
            <h2>Créer ton groupe</h2>
            <p className="muted" style={{ margin: 0 }}>Pour ta guilde ou ton groupe de raid : raids, compos, inscriptions, artisans, annonces Discord.</p>
            <CreateForm />
          </section>
        </div>
      ) : (
        <div className="g-grid">{groups.map(g => <GroupCard key={g.id} g={g} />)}</div>
      )}
    </div>
  );
}
