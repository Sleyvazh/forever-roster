import { CLASS_SPECS, zonedParts, type HomeAgendaItem, type SignupStatus, type SpecDef } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError, get, patch, post, put, type Character, type GroupDetail } from "../api";
import { useMe } from "../auth";
import { daysUntil, longDay, shortDay, useGuildHome, useGuildLink, useGuildMembers } from "../guild";
import { absenceLabel, MyAbsences, type Absence } from "../components/Absences";
import { GuildHead, InviteButton } from "../components/GuildHead";
import { moveClass, MoveSign, moveText, QuestionBand, refreshGuild } from "../components/GuildMembers";
import { CharName, Place, Podium } from "../components/GuildRace";
import { FactionBadge } from "../components/Icons";
import { ClassDot } from "../components/Outings";
import { SignupButtons } from "../components/SignupButtons";
import { useWeek, whenText, type WeekRaid } from "../components/Week";
import { useGameText } from "../gameText";
import type { Reach } from "../components/RaidReach";

/**
 * Accueil d'une guilde de Forever (refonte du 23/10) : la page d'arrivée. « À faire » (ce qui bloque, corrigé sur place),
 * aujourd'hui et demain (raids et sorties, inscription en un clic) et les raids de la semaine, mes persos et mes absences,
 * la Course au 60 et ma place, les arrivées et départs ; pour les officiers, « À traiter » et « Inviter ».
 * Données : GET /groups/:id/home (lot Guilde), GET /week, GET /characters ; rien de neuf côté API.
 */

