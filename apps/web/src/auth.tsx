import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { get, post, setCsrf, type Me } from "./api";
import { useSite } from "./site";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await get<Me>("/auth/me");
      setCsrf(me.csrfToken);
      return me;
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try { await post("/auth/logout"); }
    finally {
      setCsrf(null);
      qc.clear();
      // Rechargement complet : l'interface repart de zéro et plus aucune donnée
      // de la session précédente ne reste en mémoire dans l'onglet.
      window.location.assign("/login");
    }
  };
}

/** Réserve une page aux personnes connectées ; sinon redirige vers /login en gardant la destination. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const site = useSite();
  const loc = useLocation();
  if (me.isLoading) return <p className="muted">Chargement…</p>;
  if (!me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search + loc.hash)}`} replace />;
  // Site pas encore ouvert (Roster avant les données Retail) : seul le compte est accessible
  if (!site.open && loc.pathname !== "/account" && loc.pathname !== "/appairer") return <ComingSoon />;
  return <>{children}</>;
}

/** Roster (WoW Retail) avant son ouverture : le compte est prêt, il sert déjà sur l'autre adresse. */
export function ComingSoon() {
  const site = useSite();
  return (
    <div className="soon panel lift pad stack">
      <div className="eyebrow">{site.name}</div>
      <h1>{site.name} arrive bientôt</h1>
      <p>Ton compte est prêt. Les raids, la soft reserve et le conseil du butin pour WoW Retail arrivent ici très vite : tu n'auras rien à refaire.</p>
      {site.other && <p>En attendant, ce même compte marche déjà sur <a href={site.other.origin}>{site.other.name}</a> (même e-mail, même mot de passe).</p>}
      <p className="small muted"><Link to="/account">Compte et sécurité</Link> : mot de passe, liaison Discord, image du compte.</p>
    </div>
  );
}

/** N'accepte qu'un chemin interne comme destination après connexion (pas de redirection ouverte). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
