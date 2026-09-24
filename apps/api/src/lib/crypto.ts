import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Jeton aléatoire de 256 bits, encodé en base64url (cookie de session, liens e-mail, invitations). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** On ne stocke jamais un jeton en clair : uniquement son SHA-256. */
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
