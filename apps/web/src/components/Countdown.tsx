import { LAUNCH_AT } from "@forever/game-data";
import { useEffect, useState } from "react";
import { dateLocale, t } from "../i18n";

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (tz: string) => new Intl.DateTimeFormat(dateLocale(), { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(LAUNCH_AT));
/** Après la sortie, la pastille « lancé » reste une semaine puis disparaît. */
const SHOW_AFTER = 7 * 86400e3;

/** Pastille du compte à rebours avant la sortie officielle, avec infobulle au survol ou au focus. */
export function LaunchPill() {
  const [now, setNow] = useState(() => Date.now());
  const [tip, setTip] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const ms = LAUNCH_AT - now;
  if (ms <= -SHOW_AFTER) return null;
  if (ms <= 0) return <span className="pill live" role="status">{t("Forever est lancé !")}</span>;
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s %= 86400;
  return (
    <span className="pill" tabIndex={0} aria-describedby={tip ? "launch-tip" : undefined} aria-label={t("Sortie officielle dans {n} jours", { n: d })}
      onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)} onFocus={() => setTip(true)} onBlur={() => setTip(false)}>
      <span className="j" aria-hidden="true">J-{d}</span>
      <span className="t" aria-hidden="true">{pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}</span>
      {tip && (
        <span className="pill-tip" role="tooltip" id="launch-tip">
          <b>{t("Sortie officielle de WoW Forever")}</b><br />
          <span className="first">{fmt("Europe/Paris")}</span> {t("(heure de Paris)")}<br />
          <span className="first">{fmt("America/Los_Angeles")}</span> {t("à Los Angeles")}
        </span>
      )}
    </span>
  );
}
