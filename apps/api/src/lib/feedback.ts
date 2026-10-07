import { and, isNotNull, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { feedbackMessages, feedbacks } from "../db/schema";

/**
 * Avis Discord suivis par un groupe (Administration → Avis) : conservation, vues pour le site.
 * Un avis anonyme ne montre jamais son auteur : authorId (pour le bot) ne sort pas de l'API interne.
 */

/** Sans groupe : lien avis ↔ auteur gardé 30 jours. Avec un groupe : auteur gardé 30 jours après la clôture. */
export const FEEDBACK_KEEP_DAYS = 30;
export const FEEDBACK_STATUSES = ["new", "wip", "done", "refused"] as const;
export const FEEDBACK_MAX_REPLY = 1500;

export const feedbackUrl = (origin: string, groupId: string, id?: string) =>
  `${origin}/groups/${groupId}/admin${id ? `?avis=${id}` : ""}`;

/**
 * Avis non suivis (ou dont le groupe a été supprimé) : effacés 30 jours après leur envoi, comme avant.
 * Avis suivis, clos depuis plus de 30 jours : l'auteur est oublié (plus de réponse possible), l'avis reste.
 */
export async function forgetFeedbacks(db: Db) {
  const limit = new Date(Date.now() - FEEDBACK_KEEP_DAYS * 86400e3);
  await db.delete(feedbacks).where(and(isNull(feedbacks.groupId), lt(feedbacks.createdAt, limit)));
  await db.update(feedbacks).set({ authorId: null })
    .where(and(isNotNull(feedbacks.authorId), isNotNull(feedbacks.closedAt), lt(feedbacks.closedAt, limit)));
}

type FeedbackRow = typeof feedbacks.$inferSelect;
type MessageRow = typeof feedbackMessages.$inferSelect;

/** Ce que voient le chef et les officiers du groupe. */
export function feedbackView(f: FeedbackRow, messages: MessageRow[], seenAt: Date | null) {
  return {
    id: f.id, anonymous: f.anonymous, author: f.anonymous ? null : f.authorName, text: f.text ?? "",
    status: f.status, reachable: !!f.authorId, createdAt: f.createdAt, closedAt: f.closedAt, authorAt: f.authorAt,
    unseen: !seenAt || f.authorAt > seenAt,
    messages: messages.map(m => ({
      id: m.id, from: m.from, name: m.from === "author" && f.anonymous ? null : m.name, text: m.text, source: m.source,
      delivered: m.delivered, createdAt: m.createdAt, unseen: m.from === "author" && (!seenAt || m.createdAt > seenAt),
    })),
  };
}
export type FeedbackView = ReturnType<typeof feedbackView>;
