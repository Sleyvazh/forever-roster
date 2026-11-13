import { roleOf } from "@forever/game-data";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { type Character } from "../api";
import { LegacyTab, type EditorTab } from "./CharacterEditor";
import { TalentsBlock, useGoToTalents } from "./TalentsBlock";
import { ClassIcon, SpecIcon } from "./Icons";
import { Portrait } from "./ImageUpload";
import { Paperdoll } from "./Paperdoll";
import { Professions } from "./Professions";
import { RoleIcon } from "./RoleIcon";
import { useGameText } from "../gameText";
import { syncState } from "../syncPanel";
import { N, t, tx } from "../i18n";

/**
 * Fiche d'un perso en lecture (12/11, maquette-fiche-guilde.png) : celle de Mes persos, sans rien à saisir. Elle s'ouvre
 * sous la ligne du perso dans Guilde › Membres › Par perso (« Fiches du site », GroupRoster). L'identité est en texte
 * (nom ; Niv. 54 · Prêtre · Troll · Joueur : Kaelis ; guilde · ★ main ; spé, off-spec, « Talents 31 / 20 / 0 › ») : plus
 * de cases Nom, Niveau, Race et Classe grisées. Onglets Équipement (d'abord), Métiers, Notes, en lecture ; les talents
 * sont sous l'équipement (13/11), le bouton « Talents › » de l'en-tête y mène.
 * `actions` : les boutons de celui qui gère le perso (lui-même ou un officier), entre l'en-tête et les onglets.
 * `mine` : mon propre perso, avec le lien « Modifier dans Mes persos ».
 */
const TABS: [EditorTab, string][] = [["stuff", N("Équipement")], ["metiers", N("Métiers")], ["legacy", N("Notes")]];
const noop = () => {};

export function CharacterSheet({ c, groupName, mine, actions, onClose }: {
  c: Character; groupName: string; mine: boolean; actions?: ReactNode; onClose: () => void;
}) {
  const gt = useGameText();
  const [tab, setTab] = useState<EditorTab>("stuff");
  const goTalents = useGoToTalents(tab, setTab);
  const color = gt.color(c.cls) ?? "var(--gold)";
  const age = syncState(c.addonSyncedAt);
  const face = <Portrait id={c.portraitId} size={44} className="round" fallback={c.cls ? (c.spec1 ? <SpecIcon cls={c.cls} spec={c.spec1} size={34} /> : <ClassIcon cls={c.cls} size={34} />) : <span>?</span>} />;
  const specLine = (sp: string) => (
    <span className="fi-sp">{c.cls && <SpecIcon cls={c.cls} spec={sp} size={20} />}<b>{gt.spec(c.cls, sp)}</b>{roleOf(sp) && <RoleIcon role={roleOf(sp)} size={16} />}</span>
  );
  const split = c.talents ? c.talents.split("/").map(x => x.trim()).join(" / ") : null;
  const hasTalents = !!c.cls && (!!split || !!c.talentNodes?.length);
  return (
    <section className="panel lift fi fi-ro" style={{ "--cc": color } as CSSProperties} aria-label={t("Fiche de {name}", { name: c.name })}>
      <div className="fi-head">
        <span className="fi-face static">{face}</span>
        <div className="fi-id">
          <h2>{c.name}</h2>
          <div className="sub">
            {tx("Niv. {n}", { n: <b className="num">{c.level}</b> })} · <b className={`cn${c.cls === "Shaman" ? " sha" : ""}`}>{gt.cls(c.cls) || t("Classe ?")}</b>{c.race && ` · ${c.race}`}
            {mine ? ` · ${t("ton perso")}` : c.owner && ` · ${t("Joueur : {name}", { name: c.owner })}`}
          </div>
          <div className="sub fi-guild">{groupName} · {c.isMain ? <b className="fi-main">{t("★ main")}</b> : "alt"}</div>
          <div className="fi-specs">
            {c.spec1 ? specLine(c.spec1) : <span className="muted">{t("Spé ?")}</span>}
            {c.spec2 && <><span>{t("off-spec")}</span>{specLine(c.spec2)}</>}
            {hasTalents && <button type="button" className="fi-tal" aria-controls="fi-talents" onClick={goTalents}>
              {t("Talents")} {split && <b className="num">{split}</b>} <span aria-hidden="true">›</span></button>}
          </div>
        </div>
        <div className="fi-state">
          <span className={`sy-age ${age.tone}`}>● {age.tone === "ok" ? t("À jour") : age.ago ? t("{age} sans synchro", { age: age.label }) : t("Jamais synchronisé")}</span>
          {c.addonSyncedAt && age.tone === "ok" && <span className="fi-src">{tx("relevé par l'addon {ago}", { ago: age.ago })}</span>}
          {mine && <Link className="btn fi-edit" to={`/persos/${c.id}`}>{t("✎ Modifier dans Mes persos")}</Link>}
          <button type="button" className="btn sm fi-close" aria-label={t("Fermer la fiche de {name}", { name: c.name })} onClick={onClose}>{t("Fermer")} <span aria-hidden="true">✕</span></button>
        </div>
      </div>
      {actions}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(l)}</button>)}
      </div>
      <div className="pane">
        {tab === "stuff" && <>
          <Paperdoll c={c} onChange={noop} editable={false} fiche />
          {c.cls && <TalentsBlock c={c} onChange={noop} canEdit={false} />}
        </>}
        {tab === "metiers" && <Professions c={c} onChange={noop} readOnly />}
        {tab === "legacy" && <fieldset disabled style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}><LegacyTab c={c} onChange={noop} /></fieldset>}
      </div>
    </section>
  );
}
