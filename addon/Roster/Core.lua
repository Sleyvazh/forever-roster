-- Roster (WoW Retail) : socle (sauvegarde, événements, commandes /roster, raccourcis clavier).
-- Chargé avant Kit.lua (boîte à outils commune avec Forever Roster) : ns.db, ns.LOGO et ns.palette sont posés ici.
local ADDON, ns = ...
ns.name = ADDON or "Roster"
-- Logo de Roster (W et épée), dans la liste des addons, les fenêtres et le bouton de la minicarte
ns.LOGO = "Interface\\AddOns\\Roster\\Media\\Logo"

-- Couleurs de l'habillage « site » propres à Roster : accent argent-azur à la place de l'or de Forever
-- (thème sombre de roster.sleyvazh.fr, apps/web/src/styles.css : --gold #a9c6ea, --frame #4f6582)
ns.palette = { gold = { 0.663, 0.776, 0.918 }, frame = { 0.31, 0.396, 0.51 } }
ns.ACCENT = "|cffa9c6ea"

-- Sauvegarde de l'addon (nil avant ADDON_LOADED), lue aussi par la boîte à outils (habillage, tailles des fenêtres)
function ns.db() return RosterDB end

-- Version du .toc : C_AddOns sur Retail (la fonction globale a disparu des clients récents)
local meta = (C_AddOns and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
local okMeta, version = pcall(function() return meta and meta(ns.name, "Version") end)
ns.version = okMeta and version or "?"

function ns.print(...)
  print(ns.ACCENT .. "Roster|r :", ...)
end

-- Petit bus d'événements : ns.on("GROUP_ROSTER_UPDATE", fn). Un événement que ce client ne connaît pas est ignoré
-- (le jeu refuserait sinon tout le fichier) et noté dans ns.missingEvents ; ns.on renvoie alors false.
local frame = CreateFrame("Frame")
local handlers = {}
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

-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060erreur (" .. label .. ")|r " .. tostring(err) .. " : envoie une capture de ce message.") end
  return ok
end

-- Contrôle de chargement : chaque module doit avoir défini ses fonctions (sinon une erreur l'a arrêté en route)
local MODULES = {
  { "Format" }, { "Comm", "AskVersions" }, { "Groups" }, { "Compo", "Invite" }, { "Recorder", "IsRecording" },
  { "UI", "Show" }, { "Pages", "Build" }, { "Minimap", "Create" },
}
ns.on("ADDON_LOADED", function(name)
  if name ~= ns.name then return end
  RosterDB = RosterDB or {}
  RosterDB.version = ns.version
  local missing = {}
  for _, m in ipairs(MODULES) do
    local mod = ns[m[1]]
    if not (type(mod) == "table" and (not m[2] or mod[m[2]])) then missing[#missing + 1] = m[1] end
  end
  if #missing > 0 then
    ns.print("|cffff6060modules non chargés : " .. table.concat(missing, ", ") .. "|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)")
  end
end)

-- Fonction d'un autre fichier de l'addon ; s'il n'a pas été chargé, on le dit au lieu d'une erreur obscure
local function call(mod, fn, ...)
  local m = ns[mod]
  if not (m and m[fn]) then
    ns.print("|cffff6060module " .. mod .. " non chargé|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)")
    return
  end
  return m[fn](...)
end
ns.call = call

-- Raccourcis clavier (Bindings.xml) : Échap > Options > Raccourcis > AddOns > Roster
BINDING_HEADER_ROSTER = "Roster"
BINDING_NAME_ROSTER_SYNC = "Synchro rapide avec le site (copier / coller)"
BINDING_NAME_ROSTER_TOGGLE = "Ouvrir ou fermer la fenêtre"
function Roster_Sync() ns.safe("raccourci", call, "UI", "Quick") end
function Roster_Toggle() ns.safe("raccourci", call, "UI", "Toggle") end

-- Recharger l'interface : seulement après une action du joueur (clic, touche, commande tapée)
function ns.Reload()
  if C_UI and C_UI.Reload then C_UI.Reload() elseif ReloadUI then ReloadUI() end
end

local HELP = {
  "/roster : ouvrir ou fermer la fenêtre (onglets Synchro, Raids, En raid, Compo, Options) ; aussi par le bouton de la minicarte",
  "/roster synchro | raids | enraid | compo | options : ouvrir directement un onglet",
  "/roster inviter : inviter les persos de la compo chargée ; /roster placer : les placer dans leurs groupes",
  "/roster versions : qui a l'addon dans le raid, et sa version",
  "Synchro rapide : ta touche (Échap > Options > Raccourcis > AddOns > Roster), le clic droit sur le bouton de la minicarte ou sur Roster dans la liste des addons de la minicarte",
  "/roster minicarte : afficher ou masquer le bouton de la minicarte",
  "/roster habillage : passer de l'habillage du jeu à celui du site, et inversement (recharge l'interface)",
}

local TABS = { synchro = "synchro", raids = "raids", enraid = "enraid", compo = "compo", options = "options" }

local function run(msg)
  local cmd = strtrim(msg or ""):match("^(%S*)") or ""
  cmd = cmd:lower()
  if cmd == "" then
    call("UI", "Toggle")
  elseif TABS[cmd] then
    call("UI", "Show", TABS[cmd])
  elseif cmd == "inviter" then
    call("Compo", "Invite")
  elseif cmd == "placer" then
    call("Compo", "Arrange")
  elseif cmd == "versions" then
    call("Comm", "AskVersions")
  elseif cmd == "minicarte" then
    call("Minimap", "Toggle")
  elseif cmd == "habillage" then
    RosterDB.skin = RosterDB.skin ~= "site" and "site" or nil
    ns.print("habillage " .. (RosterDB.skin == "site" and "du site" or "du jeu") .. " : rechargement de l'interface.")
    ns.Reload()
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. line) end
  end
end

SLASH_ROSTER1 = "/roster"
SlashCmdList.ROSTER = function(msg) ns.safe("/roster " .. (msg or ""), run, msg) end
