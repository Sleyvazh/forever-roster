-- Forever Roster : socle (sauvegarde, événements, commandes /fr).
local ADDON, ns = ...
ns.name = ADDON

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
  for mod, fn in pairs({ Format = "ParseFRR", Compo = "Load", Talents = "Capture", Export = "Build", Group = "Load", UI = "Show", Minimap = "Create" }) do
    if not (ns[mod] and ns[mod][fn]) then missing[#missing + 1] = mod end
  end
  if #missing > 0 then ns.print("|cffff6060modules non chargés : " .. table.concat(missing, ", ") .. "|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)") end
end)

local HELP = {
  "/fr : ouvrir la fenêtre (onglets Synchro, Raids, Compo, Patrons) ; aussi par le bouton de la minicarte",
  "/fr synchro | raids | compo | patrons : ouvrir directement un onglet",
  "Synchro rapide : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou clic droit sur le bouton de la minicarte",
  "/fr cherche <lien> : marquer un patron recherché (Maj+clic sur l'objet pour mettre son lien), ou l'en retirer",
  "/fr oublier Nom-Royaume : retirer un perso supprimé de l'export",
  "/fr minicarte : afficher ou masquer le bouton de la minicarte",
}

SLASH_FOREVERROSTER1 = "/fr"
SLASH_FOREVERROSTER2 = "/foreverroster"
-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060erreur (" .. label .. ")|r " .. tostring(err) .. " : envoie une capture de ce message.") end
  return ok
end

local TABS = { synchro = "synchro", sync = "synchro", export = "synchro", raids = "raids", groupe = "raids", compo = "compo", patrons = "patrons" }

-- Raccourcis clavier (Bindings.xml) : Échap > Options > Raccourcis > AddOns > Forever Roster
BINDING_HEADER_FOREVERROSTER = "Forever Roster"
BINDING_NAME_FOREVERROSTER_SYNC = "Synchro rapide avec le site (copier / coller)"
BINDING_NAME_FOREVERROSTER_TOGGLE = "Ouvrir ou fermer la fenêtre"
function ForeverRoster_Sync() ns.safe("raccourci", ns.UI.Quick) end
function ForeverRoster_Toggle() ns.safe("raccourci", ns.UI.Toggle) end

local function run(msg)
  local raw = strtrim(msg or "")
  local cmd, rest = raw:match("^(%S*)%s*(.-)$")
  cmd = (cmd or ""):lower()
  if cmd == "" then
    ns.UI.Toggle()
  elseif TABS[cmd] then
    ns.UI.Show(TABS[cmd])
  elseif cmd == "cherche" then
    local id = ns.Group.itemIdFrom(rest) or tonumber(rest)
    if not id then ns.print("tape /fr cherche puis Maj+clic sur le patron (sac, hôtel des ventes, chat) pour mettre son lien, et Entrée.") return end
    ns.Group.ToggleWanted(id, ns.Group.linkFor(id))
    ns.UI.Refresh()
  elseif cmd == "oublier" then
    local key = rest ~= "" and rest or nil
    if not (key and ForeverRosterDB.chars and ForeverRosterDB.chars[key] and ForeverRosterDB.chars[key].snapshot) then
      ns.print("perso inconnu : écris son nom et son royaume comme dans l'onglet Export, par ex. /fr oublier Greta-Classic Beta PvP")
      return
    end
    ns.Export.Forget(key)
    ns.print(key .. " retiré de l'export.")
  elseif cmd == "minicarte" or cmd == "minimap" then
    ns.Minimap.Toggle()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. line) end
  end
end
SlashCmdList.FOREVERROSTER = function(msg) ns.safe("/fr " .. (msg or ""), run, msg) end
