import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, get, post, type GroupSummary } from "../api";

export const ROLE_LABEL = { owner: "Propriétaire", officer: "Officier", member: "Membre" } as const;

export function GroupsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: () => get<{ groups: GroupSummary[] }>("/groups") });
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
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Guildes et groupes</div><h1>Groupes</h1></div></div>
      <div className="split">
        <form className="panel pad stack" onSubmit={create}>
          <h3>Créer un groupe</h3>
          <div className="fld"><label htmlFor="g-name">Nom</label><input id="g-name" type="text" required minLength={2} maxLength={48} value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Les Tournicotis" /></div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <button className="btn primary" type="submit">Créer</button>
          <p className="hint" style={{ margin: 0 }}>Pour rejoindre un groupe existant, ouvre le lien d'invitation qu'un officier t'a envoyé.</p>
        </form>
        <div className="stack">
          {isLoading ? <p className="muted">Chargement…</p> : !data?.groups.length ? (
            <div className="panel empty"><h2>Aucun groupe</h2><p>Crée ton groupe ou demande un lien d'invitation.</p></div>
          ) : data.groups.map(g => (
            <Link key={g.id} to={`/groups/${g.id}`} className="panel pad row between" style={{ textDecoration: "none", color: "var(--ink)" }}>
              <span><strong style={{ fontFamily: "var(--f-disp)", fontSize: 18 }}>{g.name}</strong><br /><span className="muted small">{g.members} membre{g.members > 1 ? "s" : ""}</span></span>
              <span className={`tag ${g.role === "member" ? "" : "gold"}`}>{ROLE_LABEL[g.role]}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
