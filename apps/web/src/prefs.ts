import { useState } from "react";

/**
 * Préférence d'affichage choisie par le joueur (variante d'une vue), gardée dans ce navigateur.
 * Si le stockage est indisponible (navigation privée…), la valeur par défaut s'applique simplement.
 */
export function useViewPref<T extends string>(key: string, def: T, allowed: readonly T[]): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const v = localStorage.getItem(`fr-view-${key}`) as T | null; return v && allowed.includes(v) ? v : def; } catch { return def; }
  });
  const set = (v: T) => { setValue(v); try { localStorage.setItem(`fr-view-${key}`, v); } catch { /* préférence non gardée */ } };
  return [value, set];
}
