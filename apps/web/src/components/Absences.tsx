import { WEEKDAYS } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, del, get, post } from "../api";
import { DateField, dayLabel, todayIso } from "./DateTime";

/**
 * Mes absences (lot F), sur Mes persos : une période (du … au …) ou des jours de la semaine (« jamais le vendredi »).
 * Les raids sans réponse de ces jours passent en « Absent » dans tous mes groupes, y compris ceux créés ensuite.
 * Motif facultatif, visible des officiers ou de tout le groupe (au choix). Classes CSS « ab- ».
 */

export interface Absence { id: string; startDate: string | null; endDate: string | null; weekdays: number[]; reason: string; reasonVisibility?: "officers" | "group" }

const DAY_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
/** « du lundi 10 novembre au dimanche 16 novembre », « le lundi 10 novembre », « chaque vendredi et samedi ». */
export function absenceLabel(a: Pick<Absence, "startDate" | "endDate" | "weekdays">) {
  if (a.weekdays.length) {
    const days = a.weekdays.map(d => WEEKDAYS[d - 1]!.toLowerCase());
    return `chaque ${days.length > 1 ? `${days.slice(0, -1).join(", ")} et ${days.at(-1)}` : days[0]}`;
  }
  if (!a.startDate || !a.endDate) return "";
  return a.startDate === a.endDate ? `le ${dayLabel(a.startDate)}` : `du ${dayLabel(a.startDate)} au ${dayLabel(a.endDate)}`;
}

export function MyAbsences() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["absences"], queryFn: () => get<{ absences: Absence[] }>("/absences") });
  const [form, setForm] = useState(false);
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
      setMsg({ ok: true, text: r.raids ? `Absence enregistrée : ${r.raids} raid${r.raids > 1 ? "s" : ""} sans réponse passé${r.raids > 1 ? "s" : ""} en « Absent ».` : "Absence enregistrée. Les raids de ces jours où tu n'as pas répondu passeront en « Absent »." });
      await refresh();
    } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Enregistrement impossible." }); }
  };
  const remove = async (a: Absence) => {
    setMsg(null);
    try { await del(`/absences/${a.id}`); await refresh(); setMsg({ ok: true, text: "Absence retirée : les « Absent » qu'elle avait posés sont enlevés." }); }
    catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Suppression impossible." }); }
  };
  if (!data) return null;

  return (
    <section className="ab" aria-label="Mes absences">
      <div className="ab-line">
        <b>Absences</b>
        {list.length === 0 && !form && <span className="muted small">aucune de prévue</span>}
        {list.map(a => (
          <span key={a.id} className="ab-chip">
            {absenceLabel(a)}
            {a.reason && <span className="muted" title={a.reasonVisibility === "group" ? "Motif visible de tout le groupe" : "Motif visible des officiers"}> · {a.reason}</span>}
            <button type="button" aria-label={`Retirer l'absence ${absenceLabel(a)}`} title="Retirer" onClick={() => void remove(a)}>✕</button>
          </span>
        ))}
        {!form && <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setForm(true)}>+ Déclarer une absence</button>}
      </div>
      {form && (
        <form className="ab-form" onSubmit={e => void submit(e)}>
          <div style={{ flexBasis: "100%" }}><div className="seg" role="group" aria-label="Type d'absence">
            <button type="button" className={kind === "period" ? "on" : ""} aria-pressed={kind === "period"} onClick={() => setKind("period")}>Une période</button>
            <button type="button" className={kind === "weekly" ? "on" : ""} aria-pressed={kind === "weekly"} onClick={() => setKind("weekly")}>Chaque semaine</button>
          </div></div>
          {kind === "period" ? <>
            <div className="fld"><label htmlFor="ab-from">Du</label><DateField id="ab-from" value={start} min={todayIso()} onChange={d => { setStart(d); if (end < d) setEnd(d); }} /></div>
            <div className="fld"><label htmlFor="ab-to">Au (inclus)</label><DateField id="ab-to" value={end} min={start} onChange={setEnd} /></div>
          </> : (
            <div className="fld" style={{ flex: "2 1 300px" }}><span className="lbl">Jamais le…</span>
              <div className="ab-days" role="group" aria-label="Jours d'absence">
                {DAY_SHORT.map((d, i) => (
                  <button key={d} type="button" className={`dt-chip${days.includes(i + 1) ? " on" : ""}`} aria-pressed={days.includes(i + 1)}
                    onClick={() => setDays(x => (x.includes(i + 1) ? x.filter(v => v !== i + 1) : [...x, i + 1]))}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div className="fld" style={{ flex: "2 1 220px" }}><label htmlFor="ab-why">Motif (facultatif)</label>
            <input id="ab-why" type="text" maxLength={120} placeholder="Vacances, travail…" value={reason} onChange={e => setReason(e.target.value)} /></div>
          <div className="fld" style={{ flex: "1 1 170px" }}><label htmlFor="ab-vis">Motif visible par</label>
            <select id="ab-vis" value={vis} onChange={e => setVis(e.target.value as "officers" | "group")}><option value="officers">les officiers</option><option value="group">tout le groupe</option></select></div>
          <div className="row"><button type="submit" className="btn primary sm" disabled={kind === "weekly" && !days.length}>Enregistrer</button><button type="button" className="btn ghost sm" onClick={() => setForm(false)}>Annuler</button></div>
          <p className="hint" style={{ margin: 0, flexBasis: "100%" }}>Les raids de ces jours où tu n'as pas encore répondu passent en « Absent », dans tous tes groupes, même ceux créés plus tard. Une réponse déjà donnée ne change pas.</p>
        </form>
      )}
      {msg && <div className={msg.ok ? "small muted" : "alert error"} role="status">{msg.text}</div>}
    </section>
  );
}