const ROLE_WORD = { Tank: "tank", Heal: "heal", DPS: "DPS" } as const;
const errorOf = (e: unknown, def = "Action impossible.") => (e instanceof ApiError ? e.message : def);
const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n > 1 ? ws : w}`;
const hm = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const parisDay = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(typeof iso === "string" ? new Date(iso) : iso);
const DAY_CAP = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."];

function missingText(m: { tank: number; heal: number; dps: number }) {
  const parts = [m.tank && `${m.tank} tank${m.tank > 1 ? "s" : ""}`, m.heal && `${m.heal} heal${m.heal > 1 ? "s" : ""}`, m.dps && `${m.dps} DPS`].filter(Boolean);
  return parts.length ? `manque ${parts.join(", ")}` : "";
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

function RaidRow({ groupId, r, when, chars }: { groupId: string; r: RaidLine; when: ReactNode; chars: Character[] }) {
  const refresh = useRefresh(groupId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Changer de statut garde le perso et la spé de mon inscription ; sinon mon main dans la guilde, sinon un perso qui a sa classe
  const usable = chars.filter(c => c.cls);
  const charId = r.mine?.characterId ?? r.mainId ?? usable[0]?.id ?? null;
  const char = chars.find(c => c.id === charId);
  const spec = r.mine?.characterId && r.mine.spec ? r.mine.spec : char?.spec1 || undefined;
  const pick = async (status: SignupStatus) => {
    setBusy(true); setErr(null);
    try { await put(`/groups/${groupId}/raids/${r.id}/signup`, { status, characterId: status === "absent" && !charId ? null : charId, ...(spec && { spec }) }); await refresh(); }
    catch (e) { setErr(errorOf(e, "Inscription impossible.")); }
    finally { setBusy(false); }
  };
  const c = r.counts;
  return (
    <li className={`ag${r.mine && r.mine.status !== "absent" ? " in" : ""}`}>
      {when}
      <span className="ag-main">
        <Link className="ag-t" to={`/groups/${groupId}/raids/${r.id}`}><span className="kind k-raid">Raid</span>{r.name}{r.size ? <span className="lvn">{r.size}</span> : null}</Link>
        <span className="ag-s">{c.coming} {c.coming > 1 ? "viennent" : "vient"} · {plural(c.tank, "tank")} · {plural(c.heal, "heal")} · {c.dps} DPS{c.tentative ? ` · ${c.tentative} peut-être` : ""}</span>
        {err && <span className="so-why" role="alert">{err}</span>}
      </span>
      <span className="ag-end">
        <SignupButtons value={r.mine?.status as SignupStatus | undefined} onPick={s => void pick(s)} busy={busy} canCome={!!charId}
          label={`Ma réponse pour ${r.name}`} />
      </span>
    </li>
  );
}

/* ---------- Une sortie : « + Heal » avec mon perso qui a le niveau ---------- */

function OutingRow({ groupId, a, today }: { groupId: string; a: Extract<HomeAgendaItem, { kind: "outing" }>; today: string }) {
  const refresh = useRefresh(groupId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = a.places.tank + a.places.heal + a.places.dps;
  const placed = n - a.missing.tank - a.missing.heal - a.missing.dps;
  const me = a.mine?.characterName ? `tu viens${a.full ? "" : ` en ${ROLE_WORD[a.mine.role as keyof typeof ROLE_WORD] ?? a.mine.role}`} avec ${a.mine.characterName}` : null;
  const sub = a.full
    ? ["Complète", a.waiting ? `${a.waiting} en attente` : null, me ?? (a.mine?.creator ? null : `par ${a.creator}`)]
    : [`${placed}/${n}`, missingText(a.missing), me ?? `par ${a.mine?.creator ? "toi" : a.creator}`];
  const s = a.suggest[0];
  const join = async () => {
    if (!s) return;
    setBusy(true); setErr(null);
    try { await put(`/groups/${groupId}/outings/${a.id}/signup`, { role: s.role, characterId: s.characterId, wait: false }); await refresh(); }
    catch (e) { setErr(errorOf(e, "Inscription impossible.")); }
    finally { setBusy(false); }
  };
  return (
    <li className={`ag${a.mine ? " in" : s ? " can" : ""}`}>
      <span className="ag-when"><small>{a.day === today ? "Auj." : "Dem."}</small>{a.at ? <b>{hm(a.at)}</b> : <span className="asap">dès que complet</span>}</span>
      <span className="ag-main">
        <Link className="ag-t" to={`/groups/${groupId}/sorties`}>{a.title} {a.levels && <span className="lvn">{a.levels}</span>}</Link>
        <span className="ag-s">{sub.filter(Boolean).join(" · ")}</span>
        {err && <span className="so-why" role="alert">{err}</span>}
      </span>
      <span className="ag-end">
        {a.mine ? <>{a.mine.creator ? <span className="tag gold">Ta sortie</span> : a.mine.waiting ? <span className="tag warn">En attente</span> : <span className="tag gold">Inscrit</span>}<small>{placed}/{n}</small></>
          : s ? <>
              <button type="button" className="so-join" disabled={busy} title={`T'inscrire en ${ROLE_WORD[s.role]} avec ${s.characterName}`} onClick={() => void join()}>+ {s.role}</button>
              <small>avec {s.characterName}</small></>
          : a.full ? <Link className="btn ghost sm" to={`/groups/${groupId}/sorties`}>Me mettre en attente</Link>
          : <Link className="btn ghost sm" to={`/groups/${groupId}/sorties`}>Voir</Link>}
      </span>
    </li>
  );
}

/* ---------- À faire : ce qui bloque, corrigé sur place ---------- */

