import { CLASSES, specDef, specSlug, type ClassName } from "@forever/game-data";
import { useState, type CSSProperties } from "react";

/**
 * Icônes du jeu servies par notre serveur (dossier icons/, hors dépôt Git) :
 *   /icons/class/<classe>.png   /icons/spec/<classe>-<spé>.png (ex. druid-feral-bear)
 * Si un fichier manque, on affiche un repli (ancienne icône d'arbre, puis de classe, puis initiale) : rien ne casse.
 */
export const classIconUrl = (cls: string) => { const c = CLASSES[cls as ClassName]; return c ? `/icons/class/${c.slug}.png` : null; };
export const specIconUrl = (cls: string, spec: string) => {
  const c = CLASSES[cls as ClassName];
  return c && specDef(cls, spec) ? `/icons/spec/${c.slug}-${specSlug(spec)}.png` : null;
};
/** Ancien emplacement (icônes rangées par numéro d'arbre), gardé en repli. */
export const treeIconUrl = (cls: string, spec: string) => {
  const c = CLASSES[cls as ClassName], d = specDef(cls, spec);
  return c && d ? `/icons/tree/${c.slug}-${d.tree + 1}.png` : null;
};

function Img({ src, fallback, size, className, title }: { src: string | null; fallback: React.ReactNode; size: number; className?: string; title?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const style: CSSProperties = { width: size, height: size };
  if (!src || failed === src) return <span className={`gi-fallback ${className ?? ""}`} style={{ ...style, fontSize: Math.round(size * 0.5) }} aria-hidden="true" title={title}>{fallback}</span>;
  return <img className={className} src={src} width={size} height={size} alt="" title={title} loading="lazy" decoding="async" onError={() => setFailed(src)} />;
}

export function ClassIcon({ cls, size = 24, className }: { cls: string; size?: number; className?: string }) {
  return <Img src={classIconUrl(cls)} fallback={cls ? cls[0] : "?"} size={size} className={`cicon ${className ?? ""}`} title={cls || undefined} />;
}

/** Icône de la spé ; à défaut celle de son arbre de talents, puis celle de la classe. */
export function SpecIcon({ cls, spec, size = 28, className }: { cls: string; spec: string; size?: number; className?: string }) {
  const [bad, setBad] = useState<string[]>([]);
  const src = [specIconUrl(cls, spec), treeIconUrl(cls, spec)].find((u): u is string => !!u && !bad.includes(u));
  if (!src) return <ClassIcon cls={cls} size={size} className={className} />;
  return <img key={src} className={`sicon ${className ?? ""}`} src={src} width={size} height={size} alt="" title={spec} loading="lazy" decoding="async" onError={() => setBad(b => [...b, src])} />;
}
