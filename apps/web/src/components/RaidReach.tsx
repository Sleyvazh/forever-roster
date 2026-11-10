import { classColor, CLASSES, type ClassName, type Role } from "@forever/game-data";
import { useState } from "react";
import { useGameText } from "../gameText";
import { ApiError, post } from "../api";
import { RoleIcon } from "./RoleIcon";
import { dateLocale, N, t, tn, tx } from "../i18n";

/**
 * Joindre les joueurs (lot D2), vue officiers : qui n'a pas répondu, relance automatique et « Relancer maintenant »,
 * suivi des demandes « Demander à X ». Classes CSS « rr- ».
 */

export type AskState = "queued" | "sent" | "failed" | "yes" | "no";
export interface RaidAsk {
  id: string; characterId: string; userId: string; name: string; cls: string; owner: string; spec: string; role: Role | null;
  askedByName: string; createdAt: string; answeredAt: string | null; state: AskState;
}
export interface Reach {
  discordLinked: boolean; upcoming: boolean;
  settings: { hours: 24 | 48 | 72 | null; officers: boolean };
  auto: { at: string | null; sentAt: string | null };
  manual: { lastAt: string | null; nextAt: string | null; queued: boolean };
  pending: { userId: string; displayName: string; main: { name: string; cls: string; spec: string } | null; dm: boolean; why: "no-discord" | "dm-off" | null }[];
  dmUsers: string[];
  asks: RaidAsk[];
}

export const ASK_LABEL: Record<AskState, string> = { queued: N("envoi…"), sent: N("demandé"), failed: N("MP impossible"), yes: N("a dit oui"), no: N("a dit non") };
const ASK_TONE: Record<AskState, string> = { queued: "", sent: "", failed: "bad", yes: "ok", no: "warn" };
export const AskChip = ({ state }: { state: AskState }) => <span className={`rl-chip ${ASK_TONE[state]}`}>{t(ASK_LABEL[state])}</span>;

const color = (cls: string) => classColor(cls);
const fmt = () => new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const hm = () => new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function RaidReach({ groupId, raidId, reach, onChanged }: { groupId: string; raidId: string; reach: Reach; onChanged: () => void }) {
  const gt = useGameText();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { pending, settings, auto, manual } = reach;
  const reachable = pending.filter(p => p.dm);
  const noDiscord = pending.filter(p => p.why === "no-discord"), dmOff = pending.filter(p => p.why === "dm-off");
  const answered = reach.asks.filter(a => a.state === "yes" || a.state === "no").length;

  const autoLine = !reach.discordLinked ? t("Pas de salon Discord lié : pas de relance par le bot.")
    : !settings.hours ? t("Relance automatique désactivée (Administration).")
    : auto.sentAt ? t("Relance automatique faite le {when}.", { when: fmt().format(new Date(auto.sentAt)) })
    : auto.at ? t("Relance automatique : {hours} h avant, le {when}.", { hours: settings.hours, when: fmt().format(new Date(auto.at)) }) : t("Relance automatique : {hours} h avant.", { hours: settings.hours });

  const nudge = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await post<{ count: number }>(`/groups/${groupId}/raids/${raidId}/nudge`);
      setMsg({ ok: true, text: tn(r.count, "Relance envoyée à {n} joueur dans la minute.", "Relance envoyée à {n} joueurs dans la minute.") });
      onChanged();
    } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : t("Relance impossible.") }); } finally { setBusy(false); }
  };
  const wait = manual.nextAt ? t("Prochaine relance à la main possible à {time}", { time: hm().format(new Date(manual.nextAt)) }) : null;

  return (
    <section className="panel pad stack rr" aria-labelledby="rr-title">
      <div className="rr-head">
        <h3 id="rr-title">{t("Pas encore répondu")} <span className={`tag ${pending.length ? "warn" : "ok"}`}>{pending.length}</span></h3>
        <span className="muted small rr-auto">{autoLine}</span>
        {reach.discordLinked && reach.upcoming && pending.length > 0 && (
          <button type="button" className="btn sm" disabled={busy || !!manual.nextAt || manual.queued || !reachable.length} title={wait ?? undefined} onClick={() => void nudge()}>
            {manual.queued ? t("Relance en cours…") : t("Relancer maintenant")}
          </button>
        )}
      </div>
      {pending.length === 0 ? <p className="hint" style={{ margin: 0 }}>{t("Tous les membres de la guilde ont répondu.")}</p> : (
        <div className="rr-chips">
          {pending.map(p => (
            <span key={p.userId} className={`gm-chip rr-chip${p.dm ? "" : " off"}`} title={p.dm ? t("Joignable par MP") : p.why === "dm-off" ? t("Messages du bot désactivés") : t("Discord non lié")}>
              <span className="avatar" style={{ width: 18, height: 18 }}><span style={{ fontSize: 8 }}>{p.displayName[0]}</span></span>
              <span>{p.displayName}</span>
              {p.main && p.main.name !== p.displayName && <small style={{ color: color(p.main.cls) }}>{p.main.name}</small>}
            </span>
          ))}
        </div>
      )}
      {(noDiscord.length > 0 || dmOff.length > 0) && (
        <p className="hint" style={{ margin: 0 }}>
          {noDiscord.length > 0 && <>{tx("Sans Discord lié : {names}.", { names: <b>{noDiscord.map(p => p.displayName).join(", ")}</b> })} </>}
          {dmOff.length > 0 && <>{tx("Messages du bot désactivés : {names}.", { names: <b>{dmOff.map(p => p.displayName).join(", ")}</b> })} </>}
          {t("À prévenir autrement.")}
        </p>
      )}
      {wait && !msg && <p className="hint" style={{ margin: 0 }}>{wait}.</p>}
      {msg && <div className={`alert ${msg.ok ? "info" : "error"}`} role="status">{msg.text}</div>}
      {reach.asks.length > 0 && (
        <div className="rr-asks">
          <span className="small muted">{tn(answered, "Demandes envoyées · {n}/{total} réponse", "Demandes envoyées · {n}/{total} réponses", { total: reach.asks.length })}</span>
          <ul className="rr-asklist">
            {reach.asks.map(a => (
              <li key={a.id}>
                {a.role && <RoleIcon role={a.role} />}
                <b style={{ color: color(a.cls) }}>{a.name}</b>
                <span className="small muted">{gt.specOrClass(a.cls, a.spec)} · {a.owner}</span>
                <AskChip state={a.state} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
