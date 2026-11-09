import { RaidLogPanel, type RaidLogView } from "../components/RaidLog";
import { DIFFICULTY_LABEL, effectsOf, type RetailDifficulty,
  computeCoverage, exclusiveBudget, GROUP_SIZE, RAID_EFFECTS, RAID_GROUPS, roleCounts, roleOf, type EffectKind,
} from "@forever/game-data";
import { useGameText } from "../gameText";
import { RetailFormat } from "../components/RetailFormat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, patch, post, put, slotKey, type Character, type RaidChar, type RaidSignup, type RaidSlot } from "../api";
import { RaidExport } from "../components/RaidExport";
import { useLiveListener, type LiveEvent } from "../live";
import { useMe } from "../auth";
import { MyAnswer, RaidSignups } from "../components/RaidSignups";
import { LootModePicker, SoftReservePanel } from "../components/Loot";
import { DEFAULT_TARGETS, groupsFor, lootModeHint, lootModeLabel, RAID_SIZES, type LootMode, type RaidSize, type RoleTargets } from "@forever/game-data";
import { RaidAssist, type BenchHistory } from "../components/RaidAssist";
import { CouncilPicker, RaidPrepPanel } from "../components/RaidPrep";
import { RaidReach, type Reach } from "../components/RaidReach";
import { SIGNUP_AVAILABLE, SIGNUP_LABEL } from "@forever/game-data";
import { ClassIcon } from "../components/Icons";
import { DateTimeField, longDate, partsOf } from "../components/DateTime";
import { syncAge } from "../addonImport";
import { FloatingTip } from "../components/ItemTooltip";
import { DialogHead, Modal } from "../components/Dialog";
import { RoleIcon, RoleTag, type RoleName } from "../components/RoleIcon";

/** Carte d'un joueur au survol : spé, inscription, métiers, niveau d'objet moyen et BiS obtenus. */
function PlayerCard({ e, c }: { e: Entry; c?: Character }) {
  const gt = useGameText();
  const cl = { color: gt.color(e.cls) };
  const retail = gt.game === "retail";
  const st = retail ? null : c?.gearStats;
  const profs = c ? [c.professions.prof1, c.professions.prof2].filter(p => p.name) : [];
  return (
    <>
      <div className="t-name" style={{ color: cl?.color }}>{e.name}</div>
      <div className="t-row">{[e.level ? `Niveau ${e.level}` : null, gt.specOrClass(e.cls, e.spec), c?.realm || null, c?.ilvl ? `ilvl ${c.ilvl}` : null].filter(Boolean).join(" · ")}</div>
      <div className="t-dim">{e.guest ? "Inscrit depuis Discord, sans compte sur le site" : `Joueur : ${e.owner}`}</div>
      {e.signup && <div className="t-row">Inscription : {SIGNUP_LABEL[e.signup.status]}{e.signup.note ? ` — « ${e.signup.note} »` : ""}</div>}
      {profs.length > 0 && <div className="t-row">Métiers : {profs.map(p => `${p.name} ${p.skill}`).join(", ")}</div>}
      {c && !e.guest && !retail && <div className={c.addonSyncedAt ? "t-dim" : "t-warn"}>Addon : {syncAge(c.addonSyncedAt).text}{!c.addonSyncedAt && " (équipement et talents saisis à la main)"}</div>}
      {st && (
        <div className="t-where">
          <div className="t-row t-split"><span>Niveau d'objet moyen</span><b className="t-ilvl">{st.ilvl != null ? String(st.ilvl).replace(".", ",") : "—"}</b></div>
          <div className="t-dim">{st.filled}/{st.total} emplacements renseignés</div>
          <div className="t-row t-split"><span>BiS obtenus</span><b>{st.got}/{st.total}</b></div>
          <div className="pbar" aria-hidden="true"><i style={{ width: `${Math.round(st.got / st.total * 100)}%` }} /></div>
          {st.bis < st.total && <div className="t-dim">{st.bis} objectif{st.bis > 1 ? "s" : ""} BiS choisi{st.bis > 1 ? "s" : ""}</div>}
        </div>
      )}
    </>
  );
}

interface RaidResponse { raid: { id: string; name: string; scheduledAt: string | null; description: string; rosterPublished: boolean; lootMode: LootMode; srHidden: boolean; size: RaidSize; difficulty: RetailDifficulty | null; targets: RoleTargets; customTargets: boolean }; version: string; canEdit: boolean; slots: RaidSlot[]; characters: RaidChar[]; signups: RaidSignup[]; log: RaidLogView | null }
interface SaveResponse { slots: RaidSlot[]; version: string; merged: boolean; raid: { name: string; scheduledAt: string | null; description: string } }
/** Dernier état connu du serveur : base de la fusion quand deux officiers modifient la compo en même temps. */
interface ServerState { version: string; slots: RaidSlot[]; name: string; scheduledAt: string | null; description: string }

const KIND_LABEL: Record<EffectKind, string> = { buff: "Buffs de raid", aura: "Auras et totems (par groupe)", debuff: "Debuffs sur la cible", utility: "Utilitaires" };
const EXCL_LABEL: Record<string, string> = { blessing: "Bénédictions / paladins", curse: "Malédictions / démonistes", judgement: "Jugements / paladins", "air-totem": "Totems d'air / chamans", "pally-aura": "Auras / paladins" };

