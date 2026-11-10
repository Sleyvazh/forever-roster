import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, del, get, patch, post, setCsrf, uploadImage } from "../api";
import { ImageUpload } from "../components/ImageUpload";
import { PasswordInput, PasswordRules } from "../components/PasswordInput";
import { EVENT_LABEL } from "../components/AdminSections";
import { useMe } from "../auth";
import { useSite } from "../site";
import type { GameLangPref } from "@forever/game-data";

interface SessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }
interface EventRow { id: number; type: string; ip: string | null; userAgent: string | null; meta: Record<string, unknown>; createdAt: string }

/** Dates courtes (refonte du 09/11) : « 9 nov., 21:14 », l'année seulement si ce n'est pas celle-ci. */
const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const SHORT_Y = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fmt = { format: (d: Date) => (d.getFullYear() === new Date().getFullYear() ? SHORT : SHORT_Y).format(d) };
const EVENT: Record<string, [string, "ok" | "warn" | "bad" | ""]> = {
  register: ["Compte créé", ""], email_verified: ["Adresse confirmée", "ok"], login_success: ["Connexion réussie", "ok"],
  login_failure: ["Échec de connexion", "warn"], login_locked: ["Compte verrouillé 15 min", "bad"], logout: ["Déconnexion", ""],
  password_changed: ["Mot de passe modifié", "warn"], password_reset_requested: ["Réinitialisation demandée", "warn"], password_reset: ["Mot de passe réinitialisé", "warn"],
  session_revoked: ["Session fermée", ""], sessions_revoked_all: ["Autres sessions fermées", "warn"],
  battlenet_login: ["Connexion Battle.net", "ok"], battlenet_linked: ["Battle.net lié", "warn"], battlenet_unlinked: ["Battle.net délié", "warn"],
  account_created_battlenet: ["Compte créé via Battle.net", ""],
  battlenet_import_list: ["Liste des persos lue sur Battle.net", ""], battlenet_import: ["Persos importés de Battle.net", ""],
  discord_linked: ["Discord lié", "warn"], discord_unlinked: ["Discord délié", "warn"],
  group_discord_linked: ["Salon Discord lié à une guilde", ""], reports_channel_linked: ["Salon Discord des signalements lié", ""], group_discord_unlinked: ["Salon Discord délié d'une guilde", ""],
  group_created: ["Guilde créée", ""], group_joined: ["Guilde rejointe", ""], group_left: ["Guilde quittée", ""],
  group_role_changed: ["Rôle modifié dans une guilde", ""], group_member_removed: ["Membre retiré d'une guilde", ""],
  invite_created: ["Invitation créée", ""], invite_revoked: ["Invitation révoquée", ""], raid_created: ["Raid créé", ""], raid_deleted: ["Raid supprimé", ""],
  device_linked: ["Appareil relié", "warn"], device_pair_denied: ["Appairage refusé", "warn"], device_unlinked: ["Appareil délié", ""],
  // Copier-coller facultatif : un officier avec Roster Companion a transmis l'inscription faite en jeu d'un joueur
  signup_relayed: ["Inscription transmise pour un joueur", ""],
  // Niveau d'un perso de la guilde fixé par un officier (fiche introuvable dans la liste du jeu), ou rendu au joueur
  character_level_fixed: ["Niveau d'un perso corrigé", ""], character_level_released: ["Niveau d'un perso rendu au joueur", ""],
  // Fiches (8/11) : fiche créée pour un joueur (officier), fiche donnée à un autre membre
  character_created_for: ["Fiche créée pour un joueur", ""], character_given: ["Fiche donnée à un autre joueur", ""],
  // Bug du journal (refonte du 09/11) : actions de guilde sans libellé, qui s'affichaient en code (« loot_count_corrected »)
  loot_count_corrected: ["Compte d'objets reçus corrigé", ""], group_loot_settings: ["Réglages du butin d'une guilde changés", ""],
  raid_council: ["Conseil du butin d'un raid changé", ""], group_orders_linked: ["Salon des commandes lié", ""], group_orders_unlinked: ["Salon des commandes délié", ""],
};
/**
 * Libellé d'une ligne du journal : ceux du compte, sinon ceux du journal de guilde à la deuxième personne (« a créé un raid »
 * → « Tu as créé un raid ») ; jamais le code brut.
 */
function eventLabel(type: string): [string, "ok" | "warn" | "bad" | ""] {
  const own = EVENT[type];
  if (own) return own;
  const g = EVENT_LABEL[type];
  if (g) return [g.replace(/^a /, "Tu as "), ""];
  return ["Action sur le site", ""];
}

