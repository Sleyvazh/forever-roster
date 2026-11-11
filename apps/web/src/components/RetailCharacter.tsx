import { FRENCH_REALMS, RETAIL_CLASS_NAMES, RETAIL_MAX_LEVEL, retailLinks, roleOf, specsOf } from "@forever/game-data";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, post, type Character } from "../api";
import { useGameText } from "../gameText";
import { bnetAge, BnetImportButton, useBnetEnabled, useBnetRefresh } from "./BnetImport";
import { ExternalLink } from "./ExternalLink";
import { ClassIcon, classIconUrl, SpecIcon } from "./Icons";
import { RoleIcon } from "./RoleIcon";
import { t, tx } from "../i18n";

/**
 * Roster (WoW Retail) : fiche légère (choix de Flo, R2) — nom et royaume, classe, spé principale et secondaire,
 * niveau, liens vers l'Armurerie, Raider.IO et Warcraft Logs, notes. Pas d'équipement ni de talents à recopier :
 * Battle.net et les sites de référence les ont déjà (import Battle.net : R2b).
 */

/**
 * Médaillon de la fiche : icône de la spé (ou de la classe) — celle de Pahpool pour les classes communes aux deux jeux,
 * l'officielle pour les classes propres à Retail ; sans classe, l'initiale du nom (sans fichier, celle de la classe).
 */
function Avatar({ c }: { c: Character }) {
  const icon = !!c.cls && !!classIconUrl(c.cls);
  return (
    <span className={`rc-av${icon ? " icon" : ""}`} aria-hidden="true">
      {icon ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={44} /> : <ClassIcon cls={c.cls} size={44} />) : (c.name || "?")[0]}
    </span>
  );
}

const REALMS_ID = "rc-realms";
export const RealmList = () => <datalist id={REALMS_ID}>{FRENCH_REALMS.map(r => <option key={r} value={r} />)}</datalist>;