function TodoList({ groupId, groupName, chars }: { groupId: string; groupName: string; chars: Character[] }) {
  const week = useWeek();
  const gt = useGameText();
  const refresh = useRefresh(groupId);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); await refresh(); } catch (e) { setErr(errorOf(e)); } finally { setBusy(null); }
  };
  const all = useMyChars().data?.characters;
  const items: ReactNode[] = [];
  if (all && !all.length) items.push(
    <div key="none" className="todo-i" role="listitem"><span className="t">Ajoute ton perso pour t'inscrire aux raids et aux sorties.</span>
      <span className="acts"><Link className="btn sm primary" to="/persos/nouveau">Ajouter un perso</Link></span></div>,
  );
  for (const t of week.data?.todo ?? []) {
    if (t.kind === "incomplete") {
      const c = chars.find(x => x.id === t.characterId) ?? all?.find(x => x.id === t.characterId);
      if (!c) continue;
      const specs: readonly SpecDef[] = (CLASS_SPECS as Record<string, SpecDef[]>)[c.cls] ?? [];
      items.push(
        <div key={`inc-${t.characterId}`} className="todo-i" role="listitem">
          <span className="t"><CharName name={c.name} cls={c.cls} /> n'a pas de {t.missing} : {t.missing === "spé" ? "choisis-la pour t'inscrire." : "complète sa fiche."}</span>
          <span className="acts" role="group" aria-label={`Spé de ${c.name}`}>
            {t.missing === "spé" && specs.length
              ? specs.map(s => <button key={s.name} type="button" className="btn sm" disabled={busy === t.characterId}
                  onClick={() => void run(t.characterId, () => patch(`/characters/${c.id}`, { spec1: s.name }))}>{gt.spec(c.cls, s.name)}</button>)
              : <Link className="btn sm" to={`/persos/${c.id}`}>Compléter</Link>}
          </span>
        </div>,
      );
    } else if (t.kind === "assign" && t.groupId === groupId) {
      const free = chars.filter(c => !c.group && c.cls);
      items.push(
        <div key="assign" className="todo-i" role="listitem">
          <span className="t">Choisis ton perso dans {groupName}.</span>
          <span className="acts" role="group" aria-label={`Ton perso dans ${groupName}`}>
            {free.length ? free.map(c => <button key={c.id} type="button" className="btn sm" disabled={busy === "assign"}
              onClick={() => void run("assign", () => put(`/groups/${groupId}/characters/${c.id}`, { assigned: true, main: true }))}>{c.name}</button>)
              : <Link className="btn sm" to="/persos">Mes persos</Link>}
          </span>
        </div>,
      );
    } else if (t.kind === "sync") {
      items.push(
        <div key={`sync-${t.characterId}`} className="todo-i ask" role="listitem">
          <span className="t"><b>{t.name}</b> n'est pas synchronisé depuis {t.days} jours.</span>
          <span className="acts"><Link className="btn sm ghost" to="/addon">Comment ?</Link></span>
        </div>,
      );
    }
  }
  if (!items.length) return null;
  return <div className="todo" role="list" aria-label="À faire">{items}{err && <div className="alert error" role="alert">{err}</div>}</div>;
}

/* ---------- Officiers : À traiter ---------- */

