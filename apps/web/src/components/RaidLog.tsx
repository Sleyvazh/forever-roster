import { DIFFICULTY_LABEL, encounterSummary, itemLinks, retailItemLink, type AttendanceStatus, type LootCategoryCounts, type LootMethod, type LootResponse, type RaidLogEncounter, type RetailDifficulty } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, put } from "../api";
import { useGameText } from "../gameText";
import { ExternalLink } from "./ExternalLink";
import { LootDetail } from "./Loot";
import { dateLocale, getLang, t, tn, tx } from "../i18n";
import { attendanceLabel, lootHowText, lootMethodLabel, lootResponseLabel } from "../i18n/game";

/* ---------- Bilan d'un raid (page du raid) ---------- */

export interface RaidLogView {
  recorder: string; startedAt: string; endedAt: string; updatedAt: string;
  attendance: { name: string; characterId: string | null; cls: string; owner: string | null; status: AttendanceStatus; first: number | null; last: number | null }[];
  loot: { itemId: number; itemName: string; quality: number; boss: string; at: number; name: string; characterId: string | null; cls: string; bis: boolean;
    method: LootMethod | null; response: LootResponse | null; detail: string;
    /** Lot I : nom noté par l'addon, raison pour laquelle l'objet ne compte pas d'office, exclusion par un officier. */
    gameName: string; skip: string | null; excluded: boolean }[];
  /** Roster (bilan RRB) : fin de chaque rencontre de boss, et difficulté relevée en jeu. */
  encounters?: RaidLogEncounter[]; difficulty?: RetailDifficulty | null;
}

