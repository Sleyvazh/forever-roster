import { GlyphSprite } from "./components/ItemGlyphs";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth";
import { TopBar } from "./components/TopBar";
import { AccountPage } from "./pages/AccountPage";
import { AddonPage } from "./pages/AddonPage";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AuthPages";
import { CharactersPage } from "./pages/CharactersPage";
import { GroupPage } from "./pages/GroupPage";
import { GroupsPage } from "./pages/GroupsPage";
import { JoinPage } from "./pages/JoinPage";
import { RaidPage } from "./pages/RaidPage";

export function App() {
  return (
    <>
      <GlyphSprite />
      <TopBar />
      <div className="shell">
        <main>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/join" element={<JoinPage />} />
            <Route path="/" element={<RequireAuth><Navigate to="/persos" replace /></RequireAuth>} />
            <Route path="/persos/:charId?/:tab?" element={<RequireAuth><CharactersPage /></RequireAuth>} />
            <Route path="/groups" element={<RequireAuth><GroupsPage /></RequireAuth>} />
            <Route path="/groups/:groupId/:tab?" element={<RequireAuth><GroupPage /></RequireAuth>} />
            <Route path="/groups/:groupId/raids/:raidId" element={<RequireAuth><RaidPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            <Route path="/addon" element={<RequireAuth><AddonPage /></RequireAuth>} />
            <Route path="*" element={<div className="empty"><h2>Page introuvable</h2><Link to="/">Retour à l'accueil</Link></div>} />
          </Routes>
        </main>
      </div>
    </>
  );
}
