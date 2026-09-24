import { LAUNCH_AT } from "@forever/game-data";
import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const when = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(LAUNCH_AT));

export function Countdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  let s = Math.floor((LAUNCH_AT - now) / 1000);
  if (s <= 0) return <span className="tag gold">Serveurs ouverts</span>;
  const d = Math.floor(s / 86400); s %= 86400;
  return (
    <div title={`Sortie officielle : ${when} (heure locale)`} aria-label={`Sortie officielle dans ${d} jours`}>
      <div className="cd" aria-hidden="true">
        <div><b>{d}</b><span>jours</span></div>
        <div><b>{pad(Math.floor(s / 3600))}</b><span>h</span></div>
        <div><b>{pad(Math.floor((s % 3600) / 60))}</b><span>min</span></div>
        <div><b>{pad(s % 60)}</b><span>s</span></div>
      </div>
    </div>
  );
}
