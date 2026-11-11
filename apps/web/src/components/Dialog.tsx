import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n";

/** Fenêtre modale native (focus piégé, Échap) ; la retirer de la page suffit à la fermer. */
export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return <dialog ref={ref} className="sg-dialog gd" aria-labelledby={label} onClose={onClose}>{children}</dialog>;
}
export function DialogHead({ id, title, sub, onClose }: { id: string; title: ReactNode; sub?: ReactNode; onClose: () => void }) {
  return (
    <div className="row between sg-head">
      <div style={{ minWidth: 0 }}><h2 id={id}>{title}</h2>{sub && <p className="gd-sub">{sub}</p>}</div>
      <button type="button" className="pi-close" aria-label={t("Fermer")} onClick={onClose}>✕</button>
    </div>
  );
}
