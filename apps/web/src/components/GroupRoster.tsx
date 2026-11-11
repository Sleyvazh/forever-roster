import { classColor, CLASSES, RACES, roleOf, type ClassName, type Role } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, del, get, put, type Character, type GroupRole, type Member } from "../api";
import { useViewPref } from "../prefs";
import { CharacterEditor } from "./CharacterEditor";
import { NumberField } from "./NumberField";
import { ClassIcon, FactionBadge, SpecIcon } from "./Icons";
import { Portrait } from "./ImageUpload";
import { RoleIcon } from "./RoleIcon";
import { RetailCharacterView } from "./RetailCharacter";
import { GiveFicheDialog } from "./GiveFiche";
import { BnetGroupRefresh } from "./BnetImport";
import { useGameText } from "../gameText";
import { colon, N, t, tn } from "../i18n";
import { roleLabel } from "../pages/GroupsPage";

/**
 * Onglet Personnages d'un groupe : les persos que chaque membre y joue (son main marqué ★, ses alts),
 * mes persos à choisir en haut, et l'affichage au choix (mains seuls, avec les alts, séparés ; liste, tuiles,
 * par rôle, par joueur). Un clic ouvre la fiche en lecture ; le joueur, ou un officier, y gère main et retrait.
 * Refonte du 09/11 (maquette-guilde-membres.png) : recherche, rôle de même largeur et « Affichage · Mains + alts, Liste ▾ »
 * qui regroupe Persos et Vue ; mes persos surlignés d'or ; la faction n'est plus sur chaque ligne (une fois dans l'en-tête),
 * sauf dans un groupe aux deux factions.
 */

type Scope = "mains" | "all" | "split";
type View = "list" | "tiles" | "roles" | "players";
const SCOPES: [Scope, string][] = [["mains", N("Mains")], ["all", N("Mains + alts")], ["split", N("Séparés")]];
const VIEWS: [View, string][] = [["list", N("Liste")], ["tiles", N("Tuiles")], ["roles", N("Par rôle")], ["players", N("Par joueur")]];

/** Faction des persos d'un groupe : la même pour tous, sinon null (groupe aux deux factions, ou aucune race connue). */
export function factionOf(chars: Pick<Character, "race">[]): "Alliance" | "Horde" | null {
  const f = new Set(chars.map(c => RACES[c.race]?.faction).filter(Boolean));
  return f.size === 1 ? ([...f][0] as "Alliance" | "Horde") : null;
}

/**
 * « Affichage · Mains + alts, Liste ▾ » : Persos et Vue dans un menu, choix retenus et écrits sur le bouton (refonte du 09/11).
 * Reste ouvert pendant les choix ; se ferme au clic ailleurs et à Échap.
 */
