-- Clés publiques du site : vérifient la signature des données des groupes partagées entre joueurs (Share.lua).
-- La clé secrète reste sur le serveur (SYNC_SIGNING_KEY) ; ce fichier s'écrit avec scripts/site-key.mjs.
local _, ns = ...
ns.SITE_KEYS = ns.SITE_KEYS or {}
ns.SITE_KEYS["bb4f3770"] = { n = "cc6adecd32823fef097b8497c745ded5775953a32edc01408a442a12100c39ba6a629c7cd09330e98cc71de2bc0373bc47c8496894272c25acf6f0e1129c82b0c94863298558f825216d905c80ca82389b6fd9964b7e7083673ecd00d3c36b3aac064de64e62a3699183b6055c1cb8be8fa3695b424870cb48e21ecd71054d65a222dc251840f19c5c490efd81f8573c71d9b55a3a880b6398478619569c0fe05270179abf26c256e23de130c1b9192eab2a79815c067fba1704c0c4e0a5a725eb488920dab6a24872a1c3d5eb73c819fb9a2389147b698ee381c2a6e149f93fb39e9b814405c37008a89b532ca2a1a2f57c4fd2135374b6bf9b874e5a0b1729", e = 65537 }