const hm = (unix: number | null) => (unix ? new Date(unix * 1000).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—");
const TONE: Record<AttendanceStatus, string> = { present: "ok", late: "warn", left: "warn", bench: "", absent: "bad" };

export const AttendanceChip = ({ s }: { s: AttendanceStatus }) => <span className={`rl-chip ${TONE[s]}`}>{attendanceLabel(s)}</span>;

export function RaidLogPanel({ log, groupId, raidId, officer }: { log: RaidLogView | null | undefined; groupId: string; raidId: string; officer: boolean }) {
  const qc = useQueryClient();
  const gt = useGameText();
  // Roster (WoW Retail) : boss du bilan, objets distribués par l'addon Roster et compte des objets reçus (R3b)
  const retail = gt.game === "retail";
  const clsColor = (cls: string) => gt.color(cls);
  const itemHref = (id: number) => (retail ? retailItemLink(id, gt.lang) : itemLinks(id).wowhead);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (l: RaidLogView["loot"][number]) => {
    setError(null);
    try {
      await put(`/groups/${groupId}/raids/${raidId}/loot-exclusions`, { itemId: l.itemId, name: l.gameName, at: l.at, excluded: !l.excluded });
      await Promise.all([qc.invalidateQueries({ queryKey: ["raid", raidId] }), qc.invalidateQueries({ queryKey: ["attendance", groupId] }), qc.invalidateQueries({ queryKey: ["player-sheet", groupId] })]);
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Changement impossible.")); }
  };
  if (!log) {
    return (
      <section className="panel pad stack" aria-labelledby="rl-title">
        <h3 id="rl-title" style={{ margin: 0 }}>{t("Bilan du raid")}</h3>
        {retail ? (
          <p className="hint" style={{ margin: 0 }}>
            {tx("Pas encore de bilan. Pendant le raid, l'addon Roster relève tout seul la présence, le butin épique et les boss (avec les données du site copiées en jeu avant : {copy}, puis l'onglet Synchro de l'addon). Après le raid, un officier fait la synchro rapide de l'addon (Ctrl+C), puis Ctrl+V sur n'importe quelle page du site.", { copy: <strong>{t("Copier pour le jeu")}</strong> })}
          </p>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            {t("Pas encore de bilan. Pendant le raid, l'addon relève tout seul la présence et le butin (données du site chargées en jeu avant). Après le raid, un officier fait sa synchro : ta touche, Ctrl+C, puis Ctrl+V sur le site.")}</p>
        )}
      </section>
    );
  }
  const came = log.attendance.filter(a => a.status !== "absent" && a.status !== "bench").length;
  const when = new Date(log.updatedAt).toLocaleString(dateLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const bosses = encounterSummary(log.encounters ?? []);
  const kills = bosses.filter(b => b.killedAt !== null).length;
  return (
    <section className="panel pad stack" aria-labelledby="rl-title">
      <div className="row between">
        <h3 id="rl-title" style={{ margin: 0 }}>{t("Bilan du raid")}</h3>
        <span className="hint">{t("Relevé par l'addon de {name}", { name: log.recorder || "?" })} · {hm(Math.floor(new Date(log.startedAt).getTime() / 1000))} → {hm(Math.floor(new Date(log.endedAt).getTime() / 1000))}{log.difficulty ? ` · ${DIFFICULTY_LABEL[log.difficulty][gt.lang]}` : ""} · {t("enregistré le {when}", { when })}</span>
      </div>
      {retail && (
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="rl-h">{t("Boss")} <span className="muted small">{bosses.length ? `${tn(kills, "{n} vaincu", "{n} vaincus")} ${tn(bosses.length, "sur {n} tenté", "sur {n} tentés")}` : t("aucune rencontre notée")}</span></h4>
          {bosses.length > 0 && (
            <div className="tscroll"><table className="data rl-table">
              <thead><tr><th>{t("Boss")}</th><th>{t("Essais")}</th><th>{t("Résultat")}</th></tr></thead>
              <tbody>
                {bosses.map(b => (
                  <tr key={`${b.encounterId}-${b.boss}`}>
                    <td>{b.boss || t("Rencontre {id}", { id: b.encounterId })}</td>
                    <td className="num">{b.tries}</td>
                    <td>{b.killedAt !== null
                      ? <span className="rl-chip ok">{t("Vaincu à {time}", { time: hm(b.killedAt) })}</span>
                      : <span className="rl-chip bad">{t("Pas vaincu")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}
      <div className="rl-grid">
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="rl-h">{t("Butin")} <span className="muted small">{tn(log.loot.length, "{n} objet", "{n} objets")}</span></h4>
          {log.loot.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t("Aucun objet noté.")}</p> : (
            <div className="tscroll"><table className="data rl-table">
              <thead><tr><th>{t("Objet")}</th><th>{t("À")}</th><th /></tr></thead>
              <tbody>
                {log.loot.map((l, i) => (
                  <tr key={`${l.itemId}-${l.at}-${i}`}>
                    <td><ExternalLink className={`q${l.quality}`} href={itemHref(l.itemId)}>{l.itemName}</ExternalLink>
                      {l.boss && <div className="muted small">{l.boss}</div>}</td>
                    <td style={{ color: clsColor(l.cls) }}>{l.name}</td>
                    <td className="r"><div className="rl-tags">
                      {l.method && (retail
                        ? <span className="rl-chip" title={t("Distribué avec l'addon Roster")}>{lootHowText(l)}</span>
                        : <span className="rl-chip" title={l.detail || undefined}>{l.method === "roll" && /^(MS|OS)\b/.test(l.detail) ? t("jet") : lootMethodLabel(l.method)}{l.response ? ` · ${lootResponseLabel(l.response)}` : ""}{l.detail ? ` · ${l.detail}` : ""}</span>)}
                      {l.bis && <span className="rl-chip ok" title={t("Objectif BiS de la fiche, coché « obtenu »")}>{t("BiS ✓")}</span>}
                      {l.skip ? <span className="rl-chip muted" title={t("Ne compte pas dans les objets reçus (spé principale seulement)")}>{t("ne compte pas · {reason}", { reason: l.skip })}</span>
                        : l.excluded && <span className="rl-chip bad" title={t("Sorti du compte des objets reçus par un officier")}>{t("ne compte pas")}</span>}
                      {officer && !l.skip && <button type="button" className="btn ghost xs rl-excl" onClick={() => void toggle(l)}
                        title={l.excluded ? t("Remettre cet objet dans le compte des objets reçus") : t("Sortir cet objet du compte des objets reçus (donné par erreur, désenchanté…)")}>{l.excluded ? t("Compter") : t("Ne pas compter")}</button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h4 className="rl-h">{t("Présence")} <span className="muted small">{tn(came, "{n} venu", "{n} venus")}</span></h4>
          <div className="tscroll"><table className="data rl-table">
            <thead><tr><th>{t("Perso")}</th><th>{t("Dans le raid")}</th><th className="r">{t("Statut")}</th></tr></thead>
            <tbody>
              {log.attendance.map(a => (
                <tr key={`${a.name}-${a.characterId}`}>
                  <td style={{ color: clsColor(a.cls) }}>{a.name}{!a.characterId && <span className="muted small" title={t("Aucune fiche de ce nom dans la guilde")}> {t("· sans fiche")}</span>}</td>
                  <td className="muted">{a.first ? `${hm(a.first)} → ${hm(a.last)}` : "—"}</td>
                  <td className="r"><AttendanceChip s={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {retail ? <>
        <p className="hint" style={{ margin: 0 }}>{t("En retard : arrivé plus de 10 min après l'heure prévue. Parti tôt : absent du dernier quart de la soirée. Les persos sont reconnus à leur nom en jeu et leur royaume. Un nouveau collage du bilan remplace celui-ci (les objets sortis du compte le restent).")}</p>
        <p className="hint" style={{ margin: 0 }}>{t("Objets reçus (colonne « Reçus » de l'onglet Présence & butin et du conseil en jeu) : comptent le conseil BiS et Upgrade, les jets MS, les objets donnés par le chef de butin et ceux seulement notés. Pas les jets OS, le jet libre, Off-Spec, Transmo ni les objets gardés par le chef de butin.")}</p>
      </> : <>
        <p className="hint" style={{ margin: 0 }}>{t("En retard : arrivé plus de 10 min après l'heure prévue. Parti tôt : absent du dernier quart de la soirée. Un nouveau collage du bilan remplace celui-ci (les objets sortis du compte le restent).")}</p>
        <p className="hint" style={{ margin: 0 }}>{t("Objets reçus (onglet Présence & butin, conseil en jeu) : comptent la soft reserve, les jets MS, le conseil BiS et Upgrade, et les objets notés sans méthode. Pas les jets OS, le jet libre, Off-Spec ni Transmo.")}</p>
      </>}
    </section>
  );
}

/* ---------- Présence et butin du groupe (onglet) ---------- */

interface AttendanceResponse {
  raids: { id: string; name: string; scheduledAt: string }[];
  characters: { id: string; name: string; cls: string; owner: string; cells: (AttendanceStatus | null)[]; attended: number; loot: number; counted: number;
    /** Détail du compte : BiS, Upgrade, jets MS. */
    detail: LootCategoryCounts;
    lastItem: { id: number; name: string; quality: number; raidName: string } | null }[];
  /** Lot I : période et façon de compter les objets reçus (réglages du groupe). */
  count: { short: string; label: string; by: "player" | "character" };
}
const CELL_FR: Record<AttendanceStatus, string> = { present: "✓", late: "R", left: "P", bench: "B", absent: "✗" };
/** Anglais : L(ate), E(arly), B(ench). */
const CELL_EN: Record<AttendanceStatus, string> = { present: "✓", late: "L", left: "E", bench: "B", absent: "✗" };

export function AttendanceTab({ groupId }: { groupId: string }) {
  const gt = useGameText();
  // Roster : présence par raid et objets reçus (« Reçus », comme la colonne du conseil dans l'addon Roster, lot R3b)
  const retail = gt.game === "retail";
  const clsColor = (cls: string) => gt.color(cls);
  const { data, isLoading } = useQuery({ queryKey: ["attendance", groupId], queryFn: () => get<AttendanceResponse>(`/groups/${groupId}/attendance`) });
  if (isLoading || !data) return <p className="muted">{t("Chargement…")}</p>;
  if (!data.raids.length) {
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{t("Aucun raid relevé pour l'instant.")}</p>
        <p className="hint" style={{ margin: 0 }}>{retail
          ? t("Pendant un raid prévu ici, l'addon Roster relève tout seul qui est présent, le butin et les boss. Après le raid, un officier fait la synchro rapide de l'addon (Ctrl+C), puis Ctrl+V sur le site : le bilan apparaît sur la page du raid et ici.")
          : t("Pendant un raid prévu ici, l'addon relève tout seul qui est présent et le butin. Après le raid, un officier fait sa synchro (ta touche, Ctrl+C, puis Ctrl+V sur le site) : le bilan apparaît sur la page du raid et ici.")}</p>
      </div>
    );
  }
  const n = data.raids.length;
  const CELL = getLang() === "en" ? CELL_EN : CELL_FR;
  return (
    <div className="stack">
      {retail
        ? <p className="hint" style={{ margin: 0 }}>{n > 1 ? t("Sur les {n} derniers raids relevés.", { n }) : t("Sur le dernier raid relevé.")} {t("✓ présent · R en retard · P parti tôt · B banc · ✗ inscrit, absent · vide : ni inscrit ni vu.")}</p>
        : <details className="rl-legend"><summary>{n > 1 ? t("Les {n} derniers raids relevés", { n }) : t("Le dernier raid relevé")} · {t("légende")}</summary>
            <p className="hint" style={{ margin: "6px 0 0" }}>{t("✓ présent · R en retard · P parti tôt · B banc · ✗ inscrit, absent · vide : ni inscrit ni vu.")}</p></details>}
      <div className="tscroll"><table className="data rl-att">
        <thead><tr>
          <th>{t("Perso")}</th><th>{t("Présence")}</th>
          {data.raids.map(r => <th key={r.id} className="c" title={`${r.name} · ${new Date(r.scheduledAt).toLocaleDateString(dateLocale())}`}><Link to={`/groups/${groupId}/raids/${r.id}`}>{new Date(r.scheduledAt).toLocaleDateString(dateLocale(), { day: "2-digit", month: "2-digit" })}</Link></th>)}
          <th className="r" title={data.count.by === "player" ? t("Objets de spé principale reçus {period}, main et alts ensemble (réglage : Administration → Butin)", { period: data.count.label }) : t("Objets de spé principale reçus {period}, par perso (réglage : Administration → Butin)", { period: data.count.label })}>{retail ? t("Reçus") : t("Objets")} · {data.count.short}</th>
          <th>{t("Dernier objet")}</th>
        </tr></thead>
        <tbody>
          {data.characters.map(c => {
            const pct = Math.round((c.attended / n) * 100);
            return (
              <tr key={c.id}>
                <td><span style={{ color: clsColor(c.cls), fontWeight: 600 }}>{c.name}</span> <span className="muted small">{c.owner}</span></td>
                <td className="nowrap"><span className="rl-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} className={pct < 50 ? "low" : ""} /></span><span className="num small">{c.attended}/{n}</span></td>
                {c.cells.map((s, i) => <td key={i} className={`c rl-cell ${s ?? ""}`} title={s ? attendanceLabel(s) : t("Ni inscrit ni vu")}>{s ? CELL[s] : ""}</td>)}
                <td className="r" title={tn(c.loot, "{n} objet relevé au total", "{n} objets relevés au total")}><span className="num">{c.counted}</span><LootDetail detail={c.detail} /></td>
                <td>{c.lastItem ? <ExternalLink className={`q${c.lastItem.quality}`} href={retail ? retailItemLink(c.lastItem.id, gt.lang) : itemLinks(c.lastItem.id).wowhead} title={c.lastItem.raidName}>{c.lastItem.name}</ExternalLink> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}
