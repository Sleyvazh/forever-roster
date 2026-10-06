import { FRENCH_REALMS, RETAIL_CLASS_NAMES, RETAIL_MAX_LEVEL, retailLinks, roleOf, specsOf } from "@forever/game-data";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, post, type Character } from "../api";
import { useGameText } from "../gameText";
import { bnetAge, BnetImportButton, useBnetEnabled, useBnetRefresh } from "./BnetImport";
import { RoleIcon } from "./RoleIcon";

/**
 * Roster (WoW Retail) : fiche légère (choix de Flo, R2) — nom et royaume, classe, spé principale et secondaire,
 * niveau, liens vers l'Armurerie, Raider.IO et Warcraft Logs, notes. Pas d'équipement ni de talents à recopier :
 * Battle.net et les sites de référence les ont déjà (import Battle.net : R2b).
 */

const REALMS_ID = "rc-realms";
export const RealmList = () => <datalist id={REALMS_ID}>{FRENCH_REALMS.map(r => <option key={r} value={r} />)}</datalist>;

export function RetailCharacterSheet({ c, onChange, onRefreshed, subhead, footer }: {
  c: Character; onChange: (p: Partial<Character>) => void; subhead?: ReactNode; footer?: ReactNode;
  /** Fiche relue chez Blizzard (« Mettre à jour ») : la version du serveur remplace la copie locale. */
  onRefreshed?: (c: Character) => void;
}) {
  const t = useGameText();
  const bnetOn = useBnetEnabled();
  const refresh = useBnetRefresh(ch => onRefreshed?.(ch));
  const specs = c.cls ? specsOf("retail", c.cls) : [];
  const roles = [...new Set([roleOf(c.spec1), roleOf(c.spec2)].filter(Boolean))];
  const links = c.name.trim() && c.realm.trim() ? retailLinks(c.name, c.realm, c.realmSlug) : null;
  const setClass = (cls: string) => onChange({ cls, spec1: "", spec2: "" });
  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={`Fiche de ${c.name}`}>
      <div className="dhead" style={{ ["--cc" as string]: t.color(c.cls) ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon"><span className="rc-av" aria-hidden="true">{(c.name || "?")[0]}</span><span>{c.name}</span>{c.realm && <span className="rc-realm">· {c.realm}</span>}</h2>
          <div className="line">Niv. <span className="num">{c.level}</span> · <span className="cls">{c.cls ? t.cls(c.cls) : "Classe ?"}</span>{c.spec1 && ` · ${t.spec(c.cls, c.spec1)}`}{c.ilvl ? <> · ilvl <span className="num">{c.ilvl}</span></> : null}</div>
        </div>
        <div className="row">{roles.map(r => <RoleIcon key={r} role={r} />)}</div>
      </div>
      {subhead}
      {bnetOn && (
        <div className="rc-bnet">
          <span className="rc-bnet-k">Battle.net</span>
          {c.bnetSyncedAt ? (
            <span>Niveau d'objet <b className="num">{c.ilvl ?? "?"}</b>{c.activeSpec && <> · spé active <b>{t.spec(c.cls, c.activeSpec)}</b></>} <span className="muted small">· {bnetAge(c.bnetSyncedAt)}</span></span>
          ) : <span className="muted small">Pas encore lu chez Blizzard (profil public du perso, avec son nom et son royaume).</span>}
          <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
            {c.activeSpec && c.activeSpec !== c.spec1 && (
              <button type="button" className="btn ghost sm" onClick={() => onChange({ spec1: c.activeSpec, ...(c.spec2 === c.activeSpec && { spec2: "" }) })}>
                Prendre {t.spec(c.cls, c.activeSpec)} comme spé principale
              </button>
            )}
            <button type="button" className="btn sm" disabled={refresh.busy || !c.name.trim() || !c.realm.trim()} onClick={() => void refresh.run(c.id)}>
              {refresh.busy ? "Lecture…" : "Mettre à jour"}
            </button>
          </span>
          {refresh.msg && <span className={`small ${refresh.msg.ok ? "muted" : "warnmsg"}`} role="status" style={{ flexBasis: "100%" }}>{refresh.msg.text}</span>}
        </div>
      )}
      <div className="pane">
        <div className="rc-grid">
          <div className="fld"><label htmlFor="rc-name">Nom</label>
            <input id="rc-name" type="text" maxLength={40} value={c.name} onChange={e => onChange({ name: e.target.value })} /></div>
          <div className="fld"><label htmlFor="rc-realm">Royaume</label>
            <input id="rc-realm" type="text" maxLength={40} list={REALMS_ID} value={c.realm} onChange={e => onChange({ realm: e.target.value })} placeholder="Hyjal" /><RealmList /></div>
          <div className="fld"><label htmlFor="rc-cls">Classe</label>
            <select id="rc-cls" value={c.cls} onChange={e => setClass(e.target.value)}>
              <option value="">Choisir…</option>
              {[...RETAIL_CLASS_NAMES].sort((a, b) => t.cls(a).localeCompare(t.cls(b), t.lang)).map(k => <option key={k} value={k}>{t.cls(k)}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="rc-lvl">Niveau</label>
            <input id="rc-lvl" type="number" min={1} max={RETAIL_MAX_LEVEL} value={c.level} onChange={e => onChange({ level: Math.max(1, Math.min(RETAIL_MAX_LEVEL, Number(e.target.value) || 1)) })} /></div>
          <div className="fld"><label htmlFor="rc-s1">Spé principale</label>
            <select id="rc-s1" value={c.spec1} disabled={!c.cls} onChange={e => onChange({ spec1: e.target.value, ...(e.target.value === c.spec2 && { spec2: "" }) })}>
              <option value="">{c.cls ? "Choisir…" : "Choisis d'abord la classe"}</option>
              {specs.map(s => <option key={s} value={s}>{t.spec(c.cls, s)}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="rc-s2">Spé secondaire</label>
            <select id="rc-s2" value={c.spec2} disabled={!c.cls} onChange={e => onChange({ spec2: e.target.value })}>
              <option value="">Aucune</option>
              {specs.filter(s => s !== c.spec1).map(s => <option key={s} value={s}>{t.spec(c.cls, s)}</option>)}
            </select>
            <span className="hint">Proposée dans la compo quand il manque ce rôle.</span></div>
        </div>
        <div className="fld"><span className="lbl">Liens</span>
          {links ? (
            <div className="row rc-links">
              <a className="chip" href={links.armory} target="_blank" rel="noopener noreferrer">Armurerie</a>
              <a className="chip" href={links.raiderio} target="_blank" rel="noopener noreferrer">Raider.IO</a>
              <a className="chip" href={links.warcraftlogs} target="_blank" rel="noopener noreferrer">Warcraft Logs</a>
            </div>
          ) : <span className="hint">Avec le nom et le royaume.</span>}
        </div>
        <div className="fld"><label htmlFor="rc-notes">Notes</label>
          <textarea id="rc-notes" rows={3} maxLength={5000} value={c.notes} onChange={e => onChange({ notes: e.target.value })} placeholder="Ex. dispo mercredi et dimanche" /></div>
      </div>
      {footer && <div className="foot">{footer}</div>}
    </section>
  );
}

/** Fiche en lecture (persos des autres membres du groupe). */
export function RetailCharacterView({ c }: { c: Character }) {
  const t = useGameText();
  const links = c.name.trim() && c.realm.trim() ? retailLinks(c.name, c.realm, c.realmSlug) : null;
  const specs = [c.spec1, c.spec2].filter(Boolean);
  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={`Fiche de ${c.name}`}>
      <div className="dhead" style={{ ["--cc" as string]: t.color(c.cls) ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon"><span className="rc-av" aria-hidden="true">{(c.name || "?")[0]}</span><span>{c.name}</span>{c.realm && <span className="rc-realm">· {c.realm}</span>}</h2>
          <div className="line">Niv. <span className="num">{c.level}</span> · <span className="cls">{c.cls ? t.cls(c.cls) : "Classe ?"}</span>{c.ilvl ? <> · ilvl <span className="num">{c.ilvl}</span></> : null}{c.owner && ` · ${c.owner}`}</div>
        </div>
      </div>
      <div className="pane">
        <div className="fld"><span className="lbl">Spés</span>
          {specs.length ? (
            <div className="row">{specs.map((sp, i) => (
              <span key={sp} className="tag">{roleOf(sp) && <RoleIcon role={roleOf(sp)!} size={14} />} {t.spec(c.cls, sp)}{i ? " (secondaire)" : ""}</span>
            ))}</div>
          ) : <span className="hint">Aucune spé choisie.</span>}
          {c.activeSpec && <span className="hint">Spé active en jeu : {t.spec(c.cls, c.activeSpec)} ({bnetAge(c.bnetSyncedAt)})</span>}
        </div>
        {links && (
          <div className="fld"><span className="lbl">Liens</span>
            <div className="row rc-links">
              <a className="chip" href={links.armory} target="_blank" rel="noopener noreferrer">Armurerie</a>
              <a className="chip" href={links.raiderio} target="_blank" rel="noopener noreferrer">Raider.IO</a>
              <a className="chip" href={links.warcraftlogs} target="_blank" rel="noopener noreferrer">Warcraft Logs</a>
            </div>
          </div>
        )}
        {c.notes && <div className="fld"><span className="lbl">Notes</span><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.notes}</p></div>}
      </div>
    </section>
  );
}

/** Création à la main : nom, royaume, classe et spé principale (le reste dans la fiche). */
export function RetailCreateForm({ onCreated, onCancel }: { onCreated: (c: Character) => void; onCancel?: () => void }) {
  const t = useGameText();
  const [f, setF] = useState({ name: "", realm: "", cls: "", spec1: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await post<{ character: Character }>("/characters", { ...f, name: f.name.trim(), realm: f.realm.trim(), level: RETAIL_MAX_LEVEL });
      onCreated(r.character);
    } catch (err) { setError(err instanceof ApiError ? err.message : "Création impossible."); }
    finally { setBusy(false); }
  };
  return (
    <form className="panel pad stack rc-create" onSubmit={e => void submit(e)} aria-labelledby="rc-create-t">
      <h3 id="rc-create-t" style={{ margin: 0 }}>Nouveau perso</h3>
      <div className="rc-grid">
        <div className="fld"><label htmlFor="rcn-name">Nom</label><input id="rcn-name" type="text" required maxLength={40} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="rcn-realm">Royaume</label><input id="rcn-realm" type="text" required maxLength={40} list={REALMS_ID} value={f.realm} onChange={e => setF({ ...f, realm: e.target.value })} placeholder="Hyjal" /><RealmList /></div>
        <div className="fld"><label htmlFor="rcn-cls">Classe</label>
          <select id="rcn-cls" required value={f.cls} onChange={e => setF({ ...f, cls: e.target.value, spec1: "" })}>
            <option value="">Choisir…</option>
            {[...RETAIL_CLASS_NAMES].sort((a, b) => t.cls(a).localeCompare(t.cls(b), t.lang)).map(k => <option key={k} value={k}>{t.cls(k)}</option>)}
          </select></div>
        <div className="fld"><label htmlFor="rcn-spec">Spé principale</label>
          <select id="rcn-spec" value={f.spec1} disabled={!f.cls} onChange={e => setF({ ...f, spec1: e.target.value })}>
            <option value="">{f.cls ? "Choisir…" : "Choisis d'abord la classe"}</option>
            {(f.cls ? specsOf("retail", f.cls) : []).map(s => <option key={s} value={s}>{t.spec(f.cls, s)}</option>)}
          </select></div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>Créer le perso</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Annuler</button>}
        <span className="row" style={{ gap: 8, marginLeft: "auto" }}><BnetImportButton small /></span>
      </div>
    </form>
  );
}
