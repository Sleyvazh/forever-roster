import { useState, type InputHTMLAttributes } from "react";
import { t } from "../i18n";

/**
 * Champ de mot de passe avec un œil (refonte du 09/11) : afficher ou masquer ce qu'on tape, plutôt qu'un champ
 * « Confirmation ». Bouton de 44 × 44 dans le champ ; le texte affiché n'est jamais gardé ailleurs que dans le champ.
 */
export function PasswordInput({ id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-field">
      <input id={id} {...rest} type={show ? "text" : "password"} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      <button type="button" className="pw-eye" aria-controls={id} aria-pressed={show} aria-label={show ? t("Masquer le mot de passe") : t("Afficher le mot de passe")}
        title={show ? t("Masquer") : t("Afficher")} onClick={() => setShow(s => !s)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}

/** Nombre de mots d'une phrase de passe (séparés par des espaces). */
const words = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;

/**
 * Règles cochées en direct sous un nouveau mot de passe : « ✓ 12 caractères au moins (25) », « ✓ Une phrase de passe : idéal ».
 * Les fuites connues sont vérifiées à l'envoi (le message du site donne alors la solution).
 */
export function PasswordRules({ value, id }: { value: string; id: string }) {
  const len = [...value].length;
  const long = len >= 12, phrase = words(value) >= 3;
  return (
    <ul className="pw-rules" id={id} aria-live="polite">
      <li className={long ? "ok" : ""}>{long ? "✓" : "○"} {t("12 caractères au moins")} <span className="num">({len})</span></li>
      <li className={phrase ? "ok" : ""}>{phrase ? `✓ ${t("Une phrase de passe : idéal")}` : `○ ${t("Idéal : une phrase de passe, par exemple trois mots et un chiffre")}`}</li>
    </ul>
  );
}
