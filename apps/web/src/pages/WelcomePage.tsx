import { CLASSES, type ClassName } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, get, post, put, type Character } from "../api";
import { useMe } from "../auth";
import { useSite } from "../site";
import { useMyGuilds } from "../nav";
import { clearInvite, readInvite, saveInvite, tokenFromLink } from "../invite";
import { FactionBadge } from "../components/Icons";
import { NumberField } from "../components/NumberField";
import { ClassDot } from "../components/Outings";
import { CharName } from "../components/GuildRace";
import { ClassSpecPicker } from "../components/ClassSpecPicker";
import { CreateForm } from "./GroupsPage";
import { N, t, tn, tx } from "../i18n";

/**
 * Première visite (Forever, refonte du 23/10), sur /join#<jeton> et /bienvenue :
 * 1. le lien d'invitation nomme la guilde ; sans compte, le compte se crée en trois champs ;
 * 2. après la confirmation de l'e-mail, l'invitation est retrouvée (jeton gardé 24 h dans ce navigateur, invite.ts) ;
 * 3. le perso en trois champs (nom, classe, spé ; niveau), « Rejoindre » : création du perso, acceptation de l'invitation,
 *    le perso devient le main de la guilde ; on arrive sur l'Accueil.
 * Sans invitation : coller son lien, ou créer sa guilde. Aucun appel nouveau, sauf l'aperçu de l'invitation devenu public.
 */

interface Preview {
  group: { id: string; name: string; members: number; faction: string | null; realm: string | null };
  by: string | null; site: { game: string; name: string; origin: string };
}
const errorOf = (e: unknown, def: string) => (e instanceof ApiError ? e.message : def);

/** Jeton du lien ouvert (#…), sinon celui gardé dans ce navigateur. */
function useInviteToken(): [string, (t: string) => void] {
  const [token, setToken] = useState(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash) { saveInvite(fromHash); history.replaceState(null, "", window.location.pathname); return fromHash; }
    return readInvite()?.token ?? "";
  });
  return [token, v => { if (v) saveInvite(v); else clearInvite(); setToken(v); }];
}

function Steps({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="wl-steps" aria-label={t("Étapes")}>
      {[N("Compte"), N("Perso"), N("Accueil")].map((label, i) => {
        const n = i + 1;
        return <li key={label} className={n < step ? "done" : n === step ? "on" : ""} aria-current={n === step ? "step" : undefined}><span className="n" aria-hidden="true">{n < step ? "✓" : n}</span>{t(label)}</li>;
      })}
    </ol>
  );
}

function GuildTop({ p, step }: { p: Preview; step: 1 | 2 | 3 }) {
  const f = p.group.faction === "Horde" || p.group.faction === "Alliance" ? p.group.faction : null;
  return (
    <>
      <div className="wl-top">
        <span className="eyebrow">{p.by ? t("Invitation de {name}", { name: p.by }) : t("Invitation")}</span>
        <h1>{p.group.name}</h1>
        <div className="g-meta">
          {f && <FactionBadge faction={f} size={20} />}
          {p.group.realm && <><span>{p.group.realm}</span><span aria-hidden="true">·</span></>}
          <span>{tn(p.group.members, "{n} joueur", "{n} joueurs")}</span>
        </div>
      </div>
      <Steps step={step} />
    </>
  );
}