function ToHandle({ groupId, nextRaid, feedback }: { groupId: string; nextRaid: RaidLine | null; feedback: number }) {
  const members = useGuildMembers(groupId);
  const orders = useQuery({ queryKey: ["orders", groupId], queryFn: () => get<{ orders: { status: string; recipeName: string; item: { name: string } | null; requester: { name: string } }[] }>(`/groups/${groupId}/orders`) });
  const reach = useQuery({ queryKey: ["reach", nextRaid?.id], queryFn: () => get<Reach>(`/groups/${groupId}/raids/${nextRaid!.id}/reach`), enabled: !!nextRaid });
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items: { n: number; t: string; sub: string; action: ReactNode; key: string }[] = [];
  const r = reach.data;
  if (nextRaid && r && r.pending.length) {
    const auto = !r.discordLinked ? "pas de salon Discord lié" : r.auto.sentAt ? "relance automatique faite" : r.auto.at ? `relance automatique ${whenText(r.auto.at)}` : null;
    const can = r.discordLinked && !r.manual.queued && (!r.manual.nextAt || Date.parse(r.manual.nextAt) <= Date.now());
    items.push({ key: "reach", n: r.pending.length, t: `sans réponse pour ${nextRaid.name}`, sub: [whenText(nextRaid.at), auto].filter(Boolean).join(" · "),
      action: can
        ? <button type="button" className="btn sm" disabled={busy} onClick={() => void (async () => {
            setBusy(true); setMsg(null);
            try { const x = await post<{ count: number }>(`/groups/${groupId}/raids/${nextRaid.id}/nudge`); setMsg(`Relance envoyée à ${plural(x.count, "joueur")}.`); await qc.invalidateQueries({ queryKey: ["reach", nextRaid.id] }); }
            catch (e) { setMsg(errorOf(e, "Relance impossible.")); } finally { setBusy(false); }
          })()}>Relancer</button>
        : <Link className="btn sm" to={`/groups/${groupId}/raids/${nextRaid.id}`}>Voir</Link> });
  }
  const un = members.data?.unattached ?? [];
  if (un.length) {
    const sug = un.filter(u => u.suggestion?.target).length;
    items.push({ key: "attach", n: un.length, t: `${un.length > 1 ? "persos" : "perso"} de la guilde à rattacher`, sub: sug ? `${plural(sug, "suggestion")} par les notes de guilde` : "pas encore de joueur",
      action: <Link className="btn sm" to={`/groups/${groupId}/membres`}>Voir</Link> });
  }
  const open = (orders.data?.orders ?? []).filter(o => o.status === "open");
  if (open.length) {
    const o = open[0]!;
    items.push({ key: "orders", n: open.length, t: `${open.length > 1 ? "commandes" : "commande"} sans artisan`, sub: `${o.item?.name ?? o.recipeName}, pour ${o.requester.name}`,
      action: <Link className="btn sm" to={`/groups/${groupId}/membres/artisans`}>Voir</Link> });
  }
  if (feedback) items.push({ key: "avis", n: feedback, t: "avis Discord à lire", sub: "Administration › Avis", action: <Link className="btn sm" to={`/groups/${groupId}/admin?section=avis`}>Lire</Link> });
  if (!items.length) return null;
  return (
    <section className="hm-card off" style={{ ["--o" as string]: 0 } as CSSProperties} aria-labelledby="hm-tt">
      <div className="hm-h"><h3 id="hm-tt">À traiter <small>officiers</small></h3></div>
      <ul className="tt-list">{items.map(i => (
        <li key={i.key}><span className="tt-n">{i.n}</span><span className="t">{i.t}<small>{i.sub}</small></span>{i.action}</li>
      ))}</ul>
      {msg && <p className="small muted" role="status" style={{ margin: 0 }}>{msg}</p>}
    </section>
  );
}

/* ---------- Mes persos et mes absences ---------- */

