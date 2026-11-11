import { classColor, CLASSES, itemLinks, LOOT_CATEGORIES, retailItemLink, type AttendanceStatus, type ClassName, type GearStats, type LootCategory, type LootCategoryCounts } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe } from "../auth";
import { useGameText } from "../gameText";
import { ApiError, del, get, post, type GroupRole } from "../api";
import { ExternalLink } from "./ExternalLink";
import { ClassIcon, SpecIcon } from "./Icons";
import { Portrait } from "./ImageUpload";
import { absenceLabel } from "./Absences";
import { LootDetail } from "./Loot";
import { attendanceLabel, lootCategoryLabel } from "../i18n/game";
import { dateLocale, getLang, isMany, t, tx } from "../i18n";
import { roleLabel } from "../pages/GroupsPage";

/** Fiche d'un joueur dans le groupe (lot D1) : persos joués ici, présence, banc, butin reçu. Classes CSS « ps- ». */

interface Sheet {
  member: { userId: string; displayName: string; avatarId: string | null; role: GroupRole; joinedAt: string; discordLinked: boolean };
  characters: { id: string; name: string; cls: string; spec1: string; spec2: string; level: number; portraitId: string | null; isMain: boolean; gearStats: GearStats }[];
  attendance: { raids: number; attended: number; benched: number; cells: { raidId: string; name: string; scheduledAt: string; status: AttendanceStatus | null }[] };
  absences: { startDate: string | null; endDate: string | null; weekdays: number[]; reason: string }[];
  loot: { itemId: number; name: string; quality: number; character: string; boss: string; raidName: string; raidId: string; at: number; bis: boolean; skip: string | null; excluded: boolean }[];
  /** Lot I : objets reçus sur la période du groupe, et corrections des officiers (avec leur catégorie : BiS, Upgrade, jet MS). */
  lootCount: {
    label: string; short: string; by: "player" | "character"; player: number;
    /** Détail du total du joueur : BiS, Upgrade, jets MS. */
    detail: LootCategoryCounts;
    characters: { characterId: string; name: string; own: number }[];
    corrections: { id: string; characterId: string; delta: number; kind: LootCategory | null; note: string; by: string; at: string; inPeriod: boolean }[];
  };
}

const CELL_FR: Record<AttendanceStatus, string> = { present: "✓", late: "R", left: "P", bench: "B", absent: "✗" };
/** Anglais : L(ate), E(arly), B(ench), comme l'onglet Présence & butin. */
const CELL_EN: Record<AttendanceStatus, string> = { present: "✓", late: "L", left: "E", bench: "B", absent: "✗" };
const day = () => new Intl.DateTimeFormat(dateLocale(), { day: "2-digit", month: "2-digit" });
const color = (cls: string) => classColor(cls) ?? "var(--line-2)";

