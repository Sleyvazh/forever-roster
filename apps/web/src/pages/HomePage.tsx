import { openSync, syncState } from "../syncPanel";
import { CLASS_SPECS, firstNameOf, zonedParts, type HomeAgendaItem, type HomeFind, type SpecDef } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, patch, post, put, type Character, type GroupDetail } from "../api";
import { useMe } from "../auth";
import { daysUntil, longDay, seenText, useGuildHome, useGuildLink, useGuildMembers } from "../guild";
import { absenceLabel, MyAbsences, type Absence } from "../components/Absences";
import { GuildHead, InviteButton } from "../components/GuildHead";
import { QuestionBand, refreshGuild } from "../components/GuildMembers";
import { CharName, Place, Podium } from "../components/GuildRace";
import { FactionBadge } from "../components/Icons";
import { ClassDot } from "../components/Outings";
import { AnswerState, QuickAnswerButtons, useQuickAnswer } from "../components/QuickAnswer";
import { useWeek, whenText, type WeekRaid } from "../components/Week";
import { useGameText } from "../gameText";
import type { Reach } from "../components/RaidReach";
import { dateLocale, getLang, t, tn, tx } from "../i18n";
import { dayTitle } from "../i18n/dates";

/**
 * Accueil d'une guilde de Forever (refonte du 23/10, revue le 09/11 : lot 2 de la refonte UX, maquette maquette-accueil.png).
 * - Gauche : aujourd'hui et demain (raids et sorties, lignes entières cliquables, réponses 3 + Autre de même largeur,
 *   inscription optimiste), les raids plus tard dans la semaine, « Trouver quoi faire » (donjons à mon niveau, joueurs à
 *   3 niveaux près repliés).
 * - Droite : une seule carte « À faire » pour tous (mes actions, puis une partie Officiers ou Banque), mes persos (âge de la
 *   synchro) et mes absences, la Course au 60 pendant la course et encore 3 jours après la fin.
 * - Les arrivées et départs ont quitté l'Accueil (Guilde › Historique). Squelettes au chargement ; erreurs avec la solution.
 * Données : GET /groups/:id/home (lot Guilde, dont `find`), GET /week, GET /characters.
 */

const ROLE_WORD = { Tank: "tank", Heal: "heal", DPS: "DPS" } as const;
const errorOf = (e: unknown, def?: string) => (e instanceof ApiError ? e.message : def ?? t("Action impossible."));
/** Erreur d'une inscription : le message du site, ou la connexion perdue (avec « Réessayer »). */
type RowError = { msg: string; retry: boolean };
const rowError = (e: unknown): RowError => (e instanceof ApiError ? { msg: e.message, retry: false } : { msg: t("Pas enregistré · connexion perdue."), retry: true });
const DAY_MS = 86400e3;
/** La Course au 60 reste sur l'Accueil 3 jours après la fin (podium final), puis passe au Palmarès. */
const RACE_AFTER_DAYS = 3;
const hm = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const parisDay = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(typeof iso === "string" ? new Date(iso) : iso);
function missingText(m: { tank: number; heal: number; dps: number }) {
  const parts = [m.tank && tn(m.tank, "{n} tank", "{n} tanks"), m.heal && tn(m.heal, "{n} heal", "{n} heals"), m.dps && `${m.dps} DPS`].filter(Boolean);
  return parts.length ? t("manque {list}", { list: parts.join(", ") }) : "";
}

function useMyChars() {
  return useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
}
/** Mes persos qui comptent pour cette guilde : rangés dedans (main en tête), puis sans guilde. */
function charsFor(all: Character[], groupId: string) {
  return all.filter(c => !c.group || c.group.id === groupId).sort((a, b) => Number(!!b.group?.isMain && b.group.id === groupId) - Number(!!a.group?.isMain && a.group.id === groupId));
}

/** Rafraîchit ce qui dépend d'une inscription ou d'un perso. */
function useRefresh(groupId: string) {
  const qc = useQueryClient();
  return () => Promise.all([refreshGuild(qc, groupId), qc.invalidateQueries({ queryKey: ["outings", groupId] }), qc.invalidateQueries({ queryKey: ["raids", groupId] }),
    qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["raid"] })]);
}

/* ---------- Un raid (aujourd'hui, demain ou plus tard) : inscription en un clic ---------- */

