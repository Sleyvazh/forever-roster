-- Forever Roster : socle (sauvegarde, événements, commandes /fr).
local ADDON, ns = ...
ns.name = ADDON
-- Logo de Forever Roster (infini et épée), dans la liste des addons, les fenêtres et le bouton de la minicarte
ns.LOGO = "Interface\\AddOns\\" .. (ADDON or "ForeverRoster") .. "\\Media\\Logo"

-- Sauvegarde de l'addon, pour la boîte à outils commune avec Roster (addon/shared/Kit.lua : habillage, tailles des fenêtres)
function ns.db() return ForeverRosterDB end

local meta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
ns.version = meta and meta(ADDON, "Version") or "?"

function ns.print(...)
  print("|cffe3b54bForever Roster|r :", ...)
end

-- Petit bus d'événements : ns.on("GROUP_ROSTER_UPDATE", fn)
local frame = CreateFrame("Frame")
local handlers = {}
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
  for _, fn in ipairs(handlers[event] or {}) do
    local ok, err = pcall(fn, ...)
    if not ok then ns.print("|cffff6060erreur|r " .. tostring(err)) end
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
  ForeverRosterDB.version = ns.version
  -- Anciens relevés de diagnostic (talents, interface) : plus utiles, retirés de la sauvegarde
  ForeverRosterDB.debug = nil
  -- Contrôle de chargement : chaque module doit avoir défini ses fonctions
  local missing = {}
  for mod, fn in pairs({ Format = "ParseFRR", Compo = "Load", Talents = "Capture", Export = "Build", Group = "Load", Recorder = "Sample", Companion = "Apply", UI = "Show", Raid = "FillTab", Test = "OpenCorpse", Minimap = "Create" }) do
    if not (ns[mod] and ns[mod][fn]) then missing[#missing + 1] = mod end
  end
  if #missing > 0 then ns.print("|cffff6060modules non chargés : " .. table.concat(missing, ", ") .. "|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)") end
end)

local HELP = {
  "/fr : ouvrir la fenêtre (onglets Synchro, Raids, En raid, Compo, Patrons, Options) ; aussi par le bouton de la minicarte",
  "/fr synchro | raids | enraid | compo | patrons | options : ouvrir directement un onglet",
  "/fr butin : fenêtre du maître du butin (jets SR, MS / OS, libre, conseil) ; /fr butin <lien> pour un objet déjà dans tes sacs",
  "/fr boss : fiche du boss ciblé (sinon la première du raid) ; /fr conso : appel aux consommables",
  "/fr test : raid d'essai (9 joueurs fictifs) pour tout essayer seul : butin, conseil, fiches de boss, consommables",
  "Synchro rapide : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou clic droit sur le bouton de la minicarte",
  "/fr cherche <lien> : marquer un patron recherché (Maj+clic sur l'objet pour mettre son lien), ou l'en retirer",
  "/fr objet <lien> : ce que le jeu répond pour un objet (si un nom reste « objet 12345 »)",
  "/fr oublier Nom-Royaume : retirer un perso supprimé de l'export",
  "/fr actualiser : charger les nouveautés déposées par Roster Companion, sans /reload (aussi tout seul aux moments utiles)",
  "/fr synchroniser : recharger l'interface pour envoyer au site et charger les nouveautés d'un coup (Roster Companion)",
  "/fr minicarte : afficher ou masquer le bouton de la minicarte",
  "/fr rappels : couper ou remettre le rappel de raid à la connexion",
  "/fr habillage : passer de l'habillage Forever (jeu) à celui du site, et inversement (recharge l'interface)",
}

SLASH_FOREVERROSTER1 = "/fr"
SLASH_FOREVERROSTER2 = "/foreverroster"
-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060erreur (" .. label .. ")|r " .. tostring(err) .. " : envoie une capture de ce message.") end
  return ok
end

local TABS = { synchro = "synchro", sync = "synchro", export = "synchro", raids = "raids", groupe = "raids", enraid = "enraid", raid = "enraid", compo = "compo", patrons = "patrons", options = "options" }