export function PlayerSheet({ groupId, userId, officer, onClose }: { groupId: string; userId: string; officer: boolean; onClose: () => void }) {
  // Ses persos s'ouvrent dans Mes persos ; ceux d'un autre joueur, en lecture dans les fiches de la guilde (Forever : Membres › Persos)
  const myId = useMe().data?.user?.id;
  const gt = useGameText();
  const charUrl = (id: string) => (userId === myId ? `/persos/${id}` : gt.game === "forever" ? `/groups/${groupId}/membres/persos?vue=fiches&perso=${id}` : `/groups/${groupId}/persos?perso=${id}`);
  const { data, isLoading } = useQuery({ queryKey: ["player-sheet", groupId, userId], queryFn: () => get<Sheet>(`/groups/${groupId}/members/${userId}/sheet`) });
  if (isLoading || !data) return <p className="muted">{t("Chargement…")}</p>;
  const { member: m, characters, attendance: a, loot } = data;
  const main = characters.find(c => c.isMain);
  const bis = main?.gearStats;
  return (
    <section className="ps" aria-label={t("Fiche de {name}", { name: m.displayName })}>
      <header className="ps-head">
        <span className="avatar" style={{ width: 44, height: 44 }}><Portrait id={m.avatarId} size={44} fallback={<span>{m.displayName[0]}</span>} /></span>
        <div><h3>{m.displayName}</h3><span className="muted small">{t("Membre depuis le {date}", { date: day().format(new Date(m.joinedAt)) })}{m.discordLinked ? t(" · Discord lié") : ""}</span></div>
        <span className="tag">{roleLabel(m.role)}</span>
        <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onClose}>{t("Fermer")}</button>
      </header>
      {data.absences.length > 0 && (
        <p className="ps-abs">{t("Absent")}{data.absences.map((a, i) => <span key={i}>{i ? " ; " : " "}{absenceLabel(a)}{a.reason && <span className="muted"> ({a.reason})</span>}</span>)}</p>
      )}
      <div className="ps-kpis">
        <div><b className="num">{a.raids ? `${a.attended}/${a.raids}` : "—"}</b><span>{t("raids venus")}</span></div>
        <div><b className="num">{a.benched}</b><span>{t("fois sur le banc")}</span></div>
        <div title={data.lootCount.by === "player" ? t("Objets de spé principale reçus {period}, main et alts ensemble", { period: data.lootCount.label }) : t("Objets de spé principale reçus {period}", { period: data.lootCount.label })}><b className="num">{data.lootCount.player}</b><span>{data.lootCount.player > 1 ? t("objets · {period}", { period: data.lootCount.short }) : t("objet · {period}", { period: data.lootCount.short })}</span><LootDetail detail={data.lootCount.detail} /></div>
        {gt.game !== "retail" && <div><b className="num">{bis ? `${bis.got}/${bis.total}` : "—"}</b><span>{t("BiS du main")}</span></div>}
      </div>
      <div className="ps-cols">
        <div>
          <h4 className="gm-sec">{t("Persos dans la guilde")}</h4>
          {characters.length === 0 ? <p className="muted small">{t("Aucun perso choisi pour cette guilde.")}</p> : (
            <ul className="ps-chars">
              {characters.map(c => (
                <li key={c.id}>
                  <Link to={charUrl(c.id)} className="ps-char">
                    <span className="gav" style={{ ["--cc" as string]: color(c.cls), width: 30, height: 30 }}>
                      <Portrait id={c.portraitId} size={30} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={22} /> : <ClassIcon cls={c.cls} size={22} />) : <span className="muted">?</span>} />
                    </span>
                    <span className="ps-cn">
                      <span>{c.isMain ? <span className="gm-star">★</span> : <span className="gm-alt">{t("alt")}</span>}<b style={{ color: color(c.cls) }}>{c.name}</b></span>
                      <small>{[gt.spec(c.cls, c.spec1), gt.spec(c.cls, c.spec2)].filter(Boolean).join(" · ") || gt.cls(c.cls) || t("À configurer")} · {t("niv. {n}", { n: c.level })}</small>
                    </span>
                    <span className="num small muted">{c.gearStats.ilvl != null ? `ilvl ${String(c.gearStats.ilvl).replace(".", ",")}` : ""}</span>
                    <span className="ps-prog"><span className="rl-bar" aria-hidden="true"><i style={{ width: `${Math.round(c.gearStats.got / c.gearStats.total * 100)}%` }} className={c.gearStats.got / c.gearStats.total < .5 ? "low" : ""} /></span>
                      <span className="num small">{c.gearStats.got}/{c.gearStats.total} BiS</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="gm-sec">{t("Présence")} · {a.raids ? t("{n} derniers raids relevés", { n: a.raids }) : t("aucun raid relevé")}</h4>
          {a.raids > 0 && (
            <div className="ps-cells">
              {a.cells.map(c => (
                <Link key={c.raidId} to={`/groups/${groupId}/raids/${c.raidId}`} className={`ps-cell ${c.status ?? "none"}`} title={`${c.name} · ${day().format(new Date(c.scheduledAt))} · ${c.status ? attendanceLabel(c.status) : t("ni inscrit ni vu")}`}>
                  {c.status ? (getLang() === "en" ? CELL_EN : CELL_FR)[c.status] : "·"}
                </Link>
              ))}
            </div>
          )}
          <h4 className="gm-sec" style={{ marginTop: 14 }}>{t("Butin reçu")}</h4>
          <LootCount groupId={groupId} userId={userId} count={data.lootCount} officer={officer} />
          {loot.length === 0 ? <p className="muted small" style={{ margin: "6px 0 0" }}>{t("Rien de relevé pour l'instant.")}</p> : (
            <ul className="ps-loot">
              {loot.map((l, i) => (
                <li key={`${l.itemId}-${l.at}-${i}`}>
                  <ExternalLink className={`q${l.quality}`} href={gt.game === "retail" ? retailItemLink(l.itemId, gt.lang) : itemLinks(l.itemId).wowhead}>[{l.name}]</ExternalLink>
                  <span className="muted small"> · {l.character}{l.boss ? ` · ${l.boss}` : ""} · <Link to={`/groups/${groupId}/raids/${l.raidId}/bilan`}>{l.raidName}</Link></span>
                  {l.bis && <span className="rl-chip ok" style={{ marginLeft: 6 }}>{t("BiS ✓")}</span>}
                  {(l.skip || l.excluded) && <span className="rl-chip muted" style={{ marginLeft: 6 }} title={t("Ne compte pas dans les objets reçus")}>{l.skip ? t("ne compte pas · {reason}", { reason: l.skip }) : t("ne compte pas")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Objets reçus sur la période du groupe (lot I) : total et son détail (BiS, Upgrade, jets MS), total par perso,
 * corrections des officiers (± avec motif, catégorie facultative).
 */
function LootCount({ groupId, userId, count, officer }: { groupId: string; userId: string; count: Sheet["lootCount"]; officer: boolean }) {
  const qc = useQueryClient();
  const [charId, setCharId] = useState(count.characters[0]?.characterId ?? "");
  const [delta, setDelta] = useState(1);
  const [kind, setKind] = useState<LootCategory | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameOf = new Map(count.characters.map(c => [c.characterId, c.name]));
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["player-sheet", groupId, userId] }), qc.invalidateQueries({ queryKey: ["attendance", groupId] })]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof ApiError ? e.message : t("Enregistrement impossible.")); }
  };
  const add = () => run(async () => { await post(`/groups/${groupId}/loot-corrections`, { characterId: charId, delta, note, kind: kind || null }); setNote(""); });
  return (
    <div>
      <div className="lc-sum">
        <span>{tx(isMany(count.player) ? "{n} objets {period}" : "{n} objet {period}", { n: <b className="num">{count.player}</b>, period: count.label })}</span>
        <LootDetail detail={count.detail} />
        {count.characters.length > 1 && <span className="muted small">{count.by === "player" ? t("main et alts ensemble : ") : t("par perso : ")}{count.characters.map(c => `${c.name} ${c.own}`).join(" · ")}</span>}
      </div>
      {count.corrections.length > 0 && (
        <ul className="lc-corr" aria-label={t("Corrections des officiers")}>
          {count.corrections.map(c => (
            <li key={c.id} className={c.inPeriod ? undefined : "out"} title={c.inPeriod ? undefined : t("Avant le début de la période : ne compte plus")}>
              <span className={`d num ${c.delta > 0 ? "plus" : "minus"}`}>{c.delta > 0 ? `+${c.delta}` : c.delta}</span>
              {c.kind && <span className="lc-kind">{lootCategoryLabel(c.kind)}</span>}
              <span>{nameOf.get(c.characterId) ?? "?"} · {c.note} <span className="muted small">· {c.by}, {day().format(new Date(c.at))}</span></span>
              {officer && <button type="button" className="btn ghost xs" onClick={() => void run(() => del(`/groups/${groupId}/loot-corrections/${c.id}`))} aria-label={t("Retirer la correction {note}", { note: c.note })}>{t("Retirer")}</button>}
            </li>
          ))}
        </ul>
      )}
      {officer && count.characters.length > 0 && (
        <form className="lc-form" onSubmit={e => { e.preventDefault(); void add(); }}>
          {count.characters.length > 1 && <div className="fld"><label htmlFor="lc-char">{t("Perso")}</label>
            <select id="lc-char" value={charId} onChange={e => setCharId(e.target.value)}>{count.characters.map(c => <option key={c.characterId} value={c.characterId}>{c.name}</option>)}</select></div>}
          <div className="fld"><label htmlFor="lc-delta">{t("Correction")}</label>
            <select id="lc-delta" value={delta} onChange={e => setDelta(Number(e.target.value))}>{[3, 2, 1, -1, -2, -3].map(n => <option key={n} value={n}>{n > 0 ? `+${n}` : n}</option>)}</select></div>
          <div className="fld"><label htmlFor="lc-kind">{t("Catégorie")}</label>
            <select id="lc-kind" value={kind} onChange={e => setKind(e.target.value as LootCategory | "")}>
              <option value="">{t("Aucune")}</option>{LOOT_CATEGORIES.map(k => <option key={k} value={k}>{lootCategoryLabel(k)}</option>)}
            </select></div>
          <div className="fld" style={{ flex: "1 1 200px" }}><label htmlFor="lc-note">{t("Motif")}</label>
            <input id="lc-note" type="text" maxLength={120} required minLength={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t("Ex. objet donné hors addon")} /></div>
          <button type="submit" className="btn sm">{t("Corriger le compte")}</button>
        </form>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}
    </div>
  );
}
