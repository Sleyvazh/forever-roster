import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, post } from "../api";
import { useMe } from "../auth";
import { useSite } from "../site";

const KEY = "fr-invite";

/**
 * Le jeton d'invitation arrive dans le fragment (#), jamais envoyé au serveur par le navigateur.
 * On le garde en sessionStorage le temps de la connexion, puis on l'efface.
 */
export function JoinPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [token] = useState(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) { sessionStorage.setItem(KEY, fromHash); history.replaceState(null, "", "/join"); return fromHash; }
    return sessionStorage.getItem(KEY) ?? "";
  });
  const [group, setGroup] = useState<{ id: string; name: string } | null>(null);
  // Un site, deux adresses : l'invitation d'un groupe de l'autre jeu s'ouvre sur son site
  const [inviteSite, setInviteSite] = useState<{ game: string; name: string; origin: string } | null>(null);
  const site = useSite();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loggedIn = !!me.data?.user;

  useEffect(() => {
    if (!loggedIn || !token) return;
    post<{ group: { id: string; name: string }; site?: { game: string; name: string; origin: string } }>("/groups/invites/preview", { token })
      .then(r => { setGroup(r.group); setInviteSite(r.site ?? null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Invitation illisible."));
  }, [loggedIn, token]);

  if (me.isLoading) return <p className="muted">Chargement…</p>;
  if (!loggedIn) return <Navigate to="/login?next=/join" replace />;

  const accept = async () => {
    setBusy(true);
    try {
      const r = await post<{ groupId: string }>("/groups/invites/accept", { token });
      sessionStorage.removeItem(KEY);
      await qc.invalidateQueries({ queryKey: ["groups"] });
      nav(`/groups/${r.groupId}`, { replace: true });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Impossible de rejoindre."); }
    finally { setBusy(false); }
  };

  return (
    <div className="auth panel lift pad stack">
      <h1>Invitation</h1>
      {!token && <div className="alert error">Lien d'invitation incomplet.</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      {group && !error && inviteSite && inviteSite.game !== site.game && (
        <>
          <p>Cette invitation pour <strong>{group.name}</strong> est sur <strong>{inviteSite.name}</strong>. Ton compte y est le même.</p>
          <a className="btn primary" href={`${inviteSite.origin}/join#${token}`}>Ouvrir sur {inviteSite.name}</a>
        </>
      )}
      {group && !error && !(inviteSite && inviteSite.game !== site.game) && (
        <>
          <p>Tu es invité à rejoindre <strong>{group.name}</strong>. Les membres verront tes personnages en lecture seule, et les officiers pourront les placer dans les raids.</p>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void accept()}>Rejoindre le groupe</button>
        </>
      )}
      <Link to="/groups">Mes groupes</Link>
    </div>
  );
}
