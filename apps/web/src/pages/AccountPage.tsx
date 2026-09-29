import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, del, get, patch, post, setCsrf, uploadImage } from "../api";
import { ImageUpload } from "../components/ImageUpload";
import { useMe } from "../auth";

interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }
interface EventRow { id: number; type: string; ip: string | null; userAgent: string | null; meta: Record<string, unknown>; createdAt: string }

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const EVENT: Record<string, [string, "ok" | "warn" | "bad" | ""]> = {
  register: ["Compte créé", ""], email_verified: ["Adresse confirmée", "ok"], login_success: ["Connexion réussie", "ok"],
  login_failure: ["Échec de connexion", "warn"], login_locked: ["Compte verrouillé 15 min", "bad"], logout: ["Déconnexion", ""],
  password_changed: ["Mot de passe modifié", "warn"], password_reset_requested: ["Réinitialisation demandée", "warn"], password_reset: ["Mot de passe réinitialisé", "warn"],
  session_revoked: ["Session fermée", ""], sessions_revoked_all: ["Autres sessions fermées", "warn"],
  battlenet_login: ["Connexion Battle.net", "ok"], battlenet_linked: ["Battle.net lié", "warn"], battlenet_unlinked: ["Battle.net délié", "warn"],
  account_created_battlenet: ["Compte créé via Battle.net", ""],
  group_created: ["Groupe créé", ""], group_joined: ["Groupe rejoint", ""], group_left: ["Groupe quitté", ""],
  group_role_changed: ["Rôle modifié dans un groupe", ""], group_member_removed: ["Membre retiré d'un groupe", ""],
  invite_created: ["Invitation créée", ""], invite_revoked: ["Invitation révoquée", ""], raid_created: ["Raid créé", ""], raid_deleted: ["Raid supprimé", ""],
};

/** Résumé lisible d'un user-agent, sans bibliothèque. */
function device(ua: string | null) {
  if (!ua) return "Appareil inconnu";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Autre";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  return `${br} · ${os}`;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <section className="panel pad stack"><div><h3>{title}</h3>{hint && <p className="hint" style={{ margin: "4px 0 0" }}>{hint}</p>}</div>{children}</section>;
}

function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setMsg(null);
    try { const t = await fn(); if (t) setMsg({ ok: true, text: t }); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Action impossible." }); }
  };
  const view = msg && <div className={`alert ${msg.ok ? "ok" : "error"}`} role="status">{msg.text}</div>;
  return { run, view };
}

export function AccountPage() {
  const me = useMe();
  const user = me.data!.user!;
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const refreshMe = () => qc.invalidateQueries({ queryKey: ["me"] });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Compte</div><h1>Compte &amp; sécurité</h1></div></div>
      {params.get("bnet") === "linked" && <div className="alert ok">Ton compte Battle.net est maintenant lié.</div>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, alignItems: "start" }}>
        <Profile name={user.displayName} onDone={refreshMe} />
        <Section title="Image du compte" hint="Visible par toi et les membres de tes groupes.">
          <ImageUpload title="Avatar" hint="PNG, JPEG ou WebP. Recadrée en 200 × 200, métadonnées supprimées." currentId={user.avatarId} round
            onUpload={async blob => { await uploadImage("/account/avatar", blob); await refreshMe(); }}
            onRemove={async () => { await del("/account/avatar"); await refreshMe(); }} />
        </Section>
        <Identity email={user.email} verified={user.emailVerified} battletag={user.battletag} hasPassword={user.hasPassword} hasBnet={user.hasBattlenet} bnetEnabled={!!me.data?.battlenetEnabled} onDone={refreshMe} />
        <Password hasPassword={user.hasPassword} canSet={!!user.email && user.emailVerified} onDone={refreshMe} />
      </div>
      <Sessions />
      <AuditLog />
      <DeleteAccount hasPassword={user.hasPassword} />
    </div>
  );
}

function Profile({ name, onDone }: { name: string; onDone: () => void }) {
  const [v, setV] = useState(name);
  const a = useAction();
  return (
    <Section title="Profil">
      <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void a.run(async () => { await patch("/account/profile", { displayName: v }); onDone(); return "Pseudo enregistré."; }); }}>
        <div className="fld"><label htmlFor="dn">Pseudo affiché</label><input id="dn" type="text" minLength={2} maxLength={32} required value={v} onChange={e => setV(e.target.value)} /></div>
        {a.view}
        <button className="btn" type="submit">Enregistrer</button>
      </form>
    </Section>
  );
}

