import type { Game } from "@forever/game-data";
import { useState, type ReactNode } from "react";

/** Commande du bot pour lier un salon : la même, sous le nom du site (un seul bot pour les deux). */
export const linkCommand = (game: Game) => (game === "retail" ? "/roster-lier" : "/forever-lier");

/**
 * Code de liaison à usage unique : la commande à taper dans le salon Discord voulu, avec « Copier ».
 * Même affichage pour le salon du groupe, celui des commandes et celui d'un raid récurrent.
 */
export function LinkCodeBox({ game, code, intro, label, footer }: {
  game: Game; code: { code: string; expiresAt: string }; intro: string; label: string; footer?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const cmd = `${linkCommand(game)} code:${code.code}`;
  const until = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(code.expiresAt));
  return (
    <div className="alert info stack" style={{ gap: 8 }}>
      <span>{intro} (valable jusqu'à {until}, une seule fois) :</span>
      <div className="row"><input type="text" readOnly value={cmd} onFocus={e => e.currentTarget.select()} aria-label={label} className="num" style={{ flex: 1 }} />
        <button className="btn sm" type="button" onClick={() => { void navigator.clipboard.writeText(cmd).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier"}</button></div>
      {footer}
    </div>
  );
}