export function WelcomePage() {
  const me = useMe();
  const site = useSite();
  const [token, setToken] = useInviteToken();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) { setPreview(null); return; }
    setError(null);
    post<Preview>("/groups/invites/preview", { token })
      .then(setPreview)
      .catch(e => { setPreview(null); setError(errorOf(e, t("Invitation illisible."))); clearInvite(); });
  }, [token]);
  const user = me.data?.user;
  if (me.isLoading) return <p className="muted">{t("Chargement…")}</p>;
  if (!user && !token) return <Navigate to="/login?next=/bienvenue" replace />;

  let body;
  if (token && !preview && !error) body = <p className="muted">{t("Chargement de l'invitation…")}</p>;
  else if (preview && preview.site.game !== site.game) body = (
    <>
      <GuildTop p={preview} step={user ? 2 : 1} />
      <p style={{ margin: 0 }}>{tx("Cette invitation est sur {site}. Ton compte y est le même.", { site: <b>{preview.site.name}</b> })}</p>
      <div><a className="btn primary wl-btn" href={`${preview.site.origin}/join#${token}`}>{t("Ouvrir sur {site}", { site: preview.site.name })}</a></div>
    </>
  );
  else if (preview && !user) body = <><GuildTop p={preview} step={1} /><AccountForm token={token} /></>;
  else if (preview && user) body = <><GuildTop p={preview} step={2} /><PersoForm p={preview} token={token} defaultName={user.displayName} /></>;
  else if (!user) body = (
    <>
      <div className="wl-top"><span className="eyebrow">{t("Invitation")}</span><h1>{t("Lien expiré")}</h1></div>
      <div className="alert error" role="alert">{error ?? t("Cette invitation n'est plus valable.")}</div>
      <p style={{ margin: 0 }}>{t("Demande un nouveau lien à un officier de ta guilde.")}</p>
      <p className="small wl-alt"><Link to="/login">{t("Se connecter")}</Link> · <Link to="/register">{t("Créer un compte")}</Link></p>
    </>
  );
  else body = <NoInvite name={user.displayName} error={error} onToken={v => { setError(null); setToken(v); }} />;
  return <div className="wl"><section className="wl-card panel lift" aria-label={t("Bienvenue")}>{body}</section></div>;
}

/* ---------- 1. Compte ---------- */

function AccountForm({ token }: { token: string }) {
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await post("/auth/register", form);
      saveInvite(token, form.email);
      setDone(true);
    } catch (err) { setError(errorOf(err, t("Le serveur ne répond pas. Réessaie."))); }
    finally { setBusy(false); }
  };
  if (done) return (
    <div className="wl-form" role="status">
      <div className="alert ok">{t("Regarde tes e-mails ({email}) : ouvre le lien de confirmation, l'invitation t'attend.", { email: form.email })}</div>
      <p className="hint" style={{ margin: 0 }}>{t("Le lien est valable 24 heures. Pense aux spams.")}</p>
    </div>
  );
  return (
    <form className="wl-form" onSubmit={e => void submit(e)} aria-label={t("Créer mon compte")}>
      <div className="fld"><label htmlFor="wa-p">{t("Pseudo")}</label><input id="wa-p" type="text" required minLength={2} maxLength={32} autoComplete="nickname" value={form.displayName} onChange={set("displayName")} /></div>
      <div className="fld"><label htmlFor="wa-e">{t("E-mail")}</label><input id="wa-e" type="email" required autoComplete="email" value={form.email} onChange={set("email")} /></div>
      <div className="fld"><label htmlFor="wa-m">{t("Mot de passe")}</label>
        <div className="pw"><input id="wa-m" type={show ? "text" : "password"} required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="wa-mh" value={form.password} onChange={set("password")} />
          <button type="button" className="btn ghost sm" aria-pressed={show} onClick={() => setShow(s => !s)}>{show ? t("Masquer") : t("Afficher")}</button></div>
        <span id="wa-mh" className="hint">{t("12 caractères au moins : une phrase de passe est idéale.")}</span>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="wl-go"><button type="submit" className="btn primary wl-btn" disabled={busy}>{busy ? t("Création…") : t("Créer mon compte")}</button>
        <span className="hint">{t("Un e-mail de confirmation arrive : l'invitation t'attend.")}</span></div>
      <p className="small wl-alt">{t("Déjà un compte ?")} <Link to="/login?next=/bienvenue">{t("Se connecter")}</Link></p>
    </form>
  );
}

/* ---------- 2. Ton perso, puis « Rejoindre » ---------- */