function MyCharsCard({ groupId, chars }: { groupId: string; chars: Character[] }) {
  const gt = useGameText();
  const abs = useQuery({ queryKey: ["absences"], queryFn: () => get<{ absences: Absence[] }>("/absences") });
  const [declaring, setDeclaring] = useState(false);
  const list = abs.data?.absences ?? [];
  const syncOf = (c: Character) => {
    if (!c.addonSyncedAt) return { text: "pas synchronisé", cls: "" };
    const h = (Date.now() - Date.parse(c.addonSyncedAt)) / 3600e3;
    const d = Math.floor(h / 24);
    return { text: h < 1 ? "à l'instant" : h < 24 ? `il y a ${Math.floor(h)} h` : d === 1 ? "hier" : `il y a ${d} j`, cls: h < 24 ? "ok" : d > 7 ? "warn" : "" };
  };
  return (
    <section className="hm-card" style={{ ["--o" as string]: 2 } as CSSProperties} aria-labelledby="hm-me">
      <div className="hm-h"><h3 id="hm-me">Mes persos</h3><Link className="link" to="/persos">Mes persos →</Link></div>
      {chars.length ? (
        <ul className="mc-list">{chars.map(c => {
          const s = syncOf(c);
          const specs = [c.spec1, c.spec2].filter(Boolean).map(x => gt.spec(c.cls, x)).join(" · ");
          return (
            <li key={c.id}>
              <ClassDot cls={c.cls} spec={c.spec1 || undefined} size="md" portraitId={c.portraitId} />
              <Link className="t" to={`/persos/${c.id}`}>
                <span><CharName name={c.name} cls={c.cls} />{c.group?.id === groupId && c.group.isMain && <span className="gm-star" title="Main"> ★</span>} <span className="lvn">{c.level}</span></span>
                <small>{specs || (c.cls ? "pas de spé" : "à compléter")}</small>
              </Link>
              <span className={`mc-sync ${s.cls}`}>{s.text}</span>
            </li>
          );
        })}</ul>
      ) : <p className="hm-none">Aucun perso pour l'instant. <Link className="link" to="/persos/nouveau">Ajouter un perso</Link></p>}
      <div className="mc-foot">
        <span>Absences : {list.length ? list.slice(0, 2).map(a => `${absenceLabel(a)}${a.reason ? ` · ${a.reason}` : ""}`).join(" ; ") : "aucune"}</span>
        {!declaring && <button type="button" className="link" onClick={() => setDeclaring(true)}>Déclarer une absence</button>}
      </div>
      {declaring && <MyAbsences startOpen onDone={() => setDeclaring(false)} />}
    </section>
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
  const hello = `${hour >= 18 || hour < 5 ? "Bonsoir" : "Bonjour"}${name ? `, ${name}` : ""}`;
  const r = d?.race;
  const course = !r ? null : r.started ? (r.day ? `jour ${r.day} de la course` : null)
    : (() => { const n = daysUntil(r.startsAt); return n > 1 ? `la sortie dans ${n} jours` : n === 1 ? "la sortie demain" : "la sortie cette nuit"; })();
  const meta = <>
    {gg && (gg.faction === "Horde" || gg.faction === "Alliance") && <FactionBadge faction={gg.faction} size={20} />}
    <span>{longDay(new Date().toISOString())}</span>
    {course && <><span aria-hidden="true">·</span><span>{course}</span></>}
  </>;
  const head = <GuildHead groupId={groupId} name={group.name} title={hello} meta={meta} actions={officer ? <InviteButton groupId={groupId} groupName={group.name} /> : undefined} />;
  if (!d) return <div className="stack" style={{ gap: 16 }}>{head}<p className="muted">{q.error ? "Accueil indisponible pour l'instant." : "Chargement…"}</p></div>;

  const raidsToday = d.agenda.filter((a): a is Extract<HomeAgendaItem, { kind: "raid" }> => a.kind === "raid");
  const later = (week.data?.raids ?? []).filter(x => x.groupId === groupId && !d.agenda.some(a => a.kind === "raid" && a.id === x.id) && parisDay(x.scheduledAt) > d.tomorrow);
  const nextRaid = raidsToday[0] ? fromHome(raidsToday[0]) : later[0] ? fromWeek(later[0]) : null;
  const plus = group.creators.canCreateOuting && <Link className="btn sm" to={`${base}/sorties/nouvelle`}>+ Sortie</Link>;
  const whenOf = (iso: string) => <span className="ag-when"><small>{parisDay(iso) === d.today ? "Auj." : parisDay(iso) === d.tomorrow ? "Dem." : DAY_CAP[zonedParts(new Date(iso)).weekday - 1]}</small><b>{hm(iso)}</b></span>;

  const agenda = (
    <section className="hm-card" style={{ ["--o" as string]: 1 } as CSSProperties} aria-labelledby="hm-ag">
      <div className="hm-h"><h3 id="hm-ag">Aujourd'hui et demain</h3>{plus}</div>
      {d.agenda.length ? (
        <ul className="ag-list">{d.agenda.map(a => a.kind === "raid"
          ? <RaidRow key={`r-${a.id}`} groupId={groupId} r={fromHome(a)} when={whenOf(a.at)} chars={chars} />
          : <OutingRow key={`o-${a.id}`} groupId={groupId} a={a} today={d.today} />)}</ul>
      ) : (
        <div className="ag-empty"><p><b>Rien de prévu.</b> {r && !r.started ? "Les sorties ouvrent avec le jeu, le 5 novembre." : group.creators.canCreateOuting ? "Propose une sortie : la guilde la voit ici, sur Discord et en jeu." : null}</p></div>
      )}
      {later.length > 0 && (
        <div className="ag-later"><span className="lbl">Plus tard cette semaine</span>
          <ul className="ag-list">{later.map(x => <RaidRow key={x.id} groupId={groupId} r={fromWeek(x)} when={whenOf(x.scheduledAt)} chars={chars} />)}</ul></div>
      )}
      {d.outings.total > 0 && (
        <div className="hm-foot">
          <Link className="link" to={`${base}/sorties`}>Toutes les sorties ({d.outings.total}) →</Link>
          {d.outings.hidden > 0 && <span className="muted small">{d.outings.hidden} autre{d.outings.hidden > 1 ? "s ne sont" : " n'est"} pas pour tes persos</span>}
        </div>
      )}
    </section>
  );

  const race = r && (
    <section className="hm-card" style={{ ["--o" as string]: 3 } as CSSProperties} aria-labelledby="hm-race">
      <div className="hm-h"><h3 id="hm-race">Course au 60 <small>{r.started ? (r.day ? `jour ${r.day}` : "") : `départ le ${new Date(r.startsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "numeric", timeZone: "Europe/Paris" })}`}</small></h3>
        <Link className="link" to={`${base}/membres/course`}>Voir la course →</Link></div>
      {!r.started ? (
        <div className="hm-empty"><b className="num">J-{daysUntil(r.startsAt)}</b>
          <p>La course part à la sortie, <b>{longDay(r.startsAt).toLowerCase()} à 00:00</b>. Les niveaux viennent de la liste de guilde relevée par l'addon : rien à faire.</p></div>
      ) : !r.linked ? <p className="hm-none">La course se remplit avec la liste de guilde, dès que la guilde du jeu est liée.</p>
        : !r.podium.length ? <p className="hm-none">Personne dans la course pour l'instant.</p> : <>
          <Podium places={r.podium} mini />
          {r.me ? (
            <div className="me-line"><b className="rank"><Place n={r.me.rank} /></b><span>Toi, <CharName name={r.me.name} cls={r.me.cls} as="span" /> niveau {r.me.level}</span>
              {r.me.weekGain > 0 && <span className="ok-t">+{r.me.weekGain} cette semaine</span>}</div>
          ) : <p className="hm-none small">Ton perso n'est pas encore dans la liste de guilde.</p>}
        </>}
    </section>
  );

  const moves = d.guild.linked ? (
    <section className="hm-card" style={{ ["--o" as string]: 4 } as CSSProperties} aria-labelledby="hm-mv">
      <div className="hm-h"><h3 id="hm-mv">Arrivées et départs <small>cette semaine</small></h3><Link className="link" to={`${base}/membres/historique`}>Historique →</Link></div>
      {d.moves.length ? (
        <ul className="moves">{d.moves.map(m => (
          <li key={m.id} className={moveClass(m)}><MoveSign m={m} />
            <span><CharName name={m.who.name} cls={m.who.cls} /> {moveText(m)}{m.kind === "join" && m.who.level ? ` · niv. ${m.who.level}` : ""}</span>
            <small>{shortDay(m.at)}</small></li>
        ))}</ul>
      ) : <p className="hm-none">Personne n'est arrivé ni parti cette semaine.</p>}
    </section>
  ) : officer ? (
    <section className="hm-card" style={{ ["--o" as string]: 4 } as CSSProperties} aria-labelledby="hm-gg">
      <div className="hm-h"><h3 id="hm-gg">Guilde du jeu <small>pas encore liée</small></h3><Link className="link" to={`${base}/admin?section=guilde`}>Administration →</Link></div>
      <p className="hm-none">Fais ta synchro avec l'addon à jour : la guilde du jeu se lie toute seule.</p>
    </section>
  ) : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {head}
      <QuestionBand groupId={groupId} questions={d.questions} />
      <TodoList groupId={groupId} groupName={group.name} chars={chars} />
      <div className="hm">
        <div className="hm-col">{agenda}{moves}</div>
        <div className="hm-col">
          {officer && <ToHandle groupId={groupId} nextRaid={nextRaid} feedback={detail.feedback?.unseen ?? 0} />}
          <MyCharsCard groupId={groupId} chars={chars} />
          {race}
        </div>
      </div>
    </div>
  );
}
