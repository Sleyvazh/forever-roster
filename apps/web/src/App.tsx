import { NavLink, Route, Routes, Link } from "react-router-dom";
import { RequireAuth, useLogout, useMe } from "./auth";
import { Countdown } from "./components/Countdown";
import { AccountPage } from "./pages/AccountPage";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AuthPages";
import { CharactersPage } from "./pages/CharactersPage";
import { GroupPage } from "./pages/GroupPage";
import { GroupsPage } from "./pages/GroupsPage";
import { JoinPage } from "./pages/JoinPage";
import { RaidPage } from "./pages/RaidPage";

export function App() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data?.user;

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Forever Roster, accueil">
          <img src="/favicon.svg" width="30" height="30" alt="" />
          <span style={{ display: "grid", gap: 4 }}><strong>Forever Roster</strong><span>WoW Forever · niveau 60</span></span>
        </Link>
        {user && (
          <nav className="nav" aria-label="Navigation principale">
            <NavLink to="/" end>Mes persos</NavLink>
            <NavLink to="/groups">Groupes</NavLink>
            <NavLink to="/account">Compte &amp; sécurité</NavLink>
          </nav>
        )}
        <div className="row" style={{ gap: 16 }}>
          <Countdown />
          {user && (
            <div className="userbox">
              <span>{user.displayName}</span>
              <button className="btn sm ghost" type="button" onClick={() => void logout()}>Se déconnecter</button>
            </div>
          )}
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/" element={<RequireAuth><CharactersPage /></RequireAuth>} />
          <Route path="/groups" element={<RequireAuth><GroupsPage /></RequireAuth>} />
          <Route path="/groups/:groupId" element={<RequireAuth><GroupPage /></RequireAuth>} />
          <Route path="/groups/:groupId/raids/:raidId" element={<RequireAuth><RaidPage /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route path="*" element={<div className="empty"><h2>Page introuvable</h2><Link to="/">Retour à l'accueil</Link></div>} />
        </Routes>
      </main>
    </div>
  );
}
