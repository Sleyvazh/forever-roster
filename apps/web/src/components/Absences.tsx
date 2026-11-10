import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, del, get, post } from "../api";
import { DateField, dayLabel, todayIso } from "./DateTime";
import { t, tn } from "../i18n";
import { andList, dayLong, dayShort } from "../i18n/dates";

/**
 * Mes absences (lot F ; en haut de la page Raids depuis la refonte du 09/11, raccourci sur l'Accueil) : une période (du … au …) ou des jours de la semaine (« jamais le vendredi »).
 * Les raids sans réponse de ces jours passent en « Absent » dans tous mes groupes, y compris ceux créés ensuite.
 * Motif facultatif, visible des officiers ou de tout le groupe (au choix). Classes CSS « ab- ».
 */

export interface Absence { id: string; startDate: string | null; endDate: string | null; weekdays: number[]; reason: string; reasonVisibility?: "officers" | "group" }

/** « du lundi 10 novembre au dimanche 16 novembre », « le lundi 10 novembre », « chaque vendredi et samedi ». */
export function absenceLabel(a: Pick<Absence, "startDate" | "endDate" | "weekdays">) {
  if (a.weekdays.length) return t("chaque {days}", { days: andList(a.weekdays.map(d => dayLong(d))) });
  if (!a.startDate || !a.endDate) return "";
  return a.startDate === a.endDate ? t("le {day}", { day: dayLabel(a.startDate) }) : t("du {from} au {to}", { from: dayLabel(a.startDate), to: dayLabel(a.endDate) });
}

/** `startOpen` : le formulaire d'emblée (Accueil, « Déclarer une absence ») ; `onDone` à l'enregistrement ou à l'annulation. */
export function MyAbsences({ startOpen = false, onDone }: { startOpen?: boolean; onDone?: () => void } = {}) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["absences"], queryFn: () => get<{ absences: Absence[] }>("/absences") });
  const [form, setFormState] = useState(startOpen);
  const setForm = (v: boolean) => { setFormState(v); if (!v && startOpen) onDone?.(); };
  const [kind, setKind] = useState<"period" | "weekly">("period");
  const [start, setStart] = useState(todayIso()), [end, setEnd] = useState(todayIso());
  const [days, setDays] = useState<number[]>([]);
  const [reason, setReason] = useState(""), [vis, setVis] = useState<"officers" | "group">("officers");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["absences"] }), qc.invalidateQueries({ queryKey: ["week"] }), qc.invalidateQueries({ queryKey: ["raids"] }), qc.invalidateQueries({ queryKey: ["raid"] })]);
  const list = data?.absences ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try {
      const body = kind === "period" ? { startDate: start, endDate: end < start ? start : end } : { weekdays: days };
      const r = await post<{ raids: number }>("/absences", { ...body, reason, reasonVisibility: vis });
      setForm(false); setReason(""); setDays([]);
      setMsg({ ok: true, text: r.raids ? tn(r.raids, "Absence enregistrée : {n} raid sans réponse passé en « Absent ».", "Absence enregistrée : {n} raids sans réponse passés en « Absent ».") : t("Absence enregistrée. Les raids de ces jours où tu n'as pas répondu passeront en « Absent ».") });
      await refresh();
    } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Enregistrement impossible.") }); }
  };
  const remove = async (a: Absence) => {
    setMsg(null);
    try { await del(`/absences/${a.id}`); await refresh(); setMsg({ ok: true, text: t("Absence retirée : les « Absent » qu'elle avait posés sont enlevés.") }); }
    catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : t("Suppression impossible.") }); }
  };
  if (!data) return null;

  return (
    <section className="ab" aria-label={t("Mes absences")}>
      {!startOpen && <div className="ab-line">
        <b>{t("Absences")}</b>
        {list.length === 0 && !form && <span className="muted small">{t("aucune de prévue")}</span>}
        {list.map(a => (
          <span key={a.id} className="ab-chip">
            {absenceLabel(a)}
            {a.reason && <span className="muted" title={a.reasonVisibility === "group" ? t("Motif visible de toute la guilde") : t("Motif visible des officiers")}> · {a.reason}</span>}
            <button type="button" aria-label={t("Retirer l'absence {label}", { label: absenceLabel(a) })} title={t("Retirer")} onClick={() => void remove(a)}>✕</button>
          </span>
        ))}
        {!form && <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setForm(true)}>{t("+ Déclarer une absence")}</button>}
      </div>}
      {form && (
        <form className="ab-form" onSubmit={e => void submit(e)}>
          <div style={{ flexBasis: "100%" }}><div className="seg" role="group" aria-label={t("Type d'absence")}>
            <button type="button" className={kind === "period" ? "on" : ""} aria-pressed={kind === "period"} onClick={() => setKind("period")}>{t("Une période")}</button>
            <button type="button" className={kind === "weekly" ? "on" : ""} aria-pressed={kind === "weekly"} onClick={() => setKind("weekly")}>{t("Chaque semaine")}</button>
          </div></div>
          {kind === "period" ? <>
            <div className="fld"><label htmlFor="ab-from">{t("Du")}</label><DateField id="ab-from" value={start} min={todayIso()} onChange={d => { setStart(d); if (end < d) setEnd(d); }} /></div>
            <div className="fld"><label htmlFor="ab-to">{t("Au (inclus)")}</label><DateField id="ab-to" value={end} min={start} onChange={setEnd} /></div>
          </> : (
            <div className="fld" style={{ flex: "2 1 300px" }}><span className="lbl">{t("Jamais le…")}</span>
              <div className="ab-days" role="group" aria-label={t("Jours d'absence")}>
                {[1, 2, 3, 4, 5, 6, 7].map(dayShort).map((d, i) => (
                  <button key={d} type="button" className={`dt-chip${days.includes(i + 1) ? " on" : ""}`} aria-pressed={days.includes(i + 1)}
                    onClick={() => setDays(x => (x.includes(i + 1) ? x.filter(v => v !== i + 1) : [...x, i + 1]))}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="ab-why">{t("Motif (facultatif)")}</label>
            <input id="ab-why" type="text" maxLength={120} placeholder={t("Vacances, travail…")} value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="fld" style={{ flex: "1 1 170px" }}><label htmlFor="ab-vis">{t("Motif visible par")}</label>
            <select id="ab-vis" value={vis} onChange={e => setVis(e.target.value as "officers" | "group")}><option value="officers">{t("les officiers")}</option><option value="group">{t("toute la guilde")}</option></select></div>
          <div className="row"><button type="submit" className="btn primary sm" disabled={kind === "weekly" && !days.length}>{t("Enregistrer")}</button><button type="button" className="btn ghost sm" onClick={() => setForm(false)}>{t("Annuler")}</button></div>
          <p className="hint" style={{ margin: 0, flexBasis: "100%" }}>{t("Les raids de ces jours où tu n'as pas encore répondu passent en « Absent », dans toutes tes guildes, même celles créées plus tard. Une réponse déjà donnée ne change pas.")}</p>
        </form>
      )}
      {msg && <div className={msg.ok ? "small muted" : "alert error"} role="status">{msg.text}</div>}
    </section>
  );
}
