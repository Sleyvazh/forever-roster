import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";

/**
 * Données du groupe pour l'addon (format FRG v1) : raids à venir pour s'inscrire en jeu,
 * patrons recherchés et connus pour les infobulles, les sacs et l'alerte au butin.
 * Généré à la demande (à l'ouverture), avec mes inscriptions.
 */
export function GroupAddonExport({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const q = useQuery({
    queryKey: ["addon-export", groupId], enabled: open, staleTime: 0,
    queryFn: () => get<{ text: string; raids: number; patterns: number }>(`/groups/${groupId}/addon-export`),
  });
  const copy = () => {
    if (!q.data) return;
    void navigator.clipboard.writeText(q.data.text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => setCopied(false));
  };
  return (
    <details className="panel pad export" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><h3 style={{ display: "inline", margin: 0 }}>Données pour l'addon</h3> <span className="muted small">inscriptions en jeu, patrons recherchés</span></summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {q.isLoading && <p className="hint">Préparation…</p>}
        {q.error && <p className="hint">Impossible de préparer les données.</p>}
        {q.data && (
          <div className="fld">
            <div className="row between">
              <label htmlFor="ga-text">Texte pour <code>/fr groupe</code> · {q.data.raids} raid{q.data.raids > 1 ? "s" : ""}, {q.data.patterns} patron{q.data.patterns > 1 ? "s" : ""}</label>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm ghost" type="button" onClick={() => void q.refetch()}>Actualiser</button>
                <button className="btn sm" type="button" onClick={copy}>{copied ? "Copié" : "Copier"}</button>
              </span>
            </div>
            <textarea id="ga-text" readOnly className="num" rows={Math.min(10, q.data.text.split("\n").length)} value={q.data.text} onFocus={e => e.currentTarget.select()} />
            <p className="hint" style={{ margin: 0 }}>
              En jeu : <code>/fr groupe</code>, colle ce texte puis « Charger ». Tu peux alors t'inscrire aux raids (reporté sur le site au prochain
              « Importer depuis l'addon » de ta fiche), voir qui recherche les patrons de tes sacs dans leur infobulle, et être prévenu quand tu en ramasses un.
              À refaire quand de nouveaux raids ou patrons recherchés apparaissent.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
