import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

/**
 * Icônes de rôle du jeu (Tank, Heal, DPS), servies par le serveur sous /icons/roles/ (fichiers de Blizzard, hors Git,
 * extraits par scripts/fetch-item-icons.sh). Tant qu'on ne sait pas si elles existent, ou si elles manquent,
 * le rôle s'écrit en toutes lettres comme avant.
 */
export type RoleName = "Tank" | "Heal" | "DPS";
const FILE: Record<RoleName, string> = { Tank: "tank", Heal: "heal", DPS: "dps" };
export const isRole = (r: unknown): r is RoleName => r === "Tank" || r === "Heal" || r === "DPS";

let state: "unknown" | "ok" | "missing" = "unknown";
const subs = new Set<() => void>();
const set = (s: typeof state) => { if (state !== s) { state = s; subs.forEach(f => f()); } };
let probing = false;
function probe() {
  if (probing || typeof Image === "undefined") return;
  probing = true;
  const img = new Image();
  img.onload = () => set(img.naturalWidth > 0 ? "ok" : "missing");
  img.onerror = () => set("missing");
  img.src = "/icons/roles/tank.png";
}
probe();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const useIcons = () => useSyncExternalStore(subscribe, () => state, () => "unknown" as const) === "ok";

/** Icône seule (texte de repli : le nom du rôle ; rôle inconnu : « ? »). pill : style de la pastille de repli. */
export function RoleIcon({ role, size = 16, pill }: { role: string | null | undefined; size?: number; pill?: CSSProperties }) {
  const ok = useIcons();
  if (!isRole(role)) return <span className="role" style={pill}>?</span>;
  if (!ok) return <span className={`role ${role}`} style={pill}>{role}</span>;
  return <img className="ricon" src={`/icons/roles/${FILE[role]}.png`} width={size} height={size} alt={role} title={role} onError={() => set("missing")} />;
}

/**
 * Rôle avec un nombre : l'icône suivie du nombre (« 🛡 3 »), sinon l'ancienne pastille en texte (« 3 tanks »).
 * text : le libellé complet, aussi en infobulle et pour les lecteurs d'écran ; plain : repli en texte simple (dans une phrase).
 */
export function RoleTag({ role, text, title, children, size = 16, plain }: { role: RoleName; text: string; title?: string; children?: ReactNode; size?: number; plain?: boolean }) {
  const ok = useIcons();
  if (!ok) return plain ? <span title={title}>{text}</span> : <span className={`role ${role}`} title={title}>{text}</span>;
  return (
    <span className={`rtag ${role}`} title={title ?? text} aria-label={text}>
      <img className="ricon" src={`/icons/roles/${FILE[role]}.png`} width={size} height={size} alt="" onError={() => set("missing")} />
      {children}
    </span>
  );
}
