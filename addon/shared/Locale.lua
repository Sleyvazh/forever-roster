-- Langue de l'interface, commune aux addons Forever Roster et Roster (dossier addon/shared, copié dans chaque zip).
-- Premier fichier du .toc. Les textes sont écrits en français dans le code ; chaque addon fournit leur traduction
-- anglaise (fichiers Locale_en*.lua : T["texte français"] = "English text").
--
--   local L, N = ns.L, ns.N
--   L["Fermer"]                       -- texte de l'interface, traduit au moment où il s'affiche
--   L("%s reçoit %s", nom, lien)      -- même chose, puis string.format (mêmes %s / %d, dans le même ordre)
--   local ONGLETS = { N("Présence") } -- texte gardé en français dans une table, traduit à l'affichage par L[...]
--
-- Langue : celle du client du jeu (GetLocale : frFR → français, toute autre → anglais), sauf si le joueur en a
-- choisi une dans les options (sauvegarde : lang = "fr" ou "en"). Jamais traduits : messages entre addons, textes
-- pour le site (FRC, RRB…), clés de la sauvegarde, motifs de lecture du chat (chaînes du jeu : LOOT_ITEM…).
-- Règles et vérifications : addon/tests/locale_check.lua (toutes les chaînes) et addon/tests/locale_audit.lua (jeu simulé).
local _, ns = ...

local tables = {}   -- tables[lang][texte français] = traduction
local loading = true -- jusqu'à ADDON_LOADED : la langue choisie dans les options n'est pas encore connue

--- Table de traduction d'une langue, remplie par les fichiers Locale_<langue>*.lua.
function ns.Strings(lang)
  tables[lang] = tables[lang] or {}
  return tables[lang]
end

--- Langue de l'interface : "fr" ou "en".
function ns.Lang()
  local db = not loading and ns.db and ns.db()
  local chosen = type(db) == "table" and db.lang
  if chosen == "fr" or chosen == "en" then return chosen end
  local client = GetLocale and GetLocale() or "frFR"
  return client == "frFR" and "fr" or "en"
end

--- Langue du client du jeu, sans tenir compte du choix des options (pour l'afficher dans les options).
function ns.ClientLang()
  local client = GetLocale and GetLocale() or "frFR"
  return client == "frFR" and "fr" or "en"
end

--- Appelé par Core.lua à ADDON_LOADED, une fois la sauvegarde chargée.
function ns.LocaleReady() loading = false end

-- Relevés des tests (ns.Laudit posé par le jeu simulé avant le chargement des fichiers) : textes demandés,
-- demandés pendant le chargement (trop tôt : la langue des options serait ignorée), et textes rendus.
local function audit(key, out)
  local a = ns.Laudit
  if not a then return end
  a.seen[key] = true
  if loading then a.load[key] = true end
  a.out[out] = true
end

local function translate(key)
  if key == nil then return nil end
  local lang = ns.Lang()
  local out = key
  if lang ~= "fr" then
    local t = tables[lang]
    out = t and t[key] or key
  end
  audit(key, out)
  return out
end

ns.L = setmetatable({}, {
  __index = function(_, key) return translate(key) end,
  __call = function(_, key, ...)
    local s = translate(key)
    if select("#", ...) == 0 then return s end
    local out = string.format(s, ...)
    if ns.Laudit then ns.Laudit.out[out] = true end
    return out
  end,
  __newindex = function() error("ns.L se lit seulement : les traductions vont dans ns.Strings(langue)") end,
})

--- Marque un texte à traduire plus tard (table construite au chargement) : le renvoie tel quel.
function ns.N(key) return key end
