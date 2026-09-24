# Sécurité

Ce document décrit ce que l'application protège, contre quoi, et comment. Les références renvoient à l'OWASP ASVS 4.0 et à l'OWASP Top 10 (2021).

## Actifs et menaces

| Actif | Menace principale | Protection |
|---|---|---|
| Comptes | vol de mot de passe, bourrage d'identifiants, prise de contrôle de session | Argon2id, HIBP, verrouillage, sessions serveur révocables, cookies `__Host-` |
| Personnages et raids | modification par un autre joueur | contrôle d'accès côté serveur sur chaque route, 404 pour les non-membres |
| Invitations | réutilisation ou fuite du lien | jeton aléatoire haché, expiration, nombre d'utilisations, révocation |
| Adresse e-mail | énumération des comptes | réponses identiques que le compte existe ou non |

## Authentification (ASVS V2, Top 10 A07)

- **Stockage des mots de passe** : Argon2id avec les paramètres OWASP (19 MiB, 2 itérations, parallélisme 1) via `@node-rs/argon2`.
- **Politique** : 12 à 128 caractères, sans règle de composition (NIST SP 800-63B), liste noire locale, refus d'un mot de passe contenant l'adresse e-mail.
- **Mots de passe compromis** : vérification Have I Been Pwned par k-anonymity. Seuls les 5 premiers caractères du SHA-1 sont envoyés, avec l'en-tête `Add-Padding`. Si le service est injoignable, on laisse passer pour ne pas bloquer les inscriptions.
- **Confirmation d'e-mail** obligatoire avant la première connexion par mot de passe.
- **Anti-énumération** : même réponse à l'inscription (le titulaire réel reçoit un e-mail l'avertissant de la tentative), au mot de passe oublié et aux échecs de connexion. Un hash factice est vérifié quand le compte n'existe pas, pour garder un temps de réponse constant.
- **Force brute** : limitation par IP (`@fastify/rate-limit`, 20 requêtes / 15 min sur les routes d'authentification) et verrouillage du compte 15 minutes après 10 échecs. Le verrouillage n'est pas annoncé, pour ne pas confirmer l'existence du compte.
- **Liens e-mail** : jeton de 256 bits, stocké haché (SHA-256), à usage unique, 24 h pour la confirmation, 30 min pour la réinitialisation. Le jeton est placé dans le fragment `#` de l'URL : il n'apparaît ni dans les journaux du serveur ni dans l'en-tête `Referer`, et le front l'efface de la barre d'adresse.
- **Réinitialisation** : ferme toutes les sessions ouvertes. Un changement de mot de passe ferme toutes les autres.

## Sessions (ASVS V3)

- Sessions **côté serveur** en base : le cookie contient un jeton aléatoire de 256 bits, la base n'en garde que le SHA-256. Une fuite de la base ne donne donc aucune session utilisable.
- Cookie `__Host-fr_sid` : `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sans `Domain`.
- Durée absolue de 30 jours, expiration après 7 jours d'inactivité.
- Rotation à la connexion : l'ancienne session du navigateur est révoquée (anti-fixation).
- Page « Compte & sécurité » : liste des sessions (appareil, IP, dernière activité) et révocation unitaire ou globale.

## CSRF (ASVS V4.2, V13)

Deux protections cumulées sur toute requête `POST`, `PUT`, `PATCH` ou `DELETE` :

1. l'en-tête `Origin` (ou à défaut `Referer`) doit être exactement `APP_ORIGIN` ;
2. si une session existe, l'en-tête `X-CSRF-Token` doit correspondre au jeton synchronisé de la session (comparaison en temps constant).

S'y ajoute `SameSite=Lax` sur le cookie. La liaison d'un compte Battle.net démarre par un `POST` protégé, pour empêcher un site tiers de lancer une liaison à l'insu de l'utilisateur.

## OAuth Battle.net

- Flux *authorization code*. Le `state` fait 256 bits, est stocké haché avec une expiration de 10 minutes **et** posé dans un cookie `HttpOnly` limité au chemin `/api/auth/battlenet`. Le callback exige que les deux correspondent. Cela bloque le *login CSRF*, où un attaquant ferait lier son propre compte Battle.net à la session de la victime.
- En mode liaison, le compte lié doit être celui qui a lancé le flux et être toujours connecté.
- L'identité est lue sur l'endpoint `userinfo`, dont la réponse est validée avec zod.
- Le secret client reste côté serveur (authentification HTTP Basic sur l'endpoint `token`).

## Contrôle d'accès (Top 10 A01)

- Chaque route vérifie le propriétaire ou le rôle dans le groupe côté serveur (`requireRole`).
- Un non-membre qui demande un groupe, un raid ou un personnage reçoit **404**, sans confirmation que la ressource existe. Un membre sans le rôle requis reçoit 403.
- Hiérarchie des rôles : un officier ne peut retirer que des membres, seul le propriétaire change les rôles, et le propriétaire ne peut pas quitter le groupe sans le transférer.
- Composition de raid : chaque personnage placé doit appartenir à un membre du groupe, une place ne peut être occupée qu'une fois, un personnage n'occupe qu'une place.
- Les invitations sont consommées par un `UPDATE` atomique, ce qui empêche de dépasser le nombre d'utilisations avec des requêtes simultanées.

## Validation et injection (ASVS V5, Top 10 A03)

- Toutes les entrées passent par des schémas zod stricts : longueurs, énumérations issues des données de jeu, bornes numériques.
- Les liens de build n'acceptent que `https:`. Un lien `javascript:` enregistré puis cliqué par un autre membre du groupe serait une XSS stockée.
- SQL uniquement via Drizzle, avec requêtes paramétrées.
- React échappe tout le contenu affiché. Aucun `dangerouslySetInnerHTML`.
- Corps de requête limité à 256 Ko, nombre de personnages, de groupes et de raids plafonné.

## En-têtes et transport (ASVS V14)

- Caddy : HTTPS automatique, HSTS, CSP stricte (`default-src 'self'`, pas de script inline, `frame-ancestors 'none'`), `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`.
- Polices servies localement (`@fontsource`) : aucune requête vers un tiers, CSP simplifiée, pas de fuite d'IP vers Google Fonts (RGPD).
- API : `helmet`, `Cache-Control: no-store` sur les réponses d'authentification, erreurs génériques sans trace de pile.

## Journalisation (ASVS V7, Top 10 A09)

- Journal d'audit en base : inscriptions, connexions réussies ou échouées, verrouillages, changements et réinitialisations de mot de passe, révocations, liaisons Battle.net, actions de groupe. IP et user-agent sont conservés.
- Les journaux applicatifs masquent `Cookie`, `Authorization`, `X-CSRF-Token` et `Set-Cookie`.

## Serveur

- Debian 13, correctifs de sécurité installés automatiquement (`unattended-upgrades`).
- SSH : clé ed25519 uniquement, connexion root interdite, un seul utilisateur autorisé, 3 tentatives maximum.
- Pare-feu UFW (IPv4 et IPv6) : seuls SSH (avec limitation de débit), HTTP et HTTPS sont ouverts.
- fail2ban bannit une IP pendant 1 h après 5 échecs SSH en 10 minutes.
- Pas d'utilisateur dans le groupe `docker`, équivalent à root : tout passe par `sudo`.
- Sauvegardes quotidiennes de la base, lisibles par root uniquement (pas encore chiffrées), vérifiées à chaque exécution, avec restauration testée. Voir [docs/operations.md](docs/operations.md).

## Conteneurs

- API : image `node:24-alpine`, utilisateur `node`, système de fichiers en lecture seule, `cap_drop: ALL`, `no-new-privileges`.
- PostgreSQL : aucun port publié.
- Dépendances : Dependabot, `npm audit --omit=dev` et CodeQL (`security-extended`) dans la CI.

## Limites connues et évolutions prévues

- Pas encore de double authentification (TOTP / WebAuthn). C'est la prochaine étape logique.
- Le verrouillage de compte peut servir à bloquer volontairement un joueur (déni de service ciblé). Il est atténué par la courte durée et par la connexion Battle.net, qui reste possible.
- Les alertes `npm audit` sur esbuild concernent uniquement les outils de développement (serveur de dev de tsup et drizzle-kit), pas le code livré.
- Le journal d'audit n'a pas encore de durée de rétention automatique.

## Signaler une vulnérabilité

Ouvre une *security advisory* privée sur le dépôt GitHub plutôt qu'une issue publique.