interface RaidLine {
  id: string; name: string; at: string; size?: number;
  counts: { coming: number; tank: number; heal: number; dps: number; tentative: number };
  mine: { status: string; characterId: string | null; spec?: string } | null; mainId: string | null;
}
const fromHome = (a: Extract<HomeAgendaItem, { kind: "raid" }>): RaidLine => ({ id: a.id, name: a.name, at: a.at, size: a.size, counts: a.counts, mine: a.mine, mainId: a.mainId });
const fromWeek = (r: WeekRaid): RaidLine => ({ id: r.id, name: r.name, at: r.scheduledAt, counts: r.counts, mine: r.mine ? { status: r.mine.status, characterId: r.mine.characterId } : null, mainId: r.mainId });

/** Erreur d'une ligne de l'agenda, avec la solution (« Réessayer » si la connexion est perdue). */
function RowErr({ err, onRetry }: { err: RowError | null; onRetry: () => void }) {
  if (!err) return null;
  return <span className="ans-err" role="alert">{err.msg}{err.retry && <> <button type="button" className="link" onClick={onRetry}>{t("Réessayer")}</button></>}</span>;
}

function RaidRow({ groupId, r, when, chars }: { groupId: string; r: RaidLine; when: ReactNode; chars: Character[] }) {
  const refresh = useRefresh(groupId);
  const qa = useQuickAnswer({ groupId, raidId: r.id, mine: r.mine, mainId: r.mainId, chars, refresh });
  const c = r.counts;
  return (
    <li className={`ag ag-raid${qa.status && qa.status !== "absent" ? " in" : ""}`}>
      {when}
      <span className="ag-main">
        <Link className="ag-t stretch" to={`/groups/${groupId}/raids/${r.id}`}><span className="kind k-raid">{t("Raid")}</span>{r.name}{r.size ? <span className="lvn">{r.size}</span> : null}</Link>
        <span className="ag-s">{tn(c.coming, "{n} vient", "{n} viennent")} · {tn(c.tank, "{n} tank", "{n} tanks")} · {tn(c.heal, "{n} heal", "{n} heals")} · {c.dps} DPS{c.tentative ? ` · ${t("{n} peut-être", { n: c.tentative })}` : ""}</span>
      </span>
      <AnswerState status={qa.status} />
      <QuickAnswerButtons qa={qa} label={t("Ma réponse pour {raid}", { raid: r.name })} className="ag-ans" />
    </li>
  );
}

/* ---------- Une sortie : « + Heal » avec mon perso qui a le niveau ---------- */

