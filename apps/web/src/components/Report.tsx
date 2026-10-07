import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError, get, post, uploadImage, type Report, type ReportArea, type ReportKind, type ReportStatus } from "../api";
import { useMe } from "../auth";
import { useSite } from "../site";

/**
 * « Signaler un bug ou une idée » : formulaire en fenêtre (menu du compte), capture d'écran jointe
 * (fichier, glisser-déposer ou Ctrl+V), page, navigateur, site et version de l'addon ajoutés d'office.
 */

export const KIND_LABEL: Record<ReportKind, string> = { bug: "Bug", idea: "Idée", question: "Question" };
export const KIND_ICON: Record<ReportKind, string> = { bug: "🐞", idea: "💡", question: "❓" };
export const AREA_LABEL: Record<ReportArea, string> = { site: "Site", addon: "Addon", bot: "Bot Discord", companion: "Companion" };
export const STATUS_LABEL: Record<ReportStatus, string> = { new: "Nouveau", wip: "En cours", done: "Fait", refused: "Refusé" };
export const STATUS_TAG: Record<ReportStatus, string> = { new: "gold", wip: "warn", done: "ok", refused: "" };

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIDE = 1600;                // le serveur garde au plus 1600 px de côté
const MAX_SEND = 1.9 * 1024 * 1024;   // sous la limite d'envoi du site (2 Mo)
const PLACEHOLDER: Record<ReportKind, { title: string; body: string }> = {
  bug: { title: "Ex. Le bouton « Valider la compo » ne fait rien", body: "Ce que tu faisais, ce qui s'est passé, et ce que tu attendais." },
  idea: { title: "Ex. Trier les persos par niveau d'objet", body: "Ce que tu aimerais, et à quoi ça te servirait." },
  question: { title: "Ex. Comment lier un salon Discord ?", body: "Ta question, avec le contexte utile." },
};

/** « Firefox 131 · Windows », comme sur la page des admins. */
export function browserOf(ua: string): string {
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  // Dans l'ordre : Edge et Opera se disent aussi « Chrome », Chrome se dit aussi « Safari »
  const found = ([["Edge", /Edg\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /Firefox\/(\d+)/], ["Chrome", /Chrome\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/]] as const)
    .map(([name, re]) => [name, re.exec(ua)?.[1]] as const).find(([, v]) => v);
  return [found && `${found[0]} ${found[1]}`, os].filter(Boolean).join(" · ");
}

const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
export const reportDate = (iso: string) => fmt.format(new Date(iso));

/** Réponses pas encore lues (pastille sur l'avatar). */
export function useUnseenReports(enabled: boolean) {
  return useQuery({ queryKey: ["reports-unseen"], queryFn: () => get<{ n: number }>("/reports/unseen"), enabled, staleTime: 60_000, refetchInterval: 5 * 60_000 }).data?.n ?? 0;
}

/** Capture réduite dans le navigateur (1600 px max, WebP sinon JPEG) : aperçu en data: URL (CSP) et fichier à envoyer. */
async function shrink(file: Blob): Promise<{ preview: string; blob: Blob }> {
  const src = await new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error("read"));
    r.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error("decode")); img.src = src; });
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k)); canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const encode = (type: string, q: number) => new Promise<Blob | null>(ok => canvas.toBlob(ok, type, q));
  let blob = await encode("image/webp", 0.85);
  if (!blob || blob.type !== "image/webp" || blob.size > MAX_SEND) blob = await encode("image/jpeg", 0.8);
  if (blob && blob.size > MAX_SEND) blob = await encode("image/jpeg", 0.6);
  if (!blob || blob.size > MAX_SEND) throw new Error("size");
  return { preview: canvas.toDataURL("image/jpeg", 0.7), blob };
}

