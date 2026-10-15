# Forever Roster changelog

Envoyé sur CurseForge avec chaque version (scripts/curseforge.mjs lit la section « ## <version> ») : anglais d'abord, comme le demande CurseForge, puis français. Ce fichier n'est pas dans le zip de l'addon.

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
