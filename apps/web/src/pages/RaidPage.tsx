import {
  CLASSES, computeCoverage, exclusiveBudget, GROUP_SIZE, RAID_EFFECTS, RAID_GROUPS, roleCounts, roleOf, type ClassName, type EffectKind,
} from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, del, get, post, put, slotKey, type Character, type RaidChar, type RaidSignup, type RaidSlot } from "../api";
import { RaidExport } from "../components/RaidExport";
import { useLiveListener, type LiveEvent } from "../live";
import { useMe } from "../auth";
import { RaidSignups } from "../components/RaidSignups";
import { SIGNUP_AVAILABLE, SIGNUP_LABEL } from "@forever/game-data";
import { ClassIcon } from "../components/Icons";
import { FloatingTip } from "../components/ItemTooltip";

/** Carte d'un joueur au survol : spé, inscription, métiers, niveau d'objet moyen et BiS obtenus. */
function PlayerCard({ e, c }: { e: Entry; c?: Character }) {
  const cl = CLASSES[e.cls as ClassName];
  const st = c?.gearStats;
  const profs = c ? [c.professions.prof1, c.professions.prof2].filter(p => p.name) : [];
  return (
    <>
      <div className="t-name" style={{ color: cl?.color }}>{e.name}</div>
      <div className="t-row">{[e.level ? `Niveau ${e.level}` : null, e.spec || e.cls].filter(Boolean).join(" · ")}</div>
      <div className="t-dim">{e.guest ? "Inscrit depuis Discord, sans compte sur le site" : `Joueur : ${e.owner}`}</div>
      {e.signup && <div className="t-row">Inscription : {SIGNUP_LABEL[e.signup.status]}{e.signup.note ? ` — « ${e.signup.note} »` : ""}</div>}
      {profs.length > 0 && <div className="t-row">Métiers : {profs.map(p => `${p.name} ${p.skill}`).join(", ")}</div>}
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

interface RaidResponse { raid: { id: string; name: string; scheduledAt: string | null; description: string; rosterPublished: boolean }; version: string; canEdit: boolean; slots: RaidSlot[]; characters: RaidChar[]; signups: RaidSignup[] }
interface SaveResponse { slots: RaidSlot[]; version: string; merged: boolean; raid: { name: string; scheduledAt: string | null; description: string } }
/** Dernier état connu du serveur : base de la fusion quand deux officiers modifient la compo en même temps. */
interface ServerState { version: string; slots: RaidSlot[]; name: string; scheduledAt: string | null; description: string }

const KIND_LABEL: Record<EffectKind, string> = { buff: "Buffs de raid", aura: "Auras et totems (par groupe)", debuff: "Debuffs sur la cible", utility: "Utilitaires" };
const EXCL_LABEL: Record<string, string> = { blessing: "Bénédictions / paladins", curse: "Malédictions / démonistes", judgement: "Jugements / paladins", "air-totem": "Totems d'air / chamans", "pally-aura": "Auras / paladins" };
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

type Pick = { kind: "bench"; key: string } | { kind: "slot"; group: number; pos: number } | null;

/** Ce qu'on peut placer : un perso du site, ou un inscrit sans compte (classe et spé choisies sur Discord). */
interface Entry {
  key: string; ref: { characterId: string } | { signupId: string };
  name: string; cls: string; spec: string; signup?: RaidSignup; guest: boolean;
  /** Joueur propriétaire du perso (site) ; niveau du perso si connu. */
  owner: string; level: number | null;
}

export function RaidPage() {
  const { groupId = "", raidId = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const raidQ = useQuery({ queryKey: ["raid", raidId], queryFn: () => get<RaidResponse>(`/groups/${groupId}/raids/${raidId}`) });
  const charsQ = useQuery({ queryKey: ["group-chars", groupId], queryFn: () => get<{ characters: Character[] }>(`/groups/${groupId}/characters`) });

  const [slots, setSlots] = useState<RaidSlot[]>([]);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [desc, setDesc] = useState("");
  const [pick, setPick] = useState<Pick>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const server = useRef<ServerState | null>(null);
  /** Numéro de la dernière modification locale ; « pending » tant qu'elle n'est pas enregistrée. */
  const edit = useRef(0);
  const pending = useRef(false);
  const myId = useMe().data?.user?.id;

  const applyServer = (st: ServerState) => {
    server.current = st;
    setSlots(st.slots); setName(st.name); setWhen(toLocalInput(st.scheduledAt)); setDesc(st.description);
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
  const matches = (e: Entry) => !filter || `${e.name} ${e.owner} ${e.cls} ${e.spec}`.toLowerCase().includes(filter.toLowerCase());
  const allChars = charsQ.data?.characters ?? [];
  const available = (e: Entry) => !!e.signup && SIGNUP_AVAILABLE.includes(e.signup.status);
  const order = (e: Entry) => SIGNUP_AVAILABLE.indexOf(e.signup!.status);
  const free = [...entries.values()].filter(e => !placed.has(e.key) && matches(e));
  const benchSigned = free.filter(available).sort((a, b) => order(a) - order(b));
  const benchOthers = free.filter(e => !e.guest && !e.signup);
  const bench = [...benchSigned, ...benchOthers];
  const members = slots.flatMap(s => { const e = entryAt(s); return e ? [{ characterId: e.key, cls: e.cls, spec: e.spec || null, group: s.group }] : []; });
  const coverage = computeCoverage(members);
  const budget = exclusiveBudget(members).filter(b => b.available > 0 || members.length);
  const roles = roleCounts(members);

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
          name: meta.name.trim() || "Raid", scheduledAt: meta.when ? new Date(meta.when).toISOString() : null, description: meta.desc, slots: next,
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
  const clickSlot = (g: number, p: number) => {
    if (!canEdit) return;
    const here = at(g, p);
    if (pick?.kind === "bench") {
      const e = entries.get(pick.key);
      if (!e) { setPick(null); return; }
      const next = slots.filter(s => !(s.group === g && s.pos === p));
      next.push({ group: g, pos: p, ...e.ref });
      setPick(null); persist(next); return;
    }
    if (pick?.kind === "slot") {
      if (pick.group === g && pick.pos === p) { setPick(null); return; }
      const from = at(pick.group, pick.pos);
      // Déplace ou échange deux places
      const next = slots.filter(s => s !== from && s !== here);
      if (from) next.push({ ...from, group: g, pos: p });
      if (here) next.push({ ...here, group: pick.group, pos: pick.pos });
      setPick(null); persist(next); return;
    }
    if (here) setPick({ kind: "slot", group: g, pos: p });
  };
  const firstFree = () => { for (let g = 1; g <= RAID_GROUPS; g++) for (let p = 1; p <= GROUP_SIZE; p++) if (!at(g, p)) return { g, p }; return null; };
  const addToRaid = (e: Entry) => { const f = firstFree(); if (f) persist([...slots, { group: f.g, pos: f.p, ...e.ref }]); };
  const removeFrom = (g: number, p: number) => { setPick(null); persist(slots.filter(s => !(s.group === g && s.pos === p))); };

  if (raidQ.isLoading || charsQ.isLoading) return <p className="muted">Chargement…</p>;
  if (!raidQ.data) return <div className="panel empty"><h2>Raid introuvable</h2><Link to={`/groups/${groupId}`}>Retour au groupe</Link></div>;

  const byKind = (k: EffectKind) => coverage.filter(c => c.effect.kind === k);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div><div className="eyebrow"><Link to={`/groups/${groupId}`}>Retour au groupe</Link></div><h1>{name || "Raid"}</h1></div>
        <div className="counts" aria-label="Rôles">
          <span className="role Tank">{roles.Tank} tank{roles.Tank > 1 ? "s" : ""}</span>
          <span className="role Heal">{roles.Heal} heal{roles.Heal > 1 ? "s" : ""}</span>
          <span className="role DPS">{roles.DPS} DPS</span>
          {roles["?"] > 0 && <span className="role">{roles["?"]} sans spé</span>}
          <span className="tag num">{slots.length}/40</span>
        </div>
      </div>

      {canEdit && (
        <div className="panel pad row" style={{ alignItems: "flex-end" }}>
          <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="rn">Nom</label><input id="rn" type="text" maxLength={60} value={name} onChange={e => { setName(e.target.value); persist(slots, { name: e.target.value, when, desc }); }} /></div>
          <div className="fld" style={{ flex: "1 1 200px" }}><label htmlFor="rw">Date</label><input id="rw" type="datetime-local" value={when} onChange={e => { setWhen(e.target.value); persist(slots, { name, when: e.target.value, desc }); }} /></div>
          <div className="fld" style={{ flex: "1 1 100%" }}><label htmlFor="rd">Description (visible par le groupe et sur Discord)</label>
            <textarea id="rd" maxLength={1000} style={{ minHeight: 60 }} placeholder="Ex. Pull à 21 h, flasques obligatoires, loot council." value={desc} onChange={e => { setDesc(e.target.value); persist(slots, { name, when, desc: e.target.value }); }} />
          </div>
          <span className="small muted" role="status" style={{ flex: "1 1 120px" }}>{status}</span>
          {confirmDel
            ? <span className="row small">Supprimer ce raid ? <button className="btn danger sm" type="button" onClick={() => void del(`/groups/${groupId}/raids/${raidId}`).then(() => nav(`/groups/${groupId}`))}>Supprimer</button><button className="btn ghost sm" type="button" onClick={() => setConfirmDel(false)}>Annuler</button></span>
            : <button className="btn ghost sm" type="button" onClick={() => setConfirmDel(true)}>Supprimer le raid</button>}
        </div>
      )}
      {!canEdit && desc && <div className="panel pad"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{desc}</p></div>}
      <RaidSignups groupId={groupId} raidId={raidId} signups={raidQ.data.signups} groupChars={allChars} canEdit={canEdit} />
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert info" role="status">{notice}</div>}
      {canEdit && (
        <div className="panel pad row between roster-pub">
          <span>
            <b>Compo sur Discord</b>{raidQ.data.raid.rosterPublished && <span className="tag ok" style={{ marginLeft: 8 }}>Publiée</span>}<br />
            <span className="hint">{raidQ.data.raid.rosterPublished
              ? "L'annonce Discord affiche les groupes et se met à jour à chaque changement de la compo."
              : "Une fois la compo prête, publie-la : l'annonce Discord affichera les 8 groupes à la place des colonnes par rôle."}</span>
          </span>
          <button className={`btn sm ${raidQ.data.raid.rosterPublished ? "ghost" : "primary"}`} type="button" onClick={() => void (async () => {
            try {
              if (raidQ.data!.raid.rosterPublished) await del(`/groups/${groupId}/raids/${raidId}/roster`);
              else await post(`/groups/${groupId}/raids/${raidId}/roster`);
              await qc.invalidateQueries({ queryKey: ["raid", raidId] });
            } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
          })()}>{raidQ.data.raid.rosterPublished ? "Retirer de Discord" : "Publier la compo"}</button>
        </div>
      )}
      {canEdit && <p className="hint" style={{ margin: 0 }}>{pick ? "Choisis maintenant une place (clique à nouveau pour annuler)." : "Clique un perso du banc puis une place. Clique un perso placé pour le déplacer ou l'échanger."}</p>}

      {hover && hovered && (
        <FloatingTip rect={hover.rect}><PlayerCard e={hovered} c={"characterId" in hovered.ref ? chars.get(hovered.ref.characterId) : undefined} /></FloatingTip>
      )}
      <div className="raid">
        <div className="rgroups">
          {Array.from({ length: RAID_GROUPS }, (_, gi) => gi + 1).map(g => {
            const missing = coverage.filter(c => c.effect.scope === "party" && c.effect.kind === "aura" && c.missingGroups.includes(g) && c.sources > 0).map(c => c.effect.name);
            return (
              <div className="rgroup" key={g}>
                <h4><span>Groupe {g}</span>{missing.length > 0 && <span className="tag warn" title={`Manque : ${missing.join(", ")}`}>{missing.length} aura{missing.length > 1 ? "s" : ""}</span>}</h4>
                {Array.from({ length: GROUP_SIZE }, (_, pi) => pi + 1).map(p => {
                  const s = at(g, p);
                  const c = s ? entryAt(s) : undefined;
                  const cl = c ? CLASSES[c.cls as ClassName] : undefined;
                  const sel = pick?.kind === "slot" && pick.group === g && pick.pos === p;
                  return (
                    <div key={p} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button type="button" className={`slot${c ? " filled" : ""}${pick && !sel ? " target" : ""}${sel ? " selected" : ""}`}
                        style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }} onClick={() => clickSlot(g, p)} disabled={!canEdit && !c}
                        {...(c ? hoverProps(c) : {})}
                        aria-label={c ? `Groupe ${g}, place ${p} : ${c.name}` : `Groupe ${g}, place ${p} : libre`}>
                        {c ? <span className="who"><ClassIcon cls={c.cls} size={14} className="inline" />{c.name}{c.guest && <span className="su-guest" title="Inscrit depuis Discord, sans compte sur le site"> ✱</span>}<small>{c.spec || c.cls} · {c.owner}</small></span> : <span className="who muted small">Libre</span>}
                        {c && <span className={`role ${roleOf(c.spec) ?? ""}`} style={{ padding: "3px 5px", fontSize: 9 }}>{roleOf(c.spec) ?? "?"}</span>}
                      </button>
                      {c && canEdit && <button type="button" className="x" aria-label={`Retirer ${c.name}`} onClick={() => removeFrom(g, p)}>×</button>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <aside className="stack">
          {canEdit && (
            <div className="panel pad stack">
              <h3>Banc <span className="muted small">({bench.length})</span></h3>
              <input type="text" aria-label="Filtrer le banc" placeholder="Filtrer (nom, joueur, classe, Discord)…" value={filter} onChange={e => setFilter(e.target.value)} />
              <div className="bench">
                {bench.length === 0 ? <p className="muted small">Tous les persos du groupe sont placés.</p> : bench.map((c, i) => {
                  const cl = CLASSES[c.cls as ClassName];
                  const on = pick?.kind === "bench" && pick.key === c.key;
                  const su = c.signup;
                  return (
                    <div key={c.key} className="stack" style={{ gap: 4 }}>
                    {i === 0 && benchSigned.length > 0 && <div className="lbl">Inscrits</div>}
                    {i === benchSigned.length && benchOthers.length > 0 && <div className="lbl">Autres persos du groupe (non inscrits)</div>}
                    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button type="button" className={`slot filled${on ? " selected" : ""}`} style={{ ["--cc" as string]: cl?.color ?? "var(--line-2)" }} onClick={() => setPick(on ? null : { kind: "bench", key: c.key })} {...hoverProps(c)}>
                        <span className="who"><ClassIcon cls={c.cls} size={14} className="inline" />{c.name}{c.guest && <span className="su-guest" title="Inscrit depuis Discord, sans compte sur le site"> ✱</span>}<small>{[c.level ? `Niv. ${c.level}` : null, c.spec || c.cls || "?", c.guest ? "Discord, sans compte" : c.owner].filter(Boolean).join(" · ")}</small></span>
                        {su && su.status !== "present" && <span className="tag">{SIGNUP_LABEL[su.status]}</span>}
                      </button>
                      <button type="button" className="btn sm ghost" title="Placer à la première place libre" aria-label={`Ajouter ${c.name} au raid`} onClick={() => addToRaid(c)}>+</button>
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel pad stack">
            <h3>Couverture</h3>
            <div className="cov">
              {(["buff", "aura", "debuff", "utility"] as EffectKind[]).map(k => (
                <div key={k} className="stack" style={{ gap: 4 }}>
                  <h4>{KIND_LABEL[k]}</h4>
                  {byKind(k).map(c => {
                    const partial = c.effect.scope === "party" && c.sources > 0 && !c.covered;
                    return (
                      <div key={c.effect.id} className={`it ${c.covered ? "on" : partial ? "part" : "off"}`} title={c.effect.note ?? ""}>
                        <span className="dot" aria-hidden="true" />
                        <span>{c.effect.name}{partial && <span className="small muted"> · manque G{c.missingGroups.join(", G")}</span>}</span>
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
              <p className="hint" style={{ margin: "8px 0 0" }}>Règles de WoW Classic ({RAID_EFFECTS.length} effets), à ajuster selon les changements de Forever. Spé choisie à l'inscription, sinon spé principale.</p>
            </div>
          </div>
        </aside>
      </div>
      <RaidExport raid={{ id: raidId, name: name || raidQ.data.raid.name, scheduledAt: when ? new Date(when).toISOString() : null }} slots={slots} chars={chars} signups={raidQ.data.signups} />
    </div>
  );
}