/** Fenêtre « Signaler un bug ou une idée ». */
export function ReportDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const me = useMe();
  const site = useSite();
  const loc = useLocation();
  const qc = useQueryClient();
  // Page d'où l'on signale (sans la partie après « ? » : elle peut contenir un jeton)
  const [page] = useState(loc.pathname);
  const [kind, setKind] = useState<ReportKind>("bug");
  const [area, setArea] = useState<ReportArea>(loc.pathname.startsWith("/addon") ? "addon" : "site");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState<{ preview: string; blob: Blob } | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ imageError: string | null } | null>(null);
  const browser = browserOf(navigator.userAgent);
  const addon = me.data?.user?.addonVersion;

  // Fenêtre modale native (focus piégé, Échap) ; la retirer de la page suffit à la fermer
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);

  const pick = async (f: Blob | null | undefined) => {
    setShotError(null);
    if (!f) return;
    if (!ACCEPT.includes(f.type)) { setShotError("Formats acceptés : PNG, JPEG ou WebP."); return; }
    try { setShot(await shrink(f)); }
    catch { setShotError("Image illisible ou trop lourde : essaie une autre capture."); }
  };
  const onPaste = (e: ClipboardEvent) => {
    const item = [...e.clipboardData.items].find(i => i.kind === "file" && ACCEPT.includes(i.type));
    if (!item) return;
    e.preventDefault();
    void pick(item.getAsFile());
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); void pick(e.dataTransfer.files[0]); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { report } = await post<{ report: Report }>("/reports", { kind, area, title, body, page });
      let imageError: string | null = null;
      if (shot) {
        try { await uploadImage(`/reports/${report.id}/image`, shot.blob); }
        catch (err) { imageError = err instanceof ApiError ? err.message : "Envoi impossible."; }
      }
      void qc.invalidateQueries({ queryKey: ["reports-mine"] });
      void qc.invalidateQueries({ queryKey: ["reports-admin"] });
      setDone({ imageError });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi impossible, réessaie dans un instant.");
    } finally { setBusy(false); }
  };

  return (
    <dialog ref={ref} className="sg-dialog" aria-labelledby="sg-title" onClose={onClose} onPaste={onPaste}>
      {done ? (
        <div className="stack">
          <h2 id="sg-title">Merci !</h2>
          <p>Ton signalement est parti chez l'équipe. Sa réponse apparaîtra dans <b>Mes signalements</b>, avec une pastille sur ton avatar.</p>
          {done.imageError && <div className="alert error" role="alert">La capture n'a pas pu être jointe : {done.imageError}</div>}
          <div className="row sg-actions">
            <Link className="btn" to="/signalements" onClick={() => ref.current?.close()}>Voir mes signalements</Link>
            <button type="button" className="btn primary" onClick={() => ref.current?.close()}>Fermer</button>
          </div>
        </div>
      ) : (
        <form className="stack" onSubmit={e => void submit(e)}>
          <div className="row between sg-head">
            <h2 id="sg-title">Signaler un bug ou une idée</h2>
            <button type="button" className="btn ghost sm" aria-label="Fermer" onClick={() => ref.current?.close()}>✕</button>
          </div>
          <div className="sg-two">
            <div className="fld">
              <span className="lbl" id="sg-kind">C'est…</span>
              <div className="seg" role="group" aria-labelledby="sg-kind">
                {(Object.keys(KIND_LABEL) as ReportKind[]).map(k => (
                  <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_ICON[k]} {KIND_LABEL[k]}</button>
                ))}
              </div>
            </div>
            <div className="fld">
              <span className="lbl" id="sg-area">Ça concerne</span>
              <div className="seg" role="group" aria-labelledby="sg-area">
                {(Object.keys(AREA_LABEL) as ReportArea[]).map(a => (
                  <button key={a} type="button" className={area === a ? "on" : ""} aria-pressed={area === a} onClick={() => setArea(a)}>{a === "bot" ? "Bot" : AREA_LABEL[a]}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="fld">
            <label htmlFor="sg-t">Titre</label>
            <input id="sg-t" type="text" required minLength={3} maxLength={120} value={title} placeholder={PLACEHOLDER[kind].title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="sg-b">Détails</label>
            <textarea id="sg-b" required minLength={5} maxLength={4000} value={body} placeholder={PLACEHOLDER[kind].body} onChange={e => setBody(e.target.value)} />
          </div>
          <div className="fld">
            <span className="lbl">Capture d'écran (facultative)</span>
            {shot ? (
              <div className="sg-shot-on">
                <img src={shot.preview} alt="Capture jointe" />
                <button type="button" className="btn ghost sm" onClick={() => setShot(null)}>Retirer</button>
              </div>
            ) : (
              <div className="sg-drop" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
                <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>Choisir une image</button>
                <span className="hint">ou glisse-la ici, ou colle-la avec Ctrl+V (Windows : Win+Maj+S pour capturer)</span>
                <input ref={fileRef} type="file" accept={ACCEPT.join(",")} hidden onChange={e => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            )}
            {shotError && <span className="small" style={{ color: "var(--bad)" }} role="alert">{shotError}</span>}
          </div>
          <p className="hint sg-auto">
            Joint automatiquement : la page (<code>{page}</code>){browser && <>, ton navigateur ({browser})</>}, le site ({site.name})
            {addon ? <>, ta version de l'addon ({addon}, vue au dernier import)</> : null}.
          </p>
          {error && <div className="alert error" role="alert">{error}</div>}
          <div className="row sg-actions">
            <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Annuler</button>
            <button type="submit" className="btn primary" disabled={busy}>{busy ? "Envoi…" : "Envoyer"}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/** Étiquettes d'un signalement : type, partie concernée, site, statut. */
export function ReportTags({ r, otherSite }: { r: Report; otherSite?: boolean }) {
  return (
    <span className="row sg-tags">
      <span className="tag">{KIND_ICON[r.kind]} {KIND_LABEL[r.kind]}</span>
      <span className="tag">{AREA_LABEL[r.area]}</span>
      {otherSite && <span className="tag">{r.game === "retail" ? "Roster" : "Forever Roster"}</span>}
      <span className={`tag ${STATUS_TAG[r.status]}`}>{STATUS_LABEL[r.status]}</span>
    </span>
  );
}

/** Capture d'un signalement (servie par le site, visible par son auteur et les admins). */
export function ReportShot({ id }: { id: string }) {
  const url = `/api/reports/${id}/image`;
  return <a className="sg-thumb" href={url} target="_blank" rel="noreferrer" title="Ouvrir la capture en grand"><img src={url} alt="Capture jointe" loading="lazy" /></a>;
}
