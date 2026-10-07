import { useEffect, useState } from "react";
import { call, inTauri, onStatus, type Status } from "./api";
import { Spinner, TitleBar } from "./components";
import { demoScreen } from "./demo";
import { Main } from "./MainView";
import { Journal, Options } from "./Options";
import { Folders, Pairing, Ready } from "./Setup";

type View = "main" | "options" | "journal";

export function App() {
  const [s, setS] = useState<Status | null>(null);
  const [view, setView] = useState<View>(() => (!inTauri && (demoScreen === "options" || demoScreen === "journal") ? demoScreen : "main"));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stop = onStatus(setS);
    void call<Status>("get_status").then(setS);
    return stop;
  }, []);

  // Thème : celui du système, ou celui choisi dans les options
  const theme = s?.settings.theme ?? "auto";
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  if (!s) return <div className="win"><TitleBar /><div className="body"><div className="wait"><Spinner />Chargement…</div></div><div /></div>;

  let title = "Roster Companion";
  let back: (() => void) | undefined;
  let content;
  if (!s.device) content = <Pairing s={s} />;
  else if (!s.setupDone) content = <Folders s={s} onDone={() => setReady(true)} />;
  else if (ready) content = <Ready s={s} onClose={() => setReady(false)} />;
  else if (view === "options") { title = "Options"; back = () => setView("main"); content = <Options s={s} onJournal={() => setView("journal")} />; }
  else if (view === "journal") { title = "Journal"; back = () => setView("options"); content = <Journal />; }
  else content = <Main s={s} />;

  const inSetup = !s.device || !s.setupDone || ready;
  return (
    <div className="win">
      <TitleBar title={title} onBack={back} />
      <main className="body">{content}</main>
      <footer className="foot">
        {inSetup || view !== "main" ? (
          <><span>Roster Companion {s.version}</span><span>{s.device ? `Relié à ${s.device.user || "ton compte"}` : "Pas encore relié"}</span></>
        ) : (
          <>
            <button className="btn sm" type="button" title="Envoie ce que le jeu a écrit (à chaque /reload ou déconnexion) et relève le site" onClick={() => void call("sync_now")}>Synchroniser maintenant</button>
            <span className="row">
              <button className="btn ghost sm" type="button" onClick={() => void call("open_site", { game: "forever", path: "/" })}>Site</button>
              <button className="btn ghost sm" type="button" aria-label="Options" title="Options" onClick={() => setView("options")}>⚙</button>
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