function OutingRow({ groupId, a, today }: { groupId: string; a: Extract<HomeAgendaItem, { kind: "outing" }>; today: string }) {
  const refresh = useRefresh(groupId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<RowError | null>(null);
  const n = a.places.tank + a.places.heal + a.places.dps;
  const placed = n - a.missing.tank - a.missing.heal - a.missing.dps;
  const role = a.mine ? ROLE_WORD[a.mine.role as keyof typeof ROLE_WORD] ?? a.mine.role : "";
  const me = a.mine?.characterName ? (a.full ? t("tu viens avec {name}", { name: a.mine.characterName }) : t("tu viens en {role} avec {name}", { role, name: a.mine.characterName })) : null;
  const sub = a.full
    ? [t("Complète"), a.waiting ? t("{n} en attente", { n: a.waiting }) : null, me ?? (a.mine?.creator ? null : t("par {name}", { name: a.creator }))]
    : [`${placed}/${n}`, missingText(a.missing), me ?? (a.mine?.creator ? t("par toi") : t("par {name}", { name: a.creator }))];
  const s = a.suggest[0];
  const join = async () => {
    if (!s || busy) return;
    setBusy(true); setErr(null);
    try { await put(`/groups/${groupId}/outings/${a.id}/signup`, { role: s.role, characterId: s.characterId, wait: false }); await refresh(); }
    catch (e) { setErr(rowError(e)); }
    finally { setBusy(false); }
  };
  return (
    <li className={`ag${a.mine ? " in" : s ? " can" : ""}`}>
      <span className="ag-when"><small>{a.day === today ? t("Auj.") : t("Dem.")}</small>{a.at ? <b>{hm(a.at)}</b> : <span className="asap">{t("dès que complet")}</span>}</span>
      <span className="ag-main">
        <Link className="ag-t stretch" to={`/groups/${groupId}/sorties`}>{a.title} {a.levels && <span className="lvn">{a.levels}</span>}</Link>
        <span className="ag-s">{sub.filter(Boolean).join(" · ")}</span>
        <RowErr err={err} onRetry={() => void join()} />
      </span>
      <span className="ag-end">
        {a.mine ? <>{a.mine.creator ? <span className="tag gold">{t("Ta sortie")}</span> : a.mine.waiting ? <span className="tag warn">{t("En attente")}</span> : <span className="tag gold">{t("Inscrit")}</span>}<small>{placed}/{n}</small></>
          : s ? <>
              <button type="button" className="so-join" disabled={busy} title={t("T'inscrire en {role} avec {name}", { role: ROLE_WORD[s.role], name: s.characterName })} onClick={() => void join()}>+ {s.role}</button>
              <small>{t("avec {name}", { name: s.characterName })}</small></>
          : a.full ? <Link className="btn ghost sm" to={`/groups/${groupId}/sorties`}>{t("Me mettre en attente")}</Link>
          : null}
      </span>
    </li>
  );
}

/* ---------- À faire : une seule carte pour tous (refonte du 09/11) ---------- */

interface TodoItem { key: string; n?: number; t: ReactNode; sub?: ReactNode; action: ReactNode; wide?: boolean }

/**
 * Mes actions (perso à ajouter, synchro, raids sans réponse, spé manquante, perso à choisir), puis, pour les officiers, ce
 * qui attend la guilde (sans réponse au prochain raid, persos à rattacher, commandes, avis, guilde du jeu à lier) et les
 * demandes de retrait (officiers et banquiers). Mot-clé en tête ; la carte disparaît quand il n'y a rien.
 */
function TodoCard({ groupId, groupName, chars, officer, nextRaid, feedback, bankPending, linked }: {
  groupId: string; groupName: string; chars: Character[]; officer: boolean; nextRaid: RaidLine | null;
  feedback: number; bankPending: number; linked: boolean;
}) {
  const week = useWeek();
  const gt = useGameText();
  const refresh = useRefresh(groupId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const all = useMyChars().data?.characters;
  // Un banquier (qui n'est pas officier) ne voit que les demandes de retrait : le reste est réservé aux officiers
  const members = useGuildMembers(groupId, officer);
  const orders = useQuery({ queryKey: ["orders", groupId], queryFn: () => get<{ orders: { status: string; recipeName: string; item: { name: string } | null; requester: { name: string } }[] }>(`/groups/${groupId}/orders`), enabled: officer });
  const reach = useQuery({ queryKey: ["reach", nextRaid?.id], queryFn: () => get<Reach>(`/groups/${groupId}/raids/${nextRaid!.id}/reach`), enabled: officer && !!nextRaid });
  const base = `/groups/${groupId}`;
  const todo = week.data?.todo ?? [];

  const mine: TodoItem[] = [];
  if (all && !all.length) mine.push({ key: "none", t: <><b>{t("Ton perso")}</b> · {t("ajoute-le pour t'inscrire aux raids et aux sorties")}</>,
    action: <Link className="btn sm primary" to="/persos/nouveau">{t("Ajouter un perso")}</Link> });
  // Persos pas synchronisés depuis 7 jours (refonte 09/11) : une seule ligne, qui ouvre le panneau Synchro
  const late = todo.filter(td => td.kind === "sync");
  if (late.length) mine.push({ key: "sync", t: <><b>{t("Synchro")}</b> · {tn(late.length, "{n} perso à mettre à jour", "{n} persos à mettre à jour")}</>,
    action: <button type="button" className="btn sm" onClick={openSync}>{t("Ouvrir la synchro")}</button> });
  for (const td of todo) {
    if (td.kind === "signup" && td.groupId === groupId) {
      mine.push({ key: `su-${td.raidId}`, t: <><b>{td.name}</b> · {t("pas encore répondu")}</>, sub: whenText(td.scheduledAt),
        action: <Link className="btn sm" to={`${base}/raids/${td.raidId}`} aria-label={t("Répondre pour {raid}", { raid: td.name })}>{t("Répondre")}</Link> });
    } else if (td.kind === "incomplete") {
      const c = chars.find(x => x.id === td.characterId) ?? all?.find(x => x.id === td.characterId);
      if (!c) continue;
      const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? [];
      const pickSpec = td.missing === "spé" && specs.length > 0;
      mine.push({ key: `inc-${td.characterId}`, wide: pickSpec,
        t: <><CharName name={c.name} cls={c.cls} /> · {td.missing === "classe" ? t("pas de classe") : pickSpec ? t("pas de spé : choisis-la pour t'inscrire") : t("pas de spé")}</>,
        action: pickSpec
          ? <span className="acts" role="group" aria-label={t("Spé de {name}", { name: c.name })}>{specs.map(x => <button key={x.name} type="button" className="btn sm" disabled={busy === td.characterId}
              onClick={() => void run(td.characterId, () => patch(`/characters/${c.id}`, { spec1: x.name }))}>{gt.spec(c.cls, x.name)}</button>)}</span>
          : <Link className="btn sm" to={`/persos/${c.id}`}>{t("Compléter la fiche")}</Link> });
    } else if (td.kind === "assign" && td.groupId === groupId) {
      const free = chars.filter(c => !c.group && c.cls);
      mine.push({ key: "assign", wide: free.length > 0, t: <><b>{t("Ton perso")}</b> · {t("à choisir dans {guild}", { guild: groupName })}</>,
        action: free.length
          ? <span className="acts" role="group" aria-label={t("Ton perso dans {guild}", { guild: groupName })}>{free.map(c => <button key={c.id} type="button" className="btn sm" disabled={busy === "assign"}
              onClick={() => void run("assign", () => put(`${base}/characters/${c.id}`, { assigned: true, main: true }))}>{c.name}</button>)}</span>
          : <Link className="btn sm" to="/persos">{t("Mes persos")}</Link> });
    }
  }

  const guild: TodoItem[] = [];
  // Demandes de retrait à la banque (officiers et banquiers) : en tête, c'est ce qu'un joueur attend le plus
  if (bankPending) guild.push({ key: "bank", n: bankPending, t: <><b>{t("Banque")}</b> · {bankPending > 1 ? t("demandes de retrait") : t("demande de retrait")}</>, sub: t("Guilde › Banque"),
    action: <Link className="btn sm" to={`${base}/membres/banque`}>{t("Voir")}</Link> });
  const r = reach.data;
  if (officer && nextRaid && r && r.pending.length) {
    const auto = !r.discordLinked ? t("pas de salon Discord lié") : r.auto.sentAt ? t("relance automatique faite") : r.auto.at ? t("relance automatique {when}", { when: whenText(r.auto.at) }) : null;
    const can = r.discordLinked && !r.manual.queued && (!r.manual.nextAt || Date.parse(r.manual.nextAt) <= Date.now());
    guild.push({ key: "reach", n: r.pending.length, t: <><b>{nextRaid.name}</b> · {t("sans réponse")}</>, sub: [whenText(nextRaid.at), auto].filter(Boolean).join(" · "),
      action: can
        ? <button type="button" className="btn sm" disabled={busy === "nudge"} onClick={() => void (async () => {
            setBusy("nudge"); setMsg(null);
            try { const x = await post<{ count: number }>(`${base}/raids/${nextRaid.id}/nudge`); setMsg(tn(x.count, "Relance envoyée à {n} joueur.", "Relance envoyée à {n} joueurs.")); await qc.invalidateQueries({ queryKey: ["reach", nextRaid.id] }); }
            catch (e) { setMsg(errorOf(e, t("Relance impossible."))); } finally { setBusy(null); }
          })()}>{t("Relancer")}</button>
        : <Link className="btn sm" to={`${base}/raids/${nextRaid.id}`}>{t("Voir")}</Link> });
  }
  const un = officer ? (members.data?.unattached ?? []) : [];
  if (un.length) {
    const sug = un.filter(u => u.suggestion?.target).length;
    guild.push({ key: "attach", n: un.length, t: <><b>{t("Rattacher")}</b> · {un.length > 1 ? t("persos de la guilde") : t("perso de la guilde")}</>, sub: sug ? tn(sug, "{n} suggestion par les notes de guilde", "{n} suggestions par les notes de guilde") : t("pas encore de joueur"),
      action: <Link className="btn sm" to={`${base}/membres/joueurs`}>{t("Voir")}</Link> });
  }
  const open = officer ? (orders.data?.orders ?? []).filter(o => o.status === "open") : [];
  if (open.length) {
    const o = open[0]!;
    guild.push({ key: "orders", n: open.length, t: <><b>{open.length > 1 ? t("Commandes") : t("Commande")}</b> · {t("sans artisan")}</>, sub: t("{item}, pour {name}", { item: o.item?.name ?? o.recipeName, name: o.requester.name }),
      action: <Link className="btn sm" to={`${base}/membres/artisans`}>{t("Voir")}</Link> });
  }
  if (officer && feedback) guild.push({ key: "avis", n: feedback, t: <><b>{t("Avis Discord")}</b> · {t("à lire")}</>, sub: t("Administration › Avis"),
    action: <Link className="btn sm" to={`${base}/admin?section=avis`}>{t("Lire")}</Link> });
  if (officer && !linked) guild.push({ key: "gg", t: <><b>{t("Guilde du jeu")}</b> · {t("pas encore liée")}</>, sub: t("elle se lie toute seule à ta prochaine synchro, addon à jour"),
    action: <button type="button" className="btn sm" onClick={openSync}>{t("Ouvrir la synchro")}</button> });

  if (!mine.length && !guild.length) return null;
  const row = (i: TodoItem) => (
    <li key={i.key} className={`${i.n ? "has-n" : ""}${i.wide ? " wide" : ""}`}>
      {i.n ? <span className="tt-n">{i.n}</span> : null}
      <span className="t">{i.t}{i.sub && <small>{i.sub}</small>}</span>
      {i.action}
    </li>
  );
  return (
    <section className="hm-card td" style={{ ["--o" as string]: 0 } as CSSProperties} aria-labelledby="hm-td">
      <div className="hm-h"><h3 id="hm-td">{t("À faire")}</h3></div>
      {mine.length > 0 && <ul className="td-list" aria-label={t("Pour toi")}>{mine.map(row)}</ul>}
      {guild.length > 0 && <>
        <span className="lbl td-sec">{officer ? t("Officiers") : t("Banque")}</span>
        <ul className="td-list" aria-label={officer ? t("Pour les officiers") : t("Pour les banquiers")}>{guild.map(row)}</ul>
      </>}
      {err && <p className="td-msg bad" role="alert">{err}</p>}
      {msg && <p className="td-msg" role="status">{msg}</p>}
    </section>
  );
}

/* ---------- Mes persos et mes absences ---------- */

function MyCharsCard({ groupId, chars }: { groupId: string; chars: Character[] }) {
  const gt = useGameText();
  const abs = useQuery({ queryKey: ["absences"], queryFn: () => get<{ absences: Absence[] }>("/absences") });
  const [declaring, setDeclaring] = useState(false);
  const list = abs.data?.absences ?? [];
  // Âge de la synchro (refonte 09/11) : vert à moins de 7 jours, orange au-delà ou jamais
  const syncOf = (c: Character) => {
    const s = syncState(c.addonSyncedAt);
    return { text: `● ${s.tone === "ok" ? t("À jour · {ago}", { ago: s.ago ?? "" }) : s.ago ? s.label : t("Jamais")}`, cls: s.tone };
  };
  return (
    <section className="hm-card" style={{ ["--o" as string]: 2 } as CSSProperties} aria-labelledby="hm-me">
      <div className="hm-h"><h3 id="hm-me">{t("Mes persos")}</h3><Link className="link" to="/persos">{t("Mes persos →")}</Link></div>
      {chars.length ? (
        <ul className="mc-list">{chars.map(c => {
          const s = syncOf(c);
          const specs = [c.spec1, c.spec2].filter(Boolean).map(x => gt.spec(c.cls, x)).join(" · ");
          return (
            <li key={c.id}>
              <ClassDot cls={c.cls} spec={c.spec1 || undefined} size="md" portraitId={c.portraitId} />
              <Link className="t" to={`/persos/${c.id}`}>
                <span><CharName name={c.name} cls={c.cls} />{c.group?.id === groupId && c.group.isMain && <span className="gm-star" title={t("Main")}> ★</span>} <span className="lvn">{c.level}</span></span>
                <small>{specs || (c.cls ? t("pas de spé") : t("à compléter"))}</small>
              </Link>
              <span className={`mc-sync ${s.cls}`}>{s.text}</span>
            </li>
          );
        })}</ul>
      ) : <p className="hm-none">{t("Aucun perso pour l'instant.")} <Link className="link" to="/persos/nouveau">{t("Ajouter un perso")}</Link></p>}
      <div className="mc-foot">
        <span>{t("Absences : {list}", { list: list.length ? list.slice(0, 2).map(a => `${absenceLabel(a)}${a.reason ? ` · ${a.reason}` : ""}`).join(" ; ") : t("aucune") })}</span>
        {!declaring && <button type="button" className="link" onClick={() => setDeclaring(true)}>{t("Déclarer une absence")}</button>}
      </div>
      {declaring && <MyAbsences startOpen onDone={() => setDeclaring(false)} />}
    </section>
  );
}

/* ---------- Trouver quoi faire : donjons à mon niveau, persos de la guilde à mon niveau ---------- */

function FindCard({ groupId, find, tomorrow, canCreate }: { groupId: string; find: HomeFind; tomorrow: string; canCreate: boolean }) {
  const base = `/groups/${groupId}`;
  const { char, dungeons, mates } = find;
  const [who, setWho] = useState(false);
  const online = mates.filter(m => m.online).length;
  const count = (n: number) => (n === 0 ? t("aucun autre perso de la guilde n'a le niveau") : tn(n, "{n} perso de la guilde a le niveau", "{n} persos de la guilde ont le niveau"));
  return (
    <section className="hm-card" style={{ ["--o" as string]: 1 } as CSSProperties} aria-labelledby="tf-t">
      <div className="hm-h"><h3 id="tf-t">{t("Trouver quoi faire")}</h3><span className="tf-for">{t("pour {name} · {level}", { name: firstNameOf(char.name), level: char.level })}</span></div>
      {dungeons.length ? (
        <ul className="ag-list">{dungeons.map(d => (
          <li key={d.key} className={`ag tf-d${d.planned ? "" : " can"}`}>
            <div className="ag-main">
              <span className="ag-t">{d.name} <span className="lvn">{d.min}-{d.max}</span>{d.forever && <span className="tag gold">{t("Forever")}</span>}</span>
              <span className="ag-s">{count(d.guildCount)}</span>
            </div>
            <div className="ag-end">
              {d.planned ? <Link className="link" to={`${base}/sorties`}>{d.planned.at ? (parisDay(d.planned.at) === tomorrow ? t("Sortie prévue demain à {time}", { time: hm(d.planned.at) }) : t("Sortie prévue à {time}", { time: hm(d.planned.at) })) : t("Sortie prévue (dès que complet)")} →</Link>
                : canCreate ? <Link className="btn sm" to={`${base}/sorties/nouvelle?donjon=${encodeURIComponent(d.key)}&perso=${encodeURIComponent(char.id)}`} aria-label={t("Proposer une sortie à {dungeon}", { dungeon: d.name })}>{t("Proposer")}</Link> : null}
            </div>
          </li>
        ))}</ul>
      ) : <p className="hm-none">{t("Pas de donjon à ton niveau pour l'instant.")}</p>}
      {/* Qui joue à mon niveau : une ligne, la liste au clic (refonte du 09/11) */}
      {mates.length ? (
        <div className="tf-who-box">
          <div className="tf-sum">
            <span>{tn(mates.length, "{n} perso de la guilde à 3 niveaux près", "{n} persos de la guilde à 3 niveaux près")}{online ? ` · ${t("{n} en ligne", { n: online })}` : ""}</span>
            <button type="button" className="link" aria-expanded={who} aria-controls="tf-who" onClick={() => setWho(v => !v)}>{who ? t("Masquer") : t("Voir")}</button>
          </div>
          {who && (
            <ul className="mc-list tf-who" id="tf-who">{mates.map((m, i) => {
              const seen = m.online || m.lastOnlineAt ? seenText(m.online, m.lastOnlineAt) : null;
              return (
                <li key={`${i}-${m.name}`}>
                  <ClassDot cls={m.cls} size="md" />
                  <span className="t"><span><CharName name={m.name} cls={m.cls} /> <span className="lvn">{m.level}</span></span></span>
                  {seen && <span className={`mc-sync${seen.state === "on" ? " ok" : ""}`}>{seen.text}</span>}
                </li>
              );
            })}</ul>
          )}
        </div>
      ) : <p className="hm-none">{t("Personne d'autre n'est à ton niveau pour l'instant.")}</p>}
    </section>
  );
}

/** Squelettes fidèles aux cartes (gauche : agenda, trouver quoi faire ; droite : à faire, mes persos). */
function HomeSkeleton() {
  const card = (rows: number, cls = "") => (
    <div className={`hm-card sk-card ${cls}`} aria-hidden="true"><span className="sk sk-h" />{Array.from({ length: rows }, (_, i) => <span key={i} className="sk sk-row" />)}</div>
  );
  return (
    <div className="hm" aria-busy="true" aria-label={t("Chargement de l'accueil")}>
      <div className="hm-col">{card(3)}{card(2)}</div>
      <div className="hm-col">{card(2, "sm")}{card(3, "sm")}</div>
    </div>
  );
}

/* ---------- Page ---------- */

export function HomePage({ groupId, detail }: { groupId: string; detail: GroupDetail }) {
  const me = useMe();
  const q = useGuildHome(groupId);
  const week = useWeek();
  const gg = useGuildLink(groupId).data?.link;
  const allChars = useMyChars().data?.characters ?? [];
  const chars = charsFor(allChars, groupId);
  const { group, role } = detail;
  const officer = role !== "member";
  const d = q.data;
  const base = `/groups/${groupId}`;
  const name = me.data?.user?.displayName ?? "";
  const hour = zonedParts(new Date()).hour;
  const evening = hour >= 18 || hour < 5;
  const hello = name ? (evening ? t("Bonsoir, {name}", { name }) : t("Bonjour, {name}", { name })) : evening ? t("Bonsoir") : t("Bonjour");
  const r = d?.race;
  const course = !r ? null : r.started ? (r.day && !r.endedAt ? t("jour {n} de la course", { n: r.day }) : null)
    : (() => { const n = daysUntil(r.startsAt); return n > 1 ? t("la sortie dans {n} jours", { n }) : n === 1 ? t("la sortie demain") : t("la sortie cette nuit"); })();
  const meta = <>
    {gg && (gg.faction === "Horde" || gg.faction === "Alliance") && <FactionBadge faction={gg.faction} size={20} />}
    <span>{longDay(new Date().toISOString())}</span>
    {course && <><span aria-hidden="true">·</span><span>{course}</span></>}
  </>;
  const head = <GuildHead groupId={groupId} name={group.name} title={hello} meta={meta} actions={officer ? <InviteButton groupId={groupId} groupName={group.name} /> : undefined} />;
  if (!d) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        {head}
        {q.error
          ? <div className="alert error" role="alert">{t("Accueil indisponible : vérifie ta connexion.")} <button type="button" className="link" onClick={() => void q.refetch()}>{t("Réessayer")}</button></div>
          : <HomeSkeleton />}
      </div>
    );
  }

  const raidsToday = d.agenda.filter((a): a is Extract<HomeAgendaItem, { kind: "raid" }> => a.kind === "raid");
  const later = (week.data?.raids ?? []).filter(x => x.groupId === groupId && !d.agenda.some(a => a.kind === "raid" && a.id === x.id) && parisDay(x.scheduledAt) > d.tomorrow);
  const nextRaid = raidsToday[0] ? fromHome(raidsToday[0]) : later[0] ? fromWeek(later[0]) : null;
  const plus = group.creators.canCreateOuting && <Link className="btn sm" to={`${base}/sorties/nouvelle`}>{t("+ Sortie")}</Link>;
  const whenOf = (iso: string) => <span className="ag-when"><small>{parisDay(iso) === d.today ? t("Auj.") : parisDay(iso) === d.tomorrow ? t("Dem.") : dayTitle(zonedParts(new Date(iso)).weekday).slice(0, 3) + (getLang() === "fr" ? "." : "")}</small><b>{hm(iso)}</b></span>;

  const agenda = (
    <section className="hm-card" style={{ ["--o" as string]: 1 } as CSSProperties} aria-labelledby="hm-ag">
      <div className="hm-h"><h3 id="hm-ag">{t("Aujourd'hui et demain")}</h3>{plus}</div>
      {d.agenda.length ? (
        <ul className="ag-list">{d.agenda.map(a => a.kind === "raid"
          ? <RaidRow key={`r-${a.id}`} groupId={groupId} r={fromHome(a)} when={whenOf(a.at)} chars={chars} />
          : <OutingRow key={`o-${a.id}`} groupId={groupId} a={a} today={d.today} />)}</ul>
      ) : (
        <div className="ag-empty"><p><b>{t("Rien de prévu.")}</b> {r && !r.started ? t("Les sorties ouvrent avec le jeu, le 5 novembre.") : group.creators.canCreateOuting ? t("Propose une sortie : la guilde la voit ici, sur Discord et en jeu.") : null}</p></div>
      )}
      {later.length > 0 && (
        <div className="ag-later"><span className="lbl">{t("Plus tard cette semaine")}</span>
          <ul className="ag-list">{later.map(x => <RaidRow key={x.id} groupId={groupId} r={fromWeek(x)} when={whenOf(x.scheduledAt)} chars={chars} />)}</ul></div>
      )}
      {d.outings.total > 0 && (
        <div className="hm-foot">
          <Link className="link" to={`${base}/sorties`}>{t("Toutes les sorties ({n}) →", { n: d.outings.total })}</Link>
          {d.outings.hidden > 0 && <span className="small">{tn(d.outings.hidden, "{n} autre n'est pas pour tes persos", "{n} autres ne sont pas pour tes persos")}</span>}
        </div>
      )}
    </section>
  );

  // Course au 60 : pendant la course, et encore 3 jours après la fin (podium final) ; ensuite, Guilde › Course au 60
  const raceShown = !!r && (!r.endedAt || Date.now() - Date.parse(r.endedAt) < RACE_AFTER_DAYS * DAY_MS);
  const race = r && raceShown && (
    <section className="hm-card" style={{ ["--o" as string]: 3 } as CSSProperties} aria-labelledby="hm-race">
      <div className="hm-h"><h3 id="hm-race">{t("Course au 60")} <small>{r.endedAt ? t("terminée") : r.started ? (r.day ? t("jour {n}", { n: r.day }) : "") : t("départ le {date}", { date: new Date(r.startsAt).toLocaleDateString(dateLocale(), { day: "numeric", month: "numeric", timeZone: "Europe/Paris" }) })}</small></h3>
        <Link className="link" to={`${base}/membres/course`}>{t("Voir la course →")}</Link></div>
      {!r.started ? (
        <div className="hm-empty"><b className="num">J-{daysUntil(r.startsAt)}</b>
          <p>{tx("La course part à la sortie, {when}. Les niveaux viennent de la liste de guilde relevée par l'addon : rien à faire.", { when: <b>{t("{day} à 00:00", { day: getLang() === "fr" ? longDay(r.startsAt).toLowerCase() : longDay(r.startsAt) })}</b> })}</p></div>
      ) : !r.linked ? <p className="hm-none">{t("La course se remplit avec la liste de guilde, dès que la guilde du jeu est liée.")}</p>
        : !r.podium.length ? <p className="hm-none">{t("Personne dans la course pour l'instant.")}</p> : <>
          <Podium places={r.podium} mini />
          {r.me ? (
            <div className="me-line"><b className="rank"><Place n={r.me.rank} /></b><span>{tx("Toi, {name} niveau {level}", { name: <CharName name={r.me.name} cls={r.me.cls} as="span" />, level: r.me.level })}</span>
              {r.me.weekGain > 0 && <span className="ok-t">{t("+{n} cette semaine", { n: r.me.weekGain })}</span>}</div>
          ) : <p className="hm-none small">{t("Ton perso n'est pas encore dans la liste de guilde.")}</p>}
        </>}
    </section>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      {head}
      <QuestionBand groupId={groupId} questions={d.questions} />
      <div className="hm">
        <div className="hm-col">{agenda}{d.find && <FindCard groupId={groupId} find={d.find} tomorrow={d.tomorrow} canCreate={group.creators.canCreateOuting} />}</div>
        <div className="hm-col">
          <TodoCard groupId={groupId} groupName={group.name} chars={chars} officer={officer} nextRaid={nextRaid}
            feedback={officer ? detail.feedback?.unseen ?? 0 : 0} bankPending={d.bankRequests ?? 0} linked={d.guild.linked} />
          <MyCharsCard groupId={groupId} chars={chars} />
          {race}
        </div>
      </div>
    </div>
  );
}
