import type { FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { auditEvents } from "../db/schema";

export type AuditType =
  | "register" | "email_verified" | "login_success" | "login_failure" | "login_locked" | "logout"
  | "password_changed" | "password_reset_requested" | "password_reset"
  | "session_revoked" | "sessions_revoked_all"
  | "battlenet_login" | "battlenet_linked" | "battlenet_unlinked" | "discord_linked" | "discord_unlinked" | "account_created_battlenet"
  | "group_created" | "group_renamed" | "group_joined" | "group_left" | "group_role_changed" | "group_member_removed"
  | "invite_created" | "invite_revoked" | "raid_created" | "raid_deleted" | "group_discord_linked" | "group_discord_unlinked"
  | "raid_template_created" | "raid_template_updated" | "raid_template_deleted" | "raid_roster_published" | "raid_roster_unpublished"
  | "group_character_changed" | "group_loot_settings" | "group_nudge_settings" | "raid_nudged" | "raid_ask_sent" | "group_orders_linked" | "group_orders_unlinked" | "raid_council"
  | "loot_count_corrected"
  | "device_linked" | "device_pair_denied" | "device_unlinked";

export async function audit(
  db: Db, req: FastifyRequest | null, type: AuditType,
  data: { userId?: string | null; groupId?: string | null; meta?: Record<string, unknown> } = {},
) {
  await db.insert(auditEvents).values({
    type,
    userId: data.userId ?? null,
    groupId: data.groupId ?? null,
    ip: req?.ip ?? null,
    userAgent: req ? String(req.headers["user-agent"] ?? "").slice(0, 300) : null,
    meta: data.meta ?? {},
  });
}
