# Roster changelog

Envoyé sur CurseForge avec chaque version (scripts/curseforge.mjs lit la section « ## <version> ») : anglais d'abord, comme le demande CurseForge, puis français. Ce fichier n'est pas dans le zip de l'addon.

## 0.3.3

- **Shared data**: one player pastes "Copier pour le jeu" (or receives it from the Roster Companion app) and the addon passes the group data to every guildmate and raid member who has the addon. The website signs the data and each addon checks the signature: data changed by anyone, even by one character, is refused. Option in the Options tab (on by default); the Sync tab says where your data comes from.
- Council: BiS, Upgrade and Off-spec only for weapons your class can use (exact weapon types, shields and off-hand items); otherwise only Transmog or Pass. A whispered "bis" for such a weapon counts as Transmog, and the council greys it out.

Français :

- **Données partagées** : un seul joueur colle « Copier pour le jeu » (ou les reçoit de l'appli Roster Companion), et l'addon transmet les données du groupe à tous ceux de la guilde et du raid qui ont l'addon. Le site signe les données et chaque addon vérifie la signature : des données modifiées par quelqu'un, même d'un seul caractère, sont refusées. Option dans l'onglet Options (activée par défaut) ; l'onglet Synchro dit d'où viennent tes données.
- Conseil : BiS, Upgrade et Off-spec seulement pour les armes que ta classe peut porter (type d'arme exact, boucliers et objets de main gauche) ; sinon seulement Transmo ou Passer. Un « bis » chuchoté pour une telle arme compte comme Transmo, et le conseil le grise.

## 0.3.2

- The interface follows the game client's language: French on a French client, English otherwise. Options tab, "Language" (or `/roster language fr | en | auto`) to pick another one; it applies after a UI reload.
- English names for the commands (`/roster loot`, `/roster handover`, `/roster sync`, `/roster inraid`, `/roster comp`…); the French ones still work.
- Players without the addon can whisper their answer in English too: bis, up / upgrade, os / off / offspec, transmog / tmog, pass, followed by the item number when several items are open ("upgrade 2").
- Raid announcements and whispers are sent in the loot master's language. Data sent to the website does not change.

Français :

- L'interface suit la langue du client du jeu : français sur un client en français, anglais sinon. Onglet Options, « Langue » (ou `/roster langue fr | en | auto`) pour en choisir une autre ; elle s'applique après un rechargement de l'interface.
- Les commandes ont aussi leur nom anglais (`/roster loot`, `/roster handover`, `/roster sync`, `/roster inraid`, `/roster comp`…) ; les noms français marchent toujours.
- Les joueurs sans l'addon peuvent chuchoter leur réponse en anglais aussi : bis, up / upgrade, os / off / offspec, transmog / tmog, pass, suivi du numéro de l'objet quand il y en a plusieurs (« upgrade 2 »).
- Annonces au raid et chuchotements partent dans la langue du chef de butin. Rien ne change dans ce qui part au site.

## 0.3.1

- Every awarded item is now recorded in the raid summary, even when recording was paused at that moment (after a `/reload`); missed awards are caught up before the export.
- Only equipment is recorded as loot (no more Sparks or crafting reagents).

Français :

- Chaque objet donné est noté dans le bilan, même si le relevé était en pause à ce moment-là (après un `/reload`) ; les oublis sont rattrapés avant l'export.
- Seul l'équipement est relevé (plus les Étincelles ni les composants).

## 0.3.0

- **All to council**: every item of a boss goes to the council at once, with a single numbered announcement; players without the addon whisper "bis 2".
- An item strip at the top of the answer and council windows switches between items.
- You can only ask for items you can use (exact armour type, red tooltip lines); otherwise only Transmog or Pass.
- The council's "Received" column shows the detail (BiS, Upgrade, MS rolls) and leaves out off-spec, transmog and kept items.
- Trading: awarded items are placed in the trade window as soon as it opens with the winner, whoever opened it.

Français :

- **Tout au conseil** : tous les objets d'un boss partent au conseil d'un coup, avec une seule annonce numérotée ; sans l'addon, on chuchote « bis 2 ».
- Une bande d'objets en haut des fenêtres de réponse et du conseil pour passer d'un objet à l'autre.
- On ne peut demander que les objets qu'on peut porter (type d'armure exact, lignes rouges de l'infobulle) ; sinon seulement Transmo ou Passer.
- La colonne « Reçus » du conseil donne le détail (BiS, Upgrade, jets MS) et ne compte plus off-spec, transmo ni objets gardés.
- Échange : les objets du gagnant sont posés tout seuls dès que la fenêtre d'échange s'ouvre avec lui, quel que soit celui qui l'ouvre.

## 0.2.1

- The loot master relays every answer to the council: only the loot master and council members need the website data.

Français :

- Le chef de butin relaie chaque réponse au conseil : seuls lui et les membres du conseil ont besoin des données du site.

## 0.2.0

- Loot distribution like a loot council: loot master, automatic pass on group loot, council (answers with equipped items, votes), MS / OS rolls with re-rolls of ties, free roll, keep; raid announcements and whispers to winners; items to trade with their timer; players without the addon flagged to the loot master.
- Awards go into the raid summary for the website.
- Solo test raid: `/roster test`.

Français :

- Distribution du butin façon conseil : chef de butin, passer automatique au butin de groupe, conseil (réponses avec les objets portés, votes), jets MS / OS avec relance des ex æquo, jet libre, garder ; annonces au raid et chuchotement au gagnant ; objets à remettre avec leur minuteur ; joueurs sans l'addon signalés au chef de butin.
- Les attributions partent dans le bilan du raid pour le site.
- Raid d'essai en solo : `/roster test`.

## 0.1.0

- First version: raid composition and invites from the Roster website, raid groups, addon version check, attendance and loot recording, raid summary for the website, quick sync window, minimap button, game or website skin.

Français :

- Première version : compo et invitations depuis le site Roster, groupes du raid, versions de l'addon, relevé de la présence et du butin, bilan du raid pour le site, synchro rapide, bouton de la minicarte, habillage du jeu ou du site.