/** Résumé lisible d'un user-agent, sans bibliothèque. */
function device(ua: string | null) {
  if (!ua) return "Appareil inconnu";
  if (/RosterCompanion/.test(ua)) return "Roster Companion";
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

type Key = "profil" | "securite" | "discord" | "appareils" | "journal" | "supprimer";
const MENU: [Key, string][] = [["profil", "Profil"], ["securite", "Connexion et sécurité"], ["discord", "Discord et messages"], ["appareils", "Appareils et sessions"], ["journal", "Journal"], ["supprimer", "Supprimer le compte"]];

/**
 * Compte et sécurité (refonte du 09/11, maquette-compte.png) : un menu à gauche comme l'Administration — Profil · Connexion et
 * sécurité · Discord et messages · Appareils et sessions · Journal · Supprimer le compte (en rouge). ?section= choisit la
 * section ; les retours de Battle.net et de Discord ouvrent la leur. Sur téléphone, le menu puis la section.
 */
export function AccountPage() {
  const me = useMe();
  const user = me.data!.user!;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const refreshMe = () => qc.invalidateQueries({ queryKey: ["me"] });
  const site = useSite();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: SessionRow[] }>("/account/sessions") }).data?.sessions;
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => get<{ devices: DeviceRow[] }>("/devices") }).data?.devices;
  const raw = params.get("section");
  const back = params.get("bnet") ? "securite" : params.get("discord") || params.get("error")?.startsWith("discord") ? "discord" : params.get("error")?.startsWith("bnet") ? "securite" : null;
  const picked = (MENU.some(([k]) => k === raw) ? raw : back) as Key | null;
  const cur: Key = picked ?? "profil";
  const go = (k: Key) => setParams({ section: k }, { replace: false });
  const nDevices = (sessions?.length ?? 0) + (devices?.length ?? 0);
  const subs: Record<Key, string> = {
    profil: "pseudo, image" + (site.game === "retail" ? ", noms du jeu" : ""),
    securite: [user.email ? "e-mail" : null, "Battle.net", user.hasPassword ? "mot de passe" : null].filter(Boolean).join(", "),
    discord: user.discordUsername ? `lié · ${user.discordReminders ? "messages du bot" : "sans messages"}` : "non lié",
    appareils: `${sessions?.length ?? "…"} session${(sessions?.length ?? 0) > 1 ? "s" : ""}${devices?.length ? `, ${devices.length} appli` : ""}`,
    journal: "les 100 derniers événements",
    supprimer: "définitivement",
  };
  const sections: Record<Key, ReactNode> = {
    profil: <>
      <Profile name={user.displayName} onDone={refreshMe} />
      <Section title="Image du compte" hint="Visible par toi et les membres de tes guildes.">
        <ImageUpload title="Avatar" hint="PNG, JPEG ou WebP. Recadrée en 200 × 200, métadonnées supprimées." currentId={user.avatarId} round
          onUpload={async blob => { await uploadImage("/account/avatar", blob); await refreshMe(); }}
          onRemove={async () => { await del("/account/avatar"); await refreshMe(); }} />
      </Section>
      {site.game === "retail" && <GameLanguage pref={user.gameLang} onDone={refreshMe} />}
    </>,
    securite: <Security email={user.email} verified={user.emailVerified} battletag={user.battletag} hasPassword={user.hasPassword} hasBnet={user.hasBattlenet}
      bnetEnabled={!!me.data?.battlenetEnabled} canSet={!!user.email && user.emailVerified} onDone={refreshMe} />,
    discord: <DiscordLink username={user.discordUsername} reminders={user.discordReminders} enabled={!!me.data?.discordEnabled} onDone={refreshMe} />,
    appareils: <>
      <Sessions />
      <Devices />
      {site.game === "forever" && <GameRelay on={user.gameRelay} onDone={refreshMe} />}
    </>,
    journal: <AuditLog />,
    supprimer: <DeleteAccount hasPassword={user.hasPassword} />,
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div className="ph-t"><span className="eyebrow">Compte</span><h1>Compte et sécurité</h1></div>
        <Link className="link ac-priv" to="/confidentialite">Ce que le site garde sur toi <span aria-hidden="true">›</span></Link>
      </div>
      {params.get("bnet") === "linked" && <div className="alert ok">Ton compte Battle.net est maintenant lié.</div>}
      {params.get("discord") === "linked" && <div className="alert ok">Ton compte Discord est maintenant lié : tes clics dans le bot t'inscrivent avec tes persos.</div>}
      {DISCORD_ERROR[params.get("error") ?? ""] && <div className="alert error" role="alert">{DISCORD_ERROR[params.get("error")!]}</div>}
      <div className={`adm adm-f ac-page${picked ? " picked" : ""}`}>
        <nav className="adm-nav" aria-label="Sections du compte">
          {MENU.map(([k, l]) => (
            <button key={k} type="button" className={`${cur === k ? "on" : ""}${k === "supprimer" ? " bad" : ""}`} aria-current={cur === k ? "true" : undefined} onClick={() => go(k)}>
              <b>{l}</b>{k === "appareils" && nDevices > 0 && <span className="ac-n num">{nDevices}</span>}<small>{subs[k]}</small><span className="adm-go" aria-hidden="true">›</span>
            </button>
          ))}
        </nav>
        <div className="adm-body stack" style={{ gap: 16 }}>
          {picked && <button type="button" className="mp-back adm-back" onClick={() => setParams({}, { replace: false })}>← Compte</button>}
          {sections[cur]}
        </div>
      </div>
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
        <button className="btn" type="submit" style={{ justifySelf: "start" }}>Enregistrer</button>
      </form>
    </Section>
  );
}

