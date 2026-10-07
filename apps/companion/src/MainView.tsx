import { useState } from "react";
import { ago, atLeast, call, CLASS_FR, errorText, hhmm, when, type GameView, type Status } from "./api";
import { Box, Dot, Mark } from "./components";

const STATUS_TEXT: Record<string, string> = { kept: "gardé : celui du chef de raid", refused: "refusé", ignored: "ignoré", skipped: "ignoré", unknown: "inconnu du site" };

function StateLine({ s, g }: { s: Status; g: GameView }) {
  if (s.pausedUntil) {
    return (
      <div className="state"><Dot state="paused" /><div style={{ flex: 1 }}><b>Synchro en pause</b><small>jusqu'à {when(s.pausedUntil, s.now)}</small></div>
        <button className="btn sm" type="button" onClick={() => void call("pause", { minutes: null })}>Reprendre</button></div>
    );
  }
  if (!g.install) {
    return <div className="state"><Dot state="error" /><div><b>Dossier du jeu introuvable</b><small>Choisis-le dans les options.</small></div></div>;
  }
  if (g.lastError) {
    return (
      <div className="state"><Dot state="warn" /><div><b>{/ne répond pas|connexion|délai/.test(g.lastError) ? "Site injoignable" : "Synchro en attente"}</b>
        <small>{g.retryAt ? `Nouvel essai à ${hhmm(g.retryAt)} · rien n'est perdu` : g.lastError}</small></div></div>
    );
  }
  return g.running
    ? <div className="state"><Dot state="active" /><div><b>{g.label} lancé · synchro active</b><small>Site relevé chaque minute · envoi au /reload ou à la déconnexion</small></div></div>
    : <div className="state"><Dot state="idle" /><div><b>Jeu fermé · en veille</b><small>Données du site relevées toutes les {s.settings.syncMinutes} min</small></div></div>;
}

