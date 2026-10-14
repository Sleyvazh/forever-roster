/**
 * Mises à jour de l'appli : bandeau « Version X disponible » (fenêtre principale) et bloc des options.
 * L'état vient de src-tauri/src/update.rs (commande update_status, événement « update ») ; rien n'est installé sans
 * clic, et jamais pendant que le jeu tourne.
 */
import { useEffect, useState } from "react";
import { ago, call, errorText, onUpdate, type UpdateView } from "./api";
import { Spinner } from "./components";

function useUpdate() {
  const [u, setU] = useState<UpdateView | null>(null);
  useEffect(() => {
    const stop = onUpdate(setU);
    void call<UpdateView>("update_status").then(setU).catch(() => { /* hors Tauri sans démo : rien à montrer */ });
    return stop;
  }, []);
  return u;
}

function useInstall() {
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setError(null);
    try { await call("install_update"); } catch (e) { setError(errorText(e)); }
  };
  return { install, error, setError };
}

function Progress({ u }: { u: UpdateView }) {
  return (
    <div className="wait"><Spinner />
      <span style={{ flex: 1 }}>Téléchargement{u.progress !== null ? ` · ${u.progress} %` : "…"}</span>
      {u.progress !== null && <span className="bar" aria-hidden="true"><i style={{ width: `${u.progress}%` }} /></span>}
    </div>
  );
}

/** Bandeau de la fenêtre principale : visible tant que « Plus tard » n'a pas été cliqué (jusqu'au prochain démarrage). */
export function UpdateBanner({ running }: { running: boolean }) {
  const u = useUpdate();
  const { install, error } = useInstall();
  if (!u?.available || u.dismissed) return null;
  const a = u.available;
  return (
    <section className="upd" aria-label="Mise à jour disponible">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Version {a.version} disponible</b>
        {a.date && <span className="small muted">{ago(a.date)}</span>}
      </div>
      {a.notes && <pre className="notes">{a.notes}</pre>}
      {u.installing ? <Progress u={u} /> : (
        <>
          <div className="row">
            <button className="btn primary sm" type="button" disabled={running} onClick={() => void install()}>Installer</button>
            <button className="btn ghost sm" type="button" onClick={() => void call("dismiss_update")}>Plus tard</button>
            {running && <span className="small muted">Ferme le jeu d'abord : l'installateur remplace l'appli.</span>}
          </div>
          <p className="hint">L'installateur est vérifié (signature) avant d'être lancé, puis l'appli redémarre toute seule.</p>
        </>
      )}
      {error && !u.installing && <div className="alert bad">{error}</div>}
    </section>
  );
}

/** Bloc des options : version actuelle, dernière vérification, « Vérifier maintenant ». */
export function UpdateOptions({ running }: { running: boolean }) {
  const u = useUpdate();
  const { install, error, setError } = useInstall();
  const [checkError, setCheckError] = useState<string | null>(null);
  const check = async () => {
    setCheckError(null); setError(null);
    try { await call("check_update"); } catch (e) { setCheckError(errorText(e)); }
  };
  if (!u) return null;
  const checked = u.lastCheck ? `vérifiée ${ago(u.lastCheck)}` : "pas encore vérifiée";
  return (
    <div className="opt">
      <div className="lbl">Mises à jour</div>
      {!u.keyConfigured ? (
        <div className="alert info">Mises à jour : clé de signature pas encore configurée. L'appli ne vérifie rien pour l'instant ; les nouvelles versions sont dans l'onglet Actions du dépôt.</div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="small">Version <b>{u.current}</b> · {u.checking ? "vérification…" : checked}</span>
            <button className="btn ghost sm" type="button" disabled={u.checking || u.installing} onClick={() => void check()}>Vérifier maintenant</button>
          </div>
          {u.available ? (
            u.installing ? <Progress u={u} /> : (
              <div className="row">
                <span className="small">Version <b>{u.available.version}</b> disponible.</span>
                <button className="btn primary sm" type="button" disabled={running} onClick={() => void install()}>Installer</button>
                {running && <span className="small muted">Ferme le jeu d'abord.</span>}
              </div>
            )
          ) : u.lastCheck && !u.checking && !u.error ? <p className="hint">Tu as la dernière version.</p> : null}
          {(checkError ?? error) && <div className="alert bad">{checkError ?? error}</div>}
          {!checkError && !error && u.error && !u.installing && <p className="hint">Dernier essai : {u.error}.</p>}
        </>
      )}
      <p className="hint">Vérification au démarrage, puis une fois par jour. Rien n'est envoyé : l'appli lit seulement la liste des versions sur GitHub, et n'installe rien sans ton accord.</p>
    </div>
  );
}
