import { classColor, CLASSES, RACES, roleOf, type ClassName, type Role } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, get, put, type Character, type GroupRole, type Member } from "../api";
import { useViewPref } from "../prefs";
import { CharacterEditor } from "./CharacterEditor";
import { ClassIcon, FactionBadge, SpecIcon } from "./Icons";
import { Portrait } from "./ImageUpload";
import { RoleIcon } from "./RoleIcon";
import { RetailCharacterView } from "./RetailCharacter";
import { BnetGroupRefresh } from "./BnetImport";
import { useGameText } from "../gameText";

/**
 * Onglet Personnages d'un groupe : les persos que chaque membre y joue (son main marqué ★, ses alts),
 * mes persos à choisir en haut, et l'affichage au choix (mains seuls, avec les alts, séparés ; liste, tuiles,
 * par rôle, par joueur). Un clic ouvre la fiche en lecture ; le joueur, ou un officier, y gère main et retrait.
 */

type Scope = "mains" | "all" | "split";
type View = "list" | "tiles" | "roles" | "players";
const SCOPES: [Scope, string][] = [["mains", "Mains"], ["all", "Mains + alts"], ["split", "Séparés"]];
const VIEWS: [View, string][] = [["list", "Liste"], ["tiles", "Tuiles"], ["roles", "Par rôle"], ["players", "Par joueur"]];
const ROLE_NAME: Record<GroupRole, string> = { owner: "Propriétaire", officer: "Officier", member: "Membre" };
const RANK: Record<GroupRole, number> = { member: 0, officer: 1, owner: 2 };

const color = (c: Character) => classColor(c.cls) ?? "var(--line-2)";

function Face({ c, size }: { c: Character; size: number }) {
  return (
    <span className="gav" style={{ ["--cc" as string]: color(c), width: size, height: size }} aria-hidden="true">
      <Portrait id={c.portraitId} size={size} className="round"
        fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={Math.round(size * .72)} /> : <ClassIcon cls={c.cls} size={Math.round(size * .72)} />) : <span className="muted">?</span>} />
    </span>
  );
}

const Mark = ({ c }: { c: Character }) => c.isMain
  ? <span className="gm-star" title="Perso principal (main) dans ce groupe" aria-label="Main">★</span>
  : <span className="gm-alt" title="Autre perso joué dans ce groupe">alt</span>;

/* ---------- Mes persos dans ce groupe ---------- */

