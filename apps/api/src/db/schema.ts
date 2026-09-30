import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigserial, boolean, customType, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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
  /** Compte Discord lié (identifiant « snowflake ») : sert aux inscriptions depuis le bot. */
  discordId: text("discord_id"),
  discordUsername: text("discord_username"),
  /** Rappel en message privé Discord la veille des raids auxquels le joueur est inscrit. */
  discordReminders: boolean("discord_reminders").notNull().default(true),
  /** Image du compte (200×200, WebP ré-encodé par le serveur). */
  avatarId: uuid("avatar_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  uniqueIndex("users_email_uq").on(t.email),
  uniqueIndex("users_battlenet_uq").on(t.battlenetId),
  uniqueIndex("users_discord_uq").on(t.discordId),
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
  mode: text("mode", { enum: ["login", "link", "discord_link"] }).notNull(),
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
/** curId / bisId : identifiant de l'objet dans la base du jeu (game_items), quand il a été choisi dans la recherche. */
export type Gear = Partial<Record<string, { cur?: string; curId?: number | null; q?: number | null; bis?: string; bisId?: number | null; bisQ?: number | null; got?: boolean }>>;
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
  /** Portrait du perso (capture de la tête en jeu, 200×200). */
  portraitId: uuid("portrait_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
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
  /** Salon Discord où le bot publie les raids du groupe (lié par un officier avec un code à usage unique). */
  discordGuildId: text("discord_guild_id"),
  discordChannelId: text("discord_channel_id"),
  /** Code de liaison (haché) et son expiration. */
  discordLinkCodeHash: text("discord_link_code_hash"),
  discordLinkCodeExpiresAt: ts("discord_link_code_expires_at"),
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

/**
 * Place dans la compo : un perso du site (`characterId`) ou une inscription libre faite
 * depuis Discord, sans compte (`signupId`). Exactement l'un des deux.
 */
export interface RaidSlot { group: number; pos: number; characterId?: string; signupId?: string }

export const raids = pgTable("raids", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scheduledAt: ts("scheduled_at"),
  slots: jsonb("slots").$type<RaidSlot[]>().notNull().default([]),
  description: text("description").notNull().default(""),
  /**
   * Annonce Discord du raid : message publié par le bot. Il est à republier quand
   * discord_changed_at > discord_synced_at (le bot confirme la version exacte qu'il a publiée).
   */
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  discordChangedAt: ts("discord_changed_at").notNull().defaultNow(),
  discordSyncedAt: ts("discord_synced_at"),
  /** Rappel de la veille déjà envoyé (remis à zéro si la date change). */
  reminderSentAt: ts("reminder_sent_at"),
  /** Composition validée par un officier : affichée dans l'annonce Discord. */
  rosterPublishedAt: ts("roster_published_at"),
  /** Raid créé automatiquement à partir d'un modèle récurrent. */
  templateId: uuid("template_id").references((): AnyPgColumn => raidTemplates.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("raids_group_idx").on(t.groupId),
  uniqueIndex("raids_template_occurrence_uq").on(t.templateId, t.scheduledAt),
]);

/**
 * Raid récurrent (ex. « Molten Core, mercredi 21:00 ») : le site crée chaque occurrence
 * `leadDays` jours à l'avance. `generatedUntil` = dernière occurrence déjà créée : un raid
 * supprimé à la main n'est donc jamais recréé.
 */
export const raidTemplates = pgTable("raid_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** 1 = lundi … 7 = dimanche (ISO 8601). */
  weekday: smallint("weekday").notNull(),
  /** Heure locale (fuseau du serveur de jeu), « HH:MM ». */
  time: text("time").notNull(),
  leadDays: smallint("lead_days").notNull().default(7),
  active: boolean("active").notNull().default(true),
  generatedUntil: ts("generated_until"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("raid_templates_group_idx").on(t.groupId),
  check("raid_templates_weekday_chk", sql`${t.weekday} between 1 and 7`),
  check("raid_templates_lead_chk", sql`${t.leadDays} between 1 and 28`),
  check("raid_templates_time_chk", sql`${t.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
]);

/* ---------- Données du jeu (importées des tables du client via wago.tools) ---------- */

export const gameItems = pgTable("game_items", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  quality: smallint("quality").notNull(),
  itemLevel: integer("item_level").notNull(),
  reqLevel: integer("req_level").notNull(),
  classId: integer("class_id").notNull(),
  subclassId: integer("subclass_id").notNull(),
  inventoryType: integer("inventory_type").notNull(),
  /** Libellé lisible, ex. « Armure · Cuir » tel que fourni par le client. */
  kind: text("kind").notNull().default(""),
  /** « forever » (client Forever) ou « era » (absent du client Forever, complété avec Classic Era). */
  origin: text("origin", { enum: ["forever", "era"] }).notNull().default("forever"),
  /** Infobulle calculée à l'import : stats, armure, dégâts, effets, set, icône (voir gamedata/details.ts). */
  details: jsonb("details").$type<import("@forever/game-data").ItemDetails>().notNull().default({}),
}, t => [
  index("game_items_inv_idx").on(t.inventoryType),
]);

export interface Reagent { id: number; n: number }

export const gameRecipes = pgTable("game_recipes", {
  /** Identifiant du sort de fabrication. */
  spellId: integer("spell_id").primaryKey(),
  skillLine: integer("skill_line").notNull(),
  name: text("name").notNull(),
  /** Compétence requise (seuil orange). */
  reqSkill: integer("req_skill").notNull(),
  trivialLow: integer("trivial_low").notNull(),
  trivialHigh: integer("trivial_high").notNull(),
  category: text("category").notNull().default(""),
  createdItemId: integer("created_item_id"),
  createdCount: integer("created_count").notNull().default(1),
  enchant: text("enchant"),
  reagents: jsonb("reagents").$type<Reagent[]>().notNull().default([]),
  /** Objets « Patron / Plans / Recette » qui enseignent ce sort. Vide = appris chez un entraîneur. */
  taughtBy: jsonb("taught_by").$type<number[]>().notNull().default([]),
  fromItem: boolean("from_item").notNull().default(false),
}, t => [index("game_recipes_skill_idx").on(t.skillLine), index("game_recipes_created_item_idx").on(t.createdItemId)]);

export const gameMeta = pgTable("game_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Patrons connus ou recherchés par un personnage. */
export const characterRecipes = pgTable("character_recipes", {
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  spellId: integer("spell_id").notNull(),
  status: text("status").$type<"known" | "wanted">().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.characterId, t.spellId] }),
  index("character_recipes_spell_idx").on(t.spellId),
  check("character_recipes_status", sql`${t.status} IN ('known', 'wanted')`),
]);

/* ---------- Images envoyées par les joueurs ---------- */

/** Stockées en base (≈ 10 Ko chacune) : sauvegardées avec le reste par pg_dump. */
export const images = pgTable("images", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [index("images_owner_idx").on(t.ownerId)]);

/* ---------- Inscriptions aux raids ---------- */

/**
 * Une inscription par joueur et par raid : un compte du site (user_id) ou, pour l'inscription libre
 * depuis Discord, un identifiant Discord seul (discord_user_id). Le perso est facultatif (absent, inscription libre).
 */
export const raidSignups = pgTable("raid_signups", {
  id: uuid("id").primaryKey().defaultRandom(),
  raidId: uuid("raid_id").notNull().references(() => raids.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id"),
  displayName: text("display_name").notNull(),
  characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
  cls: text("cls").notNull().default(""),
  spec: text("spec").notNull().default(""),
  status: text("status").$type<"present" | "late" | "tentative" | "alt" | "bench" | "absent">().notNull(),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  uniqueIndex("raid_signups_user_uq").on(t.raidId, t.userId),
  uniqueIndex("raid_signups_discord_uq").on(t.raidId, t.discordUserId),
  index("raid_signups_raid_idx").on(t.raidId),
  check("raid_signups_who", sql`${t.userId} IS NOT NULL OR ${t.discordUserId} IS NOT NULL`),
  check("raid_signups_status", sql`${t.status} IN ('present', 'late', 'tentative', 'alt', 'bench', 'absent')`),
]);

/** Annonces Discord à supprimer (raid supprimé sur le site) : le bot les traite puis les efface. */
export const discordDeletions = pgTable("discord_deletions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});
