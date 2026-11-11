import type { FicheLevelLock } from "@forever/game-data";
import { dateLocale, t } from "../i18n";

/**
 * Niveau verrouillé d'une fiche (7/11) : relevé en jeu (liste de guilde) ou fixé par un officier de la guilde. Le champ
 * garde sa place dans la grille (cadenas à la place des boutons − / +), la phrase dit d'où vient le niveau.
 */

export function LockIcon() {
  return (
    <svg className="lv-lock-i" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M5 7V5a3 3 0 0 1 6 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1Zm1.5 0h3V5a1.5 1.5 0 0 0-3 0v2Z" />
    </svg>
  );
}

const day = (at: string | null) => (at && !Number.isNaN(Date.parse(at))
  ? new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "numeric", timeZone: "Europe/Paris" }).format(new Date(at)) : null);

/** « Niveau relevé en jeu : Necko Brisefer est niveau 34 dans la liste de guilde du 7/11. Il suit le jeu. » */
export function levelLockText(lock: FicheLevelLock, ficheName: string) {
  const d = day(lock.at);
  if (lock.by === "game") {
    return d ? t("Niveau relevé en jeu : {name} est niveau {level} dans la liste de guilde du {d}. Il suit le jeu.", { name: lock.name, level: lock.level, d })
      : t("Niveau relevé en jeu : {name} est niveau {level} dans la liste de guilde. Il suit le jeu.", { name: lock.name, level: lock.level });
  }
  return d ? t("Niveau fixé par {name}, officier de ta guilde, le {d}, tant que le jeu ne donne pas celui de {fiche}.", { name: lock.name, d, fiche: ficheName })
    : t("Niveau fixé par {name}, officier de ta guilde, tant que le jeu ne donne pas celui de {fiche}.", { name: lock.name, fiche: ficheName });
}

/** Champ du niveau en lecture seule (même gabarit que NumberField). */
export function LockedLevel({ id, value, describedBy }: { id: string; value: number; describedBy: string }) {
  return (
    <span className="numfield lv-locked">
      <span className="lv-lock"><LockIcon /></span>
      <input id={id} type="text" className="num" value={value} readOnly aria-readonly="true" aria-describedby={describedBy} />
    </span>
  );
}
