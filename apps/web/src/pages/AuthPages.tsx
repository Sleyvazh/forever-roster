import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, get, post } from "../api";
import { safeNext, useMe } from "../auth";
import { readInvite } from "../invite";
import { useSite } from "../site";
import { PasswordInput, PasswordRules } from "../components/PasswordInput";
import { N, t, tx } from "../i18n";

/*
 * Connexion (refonte du 09/11, variante C) : Battle.net bleu plein, « ou avec ton e-mail », mot de passe avec un œil,
 * « Se connecter » doré, liens dorés. Nouveaux mots de passe : un œil et les règles cochées en direct, plus de champ
 * « Confirmation ».
 */

const BNET_ERRORS: Record<string, string> = {
  bnet_cancelled: N("Connexion Battle.net annulée."),
  bnet_state: N("La connexion Battle.net a expiré ou ne venait pas de ce navigateur. Réessaie."),
  bnet_exchange: N("Battle.net n'a pas répondu correctement. Réessaie dans un instant."),
  bnet_session: N("Ta session a changé pendant la liaison Battle.net. Reconnecte-toi puis recommence."),
  bnet_taken: N("Ce compte Battle.net est déjà lié à un autre compte."),
};

/** Lit le jeton placé dans le fragment (#) du lien reçu par e-mail, puis l'efface de la barre d'adresse. */
function useHashToken() {
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => { if (window.location.hash) history.replaceState(null, "", window.location.pathname); }, []);
  return token;
}

function useSubmit<T>(fn: () => Promise<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("Le serveur ne répond pas. Réessaie.")); }
    finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return <div className="auth panel lift pad stack"><h1>{title}</h1>{children}</div>;
}

