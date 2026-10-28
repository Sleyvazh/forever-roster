# Forever Roster changelog

Envoyé sur CurseForge avec chaque version (scripts/curseforge.mjs lit la section « ## <version> ») : anglais d'abord, comme le demande CurseForge, puis français. Ce fichier n'est pas dans le zip de l'addon.

## 1.6.3

- **In-game sign-ups reach the website without copy-paste**: if you don't have Roster Companion, the sign-up you make in game (Raids tab, raid reminder) is handed to a guild officer who has the app, and it goes to the website at their next /reload. The Raids tab says who took it ("handed to Brakka"), or that no officer with the app is online yet (it goes as soon as one is, or with your export). Copy-paste still works. Setting: "Hand my in-game sign-ups to an officer who has Roster Companion" (Options tab, on by default).
- **Officers with Roster Companion** pass these sign-ups on to the website: a small "Send to website" window (never in combat or in an instance, at most every 30 minutes) offers to reload the interface; otherwise they go at your next /reload or logout. The website still checks everything (officer, guild member, the player's own setting on the website) and keeps the last word. Setting: "Pass the guild's sign-ups on to the website" (Options tab, on by default).
- The website's data now carries the list of who signed up for each raid (with the time of their last status change). Data shared by a guildmate therefore shows your own sign-up (and "no sign-up" rather than "unknown"); a change made on the website after your in-game click wins.
- When you log in, the addon asks your guild who has the website's data, so you get it even if you logged in after it was announced. With Roster Companion, the automatic refresh now runs every 15 minutes (it was every hour).
- Whispers between addons (asking a guildmate for their data, "received" answers to a sign-up) now go to the full name the game gives (name and realm), so they still arrive when your guild mixes several servers.
- **New `/fr share`**: a small window with what the addon received, shared, handed over or relayed during the session: each loaded group (where its data comes from, its version, signed by the website or why not, sign-up list present), your settings (sharing, handing over, relaying and why not), the server time's offset from your PC clock and a log of the last 40 steps. "Copy" selects everything, to paste to whoever is helping you.

Français :

- **Inscriptions faites en jeu envoyées au site sans copier-coller** : si tu n'as pas Roster Companion, ton inscription faite en jeu (onglet Raids, rappel de raid) est confiée à un officier de la guilde qui a l'appli ; elle part au site à son prochain /reload. L'onglet Raids dit à qui elle est confiée (« confiée à Brakka »), ou qu'aucun officier avec l'appli n'est en ligne (elle partira dès qu'il y en aura un, ou avec ton export). Le copier-coller marche toujours. Réglage : « Confier mes inscriptions faites en jeu à un officier qui a Roster Companion » (onglet Options, activé d'office).
- **Officiers avec Roster Companion** : ils transmettent ces inscriptions au site. Une petite fenêtre « Envoyer au site » (jamais en combat ni en instance, au plus toutes les 30 minutes) propose de recharger l'interface ; sinon elles partent au prochain /reload ou à la déconnexion. Le site vérifie tout (officier, membre de la guilde, réglage du joueur sur le site) et garde le dernier mot. Réglage : « Transmettre au site les inscriptions de la guilde » (onglet Options, activé d'office).
- Les données du site portent maintenant la liste des inscrits de chaque raid (avec l'heure de leur dernier changement de statut). Celles reçues d'un guildé montrent donc ton inscription (et « pas d'inscription » plutôt qu'« inconnue ») ; un changement fait sur le site après ton clic en jeu l'emporte.
- À la connexion, l'addon demande à ta guilde qui a les données du site : tu les reçois même en te connectant après leur annonce. Avec Roster Companion, l'actualisation toute seule passe à toutes les 15 minutes (au lieu de toutes les heures).
- Les chuchotements entre addons (demande des données à un guildé, réponse « reçue » à une inscription) partent maintenant au nom complet que le jeu donne (prénom et royaume) : ils arrivent encore quand ta guilde mêle plusieurs serveurs.
- **Nouveau `/fr partage`** : une petite fenêtre avec ce que l'addon a reçu, partagé, confié ou relayé pendant la session : chaque groupe chargé (d'où viennent ses données, sa version, signé par le site ou pourquoi pas, liste des inscrits présente), tes réglages (partage, confier, relais et pourquoi pas), le décalage de l'heure du serveur avec l'horloge du PC et le journal des 40 dernières étapes. « Copier » sélectionne tout, pour le coller à qui t'aide.

## 1.6.2

- **Guild scan sent to the website**: the guild scan (roster, guild log, guild bank, your characters' levels) now goes to the website with your sync: after your characters and raid logs in the text you copy (Sync tab, quick sync), and through Roster Companion. It only goes again when something has really changed (not just time passing). `/fr guild` shows when it was last sent.
- Your character's export now carries its game identifier and its full name (first name and Forever surname) when the addon knows them, so the website can tell your characters apart even when two of them share a first name.

Français :

- **Relevé de la guilde envoyé au site** : le relevé de la guilde (liste, journal de guilde, banque, niveaux de tes persos) part maintenant au site avec ta synchro : après tes persos et tes bilans dans le texte à copier (onglet Synchro, synchro rapide), et par Roster Companion. Il ne repart que s'il a vraiment changé (pas seulement parce que le temps passe). `/fr guilde` dit quand il a été envoyé.
- L'export de ton perso donne maintenant son identifiant du jeu et son nom complet (prénom et nom de famille de Forever) quand l'addon les connaît : le site reconnaît ainsi tes persos, même deux qui ont le même prénom.

## 1.6.1

- **Dungeon runs in game**: the new Runs tab (`/fr runs`) shows today's and tomorrow's dungeon runs from your groups on the website: open places by role, who signed up, waiting list and note, with your own characters recognised. 15 minutes before the start (or as soon as an "as soon as full" run is full), a small banner shows up once per run: "Invite all 4" if you created it (characters only, out of combat; Discord-only sign-ups are listed to invite manually), "Whisper <creator>" if you signed up (it only opens the whisper box). Never in combat or during an encounter, and nothing is sent to other players. Signing up is done on the website or on Discord.

Français :

- **Sorties donjon en jeu** : le nouvel onglet Sorties (`/fr sorties`) montre les sorties du jour et de demain de tes groupes du site : places par rôle, inscrits, liste d'attente et note, avec tes persos reconnus. 15 minutes avant l'heure (ou dès qu'une sortie « dès que complet » est complète), un petit bandeau s'affiche une fois par sortie : « Inviter les 4 » si tu l'as créée (les persos seulement, hors combat ; les inscrits Discord sans compte sont à inviter à la main), « Chuchoter <créateur> » si tu es inscrit (ça ouvre seulement la saisie du chuchotement). Jamais en combat ni pendant une rencontre, et rien n'est envoyé aux autres joueurs. L'inscription se fait sur le site ou sur Discord.

## 1.6.0

- **Guild scan (trial)**: the addon now quietly reads your guild: roster (rank, level, class, notes, last online; officer notes only if your rank can see them), guild log, guild bank (only while you have it open: visible tabs, gold and logs) and your characters' level and XP, with the exact time of each level-up. Never in combat or during a boss encounter. Nothing is sent yet, neither to the website nor to other players: `/fr guild` shows what was read and gives the text to copy ("Copy the scan").

Français :

- **Relève de la guilde (en essai)** : l'addon relève maintenant ta guilde en silence : liste (rang, niveau, classe, notes, dernière connexion ; notes d'officier seulement si ton rang les voit), journal de guilde, banque de guilde (seulement pendant que tu l'as ouverte : onglets visibles, or et journaux), niveau et XP de tes persos, avec l'heure exacte de chaque montée de niveau. Jamais en combat ni pendant une rencontre de boss. Rien n'est encore envoyé, ni au site ni aux autres joueurs : `/fr guilde` montre ce qui a été relevé et donne le texte à copier (« Copier le relevé »).

## 1.5.9

- Data from Roster Companion no longer overwrites a newer version received from a guildmate: each group keeps its newest version (your own sign-up and character still come from your latest data). After a refresh, the addon only announces its data to the guild and raid when a group actually came from the app.

Français :

- Les données de Roster Companion n'écrasent plus une version plus récente reçue d'un guildé : chaque groupe garde sa version la plus récente (ton inscription et ton perso viennent toujours de tes dernières données). Après une actualisation, l'addon n'annonce ses données à la guilde et au raid que si un groupe vient vraiment de l'appli.

## 1.5.8

- Fix for "attempt to index a secret string value (execution tainted by 'ForeverRoster')": in instances the game now hides some values (the identity of the targeted NPC, chat during a boss fight). The addon checks them first and does without. In those places the boss sheet no longer opens when you target the boss: `/fr boss` shows it. Rolls and whispers hidden during a boss fight are reported once to the loot master.

Français :

- Correctif de « attempt to index a secret string value (execution tainted by 'ForeverRoster') » : en instance, le jeu cache désormais certaines valeurs (identité du PNJ ciblé, chat pendant un combat de boss). L'addon les vérifie avant et s'en passe. Là où c'est le cas, la fiche du boss ne s'ouvre plus en ciblant le boss : `/fr boss` l'affiche. Les jets et chuchotements cachés pendant un combat de boss sont signalés une fois au maître du butin.

## 1.5.7

- **Shared data**: one player pastes "Copier pour le jeu" (or receives it from the Roster Companion app) and the addon passes the group data to every guildmate and raid member who has the addon. The website signs the data and each addon checks the signature: data changed by anyone, even by one character, is refused. Groups with a hidden soft reserve are not shared (each player sees only their own reserves). Option in the Options tab (on by default); the Sync tab says where your data comes from.

Français :

- **Données partagées** : un seul joueur colle « Copier pour le jeu » (ou les reçoit de l'appli Roster Companion), et l'addon transmet les données du groupe à tous ceux de la guilde et du raid qui ont l'addon. Le site signe les données et chaque addon vérifie la signature : des données modifiées par quelqu'un, même d'un seul caractère, sont refusées. Les groupes avec une soft reserve cachée ne sont pas partagés (chacun ne voit que ses réserves). Option dans l'onglet Options (activée par défaut) ; l'onglet Synchro dit d'où viennent tes données.

## 1.5.6

- The interface follows the game client's language: French on a French client, English otherwise. Options tab, "Language" (or `/fr language fr | en | game`) to pick another one; it applies after a UI reload.
- English names for the commands (`/fr loot`, `/fr sync`, `/fr inraid`, `/fr comp`, `/fr recipes`…); the French ones still work.
- Players without the addon can whisper their council answer in English too (upgrade, offspec, transmog, pass…).
- Raid announcements and whispers are sent in the loot master's language. Data sent to the website does not change.

Français :

- L'interface suit la langue du client du jeu : français sur un client en français, anglais sinon. Onglet Options, « Langue » (ou `/fr langue fr | en | jeu`) pour en choisir une autre ; elle s'applique après un rechargement de l'interface.
- Les commandes ont aussi leur nom anglais (`/fr loot`, `/fr sync`, `/fr inraid`, `/fr comp`, `/fr recipes`…) ; les noms français marchent toujours.
- Les joueurs sans l'addon peuvent chuchoter leur réponse au conseil en anglais aussi (upgrade, offspec, transmog, pass…).
- Annonces au raid et chuchotements partent dans la langue du maître du butin. Rien ne change dans ce qui part au site.

## 1.5.0 – 1.5.5

- Smoother sync with the optional Roster Companion app (updates loaded without `/reload`, hourly refresh, "Send now"), item tooltips everywhere in the addon, fix for "ForeverRoster has been blocked", sign-ups made in game no longer overwrite later changes on the website, toolbox shared with the Roster addon.

Français :

- Synchro plus fluide avec l'appli Roster Companion (en option : nouveautés chargées sans `/reload`, actualisation toutes les heures, « Envoyer maintenant »), infobulles des objets partout dans l'addon, correctif de « ForeverRoster has been blocked », inscriptions faites en jeu qui n'écrasent plus un changement fait ensuite sur le site, boîte à outils commune avec l'addon Roster.

## 1.0.0 – 1.4.0

- In-game loot: loot master window (soft reserve with SR+ bonus, MS / OS rolls, free roll, council with private votes), boss sheet when targeting a boss, consumables call, solo test raid (`/fr test`), role icons, council as a resizable grid with a "Received" column, Forever item names, preparation for the Roster Companion app.

Français :

- Butin en jeu : fenêtre du maître du butin (soft reserve avec bonus SR+, jets MS / OS, jet libre, conseil avec votes privés), fiche du boss en le ciblant, appel aux consommables, raid d'essai seul (`/fr test`), icônes de rôle, conseil en tableau redimensionnable avec la colonne « Reçus », noms des objets de Forever, préparation de l'appli Roster Companion.

## 0.1 – 0.9.0

- First versions: raid comp, invites and group placement, character export to the website (gear, professions, talents), sign-ups in game, recipes wanted / known, one window with tabs and a minimap button, quick sync (one key, Ctrl+C / Ctrl+V), Options tab, raid reminder at login, attendance and loot log for the website, Forever and website skins.

Français :

- Premières versions : compo du raid, invitations et placement des groupes, export du perso vers le site (équipement, métiers, talents), inscriptions en jeu, patrons recherchés / connus, une fenêtre à onglets et un bouton de minicarte, synchro rapide (une touche, Ctrl+C / Ctrl+V), onglet Options, rappel de raid à la connexion, relevé de la présence et du butin pour le site, habillages Forever et site.
