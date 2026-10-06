import { useEffect, useState } from "react";
import { call, errorText, type Settings, type Status } from "./api";
import { Toggle } from "./components";

export function Options({ s, onJournal }: { s: Status; onJournal: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[] | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinkWarning, setUnlinkWarning] = useState<string | null>(null);
  const set = async (patch: Partial<Settings>) => {
    setError(null);
    try { await call("set_settings", { settings: { ...s.settings, ...patch } }); } catch (e) { setError(errorText(e)); }
  };
  const n = s.settings.notifications;
  const forever = s.games.find(g => g.game === "forever");
  const foreverInstalls = s.installs.filter(i => i.game === "forever");
  const loadIgnored = async () => {
    try { setIgnored(await call<string[]>("ignored_list", { game: "forever" })); } catch (e) { setError(errorText(e)); }
  };
  const unignore = async (key: string) => {
    try { await call("unignore", { game: "forever", keys: [key] }); setIgnored(l => (l ?? []).filter(k => k !== key)); } catch (e) { setError(errorText(e)); }
  };
  const unlink = async () => {
    try { setUnlinkWarning(await call<string | null>("unlink")); } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      {error && <div className="alert bad">{error}</div>}
      <div className="opt">
        <div className="lbl">Démarrage</div>
        <label className="radio"><input type="radio" name="st" checked={s.settings.startup === "windows"} onChange={() => void set({ startup: "windows" })} /><span>Avec Windows</span><small>Toujours prête, icône près de l'horloge.</small></label>
        <label className="radio"><input type="radio" name="st" checked={s.settings.startup === "game"} onChange={() => void set({ startup: "game" })} /><span>Avec le jeu</span><small>Démarre avec Windows mais reste invisible jusqu'au lancement de WoW, puis icône près de l'horloge le temps de jouer.</small></label>
        <label className="radio"><input type="radio" name="st" checked={s.settings.startup === "manual"} onChange={() => void set({ startup: "manual" })} /><span>À la main</span><small>Rien ne démarre tout seul. Si tu oublies de l'ouvrir, les envois attendent la prochaine fois.</small></label>
      </div>
      <div className="opt">
        <div className="lbl">Synchro</div>
        <div className="sw"><span>Données du site relevées toutes les</span>
          <select aria-label="Délai entre deux relevés" value={s.settings.syncMinutes} onChange={e => void set({ syncMinutes: Number(e.target.value) as Settings["syncMinutes"] })}>
            <option value={1}>1 minute</option><option value={5}>5 minutes</option><option value={15}>15 minutes</option>
          </select></div>
        <p className="hint">Tes persos et bilans partent dès que le jeu écrit la sauvegarde de l'addon (déconnexion ou <code>/reload</code>).</p>
      </div>
      <div className="opt">
        <div className="lbl">Bouton ✕</div>
        <label className="radio"><input type="radio" name="cl" checked={s.settings.close === "hide"} onChange={() => void set({ close: "hide" })} /><span>Cache la fenêtre</span><small>L'appli continue près de l'horloge (Quitter : clic droit sur l'icône).</small></label>
        <label className="radio"><input type="radio" name="cl" checked={s.settings.close === "quit"} onChange={() => void set({ close: "quit" })} /><span>Quitte l'appli</span><small>La synchro s'arrête jusqu'au prochain lancement.</small></label>
      </div>
      <div className="opt">
        <div className="sw"><span className="lbl">Notifications Windows</span><Toggle label="Notifications Windows" checked={n.enabled} onChange={v => void set({ notifications: { ...n, enabled: v } })} /></div>
        {([["errors", "Synchro en attente (site injoignable…)"], ["unknown", "Nouveau perso à créer ou ignorer"], ["sent", "Envois au site (persos, bilans)"]] as const).map(([k, label]) => (
          <label key={k} className={`check${n.enabled ? "" : " dis"}`}><input type="checkbox" disabled={!n.enabled} checked={n[k]} onChange={e => void set({ notifications: { ...n, [k]: e.target.checked } })} /><span>{label}</span></label>
        ))}
      </div>
      <div className="opt">
        <div className="sw"><span className="lbl">Thème</span>
          <span className="tabs3" role="group" aria-label="Thème">
            {([["auto", "Auto"], ["light", "Clair"], ["dark", "Sombre"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={s.settings.theme === v} onClick={() => void set({ theme: v })}>{l}</button>)}
          </span></div>
      </div>
      <div className="opt">
        <div className="lbl">Dossier du jeu</div>
        <div className="small" style={{ display: "grid", gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Forever · <span className="mono">{forever?.install?.dirName ?? "introuvable"}</span></span>
            <button className="btn ghost sm" type="button" onClick={() => void call("pick_folder", { game: "forever" }).catch(e => setError(errorText(e)))}>Changer</button>
          </div>
          {foreverInstalls.length > 1 && (
            <select aria-label="Dossier de Forever" value={forever?.install?.path ?? ""} onChange={e => void call("use_install", { game: "forever", path: e.target.value }).catch(err => setError(errorText(err)))}>
              {foreverInstalls.map(i => <option key={i.path} value={i.path}>{i.path}</option>)}
            </select>
          )}
          <div className="row"><span>Retail · <span className="mono">{s.games.find(g => g.game === "retail")?.install?.dirName ?? "introuvable"}</span></span><span className="tag azure">Bientôt</span></div>
        </div>
      </div>
      <div className="opt">
        <div className="lbl">Persos ignorés</div>
        {ignored === null ? <button className="btn ghost sm" type="button" style={{ justifySelf: "start" }} onClick={() => void loadIgnored()}>Voir les persos ignorés</button>
          : ignored.length === 0 ? <p className="hint">Aucun perso ignoré.</p>
            : ignored.map(k => <div className="who" key={k}><span>{k}</span><span className="acts"><button className="btn ghost sm" type="button" onClick={() => void unignore(k)}>Ne plus ignorer</button></span></div>)}
      </div>
      <div className="opt">
        <div className="lbl">Compte</div>
        {unlinkWarning && <div className="alert warn">{unlinkWarning}</div>}
        <div className="small">Relié à <b>{s.device?.user || "ton compte"}</b> sur cet appareil (<b>{s.device?.name}</b>). Vaut pour Forever Roster et Roster.</div>
        {!confirmUnlink ? <button className="btn danger sm" type="button" style={{ justifySelf: "start" }} onClick={() => setConfirmUnlink(true)}>Délier cet appareil</button> : (
          <div className="alert warn">L'appli ne pourra plus rien envoyer ni recevoir, jusqu'au prochain appairage.
            <div className="row"><button className="btn danger sm" type="button" onClick={() => void unlink()}>Délier</button><button className="btn ghost sm" type="button" onClick={() => setConfirmUnlink(false)}>Annuler</button></div></div>
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="small muted">Version {s.version}</span>
        <button className="btn ghost sm" type="button" onClick={onJournal}>Journal</button>
      </div>
    </>
  );
}

export function Journal() {
  const [lines, setLines] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (lines === null) void call<string[]>("journal").then(setLines).catch(() => setLines([]));
  }, [lines]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(await call<string>("diagnostic")); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* presse-papiers refusé */ }
  };
  return (
    <>
      <p className="hint">Ce que l'appli a fait récemment. En cas de souci, copie le diagnostic et envoie-le : il ne contient ni mot de passe ni jeton.</p>
      <div className="journal">{(lines ?? []).length ? (lines ?? []).join("\n") : "Journal vide."}</div>
      <div className="row">
        <button className="btn primary sm" type="button" onClick={() => void copy()}>{copied ? "Diagnostic copié" : "Copier le diagnostic"}</button>
        <button className="btn ghost sm" type="button" onClick={() => setLines(null)}>Actualiser</button>
      </div>
    </>
  );
}
