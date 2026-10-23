import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, post } from "../api";
import { useMyGuilds } from "../nav";

/**
 * En-tête d'une page de guilde (refonte du 23/10) : le nom de la guilde en sur-titre, puis le titre de la page.
 * Avec plusieurs guildes, le sur-titre devient un sélecteur (« Les Lanternes ▾ ») qui garde la même page.
 */
export function GuildHead({ groupId, name, title, meta, actions }: { groupId: string; name: string; title: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  const guilds = useMyGuilds().data?.groups ?? [];
  return (
    <div className="page-head">
      <div className="ph-t">
        {guilds.length > 1 ? <GuildPicker groupId={groupId} name={name} /> : <span className="eyebrow">{name}</span>}
        <h1>{title}</h1>
        {meta && <div className="g-meta">{meta}</div>}
      </div>
      {actions && <div className="row ph-acts">{actions}</div>}
    </div>
  );
}

function GuildPicker({ groupId, name }: { groupId: string; name: string }) {
  const guilds = useMyGuilds().data?.groups ?? [];
  const loc = useLocation();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  // Même page dans l'autre guilde (la page d'un raid mène à ses Raids)
  const section = loc.pathname.replace(`/groups/${groupId}`, "").split("/").filter(Boolean)[0] ?? "";
  const go = (id: string) => { setOpen(false); nav(`/groups/${id}${section ? `/${section}` : ""}`); };
  return (
    <div className="g-pick-wrap" ref={ref}>
      <button type="button" className="g-pick" aria-haspopup="menu" aria-expanded={open} aria-label={`Changer de guilde : ${name}`} onClick={() => setOpen(o => !o)}>
        {name}<span className="chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="g-menu" role="menu">
          {guilds.map(g => (
            <button key={g.id} type="button" role="menuitemradio" aria-checked={g.id === groupId} className="item" onClick={() => go(g.id)}>{g.name}</button>
          ))}
          <hr />
          <Link className="item" role="menuitem" to="/bienvenue" onClick={() => setOpen(false)}>Rejoindre ou créer une guilde</Link>
        </div>
      )}
    </div>
  );
}

/**
 * « Inviter » (officiers) : le lien est créé avec les réglages par défaut (5 utilisations, 3 jours) à l'ouverture,
 * il n'y a plus qu'à le copier. « Changer » mène à l'Administration.
 */
export function InviteButton({ groupId, groupName, primary }: { groupId: string; groupName: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !link) {
      setErr(null);
      post<{ invite: { url: string } }>(`/groups/${groupId}/invites`, { maxUses: 5, expiresInHours: 72 })
        .then(r => setLink(r.invite.url))
        .catch(e => setErr(e instanceof ApiError ? e.message : "Lien impossible à créer."));
    }
  };
  const copy = () => { if (link) void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false)); };
  return (
    <div className="inv-wrap" ref={ref}>
      <button type="button" className={`btn${primary ? " primary" : ""}`} aria-expanded={open} aria-controls="inv-pop" onClick={toggle}>Inviter</button>
      {open && (
        <div className="inv-pop" id="inv-pop" role="dialog" aria-label={`Inviter dans ${groupName}`}>
          <h3>Inviter dans {groupName}</h3>
          {err ? <div className="alert error" role="alert">{err}</div> : (
            <div className="row nowrap">
              <input type="text" readOnly value={link ?? "Création du lien…"} aria-label="Lien d'invitation" onFocus={e => e.currentTarget.select()} />
              <button type="button" className="btn primary sm" disabled={!link} onClick={copy}>{copied ? "Copié" : "Copier"}</button>
            </div>
          )}
          <p className="hint">5 utilisations · valable 3 jours · <Link className="link" to={`/groups/${groupId}/admin?section=invitations`}>Changer</Link></p>
        </div>
      )}
    </div>
  );
}
