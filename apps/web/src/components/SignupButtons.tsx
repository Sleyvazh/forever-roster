import { SIGNUP_HINT, SIGNUP_LABEL, type SignupStatus } from "@forever/game-data";
import { useEffect, useRef, useState } from "react";

/**
 * Inscription à un raid (refonte du 23/10) : trois statuts visibles, les mêmes mots que les boutons Discord (Présent,
 * Peut-être, Absent), et « Autre » pour En retard, Reroll et Banc. Partout où l'on s'inscrit sur le site : Accueil, page
 * du raid. `lg` : grands boutons (page du raid, 44 px de haut).
 */
export const MAIN_STATUSES: SignupStatus[] = ["present", "tentative", "absent"];
export const OTHER_STATUSES: SignupStatus[] = ["late", "alt", "bench"];

export function SignupButtons({ value, onPick, label, lg, busy, canCome = true, onClear }: {
  value: SignupStatus | null | undefined; onPick: (s: SignupStatus) => void; label: string; lg?: boolean; busy?: boolean;
  /** Sans perso inscriptible, seul « Absent » reste possible. */
  canCome?: boolean;
  /** « Me désinscrire » dans le menu Autre (page du raid). */
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".su-more")?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const other = value && OTHER_STATUSES.includes(value) ? value : null;
  const pick = (s: SignupStatus) => { setOpen(false); if (s !== value) onPick(s); };
  return (
    <span className={lg ? "ans-btns" : "wk-seg"} role="group" aria-label={label} ref={ref}>
      {MAIN_STATUSES.map(st => (
        <button key={st} type="button" className={`su-btn ${st}${lg ? " lg" : ""}`} aria-pressed={value === st} title={SIGNUP_HINT[st]}
          disabled={busy || (st !== "absent" && !canCome)} onClick={() => pick(st)}>{SIGNUP_LABEL[st]}</button>
      ))}
      <span className="su-more-wrap">
        <button type="button" className={`su-more${lg ? "" : " sm"}${other ? ` on ${other}` : ""}`} aria-haspopup="menu" aria-expanded={open}
          aria-label={other ? `Autre réponse : ${SIGNUP_LABEL[other]}` : "Autre réponse : en retard, reroll, banc"} disabled={busy} onClick={() => setOpen(o => !o)}>
          {other ? <span>{SIGNUP_LABEL[other]}</span> : <span className={lg ? "wide" : "sr-only"}>Autre</span>}<span className="chev" aria-hidden="true" />
        </button>
        {open && (
          <span className="su-menu" role="menu">
            {OTHER_STATUSES.map(st => (
              <button key={st} type="button" role="menuitemradio" aria-checked={value === st} className={`su-mi ${st}`} disabled={!canCome}
                onClick={() => pick(st)}><b>{SIGNUP_LABEL[st]}</b><small>{SIGNUP_HINT[st]}</small></button>
            ))}
            {onClear && value && <button type="button" role="menuitem" className="su-mi clear" onClick={() => { setOpen(false); onClear(); }}><b>Me désinscrire</b></button>}
          </span>
        )}
      </span>
    </span>
  );
}
