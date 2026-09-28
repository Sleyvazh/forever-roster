import { sql } from "drizzle-orm";
import {
  bigserial, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------- Comptes ---------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Toujours stockée en minuscules. Null pour un compte créé uniquement via Battle.net. */
  email: text("email"),
  emailVerifiedAt: ts("email_verified_at"),
  /** Hash Argon2id (format PHC). Null si le compte n'a pas de mot de passe. */
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  battlenetId: text("battlenet_id"),
  battletag: text("battletag"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  uniqueIndex("users_email_uq").on(t.email),
  uniqueIndex("users_battlenet_uq").on(t.battlenetId),
  check("users_login_method", sql`${t.passwordHash} IS NOT NULL OR ${t.battlenetId} IS NOT NULL`),
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 du jeton envoyé dans le cookie : une fuite de la base ne donne pas de session utilisable. */
  tokenHash: text("token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
}, t => [
  uniqueIndex("sessions_token_uq").on(t.tokenHash),
  index("sessions_user_idx").on(t.userId),
]);

/** Jetons à usage unique envoyés par e-mail (vérification d'adresse, réinitialisation du mot de passe). */
export const emailTokens = pgTable("email_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [uniqueIndex("email_tokens_hash_uq").on(t.tokenHash)]);

/** États OAuth en attente (protection CSRF du flux Battle.net). */
export const oauthStates = pgTable("oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  mode: text("mode", { enum: ["login", "link"] }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
});

/** Journal de sécurité : connexions, échecs, changements sensibles. */
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  groupId: uuid("group_id"),
  type: text("type").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  index("audit_user_idx").on(t.userId, t.createdAt),
  index("audit_group_idx").on(t.groupId, t.createdAt),
]);

/* ---------- Jeu ---------- */

export interface Professions {
  prof1: { name: string; skill: number };
  prof2: { name: string; skill: number };
  cooking: number; fishing: number; firstAid: number;
}
export type Gear = Partial<Record<string, { cur?: string; q?: number | null; bis?: string; got?: boolean }>>;
export type Legacy = Partial<Record<string, { name: string; rank: number; max: number }[]>>;

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  race: text("race").notNull().default(""),
  cls: text("cls").notNull().default(""),
  spec1: text("spec1").notNull().default(""),
  spec2: text("spec2").notNull().default(""),
  level: integer("level").notNull().default(1),
  talents: text("talents").notNull().default(""),
  talentLink: text("talent_link").notNull().default(""),
  /** Build de l'off-spec (spec2). */
  talents2: text("talents2").notNull().default(""),
  talentLink2: text("talent_link2").notNull().default(""),
  professions: jsonb("professions").$type<Professions>().notNull()
    .default({ prof1: { name: "", skill: 0 }, prof2: { name: "", skill: 0 }, cooking: 0, fishing: 0, firstAid: 0 }),
  gear: jsonb("gear").$type<Gear>().notNull().default({}),
  legacy: jsonb("legacy").$type<Legacy>().notNull().default({}),
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("characters_user_idx").on(t.userId, t.sortOrder),
  check("characters_level", sql`${t.level} BETWEEN 1 AND 60`),
]);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "officer", "member"] }).notNull(),
  joinedAt: ts("joined_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index("group_members_user_idx").on(t.userId),
]);

export const groupInvites = pgTable("group_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  maxUses: integer("max_uses").notNull().default(10),
  uses: integer("uses").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [uniqueIndex("group_invites_hash_uq").on(t.tokenHash)]);

export interface RaidSlot { group: number; pos: number; characterId: string }

export const raids = pgTable("raids", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scheduledAt: ts("scheduled_at"),
  slots: jsonb("slots").$type<RaidSlot[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [index("raids_group_idx").on(t.groupId)]);