export function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  // Invitation en attente (compte créé depuis la page Bienvenue) : e-mail prérempli
  const [email, setEmail] = useState(() => readInvite()?.email ?? "");
  const forever = useSite().game === "forever";
  const [password, setPassword] = useState("");
  const [unverified, setUnverified] = useState(false);
  const s = useSubmit(async () => {
    setUnverified(false);
    try {
      await post("/auth/login", { email, password });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setUnverified(true);
      throw err;
    }
  });
  const resend = useSubmit(() => post<{ message: string }>("/auth/resend-verification", { email }));
  const bnetError = params.get("error");

  if (me.data?.user) return <Navigate to={next} replace />;
  return (
    <AuthCard title={t("Connexion")}>
      {bnetError && <div className="alert error" role="alert">{BNET_ERRORS[bnetError] ? t(BNET_ERRORS[bnetError]) : t("La connexion a échoué.")}</div>}
      {me.data?.battlenetEnabled && (
        <>
          <a className="btn bnet" href="/api/auth/battlenet/start">{t("Se connecter avec Battle.net")}</a>
          <div className="divider">{t("ou avec ton e-mail")}</div>
        </>
      )}
      <form className="stack" onSubmit={s.run}>
        <div className="fld"><label htmlFor="email">{t("E-mail")}</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="fld"><label htmlFor="password">{t("Mot de passe")}</label><PasswordInput id="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
        {s.error && <div className="alert error" role="alert">{s.error}</div>}
        {unverified && (
          <div className="alert info">
            {t("Pas reçu l'e-mail ?")} <button type="button" className="btn sm" disabled={resend.busy} onClick={() => void resend.run()}>{t("Renvoyer le lien")}</button>
          </div>
        )}
        <button className="btn primary auth-go" type="submit" disabled={s.busy}>{s.busy ? t("Connexion…") : t("Se connecter")}</button>
      </form>
      <div className="row between auth-links">
        <Link to="/forgot-password">{t("Mot de passe oublié ?")}</Link>
        <Link to={forever && readInvite() ? "/bienvenue" : next !== "/" ? `/register?next=${encodeURIComponent(next)}` : "/register"}>{t("Créer un compte")}</Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const me = useMe();
  // Destination gardée jusqu'à la connexion (lien « Créer un compte » de /login?next=…)
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const loginUrl = next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => {
    const r = await post<{ message: string }>("/auth/register", { displayName: form.displayName, email: form.email, password: form.password });
    setDone(r.message);
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (me.data?.user) return <Navigate to="/" replace />;
  if (done) return <AuthCard title={t("Vérifie tes e-mails")}><p>{done}</p><p className="hint">{t("Le lien est valable 24 heures. Pense à regarder dans les spams.")}</p><Link to={loginUrl}>{t("Retour à la connexion")}</Link></AuthCard>;
  return (
    <AuthCard title={t("Créer un compte")}>
      {me.data?.battlenetEnabled && (<><a className="btn bnet" href="/api/auth/battlenet/start">{t("S'inscrire avec Battle.net")}</a><div className="divider">{t("ou avec ton e-mail")}</div></>)}
      <form className="stack" onSubmit={s.run}>
        <div className="fld"><label htmlFor="dn">{t("Pseudo")}</label><input id="dn" type="text" required minLength={2} maxLength={32} autoComplete="nickname" value={form.displayName} onChange={set("displayName")} /></div>
        <div className="fld"><label htmlFor="em">{t("E-mail")}</label><input id="em" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></div>
        <div className="fld">
          <label htmlFor="pw">{t("Mot de passe")}</label>
          <PasswordInput id="pw" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={set("password")} aria-describedby="pw-rules" />
          <PasswordRules id="pw-rules" value={form.password} />
        </div>
        {s.error && <div className="alert error" role="alert">{s.error}</div>}
        <button className="btn primary auth-go" type="submit" disabled={s.busy}>{s.busy ? t("Création…") : t("Créer mon compte")}</button>
        <p className="hint" style={{ margin: 0 }}>{tx("Ton e-mail et ton pseudo servent seulement à faire marcher le site : voir la {link}.", { link: <Link to="/confidentialite">{t("politique de confidentialité")}</Link> })}</p>
      </form>
      <p className="small">{t("Déjà un compte ?")} <Link to={loginUrl}>{t("Se connecter")}</Link></p>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const token = useHashToken();
  const qc = useQueryClient();
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  const signedIn = !!useMe().data?.user;
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    if (!token) { setState({ ok: false, msg: t("Lien incomplet. Ouvre le lien directement depuis l'e-mail.") }); return; }
    // Jeton CSRF de la session d'abord (compte déjà connecté qui ouvre le lien : la requête partirait sans lui)
    get("/auth/me").catch(() => null)
      .then(() => post<{ message: string }>("/auth/verify-email", { token }))
      .then(r => { setState({ ok: true, msg: r.message }); void qc.invalidateQueries({ queryKey: ["me"] }); })
      .catch(e => setState({ ok: false, msg: e instanceof ApiError ? e.message : t("Erreur réseau.") }));
  }, [token, qc]);
  return (
    <AuthCard title={t("Confirmation de l'adresse")}>
      {!state ? <p className="muted">{t("Vérification…")}</p> : <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">{state.msg}</div>}
      {/* Déjà connecté (compte Battle.net qui ajoute son adresse) : retour à son compte plutôt qu'à la connexion */}
      {signedIn ? <Link to="/account">{t("Retour à mon compte")}</Link>
        : state?.ok && readInvite() ? <Link className="btn primary" to="/login?next=/bienvenue">{t("Se connecter")}</Link>
        : <Link to="/login">{t("Aller à la connexion")}</Link>}
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => setDone((await post<{ message: string }>("/auth/forgot-password", { email })).message));
  return (
    <AuthCard title={t("Mot de passe oublié")}>
      {done ? <div className="alert ok" role="status">{done}</div> : (
        <form className="stack" onSubmit={s.run}>
          <div className="fld"><label htmlFor="em">{t("E-mail du compte")}</label><input id="em" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          {s.error && <div className="alert error" role="alert">{s.error}</div>}
          <button className="btn primary" type="submit" disabled={s.busy}>{t("Envoyer le lien")}</button>
        </form>
      )}
      <Link to="/login">{t("Retour à la connexion")}</Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useHashToken();
  const [pw, setPw] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => {
    setDone((await post<{ message: string }>("/auth/reset-password", { token, password: pw })).message);
  });
  if (!token) return <AuthCard title={t("Nouveau mot de passe")}><div className="alert error">{t("Lien incomplet. Ouvre-le directement depuis l'e-mail.")}</div></AuthCard>;
  return (
    <AuthCard title={t("Nouveau mot de passe")}>
      {done ? <><div className="alert ok" role="status">{done}</div><Link to="/login">{t("Se connecter")}</Link></> : (
        <form className="stack" onSubmit={s.run}>
          <p className="warnmsg" style={{ margin: 0 }}>{t("Toutes tes sessions ouvertes seront fermées.")}</p>
          <div className="fld"><label htmlFor="pw">{t("Nouveau mot de passe")}</label>
            <PasswordInput id="pw" required minLength={12} maxLength={128} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} aria-describedby="pw-rules" />
            <PasswordRules id="pw-rules" value={pw} /></div>
          {s.error && <div className="alert error" role="alert">{s.error}</div>}
          <button className="btn primary" type="submit" disabled={s.busy}>{t("Enregistrer le mot de passe")}</button>
        </form>
      )}
    </AuthCard>
  );
}
