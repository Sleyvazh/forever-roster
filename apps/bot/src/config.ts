/** Configuration du bot, lue dans l'environnement. Aucun secret n'a de valeur par défaut. */
export interface BotConfig {
  token: string;
  apiUrl: string;
  apiSecret: string;
  pollMs: number;
  timeZone: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const cfg: BotConfig = {
    token: env.DISCORD_BOT_TOKEN?.trim() ?? "",
    apiUrl: (env.INTERNAL_API_URL ?? "http://api:3001").replace(/\/+$/, ""),
    apiSecret: env.INTERNAL_API_SECRET?.trim() ?? "",
    pollMs: Math.max(2000, Number(env.BOT_POLL_MS ?? 5000) || 5000),
    timeZone: env.BOT_TIMEZONE?.trim() || "Europe/Paris",
  };
  if (cfg.token && cfg.apiSecret.length < 32) throw new Error("INTERNAL_API_SECRET manquant ou trop court (32 caractères minimum).");
  // Vérifie que le fuseau est connu (lève une RangeError sinon)
  new Intl.DateTimeFormat("fr-FR", { timeZone: cfg.timeZone });
  return cfg;
}
