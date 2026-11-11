import { ApplicationCommandOptionType, ApplicationCommandType, ChannelType, InteractionContextType, PermissionFlagsBits, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

/**
 * Description d'une commande ou d'une option : en anglais pour Discord en anglais (et toute autre langue), en français pour
 * Discord en français ; comme les réponses du bot sans guilde connue. Les noms des commandes et des options restent en français.
 */
const d = (fr: string, en: string) => ({ description: en, description_localizations: { fr } });

/** Commandes slash du bot (enregistrées au démarrage). Raids : droits vérifiés par le site (officier du groupe). Avis : Gérer le serveur. */
export const COMMANDS: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: "forever-lier",
    ...d("Lie ce salon à une guilde Forever Roster : raids, sorties ou commandes (code donné par le site).", "Links this channel to a Forever Roster guild: raids, runs or orders (code given by the website)."),
    contexts: [InteractionContextType.Guild],
    options: [{ type: ApplicationCommandOptionType.String, name: "code", ...d("Code affiché sur la page de la guilde (valable 30 min)", "Code shown on the guild's page (valid 30 min)"), required: true, min_length: 6, max_length: 32 }],
  },
  {
    // Même commande pour Roster (WoW Retail) : un seul bot, deux sites
    type: ApplicationCommandType.ChatInput,
    name: "roster-lier",
    ...d("Lie ce salon à une guilde Roster ou Forever Roster : raids ou commandes (code donné par le site).", "Links this channel to a Roster or Forever Roster guild: raids or orders (code given by the website)."),
    contexts: [InteractionContextType.Guild],
    options: [{ type: ApplicationCommandOptionType.String, name: "code", ...d("Code affiché sur la page de la guilde (valable 30 min)", "Code shown on the guild's page (valid 30 min)"), required: true, min_length: 6, max_length: 32 }],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "raid",
    ...d("Crée un raid dans la guilde liée à ce salon (officiers).", "Creates a raid in the guild linked to this channel (officers)."),
    contexts: [InteractionContextType.Guild],
    options: [
      { type: ApplicationCommandOptionType.String, name: "nom", ...d("Ex. Molten Core", "E.g. Molten Core"), required: true, min_length: 2, max_length: 60 },
      { type: ApplicationCommandOptionType.String, name: "date", ...d("JJ/MM/AAAA HH:MM, heure de Paris (ex. 12/11/2026 21:00)", "DD/MM/YYYY HH:MM, Paris time (e.g. 12/11/2026 21:00)"), required: true, max_length: 40 },
      { type: ApplicationCommandOptionType.String, name: "description", ...d("Consignes, point de rendez-vous…", "Instructions, meeting point…"), required: false, max_length: 1000 },
    ],
  },
  {
    // Sorties donjon (WoW Forever) : droits vérifiés par le site (réglage « Qui peut créer des sorties » du groupe)
    type: ApplicationCommandType.ChatInput,
    name: "sortie",
    ...d("Propose une sortie donjon (groupe de 5, aujourd'hui ou demain) à la guilde liée à ce salon.", "Proposes a dungeon run (group of 5, today or tomorrow) to the guild linked to this channel."),
    contexts: [InteractionContextType.Guild],
    options: [
      { type: ApplicationCommandOptionType.String, name: "donjon", ...d("Ex. Gnomeregan, ou un titre libre (quête de groupe, élite…)", "E.g. Gnomeregan, or a free title (group quest, elite…)"), required: true, autocomplete: true, max_length: 60 },
      { type: ApplicationCommandOptionType.String, name: "heure", ...d("Ex. 21:00, demain 20:30, dès que complet (heure de Paris)", "E.g. 21:00, tomorrow 20:30, as soon as full (Paris time)"), required: true, autocomplete: true, max_length: 40 },
      { type: ApplicationCommandOptionType.String, name: "note", ...d("Facultatif : quêtes, point de rendez-vous… (80 caractères)", "Optional: quests, meeting point… (80 characters)"), required: false, max_length: 80 },
    ],
  },
  // Signalements du site (bug, idée, question) : le salon privé des admins du site
  {
    type: ApplicationCommandType.ChatInput,
    name: "signalements-lier",
    ...d("Fait arriver ici les signalements du site : bugs, idées, questions (admins du site).", "Sends the website's reports here: bugs, ideas, questions (website admins)."),
    contexts: [InteractionContextType.Guild],
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  },
  // Avis : fonction autonome, pour n'importe quel serveur (sans groupe du site ni addon)
  {
    type: ApplicationCommandType.ChatInput,
    name: "feedback",
    ...d("Donne ton avis à l'équipe du serveur, signé ou anonyme (par message privé).", "Give your feedback to the server's team, signed or anonymous (by direct message)."),
    contexts: [InteractionContextType.Guild],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: "feedback-config",
    ...d("Règle les avis de ce serveur : salon de l'équipe, salon du bouton, anonymat.", "Sets up feedback on this server: team channel, button channel, anonymity."),
    contexts: [InteractionContextType.Guild],
    default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand, name: "regler", ...d("Active les avis, ou change leurs réglages", "Turns feedback on, or changes its settings"),
        options: [
          { type: ApplicationCommandOptionType.Channel, name: "destination", ...d("Salon privé de l'équipe, où arrivent les avis", "The team's private channel, where feedback arrives"), required: true, channel_types: [ChannelType.GuildText] },
          { type: ApplicationCommandOptionType.Channel, name: "bouton", ...d("Salon dédié où le bot pose le bouton « Donner mon avis » (il le verrouille)", "Dedicated channel where the bot posts the “Give my feedback” button (it locks it)"), required: false, channel_types: [ChannelType.GuildText] },
          { type: ApplicationCommandOptionType.Boolean, name: "anonyme", ...d("Autoriser les avis anonymes (oui par défaut)", "Allow anonymous feedback (yes by default)"), required: false },
          // Suivi sur le site (facultatif) : groupe déjà lié à ce serveur ; absent = on garde le réglage actuel
          { type: ApplicationCommandOptionType.String, name: "site", ...d("Site de la guilde qui suit les avis (filtre la liste des guildes)", "Website of the guild that tracks feedback (filters the guild list)"), required: false,
            choices: [{ name: "Forever Roster", value: "forever" }, { name: "Roster", value: "retail" }] },
          { type: ApplicationCommandOptionType.String, name: "guilde", ...d("Guilde du site qui suit les avis (Administration → Avis), liée à ce serveur", "Website guild that tracks feedback (Administration → Feedback), linked to this server"), required: false, autocomplete: true },
        ],
      },
      { type: ApplicationCommandOptionType.Subcommand, name: "retirer", ...d("Désactive les avis et retire le bouton", "Turns feedback off and removes the button") },
    ],
  },
];
