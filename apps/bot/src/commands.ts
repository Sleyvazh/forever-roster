import { ApplicationCommandOptionType, ApplicationCommandType, InteractionContextType, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

/** Commandes slash du bot (enregistrées au démarrage). Les droits sont vérifiés par le site : officier du groupe. */
export const COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: "forever-lier",
    description: "Lie ce salon à un groupe Forever Roster (code à générer sur la page du groupe).",
    contexts: [InteractionContextType.Guild],
    options: [{ type: ApplicationCommandOptionType.String, name: "code", description: "Code affiché sur la page du groupe (valable 30 min)", required: true, min_length: 6, max_length: 32 }],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "raid",
    description: "Crée un raid dans le groupe lié à ce salon (officiers).",
    contexts: [InteractionContextType.Guild],
    options: [
      { type: ApplicationCommandOptionType.String, name: "nom", description: "Ex. Molten Core", required: true, min_length: 2, max_length: 60 },
      { type: ApplicationCommandOptionType.String, name: "date", description: "JJ/MM/AAAA HH:MM, heure de Paris (ex. 12/11/2026 21:00)", required: true, max_length: 40 },
      { type: ApplicationCommandOptionType.String, name: "description", description: "Consignes, point de rendez-vous…", required: false, max_length: 1000 },
    ],
  },
];