export function RetailCharacterSheet({ c, onChange, onRefreshed, subhead, footer }: {
  c: Character; onChange: (p: Partial<Character>) => void; subhead?: ReactNode; footer?: ReactNode;
  /** Fiche relue chez Blizzard (« Mettre à jour ») : la version du serveur remplace la copie locale. */
  onRefreshed?: (c: Character) => void;
}) {
  const gt = useGameText();
  const bnetOn = useBnetEnabled();
  const refresh = useBnetRefresh(ch => onRefreshed?.(ch));
  const specs = c.cls ? specsOf("retail", c.cls) : [];
  const roles = [...new Set([roleOf(c.spec1), roleOf(c.spec2)].filter(Boolean))];
  const links = c.name.trim() && c.realm.trim() ? retailLinks(c.name, c.realm, c.realmSlug) : null;
  const setClass = (cls: string) => onChange({ cls, spec1: "", spec2: "" });
  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={t("Fiche de {name}", { name: c.name })}>
      <div className="dhead" style={{ ["--cc" as string]: gt.color(c.cls) ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon"><Avatar c={c} /><span>{c.name}</span>{c.realm && <span className="rc-realm">· {c.realm}</span>}</h2>
          <div className="line">{tx("Niv. {n}", { n: <span className="num">{c.level}</span> })} · <span className="cls">{c.cls ? gt.cls(c.cls) : t("Classe ?")}</span>{c.spec1 && ` · ${gt.spec(c.cls, c.spec1)}`}{c.ilvl ? <> · ilvl <span className="num">{c.ilvl}</span></> : null}</div>
        </div>
        <div className="row">{roles.map(r => <RoleIcon key={r} role={r} />)}</div>
      </div>
      {subhead}
      {bnetOn && (
        <div className="rc-bnet">
          <span className="rc-bnet-k">{t("Battle.net")}</span>
          {c.bnetSyncedAt ? (
            <span>{tx("Niveau d'objet {n}", { n: <b className="num">{c.ilvl ?? "?"}</b> })}{c.activeSpec && <> {t("· spé active")} <b>{gt.spec(c.cls, c.activeSpec)}</b></>} <span className="muted small">· {bnetAge(c.bnetSyncedAt)}</span></span>
          ) : <span className="muted small">{t("Pas encore lu chez Blizzard (profil public du perso, avec son nom et son royaume).")}</span>}
          <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
            {c.activeSpec && c.activeSpec !== c.spec1 && (
              <button type="button" className="btn ghost sm" onClick={() => onChange({ spec1: c.activeSpec, ...(c.spec2 === c.activeSpec && { spec2: "" }) })}>
                {tx("Prendre {v} comme spé principale", { v: gt.spec(c.cls, c.activeSpec) })}</button>
            )}
            <button type="button" className="btn sm" disabled={refresh.busy || !c.name.trim() || !c.realm.trim()} onClick={() => void refresh.run(c.id)}>
              {refresh.busy ? t("Lecture…") : t("Mettre à jour")}
            </button>
          </span>
          {refresh.msg && <span className={`small ${refresh.msg.ok ? "muted" : "warnmsg"}`} role="status" style={{ flexBasis: "100%" }}>{refresh.msg.text}</span>}
        </div>
      )}
      <div className="pane">
        <div className="rc-grid">
          <div className="fld"><label htmlFor="rc-name">{t("Nom")}</label>
            <input id="rc-name" type="text" maxLength={40} value={c.name} onChange={e => onChange({ name: e.target.value })} /></div>
          <div className="fld"><label htmlFor="rc-realm">{t("Royaume")}</label>
            <input id="rc-realm" type="text" maxLength={40} list={REALMS_ID} value={c.realm} onChange={e => onChange({ realm: e.target.value })} placeholder={t("Hyjal")} /><RealmList /></div>
          <div className="fld"><label htmlFor="rc-cls">{t("Classe")}</label>
            <select id="rc-cls" value={c.cls} onChange={e => setClass(e.target.value)}>
              <option value="">{t("Choisir…")}</option>
              {[...RETAIL_CLASS_NAMES].sort((a, b) => gt.cls(a).localeCompare(gt.cls(b), gt.lang)).map(k => <option key={k} value={k}>{gt.cls(k)}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="rc-lvl">{t("Niveau")}</label>
            <input id="rc-lvl" type="number" min={1} max={RETAIL_MAX_LEVEL} value={c.level} onChange={e => onChange({ level: Math.max(1, Math.min(RETAIL_MAX_LEVEL, Number(e.target.value) || 1)) })} /></div>
          <div className="fld"><label htmlFor="rc-s1">{t("Spé principale")}</label>
            <select id="rc-s1" value={c.spec1} disabled={!c.cls} onChange={e => onChange({ spec1: e.target.value, ...(e.target.value === c.spec2 && { spec2: "" }) })}>
              <option value="">{c.cls ? t("Choisir…") : t("Choisis d'abord la classe")}</option>
              {specs.map(s => <option key={s} value={s}>{gt.spec(c.cls, s)}</option>)}
            </select></div>
          <div className="fld"><label htmlFor="rc-s2">{t("Spé secondaire")}</label>
            <select id="rc-s2" value={c.spec2} disabled={!c.cls} onChange={e => onChange({ spec2: e.target.value })}>
              <option value="">{t("Aucune")}</option>
              {specs.filter(s => s !== c.spec1).map(s => <option key={s} value={s}>{gt.spec(c.cls, s)}</option>)}
            </select>
            <span className="hint">{t("Proposée dans la compo quand il manque ce rôle.")}</span></div>
        </div>
        <div className="fld"><span className="lbl">{t("Liens")}</span>
          {links ? (
            <div className="row rc-links">
              <ExternalLink className="chip" href={links.armory}>{t("Armurerie")}</ExternalLink>
              <ExternalLink className="chip" href={links.raiderio}>{t("Raider.IO")}</ExternalLink>
              <ExternalLink className="chip" href={links.warcraftlogs}>{t("Warcraft Logs")}</ExternalLink>
            </div>
          ) : <span className="hint">{t("Avec le nom et le royaume.")}</span>}
        </div>
        <div className="fld"><label htmlFor="rc-notes">{t("Notes")}</label>
          <textarea id="rc-notes" rows={3} maxLength={5000} value={c.notes} onChange={e => onChange({ notes: e.target.value })} placeholder={t("Ex. dispo mercredi et dimanche")} /></div>
      </div>
      {footer && <div className="foot">{footer}</div>}
    </section>
  );
}

/** Fiche en lecture (persos des autres membres du groupe). */
export function RetailCharacterView({ c }: { c: Character }) {
  const gt = useGameText();
  const links = c.name.trim() && c.realm.trim() ? retailLinks(c.name, c.realm, c.realmSlug) : null;
  const specs = [c.spec1, c.spec2].filter(Boolean);
  return (
    <section className="panel lift" style={{ minWidth: 0 }} aria-label={t("Fiche de {name}", { name: c.name })}>
      <div className="dhead" style={{ ["--cc" as string]: gt.color(c.cls) ?? "var(--line-2)" }}>
        <div>
          <h2 className="with-icon"><Avatar c={c} /><span>{c.name}</span>{c.realm && <span className="rc-realm">· {c.realm}</span>}</h2>
          <div className="line">{tx("Niv. {n}", { n: <span className="num">{c.level}</span> })} · <span className="cls">{c.cls ? gt.cls(c.cls) : t("Classe ?")}</span>{c.ilvl ? <> · ilvl <span className="num">{c.ilvl}</span></> : null}{c.owner && ` · ${c.owner}`}</div>
        </div>
      </div>
      <div className="pane">
        <div className="fld"><span className="lbl">{t("Spés")}</span>
          {specs.length ? (
            <div className="row">{specs.map((sp, i) => (
              <span key={sp} className="tag">{roleOf(sp) && <RoleIcon role={roleOf(sp)!} size={14} />} {gt.spec(c.cls, sp)}{i ? " (secondaire)" : ""}</span>
            ))}</div>
          ) : <span className="hint">{t("Aucune spé choisie.")}</span>}
          {c.activeSpec && <span className="hint">{tx("Spé active en jeu : {v} ({bnetAge})", { v: gt.spec(c.cls, c.activeSpec), bnetAge: bnetAge(c.bnetSyncedAt) })}</span>}
        </div>
        {links && (
          <div className="fld"><span className="lbl">{t("Liens")}</span>
            <div className="row rc-links">
              <ExternalLink className="chip" href={links.armory}>{t("Armurerie")}</ExternalLink>
              <ExternalLink className="chip" href={links.raiderio}>{t("Raider.IO")}</ExternalLink>
              <ExternalLink className="chip" href={links.warcraftlogs}>{t("Warcraft Logs")}</ExternalLink>
            </div>
          </div>
        )}
        {c.notes && <div className="fld"><span className="lbl">{t("Notes")}</span><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.notes}</p></div>}
      </div>
    </section>
  );
}

/** Création à la main : nom, royaume, classe et spé principale (le reste dans la fiche). */
export function RetailCreateForm({ onCreated, onCancel }: { onCreated: (c: Character) => void; onCancel?: () => void }) {
  const gt = useGameText();
  const [f, setF] = useState({ name: "", realm: "", cls: "", spec1: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await post<{ character: Character }>("/characters", { ...f, name: f.name.trim(), realm: f.realm.trim(), level: RETAIL_MAX_LEVEL });
      onCreated(r.character);
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Création impossible.")); }
    finally { setBusy(false); }
  };
  return (
    <form className="panel pad stack rc-create" onSubmit={e => void submit(e)} aria-labelledby="rc-create-t">
      <h3 id="rc-create-t" style={{ margin: 0 }}>{t("Nouveau perso")}</h3>
      <div className="rc-grid">
        <div className="fld"><label htmlFor="rcn-name">{t("Nom")}</label><input id="rcn-name" type="text" required maxLength={40} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div className="fld"><label htmlFor="rcn-realm">{t("Royaume")}</label><input id="rcn-realm" type="text" required maxLength={40} list={REALMS_ID} value={f.realm} onChange={e => setF({ ...f, realm: e.target.value })} placeholder={t("Hyjal")} /><RealmList /></div>
        <div className="fld"><label htmlFor="rcn-cls">{t("Classe")}</label>
          <select id="rcn-cls" required value={f.cls} onChange={e => setF({ ...f, cls: e.target.value, spec1: "" })}>
            <option value="">{t("Choisir…")}</option>
            {[...RETAIL_CLASS_NAMES].sort((a, b) => gt.cls(a).localeCompare(gt.cls(b), gt.lang)).map(k => <option key={k} value={k}>{gt.cls(k)}</option>)}
          </select></div>
        <div className="fld"><label htmlFor="rcn-spec">{t("Spé principale")}</label>
          <select id="rcn-spec" value={f.spec1} disabled={!f.cls} onChange={e => setF({ ...f, spec1: e.target.value })}>
            <option value="">{f.cls ? t("Choisir…") : t("Choisis d'abord la classe")}</option>
            {(f.cls ? specsOf("retail", f.cls) : []).map(s => <option key={s} value={s}>{gt.spec(f.cls, s)}</option>)}
          </select></div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{t("Créer le perso")}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>{t("Annuler")}</button>}
        <span className="row" style={{ gap: 8, marginLeft: "auto" }}><BnetImportButton small /></span>
      </div>
    </form>
  );
}
