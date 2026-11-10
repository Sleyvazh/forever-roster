import { type SignupStatus } from "@forever/game-data";
import { useState } from "react";
import { ApiError, put, type Character } from "../api";
import { SignupButtons } from "./SignupButtons";
import { t } from "../i18n";
import { signupLabel } from "../i18n/game";

/**
 * Réponse rapide à un raid, hors de sa page (refonte du 09/11 : Accueil, liste des raids). Présent, Peut-être, Absent et
 * « Autre » de même largeur ; la réponse s'affiche tout de suite (UI optimiste) et revient à l'ancienne si le site refuse.
 * Garde le perso et la spé de mon inscription ; sinon mon main dans la guilde, sinon un perso qui a sa classe.
 * Erreur avec la solution : le message du site, ou « Pas enregistré · connexion perdue. Réessayer ».
 * Classes CSS « ans-eq » (grille de même largeur), « ans-st » (état), « ans-err ».
 */

export interface MineSignup { status: string; characterId: string | null; spec?: string | null }
export interface AnswerError { msg: string; retry: boolean }

export function useQuickAnswer({ groupId, raidId, mine, mainId, chars, refresh }: {
  groupId: string; raidId: string; mine: MineSignup | null; mainId: string | null; chars: Character[]; refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<SignupStatus | null>(null);
  const [err, setErr] = useState<AnswerError | null>(null);
  const [last, setLast] = useState<SignupStatus | null>(null);
  const usable = chars.filter(c => c.cls);
  const charId = mine?.characterId ?? mainId ?? usable[0]?.id ?? null;
  const char = chars.find(c => c.id === charId);
  const spec = mine?.characterId && mine.spec ? mine.spec : char?.spec1 || undefined;
  const pick = async (status: SignupStatus) => {
    if (busy) return;
    setBusy(true); setErr(null); setShown(status); setLast(status);
    try {
      await put(`/groups/${groupId}/raids/${raidId}/signup`, { status, characterId: status === "absent" && !charId ? null : charId, ...(spec && { spec }) });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? { msg: e.message, retry: false } : { msg: t("Pas enregistré · connexion perdue."), retry: true });
    } finally { setBusy(false); setShown(null); }
  };
  const status = shown ?? (mine?.status as SignupStatus | undefined) ?? null;
  return { status, pick, err, retry: () => { if (last) void pick(last); }, canCome: !!charId };
}

/** « ● Présent », « ● Sans réponse » (orange) : la réponse, à droite d'un raid. */
export function AnswerState({ status, none }: { status: SignupStatus | null; none?: string }) {
  return <span className={`ans-st ${status ?? "none"}`}>● {status ? signupLabel(status) : none ?? t("Sans réponse")}</span>;
}

/** Les quatre boutons de même largeur, puis l'erreur et sa solution. */
export function QuickAnswerButtons({ qa, label, className = "" }: { qa: ReturnType<typeof useQuickAnswer>; label: string; className?: string }) {
  return (
    <span className={`ans-eq ${className}`}>
      <SignupButtons lg value={qa.status} onPick={s => void qa.pick(s)} canCome={qa.canCome} label={label} />
      {qa.err && (
        <span className="ans-err" role="alert">{qa.err.msg}{qa.err.retry && <> <button type="button" className="link" onClick={qa.retry}>{t("Réessayer")}</button></>}</span>
      )}
    </span>
  );
}