function Unknown({ g }: { g: GameView }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!g.unknown.length) return null;
  const act = async (create: string[], ignore: string[], id: string) => {
    setBusy(id); setError(null);
    try { await call("resolve_unknown", { game: g.game, create, ignore }); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  return (
    <Box title={g.unknown.length > 1 ? "Nouveaux persos" : "Nouveau perso"} attn>
      <p className="hint">Le site ne connaît pas encore {g.unknown.length > 1 ? "ces persos" : "ce perso"}. Un perso ignoré n'est plus proposé (réversible dans les options).</p>
      {g.unknown.map(u => (
        <div className="who" key={u.key}>
          <span className={`nm c-${u.cls ?? ""}`}>{u.name}</span>
          <span className="small muted">{[u.cls && CLASS_FR[u.cls], u.level && `niv. ${u.level}`].filter(Boolean).join(" · ")}</span>
          <span className="acts">
            <button className="btn primary sm" type="button" disabled={!!busy} onClick={() => void act([u.key], [], u.key)}>Créer la fiche</button>
            <button className="btn sm" type="button" disabled={!!busy} onClick={() => void act([], [u.key], u.key)}>Ignorer</button>
          </span>
        </div>
      ))}
      {g.unknown.length > 1 && <button className="btn ghost sm" type="button" style={{ justifySelf: "start" }} disabled={!!busy} onClick={() => void act(g.unknown.map(u => u.key), [], "all")}>Créer toutes les fiches</button>}
      {error && <div className="alert bad">{error}</div>}
    </Box>
  );
}

function Manual({ g }: { g: GameView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!g.manual.length) return null;
  const act = async (cmd: "send_manual" | "dismiss_manual", key: string) => {
    setBusy(true); setError(null);
    try { await call(cmd, { game: g.game, key }); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Box title="Bilan à envoyer à la main" attn>
      <p className="hint">Tu ne menais pas ce raid : le site garde le bilan du chef de raid. Envoie le tien seulement si le chef n'a pas l'appli (il remplacera le bilan du site).</p>
      {g.manual.map(m => (
        <div className="who" key={m.key}>
          <span className="nm">{m.label.replace(/^bilan de /, "Bilan de ")}</span>
          <span className="acts">
            <button className="btn sm" type="button" disabled={busy} onClick={() => void act("send_manual", m.key)}>Envoyer</button>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void act("dismiss_manual", m.key)}>Ne pas envoyer</button>
          </span>
        </div>
      ))}
      {error && <div className="alert bad">{error}</div>}
    </Box>
  );
}

function Forever({ s, g }: { s: Status; g: GameView }) {
  const i = g.install;
  return (
    <>
      <StateLine s={s} g={g} />
      {g.restartNeeded && <div className="alert warn">ForeverRoster_Data vient d'être installé : <b>relance le jeu une fois</b> pour que l'addon le voie.</div>}
      {g.readError && <div className="alert bad">{g.readError}</div>}
      <Unknown g={g} />
      <Manual g={g} />
      <Box title="Vers le site" dir="↑" when={g.lastPush ? `${when(g.lastPush, s.now)}` : "rien d'envoyé"}>
        {g.history.length > 0 ? (
          <ul className="lines">
            {g.history.slice(0, 6).map((h, n) => (
              <li key={`${h.at}-${n}`} title={h.message}><Mark status={h.status} /><span>{h.label}{h.status !== "updated" && h.status !== "created" ? ` · ${STATUS_TEXT[h.status] ?? h.message}` : h.status === "created" ? " · fiche créée" : ""}</span><span className="r">{ago(h.at, s.now)}</span></li>
            ))}
          </ul>
        ) : <p className="hint">Rien d'envoyé pour l'instant : l'appli envoie dès que le jeu écrit la sauvegarde de l'addon (déconnexion ou <code>/reload</code>).</p>}
        {g.queue > 0 && <p className="hint">{g.queue} en attente d'envoi.</p>}
        {g.running && g.history.length > 0 && <p className="hint">Jeu lancé : ce que tu fais en jeu (inscriptions, persos) part au prochain <code>/reload</code> (« Synchroniser » ou « Envoyer maintenant » dans l'addon) ou à la déconnexion. « Synchroniser maintenant » envoie seulement ce que le jeu a déjà écrit.</p>}
        {g.queueErrors.map(e => <div className="alert bad" key={e}>{e}</div>)}
      </Box>
      <Box title="Vers le jeu" dir="↓" when={g.lastPull ? `à jour ${ago(g.lastPull, s.now)}` : "pas encore relevé"}>
        {g.groups.length > 0 ? (
          <ul className="lines">
            {g.groups.map(gr => <li key={gr.name}><span className="ck">✓</span><span>Groupe {gr.name} : {gr.raids} raid{gr.raids > 1 ? "s" : ""}, {gr.patterns} patron{gr.patterns > 1 ? "s" : ""} suivi{gr.patterns > 1 ? "s" : ""}, {gr.bis} BiS</span></li>)}
          </ul>
        ) : <p className="hint">{g.hasFrg ? "Aucun groupe sur le site pour ce jeu." : "Données des groupes pas encore relevées."}</p>}
        {atLeast(i?.addonVersion, "1.5.1")
          ? <p className="hint">Chargé à la connexion, puis tout seul sans <code>/reload</code> : à l'ouverture de la fenêtre de l'addon, 30 et 5 min avant un raid, à l'appel, en entrant en raid et au moins toutes les heures. À la demande : « Charger les nouveautés » ou sa touche. 20 fois par session, puis l'addon propose de recharger l'interface.</p>
          : atLeast(i?.addonVersion, "1.4")
            ? <p className="hint">Chargé à la connexion, et sans <code>/reload</code> avec « Charger les nouveautés » (onglet Synchro de l'addon). Mets l'addon à jour (1.5.1) pour que ça se fasse tout seul.</p>
            : <p className="hint">Chargé à la prochaine connexion ou au prochain <code>/reload</code>. Avec l'addon 1.5.1, les nouveautés arrivent toutes seules, sans <code>/reload</code>.</p>}
      </Box>
      <Box title="Addon">
        <ul className="lines">
          <li>{i?.addonVersion ? <><span className="ck">✓</span><span>Forever Roster {i.addonVersion}</span><span className="r">installé</span></> : <><span className="ck b">✕</span><span>Forever Roster absent</span><span className="r"><button className="btn ghost sm" type="button" onClick={() => void call("open_site", { game: g.game, path: "/addon" })}>Le télécharger</button></span></>}</li>
          <li>{i?.dataAddon ? <><span className="ck">✓</span><span>ForeverRoster_Data</span><span className="r">installé</span></> : <><span className="ck w">…</span><span>ForeverRoster_Data</span><span className="r">installé à la prochaine synchro</span></>}</li>
        </ul>
      </Box>
    </>
  );
}

export function Main({ s }: { s: Status }) {
  const [tab, setTab] = useState<"forever" | "retail">("forever");
  const g = s.games.find(x => x.game === tab)!;
  return (
    <>
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "forever"} onClick={() => setTab("forever")}>Forever</button>
        <button type="button" role="tab" aria-selected={tab === "retail"} className="rt" onClick={() => setTab("retail")}>Retail <span className="tag azure">Bientôt</span></button>
      </div>
      {tab === "forever" ? <Forever s={s} g={g} /> : (
        <>
          <div className="state"><Dot state="idle" /><div><b>Retail · bientôt</b><small>L'addon Retail n'existe pas encore</small></div></div>
          <Box title="Roster">
            <p className="hint">{g.install ? <>Le dossier <code>{g.install.dirName}</code> est trouvé. </> : null}Dès que l'addon Retail sortira, l'appli fera la synchro avec roster.sleyvazh.fr, avec le même compte.</p>
          </Box>
        </>
      )}
    </>
  );
}
