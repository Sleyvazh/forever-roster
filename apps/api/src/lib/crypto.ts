import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Jeton aléatoire de 256 bits, encodé en base64url (cookie de session, liens e-mail, invitations). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** On ne stocke jamais un jeton en clair : uniquement son SHA-256. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Code de liaison d'un salon Discord (8 caractères, sans 0/O ni 1/I), à taper avec /forever-lier ou /roster-lier,
 * valable 30 minutes. Seul son SHA-256 est gardé.
 */
export function linkCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from(randomBytes(8), b => alphabet[b % alphabet.length]).join("");
  return { code, hash: sha256(code), expiresAt: new Date(Date.now() + 30 * 60e3) };
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
