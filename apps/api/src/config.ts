import { z } from "zod";

const bool = z.enum(["true", "false"]).transform(v => v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  APP_ORIGIN: z.url().transform(u => u.replace(/\/$/, "")),
  /** Deuxième adresse du même site : Roster (WoW Retail), ex. https://roster.sleyvazh.fr. Vide : Forever Roster seul. */
  RETAIL_ORIGIN: z.union([z.literal(""), z.url().transform(u => u.replace(/\/$/, ""))]).default(""),
  DATABASE_URL: z.string().min(1),
  COOKIE_SECURE: bool.default(true),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("Forever Roster <no-reply@forever-roster.local>"),
  HIBP_CHECK: bool.default(true),
  BNET_CLIENT_ID: z.string().default(""),
  BNET_CLIENT_SECRET: z.string().default(""),
  BNET_OAUTH_HOST: z.url().default("https://oauth.battle.net"),
  /** API de jeu de Blizzard, région Europe (Roster : import des persos, niveau d'objet). */
  BNET_API_HOST: z.url().default("https://eu.api.blizzard.com"),
  TRUST_PROXY: bool.default(false),
  /** Requêtes par minute et par adresse IP, toutes routes confondues. Relevé seulement pour les tests de bout en bout (tout vient de 127.0.0.1). */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_CLIENT_SECRET: z.string().default(""),
  DISCORD_HOST: z.url().default("https://discord.com"),
  /** Secret partagé avec le bot pour l'API interne (vide = API interne désactivée). */
  INTERNAL_API_SECRET: z.union([z.literal(""), z.string().min(32, "INTERNAL_API_SECRET : 32 caractères minimum")]).default(""),
  INTERNAL_PORT: z.coerce.number().int().default(3001),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production" && !cfg.COOKIE_SECURE) {
    throw new Error("COOKIE_SECURE doit valoir true en production.");
  }
  return cfg;
}

export const discordEnabled = (cfg: Config) => !!(cfg.DISCORD_CLIENT_ID && cfg.DISCORD_CLIENT_SECRET);
export const battlenetEnabled = (cfg: Config) => !!(cfg.BNET_CLIENT_ID && cfg.BNET_CLIENT_SECRET);
