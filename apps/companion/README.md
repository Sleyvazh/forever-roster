# Roster Companion

Appli de bureau (en option) qui fait la synchro entre l'addon Forever Roster et le site, sans copier-coller. Windows d'abord ; une seule appli pour Forever Roster et Roster (Retail, quand son addon existera). Le copier-coller reste la voie par défaut.

- **Du jeu vers le site** : dès que le jeu écrit la sauvegarde de l'addon (`/reload`, déconnexion), l'appli la lit (sans l'exécuter) et envoie les persos et le bilan du chef de raid à `POST /api/sync/upload`. Un perso que le site ne connaît pas attend la réponse du joueur (« Créer la fiche » ou « Ignorer »).
- **Du site vers le jeu** : toutes les minutes pendant que le jeu tourne, sinon toutes les 5 minutes (1, 5 ou 15 au choix), `GET /api/sync/frg` avec ETag ; les données sont écrites dans l'addon `ForeverRoster_Data` (lu à la connexion) et dans 20 copies chargées à la demande (`ForeverRoster_Data1` à `20`) : l'addon 1.5 en charge une aux moments utiles (fenêtre, avant un raid, appel, entrée en raid) ou à la demande, sans `/reload`. Notification « nouveautés prêtes » en option (ce qui a changé : `core/src/frg.rs`).
- **Appairage** par code validé sur le site (aucun mot de passe dans l'appli) ; jeton de l'appareil dans le Gestionnaire d'identification de Windows, jamais dans un fichier ni dans le journal.

Formats : [docs/addon-format.md](../../docs/addon-format.md), section Roster Companion. Sécurité : [SECURITY.md](../../SECURITY.md).

## Organisation

```
apps/companion/
  core/          rc-core : tout ce qui se teste sans fenêtre (Rust)
    src/lua.rs       lecteur de SavedVariables (données seulement, profondeur bornée, jamais exécutées)
    src/outbox.rs    blocs à envoyer rangés par l'addon (ForeverRosterDB.outbox)
    src/datafile.rs  ForeverRoster_Data et ses copies (chaînes Lua échappées octet par octet, écriture atomique)
    src/frg.rs       ce qui a changé entre deux relevés (notification « nouveautés prêtes »)
    src/wow.rs       dossiers du jeu (.build.info, registre de Blizzard, disques), comptes, addon installé
    src/api.rs       client HTTP du site (TLS du système, proxy de Windows, HTTPS obligatoire hors tests)
    src/sync.rs      moteur : file d'envoi, accusés, persos inconnus, nouvel essai progressif, relevé avec ETag
    src/state.rs     état et options (state.json, écrit de façon atomique ; un fichier abîmé est mis de côté)
    tests/roundtrip.rs  aller-retour avec l'addon simulé (addon/tests/wow_sim.lua, Lua 5.1)
    examples/live_check.rs  bout en bout contre un vrai site de test
  src-tauri/     l'appli (Tauri 2) : icône près de l'horloge, fenêtre, boucle de fond, commandes de l'interface
  src/           l'interface (React 19), avec un faux backend pour les aperçus (?ecran=…)
```

La boucle de fond (`src-tauri/src/runner.rs`) tourne toutes les 5 secondes et dès qu'une sauvegarde de l'addon change (surveillance du dossier `SavedVariables`) : dossiers du jeu relus chaque minute, jeu lancé ou non, puis envoi, relevé si dû, écriture de `ForeverRoster_Data` si son contenu a changé (ou toutes les 12 h). Rien n'est envoyé ni écrit avant la fin de l'installation (« Installer et terminer »). Une passe travaille sur une copie de l'état puis la réinscrit : toute autre modification de l'état de synchro passe par le même verrou, et « Synchroniser maintenant » est une demande que la passe suivante prend (l'en-tête de `runner.rs` explique).

## 0.3.0

Ce qui change pour toi (fiabilité) :

- **Un bloc que le site refuse n'est plus renvoyé en boucle.** Un perso ou un bilan resté sans réponse du site (export illisible, lot trop gros…) attend avant d'être renvoyé (30 s, 1 min, 2… jusqu'à 15 min) et la raison s'affiche dans « Vers le site », avec l'heure du prochain essai. Les envois sont découpés par 50 persos (limite du site). « Dernier envoi » n'avance que quand le site a reçu quelque chose.
- **Sauvegarde illisible :** l'appli ne la relit plus toutes les 5 secondes. Une sauvegarde en cours d'écriture est relue au passage suivant sans rien dire ; une sauvegarde vraiment abîmée est signalée une fois (« Elle sera relue quand le jeu la réécrira ») et relue dès que le jeu l'écrit de nouveau. Avec plusieurs comptes WoW, la boîte Addon montre une ligne par compte (dernière sauvegarde lue, erreur éventuelle).
- **« Synchroniser maintenant », « Ne plus ignorer », « Créer la fiche » ne sont plus perdus** quand une synchro est en cours : le bouton dit « En attente de la synchro en cours… » et la demande est prise juste après.
- **Moins de fausses alertes :** un `Data.lua` verrouillé un instant par le jeu est simplement réessayé 5 s plus tard (erreur seulement après trois échecs de suite, effacée dès que l'écriture réussit). Si WoW se ferme sans avoir écrit sa sauvegarde (plantage), la boîte Addon le dit : ce qui a été fait en jeu partira à la prochaine déconnexion normale. « Jusqu'à demain » (pause) se termine à 6 h, heure du PC.
- Plusieurs dossiers du même jeu : `_classic_` / `_retail_` sont préférés aux dossiers bêta et PTR tant que tu n'en as pas choisi un.

## Tests

```bash
cd apps/companion
cargo test -p rc-core            # cœur + aller-retour avec l'addon (lua5.1 requis sur la CI)
cargo clippy --workspace --all-targets -- -D warnings
npm ci && npx tsc --noEmit -p .  # interface
npm run dev                      # aperçus sans Tauri : http://localhost:1420/?ecran=principal (appairage, dossiers, probleme, inconnus, options, journal)
```

Bout en bout contre le site de test (`node e2e/start.mjs` à la racine) : `RC_SITE=http://localhost:4173 RC_RAID=<id d'un raid> RC_GROUP=<nom du groupe> cargo run -p rc-core --example live_check`, puis valider le code affiché sur le site.

En version de développement, `ROSTER_COMPANION_FOREVER` et `ROSTER_COMPANION_RETAIL` changent l'adresse des sites (ignorées dans la version publiée).

## Installateur Windows

La CI (`.github/workflows/companion.yml`) construit l'installateur sur Windows à chaque changement de `apps/companion` ou de l'addon : onglet **Actions** du dépôt, run « Roster Companion », section **Artifacts**, `roster-companion-windows` (zip contenant `Roster Companion_x.y.z_x64-setup.exe`). Installation pour l'utilisateur seulement (pas besoin d'être administrateur), WebView2 installé si besoin. Pendant la bêta, l'installateur n'est pas signé : Windows SmartScreen affiche « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même ».

Construire sur son PC (Windows) :

1. [Rust](https://rustup.rs) (toolchain MSVC) et les **Build Tools de Visual Studio** (charge de travail « Développement Desktop en C++ ») ;
2. Node 24 ;
3. dans `apps\companion` : `npm ci`, puis `npx tauri build --bundles nsis` ; l'installateur est dans `target\release\bundle\nsis\`.

Pour développer avec l'appli réelle : `npx tauri dev` (interface rechargée à chaud, journal dans `%LOCALAPPDATA%\fr.sleyvazh.rostercompanion\logs`, état dans `%APPDATA%\fr.sleyvazh.rostercompanion\state.json`).
