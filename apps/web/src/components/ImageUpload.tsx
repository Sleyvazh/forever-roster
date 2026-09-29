import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ApiError, imageUrl } from "../api";

const FRAME = 200;        // taille du cadre de recadrage à l'écran (px)
const EXPORT = 400;       // image envoyée (le serveur la réduit à 200×200)
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE = 15 * 1024 * 1024;

/** Image d'un compte ou d'un perso servie par l'API ; repli fourni si absente ou illisible. */
export function Portrait({ id, size, fallback, className }: { id: string | null | undefined; size: number; fallback?: ReactNode; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!id || failed === id) return <>{fallback ?? null}</>;
  return <img className={`portrait-img ${className ?? ""}`} src={imageUrl(id)} width={size} height={size} alt="" loading="lazy" decoding="async" onError={() => setFailed(id)} />;
}

/**
 * Choix d'une image + recadrage carré dans le navigateur (glisser pour cadrer, curseur pour zoomer).
 * Le serveur ré-encode ensuite l'image : rien de ce qui est envoyé n'est stocké tel quel.
 */
export function ImageUpload({ title, hint, currentId, onUpload, onRemove, round = false }: {
  title: string; hint: string; currentId: string | null; round?: boolean;
  onUpload: (blob: Blob) => Promise<unknown>; onRemove: () => Promise<unknown>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const base = nat ? Math.max(FRAME / nat.w, FRAME / nat.h) : 1;
  const dw = nat ? nat.w * base * zoom : FRAME, dh = nat ? nat.h * base * zoom : FRAME;
  const clamp = (p: { x: number; y: number }, w = dw, h = dh) => ({ x: Math.min(0, Math.max(FRAME - w, p.x)), y: Math.min(0, Math.max(FRAME - h, p.y)) });

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!ACCEPT.includes(f.type)) { setError("Formats acceptés : PNG, JPEG ou WebP."); return; }
    if (f.size > MAX_FILE) { setError("Fichier trop lourd (15 Mo maximum)."); return; }
    // Lecture en data: URL et non en blob: URL : la CSP du site (img-src 'self' data:) n'autorise pas blob:.
    const reader = new FileReader();
    reader.onload = () => { setSrc(String(reader.result)); setNat(null); setZoom(1); };
    reader.onerror = () => setError("Impossible de lire ce fichier.");
    reader.readAsDataURL(f);
  };

  const onError = () => { setSrc(null); setError("Image illisible : essaie un autre fichier (PNG, JPEG ou WebP)."); };

  const onLoad = () => {
    const el = imgRef.current; if (!el) return;
    const n = { w: el.naturalWidth, h: el.naturalHeight };
    const b = Math.max(FRAME / n.w, FRAME / n.h);
    setNat(n);
    setPos({ x: (FRAME - n.w * b) / 2, y: (FRAME - n.h * b) / 2 });
  };

  const setZoomKeepCenter = (z: number) => {
    const ratio = z / zoom;
    const c = FRAME / 2;
    setPos(p => clamp({ x: c - (c - p.x) * ratio, y: c - (c - p.y) * ratio }, nat!.w * base * z, nat!.h * base * z));
    setZoom(z);
  };

  const down = (e: PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
  const move = (e: PointerEvent) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })); };
  const up = () => { drag.current = null; };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 5;
    const m: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const v = m[e.key]; if (!v) return;
    e.preventDefault(); setPos(p => clamp({ x: p.x + v[0], y: p.y + v[1] }));
  };

  const save = async () => {
    const el = imgRef.current; if (!el || !nat) return;
    setBusy(true); setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = EXPORT;
      const k = EXPORT / FRAME;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(el, pos.x * k, pos.y * k, dw * k, dh * k);
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.92));
      if (!blob) throw new Error("export");
      await onUpload(blob);
      setSrc(null); setNat(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Envoi impossible.");
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(null);
    try { await onRemove(); } catch (e) { setError(e instanceof ApiError ? e.message : "Suppression impossible."); } finally { setBusy(false); }
  };

  return (
    <div className="upl">
      <div className="upl-head">
        <div><b>{title}</b><p className="hint" style={{ margin: "2px 0 0" }}>{hint}</p></div>
        {!src && <Portrait id={currentId} size={64} className={round ? "round" : ""} fallback={<span className={`upl-empty ${round ? "round" : ""}`} aria-hidden="true" />} />}
      </div>
      {src ? (
        <div className="upl-crop">
          <div className={`upl-frame ${round ? "round" : ""}`} tabIndex={0} role="img" aria-label="Aperçu du recadrage : glisse l'image ou utilise les flèches du clavier"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
            <img ref={imgRef} src={src} alt="" draggable={false} onLoad={onLoad} onError={onError}
              style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)`, visibility: nat ? "visible" : "hidden" }} />
          </div>
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <label className="fld"><span className="lbl">Zoom</span>
              <input type="range" min={1} max={4} step={0.01} value={zoom} disabled={!nat} onChange={e => setZoomKeepCenter(Number(e.target.value))} />
            </label>
            <p className="hint" style={{ margin: 0 }}>Glisse l'image pour cadrer la tête de ton perso. Elle sera enregistrée en 200 × 200.</p>
            <div className="row">
              <button type="button" className="btn primary sm" disabled={!nat || busy} onClick={() => void save()}>{busy ? "Envoi…" : "Enregistrer"}</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setSrc(null); setNat(null); if (inputRef.current) inputRef.current.value = ""; }}>Annuler</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="row">
          <label className="btn sm">
            {currentId ? "Changer l'image" : "Choisir une image"}
            <input ref={inputRef} type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={e => pick(e.target.files?.[0])} />
          </label>
          {currentId && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void remove()}>Retirer</button>}
        </div>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}
    </div>
  );
}
