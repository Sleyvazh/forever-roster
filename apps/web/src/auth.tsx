import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { get, post, setCsrf, type Me } from "./api";

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
  const loc = useLocation();
  if (me.isLoading) return <p className="muted">Chargement…</p>;
  if (!me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.hash)}`} replace />;
  return <>{children}</>;
}

/** N'accepte qu'un chemin interne comme destination après connexion (pas de redirection ouverte). */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}
