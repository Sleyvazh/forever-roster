import type { UserRow } from "./session";

/** Ce que le front a le droit de voir d'un compte (jamais le hash ni les compteurs de sécurité). */
export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    displayName: u.displayName,
    battletag: u.battletag,
    hasPassword: !!u.passwordHash,
    hasBattlenet: !!u.battlenetId,
    avatarId: u.avatarId,
    createdAt: u.createdAt,
  };
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
