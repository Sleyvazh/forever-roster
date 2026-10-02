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
function ns.on(event, fn)
  if not handlers[event] then
    handlers[event] = {}
    frame:RegisterEvent(event)
  end
  table.insert(handlers[event], fn)
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
end)

local HELP = {
  "/fr compo : coller la compo exportée par le site (invitations, placement des groupes)",
  "/fr export : texte à coller sur le site pour mettre à jour ce perso",
  "/fr talents : diagnostic du système de talents (enregistré au prochain /reload)",
}

SLASH_FOREVERROSTER1 = "/fr"
SLASH_FOREVERROSTER2 = "/foreverroster"
SlashCmdList.FOREVERROSTER = function(msg)
  local cmd = strtrim((msg or ""):lower())
  if cmd == "" or cmd == "compo" then
    ns.UI.ShowCompo()
  elseif cmd == "export" then
    ns.UI.ShowExport()
  elseif cmd == "talents" then
    ns.Talents.Dump()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. line) end
  end
end