function MyCharacters({ groupId, groupName, assigned, onError }: { groupId: string; groupName: string; assigned: Character[]; onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const mineQ = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const mine = mineQ.data?.characters ?? [];
  const main = assigned.find(c => c.isMain);
  // Un perso est rangé dans un seul groupe (lot E) : ici, on ne propose que ceux qui n'en ont pas
  const free = mine.filter(c => !c.group);

  const add = async (id: string) => {
    setBusy(id); onError(null);
    try {
      await put(`/groups/${groupId}/characters/${id}`, { assigned: true });
      await Promise.all([qc.invalidateQueries({ queryKey: ["group-chars", groupId] }), qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
    } catch (e) { onError(e instanceof ApiError ? e.message : "Modification impossible."); }
    finally { setBusy(null); }
  };

  if (!mineQ.data) return null;
  if (!mine.length) {
    return <div className="gm-fold"><span className="muted small">Tu n'as encore aucun perso.</span><Link className="btn sm" to="/persos" style={{ marginLeft: "auto" }}>Créer un perso</Link></div>;
  }
  if (!assigned.length) {
    return (
      <section className="gm-panel gm-empty" aria-label="Mes persos dans ce groupe">
        <h3>Tu ne joues encore aucun perso dans {groupName}</h3>
        <p className="hint">{free.length ? "Choisis ceux que tu y joues : le premier devient ton main (tu pourras changer dans Mes persos)." : "Tes persos sont tous rangés dans un autre groupe. Change le groupe de l'un d'eux dans Mes persos."}</p>
        <div className="gm-chips">
          {free.map(c => (
            <button key={c.id} type="button" className="gm-chip" disabled={!!busy} onClick={() => void add(c.id)}>
              <Face c={c} size={20} /><span style={{ color: color(c) }}>{c.name}</span> +
            </button>
          ))}
          <Link className="btn ghost sm" to="/persos">Mes persos</Link>
        </div>
      </section>
    );
  }
  return (
    <div className="gm-fold">
      <span className="muted small">Tes persos ici :</span>
      {main && <b style={{ color: color(main) }}>★ {main.name}</b>}
      {assigned.filter(c => !c.isMain).map(c => <span key={c.id}><span className="muted">· </span><span style={{ color: color(c) }}>{c.name}</span></span>)}
      <Link className="btn ghost sm" style={{ marginLeft: "auto" }} to="/persos">Gérer dans Mes persos</Link>
    </div>
  );
}

/* ---------- Liste du groupe ---------- */

export function GroupCharacters({ groupId, groupName, members, myId, myRole }: { groupId: string; groupName: string; members: Member[]; myId?: string; myRole: GroupRole }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[] }>(`/groups/${groupId}/characters`) });
  // ?perso=<id> : perso ouvert d'emblée (lien depuis la fiche d'un joueur, onglet Membres)
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(() => params.get("perso"));
  const openedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!params.get("perso") || !data) return;
    openedRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    setParams(p => { p.delete("perso"); return p; }, { replace: true });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [scope, setScope] = useViewPref<Scope>("group-chars-scope", "all", ["mains", "all", "split"]);
  const [view, setView] = useViewPref<View>("group-chars", "list", ["list", "tiles", "roles", "players"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gt = useGameText();
  if (!data) return <p className="muted">Chargement…</p>;

  const all = data.characters;
  const needle = filter.trim().toLowerCase();
  const order = new Map(members.map((m, i) => [m.userId, i]));
  const memberOf = new Map(members.map(m => [m.userId, m]));
  const shown = all
    .filter(c => (scope !== "mains" || c.isMain)
      && (!needle || `${c.name} ${c.owner} ${c.cls} ${c.race} ${c.spec1} ${c.spec2} ${gt.cls(c.cls)} ${gt.spec(c.cls, c.spec1)} ${gt.spec(c.cls, c.spec2)}`.toLowerCase().includes(needle))
      && (!role || roleOf(c.spec1) === role || roleOf(c.spec2) === role))
    // Par joueur (ordre des membres), main en tête, persos à configurer (sans classe) à la fin
    .sort((x, y) => (order.get(x.userId) ?? 99) - (order.get(y.userId) ?? 99) || Number(!x.isMain) - Number(!y.isMain) || Number(!x.cls) - Number(!y.cls));
  const opened = all.find(c => c.id === open);
  const toggle = (id: string) => setOpen(o => (o === id ? null : id));

  // Gérer un perso : le sien, ou celui d'un autre si officier (et pas celui du propriétaire, sauf par lui-même)
  const canManage = (c: Character) => {
    if (c.userId === myId) return true;
    const theirs = memberOf.get(c.userId)?.role ?? "member";
    return RANK[myRole] >= 1 && (theirs !== "owner" || myRole === "owner");
  };
  const act = async (c: Character, body: { assigned: boolean; main?: boolean }) => {
    setBusy(true); setError(null);
    try {
      await put(`/groups/${groupId}/characters/${c.id}`, body);
      if (!body.assigned) setOpen(null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["group-chars", groupId] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Modification impossible."); }
    finally { setBusy(false); }
  };

  const spec = (c: Character, sp: string, off?: boolean) => sp ? (
    <span key={sp} className={`gsp${off ? " off" : ""}`}>
      {c.cls && <SpecIcon cls={c.cls} spec={sp} size={16} />}{gt.spec(c.cls, sp)}{roleOf(sp) && <RoleIcon role={roleOf(sp)} size={14} />}
    </span>
  ) : null;
  const avatarOf = (userId: string) => memberOf.get(userId)?.avatarId ?? null;
  const owner = (c: Character) => (
    <span className="gown">
      <span className="avatar" style={{ width: 16, height: 16 }}><Portrait id={avatarOf(c.userId)} size={16} fallback={<span style={{ fontSize: 9 }}>{(c.owner ?? "?")[0]}</span>} /></span>
      {c.owner}
    </span>
  );

  const list = (chars: Character[]) => (
    <div className="glist" role="list">
      {chars.map(c => (
        <button key={c.id} type="button" role="listitem" className="grow" aria-expanded={open === c.id} style={{ ["--cc" as string]: color(c) }} onClick={() => toggle(c.id)}>
          <Face c={c} size={30} />
          <span className="gname"><Mark c={c} /><span className="lvl-pill num">{c.level}</span><span className="n" style={{ color: color(c) }}>{c.name}</span></span>
          <span className="gcls">{c.cls ? [gt.cls(c.cls), c.realm || c.race, c.ilvl ? `ilvl ${c.ilvl}` : null].filter(Boolean).join(" · ") : <span className="muted">À configurer</span>}{RACES[c.race] && <FactionBadge faction={RACES[c.race]!.faction} size={16} short />}</span>
          <span className="gspecs">{spec(c, c.spec1)}{spec(c, c.spec2, true)}</span>
          {owner(c)}
        </button>
      ))}
    </div>
  );
  const tiles = (chars: Character[]) => (
    <div className="gtiles">
      {chars.map(c => {
        const r = roleOf(c.spec1);
        return (
          <button key={c.id} type="button" className="gtile" aria-expanded={open === c.id} style={{ ["--cc" as string]: color(c) }} onClick={() => toggle(c.id)}
            title={[gt.spec(c.cls, c.spec1), gt.spec(c.cls, c.spec2)].filter(Boolean).join(" / ")}>
            <Face c={c} size={34} />
            <span className="n">{c.isMain && <span className="gm-star" aria-label="Main">★</span>}<span className="lvl-pill num">{c.level}</span><span style={{ color: color(c) }}>{c.name}</span></span>
            <span className="r">{r && <RoleIcon role={r} />}</span>
            <span className="s">{(c.cls && gt.specOrClass(c.cls, c.spec1)) || "À configurer"} · {c.owner}{c.isMain ? "" : " · alt"}</span>
          </button>
        );
      })}
    </div>
  );
  const roles = (chars: Character[]) => (
    <div className="groles">
      {(["Tank", "Heal", "DPS"] as const).map(r => {
        const main = chars.filter(c => roleOf(c.spec1) === r), off = chars.filter(c => roleOf(c.spec1) !== r && roleOf(c.spec2) === r);
        const mains = main.filter(c => c.isMain).length, alts = main.length - mains;
        const item = (c: Character, isOff: boolean) => (
          <li key={`${c.id}-${isOff}`}>
            <button type="button" aria-expanded={open === c.id} onClick={() => toggle(c.id)}>
              <Face c={c} size={26} />
              <span className="gr-txt">
                <span className="n" style={{ color: color(c) }}>{c.isMain && "★ "}{c.name}</span>
                <span className="s">{gt.spec(c.cls, isOff ? c.spec2 : c.spec1)} · {c.owner}{c.isMain ? "" : " · alt"}{isOff ? " · off-spec" : ""}</span>
              </span>
              <span className="lvl-pill num">{c.level}</span>
            </button>
          </li>
        );
        return (
          <section key={r} className="gcol" aria-label={r}>
            <h4 className={r}><RoleIcon role={r} size={18} /><span className="num">{mains}{alts > 0 && ` +${alts} alt`}{off.length > 0 && ` · ${off.length} off`}</span></h4>
            {main.length + off.length ? <ul>{main.map(c => item(c, false))}{off.map(c => item(c, true))}</ul> : <p className="muted small" style={{ padding: "8px 12px", margin: 0 }}>Personne</p>}
          </section>
        );
      })}
    </div>
  );
  const players = (chars: Character[]) => (
    <div className="gm-players">
      {members.map(m => {
        const cs = chars.filter(c => c.userId === m.userId);
        if (!cs.length) return null;
        return (
          <section key={m.userId} className="gm-player" aria-label={m.displayName}>
            <header>
              <span className="avatar" style={{ width: 26, height: 26 }}><Portrait id={m.avatarId} size={26} fallback={<span className="small">{m.displayName[0]}</span>} /></span>
              <b>{m.displayName}</b><span className="tag">{ROLE_NAME[m.role]}</span>
              <span className="muted small num" style={{ marginLeft: "auto" }}>{cs.length} perso{cs.length > 1 ? "s" : ""}</span>
            </header>
            {list(cs)}
          </section>
        );
      })}
    </div>
  );
  const layout = (chars: Character[]): ReactNode => view === "tiles" ? tiles(chars) : view === "roles" ? roles(chars) : view === "players" ? players(chars) : list(chars);
  // Séparés : les mains puis les alts (la vue par joueur les sépare déjà)
  const sections: [string | null, Character[]][] = scope === "split" && view !== "players"
    ? [["Mains", shown.filter(c => c.isMain)], ["Alts", shown.filter(c => !c.isMain)]]
    : [[null, shown]];
  const noMain = members.filter(m => !all.some(c => c.userId === m.userId)).length;

  return (
    <div className="stack">
      <MyCharacters groupId={groupId} groupName={groupName} assigned={all.filter(c => c.userId === myId)} onError={setError} />
      {error && <div className="alert error" role="alert">{error}</div>}
      {!all.length ? (
        <p className="muted" style={{ margin: 0 }}>Les membres n'ont pas encore choisi leurs persos pour ce groupe.</p>
      ) : (
        <>
          <div className="row gc-tools">
            <input type="text" aria-label="Filtrer les persos" placeholder="Filtrer (nom, joueur, classe, spé)…" value={filter} onChange={e => setFilter(e.target.value)} style={{ flex: "1 1 200px" }} />
            <div className="seg" role="group" aria-label="Rôle">
              {(["", "Tank", "Heal", "DPS"] as const).map(r => (
                <button key={r || "all"} type="button" className={role === r ? "on" : ""} aria-pressed={role === r} onClick={() => setRole(r)}>{r || "Tous"}</button>
              ))}
            </div>
            <span className="gm-lab" id="gm-scope">Persos</span>
            <div className="seg" role="group" aria-labelledby="gm-scope">
              {SCOPES.map(([k, l]) => <button key={k} type="button" className={scope === k ? "on" : ""} aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>)}
            </div>
            <span className="gm-lab" id="gm-view">Affichage</span>
            <div className="seg" role="group" aria-labelledby="gm-view">
              {VIEWS.map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
            </div>
          </div>
          {gt.game === "retail" && RANK[myRole] >= 1 && <BnetGroupRefresh groupId={groupId} onDone={() => void qc.invalidateQueries({ queryKey: ["group-chars", groupId] })} />}
          {!shown.length && <p className="muted">Aucun perso ne correspond.</p>}
          {sections.map(([title, chars]) => chars.length > 0 && (
            <div key={title ?? "all"} className="stack" style={{ gap: 8 }}>
              {title && <h4 className="gm-sec">{title} <span className="num">{chars.length}</span></h4>}
              {layout(chars)}
            </div>
          ))}
          {noMain > 0 && <p className="hint" style={{ margin: 0 }}>{noMain} membre{noMain > 1 ? "s n'ont" : " n'a"} encore choisi aucun perso pour ce groupe.</p>}
        </>
      )}

      <div ref={openedRef} />
      {opened && (
        <>
          {canManage(opened) && (
            <div className="gm-act">
              <span className="gm-who"><Face c={opened} size={22} /><b style={{ color: color(opened) }}>{opened.name}</b>
                <span className="muted">· {opened.userId === myId ? (opened.isMain ? "ton main" : "un de tes alts") : `${opened.isMain ? "main" : "alt"} de ${opened.owner}`} dans ce groupe</span></span>
              <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
                {!opened.isMain && <button type="button" className="btn sm" disabled={busy} onClick={() => void act(opened, { assigned: true, main: true })}>★ En faire le main</button>}
                <button type="button" className="btn ghost sm danger-t" disabled={busy} onClick={() => void act(opened, { assigned: false })}>Retirer du groupe</button>
              </span>
              {opened.userId !== myId && <span className="hint" style={{ flexBasis: "100%", margin: 0 }}>Tu es officier : la modification est notée au journal du groupe. Le joueur garde la main sur ses persos.</span>}
            </div>
          )}
          {gt.game === "retail" ? <RetailCharacterView c={opened} /> : <CharacterEditor character={opened} editable={false} onChange={() => {}} />}
        </>
      )}
    </div>
  );
}
