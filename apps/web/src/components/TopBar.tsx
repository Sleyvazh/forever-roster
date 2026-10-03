import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { get, type Character } from "../api";
import { useLogout, useMe } from "../auth";
import { LaunchPill } from "./Countdown";
import { ClassIcon } from "./Icons";
import { Logo } from "./Logo";
import { Portrait } from "./ImageUpload";
import { ThemeToggle } from "./ThemeToggle";
import { useLiveEvents } from "../live";
import { CopyForGame } from "./CopyForGame";
import { PasteImport } from "./PasteImport";
import { News } from "./News";

const Brand = () => (
  <Link to="/" className="brand" aria-label="Forever Roster, accueil">
    <Logo size={32} />
    <strong>Forever Roster</strong>
  </Link>
);

/** Avatar du compte : l'image du compte, sinon le portrait du premier perso, sinon son icône de classe. */
function Avatar({ size = 30 }: { size?: number }) {
  const me = useMe();
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const first = chars.data?.characters[0];
  const icon = first?.cls ? <ClassIcon cls={first.cls} size={Math.round(size * 0.8)} /> : null;
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      <Portrait id={me.data?.user?.avatarId ?? first?.portraitId} size={size} fallback={icon} />
    </span>
  );
}

function AccountMenu() {
  const me = useMe();
  const logout = useLogout();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const user = me.data?.user;
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000, enabled: !!user });
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".acct-btn")?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!user) return null;
  const main = chars.data?.characters[0];
  return (
    <div className="acct" ref={ref}>
      <button type="button" className="acct-btn" aria-haspopup="true" aria-expanded={open} aria-controls="acct-menu" onClick={() => setOpen(o => !o)}>
        <Avatar /><span className="who">{user.displayName}</span><span className="chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="acct-menu" id="acct-menu" aria-label="Compte">
          <div className="head"><b>{user.displayName}</b>{main && <span>Perso principal : {main.name}</span>}</div>
          <Link className="item" to="/account">Compte &amp; sécurité</Link>
          <div className="mrow"><span>Thème</span><ThemeToggle /></div>
          <hr />
          <button type="button" className="item danger" onClick={() => void logout()}>Se déconnecter</button>
        </div>
      )}
    </div>
  );
}

const TAB_ICONS = {
  persos: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5" /></svg>,
  groupes: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3" /><circle cx="16.5" cy="9" r="3" /><path d="M2.5 20c.8-3.5 3-5 5.5-5s4.7 1.5 5.5 5M11 20c.8-3.5 3-5 5.5-5s4.7 1.5 5.5 5" /></svg>,
  addon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z" /><path d="M9 4v5h6V4M8 14h8M8 17h5" /></svg>,
};

/** Bandeau du haut : logo, onglets, compte à rebours, menu du compte. Sur téléphone, onglets en bas de l'écran. */
export function TopBar() {
  const me = useMe();
  const user = me.data?.user;
  useLiveEvents(!!user);
  return (
    <>
      <header className="topnav">
        <div className="bar-in">
          <Brand />
          {user ? (
            <nav className="nav" aria-label="Navigation principale">
              <NavLink to="/persos">Mes persos</NavLink>
              <NavLink to="/groups">Groupes</NavLink>
              <NavLink to="/addon">Addon</NavLink>
            </nav>
          ) : <span />}
          <div className="bar-right">
            {user && <CopyForGame />}
            <LaunchPill />
            {user && <News />}
            {user ? <AccountMenu /> : !me.isLoading && <ThemeToggle />}
          </div>
        </div>
      </header>
      {user && <PasteImport />}
      {user && (
        <nav className="tabbar" aria-label="Navigation principale (mobile)">
          <NavLink to="/persos">{TAB_ICONS.persos}Mes persos</NavLink>
          <NavLink to="/groups">{TAB_ICONS.groupes}Groupes</NavLink>
          <NavLink to="/addon">{TAB_ICONS.addon}Addon</NavLink>
        </nav>
      )}
    </>
  );
}
