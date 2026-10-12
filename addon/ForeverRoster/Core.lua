-- Forever Roster : socle (sauvegarde, événements, commandes /fr).
local ADDON, ns = ...
local L, N = ns.L, ns.N
ns.name = ADDON
-- Logo de Forever Roster (infini et épée), dans la liste des addons, les fenêtres et le bouton de la minicarte
ns.LOGO = "Interface\\AddOns\\" .. (ADDON or "ForeverRoster") .. "\\Media\\Logo"

-- Sauvegarde de l'addon, pour la boîte à outils commune avec Roster (addon/shared/Kit.lua : habillage, tailles des fenêtres)
function ns.db() return ForeverRosterDB end

local meta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
ns.version = meta and meta(ADDON, "Version") or "?"

function ns.print(...)
  print(L("%s :", "|cffe3b54bForever Roster|r"), ...)
end

-- Noms des langues (option Langue, /fr langue) : chacun dans sa langue, le même en français et en anglais
local LANG_NAME = { fr = N("Français"), en = N("English") }
function ns.LangName(lang) return LANG_NAME[lang] and L[LANG_NAME[lang]] end

-- Valeurs secrètes : le client de Forever (comme celui de Retail depuis 12.0) cache certaines valeurs en instance
-- (identité des PNJ ciblés, texte du chat pendant un combat de boss…). Les lire autrement qu'avec issecretvalue
-- (comparer, découper, concaténer, s'en servir de clé) est une erreur Lua : on vérifie avant, et on s'en passe.
function ns.secret(v) return issecretvalue ~= nil and issecretvalue(v) == true end
-- Texte d'une valeur : "" si elle est absente ou secrète (à la place de tostring(v or ""))
function ns.text(v)
  if ns.secret(v) then return "" end
  if v == nil then return "" end
  return tostring(v)
end
-- Chaîne lisible, sinon nil (absente, secrète ou d'un autre type)
function ns.str(v)
  if ns.secret(v) then return nil end
  if type(v) == "string" then return v end
  return nil
end

-- Petit bus d'événements : ns.on("GROUP_ROSTER_UPDATE", fn)
local frame = CreateFrame("Frame")
local handlers = {}
-- Événement qui porte une valeur secrète : illisible, ses gestionnaires ne sont pas appelés (ns.onSecret(event, fn) est
-- prévenu à la place), sauf pour les événements de ns.secretOk, dont les gestionnaires vérifient eux-mêmes.
local onSecret = {}
function ns.onSecret(event, fn) onSecret[event] = fn end
ns.secretOk = { ENCOUNTER_START = true, ENCOUNTER_END = true }
local function hasSecret(...)
  if issecretvalue == nil then return false end
  for i = 1, select("#", ...) do
    if issecretvalue((select(i, ...))) then return true end
  end
  return false
end
-- Un événement que ce client ne connaît pas est ignoré (le jeu refuserait sinon tout le fichier)
ns.missingEvents = {}
-- Infos d'objet : fonction globale (Classic) ou C_Item (clients récents, où les globales peuvent avoir disparu)
function ns.ItemInfo(id)
  local fn = GetItemInfo or (C_Item and C_Item.GetItemInfo)
  if fn and id then return fn(id) end
end
function ns.ItemInfoInstant(id)
  local fn = GetItemInfoInstant or (C_Item and C_Item.GetItemInfoInstant)
  if fn and id then return fn(id) end
end
-- Nombre d'exemplaires dans les sacs (et la banque) : fonction globale, sinon C_Item (1.2.1)
function ns.ItemCount(id, bank)
  local fn = GetItemCount or (C_Item and C_Item.GetItemCount)
  if fn and id then return fn(id, bank) or 0 end
  return 0
end
function ns.HasItemCount() return (GetItemCount or (C_Item and C_Item.GetItemCount)) ~= nil end
-- Objet pas encore connu du client : demandé au serveur (GET_ITEM_INFO_RECEIVED ou ITEM_DATA_LOAD_RESULT ensuite)
local requested = {}
function ns.RequestItem(id)
  if not id or (requested[id] and time() - requested[id] < 10) then return end
  requested[id] = time()
  if C_Item and C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, id) else ns.ItemInfo(id) end
end

function ns.on(event, fn)
  if not handlers[event] then
    if not pcall(frame.RegisterEvent, frame, event) then
      ns.missingEvents[#ns.missingEvents + 1] = event
      return false
    end
    handlers[event] = {}
  end
  table.insert(handlers[event], fn)
  return true
end
frame:SetScript("OnEvent", function(_, event, ...)
  if not ns.secretOk[event] and hasSecret(...) then
    if onSecret[event] then pcall(onSecret[event]) end
    return
  end
  for _, fn in ipairs(handlers[event] or {}) do
    local ok, err = pcall(fn, ...)
    if not ok then ns.print("|cffff6060" .. L["erreur"] .. "|r " .. tostring(err)) end
  end
end)

-- Données sauvegardées : un enregistrement par perso (« Nom-Royaume »)
function ns.charKey()
  return (UnitName("player") or "?") .. "-" .. (GetRealmName() or "?")
end
function ns.charDB()
  ForeverRosterDB.chars = ForeverRosterDB.chars or {}
  local key = ns.charKey()
  ForeverRosterDB.chars[key] = ForeverRosterDB.chars[key] or { recipes = {} }
  return ForeverRosterDB.chars[key]
end

ns.on("ADDON_LOADED", function(name)
  if name ~= ADDON then return end
  ForeverRosterDB = ForeverRosterDB or {}
  ns.LocaleReady() -- langue choisie dans les options (sauvegarde) connue à partir d'ici
  ns.langAtLoad = ns.Lang() -- langue de l'interface jusqu'au prochain rechargement (option Langue)
  ns.SetBindingNames()
  ForeverRosterDB.version = ns.version
  -- Anciens relevés de diagnostic (talents, interface) : plus utiles, retirés de la sauvegarde
  ForeverRosterDB.debug = nil
  -- Contrôle de chargement : chaque module doit avoir défini ses fonctions
  local missing = {}
  for mod, fn in pairs({ Format = "ParseFRR", Compo = "Load", Talents = "Capture", Export = "Build", Group = "Load", Recorder = "Sample", Companion = "Apply", UI = "Show", Raid = "FillTab", Test = "OpenCorpse", Minimap = "Create" }) do
    if not (ns[mod] and ns[mod][fn]) then missing[#missing + 1] = mod end
  end
  if #missing > 0 then ns.print("|cffff6060" .. L("modules non chargés : %s|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)", table.concat(missing, ", "))) end
end)

-- Aide de /fr : traduite à l'affichage (en anglais, elle donne les commandes anglaises)
local HELP = {
  N("/fr : ouvrir la fenêtre (onglets Synchro, Raids, En raid, Compo, Patrons, Options) ; aussi par le bouton de la minicarte"),
  N("/fr synchro | raids | enraid | compo | patrons | options : ouvrir directement un onglet"),
  N("/fr butin : fenêtre du maître du butin (jets SR, MS / OS, libre, conseil) ; /fr butin <lien> pour un objet déjà dans tes sacs"),
  N("/fr boss : fiche du boss ciblé (sinon la première du raid) ; /fr conso : appel aux consommables"),
  N("/fr test : raid d'essai (9 joueurs fictifs) pour tout essayer seul : butin, conseil, fiches de boss, consommables"),
  N("Synchro rapide : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou clic droit sur le bouton de la minicarte"),
  N("/fr cherche <lien> : marquer un patron recherché (Maj+clic sur l'objet pour mettre son lien), ou l'en retirer"),
  N("/fr objet <lien> : ce que le jeu répond pour un objet (si un nom reste « objet 12345 »)"),
  N("/fr oublier Nom-Royaume : retirer un perso supprimé de l'export"),
  N("/fr actualiser : charger les nouveautés déposées par Roster Companion, sans /reload (aussi tout seul aux moments utiles)"),
  N("/fr synchroniser : recharger l'interface pour envoyer au site et charger les nouveautés d'un coup (Roster Companion)"),
  N("/fr minicarte : afficher ou masquer le bouton de la minicarte"),
  N("/fr rappels : couper ou remettre le rappel de raid à la connexion"),
  N("/fr habillage : passer de l'habillage Forever (jeu) à celui du site, et inversement (recharge l'interface)"),
  N("/fr langue fr | en | jeu : langue de l'addon (Français, English ou celle du jeu ; recharge l'interface)"),
}

SLASH_FOREVERROSTER1 = "/fr"
SLASH_FOREVERROSTER2 = "/foreverroster"
-- Nom de la partie en erreur (ns.safe) : traduit s'il a sa traduction (l'appelant le marque N("…")), sinon tel quel
local function partName(label)
  local lang = ns.Lang()
  if lang == "fr" then return label end
  return ns.Strings(lang)[label] or label
end
-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060" .. L("erreur (%s)", partName(tostring(label))) .. "|r " .. L("%s : envoie une capture de ce message.", tostring(err))) end
  return ok
end

-- Onglets de /fr : mots français, et leurs équivalents anglais
local TABS = { synchro = "synchro", sync = "synchro", export = "synchro", raids = "raids", groupe = "raids", enraid = "enraid", raid = "enraid", inraid = "enraid",
  compo = "compo", comp = "compo", patrons = "patrons", recipes = "patrons", options = "options" }
-- /fr langue : fr, en, ou la langue du jeu (false)
local LANGS = { fr = "fr", french = "fr", francais = "fr", ["français"] = "fr", en = "en", english = "en", anglais = "en", -- nolocale
  jeu = false, game = false, client = false, auto = false }

-- Raccourcis clavier (Bindings.xml) : Échap > Options > Raccourcis > AddOns > Forever Roster.
-- Noms posés à ADDON_LOADED, une fois la langue choisie dans les options connue.
BINDING_HEADER_FOREVERROSTER = "Forever Roster"
function ns.SetBindingNames()
  BINDING_NAME_FOREVERROSTER_SYNC = L["Synchro rapide avec le site (copier / coller)"]
  BINDING_NAME_FOREVERROSTER_TOGGLE = L["Ouvrir ou fermer la fenêtre"]
  BINDING_NAME_FOREVERROSTER_REFRESH = L["Charger les nouveautés (Roster Companion)"]
  BINDING_NAME_FOREVERROSTER_RELOAD = L["Synchroniser (Roster Companion, recharge l'interface)"]
end
function ForeverRoster_Sync() ns.safe(N("raccourci"), ns.UI.Quick) end
function ForeverRoster_Toggle() ns.safe(N("raccourci"), ns.UI.Toggle) end
function ForeverRoster_Refresh() ns.safe(N("raccourci"), ns.Companion.RefreshCommand) end
function ForeverRoster_Reload() ns.safe(N("raccourci"), ns.Companion.Reload) end

local function run(msg)
  local raw = strtrim(msg or "")
  local cmd, rest = raw:match("^(%S*)%s*(.-)$")
  cmd = (cmd or ""):lower()
  if cmd == "" then
    ns.UI.Toggle()
  elseif TABS[cmd] then
    ns.UI.Show(TABS[cmd])
  elseif cmd == "butin" or cmd == "loot" then -- nolocale
    if rest ~= "" and not ns.Raid.AddItem(rest) then ns.print(L["tape /fr butin puis Maj+clic sur l'objet pour mettre son lien."]) return end
    ns.Raid.ShowLoot()
  elseif cmd == "boss" then
    ns.Raid.ShowSheetCommand()
  elseif cmd == "conso" or cmd == "consommables" or cmd == "consumables" or cmd == "cons" then
    ns.Raid.CallConsumables()
  elseif cmd == "test" or cmd == "essai" then
    ns.Raid.ShowTest()
  elseif cmd == "objet" or cmd == "item" then -- nolocale
    ns.Group.Diagnose(ns.Group.itemIdFrom(rest) or tonumber(rest) or 16901)
  elseif cmd == "cherche" or cmd == "search" or cmd == "want" then
    local id = ns.Group.itemIdFrom(rest) or tonumber(rest)
    if not id then ns.print(L["tape /fr cherche puis Maj+clic sur le patron (sac, hôtel des ventes, chat) pour mettre son lien, et Entrée."]) return end
    ns.Group.ToggleWanted(id, ns.Group.linkFor(id))
    ns.UI.Refresh()
  elseif cmd == "oublier" or cmd == "forget" then
    local key = rest ~= "" and rest or nil
    if not (key and ForeverRosterDB.chars and ForeverRosterDB.chars[key] and ForeverRosterDB.chars[key].snapshot) then
      ns.print(L["perso inconnu : écris son nom et son royaume comme dans l'onglet Synchro, par ex. /fr oublier Greta-Classic Beta PvP"])
      return
    end
    ns.Export.Forget(key)
    ns.print(L("%s retiré de l'export.", key))
  elseif cmd == "actualiser" or cmd == "maj" or cmd == "refresh" then
    ns.Companion.RefreshCommand()
  elseif cmd == "synchroniser" or cmd == "syncnow" then
    ns.Companion.Reload()
  elseif cmd == "rappels" or cmd == "reminders" then
    ForeverRosterDB.noReminder = not ForeverRosterDB.noReminder or nil
    ns.print(ForeverRosterDB.noReminder and L["rappels de raid coupés."] or L["rappels de raid remis : à la connexion, raids des prochaines 24 h."])
  elseif cmd == "habillage" or cmd == "skin" then
    ForeverRosterDB.skin = ForeverRosterDB.skin ~= "site" and "site" or nil -- nolocale (valeur sauvegardée)
    ReloadUI()
  elseif cmd == "langue" or cmd == "language" or cmd == "lang" then
    -- Sans choix reconnu : onglet Options (réglage Langue) ; sinon choisie, et l'interface rechargée si elle change
    local v = LANGS[rest:lower()]
    if v == nil then ns.UI.Show("options") return end
    ForeverRosterDB.lang = v or nil
    if ns.Lang() ~= ns.langAtLoad then ReloadUI() return end
    ns.print(L("Langue : %s", v and ns.LangName(v) or L("celle du jeu (%s)", ns.LangName(ns.ClientLang()))))
    ns.UI.Refresh()
  elseif cmd == "minicarte" or cmd == "minimap" then
    ns.Minimap.Toggle()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. L[line]) end
  end
end
SlashCmdList.FOREVERROSTER = function(msg) ns.safe("/fr " .. (msg or ""), run, msg) end