-- Raccourcis clavier (Bindings.xml) : Échap > Options > Raccourcis > AddOns > Forever Roster
BINDING_HEADER_FOREVERROSTER = "Forever Roster"
BINDING_NAME_FOREVERROSTER_SYNC = "Synchro rapide avec le site (copier / coller)"
BINDING_NAME_FOREVERROSTER_TOGGLE = "Ouvrir ou fermer la fenêtre"
BINDING_NAME_FOREVERROSTER_REFRESH = "Charger les nouveautés (Roster Companion)"
BINDING_NAME_FOREVERROSTER_RELOAD = "Synchroniser (Roster Companion, recharge l'interface)"
function ForeverRoster_Sync() ns.safe("raccourci", ns.UI.Quick) end
function ForeverRoster_Toggle() ns.safe("raccourci", ns.UI.Toggle) end
function ForeverRoster_Refresh() ns.safe("raccourci", ns.Companion.RefreshCommand) end
function ForeverRoster_Reload() ns.safe("raccourci", ns.Companion.Reload) end

local function run(msg)
  local raw = strtrim(msg or "")
  local cmd, rest = raw:match("^(%S*)%s*(.-)$")
  cmd = (cmd or ""):lower()
  if cmd == "" then
    ns.UI.Toggle()
  elseif TABS[cmd] then
    ns.UI.Show(TABS[cmd])
  elseif cmd == "butin" or cmd == "loot" then
    if rest ~= "" and not ns.Raid.AddItem(rest) then ns.print("tape /fr butin puis Maj+clic sur l'objet pour mettre son lien.") return end
    ns.Raid.ShowLoot()
  elseif cmd == "boss" then
    ns.Raid.ShowSheetCommand()
  elseif cmd == "conso" or cmd == "consommables" then
    ns.Raid.CallConsumables()
  elseif cmd == "test" or cmd == "essai" then
    ns.Raid.ShowTest()
  elseif cmd == "objet" or cmd == "item" then
    ns.Group.Diagnose(ns.Group.itemIdFrom(rest) or tonumber(rest) or 16901)
  elseif cmd == "cherche" then
    local id = ns.Group.itemIdFrom(rest) or tonumber(rest)
    if not id then ns.print("tape /fr cherche puis Maj+clic sur le patron (sac, hôtel des ventes, chat) pour mettre son lien, et Entrée.") return end
    ns.Group.ToggleWanted(id, ns.Group.linkFor(id))
    ns.UI.Refresh()
  elseif cmd == "oublier" then
    local key = rest ~= "" and rest or nil
    if not (key and ForeverRosterDB.chars and ForeverRosterDB.chars[key] and ForeverRosterDB.chars[key].snapshot) then
      ns.print("perso inconnu : écris son nom et son royaume comme dans l'onglet Synchro, par ex. /fr oublier Greta-Classic Beta PvP")
      return
    end
    ns.Export.Forget(key)
    ns.print(key .. " retiré de l'export.")
  elseif cmd == "actualiser" or cmd == "maj" then
    ns.Companion.RefreshCommand()
  elseif cmd == "synchroniser" then
    ns.Companion.Reload()
  elseif cmd == "rappels" then
    ForeverRosterDB.noReminder = not ForeverRosterDB.noReminder or nil
    ns.print(ForeverRosterDB.noReminder and "rappels de raid coupés." or "rappels de raid remis : à la connexion, raids des prochaines 24 h.")
  elseif cmd == "habillage" or cmd == "skin" then
    ForeverRosterDB.skin = ForeverRosterDB.skin ~= "site" and "site" or nil
    ReloadUI()
  elseif cmd == "minicarte" or cmd == "minimap" then
    ns.Minimap.Toggle()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. line) end
  end
end
SlashCmdList.FOREVERROSTER = function(msg) ns.safe("/fr " .. (msg or ""), run, msg) end
