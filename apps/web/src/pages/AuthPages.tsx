import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, post } from "../api";
import { safeNext, useMe } from "../auth";

const BNET_ERRORS: Record<string, string> = {
  bnet_cancelled: "Connexion Battle.net annulée.",
  bnet_state: "La connexion Battle.net a expiré ou ne venait pas de ce navigateur. Réessaie.",
  bnet_exchange: "Battle.net n'a pas répondu correctement. Réessaie dans un instant.",
  bnet_session: "Ta session a changé pendant la liaison Battle.net. Reconnecte-toi puis recommence.",
  bnet_taken: "Ce compte Battle.net est déjà lié à un autre compte.",
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
    catch (err) { setError(err instanceof ApiError ? err.message : "Le serveur ne répond pas. Réessaie."); }
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
  const [email, setEmail] = useState("");
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
    <AuthCard title="Connexion">
      {bnetError && <div className="alert error" role="alert">{BNET_ERRORS[bnetError] ?? "La connexion a échoué."}</div>}
      {me.data?.battlenetEnabled && (
        <>
          <a className="btn bnet" href="/api/auth/battlenet/start">Se connecter avec Battle.net</a>
          <div className="divider">ou avec ton e-mail</div>
        </>
      )}
      <form className="stack" onSubmit={s.run}>
        <div className="fld"><label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="fld"><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
        {s.error && <div className="alert error" role="alert">{s.error}</div>}
        {unverified && (
          <div className="alert info">
            Pas reçu l'e-mail ? <button type="button" className="btn sm" disabled={resend.busy} onClick={() => void resend.run()}>Renvoyer le lien</button>
          </div>
        )}
        <button className="btn primary" type="submit" disabled={s.busy}>{s.busy ? "Connexion…" : "Se connecter"}</button>
      </form>
      <div className="row between small">
        <Link to="/forgot-password">Mot de passe oublié ?</Link>
        <Link to="/register">Créer un compte</Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const me = useMe();
  const [form, setForm] = useState({ displayName: "", email: "", password: "", confirm: "" });
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => {
    if (form.password !== form.confirm) throw new ApiError(400, "Les deux mots de passe ne correspondent pas.");
    const r = await post<{ message: string }>("/auth/register", { displayName: form.displayName, email: form.email, password: form.password });
    setDone(r.message);
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (me.data?.user) return <Navigate to="/" replace />;
  if (done) return <AuthCard title="Vérifie tes e-mails"><p>{done}</p><p className="hint">Le lien est valable 24 heures. Pense à regarder dans les spams.</p><Link to="/login">Retour à la connexion</Link></AuthCard>;
  return (
    <AuthCard title="Créer un compte">
      {me.data?.battlenetEnabled && (<><a className="btn bnet" href="/api/auth/battlenet/start">S'inscrire avec Battle.net</a><div className="divider">ou avec ton e-mail</div></>)}
      <form className="stack" onSubmit={s.run}>
        <div className="fld"><label htmlFor="dn">Pseudo</label><input id="dn" type="text" required minLength={2} maxLength={32} autoComplete="nickname" value={form.displayName} onChange={set("displayName")} /></div>
        <div className="fld"><label htmlFor="em">E-mail</label><input id="em" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></div>
        <div className="fld">
          <label htmlFor="pw">Mot de passe</label>
          <input id="pw" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={set("password")} aria-describedby="pw-hint" />
          <span id="pw-hint" className="hint">12 caractères minimum. Une phrase de passe est idéale. Les mots de passe apparus dans des fuites connues sont refusés.</span>
        </div>
        <div className="fld"><label htmlFor="pw2">Confirmation</label><input id="pw2" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} /></div>
        {s.error && <div className="alert error" role="alert">{s.error}</div>}
        <button className="btn primary" type="submit" disabled={s.busy}>{s.busy ? "Création…" : "Créer mon compte"}</button>
      </form>
      <p className="small">Déjà un compte ? <Link to="/login">Se connecter</Link></p>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const token = useHashToken();
  const qc = useQueryClient();
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    if (!token) { setState({ ok: false, msg: "Lien incomplet. Ouvre le lien directement depuis l'e-mail." }); return; }
    post<{ message: string }>("/auth/verify-email", { token })
      .then(r => { setState({ ok: true, msg: r.message }); void qc.invalidateQueries({ queryKey: ["me"] }); })
      .catch(e => setState({ ok: false, msg: e instanceof ApiError ? e.message : "Erreur réseau." }));
  }, [token, qc]);
  return (
    <AuthCard title="Confirmation de l'adresse">
      {!state ? <p className="muted">Vérification…</p> : <div className={`alert ${state.ok ? "ok" : "error"}`} role="status">{state.msg}</div>}
      <Link to="/login">Aller à la connexion</Link>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => setDone((await post<{ message: string }>("/auth/forgot-password", { email })).message));
  return (
    <AuthCard title="Mot de passe oublié">
      {done ? <div className="alert ok" role="status">{done}</div> : (
        <form className="stack" onSubmit={s.run}>
          <div className="fld"><label htmlFor="em">E-mail du compte</label><input id="em" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
          {s.error && <div className="alert error" role="alert">{s.error}</div>}
          <button className="btn primary" type="submit" disabled={s.busy}>Envoyer le lien</button>
        </form>
      )}
      <Link to="/login">Retour à la connexion</Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const token = useHashToken();
  const [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const s = useSubmit(async () => {
    if (pw !== pw2) throw new ApiError(400, "Les deux mots de passe ne correspondent pas.");
    setDone((await post<{ message: string }>("/auth/reset-password", { token, password: pw })).message);
  });
  if (!token) return <AuthCard title="Nouveau mot de passe"><div className="alert error">Lien incomplet. Ouvre-le directement depuis l'e-mail.</div></AuthCard>;
  return (
    <AuthCard title="Nouveau mot de passe">
      {done ? <><div className="alert ok" role="status">{done}</div><Link to="/login">Se connecter</Link></> : (
        <form className="stack" onSubmit={s.run}>
          <p className="hint">Toutes tes sessions ouvertes seront fermées.</p>
          <div className="fld"><label htmlFor="pw">Nouveau mot de passe</label><input id="pw" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
          <div className="fld"><label htmlFor="pw2">Confirmation</label><input id="pw2" type="password" required autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} /></div>
          {s.error && <div className="alert error" role="alert">{s.error}</div>}
          <button className="btn primary" type="submit" disabled={s.busy}>Enregistrer</button>
        </form>
      )}
    </AuthCard>
  );
}
