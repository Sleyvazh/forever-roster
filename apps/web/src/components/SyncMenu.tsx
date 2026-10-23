import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { get, type Character } from "../api";
import { CopyForGame, copyGameData } from "./CopyForGame";
import { CharName } from "./GuildRace";
import { ClassDot } from "./Outings";

/**
 * Synchro de l'addon dans la barre du haut (Forever, refonte du 23/10) : « Copier pour le jeu » garde son clic ; la flèche
 * ouvre l'état de chaque perso et le geste en deux lignes. Le point passe à l'orange quand un perso n'a pas été synchronisé
 * depuis 7 jours. Caché sur téléphone : on synchronise depuis le PC.
 */
const STALE_MS = 7 * 86400e3;

function ago(at: string | null | undefined) {
  if (!at) return { text: "jamais", cls: "warn" };
  const h = (Date.now() - Date.parse(at)) / 3600e3;
  const d = Math.floor(h / 24);
  return { text: h < 1 ? "à l'instant" : h < 24 ? `il y a ${Math.floor(h)} h` : d === 1 ? "hier" : `il y a ${d} j`, cls: h < 24 ? "ok" : d >= 7 ? "warn" : "" };
}
const K = ({ k }: { k: string[] }) => <>{k.map((x, i) => <span key={x}>{i > 0 && "+"}<kbd>{x}</kbd></span>)}</>;

export function SyncMenu() {
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 }).data?.characters ?? [];
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "err">("idle");
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>(".sync-more")?.focus(); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const synced = chars.filter(c => c.cls);
  const stale = synced.some(c => !c.addonSyncedAt || Date.now() - Date.parse(c.addonSyncedAt) > STALE_MS);
  const label = !synced.length ? "Synchro de l'addon" : stale ? "Synchro : un perso n'est pas à jour" : "Synchro à jour";
  const copy = async () => {
    try { await copyGameData(); setCopied("ok"); } catch { setCopied("err"); }
    window.setTimeout(() => setCopied("idle"), 2500);
  };
  return (
    <div className="sync" ref={ref}>
      <CopyForGame />
      <button type="button" className="btn sm sync-more" aria-haspopup="dialog" aria-expanded={open} aria-controls="sync-pop" aria-label={`État de la synchro : ${label}`}
        title={label} onClick={() => setOpen(o => !o)}>
        <i className={`sdot${stale || !synced.length ? " warn" : ""}`} aria-hidden="true" /><span className="chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="sync-pop" id="sync-pop" role="dialog" aria-label="Synchro de l'addon">
          <h3>Synchro de l'addon</h3>
          <div className="sp-way"><span className="lbl">Du site vers le jeu</span>
            <div className="row"><button type="button" className="btn primary sm" onClick={() => void copy()}>{copied === "ok" ? "Copié : colle en jeu" : copied === "err" ? "Copie impossible" : "Copier pour le jeu"}</button></div>
            <p>En jeu : ta touche de synchro, puis <K k={["Ctrl", "V"]} />.</p></div>
          <div className="sp-way"><span className="lbl">Du jeu vers le site</span>
            <p>En jeu : ta touche de synchro, puis <K k={["Ctrl", "C"]} />. Ici : <K k={["Ctrl", "V"]} />, sur n'importe quelle page.</p></div>
          {synced.length > 0 && (
            <ul className="sp-chars" aria-label="Dernière synchro de tes persos">{synced.map(c => {
              const a = ago(c.addonSyncedAt);
              return <li key={c.id}><ClassDot cls={c.cls} /><CharName name={c.name} cls={c.cls} as="span" /><span className={`mc-sync ${a.cls}`}>{a.text}</span></li>;
            })}</ul>
          )}
          <div className="sp-foot"><Link className="link" to="/addon">Installer ou mettre à jour l'addon</Link></div>
        </div>
      )}
    </div>
  );
}