function DisplayMenu({ scope, onScope, view, onView, views }: {
  scope: Scope; onScope: (s: Scope) => void; view: View; onView: (v: View) => void; views: [View, string][];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLButtonElement>(".gm-disp-btn")?.focus(); } };
    document.addEventListener("pointerdown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  const label = `${t(SCOPES.find(([k]) => k === scope)![1])}, ${t(views.find(([k]) => k === view)?.[1] ?? VIEWS[0]![1])}`;
  return (
    <div className="gm-disp" ref={box}>
      <button type="button" className="btn gm-disp-btn" aria-expanded={open} aria-controls="gm-disp-pop" onClick={() => setOpen(o => !o)}>
        {t("Affichage · {label}", { label })} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="gm-disp-pop" id="gm-disp-pop">
          <span className="gm-lab" id="gm-scope">{t("Persos")}</span>
          <div className="seg eq" role="group" aria-labelledby="gm-scope">
            {SCOPES.map(([k, l]) => <button key={k} type="button" className={scope === k ? "on" : ""} aria-pressed={scope === k} onClick={() => onScope(k)}>{t(l)}</button>)}
          </div>
          <span className="gm-lab" id="gm-view">{t("Vue")}</span>
          <div className="seg eq" role="group" aria-labelledby="gm-view" style={{ "--n": views.length } as CSSProperties}>
            {views.map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} aria-pressed={view === k} onClick={() => onView(k)}>{t(l)}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}
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
  ? <span className="gm-star" title={t("Perso principal (main) dans cette guilde")} aria-label={t("Main")}>★</span>
  : <span className="gm-alt" title={t("Autre perso joué dans cette guilde")}>{t("alt")}</span>;

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
    } catch (e) { onError(e instanceof ApiError ? e.message : t("Modification impossible.")); }
    finally { setBusy(null); }
  };

  if (!mineQ.data) return null;
  if (!mine.length) {
    return <div className="gm-fold"><span className="muted small">{t("Tu n'as encore aucun perso.")}</span><Link className="btn sm" to="/persos" style={{ marginLeft: "auto" }}>{t("Créer un perso")}</Link></div>;
  }
  if (!assigned.length) {
    return (
      <section className="gm-panel gm-empty" aria-label={t("Mes persos dans cette guilde")}>
        <h3>{t("Tu ne joues encore aucun perso dans {guild}", { guild: groupName })}</h3>
        <p className="hint">{free.length ? t("Choisis ceux que tu y joues : le premier devient ton main (tu pourras changer dans Mes persos).") : t("Tes persos sont tous rangés dans une autre guilde. Change la guilde de l'un d'eux dans Mes persos.")}</p>
        <div className="gm-chips">
          {free.map(c => (
            <button key={c.id} type="button" className="gm-chip" disabled={!!busy} onClick={() => void add(c.id)}>
              <Face c={c} size={20} /><span style={{ color: color(c) }}>{c.name}</span> +
            </button>
          ))}
          <Link className="btn ghost sm" to="/persos">{t("Mes persos")}</Link>
        </div>
      </section>
    );
  }
  return (
    <div className="gm-fold">
      <span>{t("Tes persos ici ·")}</span>
      {main && <b style={{ color: color(main) }}>★ {main.name}</b>}
      {assigned.filter(c => !c.isMain).map(c => <span key={c.id}><span aria-hidden="true">· </span><b style={{ color: color(c) }}>{c.name}</b></span>)}
      <Link className="link gm-manage" to="/persos">{t("Gérer dans Mes persos")} <span aria-hidden="true">›</span></Link>
    </div>
  );
}

/* ---------- Liste du groupe ---------- */

/**
 * byPlayer : propose l'affichage « Par joueur » des fiches (Roster). Forever l'enlève : la barre de Guilde › Membres a déjà
 * son « Par joueur » ; un choix « players » retenu se lit alors comme « Liste ».
 */
