-- Simulation de l'API de WoW Retail pour l'addon Roster : charge les fichiers du .toc dans l'ordre, puis la fenêtre,
-- les commandes /roster, les onglets dans les deux habillages, la synchro rapide, les options, la minicarte et la
-- liste des addons de la minicarte. lua5.1 addon/tests/roster_ui_test.lua (depuis la racine du dépôt).
-- Les fichiers de jeu (Format, Comm, Groups, Compo, Recorder, Pages) absents sont remplacés par des doublures qui
-- respectent le contrat ; présents, ce sont eux qui servent.
local printed = {}
function print(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end printed[#printed + 1] = table.concat(t, " ") end

-- Cadres : toute méthode existe et ne fait rien (sauf texte, visibilité, scripts et parent, utiles aux vérifications)
TEXTS = setmetatable({}, { __mode = "v" }) -- dernier cadre qui affiche ce texte
local function frame(parent)
  local f = { shown = false, text = "", scripts = {}, parent = parent }
  return setmetatable(f, { __index = function(_, k)
    if k == "Show" then return function(self) self.shown = true local h = rawget(self, "scripts").OnShow if h then h(self) end end end
    if k == "Hide" then return function(self) self.shown = false local h = rawget(self, "scripts").OnHide if h then h(self) end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, v) self.text = v if v then TEXTS[v] = self end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetScript" then return function(self, n, fn) rawget(self, "scripts")[n] = fn end end
    if k == "GetScript" then return function(self, n) return rawget(self, "scripts")[n] end end
    if k == "GetStringHeight" then return function() return 100 end end
    if k:match("^Create") then return function(self) return frame(self) end end
    return function() end
  end })
end
-- Comme le vrai client, un événement inconnu lève une erreur
local UNKNOWN = { EVENEMENT_INCONNU = true }
local events = {}
function CreateFrame(_, _, parent)
  local f = frame(parent)
  f.RegisterEvent = function(self, e)
    if UNKNOWN[e] then error("Attempt to register unknown event \"" .. e .. "\"") end
    events[e] = events[e] or {}
    events[e][#events[e] + 1] = self
  end
  return f
end
local function fire(e, ...)
  for _, f in ipairs(events[e] or {}) do local h = rawget(f, "scripts").OnEvent if h then h(f, e, ...) end end
end
local function script(f, name, ...) local h = assert(rawget(f, "scripts")[name], "script " .. name) return h(f, ...) end
local function click(text, ...)
  local f = assert(TEXTS[text], "bouton « " .. text .. " »")
  local b = rawget(f, "scripts").OnClick and f or f.parent -- bouton plat : le texte est sur une chaîne du bouton
  return script(b, "OnClick", ...)
end

-- API de WoW Retail utilisée par l'addon (et par ses fichiers de jeu)
UIParent, UISpecialFrames, RAID_CLASS_COLORS = frame(), {}, { DRUID = { colorStr = "ffff7c0a" }, MAGE = { colorStr = "ff3fc7eb" } }
SlashCmdList = {}
GameTooltip = frame()
Minimap = frame()
function Minimap:GetWidth() return 198 end
function Minimap:GetHeight() return 198 end
function Minimap:GetCenter() return 1800, 900 end
function Minimap:GetEffectiveScale() return 1 end
function GetCursorPosition() return 1700, 1000 end
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function strsplit(sep, s, limit)
  local out, start = {}, 1
  while true do
    local i = (not limit or #out < limit - 1) and s:find(sep, start, true)
    if not i then out[#out + 1] = s:sub(start) break end
    out[#out + 1] = s:sub(start, i - 1)
    start = i + #sep
  end
  return unpack(out)
end
function strjoin(sep, ...) return table.concat({ ... }, sep) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function tinsert(t, ...) table.insert(t, ...) end
function tremove(t, i) return table.remove(t, i) end
function tContains(t, v) for _, x in ipairs(t) do if x == v then return true end end return false end
format, floor, max, min = string.format, math.floor, math.max, math.min
function date(f, t) return os.date(f, t) end
local clock = 1790000000
function time() return clock end
function GetServerTime() return clock end
function GetTime() return 1000 end
local tickers = {}
C_Timer = { After = function(_, fn) fn() end, NewTicker = function(_, fn) tickers[#tickers + 1] = fn return { Cancel = function() end } end }
C_AddOns = { GetAddOnMetadata = function(name, key) assert(name == "Roster", "nom de l'addon") if key == "Version" then return "0.1.0" end end }
function GetBuildInfo() return "12.1.0", "63000", "Oct 1 2026", 120100 end
function UnitName(u) if u == "player" then return "Tournicoti" end end
function UnitFullName(u) if u == "player" then return "Tournicoti", "ConseildesOmbres" end end
function GetRealmName() return "Conseil des Ombres" end
function GetNormalizedRealmName() return "ConseildesOmbres" end
function UnitClass() return "Druide", "DRUID", 11 end
function UnitGUID() return "Player-1-0001" end
function UnitIsGroupLeader() return true end
function UnitIsGroupAssistant() return false end
function UnitIsConnected() return true end
function IsInRaid() return false end
function IsInGroup() return false end
function IsInInstance() return false, "none" end
function GetInstanceInfo() return "Hurlevent", "none", 0, "", 5, 0, false, 0 end
function GetNumGroupMembers() return 0 end
function GetRaidRosterInfo() return nil end
function InCombatLockdown() return false end
function SetRaidSubgroup() end
function SwapRaidSubgroup() end
function Ambiguate(n) return n end
C_PartyInfo = { InviteUnit = function() end, ConvertToRaid = function() end }
C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function() return 0 end, InChatMessagingLockdown = function() return false end }
C_Item = { GetItemInfo = function() return nil end, GetItemQualityByID = function() return 4 end, RequestLoadItemDataByID = function() end }
Enum = { ItemQuality = { Rare = 3, Epic = 4, Legendary = 5 } }
-- Raccourcis clavier
local BINDS = {}
function GetBindingKey(action) local out = {} for k, a in pairs(BINDS) do if a == action then out[#out + 1] = k end end table.sort(out) return unpack(out) end
function GetBindingAction(key) return BINDS[key] or "" end
function SetBinding(key, action) BINDS[key] = action return true end
function SaveBindings() end
function GetCurrentBindingSet() return 2 end
function GetBindingText(key) return key end
function IsAltKeyDown() return false end
function IsShiftKeyDown() return false end
function IsControlKeyDown() return false end
-- Rechargement de l'interface : compté (jamais appelé hors d'une action du joueur)
local reloads = 0
C_UI = { Reload = function() reloads = reloads + 1 end }

-- Variables de l'interface de Blizzard : l'addon ne doit jamais les réassigner, même à l'identique (sinon il
-- « contamine » l'interface du jeu : le jeu bloque alors des actions de Blizzard au nom de l'addon)
local BLIZZARD = { StaticPopupDialogs = {}, UISpecialFrames = UISpecialFrames, UIPanelWindows = {}, GameTooltip = GameTooltip, UIParent = UIParent,
  Minimap = Minimap, SlashCmdList = SlashCmdList, RAID_CLASS_COLORS = RAID_CLASS_COLORS, C_UI = C_UI, AddonCompartmentFrame = frame() }
for k in pairs(BLIZZARD) do rawset(_G, k, nil) end
local reassigned = {}
setmetatable(_G, { __index = BLIZZARD, __newindex = function(t, k, v)
  if BLIZZARD[k] ~= nil then reassigned[#reassigned + 1] = k end
  rawset(t, k, v)
end })

-- Fichiers du .toc : ceux de l'addon, sinon ceux communs avec Forever Roster (addon/shared, copiés dans le zip)
local function exists(path) local f = io.open(path) if f then f:close() return true end return false end
local ns = {}
local GAME = { ["Format.lua"] = true, ["Comm.lua"] = true, ["Groups.lua"] = true, ["Compo.lua"] = true, ["Recorder.lua"] = true, ["Pages.lua"] = true }
local toc = {}
for line in io.lines("addon/Roster/Roster.toc") do
  toc[#toc + 1] = line
  if line:match("%.lua$") then
    local path = exists("addon/Roster/" .. line) and ("addon/Roster/" .. line) or ("addon/shared/" .. line)
    if exists(path) then assert(loadfile(path))("Roster", ns)
    else assert(GAME[line], "fichier du .toc introuvable : " .. line) end
  end
end

-- Doublures des fichiers de jeu absents, selon le contrat (ns.Data, ns.Pages, ns.Compo, ns.Comm, ns.Recorder)
local stub = {}
local recording = false
local store = { pending = 1, loaded = false }
local BILAN = "RRB;1;r1;1790000000;1790003600;Tournicoti-ConseildesOmbres;Soirée;Libération de Terremine;1;heroic\n"
  .. "A;Tournicoti-ConseildesOmbres;1790000000;1790003600;60\nEND;1"
local function install(mod, impl)
  if ns[mod] == nil then ns[mod] = {} stub[mod] = true end
  for fn, f in pairs(impl) do if ns[mod][fn] == nil then ns[mod][fn] = f stub[mod] = true end end
end
install("Format", {})
install("Groups", {})
install("Comm", { AskVersions = function() end })
install("Compo", { Invite = function() end, Arrange = function() end })
install("Recorder", { IsRecording = function() return recording end })
install("Pages", { Build = function(_, page) page.stubText = page:CreateFontString() end, Refresh = function() end })
install("Data", {
  Load = function(text)
    if text:find("^%s*FR") then return false, "Texte de Forever Roster : colle-le dans l'addon Forever Roster." end
    if not text:find("^%s*RR[GR];1;") then return false, "Texte non reconnu." end
    store.loaded = true
    return true, "1 groupe chargé."
  end,
  ExportText = function(all) if store.pending > 0 or all then return BILAN, all and 1 or store.pending end return "", 0 end,
  MarkSent = function() store.pending = 0 end,
  PendingCount = function() return store.pending end,
  Summary = function() return store.loaded and "Données du site chargées." or "Aucune donnée du site." end,
})
-- Espions : appels du contrat comptés, vers la doublure ou le vrai fichier
local calls, lastArgs = {}, {}
local function spy(mod, fn)
  local real = ns[mod][fn]
  ns[mod][fn] = function(...)
    calls[mod .. "." .. fn] = (calls[mod .. "." .. fn] or 0) + 1
    lastArgs[mod .. "." .. fn] = { ... }
    return real(...)
  end
end
for _, s in ipairs({ { "Data", "Load" }, { "Data", "ExportText" }, { "Data", "MarkSent" }, { "Pages", "Build" }, { "Pages", "Refresh" },
  { "Compo", "Invite" }, { "Compo", "Arrange" }, { "Comm", "AskVersions" } }) do spy(s[1], s[2]) end
local function n(name) return calls[name] or 0 end

local function errors() local c = 0 for _, l in ipairs(printed) do if l:find("erreur") then c = c + 1 end end return c end
local failures = 0
local function run(cmd)
  local before = #printed
  SlashCmdList.ROSTER(cmd)
  for i = before + 1, #printed do
    if printed[i]:find("erreur") or printed[i]:find("non chargé") then failures = failures + 1 io.stderr:write("ÉCHEC /roster " .. cmd .. " : " .. printed[i] .. "\n") end
  end
end

-- 1. Chargement : socle, couleurs de Roster dans la boîte à outils, contrôle des modules
assert(ns.name == "Roster" and ns.version == "0.1.0" and ns.LOGO == "Interface\\AddOns\\Roster\\Media\\Logo", "nom, version, logo")
assert(ns.db() == nil, "pas de sauvegarde avant ADDON_LOADED")
local K = ns.Kit
assert(K and K.C.gold == ns.palette.gold and K.C.frame == ns.palette.frame and K.ACCENT == "|cffa9c6ea", "accent argent-azur dans la boîte à outils")
assert(K.hex({ 1, 0, 0.5 }) == "|cffff0080", "code couleur")
ns.UI.Refresh() -- fenêtre jamais construite : sans effet
fire("ADDON_LOADED", "AutreAddon")
assert(RosterDB == nil, "ADDON_LOADED d'un autre addon ignoré")
fire("ADDON_LOADED", "Roster")
assert(RosterDB and RosterDB.version == "0.1.0" and ns.db() == RosterDB, "sauvegarde créée")
for _, line in ipairs(printed) do assert(not line:find("non chargés"), line) end
assert(SLASH_ROSTER1 == "/roster" and SlashCmdList.ROSTER, "commande /roster")
-- Bus d'événements : événement inconnu ignoré, erreur d'un gestionnaire affichée
assert(ns.on("EVENEMENT_INCONNU", function() end) == false and ns.missingEvents[#ns.missingEvents] == "EVENEMENT_INCONNU", "événement inconnu noté")
assert(ns.on("TEST_ERREUR", function() error("boum") end) == true)
fire("TEST_ERREUR")
assert(printed[#printed]:find("^|cffa9c6eaRoster|r : |cffff6060erreur|r .*boum"), "erreur d'un gestionnaire dans le chat, préfixe à l'accent")
assert(not ns.safe("essai", function() error("bam") end) and printed[#printed]:find("erreur %(essai%)"), "ns.safe")
local baseErrors = errors()

-- 2. Connexion : bouton de la minicarte, pastille, REC
fire("PLAYER_LOGIN")
local M = ns.Minimap
assert(M.button and M.button:IsShown() and RosterDB.minimap and RosterDB.minimap.angle == 225, "bouton de la minicarte")
assert(#tickers >= 1, "pastille tenue à jour")
M.Update()
assert(not stub.Data or (M.count == 1 and M.button.badge:IsShown() and M.button.badge.text:GetText() == 1), "pastille : envois en attente")
recording = true
M.Update()
assert(not stub.Recorder or (M.recording and M.button.rec:IsShown()), "REC pendant le relevé")
recording = false
M.Update()
assert(not M.button.rec:IsShown(), "REC retiré")

-- 3. Commandes
run("")
assert(ns.UI.IsShown() and RosterDB.tab == "synchro", "/roster : fenêtre ouverte sur Synchro")
run("")
assert(not ns.UI.IsShown(), "/roster : fenêtre fermée")
for _, tab in ipairs({ "synchro", "raids", "enraid", "compo", "options" }) do
  run(tab)
  assert(ns.UI.IsShown() and RosterDB.tab == tab and ns.UI.pages[tab]:IsShown(), "/roster " .. tab)
  for key, p in pairs(ns.UI.pages) do assert(p:IsShown() == (key == tab), "une seule page affichée") end
end
assert(n("Pages.Build") == 3 and lastArgs["Pages.Build"][2] == ns.UI.pages.compo, "Pages.Build une fois par onglet de Pages.lua")
local refreshes = n("Pages.Refresh")
run("raids")
assert(n("Pages.Refresh") == refreshes + 1 and lastArgs["Pages.Refresh"][1] == "raids", "Pages.Refresh à l'affichage")
ns.UI.Refresh()
assert(n("Pages.Refresh") == refreshes + 2, "ns.UI.Refresh : onglet affiché")
run("inviter") run("placer") run("versions")
assert(n("Compo.Invite") == 1 and n("Compo.Arrange") == 1 and n("Comm.AskVersions") == 1, "inviter, placer, versions")
run("minicarte")
assert(RosterDB.minimap.hidden and not M.button:IsShown() and printed[#printed]:find("masqué"), "/roster minicarte : masqué")
run("minicarte")
assert(not RosterDB.minimap.hidden and M.button:IsShown(), "/roster minicarte : remis")
run("habillage")
assert(RosterDB.skin == "site" and reloads == 1, "/roster habillage : site, interface rechargée")
run("habillage")
assert(RosterDB.skin == nil and reloads == 2, "/roster habillage : retour au jeu")
local before = #printed
run("aide")
assert(printed[before + 1]:find("version 0.1.0") and #printed - before >= 6, "aide")
-- Fenêtre fermée : Refresh sans effet
ns.UI.Toggle()
assert(not ns.UI.IsShown())
refreshes = n("Pages.Refresh")
ns.UI.Refresh()
assert(n("Pages.Refresh") == refreshes, "fenêtre fermée : rien à rafraîchir")

-- 4. Synchro : collage chargé dès qu'il est complet, message en vert ou en rouge ; Ctrl+C = envoyé
run("synchro")
local sp = ns.UI.pages.synchro
local RRG = "RRG;1;g1;1790000000;Les Veilleurs\nR;r1;1790100000;Libération de Terremine;heroic;20;;;journal\nEND;1"
local loads = n("Data.Load")
sp.input:SetText("RRG;1;g1;1790000000;Les Veilleurs\nR;r1;1790100000;Libération")
script(sp.input, "OnTextChanged", true)
assert(n("Data.Load") == loads, "collage incomplet : on attend")
sp.input:SetText(RRG)
script(sp.input, "OnTextChanged", true)
assert(n("Data.Load") == loads + 1 and lastArgs["Data.Load"][1] == RRG and sp.input:GetText() == "", "données du site chargées au collage")
assert(sp.loadStatus:GetText():find("^|cff4fd35f"), "message en vert")
sp.input:SetText("FRG;1;g9;1789990000;Autre groupe\nR;r9;0;Onyxia;;\nEND;1")
script(sp.input, "OnTextChanged", true)
assert(n("Data.Load") == loads + 2 and sp.input:GetText() ~= "" and sp.loadStatus:GetText():find("^|cffff6b5e"), "texte de Forever refusé, en rouge")
sp.input:SetText("")
ns.UI.Refresh()
assert(sp.summary:GetText() ~= nil and lastArgs["Data.ExportText"][1] == false, "résumé et export des changements")
assert(sp.text:GetText() == sp.value, "export affiché")
if sp.count > 0 then
  IsControlKeyDown = function() return true end
  script(sp.text, "OnKeyDown", "C")
  IsControlKeyDown = function() return false end
  assert(n("Data.MarkSent") == 1 and sp.status:GetText():find("Copié"), "Ctrl+C : marqué envoyé")
end
-- Frappe dans l'export : le texte reste intact
sp.text:SetText("abc")
script(sp.text, "OnTextChanged", true)
assert(sp.text:GetText() == sp.value, "export intact")
script(sp.toggleAll, "OnClick")
assert(sp.all and lastArgs["Data.ExportText"][1] == true and sp.toggleAll:GetText() == "Seulement les changements", "Tout renvoyer")
script(sp.toggleAll, "OnClick")
assert(not sp.all and sp.toggleAll:GetText() == "Tout renvoyer", "retour aux changements")
ns.UI.Toggle()
assert(not ns.UI.IsShown())

-- 5. Synchro rapide (touche, clic droit) : export sélectionné ; Ctrl+C = envoyé et fermeture ; Ctrl+V = chargé et fermeture
assert(BINDING_HEADER_ROSTER == "Roster" and BINDING_NAME_ROSTER_SYNC and BINDING_NAME_ROSTER_TOGGLE, "raccourcis nommés")
store.pending = 1
local marks = n("Data.MarkSent")
Roster_Sync()
local q = ns.UI.quick
assert(q and q:IsShown() and q.box:GetText() == q.value, "synchro rapide : export prêt")
if q.count > 0 then
  IsControlKeyDown = function() return true end
  script(q.box, "OnKeyDown", "C")
  IsControlKeyDown = function() return false end
  assert(n("Data.MarkSent") == marks + 1 and not q:IsShown(), "synchro rapide : Ctrl+C = envoyé, fenêtre fermée")
  Roster_Sync()
end
assert(q:IsShown(), "synchro rapide rouverte")
q.box:SetText("n'importe quoi")
script(q.box, "OnTextChanged", true)
assert(q.box:GetText() == q.value, "synchro rapide : la frappe ne casse pas l'export")
q.box:SetText("FRG;1;g9;1789990000;Autre\nR;r9;0;Onyxia;;\nEND;1")
script(q.box, "OnTextChanged", true)
assert(q:IsShown() and q.status:GetText():find("^|cffff6b5e") and q.box:GetText() == q.value, "synchro rapide : texte refusé, export remis")
loads = n("Data.Load")
q.box:SetText(RRG)
script(q.box, "OnTextChanged", true)
assert(n("Data.Load") == loads + 1 and not q:IsShown(), "synchro rapide : données du site collées puis fermeture")
Roster_Sync() Roster_Sync()
assert(not q:IsShown(), "synchro rapide : la touche ouvre et ferme")
Roster_Sync()
script(q.allBtn, "OnClick")
assert(q:IsShown() and lastArgs["Data.ExportText"][1] == true, "synchro rapide : tout renvoyer")
click("Fenêtre complète")
assert(not q:IsShown() and ns.UI.IsShown() and RosterDB.tab == "synchro", "synchro rapide : fenêtre complète")
Roster_Toggle()
assert(not ns.UI.IsShown(), "touche : fenêtre fermée")
Roster_Toggle()
assert(ns.UI.IsShown(), "touche : fenêtre ouverte")

-- 6. Options : touches, habillage, minicarte, relevé et seuil du butin (lus par Recorder.lua)
run("options")
ns.UI.StartCapture("ROSTER_SYNC")
local cap = ns.UI.captureFrame
assert(cap:IsShown() and ns.UI.capturing() == "ROSTER_SYNC", "attente d'une touche")
script(cap, "OnKeyDown", "LCTRL")
assert(cap:IsShown(), "modificateur seul ignoré")
BINDS.F8 = "TOGGLEBAG1"
script(cap, "OnKeyDown", "F8")
assert(BINDS.F8 == "ROSTER_SYNC" and not cap:IsShown(), "touche F8 enregistrée (et reprise à une autre action)")
ns.UI.StartCapture("ROSTER_SYNC")
IsShiftKeyDown = function() return true end
script(cap, "OnKeyDown", "G")
IsShiftKeyDown = function() return false end
assert(BINDS["SHIFT-G"] == "ROSTER_SYNC" and BINDS.F8 == nil, "nouvelle touche : l'ancienne est libérée")
click("Choisir une touche") -- dernière ligne affichée : ouvrir ou fermer la fenêtre
assert(ns.UI.capturing() == "ROSTER_TOGGLE", "bouton « Choisir une touche »")
script(cap, "OnKeyDown", "ESCAPE")
assert(select("#", GetBindingKey("ROSTER_TOGGLE")) == 0 and not cap:IsShown(), "Échap annule")
click("Retirer")
assert(BINDS["SHIFT-G"] == nil, "touche retirée")
InCombatLockdown = function() return true end
assert(not ns.UI.SetBinding("ROSTER_SYNC", "F9") and BINDS.F9 == nil, "pas de touche en combat")
ns.UI.StartCapture("ROSTER_SYNC")
assert(not ns.UI.capturing(), "pas d'attente de touche en combat")
InCombatLockdown = function() return false end
click("Non")
assert(RosterDB.record == false, "relevé coupé")
click("Oui")
assert(RosterDB.record == nil, "relevé remis (nil = activé)")
click("Rare")
assert(RosterDB.lootQuality == 3, "seuil rare")
click("Légendaire")
assert(RosterDB.lootQuality == 5, "seuil légendaire")
click("Épique")
assert(RosterDB.lootQuality == 4, "seuil épique")
click("Masquer")
assert(RosterDB.minimap.hidden and not M.button:IsShown(), "minicarte masquée depuis les options")
click("Afficher")
assert(not RosterDB.minimap.hidden and M.button:IsShown(), "minicarte affichée depuis les options")
local reloadsBefore = reloads
click("Site")
assert(RosterDB.skin == "site" and reloads == reloadsBefore and TEXTS["Recharger"] and TEXTS["Recharger"]:IsShown() ~= false, "habillage choisi, pas encore appliqué")
click("Recharger")
assert(reloads == reloadsBefore + 1, "Recharger : interface rechargée au clic")
click("Jeu")
assert(RosterDB.skin == nil, "habillage du jeu")

-- 7. Minicarte : clic, clic droit, glisser, minicarte carrée, infobulle ; liste des addons de la minicarte
ns.UI.Toggle()
script(M.button, "OnClick", "LeftButton")
assert(ns.UI.IsShown(), "minicarte : clic ouvre la fenêtre")
script(M.button, "OnClick", "LeftButton")
assert(not ns.UI.IsShown(), "minicarte : clic ferme la fenêtre")
script(M.button, "OnClick", "RightButton")
assert(q:IsShown(), "minicarte : clic droit, synchro rapide")
script(M.button, "OnClick", "RightButton")
assert(not q:IsShown(), "minicarte : clic droit referme")
script(M.button, "OnDragStart")
script(M.button, "OnUpdate")
assert(math.abs(RosterDB.minimap.angle - 135) < 0.001, "glisser : angle gardé")
GetMinimapShape = function() return "SQUARE" end -- minicarte carrée (addon de minicarte)
script(M.button, "OnUpdate")
GetMinimapShape = nil
script(M.button, "OnDragStop")
assert(rawget(M.button, "scripts").OnUpdate == nil, "fin du glisser")
script(M.button, "OnEnter")
script(M.button, "OnLeave")
local toc_ = table.concat(toc, "\n")
local function tocFunc(key) return _G[assert(toc_:match("\n## " .. key .. ": (%S+)"), key)] end
assert(toc_:find("\n## IconTexture: Interface\\AddOns\\Roster\\Media\\Logo\n", 1, true), "icône de la liste des addons")
tocFunc("AddonCompartmentFunc")("Roster", "LeftButton")
assert(ns.UI.IsShown(), "liste des addons : clic ouvre la fenêtre")
tocFunc("AddonCompartmentFunc")("Roster", "LeftButton")
tocFunc("AddonCompartmentFunc")("Roster", "RightButton")
assert(not ns.UI.IsShown() and q:IsShown(), "liste des addons : clic droit, synchro rapide")
q:Hide()
tocFunc("AddonCompartmentFuncOnEnter")("Roster", frame())
tocFunc("AddonCompartmentFuncOnLeave")("Roster", frame())
-- Raccourcis (Bindings.xml) et logo (TGA 32 bits 128 × 128)
local xml = assert(io.open("addon/Roster/Bindings.xml")):read("*a")
assert(xml:find('name="ROSTER_SYNC" header="ROSTER"', 1, true) and xml:find("Roster_Sync()", 1, true) and xml:find("Roster_Toggle()", 1, true), "Bindings.xml")
local tga = assert(io.open("addon/Roster/Media/Logo.tga", "rb")):read("*a")
assert(tga:byte(3) == 2 and tga:byte(13) + tga:byte(14) * 256 == 128 and tga:byte(15) + tga:byte(16) * 256 == 128 and tga:byte(17) == 32, "logo TGA 32 bits 128 × 128")
assert(#tga >= 18 + 128 * 128 * 4, "logo sans compression")
local esc = {}
for _, name in ipairs(UISpecialFrames) do esc[name] = true end
assert(esc.RosterMain and esc.RosterQuick, "Échap ferme les fenêtres")
assert(errors() == baseErrors and failures == 0, "habillage du jeu sans erreur")

-- 8. Habillage du site : fenêtres reconstruites (interface rechargée), chaque onglet, la synchro rapide, les options
RosterDB.skin = "site"
assert(loadfile("addon/Roster/UI.lua"))("Roster", ns)
assert(ns.UI.site(), "habillage du site choisi")
local builds = n("Pages.Build")
for _, tab in ipairs({ "synchro", "raids", "enraid", "compo", "options" }) do
  ns.UI.Show(tab)
  assert(ns.UI.pages[tab]:IsShown(), "onglet " .. tab .. " (site)")
end
assert(n("Pages.Build") == builds + 3, "pages reconstruites")
ns.UI.Quick()
assert(ns.UI.quick:IsShown(), "synchro rapide (site)")
ns.UI.Quick()
RosterDB.skin = nil -- changement d'habillage : proposé au rechargement
ns.UI.Show("options")
local offered = false
for text in pairs(TEXTS) do if type(text) == "string" and text:find("appliqué après rechargement", 1, true) then offered = true end end
assert(not ns.UI.site() and offered, "rechargement proposé")
assert(errors() == baseErrors and failures == 0, "habillage du site sans erreur")

-- 9. Aucune variable de Blizzard réassignée, aucune erreur
assert(#reassigned == 0, "variables de Blizzard réassignées par l'addon : " .. table.concat(reassigned, ", "))
local stubs = {}
for mod in pairs(stub) do stubs[#stubs + 1] = mod end
table.sort(stubs)
print = function(...) io.stdout:write(table.concat({ ... }, " ") .. "\n") end
print("roster_ui_test : tout est bon" .. (#stubs > 0 and (" (doublures : " .. table.concat(stubs, ", ") .. ")") or ""))
