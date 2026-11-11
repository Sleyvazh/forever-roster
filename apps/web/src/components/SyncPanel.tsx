import { foreignAddonErrors, parseCharacterExports, parseGuildExports, parseRaidLogs, parseRRB, type CharacterExport, type GuildExport, type RaidLogEncounter, type RaidLogExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, get, type Character } from "../api";
import { ALL_PARTS, blockKey, blockSummary, guessTarget, importOnServer, PARTS, type ApplyResult, type Part, type Target } from "../addonImport";
import { flushAutosaves } from "../autosave";
import { GUILD_QUERY_ROOTS } from "../guild";
import { useMyGuilds } from "../nav";
import { useSite } from "../site";
import { isStale, onOpenSync, openSync, rememberedSyncKey, rememberSyncKey, syncState } from "../syncPanel";
import { copyGameData } from "./CopyForGame";
import { DialogHead, Modal } from "./Dialog";
import { CharName } from "./GuildRace";
import { ClassIcon } from "./Icons";
import { t, tn, tx } from "../i18n";
import { addonTextError } from "../i18n/game";
import { ClassDot } from "./Outings";

/**
 * Bouton « Synchro » de la barre du haut et son panneau (refonte du 09/11, lot 1, maquette maquette-synchro.png).
 * - Vers le site : trois étapes, une zone de collage active dès l'ouverture, l'état de mes persos ; Ctrl+V sur n'importe
 *   quelle page (hors champ) ouvre aussi le panneau. Le collage donne un aperçu, rien n'est enregistré avant le bouton
 *   (choix de Flo) ; fermer pendant l'aperçu demande confirmation.
 * - Vers le jeu (officiers, et tous les joueurs de Roster) : Roster Companion d'abord, « Copier pour le jeu » en secours.
 *   Un membre de Forever garde « Copier pour le jeu » en lien discret en bas du panneau.
 * Roster (WoW Retail) : seuls les bilans de raid (RRB) passent du jeu au site ; un texte de l'autre addon est signalé.
 */

/** Collage dans un champ de saisie : on laisse faire (c'est du texte tapé ou collé exprès). */
const typing = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
const ADDON_TEXT = /^\s*(FR[CBL]|RRB);/;

/** Bilan lu dans le collage : FRB (Forever Roster) ou RRB (Roster, avec les rencontres de boss). */
type PastedLog = RaidLogExport & { encounters?: RaidLogEncounter[] };

/** « Torvin », « Torvin et Torva », « Torvin, Torva et Grakh ». */
const joinNames = (list: string[]) => (list.length > 1 ? t("{list} et {last}", { list: list.slice(0, -1).join(", "), last: list.at(-1)! }) : list[0] ?? "");
const Keys = ({ k }: { k: string[] }) => <span className="sy-keys">{k.map((x, i) => <span key={x}>{i > 0 && "+"}<kbd>{x}</kbd></span>)}</span>;

/** Bouton de la barre du haut : point orange quand un perso déjà synchronisé ne l'est plus depuis 7 jours (Forever). */
export function SyncButton() {
  const forever = useSite().game === "forever";
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 }).data?.characters ?? [];
  // Comme le rappel de l'Accueil : seulement les persos déjà synchronisés une fois (sans addon, on ne réclame rien)
  const late = forever ? chars.filter(c => c.cls && c.addonSyncedAt && isStale(c.addonSyncedAt)).length : 0;
  return (
    <button type="button" className="btn sm sync-btn" aria-haspopup="dialog" onClick={openSync}
      aria-label={late ? tn(late, "Synchro : {n} perso à mettre à jour", "Synchro : {n} persos à mettre à jour") : t("Synchro")} title={late ? tn(late, "{n} perso pas synchronisé depuis 7 jours", "{n} persos pas synchronisés depuis 7 jours") : t("Synchro avec l'addon")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9M4 13a8 8 0 0 0 14.3 4.9" /><path d="M5 3v4h4M19 21v-4h-4" /></svg>
      <span>{t("Synchro")}</span>{late > 0 && <i className="sdot warn" aria-hidden="true" />}
    </button>
  );
}

interface Device { id: string; name: string; lastSyncAt: string | null }

