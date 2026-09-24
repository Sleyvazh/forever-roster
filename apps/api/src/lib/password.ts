import { hash, verify } from "@node-rs/argon2";
import { createHash } from "node:crypto";

/**
 * Argon2id, paramètres recommandés par l'OWASP (m=19 MiB, t=2, p=1).
 * https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 */
// algorithm: 2 = Argon2id (enum const non importable avec isolatedModules)
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try { return await verify(hashed, password); } catch { return false; }
}

/** Hash factice pour garder un temps de réponse constant quand le compte n'existe pas (anti-énumération). */
let dummy: Promise<string> | null = null;
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummy, password);
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "password1234", "motdepasse123", "azertyuiop12", "qwertyuiop12", "123456789012", "iloveyou1234",
  "worldofwarcraft", "warcraft1234", "azerty123456", "password12345", "administrator",
]);

export interface PasswordCheck { ok: boolean; reason?: string }

/** Règles locales : longueur (NIST SP 800-63B), liste noire, pas de réutilisation de l'e-mail. */
export function checkPasswordPolicy(password: string, email?: string | null): PasswordCheck {
  if (password.length < PASSWORD_MIN) return { ok: false, reason: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.` };
  if (password.length > PASSWORD_MAX) return { ok: false, reason: `Le mot de passe doit faire au plus ${PASSWORD_MAX} caractères.` };
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return { ok: false, reason: "Ce mot de passe est trop courant." };
  if (/^(.)\1+$/.test(password)) return { ok: false, reason: "Ce mot de passe est trop simple." };
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return { ok: false, reason: "Le mot de passe ne doit pas contenir ton adresse e-mail." };
  return { ok: true };
}

/**
 * Vérifie si le mot de passe apparaît dans une fuite connue (Have I Been Pwned, k-anonymity) :
 * seuls les 5 premiers caractères du SHA-1 quittent le serveur. En cas d'erreur réseau, on laisse passer.
 */
export async function isPwnedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5), suffix = sha1.slice(5);
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" }, signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some(line => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch { return false; }
}
