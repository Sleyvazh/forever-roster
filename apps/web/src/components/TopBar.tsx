import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { navKeyOf, navLinks, useCurrentGuild, type NavKey } from "../nav";
import { readInvite } from "../invite";
import { get, type Character } from "../api";
import { useLogout, useMe } from "../auth";
import { ClassIcon } from "./Icons";
import { Logo, RosterLogo } from "./Logo";
import { Portrait } from "./ImageUpload";
import { ThemeToggle } from "./ThemeToggle";
import { useLiveEvents } from "../live";
import { SyncButton, SyncPanel } from "./SyncPanel";
import { News } from "./News";
import { useApplySite, useSite } from "../site";
import { ReportDialog, useUnseenReports } from "./Report";
import { LangSwitch } from "./LangSwitch";
import { N, t, tn } from "../i18n";

const Brand = () => {
  const site = useSite();
  return (
    <Link to="/" className="brand" aria-label={t("{site}, accueil", { site: site.name })}>
      {site.game === "retail" ? <RosterLogo size={32} /> : <Logo size={32} />}
      <strong>{site.name}</strong>
    </Link>
  );
};

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
  const site = useSite();
  const logout = useLogout();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const user = me.data?.user;
  const unseen = useUnseenReports(!!user);
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
  const forever = site.game === "forever";
  return (
    <div className="acct" ref={ref}>
      <button type="button" className="acct-btn" aria-haspopup="true" aria-expanded={open} aria-controls="acct-menu" onClick={() => setOpen(o => !o)}
        aria-label={unseen ? tn(unseen, "{name} : {n} réponse à lire", "{name} : {n} réponses à lire", { name: user.displayName }) : undefined}>
        <Avatar /><span className="who">{user.displayName}</span><span className="chev" aria-hidden="true" />
        {unseen > 0 && <span className="acct-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="acct-menu" id="acct-menu" aria-label={t("Compte")}>
          <div className="head"><b>{user.displayName}</b>{main && <span>{t("Perso principal : {name}", { name: main.name })}</span>}</div>
          <Link className="item" to="/account">{t("Compte & sécurité")}</Link>
          {forever && <Link className="item" to="/addon">{t("Addon")}</Link>}
          {forever && <Link className="item" to="/bienvenue">{t("Rejoindre ou créer une guilde")}</Link>}
          <div className="mrow"><span>{t("Thème")}</span><ThemeToggle /></div>
          <div className="mrow"><span>{t("Langue")}</span><LangSwitch /></div>
          <hr />
          <button type="button" className="item" onClick={() => { setOpen(false); setReporting(true); }}>{t("Signaler un bug ou une idée")}</button>
          <Link className="item" to="/signalements">{t("Mes signalements")}{unseen > 0 && <span className="acct-count">{tn(unseen, "{n} réponse", "{n} réponses")}</span>}</Link>
          {user.siteAdmin && <Link className="item" to="/admin/signalements">{t("Signalements (admin)")}</Link>}
          <hr />
          <button type="button" className="item danger" onClick={() => void logout()}>{t("Se déconnecter")}</button>
        </div>
      )}
      {reporting && <ReportDialog onClose={() => setReporting(false)} />}
    </div>
  );
}

const TAB_ICONS = {
  persos: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5" /></svg>,
  groupes: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3" /><circle cx="16.5" cy="9" r="3" /><path d="M2.5 20c.8-3.5 3-5 5.5-5s4.7 1.5 5.5 5M11 20c.8-3.5 3-5 5.5-5s4.7 1.5 5.5 5" /></svg>,
  addon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z" /><path d="M9 4v5h6V4M8 14h8M8 17h5" /></svg>,
  accueil: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v10h4.5v-5.5h3V20H18V10" /></svg>,
  sorties: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4" /><path d="M6 4h11l-2.5 4L17 12H6" /></svg>,
  raids: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></svg>,
};

/** Forever Roster (refonte du 23/10) : les mêmes cinq entrées au bureau et sur téléphone. */
const FOREVER_NAV: [Exclude<NavKey, null>, string, string, keyof typeof TAB_ICONS][] = [
  ["home", N("Accueil"), N("Accueil"), "accueil"], ["outings", N("Sorties"), N("Sorties"), "sorties"], ["raids", N("Raids"), N("Raids"), "raids"],
  ["guild", N("Guilde"), N("Guilde"), "groupes"], ["chars", N("Mes persos"), N("Persos"), "persos"],
];
function ForeverLinks({ bar }: { bar: boolean }) {
  const loc = useLocation();
  const g = useCurrentGuild();
  const links = navLinks(g.id);
  const on = navKeyOf(loc.pathname);
  return <>{FOREVER_NAV.map(([k, label, short, icon]) => (
    <Link key={k} to={links[k]} className={on === k ? "active" : undefined} aria-current={on === k ? "page" : undefined}>{bar && TAB_ICONS[icon]}{t(bar ? short : label)}</Link>
  ))}</>;
}
/**
 * Première visite (lien d'invitation, Bienvenue avec une invitation en attente) : la barre ne garde que le logo et le compte.
 * Sans invitation, la page Bienvenue garde la navigation (Mes persos reste à portée).
 */
const bareFor = (path: string) => path === "/join" || (path === "/bienvenue" && !!readInvite());

/** Bandeau du haut : logo, onglets, compte à rebours, menu du compte. Sur téléphone, onglets en bas de l'écran. */
export function TopBar() {
  const me = useMe();
  const site = useSite();
  useApplySite(site);
  // Site pas encore ouvert (Roster avant les données Retail) : comptes seulement, pas d'onglets
  const user = me.data?.user;
  const app = !!user && site.open;
  const loc = useLocation();
  const forever = site.game === "forever";
  const bare = forever && bareFor(loc.pathname);
  useLiveEvents(app);
  return (
    <>
      <header className="topnav">
        <div className="bar-in">
          <Brand />
          {app && !bare ? (
            <nav className="nav" aria-label={t("Navigation principale")}>
              {forever ? <ForeverLinks bar={false} /> : <>
                <NavLink to="/persos">{t("Mes persos")}</NavLink>
                <NavLink to="/groups">{t("Guildes")}</NavLink>
                <NavLink to="/addon">{t("Addon")}</NavLink>
              </>}
            </nav>
          ) : <span />}
          <div className="bar-right">
            {site.preview && <span className="tag warn" title={t("Roster n'est pas encore ouvert : ton compte y a accès en avance, pour tester.")}>{t("Accès anticipé")}</span>}
            {app && !bare && <SyncButton />}
            {app && forever && !bare && <News />}
            {user ? <AccountMenu /> : !me.isLoading && <ThemeToggle />}
          </div>
        </div>
      </header>
      {app && <SyncPanel />}
      {app && !bare && (
        <nav className={`tabbar${forever ? " five" : ""}`} aria-label={t("Navigation principale (mobile)")}>
          {forever ? <ForeverLinks bar /> : <>
            <NavLink to="/persos">{TAB_ICONS.persos}{t("Mes persos")}</NavLink>
            <NavLink to="/groups">{TAB_ICONS.groupes}{t("Guildes")}</NavLink>
            <NavLink to="/addon">{TAB_ICONS.addon}{t("Addon")}</NavLink>
          </>}
        </nav>
      )}
    </>
  );
}