function Identity(p: { email: string | null; verified: boolean; battletag: string | null; hasPassword: boolean; hasBnet: boolean; bnetEnabled: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const a = useAction();
  return (
    <Section title="Identifiants de connexion">
      <div className="row between">
        <span><span className="lbl">E-mail</span><br />{p.email ?? <span className="muted">Aucune adresse</span>}</span>
        {p.email && <span className={`tag ${p.verified ? "ok" : "warn"}`}>{p.verified ? "Confirmée" : "À confirmer"}</span>}
      </div>
      {!p.email && (
        <form className="row" onSubmit={e => { e.preventDefault(); void a.run(async () => (await post<{ message: string }>("/account/email", { email })).message); }}>
          <input type="email" required aria-label="Adresse e-mail" placeholder="ton@adresse.fr" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
          <button className="btn sm" type="submit">Ajouter</button>
        </form>
      )}
      <div className="row between">
        <span><span className="lbl">Battle.net</span><br />{p.battletag ?? <span className="muted">Non lié</span>}</span>
        {p.hasBnet ? (
          <button className="btn ghost sm" type="button" disabled={!p.hasPassword} title={p.hasPassword ? "" : "Ajoute d'abord un mot de passe"}
            onClick={() => void a.run(async () => { await del("/auth/battlenet"); p.onDone(); return "Battle.net délié."; })}>Délier</button>
        ) : p.bnetEnabled ? (
          <button className="btn bnet sm" type="button" onClick={() => void a.run(async () => { const r = await post<{ url: string }>("/auth/battlenet/link"); window.location.assign(r.url); })}>Lier Battle.net</button>
        ) : <span className="muted small">Non configuré sur ce serveur</span>}
      </div>
      {a.view}
    </Section>
  );
}

function Password({ hasPassword, canSet, onDone }: { hasPassword: boolean; canSet: boolean; onDone: () => void }) {
  const [cur, setCur] = useState(""), [next, setNext] = useState(""), [conf, setConf] = useState("");
  const a = useAction();
  if (!hasPassword && !canSet) return <Section title="Mot de passe" hint="Ajoute et confirme une adresse e-mail pour pouvoir définir un mot de passe."><span className="muted small">Connexion via Battle.net uniquement.</span></Section>;
  return (
    <Section title="Mot de passe" hint="Les autres appareils seront déconnectés.">
      <form className="stack" onSubmit={e => {
        e.preventDefault();
        void a.run(async () => {
          if (next !== conf) throw new ApiError(400, "Les deux mots de passe ne correspondent pas.");
          await post("/account/password", { currentPassword: hasPassword ? cur : undefined, newPassword: next });
          setCur(""); setNext(""); setConf(""); onDone();
          return "Mot de passe modifié.";
        });
      }}>
        {hasPassword && <div className="fld"><label htmlFor="cp">Mot de passe actuel</label><input id="cp" type="password" autoComplete="current-password" required value={cur} onChange={e => setCur(e.target.value)} /></div>}
        <div className="fld"><label htmlFor="np">Nouveau (12 caractères min.)</label><input id="np" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={next} onChange={e => setNext(e.target.value)} /></div>
        <div className="fld"><label htmlFor="np2">Confirmation</label><input id="np2" type="password" autoComplete="new-password" required value={conf} onChange={e => setConf(e.target.value)} /></div>
        {a.view}
        <button className="btn" type="submit">{hasPassword ? "Changer le mot de passe" : "Définir un mot de passe"}</button>
      </form>
    </Section>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: SessionRow[] }>("/account/sessions") });
  const a = useAction();
  const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] });
  return (
    <Section title="Sessions actives" hint="Ferme une session que tu ne reconnais pas, puis change ton mot de passe.">
      {a.view}
      <div className="tscroll"><table className="data">
        <thead><tr><th>Appareil</th><th>Adresse IP</th><th>Dernière activité</th><th>Ouverte le</th><th /></tr></thead>
        <tbody>{data?.sessions.map(s => (
          <tr key={s.id}>
            <td>{device(s.userAgent)}{s.current && <span className="tag gold" style={{ marginLeft: 6 }}>Cet appareil</span>}</td>
            <td className="num small">{s.ip ?? "—"}</td>
            <td className="small">{fmt.format(new Date(s.lastSeenAt))}</td>
            <td className="small muted">{fmt.format(new Date(s.createdAt))}</td>
            <td>{!s.current && <button className="btn ghost sm" type="button" onClick={() => void a.run(async () => { await del(`/account/sessions/${s.id}`); await refresh(); return "Session fermée."; })}>Fermer</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {(data?.sessions.length ?? 0) > 1 && <div><button className="btn sm" type="button" onClick={() => void a.run(async () => { const r = await post<{ revoked: number }>("/account/sessions/revoke-others"); await refresh(); return `${r.revoked} session(s) fermée(s).`; })}>Fermer toutes les autres sessions</button></div>}
    </Section>
  );
}

function AuditLog() {
  const { data } = useQuery({ queryKey: ["audit"], queryFn: () => get<{ events: EventRow[] }>("/account/audit") });
  return (
    <Section title="Journal de sécurité" hint="Les 100 derniers événements liés à ton compte.">
      <div className="tscroll" style={{ maxHeight: 420, overflowY: "auto" }}><table className="data">
        <thead><tr><th>Date</th><th>Événement</th><th>Adresse IP</th><th>Appareil</th></tr></thead>
        <tbody>{data?.events.map(e => {
          const [label, tone] = EVENT[e.type] ?? [e.type, ""];
          return (
            <tr key={e.id}>
              <td className="small">{fmt.format(new Date(e.createdAt))}</td>
              <td>{tone ? <span className={`tag ${tone}`}>{label}</span> : label}</td>
              <td className="num small">{e.ip ?? "—"}</td>
              <td className="small muted">{device(e.userAgent)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </Section>
  );
}

function DeleteAccount({ hasPassword }: { hasPassword: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const a = useAction();
  return (
    <Section title="Supprimer mon compte" hint="Supprime définitivement ton compte, tes personnages et tes sessions.">
      {!open ? <div><button className="btn danger sm" type="button" onClick={() => setOpen(true)}>Supprimer mon compte…</button></div> : (
        <form className="row" onSubmit={e => {
          e.preventDefault();
          void a.run(async () => { await del("/account", hasPassword ? { password: v } : { confirm: v }); setCsrf(null); qc.clear(); window.location.assign("/login"); });
        }}>
          <input type={hasPassword ? "password" : "text"} required aria-label={hasPassword ? "Mot de passe" : "Tape SUPPRIMER"} placeholder={hasPassword ? "Ton mot de passe" : "Tape SUPPRIMER"} value={v} onChange={e => setV(e.target.value)} style={{ flex: "1 1 200px" }} />
          <button className="btn danger" type="submit">Supprimer définitivement</button>
          <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Annuler</button>
        </form>
      )}
      {a.view}
    </Section>
  );
}
