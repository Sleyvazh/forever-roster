import type { BnetCharacter, Game, GameLangPref, LootMethod, LootMode, LootResponse, LootSettings, RaidLogEncounter, RaidLogExport, RaidPrep, RetailDifficulty, RoleTargets } from "@forever/game-data";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigint, bigserial, boolean, customType, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
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
  /** Roster (R2) : langue des noms du jeu (classes, spés, raids) ; auto = celle du navigateur. */
  gameLang: text("game_lang").$type<GameLangPref>().notNull().default("auto"),
  /** Roster encore fermé : accès anticipé (Flo et les officiers de la guilde), donné par roster-preview-cli. */
  rosterPreview: boolean("roster_preview").notNull().default(false),
  /** Admin du site (signalements : page admin, réponses), donné par site-admin-cli. */
  siteAdmin: boolean("site_admin").notNull().default(false),
  /** Dernière version de l'addon vue dans un export collé ou envoyé (aide aux signalements). */
  addonVersion: text("addon_version"),
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
  check("users_game_lang", sql`${t.gameLang} IN ('auto', 'fr', 'en')`),
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
  mode: text("mode", { enum: ["login", "link", "discord_link", "bnet_import"] }).notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
});

/** R2b : persos lus sur le compte Battle.net, le temps de choisir ceux à importer (30 min). Le jeton de Blizzard n'est pas gardé. */
export const bnetImports = pgTable("bnet_imports", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  characters: jsonb("characters").$type<BnetCharacter[]>().notNull(),
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
export interface TalentNode { id: number; rank: number; max: number; x: number; y: number; spell: number; sub: number; tree: number }
export type Gear = Partial<Record<string, { cur?: string; curId?: number | null; q?: number | null; bis?: string; bisId?: number | null; bisQ?: number | null; got?: boolean }>>;
export type Legacy = Partial<Record<string, { name: string; rank: number; max: number }[]>>;

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Jeu du perso (un site, deux adresses) : forever (Forever Roster) ou retail (Roster). */
  game: text("game").$type<Game>().notNull().default("forever"),
  name: text("name").notNull(),
  /** Royaume (Roster, WoW Retail : deux persos peuvent porter le même nom sur deux royaumes) ; vide sur Forever. */
  realm: text("realm").notNull().default(""),
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
  /** Talents lus en jeu par l'addon (système de talents de Forever) : un nœud par talent. Null tant qu'aucun export. */
  talentNodes: jsonb("talent_nodes").$type<TalentNode[] | null>(),
  /** Dernière mise à jour de la fiche depuis l'addon (export collé sur le site). */
  addonSyncedAt: ts("addon_synced_at"),
  /** Lot K1 : perso du jeu lié à cette fiche (« Prénom-Royaume ») : l'import de l'addon la retrouve d'un envoi à l'autre. */
  addonKey: text("addon_key"),
  /** Lot G : consommables demandés par les raids, comptés par l'addon à la synchro (objet → quantité) et quand. */
  consumables: jsonb("consumables").$type<Record<string, number>>().notNull().default({}),
  consumablesAt: ts("consumables_at"),
  /** R2b (Roster) : perso Battle.net (identifiant de Blizzard), royaume tel que Blizzard l'écrit dans ses adresses,
   *  niveau d'objet équipé, spé active en jeu et dernière lecture chez Blizzard (import ou « Mettre à jour »). */
  bnetId: bigint("bnet_id", { mode: "number" }),
  realmSlug: text("realm_slug").notNull().default(""),
  ilvl: integer("ilvl"),
  activeSpec: text("active_spec").notNull().default(""),
  bnetSyncedAt: ts("bnet_synced_at"),
  legacy: jsonb("legacy").$type<Legacy>().notNull().default({}),
  notes: text("notes").notNull().default(""),
  /** Portrait du perso (capture de la tête en jeu, 200×200). */
  portraitId: uuid("portrait_id").references((): AnyPgColumn => images.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("characters_user_idx").on(t.userId, t.sortOrder),
  uniqueIndex("characters_addon_key_uq").on(t.userId, t.game, t.addonKey),
  uniqueIndex("characters_bnet_uq").on(t.userId, t.bnetId),
  check("characters_level", sql`${t.level} BETWEEN 1 AND 90`),
  check("characters_game", sql`${t.game} IN ('forever', 'retail')`),
]);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Jeu du groupe (un site, deux adresses) : ses persos et ses raids sont de ce jeu. */
  game: text("game").$type<Game>().notNull().default("forever"),
  /** Salon Discord où le bot publie les raids du groupe (lié par un officier avec un code à usage unique). */
  discordGuildId: text("discord_guild_id"),
  discordChannelId: text("discord_channel_id"),
  /** Code de liaison (haché) et son expiration. */
  discordLinkCodeHash: text("discord_link_code_hash"),
  discordLinkCodeExpiresAt: ts("discord_link_code_expires_at"),
  /** Réglages du butin (soft reserve, conseil) ; le mode se choisit raid par raid. */
  lootSettings: jsonb("loot_settings").$type<Partial<LootSettings>>().notNull().default({}),
  /** Relance en MP des membres sans réponse : 24, 48 ou 72 h avant le raid (null : pas de relance automatique). */
  nudgeHours: smallint("nudge_hours").default(48),
  /** La liste des sans-réponse est aussi envoyée en MP aux officiers, au moment de la relance automatique. */
  nudgeOfficers: boolean("nudge_officers").notNull().default(true),
  /** Salon Discord des commandes d'artisanat (lot F), lié comme celui des raids : code à usage unique + /forever-lier. */
  ordersGuildId: text("orders_guild_id"),
  ordersChannelId: text("orders_channel_id"),
  ordersLinkCodeHash: text("orders_link_code_hash"),
  ordersLinkCodeExpiresAt: ts("orders_link_code_expires_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  check("groups_nudge_hours_chk", sql`${t.nudgeHours} is null or ${t.nudgeHours} in (24, 48, 72)`),
  check("groups_game", sql`${t.game} IN ('forever', 'retail')`),
  // Groupes liés à un serveur Discord (avis : seuls ceux-là sont proposés), quel que soit le nombre de groupes
  index("groups_discord_guild_idx").on(t.discordGuildId),
  index("groups_orders_guild_idx").on(t.ordersGuildId),
]);

