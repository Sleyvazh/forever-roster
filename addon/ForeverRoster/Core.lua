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
  -- Contrôle de chargement : chaque module doit avoir défini ses fonctions
  local missing = {}
  for mod, fn in pairs({ Format = "ParseFRR", Compo = "Load", Talents = "Capture", Export = "Build", Group = "Load", UI = "ShowGroup" }) do
    if not (ns[mod] and ns[mod][fn]) then missing[#missing + 1] = mod end
  end
  if #missing > 0 then ns.print("|cffff6060modules non chargés : " .. table.concat(missing, ", ") .. "|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)") end
end)

local HELP = {
  "/fr compo : coller la compo exportée par le site (invitations, placement des groupes)",
  "/fr export : texte à coller sur le site pour mettre à jour ce perso",
  "/fr groupe : raids à venir (inscription en jeu) et patrons recherchés de tes sacs",
  "/fr talents : diagnostic du système de talents (enregistré au prochain /reload)",
}

SLASH_FOREVERROSTER1 = "/fr"
SLASH_FOREVERROSTER2 = "/foreverroster"
-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060erreur (" .. label .. ")|r " .. tostring(err) .. " : envoie une capture de ce message.") end
  return ok
end

local function run(msg)
  local cmd = strtrim((msg or ""):lower())
  if cmd == "" or cmd == "compo" then
    ns.UI.ShowCompo()
  elseif cmd == "export" then
    ns.UI.ShowExport()
  elseif cmd == "groupe" or cmd == "patrons" or cmd == "raids" then
    ns.UI.ShowGroup()
  elseif cmd == "talents" then
    ns.Talents.Dump()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. line) end
  end
end
SlashCmdList.FOREVERROSTER = function(msg) ns.safe("/fr " .. (msg or ""), run, msg) end