function PersoForm({ p, token, defaultName }: { p: Preview; token: string; defaultName: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const guilds = useMyGuilds().data?.groups;
  const charsQ = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const mine = (charsQ.data?.characters ?? []).filter(c => !c.group || c.group.id === p.group.id);
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [level, setLevel] = useState(1);
  const [cls, setCls] = useState<ClassName | "">("");
  const [spec, setSpec] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un perso déjà là (sans guilde) est proposé d'abord ; sinon un nouveau
  useEffect(() => { if (pick === null && charsQ.data) setPick(mine.find(c => c.cls)?.id ?? "new"); }, [charsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const member = guilds?.some(g => g.id === p.group.id);
  const isNew = pick === "new";
  const ready = !isNew || (name.trim().length > 0 && !!cls && !!spec);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const charId = isNew ? (await post<{ character: Character }>("/characters", { name: name.trim(), cls, spec1: spec, level })).character.id : pick;
      const { groupId } = await post<{ groupId: string }>("/groups/invites/accept", { token });
      if (charId) await put(`/groups/${groupId}/characters/${charId}`, { assigned: true, main: true });
      clearInvite();
      await Promise.all([qc.invalidateQueries({ queryKey: ["groups"] }), qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["week"] })]);
      nav(`/groups/${groupId}`, { replace: true });
    } catch (err) { setError(errorOf(err, t("Impossible de rejoindre la guilde."))); setBusy(false); }
  };

  if (member) return (
    <div className="wl-form">
      <p style={{ margin: 0 }}>{tx("Tu es déjà dans {guild}.", { guild: <b>{p.group.name}</b> })}</p>
      <div className="wl-go"><Link className="btn primary wl-btn" to={`/groups/${p.group.id}`} onClick={() => clearInvite()}>{t("Ouvrir l'Accueil")}</Link></div>
    </div>
  );
  return (
    <form className="wl-form" onSubmit={e => void join(e)} aria-label={t("Ton perso")}>
      {mine.length > 0 && (
        <div className="fld"><span className="lbl">{t("Ton perso")}</span>
          <div className="cls-pick wl-chars" role="group" aria-label={t("Ton perso")}>
            {mine.map(c => (
              <button key={c.id} type="button" className="cls-b" aria-pressed={pick === c.id}
                style={{ "--cc": c.cls ? CLASSES[c.cls as ClassName]?.color : undefined } as CSSProperties} onClick={() => setPick(c.id)}>
                <ClassDot cls={c.cls} /><span><CharName name={c.name} cls={c.cls} as="span" /> <span className="lvn">{c.level}</span></span>
              </button>
            ))}
            <button type="button" className="cls-b" aria-pressed={isNew} onClick={() => setPick("new")}><span>{t("+ Un autre perso")}</span></button>
          </div>
        </div>
      )}
      {isNew && <>
        <div className="wl-row">
          <div className="fld"><label htmlFor="wl-n">{t("Nom du perso")}</label><input id="wl-n" type="text" required maxLength={40} value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="fld wl-lv"><label htmlFor="wl-lv">{t("Niveau")}</label><NumberField id="wl-lv" min={1} max={60} value={level} onChange={setLevel} /></div>
        </div>
        <ClassSpecPicker cls={cls} spec={spec} onCls={c => { setCls(c); setSpec(""); }} onSpec={setSpec} idPrefix="wl" />
      </>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="wl-go">
        <button type="submit" className="btn primary wl-btn" disabled={!ready || busy}>{busy ? t("Un instant…") : t("Rejoindre {guild}", { guild: p.group.name })}</button>
        {isNew && <span className="hint">{t("Talents, métiers et équipement viendront de l'addon.")}</span>}
      </div>
    </form>
  );
}

/* ---------- Sans invitation ---------- */

function NoInvite({ name, error, onToken }: { name: string; error: string | null; onToken: (t: string) => void }) {
  const [link, setLink] = useState("");
  const [creating, setCreating] = useState(false);
  const [bad, setBad] = useState(false);
  const open = (e: FormEvent) => {
    e.preventDefault();
    const tok = tokenFromLink(link);
    if (!tok) { setBad(true); return; }
    setBad(false); onToken(tok);
  };
  return (
    <>
      <div className="wl-top"><span className="eyebrow">{name ? t("Bienvenue, {name}", { name }) : t("Bienvenue")}</span><h1>{t("Ta guilde")}</h1></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="wl-choice">
        <form className="wl-opt" onSubmit={open}>
          <h3>{t("J'ai un lien d'invitation")}</h3>
          <div className="row nowrap"><input type="text" placeholder={t("Colle le lien ici")} aria-label={t("Lien d'invitation")} value={link} onChange={e => { setLink(e.target.value); setBad(false); }} />
            <button type="submit" className="btn primary">{t("Ouvrir")}</button></div>
          {bad && <span className="warnmsg small" role="alert">{t("Ce n'est pas un lien d'invitation.")}</span>}
        </form>
        <div className="wl-opt">
          <h3>{t("Je monte ma guilde")}</h3>
          {creating ? <CreateForm autoFocus onCancel={() => setCreating(false)} /> : <button type="button" className="btn" onClick={() => setCreating(true)}>{t("Créer ma guilde")}</button>}
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>{t("Pas de lien ? Demande-le à un officier sur Discord.")}</p>
    </>
  );
}
