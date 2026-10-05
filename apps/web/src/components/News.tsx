import { useEffect, useRef, useState } from "react";
import { NEWS } from "../news";

const SEEN = "fr-news-seen";
const latest = NEWS[0]?.n ?? 0;
const readSeen = () => { try { return Number(localStorage.getItem(SEEN) ?? 0) || 0; } catch { return latest; } };
const dateText = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** Bouton « Nouveautés » de la barre du haut : point doré tant que les dernières ne sont pas lues. */
export function News() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  // Ce qui était déjà lu à l'ouverture : les autres restent marquées « Nouveau » pendant la lecture
  const [seenAtOpen, setSeenAtOpen] = useState(seen);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".news-btn")?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setSeenAtOpen(seen);
      setSeen(latest);
      try { localStorage.setItem(SEEN, String(latest)); } catch { /* relu la prochaine fois */ }
    }
    setOpen(o => !o);
  };
  const unread = seen < latest;

  return (
    <div className="news-wrap" ref={ref}>
      <button type="button" className="news-btn" aria-label={unread ? "Nouveautés (non lues)" : "Nouveautés"} title="Nouveautés"
        aria-expanded={open} aria-controls="news-panel" onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H6a2 2 0 0 1-2-2z" /><path d="M17 8h3v9a2 2 0 0 1-2 2" /><path d="M7 9h7M7 12h7M7 15h4" /></svg>
        {unread && <span className="news-dot" aria-hidden="true" />}
      </button>
      {open && (
        <section className="news" id="news-panel" aria-label="Nouveautés">
          <div className="news-head"><h3>Nouveautés</h3><span className="muted small">site et addon</span></div>
          <ol>
            {NEWS.map(x => (
              <li key={x.n} className={x.n > seenAtOpen ? "new" : ""}>
                <span className="news-when">
                  <span className={`news-k ${x.kind}`}>{x.kind === "addon" ? `Addon${x.version ? ` ${x.version}` : ""}` : x.kind === "bot" ? "Bot Discord" : "Site"}</span>
                  {dateText(x.date)}{x.n > seenAtOpen && <span className="news-new">· Nouveau</span>}
                </span>
                <span className="news-t">{x.title}</span>
                <span className="news-d">{x.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
