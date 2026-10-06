import { get, setCsrf, type Me } from "./api";

/** Compte connecté (/auth/me) : une seule définition pour toutes les pages (auth, site, langue des noms du jeu). */
export const meQuery = {
  queryKey: ["me"],
  queryFn: async () => {
    const me = await get<Me>("/auth/me");
    setCsrf(me.csrfToken);
    return me;
  },
  staleTime: 60_000,
};
