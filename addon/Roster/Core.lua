-- Roster (WoW Retail) : socle (sauvegarde, événements, commandes /roster, raccourcis clavier).
-- Chargé avant Kit.lua (boîte à outils commune avec Forever Roster) : ns.db, ns.LOGO et ns.palette sont posés ici.
local ADDON, ns = ...
local L, N = ns.L, ns.N
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

-- Préfixe « Roster : » (français) ou « Roster: » (anglais)
function ns.print(...)
  print(ns.ACCENT .. "Roster|r" .. (ns.Lang() == "fr" and " :" or ":"), ...)
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
    if not ok then ns.print("|cffff6060" .. L["erreur"] .. "|r " .. tostring(err)) end
  end
end)

-- Une erreur dans une commande s'affiche dans le chat (WoW masque les erreurs Lua par défaut).
-- label : ce qui a échoué, déjà dans la langue de l'interface (L["…"] à l'appel)
function ns.safe(label, fn, ...)
  local ok, err = pcall(fn, ...)
  if not ok then ns.print("|cffff6060" .. L("erreur (%s)", tostring(label)) .. "|r " .. L("%s : envoie une capture de ce message.", tostring(err))) end
  return ok
end

-- Contrôle de chargement : chaque module doit avoir défini ses fonctions (sinon une erreur l'a arrêté en route)
local SCRIPT_ERRORS = N("(fais /console scriptErrors 1 puis /reload pour voir l'erreur)")
local MODULES = {
  { "Format" }, { "Comm", "AskVersions" }, { "Groups" }, { "Compo", "Invite" }, { "Recorder", "IsRecording" }, { "Hist", "Entries" },
  { "Loot", "Items" }, { "UI", "Show" }, { "Pages", "Build" }, { "LootUI", "ShowLoot" }, { "Test", "Start" }, { "Minimap", "Create" },
}
ns.on("ADDON_LOADED", function(name)
  if name ~= ns.name then return end
  RosterDB = RosterDB or {}
  ns.LocaleReady() -- langue choisie dans les options (sauvegarde) connue à partir d'ici
  ns.uiLang = ns.Lang() -- langue des fenêtres jusqu'au prochain rechargement de l'interface
  ns.BindingNames()
  RosterDB.version = ns.version
  local missing = {}
  for _, m in ipairs(MODULES) do
    local mod = ns[m[1]]
    if not (type(mod) == "table" and (not m[2] or mod[m[2]])) then missing[#missing + 1] = m[1] end
  end
  if #missing > 0 then
    ns.print("|cffff6060" .. L("modules non chargés : %s", table.concat(missing, ", ")) .. "|r " .. L[SCRIPT_ERRORS])
  end
end)

-- Fonction d'un autre fichier de l'addon ; s'il n'a pas été chargé, on le dit au lieu d'une erreur obscure
local function call(mod, fn, ...)
  local m = ns[mod]
  if not (m and m[fn]) then
    ns.print("|cffff6060" .. L("module %s non chargé", mod) .. "|r " .. L[SCRIPT_ERRORS])
    return
  end
  return m[fn](...)
end
ns.call = call

-- Raccourcis clavier (Bindings.xml) : Échap > Options > Raccourcis > AddOns > Roster. Noms posés à ADDON_LOADED,
-- une fois la langue choisie dans les options connue.
function ns.BindingNames()
  BINDING_HEADER_ROSTER = "Roster"
  BINDING_NAME_ROSTER_SYNC = L["Synchro rapide avec le site (copier / coller)"]
  BINDING_NAME_ROSTER_TOGGLE = L["Ouvrir ou fermer la fenêtre"]
end
function Roster_Sync() ns.safe(L["raccourci"], call, "UI", "Quick") end
function Roster_Toggle() ns.safe(L["raccourci"], call, "UI", "Toggle") end

-- Recharger l'interface : seulement après une action du joueur (clic, touche, commande tapée)
function ns.Reload()
  if C_UI and C_UI.Reload then C_UI.Reload() elseif ReloadUI then ReloadUI() end
end

-- Langue de l'interface (onglet Options, /roster langue) : RosterDB.lang = nil (celle du jeu), "fr" ou "en".
-- Les fenêtres sont construites une fois : la langue choisie s'applique partout au rechargement de l'interface.
-- Noms des langues : les mêmes dans toutes les langues (traduction identique), affichés par ns.LangName
ns.LANG_NAME = { fr = N("Français"), en = N("English") }
function ns.LangName(code) return L[ns.LANG_NAME[code]] end
--- Choix enregistré : nil (celle du jeu), "fr" ou "en"
function ns.LangChoice()
  local v = RosterDB and RosterDB.lang
  return (v == "fr" or v == "en") and v or nil
end
--- Nom du choix dans une phrase : « celle du jeu (Français) », « English »…
function ns.LangLabel(choice)
  if choice == "fr" or choice == "en" then return ns.LangName(choice) end
  return L("celle du jeu (%s)", ns.LangName(ns.ClientLang()))
end
--- La langue choisie diffère de celle des fenêtres affichées : rechargement de l'interface à proposer
function ns.LangPending() return ns.uiLang ~= nil and ns.Lang() ~= ns.uiLang end

-- Aide : textes en français (clés), traduits à l'affichage ; en anglais, l'aide montre les commandes anglaises
local HELP_LANG = N("/roster langue [fr | en | auto] : langue de l'interface (auto : celle du jeu ; recharge l'interface)")
local HELP = {
  N("/roster : ouvrir ou fermer la fenêtre (onglets Synchro, Raids, En raid, Compo, Butin, Options) ; aussi par le bouton de la minicarte"),
  N("/roster synchro | raids | enraid | compo | historique | options : ouvrir directement un onglet (historique : onglet Butin)"),
  N("/roster inviter : inviter les persos de la compo chargée ; /roster placer : les placer dans leurs groupes"),
  N("/roster versions : qui a l'addon dans le raid, et sa version"),
  N("/roster butin : fenêtre du chef de butin (objets reçus, conseil, jets MS / OS, jet libre, garder)"),
  N("/roster remettre : objets à remettre aux gagnants (échange, 2 h après le butin)"),
  N("/roster test : raid d'essai seul, hors groupe, avec 9 joueurs fictifs, pour essayer la distribution du butin (ensuite : affiche ou masque son panneau) ; /roster test fin : l'arrêter"),
  N("Synchro rapide : ta touche (Échap > Options > Raccourcis > AddOns > Roster), le clic droit sur le bouton de la minicarte ou sur Roster dans la liste des addons de la minicarte"),
  N("/roster minicarte : afficher ou masquer le bouton de la minicarte"),
  N("/roster habillage : passer de l'habillage du jeu à celui du site, et inversement (recharge l'interface)"),
  HELP_LANG,
}

-- Commandes : mots français, et leurs équivalents anglais
local TABS = { synchro = "synchro", raids = "raids", enraid = "enraid", compo = "compo", options = "options",
  sync = "synchro", inraid = "enraid", comp = "compo", historique = "loot", history = "loot" }
local ALIAS = {
  inviter = "invite", invite = "invite", placer = "arrange", place = "arrange", sort = "arrange", arrange = "arrange",
  versions = "versions", version = "versions", butin = "loot", loot = "loot", remettre = "handover", handover = "handover",
  test = "test", essai = "test", minicarte = "minimap", minimap = "minimap", habillage = "skin", skin = "skin",
  langue = "lang", language = "lang", lang = "lang",
}

local STOP = { fin = true, stop = true, arret = true, ["arrêt"] = true, quitter = true, ["end"] = true, quit = true, off = true } -- nolocale
-- /roster langue fr | en | auto (mots français et anglais) ; sans mot : passe à l'autre langue
local LANGS = { fr = "fr", ["français"] = "fr", francais = "fr", french = "fr", en = "en", english = "en", anglais = "en", -- nolocale
  auto = "auto", jeu = "auto", client = "auto", game = "auto" }

local function setLang(rest)
  local want = LANGS[rest]
  if rest == "" then want = ns.Lang() == "fr" and "en" or "fr" end
  if not want then ns.print(L[HELP_LANG]) return end
  RosterDB.lang = want ~= "auto" and want or nil
  -- Message dans la langue choisie ; rechargement seulement si les fenêtres ne sont pas déjà dans cette langue
  if ns.LangPending() then
    ns.print(L("langue : %s, rechargement de l'interface.", ns.LangLabel(ns.LangChoice())))
    ns.Reload()
  else
    ns.print(L("langue : %s.", ns.LangLabel(ns.LangChoice())))
  end
end

local function run(msg)
  local cmd, rest = strtrim(msg or ""):match("^(%S*)%s*(.-)$")
  cmd, rest = (cmd or ""):lower(), (rest or ""):lower()
  local action = ALIAS[cmd]
  if cmd == "" then
    call("UI", "Toggle")
  elseif TABS[cmd] then
    call("UI", "Show", TABS[cmd])
  elseif action == "invite" then
    call("Compo", "Invite")
  elseif action == "arrange" then
    call("Compo", "Arrange")
  elseif action == "versions" then
    call("Comm", "AskVersions")
  elseif action == "loot" then
    call("LootUI", "ShowLoot")
  elseif action == "handover" then
    call("LootUI", "ShowHandover")
  elseif action == "test" then
    if STOP[rest] then call("Test", "Stop") else call("Test", "Toggle") end
  elseif action == "minimap" then
    call("Minimap", "Toggle")
  elseif action == "skin" then
    RosterDB.skin = RosterDB.skin ~= "site" and "site" or nil -- nolocale (valeur de la sauvegarde)
    ns.print(RosterDB.skin == "site" and L["habillage du site : rechargement de l'interface."] or L["habillage du jeu : rechargement de l'interface."]) -- nolocale
    ns.Reload()
  elseif action == "lang" then
    setLang(rest)
  else
    ns.print("version " .. ns.version)
    for _, line in ipairs(HELP) do print("  " .. L[line]) end
  end
end

SLASH_ROSTER1 = "/roster"
SlashCmdList.ROSTER = function(msg) ns.safe("/roster " .. (msg or ""), run, msg) end
