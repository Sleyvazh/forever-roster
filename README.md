# Forever Roster

Application web pour préparer **WoW Forever** (sortie le 4 novembre 2026) en guilde : chaque joueur gère ses personnages, les officiers composent les raids de 40 et voient en direct quels buffs et debuffs manquent.

Le projet sert aussi de vitrine : l'authentification et la gestion des sessions sont écrites à la main, testées, et documentées dans [SECURITY.md](SECURITY.md).

![Composition d'un raid avec la couverture des buffs](docs/screenshots/02-raid.png)

## Fonctionnalités

- **Comptes** : inscription par e-mail avec confirmation, connexion Battle.net (OAuth 2.0), réinitialisation du mot de passe, suppression du compte (RGPD).
- **Personnages** : race et classe (combinaisons propres à Forever), spés, répartition des talents, métiers et bonus Forever, suivi BiS par emplacement, perks Legacy, notes. Sauvegarde automatique et réordonnancement par glisser-déposer.
- **Groupes** : rôles propriétaire / officier / membre, liens d'invitation à durée et nombre d'utilisations limités, transfert de propriété.
- **Raids** : 8 groupes de 5, banc des persos du groupe, déplacement et échange de places, compteur tanks / heals / DPS, couverture des 42 buffs, auras, debuffs et utilitaires (avec détection des groupes où une aura manque).
- **Sécurité visible** : sessions actives révocables, journal de sécurité personnel, journal d'activité du groupe pour les officiers.

## Stack

| Couche | Choix |
|---|---|
| API | Node 22, TypeScript, Fastify 5, Drizzle ORM, PostgreSQL 16, zod |
| Front | React 19, Vite, React Router, TanStack Query |
| Données de jeu | paquet `@forever/game-data` partagé entre l'API et le front |
| Infra | Docker Compose, Caddy (HTTPS automatique, en-têtes de sécurité) |
| Qualité | Vitest (tests d'intégration contre un vrai Postgres), GitHub Actions, CodeQL, Dependabot |

```
apps/api            API Fastify (routes, sessions, migrations SQL)
apps/web            Front React
packages/game-data  Races, classes, métiers, règles de buffs de raid
infra/Caddyfile     Reverse proxy + CSP
docs/               Architecture
```

## Lancer en local

Prérequis : Node 22 et Docker.

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
- le contrôle d'accès des personnages, des groupes et des raids.

## Déploiement

```bash
cp .env.example .env    # APP_ORIGIN=https://ton-domaine, DOMAIN=ton-domaine, vrais secrets et SMTP
docker compose up -d --build
```

Caddy obtient le certificat HTTPS tout seul. La base n'expose aucun port, l'API tourne en utilisateur non privilégié avec un système de fichiers en lecture seule.

## Données de jeu

Les races, raciaux et métiers viennent de [ForeverChanges](https://foreverchanges.pro). Les règles de buffs de raid reprennent WoW Classic, parce que Forever modifie plus de 700 talents et sorts : elles sont regroupées dans `packages/game-data/src/raid.ts` pour être ajustées au fil des changements publiés.

Projet de fan, non affilié à Blizzard Entertainment.