type RaidTab = "compo" | "inscriptions" | "preparation" | "butin" | "bilan" | "reglages";
type Pick = { kind: "bench"; key: string } | { kind: "slot"; group: number; pos: number } | null;

/** Ce qu'on peut placer : un perso du site, ou un inscrit sans compte (classe et spé choisies sur Discord). */
interface Entry {
  key: string; ref: { characterId: string } | { signupId: string };
  name: string; cls: string; spec: string; signup?: RaidSignup; guest: boolean;
  /** Joueur propriétaire du perso (site) ; niveau du perso si connu. */
  owner: string; level: number | null;
}

export function RaidPage() {
  const { groupId = "", raidId = "", tab: tabParam } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const gt = useGameText();
  const raidQ = useQuery({ queryKey: ["raid", raidId], queryFn: () => get<RaidResponse>(`/groups/${groupId}/raids/${raidId}`) });
  const charsQ = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[] }>(`/groups/${groupId}/characters`) });

  const [slots, setSlots] = useState<RaidSlot[]>([]);
  const [name, setName] = useState("");
  const [when, setWhen] = useState<string | null>(null);
  const [desc, setDesc] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  // Glisser-déposer (refonte du 09/11) : ce qui est glissé, et la place survolée
  const [drag, setDrag] = useState<Pick>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  // Téléphone : « Placer X dans… » (feuille par groupe)
  const [sheet, setSheet] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [filter, setFilter] = useState("");
  const historyQ = useQuery({ queryKey: ["bench-history", raidId], queryFn: () => get<BenchHistory>(`/groups/${groupId}/raids/${raidId}/bench-history`) });
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const server = useRef<ServerState | null>(null);
  /** Numéro de la dernière modification locale ; « pending » tant qu'elle n'est pas enregistrée. */
  const edit = useRef(0);
  const pending = useRef(false);
  const myId = useMe().data?.user?.id;
  // Mes persos pour réserver : ceux rangés dans le groupe (main en tête), puis ceux sans groupe
  const myAllQ = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const myLootChars = useMemo(() => {
    const here = (charsQ.data?.characters ?? []).filter(c => c.userId === myId && c.cls).sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
    return [...here, ...(myAllQ.data?.characters ?? []).filter(c => c.cls && !c.group && !here.some(h => h.id === c.id))];
  }, [charsQ.data, myAllQ.data, myId]);

  const applyServer = (st: ServerState) => {
    server.current = st;
    setSlots(st.slots); setName(st.name); setWhen(st.scheduledAt); setDesc(st.description);
  };
  const fromResponse = (d: RaidResponse): ServerState =>
    ({ version: d.version, slots: d.slots, name: d.raid.name, scheduledAt: d.raid.scheduledAt, description: d.raid.description });

  // Premier chargement, puis chaque nouvelle version venue d'ailleurs (autre officier, autre onglet),
  // sauf pendant une modification locale en cours : elle sera fusionnée à l'enregistrement.
  useEffect(() => {
    const d = raidQ.data;
    if (!d || pending.current || d.version === server.current?.version) return;
    applyServer(fromResponse(d));
  }, [raidQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useLiveListener(useCallback((e: LiveEvent) => {
    if (e.t !== "raid" || e.r !== raidId || !e.by || e.by === myId || !e.byName) return;
    setNotice(`${e.byName} vient de modifier ce raid.`);
    window.setTimeout(() => setNotice(null), 5000);
  }, [raidId, myId]));

  const canEdit = !!raidQ.data?.canEdit;
  // Sans-réponse, relances et demandes (officiers)
  const reachQ = useQuery({ queryKey: ["reach", raidId], queryFn: () => get<Reach>(`/groups/${groupId}/raids/${raidId}/reach`), enabled: canEdit });
  const chars = useMemo(() => new Map((charsQ.data?.characters ?? []).map(c => [c.id, c])), [charsQ.data]);
  // Spé et statut choisis à l'inscription, par perso
  const signupByChar = useMemo(() => new Map((raidQ.data?.signups ?? []).filter(s => s.characterId).map(s => [s.characterId!, s])), [raidQ.data]);
  const entries = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const c of charsQ.data?.characters ?? []) {
      const su = signupByChar.get(c.id);
      m.set(`c:${c.id}`, { key: `c:${c.id}`, ref: { characterId: c.id }, name: c.name, cls: c.cls, spec: su?.spec || c.spec1, owner: c.owner ?? "", level: c.level, signup: su, guest: false });
    }
    for (const su of raidQ.data?.signups ?? []) {
      if (su.userId || !su.cls) continue; // inscrit sans compte (un « absent » n'a pas de classe)
      m.set(`s:${su.id}`, { key: `s:${su.id}`, ref: { signupId: su.id }, name: su.displayName, cls: su.cls, spec: su.spec, owner: "Discord", level: null, signup: su, guest: true });
    }
    return m;
  }, [charsQ.data, raidQ.data, signupByChar]); // eslint-disable-line react-hooks/exhaustive-deps
  const entryAt = (s: RaidSlot) => entries.get(slotKey(s));
  const [hover, setHover] = useState<{ key: string; rect: DOMRect } | null>(null);
  const hoverProps = (e: Entry) => ({
    onMouseEnter: (ev: React.MouseEvent<HTMLElement>) => setHover({ key: e.key, rect: ev.currentTarget.getBoundingClientRect() }),
    onMouseLeave: () => setHover(null),
    onFocus: (ev: React.FocusEvent<HTMLElement>) => setHover({ key: e.key, rect: ev.currentTarget.getBoundingClientRect() }),
    onBlur: () => setHover(null),
  });
  const hovered = hover ? entries.get(hover.key) : undefined;
  const placed = new Set(slots.map(slotKey));
  const matches = (e: Entry) => !filter || `${e.name} ${e.owner} ${e.cls} ${e.spec} ${gt.cls(e.cls)} ${gt.spec(e.cls, e.spec)}`.toLowerCase().includes(filter.toLowerCase());
  const allChars = charsQ.data?.characters ?? [];
  const available = (e: Entry) => !!e.signup && SIGNUP_AVAILABLE.includes(e.signup.status);
  const order = (e: Entry) => SIGNUP_AVAILABLE.indexOf(e.signup!.status);
  const free = [...entries.values()].filter(e => !placed.has(e.key) && matches(e));
  const benchSigned = free.filter(available).sort((a, b) => order(a) - order(b));
  const benchOthers = free.filter(e => !e.guest && !e.signup);
  const bench = [...benchSigned, ...benchOthers];
  const members = slots.flatMap(s => { const e = entryAt(s); return e ? [{ characterId: e.key, cls: e.cls, spec: e.spec || null, group: s.group }] : []; });
  const coverage = computeCoverage(members, effectsOf(gt.game));
  const budget = exclusiveBudget(members, effectsOf(gt.game)).filter(b => b.available > 0 || members.length);

  const persist = (next: RaidSlot[], meta = { name, when, desc }) => {
    setSlots(next);
    if (!canEdit) return;
    window.clearTimeout(timer.current);
    const mine = ++edit.current;
    pending.current = true;
    setStatus("Enregistrement…");
    timer.current = window.setTimeout(async () => {
      const base = server.current;
      try {
        const res = await put<SaveResponse>(`/groups/${groupId}/raids/${raidId}`, {
          name: meta.name.trim() || "Raid", scheduledAt: meta.when, description: meta.desc, slots: next,
          ...(base && { base }),
        });
        const st: ServerState = { version: res.version, slots: res.slots, ...res.raid };
        if (edit.current === mine) {
          pending.current = false;
          // Fusion avec les changements d'un autre officier : on affiche le résultat
          if (res.merged) applyServer(st); else server.current = st;
        } else server.current = st;
        setStatus(res.merged ? "Enregistré (fusionné avec les changements d'un autre officier)." : "Enregistré."); setError(null);
      } catch (e) {
        if (edit.current === mine) pending.current = false;
        setStatus("");
        if (e instanceof ApiError && e.status === 409) {
          const fresh = await raidQ.refetch();
          if (fresh.data) applyServer(fromResponse(fresh.data));
        }
        setError(e instanceof ApiError ? e.message : "Enregistrement impossible.");
      }
    }, 600);
  };

  const at = (g: number, p: number) => slots.find(s => s.group === g && s.pos === p);
  /** Pose ce qui est choisi (clic) ou glissé sur une place : depuis le banc, ou déplace / échange deux places. */
  const move = (src: Pick, g: number, p: number) => {
    if (!canEdit || !src) return false;
    const here = at(g, p);
    if (src.kind === "bench") {
      const e = entries.get(src.key);
      if (!e) return false;
      const next = slots.filter(s => !(s.group === g && s.pos === p));
      next.push({ group: g, pos: p, ...e.ref });
      persist(next); return true;
    }
    if (src.group === g && src.pos === p) return false;
    const from = at(src.group, src.pos);
    const next = slots.filter(s => s !== from && s !== here);
    if (from) next.push({ ...from, group: g, pos: p });
    if (here) next.push({ ...here, group: src.group, pos: src.pos });
    persist(next); return true;
  };
  const clickSlot = (g: number, p: number) => {
    if (!canEdit) return;
    if (pick) {
      if (!(pick.kind === "slot" && pick.group === g && pick.pos === p)) move(pick, g, p);
      setPick(null); return;
    }
    if (at(g, p)) setPick({ kind: "slot", group: g, pos: p });
  };
  const endDrag = () => { setDrag(null); setDropOn(null); };
  /** Une place accepte un dépôt (glisser-déposer à la souris) ; le clic-clic reste pour le clavier et le tactile. */
  const dropProps = (g: number, p: number) => canEdit ? {
    onDragOver: (ev: React.DragEvent) => { if (!drag) return; ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDropOn(`${g}:${p}`); },
    onDragLeave: () => setDropOn(d => (d === `${g}:${p}` ? null : d)),
    onDrop: (ev: React.DragEvent) => { ev.preventDefault(); move(drag, g, p); setPick(null); endDrag(); },
  } : {};
  const dragProps = (src: NonNullable<Pick>, label: string) => canEdit ? {
    draggable: true,
    onDragStart: (ev: React.DragEvent) => { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", label); setPick(null); setHover(null); setDrag(src); },
    onDragEnd: endDrag,
  } : {};
  const dragged = drag ? (drag.kind === "bench" ? entries.get(drag.key) : (() => { const s = at(drag.group, drag.pos); return s ? entryAt(s) : undefined; })()) : undefined;
  /** Téléphone : un perso du banc ouvre « Placer X dans… » ; ordinateur : il est choisi, puis la place. */
  const phone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
  const size = raidQ.data?.raid.size ?? 40;
  // Groupes du format (2 à 10, 4 à 20, 8 à 40), plus ceux encore occupés
  const nGroups = Math.min(RAID_GROUPS, Math.max(groupsFor(size), ...slots.map(s => s.group)));
  const firstFree = (only?: number) => {
    for (let g = only ?? 1; g <= (only ?? groupsFor(size)); g++) for (let p = 1; p <= GROUP_SIZE; p++) if (!at(g, p)) return { g, p };
    return null;
  };
  const addToRaid = (e: Entry, group?: number) => { const f = firstFree(group); if (f) persist([...slots, { group: f.g, pos: f.p, ...e.ref }]); };
  const removeFrom = (g: number, p: number) => { setPick(null); persist(slots.filter(s => !(s.group === g && s.pos === p))); };

  if (raidQ.isLoading || charsQ.isLoading) return <p className="muted">Chargement…</p>;
  if (!raidQ.data) return <div className="panel empty"><h2>Raid introuvable</h2><Link to={`/groups/${groupId}`}>Retour à la guilde</Link></div>;

  const byKind = (k: EffectKind) => coverage.filter(c => c.effect.kind === k);
  const r = raidQ.data.raid;
  const covOn = coverage.filter(c => c.covered).length;
  const covPart = coverage.filter(c => c.effect.scope === "party" && c.sources > 0 && !c.covered);
  const forever = gt.game === "forever";
  // Inscrits qui viennent (présent, en retard), par rôle : pour tout le monde (refonte du 09/11) ; placés / visés : Compo › Besoins
  const comingSignups = raidQ.data.signups.filter(x => x.status === "present" || x.status === "late");
  const comingRoles = roleCounts(comingSignups.map(x => ({ characterId: x.id, cls: x.cls, spec: x.spec || null, group: 0 })));
  const answered = raidQ.data.signups.filter(x => x.status !== "absent").length;
  // Onglets selon le moment (refonte du 09/11) : avant le raid, les inscriptions d'abord ; après (bilan reçu, ou 3 h après
  // l'heure), le bilan d'abord. Butin : seulement en soft reserve ou en conseil ; le mode de butin se règle dans Réglages.
  const after = !!raidQ.data.log || (!!when && Date.now() > Date.parse(when) + 3 * 3600e3);
  const lootTab = r.lootMode === "softres" || r.lootMode === "council";
  const ins: [RaidTab, string] = ["inscriptions", `Inscriptions · ${answered}`];
  const tabs: [RaidTab, string][] = [
    ...(after ? [["bilan", "Bilan"], ins, ["compo", "Compo"]] as [RaidTab, string][] : [ins, ["compo", "Compo"]] as [RaidTab, string][]),
    ...(!after && forever ? [["preparation", "Préparation"]] as [RaidTab, string][] : []),
    ...(lootTab ? [["butin", "Butin"]] as [RaidTab, string][] : []),
    ...(canEdit ? [["reglages", "Réglages"]] as [RaidTab, string][] : []),
  ];
  const tab: RaidTab = tabs.some(([k]) => k === tabParam) ? tabParam as RaidTab : tabs[0]![0];
  const setTab = (k: RaidTab) => nav(`/groups/${groupId}/raids/${raidId}${k === tabs[0]![0] ? "" : `/${k}`}`, { replace: true });
  const publish = () => void (async () => {
    try {
      if (r.rosterPublished) await del(`/groups/${groupId}/raids/${raidId}/roster`);
      else await post(`/groups/${groupId}/raids/${raidId}/roster`);
      await qc.invalidateQueries({ queryKey: ["raid", raidId] });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
  })();
  const sheetEntry = sheet ? entries.get(sheet) : undefined;
  const lootPicker = canEdit && (
    <section className="stack" aria-labelledby="rp-loot"><h3 id="rp-loot" style={{ margin: 0 }}>Mode de butin</h3>
      <LootModePicker mode={r.lootMode} hidden={r.srHidden} idPrefix="rp"
        onChange={(lootMode, srHidden) => void patch(`/groups/${groupId}/raids/${raidId}/loot`, { lootMode, srHidden })
          .then(() => qc.invalidateQueries({ queryKey: ["raid", raidId] })).catch(e => setError(e instanceof ApiError ? e.message : "Changement impossible."))} />
      {gt.game === "retail" && (
        <p className="hint" style={{ margin: 0 }}>{r.lootMode === "council"
          ? "En jeu, l'addon Roster active la distribution pour ce raid : chacun passe sur le butin de groupe, le chef de butin (le chef de raid, sauf autre choix) reçoit les objets puis les attribue d'un clic. Les objets reçus comptent dans la colonne « Reçus » (onglet Présence & butin)."
          : "En jeu, chacun joue le butin de groupe du jeu ; l'addon Roster note qui reçoit quoi pour le bilan du raid. Choisis « Conseil » pour que le chef de butin distribue avec l'addon Roster."}</p>
      )}
    </section>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head rp-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow"><Link to={`/groups/${groupId}/raids`}>{forever ? "← Raids" : "Retour à la guilde"}</Link></div>
          <h1>{name || "Raid"}</h1>
          <p className="rp-meta">
            <span>{longDate(partsOf(when))}</span>
            <span aria-hidden="true">·</span><span>{r.difficulty ? `${DIFFICULTY_LABEL[r.difficulty][gt.lang]} · ` : ""}{size} joueurs</span>
            <span aria-hidden="true">·</span><span>{lootModeLabel(r.lootMode, gt.game)}</span>
            {r.rosterPublished && <span className="tag ok" title="L'annonce Discord affiche la compo">Compo publiée</span>}
          </p>
          <div className="rp-coming" aria-label="Inscrits qui viennent">
            <b>{comingSignups.length} {comingSignups.length > 1 ? "viennent" : "vient"}</b>
            <RoleTag role="Tank" text={`${comingRoles.Tank} tank${comingRoles.Tank > 1 ? "s" : ""}`}>{comingRoles.Tank}</RoleTag>
            <RoleTag role="Heal" text={`${comingRoles.Heal} heal${comingRoles.Heal > 1 ? "s" : ""}`}>{comingRoles.Heal}</RoleTag>
            <RoleTag role="DPS" text={`${comingRoles.DPS} DPS`}>{comingRoles.DPS}</RoleTag>
          </div>
        </div>
        {canEdit && <button type="button" className="btn rp-gear" aria-label="Réglages du raid" aria-pressed={tab === "reglages"} onClick={() => setTab("reglages")}>⚙</button>}
      </div>
      {desc && <p className="rp-desc">{desc}</p>}
      {forever && !after && <MyAnswer groupId={groupId} raidId={raidId} raidName={name || r.name} signups={raidQ.data.signups} groupChars={allChars} />}
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert info" role="status">{notice}</div>}
      {hover && hovered && !drag && (
        <FloatingTip rect={hover.rect}><PlayerCard e={hovered} c={"characterId" in hovered.ref ? chars.get(hovered.ref.characterId) : undefined} /></FloatingTip>
      )}

      <div className="panel lift">
        <div className="tabs rp-tabs" role="tablist" style={{ ["--n" as string]: tabs.length } as React.CSSProperties}>
          {tabs.map(([k, l]) => <button key={k} type="button" role="tab" className={`tab${k === "reglages" ? " rp-settab" : ""}`} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="pane stack">
          {tab === "compo" && <>
            {canEdit && (
        <RaidAssist size={size} targets={raidQ.data.raid.targets} groupChars={allChars} signups={raidQ.data.signups} history={historyQ.data} reach={reachQ.data}
        published={r.rosterPublished} onPublish={publish}
        onAsk={(characterId, spec) => void post(`/groups/${groupId}/raids/${raidId}/asks`, { characterId, spec })
          .then(() => qc.invalidateQueries({ queryKey: ["reach", raidId] })).catch(e => setError(e instanceof ApiError ? e.message : "Demande impossible."))}
        entries={[...entries.values()].map(e => ({ key: e.key, name: e.name, cls: e.cls, spec: e.spec, owner: e.owner, signup: e.signup,
          characterId: "characterId" in e.ref ? e.ref.characterId : null, placed: placed.has(e.key) }))}
        onPlace={key => { const e = entries.get(key); if (e) addToRaid(e); }}
        onSpec={(signupId, spec) => void patch(`/groups/${groupId}/raids/${raidId}/signups/${signupId}`, { spec })
          .then(() => qc.invalidateQueries({ queryKey: ["raid", raidId] })).catch(e => setError(e instanceof ApiError ? e.message : "Changement impossible."))}
        onBench={ids => void (async () => {
          try {
            for (const id of ids) await patch(`/groups/${groupId}/raids/${raidId}/signups/${id}`, { status: "bench" });
            // Les persos mis sur le banc quittent la compo
            const benched = new Set([...entries.values()].filter(e => e.signup && ids.includes(e.signup.id)).map(e => e.key));
            if (slots.some(s => benched.has(slotKey(s)))) persist(slots.filter(s => !benched.has(slotKey(s))));
            await qc.invalidateQueries({ queryKey: ["raid", raidId] });
          } catch (e) { setError(e instanceof ApiError ? e.message : "Changement impossible."); }
        })()} />
            )}
      <div className={`raid${canEdit ? " editing" : ""}`}>
        <div className="rgroups">
          {Array.from({ length: nGroups }, (_, gi) => gi + 1).map(g => {
            const missing = coverage.filter(c => c.effect.scope === "party" && c.effect.kind === "aura" && c.missingGroups.includes(g) && c.sources > 0).map(c => c.effect.name);
            const filled = slots.filter(s => s.group === g).length;
            return (
              <div className="rgroup" key={g}>
                <h4><span>Groupe {g}</span>{missing.length > 0 && <span className="tag warn" title={`Manque : ${missing.join(", ")}`}>{missing.length} aura{missing.length > 1 ? "s" : ""}</span>}<span className="num rg-n">{filled}/{GROUP_SIZE}</span></h4>
                {Array.from({ length: GROUP_SIZE }, (_, pi) => pi + 1).map(p => {
                  const s = at(g, p);
                  const c = s ? entryAt(s) : undefined;
                  const cl = c ? { color: gt.color(c.cls) } : undefined;
                  const sel = pick?.kind === "slot" && pick.group === g && pick.pos === p;
                  const over = dropOn === `${g}:${p}`;
                  const moving = drag?.kind === "slot" && drag.group === g && drag.pos === p;
                  return (
                    <div key={p} className="rslot">
                      <button type="button" className={`slot${c ? " filled" : ""}${(pick || drag) && !sel && !moving ? " target" : ""}${sel ? " selected" : ""}${over ? " over" : ""}${moving ? " moving" : ""}`}
                        style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }} onClick={() => clickSlot(g, p)} disabled={!canEdit && !c}
                        {...(c && !drag ? hoverProps(c) : {})} {...dropProps(g, p)} {...(c ? dragProps({ kind: "slot", group: g, pos: p }, c.name) : {})}
                        aria-label={c ? `Groupe ${g}, place ${p} : ${c.name}` : `Groupe ${g}, place ${p} : libre`}>
                        {over && dragged ? <span className="who drop">Déposer {dragged.name} ici</span>
                          : c ? <span className="who"><ClassIcon cls={c.cls} size={14} className="inline" />{c.name}{c.guest && <span className="su-guest" title="Inscrit depuis Discord, sans compte sur le site"> ✱</span>}</span>
                          : <span className="who free">Libre</span>}
                        {c && !over && <RoleIcon role={roleOf(c.spec)} size={14} pill={{ padding: "3px 5px", fontSize: 9 }} />}
                      </button>
                      {c && canEdit && <button type="button" className="x" aria-label={`Retirer ${c.name}`} onClick={() => removeFrom(g, p)}>×</button>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {canEdit && (
          <aside className="rp-bench panel pad stack" aria-label="Banc"
            onDragOver={ev => { if (drag?.kind === "slot") { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } }}
            onDrop={ev => { if (drag?.kind === "slot") { ev.preventDefault(); removeFrom(drag.group, drag.pos); } endDrag(); }}>
            <h3 className="row between">Banc <span className="num">{bench.length}</span></h3>
            <input type="text" aria-label="Filtrer le banc" placeholder="Filtrer : nom, joueur, classe…" value={filter} onChange={e => setFilter(e.target.value)} />
            <div className="bench">
              {bench.length === 0 ? <p className="small" style={{ margin: 0 }}>Tous les persos de la guilde sont placés.</p> : bench.map((c, i) => {
                const cl = { color: gt.color(c.cls) };
                const on = pick?.kind === "bench" && pick.key === c.key;
                const su = c.signup;
                return (
                  <div key={c.key} className="stack" style={{ gap: 4 }}>
                  {i === 0 && benchSigned.length > 0 && <div className="lbl">Inscrits</div>}
                  {i === benchSigned.length && benchOthers.length > 0 && <div className="lbl">Autres persos de la guilde (non inscrits)</div>}
                  <div className={`rp-bi${drag?.kind === "bench" && drag.key === c.key ? " moving" : ""}`}>
                    <button type="button" className={`slot filled${on ? " selected" : ""}`} style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }}
                      onClick={() => { if (phone()) { setPick(null); setSheet(c.key); } else setPick(on ? null : { kind: "bench", key: c.key }); }}
                      {...(drag ? {} : hoverProps(c))} {...dragProps({ kind: "bench", key: c.key }, c.name)}>
                      <span className="grip" aria-hidden="true">⋮⋮</span>
                      <span className="who"><ClassIcon cls={c.cls} size={14} className="inline" />{c.name}{c.guest && <span className="su-guest" title="Inscrit depuis Discord, sans compte sur le site"> ✱</span>}<small>{[c.level ? `Niv. ${c.level}` : null, (c.cls && gt.specOrClass(c.cls, c.spec)) || "?", c.guest ? "Discord, sans compte" : c.owner].filter(Boolean).join(" · ")}</small></span>
                      {su && su.status !== "present" && <span className="tag">{SIGNUP_LABEL[su.status]}</span>}
                      {gt.game !== "retail" && !c.guest && "characterId" in c.ref && chars.get(c.ref.characterId) && !chars.get(c.ref.characterId)!.addonSyncedAt && <span className="rp-nosync" title="Jamais synchronisé avec l'addon">⚠</span>}
                    </button>
                    <button type="button" className="btn rp-add" title="Placer à la première place libre" aria-label={`Ajouter ${c.name} au raid`} onClick={() => addToRaid(c)}>+</button>
                  </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
            <p className="hint rp-foot" style={{ margin: 0 }}>
              {canEdit ? (pick ? "Choisis maintenant une place (clique à nouveau pour annuler)." : "Glisse un perso du banc vers une place, ou clique le perso puis la place. Clique un perso placé pour le déplacer ou l'échanger.") : "Compo préparée par les officiers."}
              {canEdit && <span className="rp-status" role="status"> {status}</span>}
            </p>
            <details className="rp-covd panel pad">
              <summary>Couverture · {covOn} effet{covOn > 1 ? "s" : ""} sur {coverage.length}{covPart.length > 0 ? ` · partiels : ${covPart.map(c => `${gt.effect(c.effect)} (G${c.missingGroups.join(", G")})`).join(", ")}` : ""}</summary>
            <div className="cov">
              {(["buff", "aura", "debuff", "utility"] as EffectKind[]).map(k => (
                <div key={k} className="stack" style={{ gap: 4 }}>
                  <h4>{gt.game === "retail" && k === "aura" ? "Auras" : KIND_LABEL[k]}</h4>
                  {byKind(k).map(c => {
                    const partial = c.effect.scope === "party" && c.sources > 0 && !c.covered;
                    return (
                      <div key={c.effect.id} className={`it ${c.covered ? "on" : partial ? "part" : "off"}`} title={c.effect.note ?? ""}>
                        <span className="dot" aria-hidden="true" />
                        <span title={"effect" in c.effect ? (c.effect as { effect: Record<string, string> }).effect[gt.lang] : undefined}>{gt.effect(c.effect)}{partial && <span className="small"> · manque G{c.missingGroups.join(", G")}</span>}</span>
                        <span className="num small">{c.sources || ""}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {budget.some(b => b.available < b.wanted && b.available > 0) && (
                <div className="stack" style={{ gap: 4 }}>
                  <h4>Sources limitées</h4>
                  {budget.filter(b => b.available > 0 && b.available < b.wanted).map(b => (
                    <div key={b.group} className="small">{EXCL_LABEL[b.group] ?? b.group} : <span className="num">{b.available}</span> pour {b.wanted} effets</div>
                  ))}
                </div>
              )}
              <p className="hint" style={{ margin: "8px 0 0" }}>{gt.game === "retail"
                ? `Buffs et affaiblissements de raid de Midnight (${coverage.length}), une source suffit pour tout le raid. Spé choisie à l'inscription, sinon spé principale.`
                : `Règles de WoW Classic (${RAID_EFFECTS.length} effets), à ajuster selon les changements de Forever. Spé choisie à l'inscription, sinon spé principale.`}</p>
            </div>
            </details>
            <RaidExport raid={{ id: raidId, name: name || raidQ.data.raid.name, scheduledAt: when, difficulty: r.difficulty, size }} slots={slots} chars={chars} signups={raidQ.data.signups} retail={gt.game === "retail"} />
            {sheetEntry && (
              <PlaceSheet name={sheetEntry.name} groups={Array.from({ length: groupsFor(size) }, (_, i) => ({ g: i + 1, filled: slots.filter(x => x.group === i + 1).length }))}
                onPick={g => { addToRaid(sheetEntry, g); setSheet(null); }} onFirst={() => { addToRaid(sheetEntry); setSheet(null); }} onClose={() => setSheet(null)} />
            )}
          </>}

          {tab === "inscriptions" && <>
            <RaidSignups groupId={groupId} raidId={raidId} signups={raidQ.data.signups} groupChars={allChars} canEdit={canEdit} />
            {canEdit && reachQ.data && <RaidReach groupId={groupId} raidId={raidId} reach={reachQ.data} onChanged={() => void qc.invalidateQueries({ queryKey: ["reach", raidId] })} />}
          </>}

          {tab === "butin" && <>
            <p style={{ margin: 0 }}>Butin : <b>{lootModeLabel(r.lootMode, gt.game)}</b> · {lootModeHint(r.lootMode, gt.game)}{canEdit && <> · <button type="button" className="link" onClick={() => setTab("reglages")}>changer dans Réglages</button></>}</p>
            {/* Roster : pas de soft reserve (lot R3b) */}
            {r.lootMode === "softres" && gt.game !== "retail" && <SoftReservePanel groupId={groupId} raidId={raidId} officer={canEdit} myChars={myLootChars} />}
            {r.lootMode === "council" && <CouncilPicker groupId={groupId} raidId={raidId} retail={gt.game === "retail"} />}
          </>}

          {tab === "preparation" && <RaidPrepPanel groupId={groupId} raidId={raidId} />}

          {tab === "bilan" && <RaidLogPanel log={raidQ.data.log} groupId={groupId} raidId={raidId} officer={canEdit} />}

          {tab === "reglages" && canEdit && (
            <div className="rp-set">
              <div className="fld"><label htmlFor="rn">Nom</label><input id="rn" type="text" maxLength={60} value={name} onChange={e => { setName(e.target.value); persist(slots, { name: e.target.value, when, desc }); }} /></div>
              <div className="fld"><label htmlFor="rw">Date et heure (Paris)</label>
                <DateTimeField id="rw" value={when} onChange={iso => { setWhen(iso); persist(slots, { name, when: iso, desc }); }} /></div>
              <div className="fld rp-wide"><label htmlFor="rd">Description (visible par la guilde et sur Discord)</label>
                <textarea id="rd" maxLength={1000} style={{ minHeight: 70 }} placeholder="Ex. Pull à 21 h, flasques obligatoires, loot council." value={desc} onChange={e => { setDesc(e.target.value); persist(slots, { name, when, desc: e.target.value }); }} />
              </div>
              <div className="rp-wide">
                <RaidFormat size={size} targets={r.targets} custom={r.customTargets} retail={r.difficulty ? { name: r.name, difficulty: r.difficulty } : null}
                  onChange={body => void patch(`/groups/${groupId}/raids/${raidId}/format`, body).then(() => qc.invalidateQueries({ queryKey: ["raid", raidId] }))
                    .catch(e => setError(e instanceof ApiError ? e.message : "Changement impossible."))} />
              </div>
              <div className="rp-wide">{lootPicker}</div>
              <div className="row between rp-wide">
                <span className="small" role="status">{status || "Les modifications sont enregistrées automatiquement."}</span>
                {confirmDel
                  ? <span className="row small">Supprimer ce raid ? <button className="btn danger sm" type="button" onClick={() => void del(`/groups/${groupId}/raids/${raidId}`).then(() => nav(`/groups/${groupId}`))}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>
                  : <button className="btn danger sm" type="button" onClick={() => setConfirmDel(true)}>Supprimer le raid…</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Téléphone : « Placer X dans… » (refonte du 09/11) : les groupes du format avec leur remplissage, un groupe plein est
 * désactivé, « Premier groupe libre » en tête.
 */
function PlaceSheet({ name, groups, onPick, onFirst, onClose }: { name: string; groups: { g: number; filled: number }[]; onPick: (g: number) => void; onFirst: () => void; onClose: () => void }) {
  const full = groups.every(x => x.filled >= GROUP_SIZE);
  return (
    <Modal label="ps-t" onClose={onClose}>
      <div className="gd-body rp-sheet">
        <DialogHead id="ps-t" title={`Placer ${name} dans…`} onClose={onClose} />
        <button type="button" className="btn primary" disabled={full} onClick={onFirst}>{full ? "Tous les groupes sont pleins" : "Premier groupe libre"}</button>
        <div className="ps-groups">
          {groups.map(x => (
            <button key={x.g} type="button" className="btn" disabled={x.filled >= GROUP_SIZE} onClick={() => onPick(x.g)}
              aria-label={`Groupe ${x.g}, ${x.filled} sur ${GROUP_SIZE}${x.filled >= GROUP_SIZE ? ", plein" : ""}`}>
              <b>Groupe {x.g}</b><span className="num">{x.filled}/{GROUP_SIZE}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Format du raid (10, 20, 40) et rôles visés ; « par défaut » reprend ceux du format. */
function RaidFormat({ size, targets, custom, retail, onChange }: {
  size: number; targets: RoleTargets; custom: boolean; retail: { name: string; difficulty: RetailDifficulty } | null;
  onChange: (b: { size?: number; difficulty?: RetailDifficulty; targets?: RoleTargets | null }) => void;
}) {
  const [t, setT] = useState(targets);
  useEffect(() => setT(targets), [targets.tank, targets.heal, targets.dps]); // eslint-disable-line react-hooks/exhaustive-deps
  const field = (k: keyof RoleTargets, role: RoleName, label: string) => (
    <label className="ra-t"><span title={label}><RoleTag plain role={role} text={label} /></span>
      <input type="number" min={0} max={40} value={t[k]} onChange={e => setT({ ...t, [k]: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
        onBlur={() => { if (t[k] !== targets[k]) onChange({ targets: t }); }} /></label>
  );
  return (
    <div className="fld ra-format" style={{ flex: "1 1 100%" }}>
      <span className="lbl">{retail ? "Difficulté, effectif et rôles visés" : "Format et rôles visés"}</span>
      {retail && <RetailFormat name={retail.name} difficulty={retail.difficulty} size={size} idPrefix="rf" hideTargets
        onChange={f => onChange(f.difficulty !== retail.difficulty ? { difficulty: f.difficulty } : { size: f.size })} />}
      <div className="row" style={{ alignItems: "center" }}>
        {!retail && <div className="seg" role="group" aria-label="Format du raid">
          {RAID_SIZES.map(n => <button key={n} type="button" className={size === n ? "on" : ""} aria-pressed={size === n} onClick={() => size !== n && onChange({ size: n })}>{n}</button>)}
        </div>}
        {field("tank", "Tank", "Tanks")}{field("heal", "Heal", "Heals")}{field("dps", "DPS", "DPS")}
        {custom
          ? <button type="button" className="btn ghost sm" onClick={() => onChange({ targets: null })}>Par défaut</button>
          : <span className="hint">par défaut pour un raid à {size}</span>}
      </div>
    </div>
  );
}
