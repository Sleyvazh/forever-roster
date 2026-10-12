import type { AnchorHTMLAttributes } from "react";

/**
 * Lien vers un autre site (Wowhead, Armurerie, Raider.IO, Warcraft Logs, ForeverChanges, GitHub…) : toujours dans un
 * nouvel onglet (retour des joueurs, 11/10/2026 : la page du site reste ouverte), sans donner la main sur cette page
 * (noopener) ni l'adresse d'où l'on vient (noreferrer). Les lecteurs d'écran entendent « (nouvel onglet) » : texte
 * masqué après le contenu, ou ajouté à `aria-label` s'il y en a un ; `hint` le précise (« Wowhead, nouvel onglet »),
 * `hint={false}` quand le lien le dit déjà.
 * Restent de simples liens, dans le même onglet : liens internes (Link de react-router), adresses du site
 * (/downloads/*.zip, /api/…), mailto, et l'autre adresse du site (Forever Roster ↔ Roster, même compte), qui prend la
 * suite de la page.
 */
export function ExternalLink({ hint = "nouvel onglet", children, "aria-label": label, ...rest }:
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> & { href: string; hint?: string | false }) {
  return (
    <a {...rest} aria-label={label && hint ? `${label} (${hint})` : label} target="_blank" rel="noopener noreferrer">
      {children}{hint && !label && <span className="sr-only"> ({hint})</span>}
    </a>
  );
}
