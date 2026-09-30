# Forever Roster

**En ligne : https://forever-roster.sleyvazh.fr**

Application web pour préparer **WoW Forever** (sortie le 4 novembre 2026) en guilde : chaque joueur gère ses personnages, les officiers composent les raids de 40 et voient en direct quels buffs et debuffs manquent.

Le projet sert aussi de vitrine : l'authentification et la gestion des sessions sont écrites à la main, testées, et documentées dans [SECURITY.md](SECURITY.md).

![Composition d'un raid avec la couverture des buffs](docs/screenshots/02-raid.png)

## Fonctionnalités

- **Comptes** : inscription par e-mail avec confirmation, connexion Battle.net (OAuth 2.0), réinitialisation du mot de passe, suppression du compte (RGPD).
- **Personnages** : race et classe (combinaisons propres à Forever), spé principale et off-spec avec leur build (y compris les spés de niche comme Feral Bear ou Enhancement Tank ; import d'un lien du calculateur ForeverChanges, arbres en jauges ou en grille), métiers et bonus Forever, patrons connus ou recherchés, équipement actuel et BiS choisis dans la base d'objets du jeu (infobulles comme en jeu avec icône, comparaison Équipé / BiS et « Où l'obtenir » pour les objets fabriqués), perks Legacy, notes. Sauvegarde automatique et réordonnancement par glisser-déposer.
- **Groupes** : rôles propriétaire / officier / membre, liens d'invitation à durée et nombre d'utilisations limités, transfert de propriété, onglet Artisans (« qui sait fabriquer quoi ? », pour savoir à qui envoyer les composants).
- **Raids** : 8 groupes de 5, banc des persos du groupe (au survol : métiers, niveau d'objet moyen et BiS obtenus), déplacement et échange de places, compteur tanks / heals / DPS, couverture des 42 buffs, auras, debuffs et utilitaires (avec détection des groupes où une aura manque).
- **Inscriptions et bot Discord** : Présent, En retard, Peut-être, Reroll, Banc ou Absent, avec perso et spé pour le raid. Un bot sur le modèle de Raid-Helper publie chaque raid dans un salon, avec des boutons d'inscription (compte lié ou inscription libre) `/raid` pour créer un raid depuis Discord, raids récurrents hebdomadaires, rappel en message privé la veille, compo publiée dans l'annonce, et export pour addon (format documenté dans `docs/addon-format.md`) avec macros `/inv`.
- **En direct** : inscriptions, compo, persos et groupes se mettent à jour sans recharger la page ; deux officiers peuvent modifier la même compo, leurs changements sont fusionnés.
- **Sécurité visible** : sessions actives révocables, journal de sécurité personnel, journal d'activité du groupe pour les officiers.

## Stack

| Couche | Choix |
|---|---|
| API | Node 24, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 16, zod |
| Front | React 19, Vite, React Router, TanStack Query |
| Données de jeu | paquet `@forever/game-data` partagé entre l'API et le front |
| Infra | Docker Compose, Caddy (HTTPS automatique, en-têtes de sécurité) |
| Qualité | Vitest (tests d'intégration contre un vrai Postgres), GitHub Actions, CodeQL, Dependabot |

```
apps/api            API Fastify (routes, sessions, migrations SQL)
apps/web            Front React
apps/bot            Bot Discord (discord.js) : annonces et inscriptions, via l'API interne
packages/game-data  Races, classes, métiers, règles de buffs de raid
infra/Caddyfile     Reverse proxy + CSP
docs/               Architecture, exploitation
scripts/deploy.sh   Déploiement en production
```

## Lancer en local

Prérequis : Node 24 et Docker.

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d   # Postgres + Mailpit
npm install
npm run db:migrate
npm run dev                                       # API :3000, front :5173
```

Ouvre http://localhost:5173. Les e-mails de confirmation arrivent dans Mailpit (http://localhost:8025) et s'affichent aussi dans la console de l'API.

Pour activer Battle.net, crée un client sur https://develop.battle.net/access/clients, déclare l'URL de redirection `http://localhost:5173/api/auth/battlenet/callback` et remplis `BNET_CLIENT_ID` / `BNET_CLIENT_SECRET`.

## Tests

```bash
createdb forever_test   # ou via Docker
DATABASE_URL_TEST=postgres://forever:forever@localhost:5432/forever_test npm test
```

Les tests de l'API passent par Fastify (`inject`) avec une vraie base Postgres. Ils couvrent en particulier :

- la confirmation d'e-mail obligatoire et les liens à usage unique ;
- l'absence d'énumération de comptes (inscription, mot de passe oublié, messages d'erreur identiques) ;
- le verrouillage après 10 échecs ;
- le rejet des requêtes sans jeton CSRF ou venant d'une autre origine ;
- la révocation des sessions (déconnexion, réinitialisation, « fermer les autres sessions ») ;
- la vérification Have I Been Pwned (seul un préfixe du hash quitte le serveur) ;
- le flux OAuth Battle.net et le rejet d'un `state` qui ne vient pas du navigateur ;
- le contrôle d'accès des personnages, des groupes et des raids ;
- un seul lien de réinitialisation valide à la fois ;
- le traitement des images envoyées (ré-encodage, métadonnées supprimées, fichiers piégés refusés).

### De bout en bout (Playwright)

```bash
npm run build
createdb forever_e2e
DATABASE_URL_E2E=postgres://forever:forever@localhost:5432/forever_e2e npm run test:e2e
```

Un vrai navigateur rejoue le parcours d'un joueur : inscription, fiche, portrait, patrons, équipement, groupe. Le site testé est la version construite pour la production, servie avec les mêmes en-têtes que Caddy (lus dans `infra/Caddyfile`). Toute erreur JavaScript ou violation de la CSP fait échouer le test. C'est ce filet qui manquait quand un envoi d'image fonctionnait en développement mais pas en production.

Les captures de `docs/screenshots` se régénèrent de la même façon, avec des joueurs et des persos fictifs, sans les icônes du jeu (elles ne sont jamais dans le dépôt) : `CAPTURES=1 npx playwright test e2e/captures.spec.ts` sur une base e2e vide.

## Déploiement

L'app tourne sur un VPS Debian durci (SSH par clé uniquement, UFW, fail2ban, mises à jour automatiques), avec Docker Compose et Caddy pour le HTTPS.

```bash
cp .env.example .env    # APP_ORIGIN, DOMAIN, secrets, SMTP
docker compose up -d --build
```

Les mises à jour passent par `scripts/deploy.sh` : sauvegarde, récupération de `main`, reconstruction, vérification de santé. Les sauvegardes quotidiennes de la base sont vérifiées et leur restauration testée. Tout est détaillé dans [docs/operations.md](docs/operations.md).

## Données de jeu

Les objets et recettes de métier sont importés des tables du client de WoW Forever publiées par [wago.tools](https://wago.tools) (voir `docs/operations.md`), avec des liens vers Wowhead. Les races, raciaux et bonus de métier viennent de [ForeverChanges](https://foreverchanges.pro). Les règles de buffs de raid reprennent WoW Classic, parce que Forever modifie plus de 700 talents et sorts : elles sont regroupées dans `packages/game-data/src/raid.ts` pour être ajustées au fil des changements publiés.

Projet de fan, non affilié à Blizzard Entertainment.
