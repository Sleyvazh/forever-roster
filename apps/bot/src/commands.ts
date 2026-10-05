import { ApplicationCommandOptionType, ApplicationCommandType, ChannelType, InteractionContextType, PermissionFlagsBits, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

/** Commandes slash du bot (enregistrées au démarrage). Raids : droits vérifiés par le site (officier du groupe). Avis : Gérer le serveur. */
export const COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: "forever-lier",
    description: "Lie ce salon à un groupe Forever Roster : raids ou commandes (code donné par le site).",
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
  // Avis : fonction autonome, pour n'importe quel serveur (sans groupe du site ni addon)
  {
    type: ApplicationCommandType.ChatInput,
    name: "feedback",
    description: "Donne ton avis à l'équipe du serveur, signé ou anonyme (par message privé).",
    contexts: [InteractionContextType.Guild],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "feedback-config",
    description: "Règle les avis de ce serveur : salon de l'équipe, salon du bouton, anonymat.",
    contexts: [InteractionContextType.Guild],
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand, name: "regler", description: "Active les avis, ou change leurs réglages",
        options: [
          { type: ApplicationCommandOptionType.Channel, name: "destination", description: "Salon privé de l'équipe, où arrivent les avis", required: true, channel_types: [ChannelType.GuildText] },
          { type: ApplicationCommandOptionType.Channel, name: "bouton", description: "Salon dédié où le bot pose le bouton « Donner mon avis » (il le verrouille)", required: false, channel_types: [ChannelType.GuildText] },
          { type: ApplicationCommandOptionType.Boolean, name: "anonyme", description: "Autoriser les avis anonymes (oui par défaut)", required: false },
        ],
      },
      { type: ApplicationCommandOptionType.Subcommand, name: "retirer", description: "Désactive les avis et retire le bouton" },
    ],
  },
];
