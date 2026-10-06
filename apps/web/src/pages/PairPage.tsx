import { normalizeUserCode } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, get, post } from "../api";
import { CompanionLogo } from "../components/Logo";

interface Pairing { code: string; name: string; platform: string; appVersion: string; ip: string | null; createdAt: string; expiresAt: string }

/** « à l'instant », « il y a 20 s », « il y a 3 min » */
function ago(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 5 ? "à l'instant" : s < 60 ? `il y a ${s} s` : `il y a ${Math.round(s / 60)} min`;
}

/**
 * Roster Companion (lot K1) : le joueur valide ici le code affiché par l'appli. Le lien de l'appli arrive avec le code
 * déjà rempli (choix de Flo) ; la page montre l'appareil et le code à comparer avant d'autoriser.
 */
export function PairPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const code = normalizeUserCode(params.get("code") ?? "");
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["pairing", code], enabled: !!code && !done, retry: false,
    queryFn: () => get<{ pairing: Pairing }>(`/devices/pair/${code}`),
  });
  const pairing = q.data?.pairing;

  const decide = async (approve: boolean) => {
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await post(`/devices/pair/${approve ? "approve" : "deny"}`, { code });
      setDone(approve ? "approved" : "denied");
      await Promise.all([qc.invalidateQueries({ queryKey: ["devices"] }), qc.invalidateQueries({ queryKey: ["audit"] })]);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Action impossible."); }
    finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeUserCode(typed);
    if (!c) { setError("Le code compte 8 lettres, par exemple KPTZ-RQMV."); return; }
    setError(null); setParams({ code: c }, { replace: true });
  };

  return (
    <div className="stack cp-page" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Compte</div><h1>Relier un appareil</h1></div></div>
      {done === "approved" && pairing && (
        <section className="panel pad stack cp-panel">
          <div className="alert ok" role="status"><strong>{pairing.name}</strong> est relié à ton compte. Retourne dans Roster Companion : la synchro démarre toute seule.</div>
          <p className="small" style={{ margin: 0 }}>Tu peux délier cet appareil à tout moment dans <Link to="/account#appareils">Compte &amp; sécurité</Link>.</p>
        </section>
      )}
      {done === "denied" && (
        <section className="panel pad stack cp-panel">
          <div className="alert info" role="status">Demande refusée : cet appareil ne peut pas se relier avec ce code.</div>
        </section>
      )}
      {!done && pairing && (
        <section className="panel pad stack cp-panel">
          <div className="cp-dev">
            <span className="cp-ico"><CompanionLogo size={26} /></span>
            <div><strong>Roster Companion</strong> sur <strong>{pairing.name}</strong>
              <div className="small muted">{[pairing.platform, pairing.appVersion && `appli ${pairing.appVersion}`, `demandé ${ago(pairing.createdAt)}`, pairing.ip && `depuis ${pairing.ip}`].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
          <div><div className="lbl">Le code affiché dans l'appli doit être</div><div className="cp-code num">{pairing.code}</div></div>
          <div className="cp-two">
            <div><strong className="small">Elle pourra</strong><ul><li>envoyer tes persos et les bilans de raid relevés par l'addon</li><li>recevoir les données de tes groupes pour le jeu</li><li>télécharger l'addon</li></ul></div>
            <div><strong className="small">Elle ne pourra pas</strong><ul><li>changer ton e-mail, ton mot de passe ou tes liaisons</li><li>gérer tes groupes et tes raids</li><li>voir tes sessions ou ton journal</li></ul></div>
          </div>
          <div className="alert cp-warn">Si tu n'as pas lancé Roster Companion toi-même, refuse : quelqu'un essaie de relier son appareil à ton compte.</div>
          {error && <div className="alert error" role="alert">{error}</div>}
          <div className="row">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void decide(true)}>Autoriser cet appareil</button>
            <button className="btn" type="button" disabled={busy} onClick={() => void decide(false)}>Refuser</button>
          </div>
        </section>
      )}
      {!done && !pairing && (
        <section className="panel pad stack cp-panel">
          {q.isLoading && code ? <p className="muted">Chargement…</p> : (
            <>
              {q.error && <div className="alert error" role="alert">{q.error instanceof ApiError ? q.error.message : "Code introuvable."}</div>}
              <p style={{ margin: 0 }}>Tape le code affiché par Roster Companion.</p>
              <form className="row" onSubmit={submit}>
                <input type="text" className="cp-input num" aria-label="Code d'appairage" placeholder="KPTZ-RQMV" autoComplete="off" spellCheck={false}
                  value={typed} onChange={e => setTyped(e.target.value)} maxLength={12} />
                <button className="btn primary" type="submit">Continuer</button>
              </form>
              {error && <div className="alert error" role="alert">{error}</div>}
              <p className="hint">Roster Companion est l'appli (en option) qui fait la synchro entre le jeu et le site sans copier-coller.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
