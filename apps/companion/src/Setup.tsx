import { useEffect, useState } from "react";
import { call, errorText, type Game, type Install, type Status } from "./api";
import { Spinner, useClock } from "./components";

function Steps({ step }: { step: 1 | 2 | 3 }) {
  const cls = (n: number) => (n === step ? "on" : n < step ? "done" : "");
  return <div className="steps"><span className={cls(1)}>1 · Compte</span><span className={cls(2)}>2 · Jeu</span><span className={cls(3)}>3 · Prêt</span></div>;
}

/** Étape 1 : code d'appairage, validé sur le site (aucun mot de passe dans l'appli). */
export function Pairing({ s }: { s: Status }) {
  const p = s.pairing;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const start = async () => {
    setBusy(true); setError(null);
    try { await call("pair_start"); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  // Premier affichage : code demandé tout de suite
  useEffect(() => { if (!s.pairing) void start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = useClock();
  const left = p ? Math.max(0, p.expiresAt - clock) : 0;
  const copy = async () => {
    if (!p) return;
    try { await navigator.clipboard.writeText(p.userCode); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* presse-papiers refusé */ }
  };
  const over = p && ["denied", "expired", "error"].includes(p.status);

  return (
    <>
      <Steps step={1} />
      <div><h3 style={{ fontSize: 20 }}>Relie l'appli à ton compte</h3>
        <p className="hint" style={{ marginTop: 4 }}>Ouvre le site, connecte-toi si besoin, et vérifie que le code affiché est bien celui-ci.</p></div>
      {p && !over && <div className="code" aria-label="Code d'appairage">{p.userCode}</div>}
      {p && !over && (
        <>
          <button className="btn primary block" type="button" onClick={() => void call("open_url", { url: p.verifyUrl })}>Ouvrir le site pour valider</button>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="wait"><Spinner />En attente de validation…</div>
            <button className="btn ghost sm" type="button" onClick={() => void copy()}>{copied ? "Copié" : "Copier le code"}</button>
          </div>
          {p.message && <div className="alert warn">{p.message}</div>}
          <p className="hint">Le code expire dans <b className="mono">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>. L'appli ne te demandera jamais ton mot de passe.</p>
        </>
      )}
      {p?.status === "denied" && <div className="alert bad">Demande refusée sur le site. Si c'était une erreur, recommence.</div>}
      {p?.status === "expired" && <div className="alert warn">Le code a expiré avant d'être validé.</div>}
      {p?.status === "error" && <div className="alert bad">{p.message ?? "Appairage impossible."}</div>}
      {error && <div className="alert bad">{error}</div>}
      {(over || error || (!p && !busy)) && <button className="btn primary block" type="button" disabled={busy} onClick={() => void start()}>{busy ? "Demande en cours…" : "Nouveau code"}</button>}
      {!p && busy && <div className="wait"><Spinner />Demande d'un code au site…</div>}
    </>
  );
}

function InstallCard({ i, selected, onSelect }: { i: Install; selected: boolean; onSelect?: () => void }) {
  const label = i.game === "forever" ? "Forever" : i.game === "retail" ? "Retail" : "Non pris en charge";
  return (
    <div className={`inst${i.game !== "forever" ? " off" : ""}${selected ? " sel" : ""}`}>
      <div className="h">
        {onSelect && <input type="radio" checked={selected} onChange={onSelect} aria-label={`Utiliser ${i.dirName}`} />}
        <b>{label}</b>{i.test && <span className="small muted">bêta</span>}
        {i.game === "forever" ? <span className="tag ok">Trouvé</span> : i.game === "retail" ? <span className="tag azure">Bientôt</span> : <span className="tag">Ignoré</span>}
      </div>
      <div className="path">{i.path}</div>
      {i.game === "forever" && (
        <dl className="kv">
          {i.version && <><dt>Version</dt><dd className="mono">{i.version}</dd></>}
          <dt>Comptes WoW</dt><dd>{i.accounts}{i.saved > 0 ? ` (sauvegarde de l'addon trouvée)` : i.accounts ? " (pas encore de sauvegarde de l'addon)" : ""}</dd>
          <dt>Addon</dt><dd>{i.addonVersion ? <>Forever Roster {i.addonVersion} <span className="tag ok">Installé</span></> : <span className="tag bad">Absent</span>}</dd>
          <dt>Données</dt><dd>ForeverRoster_Data {i.dataAddon ? <span className="tag ok">Installé</span> : <span className="tag warn">À installer</span>}</dd>
        </dl>
      )}
      {i.game === "retail" && <p className="hint">Rien n'est envoyé tant que l'addon Retail n'existe pas.</p>}
    </div>
  );
}

/** Étape 2 : dossiers du jeu, installation de ForeverRoster_Data, première synchro. */
export function Folders({ s, onDone }: { s: Status; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const forever = s.games.find(g => g.game === "forever");
  const chosen = forever?.install?.path;
  const candidates = s.installs.filter(i => i.game === "forever");
  const others = s.installs.filter(i => i.game !== "forever");
  const pick = async (game: Game) => {
    setError(null);
    try { await call("pick_folder", { game }); } catch (e) { setError(errorText(e)); }
  };
  const finish = async () => {
    setBusy(true); setError(null);
    try { await call("finish_setup"); onDone(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Steps step={2} />
      <div><h3 style={{ fontSize: 20 }}>Dossiers du jeu</h3>
        <p className="hint" style={{ marginTop: 4 }}>Relié au compte <b>{s.device?.user || "?"}</b>. Vérifie les dossiers, puis termine.</p></div>
      {candidates.map(i => <InstallCard key={i.path} i={i} selected={i.path === chosen} onSelect={candidates.length > 1 ? () => void call("use_install", { game: "forever", path: i.path }) : undefined} />)}
      {candidates.length === 0 && <div className="alert warn">Aucun dossier de Forever trouvé. Choisis le dossier « World of Warcraft » qui contient <code>_classic_beta_</code> (ou <code>_classic_</code>).</div>}
      {others.map(i => <InstallCard key={i.path} i={i} selected={false} />)}
      <div className="row">
        <button className="btn ghost sm" type="button" onClick={() => void pick("forever")}>+ Ajouter un autre dossier</button>
        <button className="btn ghost sm" type="button" onClick={() => void call("rescan")}>Chercher de nouveau</button>
      </div>
      <div className="alert info">ForeverRoster_Data est un petit addon séparé où l'appli dépose les données du site (avec 20 copies pour les charger sans <code>/reload</code>, rangées sous « Roster Companion » dans la liste des addons du jeu). <b>Relance le jeu une fois</b> après l'installation : le jeu ne voit les nouveaux addons qu'à son lancement.</div>
      {error && <div className="alert bad">{error}</div>}
      <button className="btn primary block" type="button" disabled={busy || candidates.length === 0} onClick={() => void finish()}>{busy ? "Installation…" : "Installer et terminer"}</button>
    </>
  );
}

/** Étape 3 : prêt. */
export function Ready({ s, onClose }: { s: Status; onClose: () => void }) {
  const running = s.games.some(g => g.running);
  return (
    <>
      <Steps step={3} />
      <div><h3 style={{ fontSize: 20 }}>Tout est prêt</h3>
        <p className="hint" style={{ marginTop: 4 }}>La synchro est automatique : tu n'as plus rien à copier-coller.</p></div>
      <ul className="lines">
        <li><span className="ck">✓</span><span>Persos et bilans envoyés à chaque <code>/reload</code> ou déconnexion</span></li>
        <li><span className="ck">✓</span><span>Données du site relevées chaque minute pendant que tu joues (toutes les {s.settings.syncMinutes} min sinon), chargées par l'addon sans <code>/reload</code> aux moments utiles</span></li>
        <li><span className="ck">✓</span><span>{s.settings.startup === "manual" ? "Démarrage à la main" : "Démarre avec Windows"}, icône près de l'horloge (réglable dans les options)</span></li>
      </ul>
      {running && <div className="alert warn">Le jeu est lancé : <b>relance-le une fois</b> pour que l'addon voie ForeverRoster_Data.</div>}
      <button className="btn primary block" type="button" onClick={onClose}>C'est parti</button>
    </>
  );
}
