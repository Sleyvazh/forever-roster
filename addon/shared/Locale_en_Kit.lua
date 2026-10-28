-- Traductions anglaises de la boîte à outils commune (Kit.lua) : T["texte français"] = "English text".
local _, ns = ...
local T = ns.Strings("en")

-- Croix du bouton de fermeture (habillage du site)
T["×"] = "×"

-- Rôle en toutes lettres (quand le client n'a pas l'icône du rôle)
T["Tank"] = "Tank"
T["Heal"] = "Healer"
T["DPS"] = "DPS"

-- Partage des données du site entre joueurs (Share.lua)
T["Données de %s reçues de %s (site : %s)."] = "Data for %s received from %s (website: %s)."

-- Journal du partage (Share.lua : /fr partage, texte copié pour le diagnostic)
T["Demande SHW envoyée sur %s."] = "SHW request sent on %s."
T["SHW de %s sur %s : j'annonce mes groupes dans quelques secondes."] = "SHW from %s on %s: announcing my groups in a few seconds."
T["SHW de %s sur %s : ignoré, %s."] = "SHW from %s on %s: ignored, %s."
T["Annonce SHV faite sur %s : %s, version du %s."] = "SHV announcement made on %s: %s, version of %s."
T["Annonce SHV de %s sur %s : %s, version du %s."] = "SHV announcement from %s on %s: %s, version of %s."
T["Pas de demande pour %s, version du %s : déjà refusée."] = "No request for %s, version of %s: already refused."
T["Pas de demande pour %s : %s."] = "No request for %s: %s."
T["Demande SHQ envoyée à %s pour %s : j'ai la version du %s."] = "SHQ request sent to %s for %s: I have the version of %s."
T["Demande SHQ envoyée à %s pour %s : je n'ai rien."] = "SHQ request sent to %s for %s: I have nothing."
T["Demande SHQ de %s pour %s : je diffuse sur %s dans quelques secondes."] = "SHQ request from %s for %s: broadcasting on %s in a few seconds."
T["Demande SHQ de %s pour %s : ignorée, %s."] = "SHQ request from %s for %s: ignored, %s."
T["Données de %s diffusées sur %s : %d morceau(x)."] = "Data for %s broadcast on %s: %d part(s)."
T["Diffusion de %s sur %s annulée : %s la diffuse déjà."] = "Broadcast of %s on %s cancelled: %s is already broadcasting it."
T["Réception de %s depuis %s : %d morceau(x) attendu(s)."] = "Receiving %s from %s: %d part(s) expected."
T["Réception de %s depuis %s abandonnée : %d morceau(x) sur %d."] = "Receiving %s from %s abandoned: %d part(s) out of %d."
T["Données de %s appliquées (reçues de %s, version du %s)."] = "Data for %s applied (received from %s, version of %s)."
T["Données de %s refusées (reçues de %s) : %s."] = "Data for %s refused (received from %s): %s."
-- Raisons dites dans le journal
T["partage coupé"] = "sharing off"
T["aucun bloc signé à partager"] = "no signed block to share"
T["déjà répondu il y a moins de 5 min"] = "already answered less than 5 min ago"
T["pas de version plus récente que la sienne"] = "no version more recent than theirs"
T["canal inconnu"] = "unknown channel"
T["diffusion déjà programmée"] = "broadcast already scheduled"
T["diffusée il y a moins de 60 s"] = "broadcast less than 60 s ago"
T["texte incomplet ou illisible"] = "incomplete or unreadable text"
T["version pas plus récente que la mienne"] = "version not more recent than mine"
T["liste des membres absente"] = "member list missing"
T["aucun de mes persos dans ce groupe"] = "none of my characters is in this group"
T["pas de signature"] = "no signature"
T["clé de signature inconnue"] = "unknown signing key"
T["vérification impossible"] = "verification impossible"
T["signature fausse"] = "wrong signature"
T["refusées par l'addon"] = "refused by the addon"
