import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Menu « … » d'une ligne de tableau (onglet Membres). La liste s'ouvre par-dessus la page (portail, position fixe) :
 * le cadre défilant du tableau (.tscroll) ne la coupe plus. Sous le bouton s'il y a la place, sinon au-dessus ;
 * alignée sur le bord droit du bouton. Se ferme au choix d'une action, à Échap, au clic ailleurs, au défilement
 * et au redimensionnement de la fenêtre.
 */
export function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const close = (focusButton: boolean) => {
    setOpen(false);
    setPos(null);
    if (focusButton) btn.current?.focus();
  };

  // Placement mesuré avant l'affichage : la liste est d'abord rendue invisible, puis posée au bon endroit
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const b = btn.current.getBoundingClientRect();
    const h = pop.current.offsetHeight, gap = 4, margin = 8;
    const fitsBelow = b.bottom + gap + h <= window.innerHeight - margin;
    const fitsAbove = b.top - gap - h >= margin;
    const top = fitsBelow || !fitsAbove ? Math.min(b.bottom + gap, Math.max(margin, window.innerHeight - margin - h)) : b.top - gap - h;
    setPos({ top, right: Math.max(margin, window.innerWidth - b.right) });
  }, [open]);

  // Clavier : la première action prend le focus une fois la liste visible (un élément caché ne peut pas le prendre)
  useEffect(() => {
    if (open && pos) pop.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(true); return; }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(pop.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus({ preventScroll: true });
    };
    const onMove = () => close(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className="rm-dots" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => (open ? close(false) : setOpen(true))}>…</button>
      {open && createPortal(
        <div ref={pop} className="rm-pop" role="menu" aria-label={label}
          style={pos ? { top: pos.top, right: pos.right } : { top: 0, right: 0, visibility: "hidden" }}>
          {children(() => close(true))}
        </div>,
        document.body,
      )}
    </>
  );
}
