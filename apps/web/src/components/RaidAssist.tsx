import { benchSuggestion, CLASSES, roleGaps, roleOf, SIGNUP_LABEL, targetOf, type ClassName, type Role, type RoleTargets, type SignupStatus } from "@forever/game-data";
import { useState } from "react";
import type { Character, RaidSignup } from "../api";
import { AskChip, type Reach } from "./RaidReach";

/**
 * Compo assistée (lot D1) : rôles visés selon le format du raid, ce qui manque, qui peut combler (inscrits non placés,
 * off-spec, alts des inscrits, membres sans réponse), et qui mettre sur le banc quand il y a trop d'inscrits.
 * Classes CSS « ra- ».
 */

export interface AssistEntry { key: string; name: string; cls: string; spec: string; owner: string; signup?: RaidSignup; characterId: string | null; placed: boolean }
export interface BenchHistory { raids: number; stats: Record<string, { bench: number; signed: number; lastBenched: boolean }> }

const ROLES: Role[] = ["Tank", "Heal", "DPS"];
const COMING: SignupStatus[] = ["present", "late"];
const color = (cls: string) => CLASSES[cls as ClassName]?.color;

export function RaidAssist({ size, targets, entries, groupChars, signups, history, reach, onPlace, onSpec, onBench, onAsk }: {
  size: number; targets: RoleTargets; entries: AssistEntry[]; groupChars: Character[]; signups: RaidSignup[]; history: BenchHistory | undefined;
  /** Relances et demandes (lot D2) : sans elles, pas de bouton « Demander ». */
  reach?: Reach;
  onPlace: (key: string) => void; onSpec: (signupId: string, spec: string) => void; onBench: (signupIds: string[]) => void;
  onAsk?: (characterId: string, spec: string) => void;
}) {
  const placed = entries.filter(e => e.placed);
  const counts: Partial<Record<Role, number>> = {};
  for (const e of placed) { const r = roleOf(e.spec); if (r) counts[r] = (counts[r] ?? 0) + 1; }
  const gaps = roleGaps(targets, counts);
  const charOf = new Map(groupChars.map(c => [c.id, c]));
  const signedUsers = new Map(signups.filter(s => s.userId && s.status !== "absent").map(s => [s.userId!, s]));
  const answered = new Set(signups.filter(s => s.userId).map(s => s.userId!));
  const signedChars = new Set(signups.map(s => s.characterId).filter(Boolean) as string[]);

  type Sugg = { key: string; role: Role; name: string; cls: string; what: string; why: string; action?: { label: string; run: () => void }; ask?: { characterId: string; spec: string; userId: string } };
  const sugg: Sugg[] = [];
  for (const r of ROLES) {
    if (gaps[r] <= 0) continue;
    // 1. Inscrits pas encore placés, dans ce rôle
    for (const e of entries.filter(x => !x.placed && x.signup && x.signup.status !== "absent" && x.signup.status !== "bench" && roleOf(x.spec) === r)) {
      sugg.push({ key: `p-${e.key}`, role: r, name: e.name, cls: e.cls, what: `${e.spec} · ${e.owner}`, why: `inscrit « ${SIGNUP_LABEL[e.signup!.status]} », pas placé`, action: { label: "Placer", run: () => onPlace(e.key) } });
    }
    // 2. Inscrits qui ont ce rôle en off-spec (non placés, ou placés dans un rôle en trop)
    for (const e of entries.filter(x => x.signup && x.characterId && x.signup.status !== "absent" && roleOf(x.spec) !== r)) {
      const c = charOf.get(e.characterId!);
      const off = [c?.spec1, c?.spec2].find(sp => sp && sp !== e.spec && roleOf(sp) === r);
      const cur = roleOf(e.spec);
      if (!off || (e.placed && cur && gaps[cur] >= 0)) continue;
      sugg.push({ key: `o-${e.key}`, role: r, name: e.name, cls: e.cls, what: `${off} (off-spec) · ${e.owner}`, why: `inscrit en ${e.spec}${e.placed ? ", déjà placé" : ""}`, action: { label: `Passer en ${off}`, run: () => onSpec(e.signup!.id, off) } });
    }
    // 3. Alts des joueurs inscrits : le bot peut leur demander (lot D2)
    for (const c of groupChars.filter(x => !signedChars.has(x.id) && signedUsers.has(x.userId) && (roleOf(x.spec1) === r || roleOf(x.spec2) === r))) {
      const sp = roleOf(c.spec1) === r ? c.spec1 : c.spec2;
      const s = signedUsers.get(c.userId)!;
      sugg.push({ key: `a-${c.id}`, role: r, name: c.name, cls: c.cls, what: `${sp} · ${c.isMain ? "main" : "alt"} de ${c.owner}`, why: `${c.owner} vient avec ${s.characterName ?? "un autre perso"} : à lui demander`, ask: { characterId: c.id, spec: sp, userId: c.userId } });
    }
    // 4. Mains des membres qui n'ont pas répondu
    for (const c of groupChars.filter(x => x.isMain && !answered.has(x.userId) && roleOf(x.spec1) === r)) {
      sugg.push({ key: `n-${c.id}`, role: r, name: c.name, cls: c.cls, what: `${c.spec1} · main de ${c.owner}`, why: "pas encore répondu", ask: { characterId: c.id, spec: c.spec1, userId: c.userId } });
    }
  }

  // Banc : plus d'inscrits « présent / en retard » que de places
  const coming = entries.filter(e => e.signup && COMING.includes(e.signup.status));
  const canFill = (e: AssistEntry) => {
    const c = e.characterId ? charOf.get(e.characterId) : undefined;
    return [c?.spec1, c?.spec2].some(sp => { const r = sp && sp !== e.spec ? roleOf(sp) : null; return !!r && gaps[r] > 0; });
  };
  const cands = coming.map(e => ({
    key: e.key, role: roleOf(e.spec), signedAt: e.signup!.createdAt, flex: canFill(e),
    benched: e.characterId ? history?.stats[e.characterId]?.bench ?? 0 : 0, lastBenched: e.characterId ? history?.stats[e.characterId]?.lastBenched ?? false : false,
  }));
  const toBench = benchSuggestion(cands, targets, size);
  const byKey = new Map(entries.map(e => [e.key, e]));

  const [more, setMore] = useState<Role | null>(null);
  // Replié : une ligne par rôle (lot E) ; déplié : les propositions et le banc
  const [open, setOpen] = useState(false);
  // « Demander à X » : le bot écrit au joueur (Discord lié, MP du bot gardés, salon lié, raid à venir)
  const askOf = new Map((reach?.asks ?? []).map(a => [a.characterId, a]));
  const dmOk = new Set(reach?.dmUsers ?? []);
  const askable = !!reach && reach.discordLinked && reach.upcoming && !!onAsk;
  const askCell = (s: Sugg) => {
    if (!s.ask || !reach) return null;
    const done = askOf.get(s.ask.characterId);
    if (done) return <span className="ra-ask"><AskChip state={done.state} /></span>;
    if (!askable) return null;
    if (!dmOk.has(s.ask.userId)) return <span className="ra-ask small muted" title="Discord non lié ou messages du bot désactivés">pas de MP</span>;
    const a = s.ask;
    return <button type="button" className="btn sm ghost" title="Le bot lui écrit en MP ; « Oui » l'inscrit avec ce perso" onClick={() => onAsk!(a.characterId, a.spec)}>Demander</button>;
  };
  const item = (s: Sugg) => (
    <li key={s.key}>
      <span className="ra-txt"><b style={{ color: color(s.cls) }}>{s.name}</b><small>{s.what}</small><small><i>{s.why}</i></small></span>
      {s.action && <button type="button" className="btn sm" onClick={s.action.run}>{s.action.label}</button>}
      {askCell(s)}
    </li>
  );
  return (
    <section className="panel pad stack ra" aria-labelledby="ra-title">
      <div className="ra-head">
        <h3 id="ra-title">Besoins <span className="muted small">raid à {size}</span></h3>
        {coming.length > 0 && <span className="hint">{coming.length} inscrit{coming.length > 1 ? "s" : ""} « présent / en retard » pour {size} places</span>}
        <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? "Replier" : "Voir les propositions"}</button>
      </div>
      {!open && (
        <div className="ra-sum">
          {ROLES.map(r => {
            const n = sugg.filter(x => x.role === r).length;
            return (
              <button key={r} type="button" className={`ra-sumr ${gaps[r] > 0 ? "low" : gaps[r] < 0 ? "over" : "ok"}`} onClick={() => setOpen(true)}>
                <span className={`role ${r}`}>{r}</span><b className="num">{counts[r] ?? 0}/{targetOf(targets, r)}</b>
                <small>{gaps[r] > 0 ? `il en manque ${gaps[r]}${n ? ` · ${n} proposition${n > 1 ? "s" : ""}` : ""}` : gaps[r] < 0 ? `${-gaps[r]} de trop` : "complet"}</small>
              </button>
            );
          })}
          {toBench.length > 0 && <button type="button" className="ra-sumr low" onClick={() => setOpen(true)}><b>Banc</b><small>{toBench.length} à y mettre</small></button>}
        </div>
      )}
      {open && <>
      <div className="ra-cols">
        {ROLES.map(r => {
          const list = sugg.filter(s => s.role === r);
          const shown = more === r ? list : list.slice(0, 4);
          return (
            <div key={r} className={`ra-col ${gaps[r] > 0 ? "low" : gaps[r] < 0 ? "over" : "ok"}`}>
              <div className="ra-gap"><span className={`role ${r}`}>{r}</span><b className="num">{counts[r] ?? 0}/{targetOf(targets, r)}</b>
                <small>{gaps[r] > 0 ? `il en manque ${gaps[r]}` : gaps[r] < 0 ? `${-gaps[r]} de trop` : "complet"}</small></div>
              {gaps[r] > 0 && (list.length ? <ul className="ra-list">{shown.map(item)}</ul> : <p className="hint" style={{ margin: 0 }}>Personne d'autre pour ce rôle.</p>)}
              {list.length > 4 && <button type="button" className="btn ghost sm" onClick={() => setMore(m => (m === r ? null : r))}>{more === r ? "Moins" : `${list.length - 4} autre${list.length - 4 > 1 ? "s" : ""}`}</button>}
            </div>
          );
        })}
      </div>

      {toBench.length > 0 && (
        <div className="ra-bench stack">
          <div><b>Banc : {coming.length} inscrits pour {size} places</b>
            <span className="hint"> · ceux qui y sont allés le moins souvent{history?.raids ? ` (sur les ${history.raids} derniers raids)` : ""}, jamais deux fois de suite</span></div>
          <ul className="ra-list ra-inline">
            {toBench.map(k => {
              const e = byKey.get(k)!;
              const st = e.characterId ? history?.stats[e.characterId] : undefined;
              return (
                <li key={k}>
                  <span className={`role ${roleOf(e.spec) ?? ""}`}>{roleOf(e.spec) ?? "?"}</span>
                  <span className="ra-txt"><b style={{ color: color(e.cls) }}>{e.name}</b><small>{e.owner} · banc {st?.bench ?? 0} fois{st?.lastBenched ? " · au dernier banc" : ""}</small></span>
                </li>
              );
            })}
            <li className="ra-go"><button type="button" className="btn sm primary" onClick={() => onBench(toBench.map(k => byKey.get(k)!.signup!.id))}>
              Mettre {toBench.length > 1 ? `ces ${toBench.length} persos` : "ce perso"} sur le banc
            </button></li>
          </ul>
        </div>
      )}
      </>}
    </section>
  );
}