export function SyncPanel() {
  const qc = useQueryClient();
  const site = useSite();
  const retail = site.game === "retail";
  let otherHost: string | undefined;
  try { otherHost = site.other ? new URL(site.other.origin).host : undefined; } catch { otherHost = undefined; }
  const loc = useLocation();
  const guilds = useMyGuilds().data?.groups ?? [];
  const officer = guilds.some(g => g.role !== "member");
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const mine = chars.data?.characters ?? [];
  const mineRef = useRef<Character[]>([]);
  mineRef.current = mine;

  const [open, setOpen] = useState(false);
  const [way, setWay] = useState<"site" | "game">("site");
  const [pasted, setPasted] = useState("");
  const [blocks, setBlocks] = useState<CharacterExport[]>([]);
  const [logs, setLogs] = useState<PastedLog[]>([]);
  const [skipLogs, setSkipLogs] = useState<Set<string>>(new Set());
  const [guildBlocks, setGuildBlocks] = useState<GuildExport[]>([]);
  const [skipGuild, setSkipGuild] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [changing, setChanging] = useState<Set<string>>(new Set());
  const [parts, setParts] = useState<Set<Part>>(new Set(ALL_PARTS));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [key, setKey] = useState<string | null>(() => rememberedSyncKey());
  const zone = useRef<HTMLTextAreaElement>(null);
  /** Page où le panneau a été ouvert (collage, bouton). */
  const openedAt = useRef("");

  // Roster : un joueur sans rôle d'officier n'a rien à coller (persos par Battle.net) : le panneau s'ouvre sur « Vers le jeu »
  const canPaste = !retail || officer;
  const reset = useCallback(() => {
    setPasted(""); setBlocks([]); setLogs([]); setSkipLogs(new Set()); setGuildBlocks([]); setSkipGuild(false); setErrors([]);
    setTargets({}); setChanging(new Set()); setResults(null); setConfirmClose(false);
  }, []);

  /** Texte collé (zone du panneau ou Ctrl+V n'importe où) : lu dans le navigateur, montré en aperçu. */
  const read = useCallback((text: string) => {
    reset();
    openedAt.current = window.location.pathname;
    setOpen(true); setWay("site");
    setPasted(text);
    if (!ADDON_TEXT.test(text)) {
      setErrors([retail
        ? t("Ce texte ne vient pas de l'addon Roster : en jeu, /roster, onglet Synchro (ou ta touche), puis Ctrl+C.")
        : t("Ce texte ne vient pas de l'addon : en jeu, ta touche de synchro, puis Ctrl+C sans cliquer dans le texte.")]);
      return;
    }
    if (retail) {
      const rrb = parseRRB(text, { otherHost });
      setLogs(rrb.data);
      setErrors(rrb.errors.map(x => (x.startsWith("Ce texte vient") ? addonTextError(x) : t("Bilan ignoré : {x}", { x: addonTextError(x) }))));
      return;
    }
    const raid = parseRaidLogs(text);
    setLogs(raid.data);
    const errs = [...foreignAddonErrors(text, "forever", otherHost).map(addonTextError), ...raid.errors.map(x => t("Bilan ignoré : {x}", { x: addonTextError(x) }))];
    if (/(^|\n)\s*FRL;/.test(text)) {
      const g = parseGuildExports(text);
      setGuildBlocks(g.data); errs.push(...g.errors.map(x => t("Relevé de guilde ignoré : {x}", { x: addonTextError(x) })));
    }
    if (/(^|\n)\s*FRC;/.test(text)) {
      const r = parseCharacterExports(text);
      if (r.ok) {
        setBlocks(r.data); errs.push(...r.errors.map(x => t("Bloc ignoré : {x}", { x: addonTextError(x) })));
        const k = r.data.find(d => d.syncKey)?.syncKey;
        if (k) { rememberSyncKey(k); setKey(k); }
      } else errs.push(addonTextError(r.error));
    }
    setErrors(errs);
  }, [reset, retail, otherHost]);

  // Ctrl+V sur n'importe quelle page (hors champ) : le panneau s'ouvre avec l'aperçu
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!ADDON_TEXT.test(text)) return;
      e.preventDefault();
      read(text);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [read]);
  // Bouton Synchro, Accueil, fiche : ouverture sur la zone de collage (ou Vers le jeu pour un joueur de Roster)
  useEffect(() => onOpenSync(() => { openedAt.current = window.location.pathname; setOpen(true); setWay(canPaste ? "site" : "game"); }), [canPaste]);
  // Changement de page : le panneau reste ouvert seulement s'il attend un clic (aperçu) ; après une réussite, il se referme.
  // Ouvert sur la nouvelle page (Ctrl+V juste après le clic d'un lien, avant cet effet) : il reste.
  useEffect(() => {
    if (window.location.pathname === openedAt.current) return;
    if (!pasted || results) { setOpen(false); if (results) reset(); }
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const stage = results ? "done" : pasted ? "preview" : "wait";
  useEffect(() => { if (open && stage === "wait" && way === "site") zone.current?.focus(); }, [open, stage, way]);

  const targetOf = (d: CharacterExport) => targets[blockKey(d)] ?? guessTarget(d, mine);
  const count = blocks.filter(d => targetOf(d) !== "skip").length;
  const fresh = blocks.filter(d => targetOf(d) === "new").length;
  const logsToSave = logs.filter(l => !skipLogs.has(l.raidId));
  const guildsToSend = skipGuild ? 0 : guildBlocks.length;
  const total = count + logsToSave.length + guildsToSend;
  const newOnes = fresh === 1 ? blocks.find(d => targetOf(d) === "new")?.name ?? "" : tn(fresh, "{n} fiche", "{n} fiches");
  const applyLabel = [
    count - fresh ? tn(count - fresh, "Mettre à jour {n} perso", "Mettre à jour {n} persos") : "",
    fresh ? (count - fresh ? t("et créer {what}", { what: newOnes }) : t("Créer {what}", { what: newOnes })) : "",
    logsToSave.length > 1 ? (count ? t("et les {n} bilans", { n: logsToSave.length }) : t("Enregistrer les {n} bilans", { n: logsToSave.length }))
      : logsToSave.length ? (count ? t("et le bilan") : t("Enregistrer le bilan")) : "",
    guildsToSend ? (count || logsToSave.length ? t("et le relevé de guilde") : t("Envoyer le relevé de guilde")) : "",
  ].filter(Boolean).join(" ") || t("Rien à mettre à jour");

  const apply = async () => {
    setBusy(true); setConfirmClose(false);
    await flushAutosaves(); // une modification de la fiche encore en attente part avant l'import, pas après
    let out: ApplyResult[];
    try {
      out = await importOnServer(pasted, Object.fromEntries(blocks.map(d => [blockKey(d), targetOf(d)])), parts, [...skipLogs], skipGuild);
    } catch (e) {
      out = [{ name: t("Mise à jour"), ok: false, msg: e instanceof ApiError ? e.message : t("mise à jour impossible : vérifie ta connexion, puis recolle le texte.") }];
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["character"] }),
      qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] }), qc.invalidateQueries({ queryKey: ["week"] }),
      qc.invalidateQueries({ queryKey: ["raid"] }), qc.invalidateQueries({ queryKey: ["attendance"] }), ...GUILD_QUERY_ROOTS.map(k => qc.invalidateQueries({ queryKey: [k] }))]);
    setResults(out); setBusy(false);
  };
  const close = () => { setOpen(false); setConfirmClose(false); if (stage !== "preview") reset(); };
  /** Fermer pendant l'aperçu : le texte collé serait perdu, on demande. */
  const requestClose = () => { if (stage === "preview" && total > 0 && !busy) setConfirmClose(true); else { setOpen(false); reset(); } };
  useEffect(() => {
    if (!open || confirmClose) return;
    // preventDefault : sinon Chrome passe la même touche Échap à la fenêtre de confirmation qui vient de s'ouvrir, et la referme
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); requestClose(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });

  if (!open) return null;
  const showWays = canPaste && (officer || retail) && stage === "wait";
  return (
    <>
      <div className="sy-scrim" onClick={requestClose} aria-hidden="true" />
      <aside className="sy-panel" role="dialog" aria-modal="true" aria-labelledby="sy-t">
        <div className="sy-head">
          <h2 id="sy-t">{t("Synchro")}</h2>
          <button type="button" className="sy-x" aria-label={t("Fermer la synchro")} onClick={requestClose}>✕</button>
        </div>
        {showWays && (
          <div className="seg sy-ways" role="group" aria-label={t("Sens de la synchro")}>
            <button type="button" className={way === "site" ? "on" : ""} aria-pressed={way === "site"} onClick={() => setWay("site")}>{t("Vers le site")}</button>
            <button type="button" className={way === "game" ? "on" : ""} aria-pressed={way === "game"} onClick={() => setWay("game")}>{t("Vers le jeu")}</button>
          </div>
        )}
        {stage === "wait" && (way === "game" || !canPaste ? <ToGame retail={retail} officer={officer} /> : (
          <>
            <p className="sy-sub">{retail ? t("Envoyer le bilan d'un raid depuis l'addon Roster") : t("Mettre à jour mes persos depuis le jeu")}</p>
            <ol className="sy-steps">
              <li><span className="n">1</span>{retail ? <span>{tx("En jeu : {el}, onglet Synchro (ou ta touche de synchro)", { el: <code>/roster</code> })}</span>
                : key ? <span>{t("En jeu : ta touche de synchro")} <kbd>{key}</kbd></span>
                  : <span>{t("En jeu : ta touche de synchro, ou clic droit sur le bouton FR de la minicarte")}</span>}</li>
              <li><span className="n">2</span><span><Keys k={["Ctrl", "C"]} /> {t(": le texte est déjà sélectionné")}</span></li>
              <li><span className="n">3</span><span>{tx("{keys} ici", { keys: <Keys k={["Ctrl", "V"]} /> })}</span></li>
            </ol>
            <label className="sy-drop">
              <span className="sy-drop-t">{t("Colle ici le texte de l'addon")}</span>
              <Keys k={["Ctrl", "V"]} />
              <span className="sy-drop-s">{t("marche aussi sur n'importe quelle page")}</span>
              <textarea ref={zone} aria-label={t("Coller le texte de l'addon")} value="" spellCheck={false}
                onChange={() => { /* seul le collage compte */ }}
                onPaste={(e: ReactClipboardEvent<HTMLTextAreaElement>) => { e.preventDefault(); read(e.clipboardData.getData("text/plain")); }} />
            </label>
            {!retail && <MyChars chars={mine} />}
            {!retail && !officer && (
              <div className="sy-foot">
                <span>{t("Données du site absentes en jeu ?")}</span>
                <CopyButton link />
              </div>
            )}
            {!retail && <Link className="sy-link" to="/addon" onClick={close}>{t("Installer ou mettre à jour l'addon ›")}</Link>}
          </>
        ))}

        {stage === "preview" && (
          <>
            {total > 0 && <p className="sy-sub">{t("Aperçu ·")} {[
              blocks.length ? tn(blocks.length, "{n} perso reconnu", "{n} persos reconnus") : "",
              logs.length ? tn(logs.length, "{n} bilan", "{n} bilans") : "",
              guildBlocks.length ? t("relevé de guilde") : "",
            ].filter(Boolean).join(" · ")}</p>}
            {total > 0 && <p className="sy-warn">{t("Rien n'est encore enregistré.")}</p>}
            {errors.map(e => <ErrorBox key={e} msg={e} onAddon={close} />)}
            {guildBlocks.length > 0 && (
              <ul className="sy-rows">{guildBlocks.map(g => (
                <li key={`${g.name}-${g.realm}-${g.faction}`}>
                  <label className="sy-check"><input type="checkbox" checked={!skipGuild} onChange={() => setSkipGuild(v => !v)} />
                    <span><b>{tx("Relevé de la guilde {name}", { name: g.name })}</b><small>{guildSummary(g)}</small></span></label>
                </li>
              ))}</ul>
            )}
            {logs.length > 0 && (
              <ul className="sy-rows">{logs.map(l => (
                <li key={l.raidId}>
                  <label className="sy-check"><input type="checkbox" checked={!skipLogs.has(l.raidId)}
                    onChange={() => setSkipLogs(s => { const n = new Set(s); if (n.has(l.raidId)) n.delete(l.raidId); else n.add(l.raidId); return n; })} />
                    <span><b>{t("Bilan de {name}", { name: l.raidName || t("raid") })}</b><small>{logSummary(l)} · {t("relevé par {by}", { by: l.recorder || "?" })}</small></span></label>
                </li>
              ))}</ul>
            )}
            {blocks.length > 0 && (
              <ul className="sy-rows" aria-label={t("Persos reconnus")}>{blocks.map(d => {
                const k = blockKey(d), tt = targetOf(d);
                const fiche = mine.find(c => c.id === tt);
                const candidates = mine.filter(c => (!c.cls || !d.cls || c.cls === d.cls));
                const pick = (v: Target) => setTargets(s => ({ ...s, [k]: v }));
                return (
                  <li key={k} className="sy-char">
                    {d.cls ? <ClassIcon cls={d.cls} size={26} /> : <span className="sy-ic" />}
                    <span className="sy-ct"><b>{d.name}</b>
                      <small className={tt === "new" ? "warn" : undefined}>{tt === "new" ? t("Nouveau perso") : tt === "skip" ? t("Ignoré") : fiche && fiche.name !== d.name ? `${t("Fiche {name}", { name: fiche.name })} · ${blockSummary(d)}` : blockSummary(d)}</small></span>
                    {tt !== "new" && tt !== "skip" && !changing.has(k) && (
                      <button type="button" className="sy-mini" onClick={() => setChanging(s => new Set(s).add(k))} aria-label={t("Changer la fiche de {name}", { name: d.name })}>{t("Changer")}</button>
                    )}
                    {(tt === "new" || tt === "skip") && (
                      <div className="sy-pair" role="group" aria-label={t("{name} : créer ou ignorer", { name: d.name })}>
                        <button type="button" className={tt === "new" ? "on" : ""} aria-pressed={tt === "new"} onClick={() => pick("new")}>{t("Créer sa fiche")}</button>
                        <button type="button" className={tt === "skip" ? "on" : ""} aria-pressed={tt === "skip"} onClick={() => pick("skip")}>{t("Ignorer")}</button>
                      </div>
                    )}
                    {(changing.has(k) || ((tt === "new" || tt === "skip") && candidates.length > 0)) && (
                      <select className="sy-sel" aria-label={t("Fiche pour {name}", { name: d.name })} value={tt === "new" || tt === "skip" ? "" : tt}
                        onChange={e => pick(e.target.value || "new")}>
                        <option value="">{tt === "new" || tt === "skip" ? t("ou relier à une fiche…") : t("Choisir une fiche")}</option>
                        {mine.map(c => <option key={c.id} value={c.id} disabled={!!(d.cls && c.cls && c.cls !== d.cls)}>{c.name}</option>)}
                        <option value="new">{t("Nouvelle fiche")}</option>
                        <option value="skip">{t("Ignorer")}</option>
                      </select>
                    )}
                  </li>
                );
              })}</ul>
            )}
            {blocks.length > 0 && (
              <details className="sy-parts">
                <summary>{t("Choisir quoi importer")} {parts.size < ALL_PARTS.size && <span className="tag warn">{parts.size}/{ALL_PARTS.size}</span>}</summary>
                <div className="ai-parts">
                  {PARTS.map(([p, label]) => (
                    <label key={p} className="ai-part">
                      <input type="checkbox" checked={parts.has(p)} onChange={() => setParts(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} />
                      <span>{t(label)}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            {total > 0 && (
              <button type="button" className="btn primary sy-go" disabled={busy || (count > 0 && !parts.size && !logsToSave.length && !guildsToSend)} onClick={() => void apply()}>
                {busy ? t("Mise à jour…") : applyLabel}
              </button>
            )}
            {retail && logs.length > 0 && <p className="sy-note">{t("Un officier de la guilde (ou le créateur du raid) enregistre le bilan ; un nouveau collage remplace le précédent.")}</p>}
            <button type="button" className="sy-link mid" onClick={() => { reset(); setWay("site"); }}>{t("Coller un autre texte")}</button>
          </>
        )}

        {stage === "done" && results && <Done results={results} blocks={blocks} retail={retail} syncKey={key} onClose={close} onAgain={() => { reset(); setWay("site"); }} />}
      </aside>

      {confirmClose && (
        <Modal label="sy-close-t" onClose={() => setConfirmClose(false)}>
          <div className="gd-body">
            <DialogHead id="sy-close-t" title={t("Fermer sans mettre à jour tes persos ?")} onClose={() => setConfirmClose(false)} />
            <p style={{ margin: 0 }}>{t("Le texte collé sera oublié.")}</p>
            <div className="sy-confirm">
              <button type="button" className="btn primary" onClick={() => void apply()}>{applyLabel}</button>
              <button type="button" className="btn" onClick={() => { setOpen(false); reset(); }}>{t("Fermer sans mettre à jour")}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Mes persos et l'âge de leur dernière synchro (vert, ou orange à 7 jours et plus). */
function MyChars({ chars }: { chars: Character[] }) {
  const list = chars.filter(c => c.cls);
  if (!list.length) return null;
  return (
    <div className="sy-mine">
      <span className="lbl">{t("Mes persos")}</span>
      <ul>{list.slice(0, 8).map(c => {
        const s = syncState(c.addonSyncedAt);
        return (
          <li key={c.id}><ClassDot cls={c.cls} /><CharName name={c.name} cls={c.cls} as="span" />
            <span className={`sy-age ${s.tone}`}>● {s.tone === "ok" ? t("À jour · {ago}", { ago: s.ago ?? "" }) : s.ago ? s.label : t("Jamais synchronisé")}</span></li>
        );
      })}</ul>
    </div>
  );
}

/** Un refus du site, avec ce qu'il faut faire (mettre l'addon à jour, recopier en jeu…). */
function ErrorBox({ msg, onAddon }: { msg: string; onAddon: () => void }) {
  const addon = /addon|scell|seal|version|ancien|too old/i.test(msg) && !/^(Ce texte vient|This text comes)/.test(msg);
  return (
    <div className="sy-err" role="alert">
      <b>✕ {msg}</b>
      {addon && <Link className="btn sm" to="/addon" onClick={onAddon}>{t("Mettre à jour l'addon")}</Link>}
    </div>
  );
}

/** Réussite : ce qui est à jour, et le geste pour la prochaine fois. */
function Done({ results, blocks, retail, syncKey, onClose, onAgain }: { results: ApplyResult[]; blocks: CharacterExport[]; retail: boolean; syncKey: string | null; onClose: () => void; onAgain: () => void }) {
  const ok = results.filter(x => x.ok === true), bad = results.filter(x => x.ok === false);
  const names = new Set(blocks.map(b => b.name));
  const charsOk = ok.filter(x => names.has(x.name));
  const title = bad.length ? tn(bad.length, "{n} mise à jour impossible", "{n} mises à jour impossibles")
    : charsOk.length ? tn(charsOk.length, "{n} perso à jour", "{n} persos à jour")
    : ok.length ? t("Envoyé au site") : results.some(x => x.ok === null) ? t("Reçu par le site") : t("Rien de mis à jour");
  return (
    <div className="sy-done">
      <div className={`sy-win${bad.length ? " bad" : ""}`} role="status" aria-label={t("Résultat de la synchro")}>
        <span className="ck" aria-hidden="true">{bad.length ? "!" : "✓"}</span>
        <b>{title}</b>
        {charsOk.length > 0 && <span>{joinNames(charsOk.map(x => x.name))}</span>}
      </div>
      <ul className="sy-results">
        {results.map(x => (
          <li key={x.name} className={x.ok === null ? "info" : x.ok ? "ok" : "bad"}><b>{x.ok === false ? "✕" : "●"} {x.name}</b> · {x.msg}
            {x.groups?.map(g => <span key={g.id}> · <Link to={`/groups/${g.id}/membres`} onClick={onClose}>{g.name} › {t("Membres")}</Link></span>)}</li>
        ))}
        {results.length === 0 && <li>{t("Rien de mis à jour.")}</li>}
      </ul>
      {!retail && charsOk.length > 0 && <Link className="btn sy-go" to="/persos" onClick={onClose}>{t("Voir mes persos")}</Link>}
      {retail || !charsOk.length ? <button type="button" className="btn sy-go" onClick={onClose}>{t("Fermer")}</button> : null}
      {!retail && (
        <p className="sy-next">{tx("La prochaine fois : {key}, {copy} puis {paste}", { key: syncKey ? <kbd>{syncKey}</kbd> : t("ta touche de synchro"), copy: <Keys k={["Ctrl", "C"]} />, paste: <Keys k={["Ctrl", "V"]} /> })}</p>
      )}
      <button type="button" className="sy-link mid" onClick={onAgain}>{t("Coller un autre texte")}</button>
    </div>
  );
}

/** Vers le jeu : Roster Companion d'abord (Forever), « Copier pour le jeu » en secours. */
function ToGame({ retail, officer }: { retail: boolean; officer: boolean }) {
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => get<{ devices: Device[] }>("/devices"), enabled: !retail && officer }).data?.devices ?? [];
  return (
    <div className="sy-game">
      {!retail && officer && (devices.length ? (
        <div className="sy-comp ok">
          <b>{t("Roster Companion · relié")}</b>
          {devices.map(d => {
            const s = d.lastSyncAt ? syncState(d.lastSyncAt) : null;
            return <span key={d.id}>{d.name} · {s ? <span className="ok">{tx("● données envoyées en jeu {ago}", { ago: s.ago })}</span> : t("pas encore de synchro")}</span>;
          })}
          <span>{t("La guilde reçoit les données du site de toi, sans copier-coller.")}</span>
        </div>
      ) : (
        <div className="sy-comp">
          <b>{t("Roster Companion n'est pas installé")}</b>
          <span>{t("Avec l'appli, toute la guilde reçoit les données du site sans copier-coller : un ou deux officiers suffisent.")}</span>
          <Link className="btn sm" to="/addon">{t("Télécharger Roster Companion")}</Link>
        </div>
      ))}
      <div className="sy-copy">
        <b>{retail ? t("Copier pour le jeu") : officer ? t("Sans l'appli") : t("Copier pour le jeu")}</b>
        <span>{retail ? t("Raids à venir et inscriptions de tes guildes, pour l'addon Roster.") : t("Raids à venir, patrons et BiS recherchés de tes guildes.")}</span>
        <CopyButton />
        <span>{tx("Puis en jeu : {where}, et {paste}.", { where: retail ? tx("{cmd}, onglet Synchro", { cmd: <code>/roster</code> }) : t("ta touche de synchro"), paste: <Keys k={["Ctrl", "V"]} /> })}</span>
      </div>
    </div>
  );
}

/** « Copier pour le jeu » : le texte est demandé au serveur pendant le clic. */
function CopyButton({ link = false }: { link?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const click = async () => {
    setState("busy");
    try { await copyGameData(); setState("ok"); } catch { setState("err"); }
    window.setTimeout(() => setState("idle"), 2500);
  };
  const label = state === "ok" ? t("Copié : colle en jeu") : state === "err" ? t("Copie impossible : réessaie") : state === "busy" ? t("Copie…") : t("Copier pour le jeu");
  return (
    <button type="button" className={link ? "sy-link" : `btn copy-game${state === "ok" ? " done" : ""}`} onClick={() => void click()} disabled={state === "busy"} aria-live="polite">
      {label}{link && state === "idle" && " ›"}
    </button>
  );
}

/** « 14 membres · journal (61 événements) · relevé par Morwen Cendrevoile ». */
function guildSummary(g: GuildExport) {
  const parts: string[] = [];
  if (g.roster) parts.push(g.roster.complete ? tn(g.roster.members.length, "{n} membre", "{n} membres") : tn(g.roster.members.length, "{n} membre sur {total}", "{n} membres sur {total}", { total: g.roster.total }));
  if (g.journal) parts.push(tn(g.journal.events.length, "journal ({n} événement)", "journal ({n} événements)"));
  if (g.levels.length) parts.push(tn(g.levels.length, "{n} niveau noté", "{n} niveaux notés"));
  const by = g.roster?.by || g.journal?.by;
  if (by) parts.push(t("relevé par {by}", { by: by }));
  return parts.join(" · ") || t("rien de relevé");
}

/** « 18 présents · 4 objets · 3 boss vaincus » (les boss : bilan de Roster). */
function logSummary(l: PastedLog) {
  const parts = [tn(l.attendees.length, "{n} présent", "{n} présents"), tn(l.loot.length, "{n} objet", "{n} objets")];
  if (l.encounters) {
    const kills = new Set(l.encounters.filter(e => e.killed).map(e => e.encounterId || e.boss)).size;
    parts.push(tn(kills, "{n} boss vaincu", "{n} boss vaincus"));
  }
  return parts.join(" · ");
}