export const groupMembers = pgTable("group_members", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "officer", "member"] }).notNull(),
  joinedAt: ts("joined_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  index("group_members_user_idx").on(t.userId),
]);

/**
 * Persos qu'un joueur fait jouer dans un groupe, et son perso principal (main) dans ce groupe : exactement un main
 * par joueur qui a au moins un perso dans le groupe. Un perso est rangé dans un seul groupe, ou aucun.
 * Un perso hors du groupe n'apparaît que dans les Artisans.
 */
export const groupCharacters = pgTable("group_characters", {
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  /** Propriétaire du perso (copie, pour l'unicité du main par joueur). */
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  isMain: boolean("is_main").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.groupId, t.characterId] }),
  uniqueIndex("group_characters_main_uq").on(t.groupId, t.userId).where(sql`${t.isMain}`),
  /** Un perso est rangé dans un seul groupe (lot E). */
  uniqueIndex("group_characters_char_uq").on(t.characterId),
  index("group_characters_user_idx").on(t.userId),
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
  /**
   * Relance des sans-réponse : automatique (une fois, remise à zéro si la date change), demandée par un officier
   * (« Relancer maintenant », en attente du bot) et dernière relance à la main (une par heure au plus).
   */
  nudgeAutoAt: ts("nudge_auto_at"),
  nudgeRequestedAt: ts("nudge_requested_at"),
  nudgeManualAt: ts("nudge_manual_at"),
  /** Composition validée par un officier : affichée dans l'annonce Discord. */
  rosterPublishedAt: ts("roster_published_at"),
  /** Mode de butin choisi à la création (journal, loot council, soft reserve) et visibilité des réservations. */
  lootMode: text("loot_mode").$type<LootMode>().notNull().default("journal"),
  srHidden: boolean("sr_hidden").notNull().default(false),
  /** Loot council : comptes qui forment le conseil pour ce raid (null : les officiers du groupe). */
  council: jsonb("council").$type<string[] | null>(),
  /** Lot G : préparation (consommables demandés, fiches de boss), reprise du dernier raid du même nom. */
  prep: jsonb("prep").$type<RaidPrep>().notNull().default({ instance: null, consumables: [], bosses: [] }),
  /** Format (10, 20 ou 40 joueurs) et rôles visés pour la compo (null : ceux du format). */
  size: smallint("size").notNull().default(40),
  targets: jsonb("targets").$type<RoleTargets | null>(),
  /** Roster (WoW Retail) : difficulté (normal, heroic, mythic) ; la taille suit la difficulté. Null sur Forever. */
  difficulty: text("difficulty").$type<RetailDifficulty | null>(),
  /** Raid créé automatiquement à partir d'un modèle récurrent. */
  templateId: uuid("template_id").references((): AnyPgColumn => raidTemplates.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("raids_group_idx").on(t.groupId),
  check("raids_size_chk", sql`${t.size} between 5 and 40`),
  check("raids_difficulty_chk", sql`${t.difficulty} is null or ${t.difficulty} in ('normal', 'heroic', 'mythic')`),
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
  size: smallint("size").notNull().default(40),
  difficulty: text("difficulty").$type<RetailDifficulty | null>(),
  lootMode: text("loot_mode").$type<LootMode>().notNull().default("journal"),
  srHidden: boolean("sr_hidden").notNull().default(false),
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

/** Talents de Forever par classe (système C_Traits) : position dans l'arbre de chaque spé, rang max, sort, flèche. */
export const gameTalents = pgTable("game_talents", {
  /** Identifiant du nœud (le même que dans l'export de l'addon). */
  id: integer("id").primaryKey(),
  cls: text("cls").notNull(),
  /** Spé : 0, 1 ou 2, dans l'ordre des arbres de la classe. */
  tree: smallint("tree").notNull(),
  tier: smallint("tier").notNull(),
  col: smallint("col").notNull(),
  /** Position dans le lien du calculateur ForeverChanges (palier puis colonne). */
  linkIndex: smallint("link_index").notNull(),
  maxRank: smallint("max_rank").notNull(),
  name: text("name").notNull(),
  spellId: integer("spell_id").notNull(),
  icon: text("icon"),
  iconId: integer("icon_id"),
  prereq: integer("prereq"),
  description: text("description").notNull().default(""),
}, t => [index("game_talents_cls_idx").on(t.cls)]);

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

/**
 * Commande d'artisanat (lot F) : un membre demande une fabrication dans son groupe ; un artisan la prend, puis la
 * marque faite. Recette et objet recopiés (les tables du jeu sont réimportées à chaque version).
 */
export interface OrderReagent { itemId: number; name: string; n: number; provided: boolean }
export const craftOrders = pgTable("craft_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  spellId: integer("spell_id").notNull(),
  recipeName: text("recipe_name").notNull(),
  itemId: integer("item_id"),
  itemName: text("item_name"),
  quantity: smallint("quantity").notNull().default(1),
  requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Perso qui recevra l'objet (facultatif). */
  characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
  /** Composants de la recette (× quantité) et ceux déjà fournis par le demandeur. */
  reagents: jsonb("reagents").$type<OrderReagent[]>().notNull().default([]),
  /** Délai, pourboire, détails : texte libre. */
  note: text("note").notNull().default(""),
  status: text("status").$type<"open" | "taken" | "done">().notNull().default("open"),
  takerId: uuid("taker_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  takenAt: ts("taken_at"),
  doneAt: ts("done_at"),
  /** Message du bot dans le salon des commandes (republié quand discord_changed_at > discord_synced_at). */
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  discordChangedAt: ts("discord_changed_at").notNull().defaultNow(),
  discordSyncedAt: ts("discord_synced_at"),
}, t => [
  index("craft_orders_group_idx").on(t.groupId, t.status),
  check("craft_orders_status_chk", sql`${t.status} in ('open', 'taken', 'done')`),
  check("craft_orders_qty_chk", sql`${t.quantity} between 1 and 99`),
]);

/**
 * Absence déclarée (lot F) : une période (du … au …, dates de Paris incluses) ou des jours de la semaine (« jamais le
 * vendredi », jusqu'à ce que le joueur la retire). Les raids sans réponse de ces jours passent en « Absent », dans tous
 * ses groupes, y compris ceux créés ensuite. Le motif est facultatif ; le joueur choisit qui le voit.
 */
export const absences = pgTable("absences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  /** 1 = lundi … 7 = dimanche (absence récurrente). */
  weekdays: jsonb("weekdays").$type<number[]>().notNull().default([]),
  reason: text("reason").notNull().default(""),
  reasonVisibility: text("reason_visibility").$type<"officers" | "group">().notNull().default("officers"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  index("absences_user_idx").on(t.userId),
  check("absences_kind_chk", sql`(${t.startDate} is not null and ${t.endDate} is not null and ${t.endDate} >= ${t.startDate}) or jsonb_array_length(${t.weekdays}) > 0`),
  check("absences_visibility_chk", sql`${t.reasonVisibility} in ('officers', 'group')`),
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
 * « Demander à X » (compo assistée) : un officier demande à un joueur de venir avec un perso précis, dans une spé.
 * Le bot l'envoie en MP avec deux boutons ; « Oui » inscrit le joueur avec ce perso. Une demande par perso et par raid.
 */
export const raidAsks = pgTable("raid_asks", {
  id: uuid("id").primaryKey().defaultRandom(),
  raidId: uuid("raid_id").notNull().references(() => raids.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  /** Joueur à qui on demande (propriétaire du perso). */
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  spec: text("spec").notNull(),
  askedBy: uuid("asked_by").references(() => users.id, { onDelete: "set null" }),
  askedByName: text("asked_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  /** Pris en charge par le bot (MP envoyé), ou MP impossible (MP fermés, plus de serveur en commun). */
  sentAt: ts("sent_at"),
  failed: boolean("failed").notNull().default(false),
  answer: text("answer").$type<"yes" | "no">(),
  answeredAt: ts("answered_at"),
}, t => [
  uniqueIndex("raid_asks_char_uq").on(t.raidId, t.characterId),
  index("raid_asks_pending_idx").on(t.sentAt),
  check("raid_asks_answer_chk", sql`${t.answer} is null or ${t.answer} in ('yes', 'no')`),
]);

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

/**
 * Bilan d'un raid relevé par l'addon (bloc FRB collé sur le site, ou RRB de l'addon Roster sur WoW Retail) : présence
 * (qui était dans le groupe de raid, de quand à quand) et butin noté pendant la soirée. Un bilan par raid ; un nouveau
 * collage le remplace. Sur Roster, les noms sont en « Prénom-Royaume » et les rencontres de boss sont notées.
 */
export interface RaidLogAttendee { name: string; first: number; last: number; samples: number }
export interface RaidLogLoot {
  itemId: number; name: string; at: number; boss: string;
  /** Bilan v2 : comment l'objet a été attribué, réponse du joueur au conseil, détail (votes, jet). */
  method?: LootMethod; response?: LootResponse; detail?: string;
  /** Roster : nom de l'objet donné par l'addon (le site n'a pas la base des objets de Retail). */
  itemName?: string;
}
export const raidLogs = pgTable("raid_logs", {
  raidId: uuid("raid_id").primaryKey().references(() => raids.id, { onDelete: "cascade" }),
  recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
  /** Perso en jeu qui a fait le relevé. */
  recorder: text("recorder").notNull().default(""),
  startedAt: ts("started_at").notNull(),
  endedAt: ts("ended_at").notNull(),
  attendees: jsonb("attendees").$type<RaidLogAttendee[]>().notNull().default([]),
  loot: jsonb("loot").$type<RaidLogLoot[]>().notNull().default([]),
  /** Lot G : dernier appel aux consommables lancé en raid (quantités de chaque joueur). */
  consumableCall: jsonb("consumable_call").$type<RaidLogExport["consumableCall"] | null>(),
  /** Lot K1 : relevé par le chef de raid (il menait le raid ou distribuait le butin). Un envoi automatique ne le remplace pas. */
  lead: boolean("lead").notNull().default(false),
  /** Roster (lot R3a, lignes E du bilan RRB) : fin de chaque rencontre de boss, vaincu ou non. Vide pour Forever. */
  encounters: jsonb("encounters").$type<RaidLogEncounter[]>().notNull().default([]),
  /** Roster : difficulté relevée en jeu (d'après l'instance), null si inconnue ou pour Forever. */
  difficulty: text("difficulty").$type<RetailDifficulty | null>(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/* ---------- Signalements (bug, idée, question) ---------- */

export type ReportKind = "bug" | "idea" | "question";
export type ReportArea = "site" | "addon" | "bot" | "companion";
export type ReportStatus = "new" | "wip" | "done" | "refused";

/**
 * Signalement d'un joueur connecté, sur l'une ou l'autre adresse. Gardé sur le site (suivi par le joueur, page admin)
 * et posté dans le salon Discord des admins (site_settings « reports_channel »). Capture d'écran ré-encodée en WebP.
 */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Nom affiché au moment du signalement (le compte peut disparaître). */
  author: text("author").notNull(),
  game: text("game").$type<Game>().notNull(),
  kind: text("kind").$type<ReportKind>().notNull(),
  area: text("area").$type<ReportArea>().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  page: text("page").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  addonVersion: text("addon_version"),
  image: bytea("image"),
  status: text("status").$type<ReportStatus>().notNull().default("new"),
  reply: text("reply").notNull().default(""),
  repliedAt: ts("replied_at"),
  repliedBy: text("replied_by"),
  /** Réponse lue par le joueur (pastille du menu tant que null après une réponse). */
  replySeenAt: ts("reply_seen_at"),
  discordChannelId: text("discord_channel_id"),
  discordMessageId: text("discord_message_id"),
  discordChangedAt: ts("discord_changed_at").notNull().defaultNow(),
  discordSyncedAt: ts("discord_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("reports_user_idx").on(t.userId, t.createdAt),
  index("reports_status_idx").on(t.status, t.createdAt),
  check("reports_kind", sql`${t.kind} IN ('bug', 'idea', 'question')`),
  check("reports_area", sql`${t.area} IN ('site', 'addon', 'bot', 'companion')`),
  check("reports_status", sql`${t.status} IN ('new', 'wip', 'done', 'refused')`),
]);

/** Réglages du site (une ligne par clé) : salon Discord des signalements, etc. */
export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Annonces Discord à supprimer (raid supprimé sur le site) : le bot les traite puis les efface. */
export const discordDeletions = pgTable("discord_deletions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ---------- Avis (feedback) par le bot Discord ---------- */

export type FeedbackStatus = "new" | "wip" | "done" | "refused";

/**
 * Réglages d'un serveur Discord : salon où arrivent les avis, salon du bouton « Donner mon avis ».
 * Facultatif : groupe du site qui suit les avis (Administration → Avis, chef et officiers), choisi parmi les groupes
 * déjà liés à ce serveur. Sans groupe, les avis restent seulement dans Discord.
 */
export const feedbackSettings = pgTable("feedback_settings", {
  guildId: text("guild_id").primaryKey(),
  /** Nom du serveur Discord au dernier réglage (affiché sur le site). */
  guildName: text("guild_name").notNull().default(""),
  inboxChannelId: text("inbox_channel_id").notNull(),
  panelChannelId: text("panel_channel_id"),
  panelMessageId: text("panel_message_id"),
  allowAnonymous: boolean("allow_anonymous").notNull().default(true),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  updatedBy: text("updated_by").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [index("feedback_settings_group_idx").on(t.groupId)]);

/**
 * Avis publiés. Sans groupe : seul le lien avis ↔ auteur est gardé, 30 jours (le texte reste dans Discord).
 * Suivi par un groupe : texte, statut et conversation gardés jusqu'à suppression par un officier ; l'auteur (pour la
 * réponse par le bot) est oublié 30 jours après la clôture (« Fait » ou « Refusé »). Un avis anonyme ne montre jamais
 * son auteur sur le site : authorId ne sert qu'au bot.
 */
export const feedbacks = pgTable("feedbacks", {
  id: uuid("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id").notNull(),
  anonymous: boolean("anonymous").notNull(),
  authorId: text("author_id"),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
  /** Avis suivi par un groupe : texte et nom (signé seulement). */
  text: text("text"),
  authorName: text("author_name"),
  status: text("status").$type<FeedbackStatus>().notNull().default("new"),
  closedAt: ts("closed_at"),
  /** Dernier message de l'auteur (l'avis ou une réponse) : pastille des officiers. */
  authorAt: ts("author_at").notNull().defaultNow(),
  /** Statut à reporter sur le message du salon de l'équipe. */
  discordChangedAt: ts("discord_changed_at").notNull().defaultNow(),
  discordSyncedAt: ts("discord_synced_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, t => [
  index("feedbacks_created_idx").on(t.createdAt),
  index("feedbacks_group_idx").on(t.groupId, t.authorAt),
  check("feedbacks_status", sql`${t.status} IN ('new', 'wip', 'done', 'refused')`),
]);

/** Conversation d'un avis suivi : réponses de l'équipe (Discord ou site) et de l'auteur. */
export const feedbackMessages = pgTable("feedback_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  feedbackId: uuid("feedback_id").notNull().references(() => feedbacks.id, { onDelete: "cascade" }),
  from: text("from").$type<"team" | "author">().notNull(),
  /** Officier qui répond, ou auteur d'un avis signé ; null pour l'auteur d'un avis anonyme. */
  name: text("name"),
  text: text("text").notNull(),
  source: text("source").$type<"discord" | "site">().notNull(),
  /** Réponse de l'équipe : remise en MP (null : écrite sur le site, le bot ne l'a pas encore envoyée). */
  delivered: boolean("delivered"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  index("feedback_messages_idx").on(t.feedbackId, t.createdAt),
  index("feedback_messages_pending_idx").on(t.createdAt).where(sql`${t.source} = 'site' AND ${t.delivered} IS NULL`),
  check("feedback_messages_from", sql`${t.from} IN ('team', 'author')`),
  check("feedback_messages_source", sql`${t.source} IN ('discord', 'site')`),
]);

/** Dernière visite d'un officier dans les avis de son groupe (pastilles). */
export const feedbackSeen = pgTable("feedback_seen", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  seenAt: ts("seen_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.groupId] })]);

/** Soft reserve : objets réservés par un perso pour un raid. */
export const softReserves = pgTable("soft_reserves", {
  raidId: uuid("raid_id").notNull().references(() => raids.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  primaryKey({ columns: [t.raidId, t.characterId, t.itemId] }),
  index("soft_reserves_char_idx").on(t.characterId, t.itemId),
]);

/**
 * Catalogue de butin appris par les bilans des raids (les tables de butin ne sont pas dans les fichiers du jeu) :
 * objet vu tomber, par instance et par boss, tous groupes confondus. Aucune donnée de joueur.
 */
export const lootCatalog = pgTable("loot_catalog", {
  instance: text("instance").notNull(),
  boss: text("boss").notNull().default(""),
  itemId: integer("item_id").notNull(),
  seen: integer("seen").notNull().default(1),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.instance, t.boss, t.itemId] })]);

/**
 * Compte des objets reçus (lot I) : objet d'un bilan que les officiers sortent du compte (donné par erreur, désenchanté…).
 * Repéré par l'objet, le prénom en jeu de celui qui l'a reçu et l'heure notée par l'addon : un nouveau collage du bilan le garde.
 */
export const lootExclusions = pgTable("loot_exclusions", {
  raidId: uuid("raid_id").notNull().references(() => raids.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull(),
  /** Prénom en jeu, en minuscules. */
  recipient: text("recipient").notNull(),
  at: integer("at").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.raidId, t.itemId, t.recipient, t.at] })]);

/** Corrections manuelles du compte (± avec motif) sur un perso du groupe ; comptées si elles tombent dans la période. */
export const lootCorrections = pgTable("loot_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  characterId: uuid("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  delta: smallint("delta").notNull(),
  note: text("note").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [
  index("loot_corrections_group_idx").on(t.groupId, t.createdAt),
  check("loot_corrections_delta_chk", sql`${t.delta} between -20 and 20 and ${t.delta} <> 0`),
]);

/* ---------- Roster Companion (lot K1) ---------- */

/**
 * Appareils reliés (Roster Companion) : un jeton par appareil, haché comme les sessions, valable seulement pour la
 * synchro (/api/sync) ; révocable depuis Compte & sécurité ou depuis l'appli.
 */
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform").notNull().default(""),
  appVersion: text("app_version").notNull().default(""),
  tokenHash: text("token_hash").notNull(),
  lastIp: text("last_ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  /** Dernier envoi ou dernière réception de données (pas un simple contrôle du jeton). */
  lastSyncAt: ts("last_sync_at"),
  revokedAt: ts("revoked_at"),
}, t => [
  uniqueIndex("devices_token_uq").on(t.tokenHash),
  index("devices_user_idx").on(t.userId),
]);

/**
 * Demandes d'appairage (façon « device flow », RFC 8628) : l'appli affiche le code, le joueur le valide sur le site,
 * l'appli récupère son jeton une seule fois. pairHash : SHA-256 de l'identifiant secret que seule l'appli connaît.
 */
export const devicePairings = pgTable("device_pairings", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairHash: text("pair_hash").notNull(),
  userCode: text("user_code").notNull(),
  name: text("name").notNull(),
  platform: text("platform").notNull().default(""),
  appVersion: text("app_version").notNull().default(""),
  ip: text("ip"),
  status: text("status", { enum: ["pending", "approved", "denied", "done"] }).notNull().default("pending"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  lastPollAt: ts("last_poll_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
}, t => [
  uniqueIndex("device_pairings_hash_uq").on(t.pairHash),
  uniqueIndex("device_pairings_code_uq").on(t.userCode),
]);

/** Persos du jeu que le joueur a choisi d'ignorer (perso de banque…) : l'appli ne les propose plus. */
export const addonIgnored = pgTable("addon_ignored", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  game: text("game").$type<Game>().notNull(),
  key: text("key").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.game, t.key] })]);