/**
 * Connexion et sécurité : une ligne par moyen de connexion — E-mail (✓ confirmée, « Changer l'e-mail »), Battle.net (« Lier
 * Battle.net » en contour bleu), Mot de passe (« Changé le 24 sept. », formulaire actuel + nouveau avec un œil).
 */
function Security(p: { email: string | null; verified: boolean; battletag: string | null; hasPassword: boolean; hasBnet: boolean; bnetEnabled: boolean; canSet: boolean; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [mailOpen, setMailOpen] = useState(!p.email || !p.verified);
  const [pwOpen, setPwOpen] = useState(false);
  const a = useAction();
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => get<{ events: EventRow[] }>("/account/audit") }).data?.events;
  const changed = audit?.find(e => e.type === "password_changed" || e.type === "password_reset");
  return (
    <section className="panel pad stack ac-sec" aria-labelledby="ac-sec-t">
      <h3 id="ac-sec-t">Connexion et sécurité</h3>
      <div className="ac-row">
        <span className="ac-lab">E-mail</span>
        <span className="ac-val">{p.email ? <>{p.email} · {p.verified ? <b className="ac-ok">✓ confirmée</b> : <b className="ac-warn">à confirmer</b>}</> : "Aucune adresse"}</span>
        {p.email && p.verified && <button className="btn" type="button" aria-expanded={mailOpen} onClick={() => setMailOpen(o => !o)}>Changer l'e-mail</button>}
      </div>
      {/* Ajout, remplacement d'une adresse pas encore confirmée, ou changement */}
      {mailOpen && (
        <form className="ac-form" onSubmit={e => { e.preventDefault(); void a.run(async () => { const m = (await post<{ message: string }>("/account/email", { email })).message; setEmail(""); p.onDone(); return m; }); }}>
          {p.email && !p.verified && <p className="small" style={{ margin: 0 }}>Clique le lien reçu par e-mail pour la confirmer (regarde aussi dans les spams). Pas reçu, ou pas la bonne adresse ? Saisis-la ici : un nouveau lien part, l'ancien ne marche plus.</p>}
          <div className="row">
            <input type="email" required aria-label={p.email ? "Nouvelle adresse e-mail" : "Adresse e-mail"} placeholder="ton@adresse.fr" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" type="submit">{p.email ? "Envoyer le lien" : "Ajouter"}</button>
          </div>
        </form>
      )}
      <div className="ac-row">
        <span className="ac-lab">Battle.net</span>
        <span className="ac-val">{p.battletag ?? "Non lié · se connecter sans mot de passe"}</span>
        {p.hasBnet ? (
          <button className="link neg" type="button" disabled={!p.hasPassword} title={p.hasPassword ? "" : "Ajoute d'abord un mot de passe"}
            onClick={() => void a.run(async () => { await del("/auth/battlenet"); p.onDone(); return "Battle.net délié."; })}>Délier</button>
        ) : p.bnetEnabled ? (
          <button className="btn bnet-o" type="button" onClick={() => void a.run(async () => { const r = await post<{ url: string }>("/auth/battlenet/link"); window.location.assign(r.url); })}>Lier Battle.net</button>
        ) : <span className="small">Non configuré sur ce serveur</span>}
      </div>
      <div className="ac-row">
        <span className="ac-lab">Mot de passe</span>
        <span className="ac-val">{p.hasPassword ? (changed ? `Changé le ${DAY.format(new Date(changed.createdAt))}` : "Défini") : p.canSet ? "Aucun · connexion via Battle.net" : "Ajoute et confirme une adresse e-mail pour en définir un"}</span>
        {(p.hasPassword || p.canSet) && !pwOpen && <button className="btn" type="button" onClick={() => setPwOpen(true)}>{p.hasPassword ? "Changer le mot de passe" : "Définir un mot de passe"}</button>}
      </div>
      {pwOpen && <PasswordForm hasPassword={p.hasPassword} onClose={() => setPwOpen(false)} onDone={p.onDone} />}
      {a.view}
    </section>
  );
}

function PasswordForm({ hasPassword, onClose, onDone }: { hasPassword: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [cur, setCur] = useState(""), [next, setNext] = useState("");
  const a = useAction();
  return (
    <form className="ac-form stack" onSubmit={e => {
      e.preventDefault();
      void a.run(async () => {
        await post("/account/password", { currentPassword: hasPassword ? cur : undefined, newPassword: next });
        setCur(""); setNext(""); onDone(); void qc.invalidateQueries({ queryKey: ["audit"] }); void qc.invalidateQueries({ queryKey: ["sessions"] });
        return "Mot de passe modifié.";
      });
    }}>
      {hasPassword && <div className="fld"><label htmlFor="cp">Mot de passe actuel</label><PasswordInput id="cp" autoComplete="current-password" required value={cur} onChange={e => setCur(e.target.value)} /></div>}
      <div className="fld"><label htmlFor="np">Nouveau mot de passe</label>
        <PasswordInput id="np" autoComplete="new-password" minLength={12} maxLength={128} required value={next} onChange={e => setNext(e.target.value)} aria-describedby="np-rules" />
        <PasswordRules id="np-rules" value={next} /></div>
      {a.view}
      <div className="ac-foot">
        <span className="ac-warn">Tes autres appareils seront déconnectés.</span>
        <button className="btn" type="button" onClick={onClose}>Annuler</button>
        <button className="btn primary" type="submit">{hasPassword ? "Changer le mot de passe" : "Définir le mot de passe"}</button>
      </div>
    </form>
  );
}

const DISCORD_ERROR: Record<string, string> = {
  discord_cancelled: "Liaison Discord annulée.",
  discord_state: "La liaison Discord a expiré ou ne venait pas de ce navigateur. Réessaie.",
  discord_exchange: "Discord n'a pas répondu correctement. Réessaie dans un instant.",
  discord_session: "Ta session a changé pendant la liaison Discord. Recommence.",
  discord_taken: "Ce compte Discord est déjà lié à un autre compte.",
};

/** Liaison Discord : sert uniquement au bot d'inscription (pas de connexion au site via Discord). */
function DiscordLink({ username, reminders, enabled, onDone }: { username: string | null; reminders: boolean; enabled: boolean; onDone: () => void }) {
  const a = useAction();
  return (
    <Section title="Discord et messages" hint="Lie ton Discord pour t'inscrire aux raids depuis le bot avec tes persos. Le site ne reçoit que ton identifiant et ton pseudo Discord.">
      <div className="row between">
        <span><span className="lbl">Compte Discord</span><br />{username ? <b>{username}</b> : <span className="muted">Non lié</span>}</span>
        {username ? (
          <button className="btn ghost sm" type="button" onClick={() => void a.run(async () => { await del("/account/discord"); onDone(); return "Discord délié."; })}>Délier</button>
        ) : enabled ? (
          <button className="btn discord sm" type="button" onClick={() => void a.run(async () => { const r = await post<{ url: string }>("/auth/discord/link"); window.location.assign(r.url); })}>Lier Discord</button>
        ) : <span className="muted small">Non configuré sur ce serveur</span>}
      </div>
      {/* Signalement du 11/10 : Discord refuse l'autorisation tant que le compte Discord n'est pas vérifié */}
      {!username && enabled && <p className="hint" style={{ margin: 0 }}>Discord peut d'abord te demander de vérifier ton compte Discord (adresse e-mail confirmée chez Discord, regarde aussi dans les spams) : fais-le, puis clique à nouveau sur « Lier Discord ».</p>}
      {username && (
        <label className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
          <input type="checkbox" checked={reminders} style={{ width: "auto", marginTop: 3 }}
            onChange={e => { const on = e.target.checked; void a.run(async () => { await patch("/account/discord", { reminders: on }); onDone(); return on ? "Rappels activés." : "Rappels désactivés."; }); }} />
          <span>Messages privés du bot : rappel la veille des raids, relance si je n'ai pas répondu, demandes des officiers<br /><span className="hint">Avec des boutons pour répondre sans ouvrir le site.</span></span>
        </label>
      )}
      {a.view}
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

interface DeviceRow { id: string; name: string; platform: string; appVersion: string; createdAt: string; lastSeenAt: string; lastSyncAt: string | null }

/** Roster Companion (lot K1) : appareils reliés au compte. Section absente tant qu'il n'y en a pas. */
function Devices() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["devices"], queryFn: () => get<{ devices: DeviceRow[] }>("/devices") });
  const a = useAction();
  if (!data?.devices.length) return a.view;
  return (
    <section className="panel pad stack" id="appareils">
      <div><h3>Appareils reliés</h3><p className="hint" style={{ margin: "4px 0 0" }}>Roster Companion sur tes ordinateurs. Un appareil délié ne peut plus rien envoyer ni recevoir.</p></div>
      {a.view}
      <div className="tscroll"><table className="data">
        <thead><tr><th>Appareil</th><th>Relié le</th><th>Dernière synchro</th><th /></tr></thead>
        <tbody>{data.devices.map(d => (
          <tr key={d.id}>
            <td><strong>{d.name}</strong><div className="small muted">{[d.platform, d.appVersion && `appli ${d.appVersion}`].filter(Boolean).join(" · ")}</div></td>
            <td className="small">{fmt.format(new Date(d.createdAt))}</td>
            <td className="small">{d.lastSyncAt ? fmt.format(new Date(d.lastSyncAt)) : <span className="muted">pas encore</span>}</td>
            <td><button className="btn ghost sm" type="button" onClick={() => void a.run(async () => {
              await del(`/devices/${d.id}`);
              await Promise.all([qc.invalidateQueries({ queryKey: ["devices"] }), qc.invalidateQueries({ queryKey: ["audit"] })]);
              return `${d.name} délié.`;
            })}>Délier</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </section>
  );
}

function AuditLog() {
  const { data } = useQuery({ queryKey: ["audit"], queryFn: () => get<{ events: EventRow[] }>("/account/audit") });
  return (
    <Section title="Journal" hint="Les 100 derniers événements liés à ton compte.">
      <div className="tscroll" style={{ maxHeight: 420, overflowY: "auto" }}><table className="data">
        <thead><tr><th>Date</th><th>Événement</th><th>Adresse IP</th><th>Appareil</th></tr></thead>
        <tbody>{data?.events.map(e => {
          const [base, tone] = eventLabel(e.type);
          // Appareils (Roster Companion) : leur nom suit le libellé
          const label = e.type.startsWith("device_") && typeof e.meta.name === "string" ? `${base} : ${e.meta.name}` : base;
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
    <Section title="Supprimer le compte" hint="Supprime définitivement ton compte, tes personnages et tes sessions.">
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

/** Forever : mes inscriptions faites en jeu peuvent passer par un officier qui a Roster Companion (addon 1.6.3), activé d'office. */
function GameRelay({ on, onDone }: { on: boolean; onDone: () => void }) {
  const a = useAction();
  return (
    <Section title="Inscriptions faites en jeu" hint="Sans Roster Companion, ton addon confie tes inscriptions à un officier de ta guilde qui a l'appli : il les transmet au site.">
      <label className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
        <input type="checkbox" checked={on} style={{ width: "auto", marginTop: 3 }}
          onChange={e => { const gameRelay = e.target.checked; void a.run(async () => { await patch("/account/preferences", { gameRelay }); onDone(); return "Réglage enregistré."; }); }} />
        <span>Mes inscriptions faites en jeu peuvent passer par un officier<br /><span className="hint">Coupé : elles ne partent qu'avec ton export (copier-coller).</span></span>
      </label>
      {a.view}
    </Section>
  );
}

/** Roster : langue des noms du jeu (classes, spés, raids). Par défaut, celle du navigateur. */
function GameLanguage({ pref, onDone }: { pref: GameLangPref; onDone: () => void }) {
  const a = useAction();
  const nav = typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("fr") ? "français" : "anglais";
  const set = (gameLang: GameLangPref) => void a.run(async () => { await patch("/account/preferences", { gameLang }); onDone(); return "Enregistré."; });
  return (
    <Section title="Noms du jeu" hint="Classes, spés et raids de Roster : en français ou en anglais.">
      <div className="fld"><label htmlFor="gl">Langue</label>
        <select id="gl" value={pref} onChange={e => set(e.target.value as GameLangPref)}>
          <option value="auto">Comme mon navigateur ({nav})</option>
          <option value="fr">Français (Guerrier, Fureur)</option>
          <option value="en">English (Warrior, Fury)</option>
        </select></div>
      {a.view}
    </Section>
  );
}
