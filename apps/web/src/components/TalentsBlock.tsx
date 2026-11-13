import { useEffect, useRef, useState } from "react";
import type { Character } from "../api";
import { TalentsSection, type EditorTab, type LevelHint } from "./CharacterEditor";
import { openSync, syncState } from "../syncPanel";
import { t, tx } from "../i18n";

/**
 * Le bouton « Talents 31 / 20 / 0 › » de l'en-tête : ouvre l'onglet Équipement s'il ne l'est pas, puis fait descendre la page
 * jusqu'aux talents.
 */
export function useGoToTalents(tab: EditorTab, onTab: (tt: EditorTab) => void) {
  const wanted = useRef(false);
  const go = () => document.getElementById("fi-talents")?.scrollIntoView({ block: "start", behavior: "smooth" });
  useEffect(() => {
    if (!wanted.current || tab !== "stuff") return;
    wanted.current = false;
    go();
  }, [tab]);
  return () => {
    if (tab === "stuff") { go(); return; }
    wanted.current = true;
    onTab("stuff");
  };
}

/**
 * Talents sous l'équipement (13/11, choix de Flo : « Sous l'équipement, partout ») : dans l'onglet Équipement de Mes persos
 * et de la fiche ouverte depuis Guilde › Membres, toujours visibles. Avant, ils s'ouvraient par le bouton « Talents › » de
 * l'en-tête, au-dessus des onglets ; ce bouton mène maintenant ici (id « fi-talents »).
 * `canEdit` : Mes persos, avec « Modifier à la main » (ou « Remplir à la main › » sans relevé) ; sinon en lecture, sans
 * rien à saisir, et sans les cartes vides d'un perso dont rien n'est connu.
 */
export function TalentsBlock({ c, onChange, canEdit, levelHint }: {
  c: Character; onChange: (p: Partial<Character>) => void; canEdit: boolean; levelHint?: LevelHint;
}) {
  const [manual, setManual] = useState(false);
  const age = syncState(c.addonSyncedAt);
  const read = !!c.talentNodes?.length;
  const known = read || !!c.talents || !!c.talents2;
  const editing = canEdit && manual;
  return (
    <section className="sec fi-talents" id="fi-talents" aria-labelledby="fi-talents-h">
      <div className="fi-tal-head">
        <h3 id="fi-talents-h">{t("Talents")}</h3>
        {read
          ? <span className={`sy-age ${age.tone}`}>{tx("● relevés par l'addon · {ago}", { ago: age.ago })}</span>
          : canEdit ? <span>{t("Pas encore relevés ·")} <button type="button" className="link" onClick={openSync}>{t("fais ta synchro")}</button></span>
          : !known ? <span>{t("Pas encore relevés par l'addon")}</span> : null}
        {canEdit && <button type="button" className="btn sm" aria-pressed={manual} onClick={() => setManual(m => !m)}>
          {manual ? t("Terminer la saisie") : read ? t("Modifier à la main") : t("Remplir à la main ›")}</button>}
      </div>
      {(canEdit || known) && <TalentsSection c={c} onChange={onChange} editable={editing} readOnly={!editing} folded levelHint={levelHint} />}
    </section>
  );
}