export function GroupCharacters({ groupId, groupName, members, myId, myRole, byPlayer = true }: {
  groupId: string; groupName: string; members: Member[]; myId?: string; myRole: GroupRole; byPlayer?: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[]; gameLinked?: boolean }>(`/groups/${groupId}/characters`) });
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
  const [savedView, setView] = useViewPref<View>("group-chars", "list", ["list", "tiles", "roles", "players"]);
  const view: View = !byPlayer && savedView === "players" ? "list" : savedView;
  const views = byPlayer ? VIEWS : VIEWS.filter(([k]) => k !== "players");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** « Corriger le niveau » d'une fiche ouverte (officier, Forever) : fiche et niveau en saisie. */
  const [lvEdit, setLvEdit] = useState<{ id: string; level: number } | null>(null);
  /** « Donner la fiche à… » (Forever) : la fiche ouverte. */
  const [giving, setGiving] = useState<string | null>(null);
  const gt = useGameText();
  if (!data) return <p className="muted">{t("Chargement…")}</p>;

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
  // Faction : une fois dans l'en-tête de la guilde ; sur chaque ligne seulement si le groupe mêle les deux
  const mixed = !factionOf(all) && new Set(all.map(c => RACES[c.race]?.faction).filter(Boolean)).size > 1;
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
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Modification impossible.")); }
    finally { setBusy(false); }
  };

  // Niveau d'une fiche que la liste du jeu ne connaît pas (fiche-levels.ts) : un officier le fixe, ou rend la main au joueur
  const fixable = (c: Character) => gt.game !== "retail" && c.userId !== myId && canManage(c) && c.levelLock?.by !== "game";
  const fixLevel = async (c: Character, level: number | null) => {
    setBusy(true); setError(null);
    try {
      if (level === null) await del(`/groups/${groupId}/characters/${c.id}/level`);
      else await put(`/groups/${groupId}/characters/${c.id}/level`, { level });
      setLvEdit(null);
      await qc.invalidateQueries({ queryKey: ["group-chars", groupId] });
    } catch (e) { setError(e instanceof ApiError ? e.message : t("Modification impossible.")); }
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
        <button key={c.id} type="button" role="listitem" className={`grow${c.userId === myId ? " mine" : ""}`} aria-expanded={open === c.id} style={{ ["--cc" as string]: color(c) }} onClick={() => toggle(c.id)}>
          <Face c={c} size={30} />
          <span className="gname"><Mark c={c} /><span className="lvl-pill num">{c.level}</span><span className="n" style={{ color: color(c) }}>{c.name}</span></span>
          <span className="gcls">{c.cls ? [gt.cls(c.cls), c.realm || c.race, c.ilvl ? `ilvl ${c.ilvl}` : null].filter(Boolean).join(" · ") : <span className="muted">{t("À configurer")}</span>}{mixed && RACES[c.race] && <FactionBadge faction={RACES[c.race]!.faction} size={16} short />}</span>
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
          <button key={c.id} type="button" className={`gtile${c.userId === myId ? " mine" : ""}`} aria-expanded={open === c.id} style={{ ["--cc" as string]: color(c) }} onClick={() => toggle(c.id)}
            title={[gt.spec(c.cls, c.spec1), gt.spec(c.cls, c.spec2)].filter(Boolean).join(" / ")}>
            <Face c={c} size={34} />
            <span className="n">{c.isMain && <span className="gm-star" aria-label={t("Main")}>★</span>}<span className="lvl-pill num">{c.level}</span><span style={{ color: color(c) }}>{c.name}</span></span>
            <span className="r">{r && <RoleIcon role={r} />}</span>
            <span className="s">{(c.cls && gt.specOrClass(c.cls, c.spec1)) || t("À configurer")} · {c.owner}{c.isMain ? "" : t(" · alt")}</span>
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
                <span className="s">{gt.spec(c.cls, isOff ? c.spec2 : c.spec1)} · {c.owner}{c.isMain ? "" : t(" · alt")}{isOff ? t(" · off-spec") : ""}</span>
              </span>
              <span className="lvl-pill num">{c.level}</span>
            </button>
          </li>
        );
        return (
          <section key={r} className="gcol" aria-label={r}>
            <h4 className={r}><RoleIcon role={r} size={18} /><span className="num">{mains}{alts > 0 && ` +${tn(alts, "{n} alt", "{n} alts")}`}{off.length > 0 && ` · ${t("{n} off", { n: off.length })}`}</span></h4>
            {main.length + off.length ? <ul>{main.map(c => item(c, false))}{off.map(c => item(c, true))}</ul> : <p className="muted small" style={{ padding: "8px 12px", margin: 0 }}>{t("Personne")}</p>}
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
              <b>{m.displayName}</b><span className="tag">{roleLabel(m.role)}</span>
              <span className="muted small num" style={{ marginLeft: "auto" }}>{tn(cs.length, "{n} perso", "{n} persos")}</span>
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
    ? [[N("Mains"), shown.filter(c => c.isMain)], [N("Alts"), shown.filter(c => !c.isMain)]]
    : [[null, shown]];
  const noMain = members.filter(m => !all.some(c => c.userId === m.userId)).length;

  return (
    <div className="stack">
      <MyCharacters groupId={groupId} groupName={groupName} assigned={all.filter(c => c.userId === myId)} onError={setError} />
      {error && <div className="alert error" role="alert">{error}</div>}
      {!all.length ? (
        <p className="muted" style={{ margin: 0 }}>{t("Les membres n'ont pas encore choisi leurs persos pour cette guilde.")}</p>
      ) : (
        <>
          <div className="gc-tools gm-tools">
            <input type="search" aria-label={t("Chercher un perso")} placeholder={t("Chercher un nom, une classe, une spé…")} value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="seg eq" role="group" aria-label={t("Rôle")}>
              {(["", "Tank", "Heal", "DPS"] as const).map(r => (
                <button key={r || "all"} type="button" className={role === r ? "on" : ""} aria-pressed={role === r} onClick={() => setRole(r)}>{r || t("Tous")}</button>
              ))}
            </div>
            <DisplayMenu scope={scope} onScope={setScope} view={view} onView={setView} views={views} />
          </div>
          {gt.game === "retail" && RANK[myRole] >= 1 && <BnetGroupRefresh groupId={groupId} onDone={() => void qc.invalidateQueries({ queryKey: ["group-chars", groupId] })} />}
          {!shown.length && <p className="muted">{t("Aucun perso ne correspond.")}</p>}
          {sections.map(([title, chars]) => chars.length > 0 && (
            <div key={title ?? "all"} className="stack" style={{ gap: 8 }}>
              {title && <h4 className="gm-sec">{t(title)} <span className="num">{chars.length}</span></h4>}
              {layout(chars)}
            </div>
          ))}
          {noMain > 0 && <p className="hint" style={{ margin: 0 }}>{tn(noMain, "{n} membre n'a encore choisi aucun perso pour cette guilde.", "{n} membres n'ont encore choisi aucun perso pour cette guilde.")}</p>}
        </>
      )}

      <div ref={openedRef} />
      {opened && (
        <>
          {canManage(opened) && (
            <div className="gm-act">
              <span className="gm-who"><Face c={opened} size={22} /><b style={{ color: color(opened) }}>{opened.name}</b>
                <span className="muted">· {opened.userId === myId ? (opened.isMain ? t("ton main dans cette guilde") : t("un de tes alts dans cette guilde"))
                  : opened.isMain ? t("main de {name} dans cette guilde", { name: opened.owner ?? "" }) : t("alt de {name} dans cette guilde", { name: opened.owner ?? "" })}</span>
                {opened.levelLock?.by === "game" && <span className="muted">· {t("niveau {n} relevé en jeu ({name})", { n: opened.levelLock.level, name: opened.levelLock.name })}</span>}
                {opened.levelLock?.by === "officer" && <span className="muted">· {opened.levelLock.userId === myId ? t("niveau {n} fixé par toi", { n: opened.level }) : t("niveau {n} fixé par {name}", { n: opened.level, name: opened.levelLock.name })}</span>}</span>
              {lvEdit?.id === opened.id ? (
                <form className="row gm-lv" style={{ gap: 8, marginLeft: "auto" }} onSubmit={e => { e.preventDefault(); void fixLevel(opened, lvEdit.level); }}>
                  <label className="muted" htmlFor="gm-lv">{t("Niveau de {name}", { name: opened.name })}</label>
                  <NumberField id="gm-lv" min={1} max={60} value={lvEdit.level} onChange={level => setLvEdit({ id: opened.id, level })} className="gm-lv-n" />
                  <button type="submit" className="btn sm primary" disabled={busy}>{t("Enregistrer")}</button>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setLvEdit(null)}>{t("Annuler")}</button>
                </form>
              ) : (
                <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  {!opened.isMain && <button type="button" className="btn sm" disabled={busy} onClick={() => void act(opened, { assigned: true, main: true })}>{t("★ En faire le main")}</button>}
                  {fixable(opened) && (opened.levelLock?.by === "officer"
                    ? <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void fixLevel(opened, null)}>{t("Rendre la main sur le niveau")}</button>
                    : <button type="button" className="btn sm" disabled={busy} onClick={() => setLvEdit({ id: opened.id, level: opened.level })}>{t("Corriger le niveau")}</button>)}
                  {gt.game !== "retail" && <button type="button" className="btn sm" disabled={busy} onClick={() => setGiving(opened.id)}>{t("Donner la fiche à…")}</button>}
                  <button type="button" className="btn ghost sm danger-t" disabled={busy} onClick={() => void act(opened, { assigned: false })}>{t("Retirer de la guilde")}</button>
                </span>
              )}
              {opened.userId !== myId && <span className="hint" style={{ flexBasis: "100%", margin: 0 }}>{lvEdit?.id === opened.id
                ? `${data.gameLinked ? t("{name} n'est pas dans la liste de guilde du jeu", { name: opened.name }) : t("La guilde n'est pas encore liée au jeu")}${colon()}${t("son niveau ne peut pas être relevé. Une fois fixé, {who} ne pourra plus le changer, jusqu'à ce que tu lui rendes la main. C'est noté au journal de la guilde.", { who: opened.owner ?? t("le joueur") })}`
                : t("Tu es officier : la modification est notée au journal de la guilde. Le joueur garde la main sur ses persos.")}</span>}
            </div>
          )}
          {giving === opened.id && <GiveFicheDialog groupId={groupId} groupName={groupName} c={opened} members={members} onClose={() => setGiving(null)} />}
          {gt.game === "retail" ? <RetailCharacterView c={opened} /> : <CharacterEditor character={opened} editable={false} onChange={() => {}} />}
        </>
      )}
    </div>
  );
}
