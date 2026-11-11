import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { get, type SiteStatus as Status } from "../api";
import { dateLocale, t } from "../i18n";

/**
 * « État du site » (page des admins) : le bot Discord, la dernière sauvegarde de nuit et les 5 dernières alertes.
 * L'API vérifie chaque minute et envoie les alertes par e-mail et dans le salon des signalements (lib/site-status.ts).
 */

const day = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { day: "2-digit", month: "2-digit" }).format(new Date(iso));
const hm = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** « 40 s », « 14 min », « 3 h », « 2 j » (durée écoulée, arrondie à l'unité inférieure). */
function span(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : t("{n} j", { n: Math.floor(h / 24) });
}

/** « 48,3 Mo » (1 Mo = 1 048 576 octets, comme l'affiche `du -h`). */
function size(bytes: number) {
  return bytes < 1024 * 1024
    ? t("{n} Ko", { n: Math.max(1, Math.round(bytes / 1024)) })
    : t("{n} Mo", { n: (bytes / 1024 / 1024).toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) });
}

const isAlert = (kind: Status["alerts"][number]["kind"]) => kind === "bot_down" || kind === "backup_late";

/** Le bot Discord : son état, ou « Pas de bot sur ce serveur » quand l'API n'en surveille aucun (pas de secret interne). */
function BotCard({ bot, now }: { bot: Status["bot"]; now: number }) {
  const seen = bot.watched ? bot.lastSeenAt : null;
  return (
    <div className="ss-card">
      <h3 className="ss-k">{t("Bot Discord")}</h3>
      {seen === null ? <>
        <b className="ss-v"><i className="ss-dot" aria-hidden="true" />{t("Pas de bot sur ce serveur")}</b>
        <span className="small muted">{t("Ce serveur n'a pas de bot Discord : rien n'est surveillé de ce côté.")}</span>
      </> : <>
        <b className="ss-v"><i className={`ss-dot ${bot.down ? "bad" : "ok"}`} aria-hidden="true" />{bot.down ? t("Ne répond plus") : t("Répond")}</b>
        <span className="small muted">
          {bot.down
            ? t("depuis {since} · dernier signe de vie {when}", { since: span(now - Date.parse(bot.downSince ?? seen)),
              when: day(seen) === day(new Date(now).toISOString()) ? t("à {time}", { time: hm(seen) }) : t("le {day} à {time}", { day: day(seen), time: hm(seen) }) })
            : t("dernier signe de vie il y a {span}", { span: span(now - Date.parse(seen)) })}
        </span>
      </>}
    </div>
  );
}

export function SiteStatus() {
  const q = useQuery({ queryKey: ["site-status"], queryFn: () => get<Status>("/admin/site-status"), refetchInterval: 30_000 });
  // « il y a 40 s » se met à jour sans recharger les données
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tt = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(tt);
  }, []);
  const s = q.data;

  return (
    <section className="panel pad ss" aria-labelledby="ss-title">
      <div className="row between">
        <h2 id="ss-title">{t("État du site")}</h2>
        <span className="small muted">{t("vérifié chaque minute")}</span>
      </div>
      {q.isLoading && <p className="muted">{t("Chargement…")}</p>}
      {q.error && <div className="alert error">{t("Impossible de charger l'état du site.")}</div>}
      {s && <>
        <div className="ss-cards">
          <BotCard bot={s.bot} now={now} />
          <div className="ss-card">
            <h3 className="ss-k">{t("Dernière sauvegarde")}</h3>
            {s.backup.at ? <>
              <b className="ss-v">
                <i className={`ss-dot ${s.backup.late ? "warn" : "ok"}`} aria-hidden="true" />{t("Réussie")}{s.backup.late ? <span className="tag warn">{t("En retard")}</span> : <span className="tag ok">{t("OK")}</span>}
              </b>
              <span className="small muted">{t("{day} à {time}", { day: day(s.backup.at), time: hm(s.backup.at) })}{s.backup.bytes !== null && ` · ${size(s.backup.bytes)}`}{s.backup.late && ` · ${t("il y a plus de 26 h")}`}</span>
            </> : <>
              <b className="ss-v">
                <i className={`ss-dot ${s.backup.late ? "warn" : ""}`} aria-hidden="true" />{t("Pas encore signalée")}{s.backup.late && <span className="tag warn">{t("En retard")}</span>}
              </b>
              <span className="small muted">{t("Le script de la sauvegarde de nuit n'a encore rien signalé : il est à réinstaller sur le serveur (docs/operations.md, section Surveillance).")}</span>
            </>}
          </div>
        </div>
        <h3 className="ss-k">{t("Dernières alertes")}</h3>
        {s.alerts.length
          ? <ul className="ss-alerts">
            {s.alerts.map(a => (
              <li key={`${a.at}-${a.kind}`}>
                <time dateTime={a.at}>{day(a.at)} {hm(a.at)}</time>
                <span>{a.text}</span>
                {isAlert(a.kind) ? <span className="tag bad">{t("Alerte")}</span> : <span className="tag ok">{t("Rétabli")}</span>}
              </li>
            ))}
          </ul>
          : <p className="muted small">{t("Aucune alerte pour l'instant.")}</p>}
      </>}
    </section>
  );
}
