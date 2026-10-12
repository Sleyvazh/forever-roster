-- Clés publiques du site : vérifient la signature des données des groupes partagées entre joueurs (Share.lua).
-- La clé secrète reste sur le serveur (SYNC_SIGNING_KEY) ; ce fichier s'écrit avec scripts/site-key.mjs.
local _, ns = ...
ns.SITE_KEYS = ns.SITE_KEYS or {}
