import { GlyphSprite } from "./components/ItemGlyphs";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth";
import { TopBar } from "./components/TopBar";
import { AccountPage } from "./pages/AccountPage";
import { AddonPage } from "./pages/AddonPage";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/AuthPages";
import { CharactersPage } from "./pages/CharactersPage";
import { GroupsPage } from "./pages/GroupsPage";
import { GroupRoute } from "./pages/GuildPages";
import { JoinPage } from "./pages/JoinPage";
import { WelcomePage } from "./pages/WelcomePage";
import { MyCharsPage } from "./pages/MyCharsPage";
import { useSite } from "./site";
import { useCurrentGuild } from "./nav";
import { LegalNoticePage, PrivacyPage } from "./pages/LegalPages";
import { PairPage } from "./pages/PairPage";
import { RaidPage } from "./pages/RaidPage";
import { AdminReportsPage, MyReportsPage } from "./pages/ReportsPage";

/** Forever : « / » mène à l'Accueil de la dernière guilde ouverte (sans guilde : Bienvenue) ; Roster : Mes persos. */
function Home() {
  const site = useSite();
  const g = useCurrentGuild();
  if (site.game === "retail") return <Navigate to="/persos" replace />;
  if (g.loading) return <p className="muted">Chargement…</p>;
  return <Navigate to={g.id ? `/groups/${g.id}` : "/bienvenue"} replace />;
}
/** Mes persos : liste puis fiche sur Forever ; Roster garde sa page. */
function Chars() {
  return useSite().game === "retail" ? <CharactersPage /> : <MyCharsPage />;
}
/** Invitation : Forever passe par la page Bienvenue (compte, perso, rejoindre) ; Roster garde la page Invitation. */
function Join() {
  return useSite().game === "retail" ? <JoinPage /> : <WelcomePage />;
}
/** Forever n'a plus de page Guildes : la liste passe dans le sélecteur de guilde. */
function Groups() {
  return useSite().game === "retail" ? <GroupsPage /> : <Navigate to="/" replace />;
}

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
            <Route path="/join" element={<Join />} />
            <Route path="/bienvenue" element={<WelcomePage />} />
            {/* Pages publiques, sans connexion, sur les deux adresses */}
            <Route path="/mentions-legales" element={<LegalNoticePage />} />
            <Route path="/confidentialite" element={<PrivacyPage />} />
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            <Route path="/persos/:charId?/:tab?" element={<RequireAuth><Chars /></RequireAuth>} />
            <Route path="/groups" element={<RequireAuth><Groups /></RequireAuth>} />
            <Route path="/groups/:groupId/:tab?" element={<RequireAuth><GroupRoute /></RequireAuth>} />
            {/* Forever : Raids › Passés et Présence (avant l'adresse d'un raid) */}
            <Route path="/groups/:groupId/raids/passes" element={<RequireAuth><GroupRoute tab="raids" sub="passes" /></RequireAuth>} />
            <Route path="/groups/:groupId/raids/presence" element={<RequireAuth><GroupRoute tab="raids" sub="presence" /></RequireAuth>} />
            <Route path="/groups/:groupId/raids/:raidId/:tab?" element={<RequireAuth><RaidPage /></RequireAuth>} />
            {/* « + Sortie » : /groups/:id/sorties/nouvelle ; Guilde : /groups/:id/membres/course… */}
            <Route path="/groups/:groupId/:tab/:sub" element={<RequireAuth><GroupRoute /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            <Route path="/addon" element={<RequireAuth><AddonPage /></RequireAuth>} />
            <Route path="/appairer" element={<RequireAuth><PairPage /></RequireAuth>} />
            <Route path="/signalements" element={<RequireAuth><MyReportsPage /></RequireAuth>} />
            <Route path="/admin/signalements" element={<RequireAuth><AdminReportsPage /></RequireAuth>} />
            <Route path="*" element={<div className="empty"><h2>Page introuvable</h2><Link to="/">Retour à l'accueil</Link></div>} />
          </Routes>
        </main>
        {/* Sur toutes les pages (Forever Roster et Roster) : crédit de l'artiste des icônes, pages légales */}
        <footer className="site-foot">
          <span>Icônes de classes et de spécialisations réalisées par Pahpool</span>
          <nav aria-label="Informations légales"><Link to="/mentions-legales">Mentions légales</Link><Link to="/confidentialite">Confidentialité</Link></nav>
        </footer>
      </div>
    </>
  );
}
