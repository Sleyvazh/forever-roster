/**
 * Jeton d'invitation (lien /join#<jeton>) gardé 24 h dans ce navigateur (localStorage), avec l'e-mail saisi à la création
 * du compte : l'invitation survit à la confirmation de l'e-mail, ouverte dans un autre onglet. Effacé à l'acceptation,
 * ou au bout de 24 h. Lecture et écriture protégées : sans stockage (navigation privée…), le jeton reste dans l'onglet.
 */
const KEY = "fr-invite";
const TTL = 24 * 3600e3;

export interface PendingInvite { token: string; at: number; email?: string }

let memory: PendingInvite | null = null;

export function readInvite(): PendingInvite | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PendingInvite>;
      if (typeof v.token === "string" && v.token && typeof v.at === "number" && Date.now() - v.at < TTL) return { token: v.token, at: v.at, ...(typeof v.email === "string" && { email: v.email }) };
      localStorage.removeItem(KEY);
    }
  } catch { /* stockage indisponible : la copie de l'onglet */ }
  return memory && Date.now() - memory.at < TTL ? memory : null;
}

export function saveInvite(token: string, email?: string) {
  const prev = readInvite();
  memory = { token, at: prev?.token === token ? prev.at : Date.now(), ...(email ? { email } : prev?.token === token && prev.email ? { email: prev.email } : {}) };
  try { localStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* gardé pour cet onglet seulement */ }
}

export function clearInvite() {
  memory = null;
  try { localStorage.removeItem(KEY); } catch { /* rien à effacer */ }
}

/** Jeton d'un lien collé (« https://…/join#abc », « #abc » ou le jeton seul). */
export function tokenFromLink(text: string): string {
  const t = text.trim();
  const hash = t.indexOf("#");
  const raw = hash >= 0 ? t.slice(hash + 1) : /^[A-Za-z0-9_-]{16,}$/.test(t) ? t : "";
  return /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : "";
}
