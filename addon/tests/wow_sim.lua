-- Simulation minimale de l'API de WoW : charge l'addon dans l'ordre du .toc et lance ses commandes.
-- lua5.1 addon/tests/wow_sim.lua (depuis la racine du dépôt). Échoue si une commande lève une erreur.
-- Textes de l'interface (addon/tests/locale_audit.lua) ; langue du client : WOW_LOCALE (frFR par défaut)
LOCALE_AUDIT = dofile("addon/tests/locale_audit.lua")
function GetLocale() return os.getenv("WOW_LOCALE") or "frFR" end
local printed = {}
function print(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end printed[#printed + 1] = table.concat(t, " ") LOCALE_AUDIT.show(printed[#printed]) end

-- Cadres : toute méthode existe et ne fait rien (sauf texte et visibilité, utiles aux vérifications)
TEXTS = setmetatable({}, { __mode = "v" }) -- dernier cadre qui affiche ce texte (boutons)
local function frame()
  local f = { shown = false, text = "", scripts = {} }
  return setmetatable(f, { __index = function(t, k)
    if k == "Show" then return function(self) self.shown = true local h = rawget(self, "scripts").OnShow if h then h(self) end end end
    if k == "Hide" then return function(self) self.shown = false local h = rawget(self, "scripts").OnHide if h then h(self) end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, v) self.text = v if v then TEXTS[v] = self LOCALE_AUDIT.show(v) end end end
    if k == "AddLine" or k == "AddDoubleLine" then return function(_, x, y) LOCALE_AUDIT.show(x) LOCALE_AUDIT.show(y) end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetScript" then return function(self, n, fn) rawget(self, "scripts")[n] = fn end end
    if k == "GetStringHeight" then return function() return 100 end end
    if k:match("^Create") then return function() return frame() end end
    return function() end
  end })
end
-- Comme le vrai client, un événement inconnu lève une erreur (cas du client Forever avec les événements de métier Classic)
local UNKNOWN = { TRADE_SKILL_UPDATE = true, CRAFT_SHOW = true, CRAFT_UPDATE = true }
local events = {}
function CreateFrame() local f = frame() f.RegisterEvent = function(_, e) if UNKNOWN[e] then error("Attempt to register unknown event \"" .. e .. "\"") end events[e] = f end return f end
local function fire(e, ...) local f = events[e] if f then rawget(f, "scripts").OnEvent(f, e, ...) end end
UIParent, UISpecialFrames, RAID_CLASS_COLORS = frame(), {}, { DRUID = { colorStr = "ffff7c0a" } }
SlashCmdList = {}
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function tinsert(t, v) table.insert(t, v) end
function date(f, t) return os.date(f, t) end
local tickers = {}
C_Timer = { After = function(_, fn) fn() end, NewTicker = function(_, fn) tickers[#tickers + 1] = fn return {} end }
GetAddOnMetadata = function() return "0.1.1" end
function UnitName() return "Tournicoti" end
function GetRealmName() return "Forever EU" end
function UnitClass() return "Druide", "DRUID" end
function UnitRace() return "Tauren", "Tauren" end
function UnitLevel() return 60 end
function UnitFactionGroup() return "Horde", "Horde" end
function GetBuildInfo() return "1.60.1", "70170", "Oct 1 2026", 16001 end
function GetInventoryItemID(_, slot) return slot == 1 and 16866 or nil end
-- Comme le client Forever : pas de liste des compétences (GetNumSkillLines absent)
GetNumCrafts = function() return 0 end
-- Métiers par l'API moderne (pas de GetNumTradeSkills)
C_TradeSkillUI = {
  GetAllRecipeIDs = function() return { 2152, 2153 } end,
  GetRecipeInfo = function(id) return { learned = id == 2152 } end,
  GetBaseProfessionInfo = function() return { professionName = "Leatherworking", skillLevel = 150, maxSkillLevel = 225 } end,
}
-- Sacs, objets, chat, infobulles (API moderne)
local BAG = { [0] = { 15090, 2589, 9999 }, [1] = {} }
C_Container = { GetContainerNumSlots = function(bag) return BAG[bag] and #BAG[bag] or 0 end, GetContainerItemID = function(bag, slot) return BAG[bag] and BAG[bag][slot] end }
NUM_BAG_SLOTS = 4
function GetItemInfo(id) return "Objet " .. id, "|cff0070dd|Hitem:" .. id .. "::::::::60:::::|h[Objet " .. id .. "]|h|r" end
local said = {}
function SendChatMessage(text, channel) LOCALE_AUDIT.show(text) said[#said + 1] = channel .. ":" .. text end
LOOT_ITEM_SELF = "Vous recevez le butin : %s."
Enum = { TooltipDataType = { Item = 0 } }
local tooltipHook
TooltipDataProcessor = { AddTooltipPostCall = function(_, fn) tooltipHook = fn end }
function GetItemInfoInstant(id) return id, "", "", "", 0, (id == 15090 or id == 9999) and 9 or 0 end
Minimap = frame()
function Minimap:GetWidth() return 140 end
GameTooltip = frame()
function IsInRaid() return false end
function IsInGroup() return false end
function GetNumGroupMembers() return 0 end
local ROSTER = {}
function GetRaidRosterInfo(i) return ROSTER[i] end
function GetNumSubgroupMembers() return 0 end
function UnitIsGroupLeader() return true end
function UnitIsGroupAssistant() return false end
function InCombatLockdown() return false end
-- Addons chargés à la demande (ForeverRoster_Data1 à 20) : lus dans ADDONS_DIR quand il est donné (section 9)
local ADDONS_DIR, LOADED = nil, {}
function IsAddOnLoaded(name) return LOADED[name] == true end
function GetAddOnInfo(name)
  local f = ADDONS_DIR and io.open(ADDONS_DIR .. "/" .. name .. "/" .. name .. ".toc")
  if not f then return name, nil, nil, false, "MISSING" end
  f:close()
  return name, name, "", true, "DEMAND_LOADED"
end
function LoadAddOn(name)
  if LOADED[name] then return true end
  local chunk = ADDONS_DIR and loadfile(ADDONS_DIR .. "/" .. name .. "/Data.lua")
  if not chunk then return nil, "MISSING" end
  chunk()
  LOADED[name] = true
  return true
end
function Ambiguate(n) return n end
function time() return 1790000000 end
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

-- Variables de l'interface de Blizzard : l'addon ne doit jamais les réassigner, même à l'identique (sinon il
-- « contamine » l'interface du jeu : le jeu bloque alors des actions de Blizzard au nom de l'addon)
local BLIZZARD = { StaticPopupDialogs = {}, UISpecialFrames = UISpecialFrames, UIPanelWindows = {}, GameTooltip = GameTooltip, UIParent = UIParent, Minimap = Minimap }
for k in pairs(BLIZZARD) do rawset(_G, k, nil) end
local reassigned = {}
setmetatable(_G, { __index = BLIZZARD, __newindex = function(t, k, v)
  if BLIZZARD[k] ~= nil then reassigned[#reassigned + 1] = k end
  rawset(t, k, v)
end })
local ns = {}
LOCALE_AUDIT.install(ns)
-- Fichiers du .toc : ceux de l'addon, sinon ceux communs avec Roster (addon/shared, copiés dans le zip)
local function addonFile(line)
  local own = "addon/ForeverRoster/" .. line
  local f = io.open(own) if f then f:close() return own end
  return "addon/shared/" .. line
end
for line in io.lines("addon/ForeverRoster/ForeverRoster.toc") do
  if line:match("%.lua$") then assert(loadfile(addonFile(line)))("ForeverRoster", ns) end
end
-- Déclenche ADDON_LOADED par le gestionnaire enregistré
fire("ADDON_LOADED", "ForeverRoster")
assert(#reassigned == 0, "variables de Blizzard réassignées par l'addon : " .. table.concat(reassigned, ", "))
for _, line in ipairs(printed) do assert(not line:find("non chargés"), line) end

local failures = 0
local function run(cmd)
  local before = #printed
  SlashCmdList.FOREVERROSTER(cmd)
  for i = before + 1, #printed do if printed[i]:find("erreur") then failures = failures + 1 io.stderr:write("ÉCHEC /fr " .. cmd .. " : " .. printed[i] .. "\n") end end
end

-- 1. Sans système de talents (C_Traits absent)
run("export")
-- 2. Avec un système de talents simulé
C_ClassTalents = { GetActiveConfigID = function() return 42 end }
C_Traits = {
  GetConfigInfo = function() return { treeIDs = { 7 } } end,
  GetTreeNodes = function() return { 101, 102 } end,
  GetNodeInfo = function(_, id) return { ID = id, posX = 600, posY = 1200, currentRank = id == 101 and 2 or 0, maxRanks = 3, entryIDs = { id * 10 }, isVisible = true } end,
  GetEntryInfo = function(_, e) return { definitionID = e + 1 } end,
  GetDefinitionInfo = function(d) return { spellID = d * 2 } end,
  GetTreeInfo = function() return { ID = 7 } end,
}
function GetSpellInfo(id) return "Talent " .. id, nil, 136000 end
run("export")
assert(#ns.Talents.Capture().nodes == 2, "talents lus")
-- 3. Système de talents qui lève une erreur : l'export continue sans les talents
C_Traits.GetConfigInfo = function() error("API différente") end
run("export")
-- Ouverture d'une fenêtre de métier : patrons relevés par C_TradeSkillUI
fire("TRADE_SKILL_SHOW")
assert(ForeverRosterDB.chars["Tournicoti-Forever EU"].recipes.Leatherworking.s2152 and not ForeverRosterDB.chars["Tournicoti-Forever EU"].recipes.Leatherworking.s2153, "patrons appris seulement")
-- 4. Groupes : données du site, inscription en jeu, infobulle, sacs, butin, patron marqué en jeu, BiS
fire("PLAYER_LOGIN")
run("")
run("raids")
assert(ns.Group.Load("FRG;1;6f1c2a10-0000-4000-8000-000000000001;1789990000;Les Veilleurs\nR;7a1c2a10-0000-4000-8000-000000000002;1790100000;Molten Core;;\nP;15090;Warbear Woolies;Greta,Sley;Tournicoti\nB;16866;Greta\nEND;3"))
ns.UI.Refresh()
local raids = ns.Group.Raids()
assert(#raids == 1 and raids[1].raid.name == "Molten Core", "raid à venir")
ns.Group.SignUp(raids[1].group.id, raids[1].raid.id, "late", raids[1].raid.time)
assert(ns.Export.Build():find("\nS;6f1c2a10%-0000%-4000%-8000%-000000000001;7a1c2a10%-0000%-4000%-8000%-000000000002;late\n"), "inscription dans l'export")
local tracked, others = ns.Group.BagPatterns()
assert(#tracked == 1 and tracked[1].itemId == 15090, "patron suivi dans les sacs")
assert(#others == 1 and others[1].itemId == 9999, "autre patron des sacs")
run("patrons")
-- Marquer un patron recherché en jeu : par la commande (lien) puis l'export
run("cherche |cff1eff00|Hitem:9999::::::::60:::::|h[Recipe: Test]|h|r")
assert(ns.Group.IsWantedHere(9999), "patron marqué recherché")
assert(ns.Export.Build():find("\nW;9999;1\n"), "patron recherché dans l'export")
run("cherche |cff1eff00|Hitem:9999::::::::60:::::|h[Recipe: Test]|h|r")
assert(ns.Export.Build():find("\nW;9999;0\n"), "patron retiré dans l'export")
local tip = { lines = {} }
function tip:AddLine(t) self.lines[#self.lines + 1] = t end
assert(tooltipHook, "infobulles branchées")
tooltipHook(tip, { id = 15090 })
assert(table.concat(tip.lines, "\n"):find("Recherché par : |cff4fd35fGreta, Sley"), "infobulle du patron")
tip.lines = {}
tooltipHook(tip, { id = 16866 })
assert(table.concat(tip.lines, "\n"):find("BiS de : |cff6fb7ffGreta"), "infobulle d'un BiS")
ns.Group.OnLoot("Vous recevez le butin : |cff0070dd|Hitem:15090::::::::60:::::|h[Pattern: Warbear Woolies]|h|r.", "")
assert(printed[#printed]:find("ramassé : .*recherché par Greta, Sley"), "alerte au butin")
ns.Group.OnLoot("Vous recevez le butin : |cffa335ee|Hitem:16866::::::::60:::::|h[Helm]|h|r.", "")
assert(printed[#printed]:find("BiS de Greta"), "alerte au butin (BiS)")
IsInRaid = function() return true end
ns.Group.Announce(15090)
assert(said[1] and said[1]:find("^RAID:.*recherché par Greta, Sley"), "annonce au raid")
IsInRaid = function() return false end
-- Butin d'un autre joueur : pas d'alerte
local before = #printed
ns.Group.OnLoot("Bob reçoit le butin : |cff0070dd|Hitem:15090::::::::60:::::|h[Pattern: Warbear Woolies]|h|r.", "Bob")
assert(#printed == before, "butin d'un autre ignoré")
-- Plusieurs persos : un second perso relevé apparaît dans l'export, puis on l'oublie
ForeverRosterDB.chars["Greta-Forever EU"] = { recipes = {}, snapshot = { header = { name = "Greta", realm = "Forever EU", class = "DRUID", race = "Tauren", level = 20, faction = "Horde" }, lines = { { "G", 1, 16866 } }, at = 1789000000 } }
local all = ns.Export.Build()
assert(all:find("^FRC;2;Tournicoti;") and all:find("\nFRC;2;Greta;Forever EU;DRUID;Tauren;20;Horde;1789000000;"), "export de tous les persos")
assert(not ns.Export.Build(true):find("Greta;Forever"), "export du perso seul")
run("export")
run("oublier Greta-Forever EU")
assert(not ns.Export.Build():find("FRC;2;Greta"), "perso oublié")
-- Relevé automatique quand l'équipement change
ForeverRosterDB.chars["Tournicoti-Forever EU"].snapshot = nil
fire("PLAYER_EQUIPMENT_CHANGED")
assert(ForeverRosterDB.chars["Tournicoti-Forever EU"].snapshot, "relevé automatique")
run("minicarte")
run("minicarte")
-- Synchro : coller les données du site (chargées toutes seules), Ctrl+C = envoyé, changement = à renvoyer
run("synchro")
local sp = ns.UI.pages.synchro
assert(sp, "onglet Synchro")
sp.input:SetText("FRG;1;g9;1789990000;Autre groupe\nR;r9;0;Onyxia;;\nEND;1")
rawget(sp.input, "scripts").OnTextChanged(sp.input, true)
local found = false
for _, g in ipairs(ns.Group.List()) do if g.name == "Autre groupe" then found = true end end
assert(found and ForeverRosterDB.lastLoad and sp.input:GetText() == "", "données du site chargées au collage")
sp.input:SetText("FRR;1;x;0;Raid du soir\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1")
rawget(sp.input, "scripts").OnTextChanged(sp.input, true)
assert(ns.Compo.Get().name == "Raid du soir", "compo chargée au collage")
assert(#ns.Export.Pending() >= 1, "perso à envoyer")
IsControlKeyDown = function() return true end
ns.UI.Refresh()
rawget(sp.text, "scripts").OnKeyDown(sp.text, "C")
assert(#ns.Export.Pending() == 0, "Ctrl+C : marqué envoyé")
assert(select(2, ns.Export.Build({})) and #select(2, ns.Export.Build({})) == 0, "rien de nouveau")
ns.Group.SignUp("g9", "r9", "present", 0)
assert(#ns.Export.Pending() == 1, "inscription : à renvoyer")
assert(BINDING_NAME_FOREVERROSTER_SYNC and ForeverRoster_Sync and ForeverRoster_Toggle, "raccourcis clavier")
-- Synchro rapide (touche, clic droit minicarte) : une seule case, l'export déjà sélectionné
ForeverRoster_Sync()
local q = ns.UI.quick
assert(q and q:IsShown() and q.box:GetText():find("^FRC;2;Tournicoti;"), "synchro rapide : export prêt")
rawget(q.box, "scripts").OnKeyDown(q.box, "C")
assert(#ns.Export.Pending() == 0 and not q:IsShown(), "synchro rapide : Ctrl+C = envoyé, fenêtre fermée")
ForeverRoster_Sync()
assert(q:IsShown() and q.box:GetText() == "" and q.status:GetText():find("Rien de nouveau"), "synchro rapide : rien à envoyer")
q.box:SetText("n'importe quoi")
rawget(q.box, "scripts").OnTextChanged(q.box, true)
assert(q.box:GetText() == "", "synchro rapide : la frappe ne casse pas l'export")
q.box:SetText("FRG;1;g8;1789990000;Groupe rapide\nR;r8;0;Molten Core;;\nEND;1")
rawget(q.box, "scripts").OnTextChanged(q.box, true)
found = false
for _, g in ipairs(ns.Group.List()) do if g.name == "Groupe rapide" then found = true end end
assert(found and not q:IsShown(), "synchro rapide : données du site collées puis fermeture")
ForeverRoster_Sync() ForeverRoster_Sync()
assert(not q:IsShown(), "synchro rapide : la touche ouvre et ferme")
-- Rappel de raid à la connexion : raid dans les 24 h sans réponse → « Tu viens ? » ; répondu → ligne dans le chat
local soon = time() + 3 * 3600
assert(ns.UI.LoadFromSite("FRG;1;g7;1789990000;Rappel\nR;r7;" .. soon .. ";Blackwing Lair;;\nR;r6;" .. (soon + 600) .. ";Zul'Gurub;present;Tournicoti\nEND;2"))
fire("PLAYER_LOGIN")
local rm = ns.UI.reminder
assert(rm and rm:IsShown() and rm.text:GetText():find("Blackwing Lair") and rm.entry.raid.id == "r7", "rappel : raid sans réponse proposé")
local chat = false
for _, l in ipairs(printed) do if l:find("Zul'Gurub") and l:find("Présent") then chat = true end end
assert(chat, "rappel : raid déjà répondu dans le chat")
rawget(rm.buttons[1], "scripts").OnClick(rm.buttons[1])
assert(ns.charDB().signups.r7.status == "present" and rm.entry == false and rm.text:GetText():find("Noté"), "rappel : inscription notée, invitation à synchroniser")
assert(#select(1, ns.UI.SoonRaids()) == 0, "rappel : plus rien à demander")
run("rappels")
assert(ForeverRosterDB.noReminder, "/fr rappels coupe")
run("rappels")
assert(not ForeverRosterDB.noReminder, "/fr rappels remet")
-- Onglet Options : touches, minicarte, rappels, persos de l'export
local function errors() local n = 0 for _, l in ipairs(printed) do if l:find("erreur") then n = n + 1 end end return n end
local before = errors()
run("options")
assert(ns.UI.pages.options and ForeverRosterDB.tab == "options", "onglet Options")
ns.UI.StartCapture("FOREVERROSTER_SYNC")
local cap = ns.UI.captureFrame
assert(cap:IsShown() and ns.UI.capturing() == "FOREVERROSTER_SYNC", "attente d'une touche")
rawget(cap, "scripts").OnKeyDown(cap, "LCTRL") -- une touche de modification seule ne compte pas
assert(cap:IsShown(), "modificateur seul ignoré")
IsControlKeyDown = function() return false end
BINDS.F8 = "TOGGLEBAG1"
rawget(cap, "scripts").OnKeyDown(cap, "F8")
assert(BINDS.F8 == "FOREVERROSTER_SYNC" and not cap:IsShown(), "touche F8 enregistrée (et reprise à une autre action)")
ns.UI.StartCapture("FOREVERROSTER_SYNC")
IsShiftKeyDown = function() return true end
rawget(cap, "scripts").OnKeyDown(cap, "G")
IsShiftKeyDown = function() return false end
assert(BINDS["SHIFT-G"] == "FOREVERROSTER_SYNC" and BINDS.F8 == nil, "nouvelle touche : l'ancienne est libérée")
ns.UI.StartCapture("FOREVERROSTER_TOGGLE")
rawget(cap, "scripts").OnKeyDown(cap, "ESCAPE")
assert(select("#", GetBindingKey("FOREVERROSTER_TOGGLE")) == 0 and not cap:IsShown(), "Échap annule")
ns.UI.SetBinding("FOREVERROSTER_SYNC", nil)
assert(BINDS["SHIFT-G"] == nil, "touche retirée")
ns.Minimap.SetShown(false)
assert(ForeverRosterDB.minimap.hidden, "minicarte masquée")
ns.Minimap.SetShown(true)
assert(not ForeverRosterDB.minimap.hidden, "minicarte affichée")
ForeverRosterDB.chars["Greta-Forever EU"] = { recipes = {}, snapshot = { header = { name = "Greta", realm = "Forever EU", class = "DRUID", level = 20 }, lines = {}, at = 1789000000 } }
ns.UI.pages.options.confirm = "Greta-Forever EU"
ns.UI.Refresh()
assert(errors() == before, "onglet Options affiché sans erreur")
-- Langue (Options) : celle du jeu par défaut ; Français ou English, appliquée au rechargement de l'interface
assert(ForeverRosterDB.lang == nil and ns.Lang() == "fr" and TEXTS["Celle du jeu (Français)"], "langue : celle du jeu par défaut")
ns.UI.SetLang("en")
assert(ForeverRosterDB.lang == "en" and ns.Lang() == "en" and ns.L["Synchro"] == "Sync" and TEXTS["Game client (Français)"], "langue : English")
assert(TEXTS["Reload"] and TEXTS["Reload"]:IsShown(), "langue changée : rechargement proposé")
ns.UI.SetLang("fr")
assert(ForeverRosterDB.lang == "fr" and ns.Lang() == "fr" and not TEXTS["Reload"]:IsShown(), "langue : Français, déjà celle de l'interface")
ns.UI.SetLang(nil)
local langReloads, realLangReload = 0, ReloadUI
ReloadUI = function() langReloads = langReloads + 1 end
run("language en")
assert(ForeverRosterDB.lang == "en" and langReloads == 1, "/fr language en : interface rechargée")
run("langue jeu")
assert(ForeverRosterDB.lang == nil and ns.Lang() == "fr" and langReloads == 1, "/fr langue jeu : langue du jeu, rien à recharger")
ReloadUI = realLangReload
assert(errors() == before, "langue changée sans erreur")
-- Relevé du raid : présence chaque minute, butin épique, bilan FRB dans l'export puis marqué envoyé
assert(#tickers >= 1, "relevé programmé chaque minute")
ns.UI.LoadFromSite("FRG;1;g5;1789990000;Relevé\nR;4a1e43ea-54e8-4b49-888f-5e19b5754f61;" .. (time() + 600) .. ";Molten Core;;\nEND;1")
IsInRaid = function() return true end
GetNumGroupMembers = function() return #ROSTER end
ROSTER = { "Tournicoti", "Greta-Forever EU", "Bob" }
tickers[1]()
local R = ns.Recorder
assert(R.Current() and R.Current().name == "Molten Core" and R.Current().people.Greta, "relevé démarré sur le raid du site")
fire("ENCOUNTER_END", 663, "Lucifron", 9, 40, 1)
fire("CHAT_MSG_LOOT", "Bob reçoit le butin : |cffa335ee|Hitem:16833::::::::60:::::|h[Cenarion Vestments]|h|r.", "Bob", "", "", "Bob")
fire("CHAT_MSG_LOOT", "Bob reçoit le butin : |cff0070dd|Hitem:9999::::::::60:::::|h[Bleu]|h|r.", "Bob", "", "", "Bob")
assert(#R.Current().loot == 1 and R.Current().loot[1].boss == "Lucifron" and R.Current().loot[1].who == "Bob", "butin épique noté avec le boss, le rare ignoré")
local text, inc = ns.Export.Build({})
assert(text:find("\nFRB;2;4a1e43ea%-54e8%-4b49%-888f%-5e19b5754f61;") or text:find("^FRB;2;4a1e43ea"), "bilan dans l'export")
assert(text:find("\nA;Greta;") and text:find("\nL;16833;Bob;%d+;Lucifron\nEND;4"), "présence et butin dans le bilan")
assert(ns.Export.Size(inc) >= 1 and ns.Export.Names(inc)[#ns.Export.Names(inc)] == "bilan de Molten Core", "bilan nommé dans la synchro")
ns.Minimap.Update()
assert(ns.Minimap.recording, "minicarte : REC")
ns.Export.MarkSent(inc)
assert(#R.Pending() == 0, "bilan envoyé")
local realTime = time
time = function() return realTime() + 60 end
tickers[1]()
assert(#R.Pending() == 1, "nouveau relevé : à renvoyer")
ForeverRosterDB.lootQuality = 3
fire("CHAT_MSG_LOOT", "Bob reçoit le butin : |cff0070dd|Hitem:9999::::::::60:::::|h[Bleu]|h|r.", "Bob", "", "", "Bob")
assert(#R.Current().loot == 2, "seuil réglable (rare)")
ForeverRosterDB.lootQuality = nil
run("options")
IsInRaid = function() return false end
tickers[1]()
assert(not R.Current() and printed[#printed]:find("relevé du raid terminé"), "fin du raid : relevé arrêté")
time = realTime
-- 5. Compo
run("compo")
assert(ns.Compo.Load("FRR;1;x;0;Raid\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1"))
assert(ns.Compo.Status()[1].state == "ok", "le joueur est dans son propre groupe")
-- Compo d'un raid passé (plus de 12 h) : effacée d'elle-même ; « Effacer la compo » à la main
assert(ns.Compo.Load("FRR;1;y;" .. (time() - 13 * 3600) .. ";Vroum Vroum\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1"))
assert(ns.Compo.Get() == nil and ForeverRosterDB.compo == nil, "compo d'un raid passé effacée")
assert(ns.Compo.Load("FRR;1;z;" .. (time() - 2 * 3600) .. ";Raid en cours\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1"))
assert(ns.Compo.Get().name == "Raid en cours", "compo gardée pendant le raid")
ns.UI.Show("compo")
assert(ns.UI.pages.compo.clear:IsShown(), "bouton Effacer visible avec une compo")
ns.Compo.Clear()
ns.UI.Refresh()
assert(ns.Compo.Get() == nil and not ns.UI.pages.compo.clear:IsShown(), "compo effacée à la main")
assert(ns.Compo.Load("FRR;1;x;0;Raid\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1"))
run("aide")
-- 6. Lot G : réservations au survol, consommables (comptés, appel en raid), versions, fiche du boss, butin, conseil
local sent = {}
C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function(prefix, msg, dist, target) sent[#sent + 1] = { prefix = prefix, msg = msg, dist = dist, target = target } end }
local COUNTS = { [13457] = 6, [13510] = 0, [19865] = 0 }
function GetItemCount(id) return COUNTS[id] or 0 end
local TARGET
local realUnitName = UnitName
UnitName = function(u) if u == "target" then return TARGET end return realUnitName(u) end
function UnitGUID(u) if u == "target" and TARGET == "Ragnaros" then return "Creature-0-4372-409-2817-11502-00004A1B2C" end return nil end
function UnitCanAttack() return true end
function UnitIsDead() return false end
function UnitAffectingCombat() return false end
RANDOM_ROLL_RESULT = "%s obtient un %d (%d-%d)."
local traded
function InitiateTrade(unit) traded = unit end
function ClickTradeButton() end
C_Container.PickupContainerItem = function() end
local RID = "5b1e43ea-54e8-4b49-888f-5e19b5754f62"
assert(ns.UI.LoadFromSite(table.concat({
  "FRG;1;g4;1789990000;Lot G", "R;" .. RID .. ";" .. (time() + 300) .. ";Molten Core;;;softres",
  "S;" .. RID .. ";19865;Gorrak:20,Vesper:0", "O;Tournicoti",
  "C;" .. RID .. ";13457;5;all;Greater Fire Protection Potion", "C;" .. RID .. ";13510;1;tank;Flask of the Titans",
  "F;" .. RID .. ";1;672;11502;Ragnaros", "T;" .. RID .. ";1;Tank principal;Tournicoti;", "T;" .. RID .. ";1;Fils de la flamme;;Groupes 3 et 4",
  "I;" .. RID .. ";Tournicoti;Tank;", "I;" .. RID .. ";Gorrak;DPS;melee", "END;1" }, "\n")), "données du lot G chargées")
local RA = ns.Raid
-- Réservations au survol
tip.lines = {}
tooltipHook(tip, { id = 19865 })
assert(table.concat(tip.lines, "\n"):find("SR %(Molten Core%) : |cff4fd35fGorrak %(%+20%), Vesper"), "réservations dans l'infobulle")
-- Consommables comptés à la synchro (ligne K)
assert(ns.Export.Build():find("\nK;13457:6,13510:0\n"), "consommables dans l'export")
-- En raid : relevé démarré sur ce raid
IsInRaid = function() return true end
IsInGroup = function() return true end
ROSTER = { "Tournicoti", "Gorrak", "Vesper" }
GetNumGroupMembers = function() return #ROSTER end
tickers[1]()
assert(R.Current() and R.Current().raidId == RID, "relevé du raid du lot G")
assert(RA.Current() and RA.Current().loot == "softres" and #RA.Current().consumables == 2, "données du raid en cours")
-- Versions de l'addon
RA.AskVersions(true)
assert(sent[#sent].msg == "VQ" and sent[#sent].dist == "RAID", "question des versions")
fire("CHAT_MSG_ADDON", "FRoster", "VQ", "RAID", "Gorrak")
assert(sent[#sent].msg == "VR;" .. ns.version, "réponse de version")
fire("CHAT_MSG_ADDON", "FRoster", "VR;0.0.9", "RAID", "Gorrak-Forever EU") -- plus ancienne que la mienne (0.1.1 dans cette simulation)
local vr = {}
for _, r in ipairs(RA.VersionRows()) do vr[r.name] = r.state end
assert(vr.Tournicoti == "ok" and vr.Gorrak == "old" and vr.Vesper == "wait", "versions dans le raid")
-- Appel aux consommables : je réponds (moi-même), Gorrak répond, Vesper non
assert(RA.CallConsumables(), "appel lancé")
assert(sent[#sent].msg == "CQ;13457,13510", "appel envoyé au raid")
fire("CHAT_MSG_ADDON", "FRoster", "CQ;13457,13510", "RAID", "Tournicoti")
fire("CHAT_MSG_ADDON", "FRoster", "CR;13457:5,13510:0", "WHISPER", "Gorrak")
local sum = RA.CallSummary()
assert(#sum.ready == 1 and sum.ready[1] == "Gorrak", "Gorrak prêt (le flacon de tank ne le concerne pas)")
assert(#sum.missing == 1 and sum.missing[1].name == "Tournicoti" and sum.missing[1].lacks[1] == "Flask of the Titans 0/1", "ce qui manque au tank")
assert(#sum.silent == 1 and sum.silent[1] == "Vesper", "sans réponse")
RA.AnnounceMissing()
assert(said[#said - 1]:find("Consommables manquants : Tournicoti %(Flask of the Titans 0/1%)") and said[#said]:find("Pas de réponse.*Vesper"), "manques annoncés")
local frb = ns.Export.Build({})
assert(frb:find("\nQ;%d+;Tournicoti\n") and frb:find("\nK;Gorrak;13457:5,13510:0\n") and frb:find("\nK;Vesper;%-\n"), "appel gardé avec le bilan")
-- Fiche du boss : en ciblant Ragnaros (avant le pull), fermée au début du combat ; PNJ appris
TARGET = "Ragnaros"
fire("PLAYER_TARGET_CHANGED")
local sw = RA.sheetWindow()
assert(sw and sw:IsShown() and sw.mine:GetText():find("Tank principal"), "fiche du boss au ciblage")
assert(sw.text:GetText():find("Fils de la flamme : |rGroupes 3 et 4"), "reste de la fiche")
RA.AnnounceSheet(sw.sheet)
assert(said[#said]:find("^RAID:Ragnaros · Tank principal : Tournicoti · Fils de la flamme : Groupes 3 et 4"), "fiche annoncée en /raid")
fire("ENCOUNTER_START", 672, "Ragnaros", 9, 40)
assert(not sw:IsShown() and ForeverRosterDB.bossNpcs[11502] == 672 and ForeverRosterDB.bossNames[672] == "Ragnaros", "fermée au pull, PNJ appris")
TARGET = nil
run("boss")
assert(sw:IsShown(), "/fr boss")
-- Butin : jets SR (réservants seulement, bonus ajouté), objet donné puis remis par échange
run("butin |cffa335ee|Hitem:19865::::::::60:::::|h[Band of Accuria]|h|r")
assert(#RA.items == 1 and RA.items[1].itemId == 19865, "objet ajouté à la fenêtre du butin")
assert(RA.StartRoll(RA.items[1], "sr"), "jets SR lancés")
assert(said[#said]:find("réservé %(SR%) par Gorrak %(%+20%), Vesper · /roll 100"), "jets SR annoncés")
fire("CHAT_MSG_SYSTEM", "Gorrak obtient un 61 (1-100).")
fire("CHAT_MSG_SYSTEM", "Vesper obtient un 85 (1-100).")
fire("CHAT_MSG_SYSTEM", "Bob obtient un 99 (1-100).")
fire("CHAT_MSG_SYSTEM", "Vesper obtient un 12 (1-100).")
local rank, tied = RA.Ranking()
assert(not tied and rank[1].name == "Vesper" and rank[1].total == 85 and rank[2].total == 81 and RA.session.ignored.Bob == 99, "classement SR (premier jet seul, Bob ignoré)")
RA.ShowLoot()
RA.AwardSession()
assert(said[#said]:find("pour Vesper %(85%)") and #RA.Handover() == 1 and RA.Handover()[1].winner == "Vesper", "objet attribué, à remettre (corps fermé)")
fire("CHAT_MSG_LOOT", "Vous recevez le butin : |cffa335ee|Hitem:19865::::::::60:::::|h[Band of Accuria]|h|r.", "Tournicoti", "", "", "Tournicoti")
COUNTS[19865] = 1
assert(RA.Trade(RA.Handover()[1]) and traded == "raid3", "échange avec le gagnant")
fire("TRADE_SHOW")
COUNTS[19865] = 0
fire("TRADE_CLOSED")
assert(#RA.Handover() == 0, "objet remis")
assert(ns.Export.Build({}):find("\nL;19865;Vesper;%d+;[^;\n]*;sr;;85\n"), "butin noté au gagnant, avec la méthode")
-- Égalité en jet libre : relance entre ex æquo
RA.AddItem("|cffa335ee|Hitem:18814::::::::60:::::|h[Choker]|h|r")
RA.StartRoll(RA.items[1], "free")
fire("CHAT_MSG_SYSTEM", "Gorrak obtient un 70 (1-100).")
fire("CHAT_MSG_SYSTEM", "Vesper obtient un 70 (1-100).")
local _, tie = RA.Ranking()
assert(tie and #tie == 2, "égalité détectée")
RA.ShowLoot()
RA.StartRoll(RA.items[1], "free", tie)
fire("CHAT_MSG_SYSTEM", "Tournicoti obtient un 99 (1-100).")
assert(RA.session.ignored.Tournicoti and not RA.session.rolls.Tournicoti, "relance : seuls les ex æquo")
RA.session = nil
-- Conseil du butin : proposé, réponses (la mienne et celle de Gorrak), vote, attribution
RA.StartCouncil(RA.items[1])
local sid = RA.session.sid
assert(sent[#sent].msg == "LO;" .. sid .. ";18814;Choker", "objet proposé au conseil, avec son nom")
fire("CHAT_MSG_ADDON", "FRoster", sent[#sent].msg, "RAID", "Tournicoti")
assert(#RA.asks == 1, "fenêtre de réponse")
RA.Respond(RA.asks[1], "bis", "pour mon set")
fire("CHAT_MSG_ADDON", "FRoster", "LA;" .. sid .. ";upgrade;16866;", "WHISPER", "Gorrak")
assert(RA.councils[sid].cands.Tournicoti.response == "bis" and RA.councils[sid].cands.Gorrak.response == "upgrade", "réponses reçues par le conseil")
-- Réponse chuchotée par un joueur sans addon : mots anglais acceptés aussi
fire("CHAT_MSG_WHISPER", "Transmog!", "Vesper-Forever EU")
assert(RA.councils[sid].cands.Vesper.response == "transmo" and RA.councils[sid].cands.Vesper.note == "chuchoté", "réponse chuchotée en anglais")
RA.Vote(sid, "Gorrak")
assert(RA.Tally(sid).Gorrak == 1, "vote compté")
RA.ShowCouncil(sid)
-- Objets reçus (lot I) : compte du site (ligne N, persos d'un même joueur ensemble) + ce soir, spé principale seulement
local nd = { counts = ns.Format.ParseFRG("FRG;1;g;1;G\nN;saison;depuis le 05/11/2026;Gorrak+Grumalt:2,Tournicoti:0\nEND;0")[1].counts }
assert(nd.counts.short == "saison" and nd.counts.byName.Grumalt.n == 2 and #nd.counts.byName.Gorrak.names == 2, "ligne N lue")
assert(RA.LootCounts({ method = "sr" }) and RA.LootCounts({}) and not RA.LootCounts({ method = "roll", detail = "OS 54" })
  and not RA.LootCounts({ method = "roll", detail = "jet 12" }) and not RA.LootCounts({ method = "council", response = "transmo" }), "règle : spé principale")
local rs, rt = RA.Received("Grumalt", nd)
assert(rs == 2 and rt == 0, "compte du site partagé par les persos du joueur")
local vs, vt = RA.Received("Vesper", nd)
assert(vs == 0 and vt >= 1, "objet de ce soir compté (soft reserve)")
RA.AwardCouncil(sid, "Gorrak")
assert(said[#said]:find("pour Gorrak %(1 voix%)") and RA.Handover()[1].winner == "Gorrak" and RA.Handover()[1].method == "council", "conseil : objet attribué")
-- Onglet En raid et commandes, sans erreur
local beforeG = errors()
run("enraid")
run("conso")
assert(errors() == beforeG and failures == 0, "onglet En raid sans erreur")
IsInRaid = function() return false end
IsInGroup = function() return false end

-- Icônes de rôle : atlas du jeu s'il existe, sinon le rôle en texte
assert(ns.UI.roleIcon("Tank") == "Tank" and ns.UI.roleIcon(nil) == "", "rôle en texte sans atlas")
C_Texture = { GetAtlasInfo = function(a) return a == "UI-LFG-RoleIcon-Tank" and {} or nil end }
GetIconForRole = function(r) if r == "TANK" then return "UI-LFG-RoleIcon-Tank" end error("Unknown role: " .. r) end
assert(ns.UI.roleIcon("Tank") == "|A:UI-LFG-RoleIcon-Tank:14:14|a" and ns.UI.roleIcon("Heal") == "Heal", "icône de rôle du jeu")
C_Texture, GetIconForRole = nil, nil

-- 7. Raid d'essai (/fr test) : 9 joueurs fictifs ; rien n'est envoyé (chat, addons) ni noté pour le site
local sentBefore, saidBefore = #sent, #said
local handBefore, lootBefore = #ForeverRosterDB.handover, #(R.Current() and R.Current().loot or {})
IsInGroup = function() return true end
assert(not RA.StartTest() and not RA.test, "pas de raid d'essai en groupe")
IsInGroup = function() return false end
local simVersion = ns.version
ns.version = "1.1.0" -- Thorn a la 0.9.0 : plus ancienne
run("test")
assert(RA.test and #RA.Members() == 10 and RA.Current().entry.raid.id == "essai", "raid d'essai lancé")
RA.AskVersions(true)
local tv = {}
for _, r in ipairs(RA.VersionRows()) do tv[r.name] = r.state end
assert(tv.Tournicoti == "ok" and tv.Gorrak == "ok" and tv.Thorn == "old" and tv.Mirelle ~= "ok", "versions simulées")
COUNTS[13457], COUNTS[13452] = 6, 0
assert(RA.CallConsumables(), "appel aux consommables (essai)")
local ts = RA.CallSummary()
assert(#ts.ready == 4 and #ts.missing == 4 and #ts.silent == 2, "consommables simulés : 4 prêts, 4 incomplets, 2 sans réponse")
TARGET = "Ragnaros"
RA.dismissed = {}
fire("PLAYER_TARGET_CHANGED")
assert(sw:IsShown() and sw.mine:GetText():find("Fils de la flamme"), "fiche d'essai en ciblant un PNJ")
fire("PLAYER_REGEN_DISABLED")
assert(not sw:IsShown(), "fiche fermée au combat")
TARGET = nil
-- Objet pas encore reçu du serveur : lien construit (nom connu, couleur épique), jamais « [objet N] »
local realGetItemInfo = GetItemInfo
GetItemInfo = function() return nil end
assert(ns.Group.displayLink(17063, "Band of Accuria", 4) == "|cffa335ee|Hitem:17063|h[Band of Accuria]|h|r", "lien d'affichage construit")
GetItemInfo = realGetItemInfo
ns.Test.OpenCorpse("softres")
assert(#RA.items == 4 and RA.Current().loot == "softres", "corps d'essai (soft reserve)")
assert(RA.items[1].itemId == 16866 and RA.items[2].itemId == 18815, "corps d'essai : l'objet porté d'abord, puis ceux de Molten Core")
assert(RA.Current().reserves[16866], "réservations sur l'objet porté")
-- SR avec bonus : mon vrai jet compte, Sylvaë (sans réservation) est ignorée
RA.StartRoll(RA.items[1], "sr")
fire("CHAT_MSG_SYSTEM", "Tournicoti Tournicoton obtient un 90 (1-100).") -- nom de famille de Forever dans le message du jet
local tr = RA.Ranking()
assert(tr[1].name == "Tournicoti" and tr[2].total == 68 and tr[3].total == 61 and RA.session.ignored["Sylvaë"], "jets SR simulés")
RA.AwardSession()
-- Égalité puis relance entre ex æquo
RA.StartRoll(RA.items[1], "sr")
local _, ttie = RA.Ranking()
assert(ttie and #ttie == 2, "égalité simulée")
RA.StartRoll(RA.session.item, "sr", ttie)
local _, ttie2 = RA.Ranking()
assert(not ttie2 and RA.session.reroll, "relance départagée")
local tw = RA.Ranking()[1]
RA.Keep(RA.session.item, tw.name, "sr", nil, RA.RollDetail(RA.session, tw))
assert(#RA.Handover() == 1, "objet à remettre (essai)")
RA.Trade(RA.Handover()[1])
assert(#RA.Handover() == 0, "échange simulé")
-- Personne en MS, puis jets OS (le mauvais dé est ignoré)
RA.StartRoll(RA.items[1], "ms")
assert(#RA.Ranking() == 0, "personne en MS")
RA.StartRoll(RA.items[1], "os")
local to = RA.Ranking()
assert(#to == 2 and to[1].name == "Ilyra", "jets OS simulés")
RA.AwardSession()
RA.StartRoll(RA.items[1], "free")
assert(RA.Ranking()[1].name == "Gorrak" and #RA.Ranking() == 2, "jet libre simulé")
RA.ShowLoot()
RA.AwardSession()
-- Conseil : réponses (dont chuchotées), votes, ma réponse, mon vote, attribution
ns.Test.OpenCorpse("council")
RA.StartCouncil(RA.items[1])
local tsid = RA.session.sid
local tc = RA.councils[tsid]
assert(tc.cands.Mirelle.response == "bis" and tc.cands.Mirelle.note == "chuchoté" and tc.cands.Gorrak.response == "pass", "réponses simulées")
assert(RA.Tally(tsid).Mirelle == 1 and RA.Tally(tsid).Ilyra == 1, "votes simulés")
assert(#RA.asks == 1, "ma fenêtre de réponse")
RA.Respond(RA.asks[1], "upgrade")
RA.Vote(tsid, "Mirelle")
assert(tc.cands.Tournicoti.response == "upgrade" and RA.Tally(tsid).Mirelle == 2, "ma réponse et mon vote")
RA.ShowCouncil(tsid)
RA.AwardCouncil(tsid, "Mirelle")
assert(#RA.test.log.loot == 5, "5 objets attribués pendant l'essai")
local ms, mt = RA.Received("Mirelle", RA.Current())
local is, it = RA.Received("Ilyra", RA.Current())
assert(ms == 1 and mt == 1 and is == 1 and it == 0, "essai : reçus de la saison + ce soir (jet OS non compté)")
-- Objet pas encore renvoyé par le jeu : nom connu (raid d'essai), jamais « objet 16866 »
GetItemInfo = function() return nil end
assert(ns.Group.displayLink(16866):find("%[Objet 16866%]"), "nom de l'objet porté connu avant la réponse du jeu")
GetItemInfo = realGetItemInfo
-- Infobulle au survol d'un lien d'objet dans les fenêtres de l'addon (1.5.2)
do
  local f = CreateFrame("Frame")
  ns.UI.kit.itemTips(f)
  local shown
  rawset(GameTooltip, "SetHyperlink", function(_, l) shown = l end)
  local enter = rawget(f, "scripts").OnHyperlinkEnter
  assert(enter and rawget(f, "scripts").OnHyperlinkLeave, "liens d'objets actifs sur le cadre")
  enter(f, "player:Gorrak", "[Gorrak]")
  assert(shown == nil, "lien de joueur : pas d'infobulle d'objet")
  enter(f, "item:281267", "[Raptorscale Pants]")
  assert(shown == "item:281267", "infobulle de l'objet au survol")
  rawset(GameTooltip, "SetHyperlink", nil)
end
run("objet 16901")
local beforeT = errors()
run("enraid")
run("test")
assert(errors() == beforeT and failures == 0, "onglet En raid et panneau d'essai sans erreur")
assert(#sent == sentBefore and #said == saidBefore, "rien envoyé aux autres joueurs ni au chat du raid")
assert(#ForeverRosterDB.handover == handBefore and #(R.Current() and R.Current().loot or {}) == lootBefore, "rien noté pour le site")
RA.StopTest()
assert(not RA.test and #RA.items == 0 and #RA.asks == 0, "raid d'essai terminé")
ns.version = simVersion
UnitName = realUnitName

-- Habillage du site : fenêtres reconstruites (UI rechargée), chaque onglet, la synchro rapide, le rappel et l'alerte
ForeverRosterDB.skin = "site"
assert(loadfile("addon/ForeverRoster/UI.lua"))("ForeverRoster", ns)
assert(ns.UI.site(), "habillage du site choisi")
local beforeSkin = errors()
for _, tab in ipairs({ "synchro", "raids", "enraid", "compo", "patrons", "options" }) do ns.UI.Show(tab) end
ns.UI.Quick()
ns.UI.LootAlert(16833, "|cffa335ee|Hitem:16833::::::::60:::::|h[Cenarion Vestments]|h|r")
ForeverRosterDB.skin = nil -- changement d'habillage : proposé au rechargement
ns.UI.Show("options")
assert(not ns.UI.site() and errors() == beforeSkin and failures == 0, "habillage du site sans erreur")
local reloaded = false
ReloadUI = function() reloaded = true end
run("habillage")
assert(ForeverRosterDB.skin == "site" and reloaded, "/fr habillage : site, interface rechargée")
run("habillage")
assert(ForeverRosterDB.skin == nil, "/fr habillage : retour à Forever")

-- Client sans fonctions globales d'objets (GetItemInfo, GetItemInfoInstant, GetItemCount), seulement C_Item : le pire cas (Forever n'a plus GetItemInfo)
do
  local gi, gii, gic = GetItemInfo, GetItemInfoInstant, GetItemCount
  local asked = {}
  GetItemInfo, GetItemInfoInstant, GetItemCount = nil, nil, nil
  C_Item = { GetItemInfo = gi, GetItemInfoInstant = gii, GetItemCount = function() return 4 end, RequestLoadItemDataByID = function(id) asked[#asked + 1] = id end }
  assert(ns.Group.displayLink(16833):find("|Hitem:16833:", 1, true) and ns.ItemCount(13457, true) == 4, "C_Item à la place des fonctions globales")
  assert(#ns.Group.ConsumableIds() == 0 or ns.Group.CountConsumables()[ns.Group.ConsumableIds()[1]] == 4, "consommables comptés par C_Item")
  C_Item.GetItemInfo = function() return nil end
  local before = #printed
  ns.Group.Diagnose(16901)
  assert(#printed > before and asked[#asked] == 16901, "/fr objet : objet demandé au serveur")
  GetItemInfo, GetItemInfoInstant, GetItemCount, C_Item = gi, gii, gic, nil
end

-- 8. Roster Companion (lot K1) : outbox à la déconnexion, données et accusés de l'appli à la connexion
do
  local C = ns.Companion
  assert(not C.Active(), "appli jamais vue : copier-coller")
  -- Le raid du lot G a été relevé par le chef de raid (UnitIsGroupLeader vrai dans la simulation)
  local logs = R.Pending()
  assert(#logs > 0, "bilans à envoyer")
  fire("PLAYER_LOGOUT")
  local out = ForeverRosterDB.outbox
  assert(out and out.v == 1 and out.addon == ns.version, "outbox écrite à la déconnexion")
  local frc, frb
  for _, b in ipairs(out.blocks) do
    if b.kind == "frc" and b.key == "Tournicoti-Forever EU" then frc = b end
    if b.kind == "frb" then frb = frb or b end
  end
  assert(frc and frc.text:match("^FRC;2;Tournicoti;") and frc.sig ~= "", "bloc du perso avec son empreinte")
  assert(frb and frb.lead == true and frb.text:match("^FRB;2;[^\n]*;1\n"), "bilan du chef de raid (9e champ à 1)")
  -- L'appli a envoyé ces blocs et déposé les données du site (ForeverRoster_Data)
  local acks = { [frc.key] = frc.sig }
  for _, b in ipairs(out.blocks) do if b.kind == "frb" then acks[b.key] = b.sig end end
  ForeverRosterData = { v = 1, at = time(), app = "0.1.0", frgAt = time() + 5, acks = acks,
    frg = "FRG;1;g1;1790000000;Par l'appli\nR;r1;0;Onyxia;;\nEND;1",
    report = { at = time(), items = { "Tournicoti", "bilan de « Molten Core » |cffff0000piège" } } }
  local before = #printed
  fire("PLAYER_LOGIN")
  for i = before + 1, #printed do assert(not printed[i]:find("groupe%(s%) chargé"), "chargement silencieux") end
  local names = {}
  for _, e in ipairs(ns.Export.Pending()) do names[#names + 1] = e.key end
  assert(not table.concat(names, ","):find("Tournicoti", 1, true), "perso marqué envoyé par l'accusé")
  assert(#R.Pending() == 0, "bilans marqués envoyés")
  local groups = ns.Group.List()
  assert(#groups == 1 and groups[1].name == "Par l'appli", "données du site : tous les groupes remplacés")
  assert(ForeverRosterDB.lastLoad.companion, "chargement noté comme venant de l'appli")
  assert(C.Active(), "appli active")
  local status = C.StatusText()
  assert(status:find("Roster Companion s'en occupe", 1, true) and status:find("Tournicoti", 1, true) and not status:find("|cffff0000", 1, true), "ligne de l'onglet Synchro, codes du jeu retirés")
  run("synchro")
  -- Un collage manuel plus récent n'est pas écrasé par des données plus anciennes de l'appli
  ns.UI.LoadFromSite("FRG;1;g2;1790000000;Collé à la main\nR;r2;0;Naxxramas;;\nEND;1")
  ForeverRosterDB.lastLoad.at = time() + 60
  ForeverRosterData.frgAt = time() + 30
  fire("PLAYER_LOGIN")
  local found = false
  for _, g in ipairs(ns.Group.List()) do if g.name == "Collé à la main" then found = true end end
  assert(found, "collage manuel plus récent gardé")
  ForeverRosterData = nil
end

-- 8 bis. Inscriptions faites en jeu (1.5.4) : chaque clic part au site, l'inscription est oubliée une fois enregistrée
-- (sans faire repartir le perso), un changement fait ensuite sur le site n'est plus écrasé
do
  local G, E, C = ns.Group, ns.Export, ns.Companion
  local key, c = ns.charKey(), ns.charDB()
  local realTime, clock = time, time() + 600
  time = function() return clock end
  local raidAt = clock + 86400
  local function frg(at, status)
    return "FRG;1;gi;" .. at .. ";Inscriptions\nR;ri;" .. raidAt .. ";Molten Core;" .. (status or "") .. ";" .. (status and "Tournicoti" or "") .. "\nEND;1"
  end
  local function data(acks, at, status)
    ForeverRosterData = { v = 1, at = clock, app = "0.2.2", frgAt = at, acks = acks, frg = frg(at, status) }
    C.Apply()
  end
  local function outboxBlock()
    fire("PLAYER_LOGOUT")
    for _, b in ipairs(ForeverRosterDB.outbox.blocks) do if b.key == key then return b end end
  end
  local function entry() for _, e in ipairs(G.Raids()) do if e.raid.id == "ri" then return e end end end
  ForeverRosterDB.companion.seen = clock
  data({}, clock, "absent")
  E.MarkSent(select(2, E.Build({ all = true })))
  assert(E.IsSent(c) and C.Active(), "départ : tout est envoyé, appli active")
  -- Clic « Présent » : pas encore envoyé, bouton « Envoyer maintenant » (rechargement de l'interface)
  clock = clock + 10
  G.SignUp("gi", "ri", "present", raidAt)
  assert(not E.IsSent(c) and entry().status == "present" and entry().state == "todo", "clic : à envoyer")
  run("raids")
  local send = TEXTS["Envoyer maintenant"]
  assert(send and send:IsShown(), "bouton « Envoyer maintenant » sur la ligne du raid")
  local reloads, realReload = 0, ReloadUI
  ReloadUI = function() reloads = reloads + 1 end
  rawget(send, "scripts").OnClick(send)
  ReloadUI = realReload
  assert(reloads == 1, "« Envoyer maintenant » recharge l'interface")
  -- /reload : bloc du perso avec l'inscription, envoi en cours ; accusé et données du site → oubliée sans renvoi
  local b1 = outboxBlock()
  assert(b1 and b1.text:find("\nS;gi;ri;present\n") and entry().state == "outbox", "écrite pour l'appli : envoi en cours")
  clock = clock + 10
  data({ [key] = b1.sig }, clock + 1, "present")
  assert(c.signups.ri == nil and E.IsSent(c), "enregistrée par le site : oubliée, le perso ne repart pas")
  -- Changement sur le site (Absent) : rien ne repart, le site garde le dernier mot
  clock = clock + 60
  data({ [key] = b1.sig }, clock, "absent")
  assert(E.IsSent(c) and entry().status == nil and entry().onSite == "absent", "changement du site gardé")
  -- Cliquer le statut du site alors que le choix n'est pas parti : annulé, rien à envoyer
  clock = clock + 10
  G.SignUp("gi", "ri", "late", raidAt)
  G.SignUp("gi", "ri", "absent", raidAt)
  assert(c.signups.ri == nil and E.IsSent(c) and printed[#printed]:find("déjà ton statut", 1, true), "statut du site : rien à envoyer")
  -- Remettre « Présent » en jeu (même statut qu'au premier envoi) : repart bien (bug du 07/10)
  clock = clock + 10
  G.SignUp("gi", "ri", "present", raidAt)
  local b2 = outboxBlock()
  assert(b2 and b2.sig ~= b1.sig and b2.text:find("\nS;gi;ri;present\n"), "même statut remis en jeu : repart")
  -- « Présent » en route : revenir au statut du site n'est pas annulé, il doit repartir
  clock = clock + 10
  G.SignUp("gi", "ri", "absent", raidAt)
  assert(c.signups.ri and c.signups.ri.status == "absent" and c.signups.ri.inflight, "choix précédent en route : le statut du site repart")
  -- Reçue, puis changée sur le site avant que l'addon voie la confirmation : données plus récentes que l'accusé → oubliée
  clock = clock + 10
  G.SignUp("gi", "ri", "late", raidAt)
  local b3 = outboxBlock()
  clock = clock + 10
  data({ [key] = b3.sig }, clock - 15, "absent")
  assert(entry().state == "sent", "accusé reçu, données plus anciennes : reçue par le site")
  clock = clock + 60
  data({ [key] = b3.sig }, clock, "tentative")
  assert(c.signups.ri == nil and E.IsSent(c) and entry().onSite == "tentative", "changée sur le site ensuite : le site a le dernier mot")
  -- Sans l'appli : Ctrl+C de l'export = reçue
  ForeverRosterDB.companion.seen = nil
  G.SignUp("gi", "ri", "present", raidAt)
  assert(entry().state == "todo", "copier-coller : à envoyer")
  run("raids")
  E.MarkSent(select(2, E.Build({})))
  assert(entry().state == "sent", "copier-coller : Ctrl+C = reçue")
  -- Inscription d'avant 1.5.4 (sans heure de clic), déjà envoyée, site changé depuis : oubliée au chargement
  c.signups.ri = { group = "gi", status = "late", time = raidAt }
  E.MarkSent(select(2, E.Build({ all = true })))
  c.signups.ri.sent, c.signups.ri.sentAt, c.sentAt = nil, nil, clock
  clock = clock + 60
  assert(G.Load(frg(clock, "absent"), true, true))
  assert(c.signups.ri == nil and E.IsSent(c), "inscription d'avant 1.5.4 : oubliée sans renvoi")
  -- Raid passé depuis plus de 24 h : oubliée
  G.SignUp("gi", "ri", "present", raidAt)
  clock = raidAt + 86400 + 1
  G.Reconcile()
  assert(c.signups.ri == nil, "raid passé : oubliée")
  time = realTime
  ForeverRosterData = nil
end

-- 8 ter. Partage des données du site entre joueurs (addon/shared/Share.lua, branché en bas de Group.lua ; file de fond
-- de Raid.lua) : annonces, demandes, morceaux, vraie signature du site (sample.frg, clé de test des fixtures), refus,
-- mes champs personnels et mes inscriptions faites en jeu gardés, raid, relais, option coupée, combat, pas de tempête,
-- Roster Companion. Les autres joueurs sont d'autres exemplaires de Share.lua (même horloge, mêmes minuteurs) reliés
-- par un canal simulé ; Tournicoti (moi) est l'addon complet. Tout est remis en place à la fin (section 9 ensuite).
local function sharing()
  local G, RA, Sh, E = ns.Group, ns.Raid, ns.Share, ns.Export
  local ME = "Tournicoti"
  local c = ns.charDB()
  local keep = { time = time, GetTime = GetTime, C_Timer = C_Timer, C_ChatInfo = C_ChatInfo, IsInGuild = IsInGuild, IsInRaid = IsInRaid,
    IsInGroup = IsInGroup, GetNumGroupMembers = GetNumGroupMembers, InCombatLockdown = InCombatLockdown, random = Sh.random,
    verify = ns.Crypto.VerifyRSA, groups = ForeverRosterDB.groups, lastLoad = ForeverRosterDB.lastLoad, companion = ForeverRosterDB.companion,
    noRecord = ForeverRosterDB.noRecord, signups = c.signups, raidLogs = ForeverRosterDB.raidLogs, handover = ForeverRosterDB.handover }
  -- Tables propres pendant la section (l'horloge y est 46 jours plus loin : les bilans relevés plus haut seraient effacés)
  ForeverRosterDB.groups, ForeverRosterDB.noRecord, c.signups, ForeverRosterDB.raidLogs, ForeverRosterDB.handover = {}, true, {}, {}, {}
  local errorsBefore = errors()
  -- Horloge et minuteurs : le temps avance à la demande
  local clock = 1794000000 + 2 * 3600 -- sample.frg : généré à 1794000000
  local timers = {}
  local function schedule(delay, fn) timers[#timers + 1] = { at = clock + math.max(0, delay or 0), fn = fn } end
  local function advance(sec)
    local target = clock + sec
    while true do
      local best, bi
      for i, t in ipairs(timers) do if t.at <= target and (not best or t.at < best.at) then best, bi = t, i end end
      if not best then break end
      table.remove(timers, bi)
      clock = math.max(clock, best.at)
      best.fn()
    end
    clock = target
  end
  time = function() return math.floor(clock) end
  GetTime = function() return clock end
  C_Timer = { After = function(delay, fn) schedule(delay, fn) end, NewTicker = function() return {} end }
  Sh.random = function() return 0.5 end
  local function esc(s) return (tostring(s):gsub("%p", "%%%0")) end
  local function lastPrinted(text) for i = #printed, 1, -1 do if printed[i]:find(text, 1, true) then return printed[i] end end return nil end
  local function received() local n = 0 for _, l in ipairs(printed) do if l:find("reçues de", 1, true) then n = n + 1 end end return n end

  -- Canal simulé : guilde, raid, chuchotements (50 ms de trajet) ; mes messages de guilde et de raid me reviennent (écho,
  -- comme dans le jeu). Le jeu limite les messages d'addon : 10 d'affilée par préfixe, puis 1 par seconde.
  local S = { guild = true, raid = false, members = 0, combat = false }
  IsInGuild = function() return S.guild end
  IsInRaid = function() return S.raid end
  IsInGroup = function() return S.raid end
  GetNumGroupMembers = function() return S.raid and S.members or 0 end
  InCombatLockdown = function() return S.combat end
  local clients, mine, throttled = {}, {}, 0
  local allowance, allowanceAt = 10, clock
  local function deliver(from, msg, dist, target)
    for _, cl in ipairs(clients) do
      if cl.name ~= from and ((dist == "GUILD" and cl.guild) or (dist == "RAID" and cl.raid) or (dist == "WHISPER" and cl.name == target)) then
        schedule(0.05, function() cl.Sh.OnMessage(from, msg, dist) end)
      end
    end
    if (dist == "GUILD" and S.guild) or (dist == "RAID" and S.raid) or (dist == "WHISPER" and target == ME and from ~= ME) then
      schedule(0.05, function() fire("CHAT_MSG_ADDON", "FRoster", msg, dist, from .. "-Forever EU") end)
    end
  end
  C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end,
    SendAddonMessage = function(prefix, msg, dist, target)
      assert(prefix == "FRoster" and #msg <= 255, "message d'addon de plus de 255 octets : " .. #msg)
      allowance = math.min(10, allowance + (clock - allowanceAt)) allowanceAt = clock
      if allowance < 1 then throttled = throttled + 1 return 3 end
      allowance = allowance - 1
      mine[#mine + 1] = { msg = msg, dist = dist, target = target, t = clock }
      deliver(ME, msg, dist, target)
      return 0
    end }
  local function client(name, opts)
    opts = opts or {}
    local cl = { name = name, guild = opts.guild ~= false, raid = opts.raid, groups = {}, applied = {}, notes = {}, sent = {}, chars = opts.chars or { name } }
    local cns = { L = ns.L, N = ns.N, Crypto = ns.Crypto, SITE_KEYS = ns.SITE_KEYS }
    assert(loadfile("addon/shared/Share.lua"))("ForeverRoster", cns)
    cl.Sh = cns.Share
    cl.Sh.random = function() return opts.rand or 0.5 end
    cl.Sh.Setup({
      kind = "FRG",
      send = function(msg, dist, target)
        assert(#msg <= 255, "message de plus de 255 octets : " .. #msg)
        cl.sent[#cl.sent + 1] = { msg = msg, dist = dist, target = target }
        deliver(name, msg, dist, target)
      end,
      blocks = function()
        local out = {}
        for id, g in pairs(cl.groups) do out[id] = { at = g.at, text = g.text } end
        return out
      end,
      apply = function(text, sender, dist)
        local i = cl.Sh.Parse(text, "FRG")
        cl.groups[i.group] = { at = i.at, text = text }
        cl.applied[#cl.applied + 1] = { group = i.group, at = i.at, from = sender, dist = dist }
        return true
      end,
      mine = function(list)
        for _, n in ipairs(list) do for _, m in ipairs(cl.chars) do if n == m then return true end end end
        return false
      end,
      notify = function(text) cl.notes[#cl.notes + 1] = text end,
    })
    clients[#clients + 1] = cl
    return cl
  end
  local function hold(cl, text) local i = cl.Sh.Parse(text, "FRG") cl.groups[i.group] = { at = i.at, text = text } end
  local function count(list, pattern, from)
    local n = 0
    for i = from or 1, #list do if list[i].msg:find(pattern) then n = n + 1 end end
    return n
  end
  local function lastAt(cl, group) return cl.groups[group] and cl.groups[group].at end
  local function myGroup(id) return ForeverRosterDB.groups[id] end
  local function raidOf(g, id) for _, r in ipairs(g and g.raids or {}) do if r.id == id then return r end end end

  -- Clés : la vraie clé de test du site (sample.frg, vérifiée par Crypto.lua) et une clé simulée « test0001 » (somme de
  -- contrôle du texte canonique) pour les versions écrites ici
  assert(loadfile("addon/tests/fixtures/SiteKeyTest.lua"))("ForeverRoster", ns)
  local realVerify, realChecks = ns.Crypto.VerifyRSA, 0
  local function checksum(s)
    local a, b = 1, 0
    for i = 1, #s do a = (a + s:byte(i)) % 65521 b = (b + a) % 65521 end
    return "T" .. (b * 65536 + a) .. "=="
  end
  ns.SITE_KEYS.test0001 = { n = "00", e = 65537 }
  ns.Crypto.VerifyRSA = function(keyId, message, sig)
    if keyId == "test0001" then return sig == checksum(message) end
    local ok, why = realVerify(keyId, message, sig)
    if ok == true then realChecks = realChecks + 1 end
    return ok, why
  end
  -- Bloc FRG comme le site l'écrit : en-tête, lignes (R avec les champs personnels de celui qui l'a copié), M, Z, END
  local function canon(lines)
    local out = {}
    for _, l in ipairs(lines) do
      if l:sub(1, 2) == "R;" then
        local f = {}
        for x in (l .. ";"):gmatch("([^;]*);") do f[#f + 1] = x end
        f[5], f[6] = "", ""
        l = table.concat(f, ";")
      end
      out[#out + 1] = l
    end
    return table.concat(out, "\n")
  end
  local function block(group, at, name, body, members, opts)
    opts = opts or {}
    local lines, n = { "FRG;1;" .. group .. ";" .. at .. ";" .. name }, 0
    for _, l in ipairs(body) do
      lines[#lines + 1] = l
      if l:match("^[RPB];") then n = n + 1 end
    end
    lines[#lines + 1] = "M;" .. table.concat(members, ",")
    if not opts.unsigned then lines[#lines + 1] = "Z;" .. (opts.key or "test0001") .. ";" .. (opts.sig or checksum(canon(lines))) end
    lines[#lines + 1] = "END;" .. n
    return table.concat(lines, "\n")
  end
  -- Vrais blocs du site : sample.frg (deux groupes, signés avec la clé de test)
  local f = assert(io.open("addon/tests/sample.frg")) local SAMPLE = f:read("*a") f:close()
  local REAL = {}
  for blk in (SAMPLE .. "\n"):gmatch("(FRG;.-\nEND;%d+)") do REAL[#REAL + 1] = blk end
  assert(#REAL == 2 and Sh.Verify(REAL[1], "FRG") and Sh.Verify(REAL[2], "FRG"), "sample.frg : deux groupes, vraie signature du site")
  local info1, info2 = Sh.Parse(REAL[1], "FRG"), Sh.Parse(REAL[2], "FRG")
  local G1, G2, AT = info1.group, info2.group, info1.at
  local sg = ns.Format.ParseFRG(REAL[1])[1]
  local R1, R2 = sg.raids[1].id, sg.raids[2].id
  assert(sg.raids[1].name == "Molten Core" and sg.raids[1].status == "present" and sg.raids[1].char == "Greta" and sg.raids[2].name == "Onyxia", "raids de sample.frg")
  local RT1 = sg.raids[1].time

  -- 1. Mes données de G1 (collées, sans signature, plus anciennes) : en retard avec Tournicoti à Molten Core (R1), pas
  -- inscrit à Onyxia (R2), un raid R0 que le site a retiré depuis
  local T0 = AT - 10000
  local R0 = "0a1b2c3d-0000-4000-8000-000000000000"
  assert(ns.UI.LoadFromSite(block(G1, T0, "Les Veilleurs", { "R;" .. R0 .. ";" .. (clock + 3 * 86400) .. ";Zul'Gurub;;;journal",
    "R;" .. R1 .. ";" .. RT1 .. ";Molten Core;late;Tournicoti;softres", "R;" .. R2 .. ";0;Onyxia;;;council" }, { "Greta", "Tournicoti" }, { unsigned = true })))
  local g = myGroup(G1)
  assert(g and g.at == T0 and not g.text and g.origin and not g.origin.from and g.mineAt == T0, "mes données collées, sans signature")
  advance(5)
  assert(count(mine, "^SHV") == 0 and Sh.Announce("GUILD") == 0, "rien de signé : aucune annonce")
  -- Inscriptions faites en jeu : Onyxia reçue par le site après mes données (T0) mais avant la version partagée (AT) ;
  -- Molten Core « Présent » pas encore envoyée
  G.SignUp(G1, R2, "tentative", 0)
  G.MarkReceived(c, nil, T0 + 5000)
  G.SignUp(G1, R1, "present", RT1)
  assert(c.signups[R2].sent and c.signups[R2].sentAt == T0 + 5000 and c.signups[R1] and not c.signups[R1].sent, "inscriptions en jeu : une reçue par le site, une en attente")

  -- 2. Greta annonce la vraie version du site (plus récente que la mienne) : moi, Thalwen et Brindille (membres) et Zephyra
  -- (pas membre, sans données : une fois) demandons ; une seule diffusion en plusieurs morceaux, vérifiée par Crypto.lua
  local greta = client("Greta", { rand = 0 })
  local brindille = client("Brindille", { rand = 0.9 })
  local thalwen = client("Thalwen")
  local zeph = client("Zephyra")
  hold(greta, REAL[1]) hold(brindille, REAL[2])
  local m0 = #mine
  assert(greta.Sh.Announce("GUILD") == 1 and greta.sent[1].msg == "SHV;FRG;" .. G1 .. ";" .. AT .. ";" .. #info1.shared, "annonce SHV de Greta")
  advance(0.3)
  assert(count(mine, "^SHQ;" .. esc(G1) .. ";" .. T0 .. ";GUILD$", m0 + 1) == 1 and mine[#mine].dist == "WHISPER" and mine[#mine].target == "Greta", "données plus anciennes : demande chuchotée à Greta")
  assert(count(thalwen.sent, "^SHQ;" .. esc(G1) .. ";0;GUILD$") == 1 and count(zeph.sent, "^SHQ;" .. esc(G1) .. ";0;GUILD$") == 1 and count(brindille.sent, "^SHQ;" .. esc(G1) .. ";0;") == 1, "sans données : demande")
  advance(4)
  local parts = count(greta.sent, "^SHD;" .. esc(G1) .. ";" .. AT .. ";")
  assert(parts >= 4 and parts == #Sh.Chunks(G1, AT, info1.shared) and count(greta.sent, "^SHD;" .. esc(G1) .. ";" .. AT .. ";1;") == 1, "quatre demandes, une seule diffusion (" .. parts .. " morceaux)")
  g = myGroup(G1)
  assert(g.at == AT and g.text and Sh.Status(g.text, "FRG") == "ok" and g.origin.from == "Greta" and g.mineAt == T0, "reçu de Greta : appliqué et gardé signé")
  assert(realChecks >= 1, "vraie signature vérifiée par Crypto.lua (clé de test)")
  local r1 = raidOf(g, R1)
  assert(r1.status == "late" and r1.char == "Tournicoti" and not r1.unknown, "mon inscription sur le site gardée (pas celle de Greta)")
  assert(raidOf(g, R2) and raidOf(g, R2).status == nil and not raidOf(g, R2).unknown and not raidOf(g, R0), "pas inscrit : rien ; raid retiré du site : parti")
  assert(#g.officers == 1 and #g.members == 4 and g.reserves[R1] and g.counts and g.council[R2], "lignes du site (O, S, L, N, M)")
  assert(c.signups[R1] and c.signups[R1].status == "present" and not c.signups[R1].sent, "inscription en jeu en attente : gardée")
  assert(c.signups[R2] and c.signups[R2].sent, "inscription reçue par le site : gardée (mes champs personnels datent de mes données, pas de la version reçue)")
  assert(E.Build():find("\nS;" .. esc(G1) .. ";" .. esc(R1) .. ";present\n"), "inscription en attente : toujours dans l'export")
  local e1
  for _, e in ipairs(G.Raids()) do if e.raid.id == R1 then e1 = e end end
  assert(e1 and e1.status == "present" and e1.state == "todo" and e1.onSite == "late" and not e1.unknown, "onglet Raids : en jeu en attente, site en retard")
  assert(lastPrinted("Données de Les Veilleurs reçues de Greta (site : ") and received() == 1, "message dans le chat, une fois")
  assert(thalwen.applied[1] and thalwen.applied[1].at == AT and brindille.applied[1] and brindille.applied[1].group == G1, "Thalwen et Brindille : appliqué")
  assert(#zeph.applied == 0 and zeph.Sh.State().outsider[G1] and zeph.Sh.last.result == "member", "Zephyra pas membre : jamais appliqué")
  for _, x in ipairs(mine) do assert(not (x.dist == "WHISPER" and x.target == ME), "jamais de demande à moi-même (écho filtré)") end

  -- 3. Groupe que je n'avais pas (G2, vraie signature) : demandé une fois, appliqué ; ses raids : inscription inconnue
  local m1 = #mine
  brindille.Sh.Announce("GUILD")
  advance(5)
  local g2 = myGroup(G2)
  assert(count(mine, "^SHQ;" .. esc(G2) .. ";0;GUILD$", m1 + 1) == 1, "sans données : demande")
  assert(g2 and g2.at == AT and g2.origin.from == "Brindille" and g2.mineAt == 0 and raidOf(g2, R2).unknown and raidOf(g2, R2).status == nil, "reçu de Brindille ; raid inconnu pour moi")
  assert(myGroup(G1).at == AT and received() == 2, "l'autre groupe ne bouge pas")
  run("raids")
  local unknownShown = false
  for text in pairs(TEXTS) do if type(text) == "string" and text:find("inscription inconnue (données reçues d'un autre joueur)", 1, true) then unknownShown = true end end
  assert(unknownShown, "onglet Raids : inscription inconnue")
  run("synchro")
  local origins = ns.UI.pages.synchro.origins:GetText()
  assert(origins:find("Les Retardataires : reçues de Brindille le ", 1, true) and origins:find("Les Veilleurs : reçues de Greta le ", 1, true)
    and not origins:find("non partagées", 1, true), "onglet Synchro : origine de chaque groupe")

  -- 4. Version plus ancienne annoncée (Mirwen) : pas de demande ; une seule réponse (la première fait taire les autres)
  advance(Sh.QUIET + 1)
  local mirwen = client("Mirwen", { rand = 0.2, chars = { "Mirwen", "Thalwen" } })
  hold(mirwen, block(G1, AT - 500, "Les Veilleurs", { "R;" .. R1 .. ";" .. RT1 .. ";Molten Core;;;softres" }, { "Thalwen", "Tournicoti" }))
  local function snapshot() local s = { [0] = #mine } for _, cl in ipairs(clients) do s[cl] = #cl.sent end return s end
  local function since(snap, pattern)
    local n = count(mine, pattern, snap[0] + 1)
    for _, cl in ipairs(clients) do n = n + count(cl.sent, pattern, (snap[cl] or 0) + 1) end
    return n
  end
  local m2, s2 = #mine, snapshot()
  mirwen.Sh.Announce("GUILD")
  advance(10)
  assert(count(mine, "^SHQ", m2 + 1) == 0, "version plus ancienne que la mienne : pas de demande")
  assert(since(s2, "^SHV;FRG;" .. esc(G1) .. ";" .. AT .. ";") == 1 and lastAt(mirwen, G1) == AT, "une seule réponse à l'annonce ancienne, puis mise à jour")

  -- 5. Moi comme source : collage signé (plus récent, gros) → annonce à la guilde ; demandes → une diffusion, par la file
  -- de fond, au rythme permis ; mes champs personnels ne partent pas ; mes inscriptions suivent mes données
  advance(Sh.QUIET + 1)
  local T2 = AT + 3000
  local MEMBERS = { "Brindille", "Greta", "Ilyra", "Thalwen", "Tournicoti" }
  local body = { "R;" .. R1 .. ";" .. RT1 .. ";Molten Core;absent;Tournicoti;softres", "R;" .. R2 .. ";0;Onyxia;tentative;Tournicoti;council", "O;Greta" }
  for i = 1, 40 do body[#body + 1] = "B;" .. (17000 + i) .. ";Greta,Thalwen,Brindille,Tournicoti" end
  local MINE = block(G1, T2, "Les Veilleurs", body, MEMBERS)
  local mineInfo = Sh.Parse(MINE, "FRG")
  local m3 = #mine
  assert(ns.UI.LoadFromSite(MINE))
  g = myGroup(G1)
  assert(g.at == T2 and g.text and not g.origin.from and g.mineAt == T2 and raidOf(g, R1).status == "absent", "collé : gardé signé, mes champs du site")
  assert(c.signups[R2] == nil and c.signups[R1] and c.signups[R1].status == "present", "mes données : inscription enregistrée par le site oubliée, l'autre gardée")
  advance(4)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T2 .. ";", m3 + 1) == 1 and count(mine, "^SHV;FRG;" .. esc(G2) .. ";" .. AT .. ";", m3 + 1) == 1, "annonce à la guilde après le collage (blocs signés)")
  advance(40)
  local chunksT2 = Sh.Chunks(G1, T2, mineInfo.shared)
  assert(#chunksT2 >= 8 and count(mine, "^SHD;" .. esc(G1) .. ";" .. T2 .. ";1;", m3 + 1) == 1 and count(mine, "^SHD;" .. esc(G1) .. ";" .. T2 .. ";", m3 + 1) == #chunksT2, "une diffusion complète (quatre demandes)")
  for i = m3 + 1, #mine do if mine[i].msg:find("^SHD") then assert(mine[i].dist == "GUILD", "diffusion sur la guilde") end end
  assert(lastAt(greta, G1) == T2 and lastAt(thalwen, G1) == T2 and lastAt(brindille, G1) == T2 and lastAt(mirwen, G1) == T2 and not zeph.groups[G1], "reçu par les membres")
  assert(Sh.Canonical(greta.groups[G1].text, "FRG") == mineInfo.canonical and not greta.groups[G1].text:find("absent;Tournicoti", 1, true), "mes champs personnels ne partent pas")
  assert(throttled == 0, "jamais au-delà de la limite du jeu")

  -- 6. Raid : à l'arrivée, annonce au raid ; Ilyra (pas de la guilde) demande et reçoit par le raid. Pendant la diffusion,
  -- les messages du raid (versions : ma question, puis ma réponse à son écho) partent tout de suite : la file en laisse
  -- toujours 6
  local ilyra = client("Ilyra", { guild = false, raid = true })
  advance(Sh.QUIET + 5)
  local m4 = #mine
  S.raid, S.members = true, 2
  fire("GROUP_ROSTER_UPDATE")
  advance(7.6)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T2 .. ";", m4 + 1) == 1, "annonce au raid à l'arrivée")
  for i = m4 + 1, #mine do if mine[i].msg:find("^SHV") then assert(mine[i].dist == "RAID", "annonce sur le canal du raid") end end
  assert(count(mine, "^SHD;" .. esc(G1) .. ";" .. T2 .. ";", m4 + 1) >= 1 and #RA.lowQueue > 0, "diffusion au raid commencée, la suite attend")
  local m4b = #mine
  for _ = 1, 3 do RA.AskVersions(true) end
  advance(0.06)
  assert(throttled == 0 and count(mine, "^VQ$", m4b + 1) == 3 and count(mine, "^VR;", m4b + 1) == 3, "messages du raid partis tout de suite pendant la diffusion")
  advance(30)
  assert(lastAt(ilyra, G1) == T2 and ilyra.applied[1].dist == "RAID" and #RA.lowQueue == 0 and throttled == 0, "joueur hors guilde : reçu par le raid")
  -- Reçu par le raid : appliqué, relayé à la guilde (Greta le demande et le reçoit)
  local T3 = T2 + 1000
  hold(ilyra, block(G1, T3, "Les Veilleurs", body, MEMBERS))
  local m5 = #mine
  ilyra.Sh.Announce("RAID")
  advance(30)
  g = myGroup(G1)
  assert(g.at == T3 and g.origin.from == "Ilyra" and g.mineAt == T2 and raidOf(g, R1).status == "absent" and raidOf(g, R1).char == "Tournicoti", "reçu par le raid, mes champs gardés")
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T3 .. ";", m5 + 1) == 1 and lastAt(greta, G1) == T3, "relayé à la guilde, reçu par Greta")
  for i = m5 + 1, #mine do if mine[i].msg:find("^SHV;FRG;" .. esc(G1)) then assert(mine[i].dist == "GUILD", "relais sur l'autre canal") end end
  -- Le raid s'agrandit : version annoncée il y a moins de 60 s, l'annonce est refaite à la fin du délai
  local m6 = #mine
  S.members = 3
  fire("GROUP_ROSTER_UPDATE")
  advance(10)
  hold(ilyra, block(G1, T3, "Les Veilleurs", body, MEMBERS))
  ilyra.Sh.Announce("RAID")
  advance(10)
  local before6 = count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T3 .. ";", m6 + 1)
  advance(Sh.QUIET + 10)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T3 .. ";", m6 + 1) == before6 + 1, "raid agrandi : annonce refaite à la fin du délai")
  S.raid, S.members = false, 0
  fire("GROUP_ROSTER_UPDATE")
  advance(Sh.QUIET + 5)
  assert(throttled == 0 and #RA.lowQueue == 0, "raid quitté, file vide")

  -- 7. Refusés, jamais appliqués (messages d'Orvane, hors du canal simulé) : vraie signature sur un texte modifié, sans
  -- signature, clé inconnue, pas membre, plus ancien, chuchoté
  local function feed(text, dist, from)
    local i = Sh.Parse(text, "FRG")
    local shared = i.shared or (i.canonical .. "\n" .. i.endLine)
    for _, m in ipairs(Sh.Chunks(i.group, i.at, shared)) do fire("CHAT_MSG_ADDON", "FRoster", m, dist or "GUILD", (from or "Orvane") .. "-Forever EU") end
  end
  local function try(text, label)
    local before = received()
    feed(text)
    assert(received() == before and myGroup(G1).at == T3, label)
    return Sh.last and Sh.last.result
  end
  local T4 = T3 + 100
  assert(try((REAL[1]:gsub(";" .. AT .. ";Les Veilleurs", ";" .. T4 .. ";Les Veilleurs", 1)), "vraie signature, texte modifié : refusé") == "signature", "signature fausse")
  assert(try(block(G1, T4 + 1, "Les Veilleurs", body, MEMBERS, { unsigned = true }), "sans signature : refusé") == "invalid", "sans signature")
  assert(try(block(G1, T4 + 2, "Les Veilleurs", body, MEMBERS, { key = "deadbeef" }), "clé inconnue : refusé") == "key", "clé inconnue")
  assert(try(block(G1, T4 + 3, "Les Veilleurs", body, { "Brindille", "Thalwen" }), "pas membre : refusé") == "member", "pas membre")
  feed(block(G1, T2 + 10, "Les Veilleurs", body, MEMBERS))
  assert(myGroup(G1).at == T3 and next(Sh.State().rx) == nil, "plus ancien que le mien : ignoré")
  feed(block(G1, T4 + 4, "Les Veilleurs", body, MEMBERS), "WHISPER")
  assert(myGroup(G1).at == T3, "données chuchotées : ignorées (guilde et raid seulement)")
  -- Soft reserve cachée : le site ne signe pas ce bloc (réservations propres à chacun) ; collé, il ne se partage pas, et
  -- une version sans signature reçue d'un autre ne le remplace pas
  local HIDDEN = block("g-sr", clock - 100, "Soft reserve cachée", { "R;rsr;" .. (clock + 86400) .. ";Blackwing Lair;present;Tournicoti;softres",
    "S;rsr;19019;Tournicoti:0" }, { "Tournicoti" }, { unsigned = true })
  assert(ns.UI.LoadFromSite(HIDDEN) and myGroup("g-sr") and not myGroup("g-sr").text and myGroup(G1).at == T3, "soft reserve cachée : collée, les autres groupes restent")
  advance(Sh.QUIET + 5)
  assert(Sh.Announce("GUILD") == 2, "seuls les blocs signés s'annoncent")
  local before7 = received()
  feed(block("g-sr", clock, "Soft reserve cachée", { "R;rsr;" .. (clock + 86400) .. ";Blackwing Lair;;;softres", "S;rsr;19019;Greta:0" }, { "Tournicoti" }, { unsigned = true }))
  assert(received() == before7 and myGroup("g-sr").reserves.rsr[19019][1].name == "Tournicoti", "bloc sans signature reçu : ne remplace rien")
  run("synchro")
  origins = ns.UI.pages.synchro.origins:GetText()
  assert(origins:find("Soft reserve cachée : collées le .- · non partagées : pas signées par le site"), "onglet Synchro : soft reserve cachée non partagée")

  -- 8. Option coupée (onglet Options) : ni annonce ni envoi ; la réception continue ; remise depuis l'onglet Options
  local function optionRow()
    for text, fr in pairs(TEXTS) do
      if type(text) == "string" and fr:GetText() == text and text:find("Partager les données du site avec la guilde et le raid : ", 1, true) then return text end
    end
  end
  run("options")
  assert(optionRow() and optionRow():find("activé", 1, true) and TEXTS["Couper"], "onglet Options : partage activé par défaut")
  rawget(TEXTS["Couper"], "scripts").OnClick(TEXTS["Couper"])
  assert(ForeverRosterDB.share == false and optionRow():find("coupé", 1, true), "partage coupé depuis l'onglet Options")
  advance(Sh.QUIET + 5)
  local m7 = #mine
  assert(ns.UI.LoadFromSite(block(G1, T4 + 10, "Les Veilleurs", body, MEMBERS)))
  fire("PLAYER_LOGIN")
  advance(45)
  assert(count(mine, "^SH[VD]", m7 + 1) == 0 and Sh.Announce("GUILD") == 0 and Sh.Announce("RAID") == 0, "coupé : aucune annonce")
  thalwen.groups[G1] = nil
  thalwen.Sh.Reset()
  thalwen.Sh.OnMessage(ME, "SHV;FRG;" .. G1 .. ";" .. (T4 + 10) .. ";100", "GUILD") -- annonce entendue avant la coupure
  advance(10)
  assert(count(thalwen.sent, "^SHQ;" .. esc(G1) .. ";0;GUILD") >= 1 and count(mine, "^SHD", m7 + 1) == 0, "coupé : demande sans réponse")
  local T5 = T4 + 500
  hold(brindille, block(G1, T5, "Les Veilleurs", body, MEMBERS))
  brindille.Sh.Announce("GUILD")
  advance(10)
  assert(myGroup(G1).at == T5 and count(mine, "^SHQ;" .. esc(G1) .. ";" .. (T4 + 10) .. ";GUILD", m7 + 1) == 1, "coupé : réception (demande et application)")
  assert(count(mine, "^SH[VD]", m7 + 1) == 0, "coupé : rien relayé")
  run("options")
  assert(optionRow():find("coupé", 1, true) and TEXTS["Activer"], "onglet Options : partage coupé")
  advance(Sh.QUIET + 5)
  local m8 = #mine
  rawget(TEXTS["Activer"], "scripts").OnClick(TEXTS["Activer"])
  assert(ForeverRosterDB.share == nil, "partage remis (option par défaut)")
  advance(4)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T5 .. ";", m8 + 1) == 1, "remis : annonce tout de suite")
  advance(20)

  -- 9. Combat : la diffusion attend la fin du combat (file de fond), puis part
  advance(Sh.QUIET + 5)
  local m9 = #mine
  S.combat = true
  thalwen.groups[G1] = nil
  thalwen.Sh.Reset()
  thalwen.Sh.OnMessage(ME, "SHV;FRG;" .. G1 .. ";" .. T5 .. ";100", "GUILD")
  advance(10)
  assert(count(mine, "^SHD", m9 + 1) == 0 and #RA.lowQueue > 0, "en combat : diffusion retenue")
  S.combat = false
  fire("PLAYER_REGEN_ENABLED")
  advance(20)
  assert(count(mine, "^SHD;" .. esc(G1) .. ";" .. T5 .. ";", m9 + 1) == #Sh.Chunks(G1, T5, Sh.Parse(myGroup(G1).text, "FRG").shared) and lastAt(thalwen, G1) == T5 and #RA.lowQueue == 0, "fin du combat : diffusion partie")

  -- 10. Pas de tempête : deux sources de la même version, une seule diffusion ; pas deux fois en moins de 60 s
  advance(Sh.QUIET + 5)
  local m10, g10 = #mine, #greta.sent
  fire("CHAT_MSG_ADDON", "FRoster", "SHQ;" .. G1 .. ";0;GUILD", "WHISPER", "Sylvane-Forever EU")
  greta.Sh.OnMessage("Ulric", "SHQ;" .. G1 .. ";0;GUILD", "WHISPER")
  advance(10)
  assert(count(greta.sent, "^SHD;" .. esc(G1) .. ";" .. T5 .. ";1;", g10 + 1) == 1 and count(mine, "^SHD", m10 + 1) == 0, "la seconde source voit la diffusion et annule la sienne")
  fire("CHAT_MSG_ADDON", "FRoster", "SHQ;" .. G1 .. ";0;GUILD", "WHISPER", "Sylvane-Forever EU")
  advance(10)
  assert(count(mine, "^SHD", m10 + 1) == 0, "pas deux diffusions en moins de 60 s")
  assert(Sh.Announce("GUILD") >= 1 and Sh.Announce("GUILD") == 0, "pas deux annonces de suite")

  -- 11. Connexion : annonce à la guilde 20 à 40 s après
  advance(Sh.QUIET + 5)
  local m11 = #mine
  fire("PLAYER_LOGIN")
  advance(19)
  assert(count(mine, "^SHV", m11 + 1) == 0, "pas avant 20 s")
  advance(22)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T5 .. ";", m11 + 1) == 1 and mine[#mine].dist == "GUILD", "annonce 20 à 40 s après la connexion")
  advance(Sh.QUIET + 5)

  -- 12. Roster Companion : ses blocs (signés par le site) plus récents que les miens remplacent mes groupes et se
  -- partagent ; un groupe absent de ses données disparaît ; mes champs personnels viennent de ses données (les plus
  -- récentes à moi), le reste de la version la plus récente de la guilde. D'abord le vrai texte du site (sample.frg,
  -- généré à AT) : plus ancien que tout ce que j'ai (G1 à T5, G2 à AT) → rien de pris, seul le groupe quitté s'en va
  ForeverRosterDB.companion = {}
  ForeverRosterData = { v = 1, at = clock, app = "0.3.0", frgAt = clock + 1, frg = SAMPLE, acks = {} }
  assert(ns.Companion.Apply() == 0, "Roster Companion : rien de plus récent que mes groupes")
  g = myGroup(G1)
  assert(g.at == T5 and g.origin.from == "Brindille" and g.mineAt == T4 + 10 and myGroup(G2).at == AT and myGroup(G2).origin.from == "Brindille" and not myGroup("g-sr"),
    "versions en place gardées (plus récentes ou aussi récentes), groupe quitté retiré")
  assert(ForeverRosterDB.companion.frgAt == clock + 1 and ForeverRosterDB.lastLoad.at == clock + 1 and ForeverRosterDB.lastLoad.groups == 2 and ForeverRosterDB.lastLoad.companion, "chargement noté quand même (onglet Synchro)")
  -- Puis des données plus récentes : prises, mes champs personnels avec
  local T6 = T5 + 1000
  local body12 = { "R;" .. R1 .. ";" .. RT1 .. ";Molten Core;present;Tournicoti;softres", "R;" .. R2 .. ";0;Onyxia;;;council", "O;Greta" }
  local function app2(at, status) return block(G2, at, "Les Retardataires", { "R;" .. R2 .. ";0;Onyxia;" .. status .. ";Tournicoti;journal" }, { "Brindille", "Tournicoti" }) end
  ForeverRosterData = { v = 1, at = clock, app = "0.3.0", frgAt = clock + 2, frg = block(G1, T6, "Les Veilleurs", body12, MEMBERS) .. "\n" .. app2(T6, "late"), acks = {} }
  assert(ns.Companion.Apply() == 2, "Roster Companion : deux groupes pris")
  g = myGroup(G1)
  assert(g and g.at == T6 and g.text and g.origin.companion and Sh.Status(g.text, "FRG") == "ok" and myGroup(G2).at == T6 and myGroup(G2).text, "Roster Companion : groupes plus récents remplacés, blocs signés gardés")
  assert(g.mineAt == T6 and raidOf(g, R1).status == "present" and raidOf(g, R1).char == "Tournicoti" and not raidOf(myGroup(G2), R2).unknown and raidOf(myGroup(G2), R2).status == "late", "mes champs personnels : ceux de l'appli")
  assert(table.concat(G.Origins(), "\n"):find("Les Veilleurs : chargées par Roster Companion le ", 1, true), "origine : Roster Companion")
  local m12 = #mine
  assert(Sh.Announce("GUILD") == 2, "Roster Companion : les deux groupes s'annoncent")
  advance(30)
  assert(count(mine, "^SHD;" .. esc(G1) .. ";" .. T6 .. ";1;", m12 + 1) == 1 and lastAt(greta, G1) == T6 and lastAt(thalwen, G1) == T6 and lastAt(brindille, G2) == T6, "la guilde reçoit la version de l'appli")
  -- Version plus récente de la guilde reprise ensuite : mes champs de Roster Companion gardés
  advance(Sh.QUIET + 5)
  local T7 = T6 + 500
  hold(greta, block(G1, T7, "Les Veilleurs", body12, MEMBERS))
  local m12b = #mine
  greta.Sh.Announce("GUILD")
  advance(10)
  g = myGroup(G1)
  assert(count(mine, "^SHQ;" .. esc(G1) .. ";" .. T6 .. ";GUILD", m12b + 1) == 1, "demandée à l'annonce d'un autre")
  assert(g.at == T7 and g.origin.from == "Greta" and g.mineAt == T6 and raidOf(g, R1).status == "present" and raidOf(g, R1).char == "Tournicoti", "version plus récente de la guilde reprise, mes champs de Roster Companion")

  -- 13. Appli plus ancienne qu'un groupe reçu par partage (1.5.9) : l'appli a relevé le site avant Greta ; son bloc de G1
  -- (plus ancien que T7) ne remplace pas la version reçue, qui garde son texte signé et son origine ; mes champs
  -- personnels, plus récents que mes derniers à moi, en viennent quand même ; G2 (plus récent que le mien) est pris.
  -- L'annonce qui suit ne dit jamais G1 à l'ancienne date, et la guilde garde T7
  advance(Sh.QUIET + 5)
  local T6b, T8 = T6 + 100, T7 + 300
  local body13 = { "R;" .. R1 .. ";" .. RT1 .. ";Molten Core;late;Tournicoti;softres", "R;" .. R2 .. ";0;Onyxia;;;council", "O;Greta" }
  ForeverRosterData = { v = 1, at = clock, app = "0.3.0", frgAt = clock + 1, acks = {}, frg = block(G1, T6b, "Les Veilleurs", body13, MEMBERS) .. "\n" .. app2(T8, "present") }
  assert(ns.Companion.Apply() == 1, "un seul groupe pris à l'appli")
  g = myGroup(G1)
  assert(g.at == T7 and g.origin.from == "Greta" and g.text and Sh.Parse(g.text, "FRG").at == T7, "G1 : la version reçue de Greta, plus récente, reste (texte signé et origine compris)")
  assert(g.mineAt == T6b and raidOf(g, R1).status == "late" and raidOf(g, R1).char == "Tournicoti" and raidOf(g, R2).status == nil and not raidOf(g, R2).unknown, "G1 gardé : mes champs personnels viennent de l'appli (plus récents que mes derniers)")
  local g2b = myGroup(G2)
  assert(g2b.at == T8 and g2b.origin.companion and g2b.mineAt == T8 and raidOf(g2b, R2).status == "present", "G2 : la version de l'appli, plus récente, prise")
  assert(ForeverRosterDB.companion.frgAt == clock + 1 and ForeverRosterDB.lastLoad.at == clock + 1 and ForeverRosterDB.lastLoad.groups == 2 and ForeverRosterDB.lastLoad.companion, "chargement noté comme avant")
  origins = table.concat(G.Origins(), "\n")
  assert(origins:find("Les Veilleurs : reçues de Greta le ", 1, true) and origins:find("Les Retardataires : chargées par Roster Companion le ", 1, true), "onglet Synchro : origine de chaque groupe")
  local m13 = #mine
  G.ShareNew()
  advance(30)
  assert(count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T6b .. ";", m13 + 1) == 0 and count(mine, "^SHV;FRG;" .. esc(G1) .. ";" .. T6 .. ";", m13 + 1) == 0, "jamais d'annonce de G1 à une date ancienne")
  assert(count(mine, "^SHV;FRG;" .. esc(G2) .. ";" .. T8 .. ";", m13 + 1) == 1 and lastAt(greta, G1) == T7 and lastAt(brindille, G2) == T8, "G2 annoncé et reçu par Brindille ; la guilde garde T7")
  -- Relu avec les mêmes données (même frgAt) : rien ne bouge
  assert(ns.Companion.Apply() == nil and myGroup(G1).at == T7 and myGroup(G2).at == T8, "mêmes données de l'appli : rien à faire")
  ForeverRosterData = nil
  ForeverRosterDB.companion = keep.companion

  advance(300)
  assert(#RA.lowQueue == 0 and throttled == 0, "file vide, jamais au-delà de la limite du jeu")
  assert(errors() == errorsBefore, "partage sans erreur : " .. tostring(lastPrinted("erreur")))
  -- Remise en place pour la suite
  time, GetTime, C_Timer, C_ChatInfo = keep.time, keep.GetTime, keep.C_Timer, keep.C_ChatInfo
  IsInGuild, IsInRaid, IsInGroup, GetNumGroupMembers, InCombatLockdown = keep.IsInGuild, keep.IsInRaid, keep.IsInGroup, keep.GetNumGroupMembers, keep.InCombatLockdown
  Sh.random, ns.Crypto.VerifyRSA = keep.random, keep.verify
  ns.SITE_KEYS.test0001, ns.SITE_KEYS.a3de5db8 = nil, nil
  ForeverRosterDB.groups, ForeverRosterDB.lastLoad, ForeverRosterDB.noRecord, ForeverRosterDB.share = keep.groups, keep.lastLoad, keep.noRecord, nil
  ForeverRosterDB.raidLogs, ForeverRosterDB.handover = keep.raidLogs, keep.handover
  c.signups = keep.signups
  return realChecks
end
local shareChecks = sharing()

-- 8 quater. Client à valeurs secrètes (Forever, octobre 2026, comme Retail depuis 12.0) : en instance, le jeu cache
-- l'identité du PNJ ciblé et, pendant un combat de boss, le texte du chat. Une valeur secrète ne se lit qu'avec
-- issecretvalue : la comparer, la découper ou la concaténer est une erreur Lua (« attempt to index a secret string value »).
do
  local secrets = setmetatable({}, { __mode = "k" })
  local function secretValue(label)
    local u = newproxy(true)
    local mt = getmetatable(u)
    local function boom() error("attempt to index a secret string value (" .. label .. ")", 2) end
    mt.__index, mt.__newindex, mt.__concat, mt.__lt, mt.__le, mt.__len, mt.__call = boom, boom, boom, boom, boom, boom, boom
    secrets[u] = true
    return u
  end
  local keep = { type = type, tostring = tostring, UnitGUID = UnitGUID, UnitName = UnitName, GetRaidRosterInfo = GetRaidRosterInfo,
    GetInstanceInfo = GetInstanceInfo, GetNumLootItems = GetNumLootItems, GetLootSlotLink = GetLootSlotLink, IsInRaid = IsInRaid,
    IsInGroup = IsInGroup, GetNumGroupMembers = GetNumGroupMembers, roster = ROSTER, boss = R.boss, bossNames = ForeverRosterDB.bossNames,
    bossNpcs = ForeverRosterDB.bossNpcs }
  local before = errors()
  local function quiet(what) assert(errors() == before, what .. " : " .. tostring(printed[#printed])) end
  -- Comme le jeu : issecretvalue, type() d'une chaîne secrète = "string", tostring() la laisse secrète
  issecretvalue = function(v) return secrets[v] == true end
  type = function(v) if secrets[v] then return "string" end return keep.type(v) end
  tostring = function(v) if secrets[v] then return v end return keep.tostring(v) end
  IsInRaid, IsInGroup = function() return true end, function() return true end
  ROSTER = { "Tournicoti", "Gorrak", secretValue("GetRaidRosterInfo") }
  GetNumGroupMembers = function() return #ROSTER end

  -- Ciblage en instance : GUID et nom du PNJ secrets → pas de fiche, pas d'erreur (l'erreur vue en jeu le 13/10)
  if RA.HideSheet then RA.HideSheet() end
  UnitGUID = function(u) if u == "target" or u:match("^boss") then return secretValue("UnitGUID") end end
  UnitName = function(u) if u == "target" then return secretValue("UnitName") end return keep.UnitName(u) end
  fire("PLAYER_TARGET_CHANGED")
  quiet("ciblage d'un PNJ secret")
  local sw = RA.sheetWindow and RA.sheetWindow()
  assert(not (sw and sw:IsShown()), "pas de fiche au ciblage d'un PNJ secret")
  assert(RA.SheetFor("target") == nil, "fiche introuvable sans GUID ni nom lisibles")
  -- Début et fin de combat : nom ou numéro secrets ignorés, rien de secret gardé dans la sauvegarde
  ForeverRosterDB.bossNames, ForeverRosterDB.bossNpcs = { [672] = "Ragnaros" }, {}
  fire("ENCOUNTER_START", 672, secretValue("ENCOUNTER_START name"), 9, 40)
  fire("ENCOUNTER_START", secretValue("encounterID"), "Ragnaros", 9, 40)
  assert(ForeverRosterDB.bossNames[672] == "Ragnaros" and next(ForeverRosterDB.bossNpcs) == nil, "rien de secret appris")
  R.boss = nil
  fire("ENCOUNTER_END", 672, "Ragnaros", 9, 40, secretValue("success"))
  assert(R.boss == nil, "fin de combat illisible ignorée")
  fire("ENCOUNTER_END", 672, secretValue("ENCOUNTER_END name"), 9, 40, 1)
  assert(R.boss and R.boss.name == "", "boss vaincu noté, nom secret laissé vide")
  quiet("début et fin de combat secrets")

  -- Membres : un nom secret est ignoré (raid, compo, relevé)
  local names = table.concat(RA.Members(), ",")
  assert(names == "Tournicoti,Gorrak", "membre au nom secret ignoré : " .. names)
  local roster = ns.Compo.Roster()
  assert(roster.tournicoti and roster.gorrak, "compo sans le membre secret")
  GetInstanceInfo = function() return secretValue("instance"), secretValue("kind") end
  tickers[1]()
  quiet("relevé avec des valeurs secrètes")

  -- Chat caché pendant un combat de boss : jets et chuchotements illisibles, signalés une fois au maître du butin
  RA.AddItem("|cffa335ee|Hitem:18814::::::::60:::::|h[Choker]|h|r")
  assert(RA.StartRoll(RA.items[1], "free"), "jets lancés")
  local mark = #printed
  fire("CHAT_MSG_SYSTEM", secretValue("CHAT_MSG_SYSTEM"))
  fire("CHAT_MSG_SYSTEM", secretValue("CHAT_MSG_SYSTEM"))
  fire("CHAT_MSG_WHISPER", secretValue("CHAT_MSG_WHISPER"), "Gorrak")
  local notes = 0
  for i = mark + 1, #printed do if printed[i]:find("le jeu cache le chat pendant un combat de boss", 1, true) then notes = notes + 1 end end
  assert(notes == 1, "chat caché signalé une fois (" .. notes .. ")")
  fire("CHAT_MSG_SYSTEM", "Gorrak obtient un 42 (1-100).")
  assert(RA.session.rolls.Gorrak and RA.session.rolls.Gorrak.roll == 42, "jet lisible compté après le combat")
  RA.session = nil
  table.remove(RA.items, 1)
  fire("CHAT_MSG_LOOT", secretValue("CHAT_MSG_LOOT"), "Gorrak", "", "", "Gorrak")
  fire("CHAT_MSG_ADDON", "FRoster", "VQ", "RAID", secretValue("sender"))
  fire("CHAT_MSG_ADDON", "FRoster", secretValue("text"), "RAID", "Gorrak")
  quiet("chat et messages d'addon secrets")

  -- Butin et infobulles : lien secret ignoré
  GetNumLootItems = function() return 1 end
  GetLootSlotLink = function() return secretValue("GetLootSlotLink") end
  assert(#RA.ReadLoot() == 0, "objet au lien secret ignoré")
  tip.lines = {}
  tooltipHook(tip, { id = secretValue("tooltip id") })
  quiet("butin et infobulle secrets")

  -- Remise en place
  issecretvalue, type, tostring = nil, keep.type, keep.tostring
  UnitGUID, UnitName, GetRaidRosterInfo, GetInstanceInfo = keep.UnitGUID, keep.UnitName, keep.GetRaidRosterInfo, keep.GetInstanceInfo
  GetNumLootItems, GetLootSlotLink, IsInRaid, IsInGroup, GetNumGroupMembers = keep.GetNumLootItems, keep.GetLootSlotLink, keep.IsInRaid, keep.IsInGroup, keep.GetNumGroupMembers
  ROSTER, R.boss, ForeverRosterDB.bossNames, ForeverRosterDB.bossNpcs = keep.roster, keep.boss, keep.bossNames, keep.bossNpcs
end

-- 8 quinquies. Relève de la guilde (1.6.0) : liste (20 membres, noms avec nom de famille ou royaume, notes d'officier
-- invisibles puis visibles, un champ secret), journal, banque (deux onglets lus, un non visible, un lien secret), XP et
-- montées de niveau ; rien demandé ni relu en combat ou pendant une rencontre ; /fr guilde dans les deux habillages,
-- « Copier le relevé ». 1.6.2 : GUID et nom complet dans l'en-tête FRC ; envoi du relevé (texte de la synchro, boîte
-- d'envoi de Roster Companion, accusé de l'appli), rien envoyé aux autres joueurs.
-- L'horloge est placée après celle du partage (section 8 ter) ; bilans de raid et inscriptions mis de côté (la connexion
-- à cette date les effacerait), tout est remis en place à la fin. La fiche de guilde reste dans la sauvegarde : la
-- section 9 la fait lire par Roster Companion.
do
  local Gd = ns.Guild
  local c = ns.charDB()
  local secrets = setmetatable({}, { __mode = "k" })
  local function secretValue(label)
    local u = newproxy(true)
    local mt = getmetatable(u)
    local function boom() error("attempt to index a secret string value (" .. label .. ")", 2) end
    mt.__index, mt.__newindex, mt.__concat, mt.__lt, mt.__le, mt.__len, mt.__call = boom, boom, boom, boom, boom, boom, boom
    secrets[u] = true
    return u
  end
  local keep = { time = time, type = type, tostring = tostring, UnitLevel = UnitLevel, InCombatLockdown = InCombatLockdown, skin = ForeverRosterDB.skin,
    raidLogs = ForeverRosterDB.raidLogs, signups = c.signups, UnitGUID = UnitGUID }
  ForeverRosterDB.raidLogs, c.signups = {}, {}
  local before, sentBefore, saidBefore = errors(), #sent, #said
  local function quiet(what) assert(errors() == before and failures == 0, what .. " : " .. tostring(printed[#printed])) end
  -- Comme le jeu : issecretvalue, type() d'une chaîne secrète = "string", tostring() la laisse secrète
  issecretvalue = function(v) return secrets[v] == true end
  type = function(v) if secrets[v] then return "string" end return keep.type(v) end
  tostring = function(v) if secrets[v] then return v end return keep.tostring(v) end
  local clock = 1795000000
  time = function() return clock end

  -- Guilde simulée : « Les Veilleurs », Horde ; le joueur y est « Tournicoti Tournicoton » (nom de famille de Forever)
  local S = { combat = false, officer = false, rosterAsks = 0, eventAsks = 0, tabAsks = {}, logAsks = {}, level = 41, xp = 1234, money = 1234567 }
  InCombatLockdown = function() return S.combat end
  IsInGuild = function() return true end
  GetGuildInfo = function(unit) if unit == "player" then return "Les Veilleurs", "Officier", 1 end end
  local RANKS = { [0] = "Guild Master", "Officier", "Veteran", "Member", "Initiate" }
  local NAMES = { "Tournicoti Tournicoton", "Greta Coulé", "Alaric", "Brunehilde", "Cassian", "Dorn", "Elowen", "Fenric", "Gorrak", "Hestia-ForeverEU",
    "Ilyra", "Jorund", "Kaeldra", "Lysandre", "Mirwen", "Nyx", "Orvane", "Perrin", "Quill", "Rhea" }
  local CLASSES = { "DRUID", "DRUID", "WARRIOR", "PALADIN", "MAGE", "PRIEST", "HUNTER", "ROGUE", "WARLOCK", "SHAMAN" }
  local MEMBERS = {}
  for i, name in ipairs(NAMES) do
    local r = math.min(i - 1, 4)
    -- name, rankName, rankIndex, level, classDisplayName, zone, publicNote, officerNote, isOnline, status, class, …, guid
    MEMBERS[i] = { name, RANKS[r], r, 10 + i * 2, "Classe", "Zone", "note " .. i, "officer " .. i, i <= 5, 0, CLASSES[(i - 1) % #CLASSES + 1],
      0, 0, false, false, 0, string.format("Player-4321-%08X", i) }
  end
  MEMBERS[7][7] = secretValue("note publique") -- Elowen : note publique secrète
  GetNumGuildMembers = function() return #MEMBERS, 0, 5 end
  GetGuildRosterInfo = function(i) local m = MEMBERS[i] if m then return unpack(m, 1, 17) end end
  GetGuildRosterLastOnline = function(i) if i > 5 then return 0, 0, i, 3 end end
  C_GuildInfo = { GuildRoster = function() S.rosterAsks = S.rosterAsks + 1 fire("GUILD_ROSTER_UPDATE", true) end, CanViewOfficerNote = function() return S.officer end }
  local EVENTS = { { "join", "Rhea", nil, nil, 0, 0, 2, 5 }, { "promote", "Tournicoti Tournicoton", "Greta Coulé", 1, 0, 0, 0, 3 },
    { "invite", "Greta Coulé", "Rhea", nil, 0, 0, 2, 6 }, { "quit", "Zed", nil, nil, 0, 1, 0, 0 } }
  QueryGuildEventLog = function() S.eventAsks = S.eventAsks + 1 fire("GUILD_EVENT_LOG_UPDATE") end
  GetNumGuildEvents = function() return #EVENTS end
  GetGuildEventInfo = function(i) local e = EVENTS[i] if e then return unpack(e, 1, 8) end end
  -- Banque : « Consumables » et « Mats » visibles, « Officers » non (rang) ; un lien secret dans « Mats »
  local function link(id) return "|cffffffff|Hitem:" .. id .. "::::::::60:::::|h[Objet " .. id .. "]|h|r" end
  local TABS = { { "Consumables", true }, { "Mats", true }, { "Officers", false } }
  local BANK = { { [1] = { 13457, 5 }, [2] = { 13510, 1 }, [98] = { 19019, 1 } }, { [1] = "secret", [5] = { 7078, 20 } }, { [1] = { 18814, 1 } } }
  local TLOG = { { { "deposit", "Rhea", link(13457), 5, nil, nil, 0, 0, 0, 2 }, { "withdraw", "Greta Coulé", link(13510), 1, nil, nil, 0, 0, 1, 0 } },
    { { "move", "Greta Coulé", link(7078), 20, 1, 2, 0, 0, 0, 4 } } }
  GetNumGuildBankTabs = function() return #TABS end
  GetGuildBankTabInfo = function(tab) local t = TABS[tab] if t then return t[1], 134400, t[2], t[2], 0, 0, false end end
  QueryGuildBankTab = function(tab) S.tabAsks[#S.tabAsks + 1] = tab fire("GUILDBANKBAGSLOTS_CHANGED") end
  GetGuildBankItemLink = function(tab, slot)
    local x = BANK[tab] and BANK[tab][slot]
    if x == "secret" then return secretValue("GetGuildBankItemLink") end
    return x and link(x[1])
  end
  GetGuildBankItemInfo = function(tab, slot) local x = BANK[tab] and BANK[tab][slot] if type(x) == "table" then return 133000, x[2], false, false, 1 end end
  GetGuildBankMoney = function() return S.money end
  QueryGuildBankLog = function(tab) S.logAsks[#S.logAsks + 1] = tab fire("GUILDBANKLOG_UPDATE") end
  GetNumGuildBankTransactions = function(tab) return TLOG[tab] and #TLOG[tab] or 0 end
  GetGuildBankTransaction = function(tab, i) local x = TLOG[tab] and TLOG[tab][i] if x then return unpack(x, 1, 10) end end
  GetNumGuildBankMoneyTransactions = function() return 1 end
  GetGuildBankMoneyTransaction = function(i) if i == 1 then return "deposit", "Tournicoti Tournicoton", 500000, 0, 0, 0, 1 end end
  Enum.PlayerInteractionType = { GuildBanker = 10 }
  UnitLevel = function() return S.level end
  UnitXP = function() return S.xp end
  UnitXPMax = function() return 8000 end
  local KEY = "Les Veilleurs-Forever EU-Horde"
  local function guild() return ForeverRosterDB.guilds and ForeverRosterDB.guilds[KEY] end
  local function member(name) for _, m in ipairs(guild().roster.members) do if m.name == name then return m end end end

  -- Connexion en combat, puis pendant une rencontre : rien n'est demandé ni relu ; à la fin de la rencontre, tout part
  S.combat = true
  fire("PLAYER_LOGIN")
  fire("GUILD_ROSTER_UPDATE", true)
  fire("GUILD_EVENT_LOG_UPDATE")
  fire("PLAYER_XP_UPDATE", "player")
  assert(S.rosterAsks == 0 and S.eventAsks == 0 and not guild() and (c.xp == nil or c.xp.level ~= 41), "en combat : rien demandé ni relu")
  fire("ENCOUNTER_START", 672, "Ragnaros", 9, 40)
  S.combat = false
  fire("PLAYER_REGEN_ENABLED")
  assert(S.rosterAsks == 0 and S.eventAsks == 0 and not guild(), "pendant une rencontre (hors combat) : rien non plus")
  fire("ENCOUNTER_END", 672, "Ragnaros", 9, 40, 1)
  quiet("relève remise à la fin de la rencontre")
  local g = guild()
  assert(S.rosterAsks == 1 and S.eventAsks == 1 and g and c.guild == KEY, "fin de la rencontre : liste et journal demandés une fois")
  local r = g.roster
  assert(g.name == "Les Veilleurs" and g.faction == "Horde" and g.realm == "Forever EU" and r.total == 20 and #r.members == 20 and r.by == "Tournicoti"
    and r.rank == "Officier" and r.rankIndex == 1, "liste de guilde relevée")
  assert(member("Tournicoti Tournicoton").key == "tournicoti" and member("Greta Coulé").key == "greta" and member("Hestia-ForeverEU").key == "hestia",
    "nom brut gardé, clé prénom en minuscules")
  assert(not r.officer and member("Greta Coulé").onote == nil and member("Alaric").onote == nil, "notes d'officier non visibles : pas gardées")
  local elowen = member("Elowen")
  assert(elowen.note == "" and elowen.class == "HUNTER" and elowen.level == 24 and elowen.rank == "Initiate" and elowen.rankIndex == 4
    and elowen.hours == 7 * 24 + 3 and not elowen.online, "champ secret laissé vide, le reste lu")
  assert(member("Greta Coulé").online and member("Greta Coulé").hours == 0 and member("Alaric").guid == "Player-4321-00000003", "en ligne, guid")
  assert(#g.events.list == 4 and g.events.list[1].type == "promote" and g.events.list[1].p2 == "Greta Coulé" and g.events.list[1].hours == 3
    and g.events.list[4].type == "quit", "journal : les plus récents d'abord")
  assert(c.xp and c.xp.level == 41 and c.xp.xp == 1234 and c.xp.max == 8000 and c.xp.at == clock, "XP relue à la fin du combat")

  -- Pas plus d'une demande toutes les 10 min ; ensuite les notes d'officier deviennent visibles (promotion)
  clock = clock + 300
  Gd.Tick()
  fire("GUILD_ROSTER_UPDATE", true)
  assert(S.rosterAsks == 1 and S.eventAsks == 1 and g.roster.at == clock - 300, "moins de 10 min : ni demande ni relecture")
  clock = clock + 301
  S.officer = true
  Gd.Tick()
  r = g.roster
  assert(S.rosterAsks == 2 and S.eventAsks == 2 and r.at == clock and r.officer and member("Greta Coulé").onote == "officer 2", "10 min plus tard : relue, notes d'officier visibles")

  -- Banque : en combat, rien ; ouverte : onglets visibles demandés un par un, puis leurs journaux et celui de l'or
  S.combat = true
  fire("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 10)
  assert(#S.tabAsks == 0 and not g.bank, "banque ouverte en combat : rien relu")
  S.combat = false
  fire("PLAYER_REGEN_ENABLED")
  fire("GUILDBANKFRAME_OPENED") -- même ouverture annoncée deux fois : une seule relève
  local b = g.bank
  assert(table.concat(S.tabAsks, ",") == "1,2" and table.concat(S.logAsks, ",") == "1,2,9", "onglets visibles et journaux demandés une fois, pas l'onglet caché")
  assert(b and b.ntabs == 3 and b.tabs[1].read and b.tabs[2].read and not b.tabs[3].visible and not b.tabs[3].read and b.tabs[3].name == "Officers", "onglets lus, onglet non visible noté")
  assert(#b.items == 4 and b.money == 1234567 and b.by == "Tournicoti", "objets (lien secret ignoré) et or")
  for _, it in ipairs(b.items) do assert(it.tab ~= 3, "rien de l'onglet non visible") end
  assert(#b.log == 3 and #b.moneyLog == 1 and b.moneyLog[1].amount == 500000, "journaux de la banque")
  -- Dépôt, banque toujours ouverte : relu ; fermée : plus rien n'est relu
  BANK[1][3], S.money = { 13458, 2 }, 1300000
  fire("GUILDBANKBAGSLOTS_CHANGED")
  assert(#g.bank.items == 5 and g.bank.money == 1300000 and #S.tabAsks == 2, "dépôt relu sans nouvelle demande")
  fire("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", 10)
  BANK[1][4], S.money = { 13459, 1 }, 1
  fire("GUILDBANKBAGSLOTS_CHANGED")
  fire("GUILDBANK_UPDATE_MONEY")
  assert(#g.bank.items == 5 and g.bank.money == 1300000, "banque fermée : rien relu")
  quiet("banque")

  -- XP : au plus une fois par minute, pas en combat ; montée de niveau : heure exacte, même en combat
  clock, S.xp = clock + 100, 1500
  fire("PLAYER_XP_UPDATE", "player")
  assert(c.xp.xp == 1500 and c.xp.at == clock, "XP relue (plus d'une minute depuis la dernière fois)")
  local t0 = clock
  clock, S.xp = t0 + 10, 2000
  fire("PLAYER_XP_UPDATE", "player")
  assert(c.xp.xp == 1500, "XP : pas deux fois dans la minute")
  clock = t0 + 61
  fire("PLAYER_XP_UPDATE", "player")
  assert(c.xp.xp == 2000, "XP relue après une minute")
  clock, S.combat, S.xp = clock + 61, true, 2500
  fire("PLAYER_XP_UPDATE", "player")
  assert(c.xp.xp == 2000, "XP : pas en combat")
  S.combat = false
  fire("PLAYER_REGEN_ENABLED")
  assert(c.xp.xp == 2500, "XP relue à la fin du combat")
  clock, S.level, S.xp = clock + 100, 42, 100
  fire("PLAYER_LEVEL_UP", 42, 10, 10, 0)
  assert(c.levels[42] == clock and c.xp.level == 42 and c.xp.xp == 100, "niveau 42 : heure exacte, XP relue")
  local up43 = clock + 3600
  clock, S.combat, S.level, S.xp = up43, true, 43, 50
  fire("PLAYER_LEVEL_UP", 43, 10, 10, 0)
  assert(c.levels[43] == up43 and c.xp.level == 42, "niveau 43 en combat : heure notée, XP remise")
  clock, S.combat = clock + 20, false
  fire("PLAYER_REGEN_ENABLED")
  assert(c.xp.level == 43 and c.xp.xp == 50 and c.levels[42] and c.levels[43] == up43, "XP du niveau 43 après le combat")
  quiet("XP et niveaux")

  -- Relevé FRL v1 : en-tête, membres, journal, banque, XP ; forme stable insensible au temps qui passe
  local text = Gd.Text(KEY)
  assert(text:match("^FRL;1;Les Veilleurs;Horde;%d+;Tournicoti;1;Officier;20;Forever EU;" .. ns.version:gsub("%.", "%%.") .. "\n"), "en-tête FRL")
  assert(text:find("\nM;Elowen;HUNTER;24;Initiate;4;0;171;;officer 7;Player%-4321%-00000007\n") and text:find("\nM;Tournicoti Tournicoton;DRUID;12;Guild Master;0;1;0;note 1;officer 1;", 1, true),
    "membres dans le relevé")
  assert(text:find("\nJ;%d+;Tournicoti\nE;promote;Tournicoti Tournicoton;Greta Coulé;1;3\n") and text:find("\nT;3;Officers;0;0\n", 1, true) and not text:find("\nI;3;", 1, true)
    and text:find("\nI;1;98;19019;1\n", 1, true) and text:find("\nO;deposit;Tournicoti Tournicoton;500000;1\n", 1, true), "journal et banque dans le relevé")
  assert(text:find("\nP;Tournicoti;43;50;8000;%d+;\nU;Tournicoti;42;%d+;\nU;Tournicoti;43;" .. up43 .. ";\nEND;"), "XP et niveaux dans le relevé (GUID pas encore connu)")
  local count = 0
  for _ in text:gmatch("\n") do count = count + 1 end
  assert(text:match("\nEND;(%d+)$") == tostring(count - 1) and not text:find("|", 1, true), "END compte les lignes, aucun « | »")
  local stable = Gd.Text(KEY, true)
  clock = clock + 120
  assert(Gd.ReadRoster() and Gd.Text(KEY) ~= text and Gd.Text(KEY, true) == stable, "relue sans changement : même forme stable")

  -- /fr guilde (habillage Forever puis celui du site) et « Copier le relevé »
  run("guilde")
  local w = Gd.Windows()
  assert(w and w:IsShown() and not w.skin, "/fr guilde : fenêtre ouverte (habillage Forever)")
  local function shownText(pattern) for t in pairs(TEXTS) do if keep.type(t) == "string" and t:find(pattern, 1, true) then return t end end end
  assert(shownText("Membres : 20 lus sur 20") and shownText("Notes d'officier : visibles") and shownText("(clé : tournicoti)")
    and shownText("Onglets : 2 lus, 1 non visibles (rang), 0 pas encore lus") and shownText("Niveaux notés : 2 (dernier : 43"), "diagnostic affiché")
  assert(shownText("Pas encore envoyé : il part avec ta prochaine synchro.") and shownText("Rien ne part aux autres joueurs."), "envoi au site : pas encore envoyé")
  local copyButton = TEXTS["Copier le relevé"]
  assert(copyButton and copyButton:IsShown(), "bouton « Copier le relevé »")
  rawget(copyButton, "scripts").OnClick(copyButton)
  local _, cw = Gd.Windows()
  assert(cw and cw:IsShown() and cw.box:GetText() == Gd.Text(KEY), "relevé dans une boîte à copier")
  cw.box:SetText("frappe")
  rawget(cw.box, "scripts").OnTextChanged(cw.box, true)
  assert(cw.box:GetText() == Gd.Text(KEY), "la frappe ne casse pas le relevé")
  -- Ctrl+C dans la boîte : relevé marqué envoyé (comme dans l'onglet Synchro), la fenêtre le dit ; une autre touche : rien
  assert(#Gd.Pending() == 1 and Gd.Pending()[1].key == KEY, "relevé à envoyer")
  rawget(cw.box, "scripts").OnKeyDown(cw.box, "C")
  assert(#Gd.Pending() == 1, "C sans Ctrl : rien")
  keep.IsControlKeyDown, IsControlKeyDown = IsControlKeyDown, function() return true end
  rawget(cw.box, "scripts").OnKeyDown(cw.box, "C")
  assert(#Gd.Pending() == 0 and guild().sentAt == clock and shownText("rien de nouveau depuis."), "Ctrl+C dans la boîte : relevé envoyé")
  ForeverRosterDB.skin = "site"
  run("guild")
  local w2 = Gd.Windows()
  assert(w2 ~= w and w2.skin and w2:IsShown() and not w:IsShown(), "/fr guild : habillage du site")
  copyButton = TEXTS["Copier le relevé"]
  rawget(copyButton, "scripts").OnClick(copyButton)
  local _, cw2 = Gd.Windows()
  assert(cw2 ~= cw and cw2.skin and cw2:IsShown() and cw2.box:GetText() == Gd.Text(KEY), "boîte à copier, habillage du site")
  ForeverRosterDB.skin = keep.skin
  run("aide")
  assert(printed[#printed]:find("/fr guilde", 1, true), "ligne dans l'aide de /fr")
  quiet("/fr guilde")

  -- En-tête FRC (1.6.2) : GUID du perso et nom complet. GUID secret : champs vides, sans erreur. GUID hors de la liste de
  -- guilde : le nom complet que le jeu donne, seulement s'il a le nom de famille. GUID dans la liste : celui de la liste.
  -- Le perso repart une fois quand son GUID est connu (le site rapproche les persos d'un compte par GUID).
  local E = ns.Export
  local function header() return (E.Build(true):match("^([^\n]*)\n")) end
  UnitGUID = function(u) if u == "player" then return secretValue("UnitGUID") end end
  assert(header():match("^FRC;2;Tournicoti;Forever EU;DRUID;Tauren;43;Horde;%d+;[^;]*;;$") and c.snapshot.header.guid == nil, "GUID secret : champs vides")
  E.MarkSent(select(2, E.Build({ all = true })))
  assert(E.IsSent(c) and #Gd.Pending() == 0, "départ : perso et relevé envoyés")
  UnitGUID = function(u) if u == "player" then return "Player-4321-000000FF" end end
  local gameName = "Tournicoti-ForeverEU"
  UnitFullName = function(u) if u == "player" then return "Tournicoti", "ForeverEU" end end
  GetUnitName = function(u) if u == "player" then return gameName end end
  assert(header():match(";Player%-4321%-000000FF;$"), "prénom seul, ou avec le royaume : pas de nom complet")
  assert(not E.IsSent(c), "GUID connu : le perso repart")
  gameName = "Tournicoti Ventfeuille"
  assert(header():match(";Player%-4321%-000000FF;Tournicoti Ventfeuille$"), "nom complet donné par le jeu")
  UnitGUID = function(u) if u == "player" then return "Player-4321-00000001" end end
  assert(header():match(";Player%-4321%-00000001;Tournicoti Tournicoton$"), "nom complet de la liste de guilde pour ce GUID")
  quiet("en-tête FRC")

  -- Envoi du relevé (1.6.2) : la forme stable a changé (GUID dans les lignes P et U) ; il suit le perso dans le texte de
  -- l'onglet Synchro, Ctrl+C le marque envoyé, il ne repart que s'il change
  assert(#Gd.Pending() == 1 and Gd.Text(KEY):find("\nP;Tournicoti;43;50;8000;%d+;Player%-4321%-00000001\nU;Tournicoti;42;%d+;Player%-4321%-00000001\n"),
    "GUID du perso dans les lignes P et U : relevé à renvoyer")
  run("synchro")
  local sp = ns.UI.pages.synchro
  local value = sp.text:GetText()
  assert(value:match("^FRC;2;Tournicoti;[^\n]*;Player%-4321%-00000001;Tournicoti Tournicoton\n") and value:find("\nEND;%d+\nFRL;1;Les Veilleurs;Horde;")
    and value:match("\nEND;%d+$") and sp.status:GetText():find("relevé de la guilde Les Veilleurs", 1, true), "onglet Synchro : le relevé après le perso")
  rawget(sp.text, "scripts").OnKeyDown(sp.text, "C")
  assert(#Gd.Pending() == 0 and E.IsSent(c) and guild().sentSig == ns.Format.Hash(Gd.Text(KEY, true)), "Ctrl+C : perso et relevé envoyés")
  clock = clock + 120
  Gd.ReadRoster()
  assert(not E.Build({}):find("FRL;", 1, true), "relu sans changement : le relevé ne repart pas")
  -- Synchro rapide : un membre a monté de niveau, le relevé repart seul
  MEMBERS[4][4] = MEMBERS[4][4] + 1
  clock = clock + 120
  Gd.ReadRoster()
  if ns.UI.quick and ns.UI.quick:IsShown() then ns.UI.quick:Hide() end
  ForeverRoster_Sync()
  local q = ns.UI.quick
  assert(q:IsShown() and q.box:GetText():match("^FRL;1;Les Veilleurs;") and q.box:GetText():find("\nM;Brunehilde;PALADIN;19;", 1, true)
    and q.status:GetText():find("relevé de la guilde Les Veilleurs", 1, true), "synchro rapide : le relevé changé, seul")
  rawget(q.box, "scripts").OnKeyDown(q.box, "C")
  assert(#Gd.Pending() == 0 and not q:IsShown(), "synchro rapide : Ctrl+C = relevé envoyé")

  -- Boîte d'envoi de Roster Companion : rien tant que le relevé est envoyé ; un bloc « frl » quand il change, gardé tel quel
  -- (même texte) tant que sa forme stable ne change pas, remplacé sinon ; l'accusé de l'appli le marque envoyé
  local function frlBlock()
    local found, n = nil, 0
    for _, blk in ipairs(ForeverRosterDB.outbox.blocks) do if blk.kind == "frl" then found, n = blk, n + 1 end end
    assert(n <= 1, "un bloc par guilde")
    return found
  end
  fire("PLAYER_LOGOUT")
  assert(#sent == sentBefore and #said == saidBefore, "rien envoyé aux autres joueurs ni au chat")
  assert(not frlBlock(), "relevé déjà envoyé : rien dans la boîte d'envoi")
  MEMBERS[3][4] = MEMBERS[3][4] + 1
  clock = clock + 120
  Gd.ReadRoster()
  fire("PLAYER_LOGOUT")
  local b1 = frlBlock()
  assert(b1 and b1.key == "frl:" .. KEY and b1.sig == ns.Format.Hash(Gd.Text(KEY, true)) and b1.text:match("^FRL;1;Les Veilleurs;Horde;" .. clock .. ";")
    and b1.text:find("\nM;Alaric;WARRIOR;17;", 1, true), "boîte d'envoi : un bloc « frl » après une relève")
  clock = clock + 300
  Gd.ReadRoster()
  fire("PLAYER_LOGOUT")
  local b2 = frlBlock()
  assert(b2 and b2.text == b1.text and b2.sig == b1.sig and Gd.Text(KEY) ~= b1.text, "rien de changé : bloc gardé tel quel")
  MEMBERS[3][4] = MEMBERS[3][4] + 1
  clock = clock + 300
  Gd.ReadRoster()
  fire("PLAYER_LOGOUT")
  local b3 = frlBlock()
  assert(b3 and b3.sig ~= b1.sig and b3.text:find("\nM;Alaric;WARRIOR;18;", 1, true) and b3.text:match("^FRL;1;Les Veilleurs;Horde;" .. clock .. ";"), "relevé changé : bloc remplacé")
  local st = ForeverRosterDB.companion
  local companionBefore = { seen = st.seen, app = st.app, report = st.report }
  ForeverRosterData = { v = 1, at = clock, app = "0.3.1", acks = { [b3.key] = b3.sig }, report = { at = clock, items = { "relevé de la guilde « Les Veilleurs »" } } }
  ns.Companion.Apply()
  assert(#Gd.Pending() == 0 and guild().ackSig == b3.sig and guild().sentAt == clock, "accusé de l'appli : relevé marqué envoyé")
  assert(ns.Companion.StatusText():find("relevé de la guilde « Les Veilleurs »", 1, true), "compte rendu de l'appli : relevé nommé")
  fire("PLAYER_LOGOUT")
  assert(not frlBlock(), "accusé reçu : plus rien dans la boîte d'envoi")
  -- Ctrl+C plus récent, puis le même accusé redonné à la connexion suivante : l'empreinte la plus récente reste
  MEMBERS[3][4] = MEMBERS[3][4] + 1
  Gd.ReadRoster()
  E.MarkSent(select(2, E.Build({})))
  local newer = guild().sentSig
  ns.Companion.Apply()
  assert(newer ~= b3.sig and guild().sentSig == newer and #Gd.Pending() == 0, "accusé déjà vu : pas de retour en arrière")
  ForeverRosterData = nil
  st.seen, st.app, st.report = companionBefore.seen, companionBefore.app, companionBefore.report
  quiet("envoi du relevé")

  -- Remise en place (la fiche de guilde et l'XP restent dans la sauvegarde)
  UnitGUID, UnitFullName, GetUnitName, IsControlKeyDown = keep.UnitGUID, nil, nil, keep.IsControlKeyDown
  issecretvalue, type, tostring, time = nil, keep.type, keep.tostring, keep.time
  UnitLevel, InCombatLockdown, IsInGuild, GetGuildInfo, C_GuildInfo = keep.UnitLevel, keep.InCombatLockdown, nil, nil, nil
  GetNumGuildMembers, GetGuildRosterInfo, GetGuildRosterLastOnline, QueryGuildEventLog, GetNumGuildEvents, GetGuildEventInfo = nil, nil, nil, nil, nil, nil
  GetNumGuildBankTabs, GetGuildBankTabInfo, QueryGuildBankTab, GetGuildBankItemLink, GetGuildBankItemInfo, GetGuildBankMoney = nil, nil, nil, nil, nil, nil
  QueryGuildBankLog, GetNumGuildBankTransactions, GetGuildBankTransaction, GetNumGuildBankMoneyTransactions, GetGuildBankMoneyTransaction = nil, nil, nil, nil, nil
  UnitXP, UnitXPMax, Enum.PlayerInteractionType = nil, nil, nil
  ForeverRosterDB.raidLogs, c.signups = keep.raidLogs, keep.signups
end

-- 8 sexies. Sorties donjon (1.6.1) : bloc FRG avec des lignes X (sorties du jour, de demain, « dès que complet », passées),
-- onglet Sorties dans les deux habillages (états vides compris), bandeau chez le créateur (« Inviter les N », caché en
-- combat et pendant une rencontre, mis à jour quand le groupe change, invitations hors combat seulement, « @pseudo » à
-- inviter à la main) et chez un inscrit (« Chuchoter <créateur> » : saisie ouverte, rien d'envoyé), une fois par sortie.
-- Mes persos : Tournicoti (connecté) et Brindille (autre perso du compte). Guilde et groupe simulés ; tout est remis en
-- place à la fin.
local function sorties()
  local O = ns.Outings
  local keep = { time = time, UnitName = UnitName, InCombatLockdown = InCombatLockdown, IsInGroup = IsInGroup, GetNumGroupMembers = GetNumGroupMembers,
    GetNumSubgroupMembers = GetNumSubgroupMembers, groups = ForeverRosterDB.groups, raidLogs = ForeverRosterDB.raidLogs, skin = ForeverRosterDB.skin,
    lastLoad = ForeverRosterDB.lastLoad, tab = ForeverRosterDB.tab }
  ForeverRosterDB.groups, ForeverRosterDB.raidLogs, ForeverRosterDB.outingsSeen = {}, {}, nil
  ForeverRosterDB.chars["Brindille-Forever EU"] = ForeverRosterDB.chars["Brindille-Forever EU"] or { recipes = {} }
  local before, sentBefore, saidBefore = errors(), #sent, #said
  local function quiet(what) assert(errors() == before and failures == 0, what .. " : " .. tostring(printed[#printed])) end
  local function shownText(...)
    local wanted = { ... }
    for t, f in pairs(TEXTS) do
      if type(t) == "string" and rawget(f, "text") == t then
        local all = true
        for _, w in ipairs(wanted) do if not t:find(w, 1, true) then all = false break end end
        if all then return t end
      end
    end
  end
  local function lastPrinted(text) for i = #printed, 1, -1 do if printed[i]:find(text, 1, true) then return printed[i] end end end

  -- Jeudi 16/10, 20:30 (heure locale) ; groupe généré une heure plus tôt
  local base = os.time({ year = 2026, month = 10, day = 16, hour = 20, min = 30 })
  local clock = base
  time = function() return clock end
  -- Guilde : Bramm et Kaelys en ligne, Zorg hors ligne ; Tiblou n'est pas de la guilde (inconnu)
  local S = { combat = false, party = nil, rosterAsks = 0 }
  C_GuildInfo = { GuildRoster = function() S.rosterAsks = S.rosterAsks + 1 end }
  local GUILD = { { "Bramm", "WARRIOR", true }, { "Kaelys-ForeverEU", "PRIEST", true }, { "Zorg Lebrun", "ROGUE", false }, { "Pikou", "MAGE", true } }
  IsInGuild = function() return true end
  GetNumGuildMembers = function() return #GUILD, 3, 3 end
  GetGuildRosterInfo = function(i) local m = GUILD[i] if m then return m[1], "Membre", 3, 30, "Classe", "Zone", "", "", m[3], 0, m[2] end end
  InCombatLockdown = function() return S.combat end
  UnitName = function(unit) if unit == "party1" then return S.party end return "Tournicoti" end
  UnitIsConnected = function() return true end
  IsInGroup = function() return S.party ~= nil end
  GetNumSubgroupMembers = function() return S.party and 1 or 0 end
  GetNumGroupMembers = function() return S.party and 2 or 0 end
  local invited, tells = {}, {}
  C_PartyInfo = { InviteUnit = function(name) invited[#invited + 1] = name end }
  ChatFrame_SendTell = function(name) tells[#tells + 1] = name end

  local ID = { gnome = "0f6c1d2e-0000-4000-8000-000000000001", elite = "0f6c1d2e-0000-4000-8000-000000000002", mara = "s-mara", brd = "s-brd", old = "s-old", later = "s-later" }
  local function frg(eliteDps)
    return table.concat({
      "FRG;1;g-sorties;" .. (base - 3600) .. ";Les Veilleurs",
      "R;r-mc;" .. (base + 7200) .. ";Molten Core;;;journal",
      "X;" .. ID.gnome .. ";" .. (base + 1800) .. ";gnomeregan;Gnomeregan;29;38;Tournicoti;1/1/3;Bramm;Kaelys;Tournicoti,Zorg,@mirka;DPS:@vex;Toutes les quêtes : prenez-les avant d'entrer.",
      "X;" .. ID.elite .. ";0;other;Élite de la Vallée;;;Torvin;1/1/3;Brindille;Torvin;" .. eliteDps .. ";;",
      "X;" .. ID.mara .. ";" .. (base + 3600) .. ";maraudon;Maraudon;46;55;Pikou;1/1/3;Pikou;;Tournicoti,Tiblou;;",
      "X;" .. ID.brd .. ";" .. (base + 86400 - 1800) .. ";brd;Blackrock Depths;52;60;Pikou;1/1/3;Pikou;Kaelys;Aldo,Bea,Cid;Heal:Brindille;",
      "X;" .. ID.old .. ";" .. (base - 3 * 3600) .. ";wc;Wailing Caverns;17;24;Tournicoti;1/1/3;Tournicoti;;;;",
      "X;s-rfc;" .. (base + 12000) .. ";rfc;Ragefire Chasm;13;18;Torvin;1/1/3;Torvin;;;;",
      "X;" .. ID.later .. ";" .. (base + 2 * 86400) .. ";sm;Scarlet Monastery;30;40;Tournicoti;1/1/3;Tournicoti;;;;",
      "M;Tournicoti,Pikou,Torvin",
      "END;1",
    }, "\n")
  end
  assert(ns.UI.LoadFromSite(frg("Aldo,Bea")), "bloc FRG avec des sorties chargé")
  local list = O.List()
  local order = {}
  for _, e in ipairs(list) do order[#order + 1] = e.day .. ":" .. e.o.title end
  assert(table.concat(order, ",") == "0:Élite de la Vallée,0:Gnomeregan,0:Maraudon,0:Ragefire Chasm,1:Blackrock Depths", "sorties du jour et de demain, dans l'ordre : " .. table.concat(order, ","))
  -- Une sortie commencée juste avant minuit reste du jour après minuit, jusqu'à 2 h après son heure
  local function has(now, title) for _, e in ipairs(O.List(now)) do if e.o.title == title then return e.day end end end
  assert(has(base + 12000 + 3600, "Ragefire Chasm") == 0 and has(base + 12000 + 2 * 3600 + 60, "Ragefire Chasm") == nil, "sortie de 23:50 encore là à 00:50, plus à 01:51")
  assert(has(base + 86400, "Blackrock Depths") == 0 and has(base + 2 * 86400 + 3600, "Élite de la Vallée") == nil, "le lendemain : demain devient aujourd'hui ; « dès que complet » finie")
  local mine = ns.Group.MyChars()
  local me = O.Me(list[2].o, mine)
  assert(me.creator and me.role == "DPS" and O.Me(list[1].o, mine).char == "Brindille" and O.Me(list[5].o, mine).wait == 1, "mes persos reconnus par leur prénom")
  assert(O.Check() == false and not (O.Banner() and O.Banner():IsShown()), "20:30 : pas encore de bandeau")

  -- Onglet Sorties (habillage Forever, celui de la fenêtre construite plus haut)
  ns.UI.Show("sorties")
  assert(ForeverRosterDB.tab == "sorties" and ns.UI.pages.sorties:IsShown(), "onglet Sorties ouvert")
  assert(shownText("Aujourd'hui") and shownText("Demain"), "aujourd'hui et demain")
  assert(shownText("Gnomeregan", "29-38", "21:00", "5/5", "complet", "Bramm", "Kaelys", "@mirka", "En attente : @vex (DPS)", "« Toutes les quêtes", "Créée par Tournicoti", "ta sortie"),
    "sortie du créateur : places, inscrits, attente, note")
  assert(shownText("Maraudon", "21:30", "3/5", "libre", "Créée par Pikou", "tu viens en DPS"), "sortie d'un inscrit")
  assert(shownText("Élite de la Vallée", "dès que complet", "4/5", "tu viens en Tank avec Brindille"), "sortie « dès que complet », autre perso du compte")
  assert(shownText("Blackrock Depths", "tu es en attente (n° 1)"), "en attente demain")
  assert(not shownText("Wailing Caverns") and not shownText("Scarlet Monastery"), "sorties passées ou trop loin : pas affichées")
  assert(TEXTS["Inviter les 2"] and TEXTS["Inviter les 2"]:IsShown() and TEXTS["Chuchoter Pikou"] and TEXTS["Chuchoter Pikou"]:IsShown(), "boutons de l'onglet")
  quiet("onglet Sorties")

  -- 20:46 : bandeau du créateur (Gnomeregan, 21:00) : Bramm et Kaelys en ligne, Zorg hors ligne, @mirka à la main
  clock = base + 16 * 60
  assert(O.Check() == true, "15 min avant : bandeau")
  local b = O.Banner()
  assert(b and b:IsShown() and b.kind == "creator" and b.id == ID.gnome and not b.skin, "bandeau du créateur (habillage Forever)")
  assert(b.head:GetText():find("Gnomeregan", 1, true) and b.head:GetText():find("à 21:00", 1, true) and b.head:GetText():find("complet", 1, true), "Gnomeregan à 21:00, complet")
  local info = b.info:GetText()
  assert(info:find("2 en ligne sur 3", 1, true) and info:find("aucun déjà dans ton groupe", 1, true) and info:find("@mirka", 1, true), "en ligne, déjà là, à inviter à la main : " .. info)
  assert(b.go:GetText() == "Inviter les 2" and b.go:IsShown() and b.later:GetText() == "Plus tard", "Inviter les 2 · Plus tard")
  local names = {}
  for _, s in ipairs(b.slots) do if s.text:IsShown() then names[#names + 1] = s.text:GetText() end end
  local dots = 0
  for _, s in ipairs(b.slots) do if s.dot:IsShown() then dots = dots + 1 end end
  assert(#names == 4 and table.concat(names, ","):find("Bramm", 1, true) and table.concat(names, ","):find("Zorg", 1, true) and table.concat(names, ","):find("@mirka", 1, true)
    and dots == 3, "ligne des inscrits : losange pour les persos, pas pour le pseudo Discord")
  assert(lastPrinted("Gnomeregan à 21:00 : 2 en ligne sur 3."), "ligne dans le chat (pour moi seul)")
  -- Liste de guilde redemandée au jeu une fois ; Zorg se connecte : bandeau à jour, à la même place
  assert(S.rosterAsks == 1, "liste de guilde redemandée à l'ouverture du bandeau")
  GUILD[3][3] = true
  fire("GUILD_ROSTER_UPDATE", true)
  assert(b:IsShown() and b.info:GetText():find("3 en ligne sur 3", 1, true) and b.go:GetText() == "Inviter les 3" and S.rosterAsks == 1, "Zorg en ligne : bandeau à jour")
  GUILD[3][3] = false
  fire("GUILD_ROSTER_UPDATE", true)
  assert(b.go:GetText() == "Inviter les 2", "Zorg reparti")
  -- Combat : bandeau caché, aucune invitation ; il revient après
  S.combat = true
  fire("PLAYER_REGEN_DISABLED")
  assert(not b:IsShown() and not (ForeverRosterDB.outingsSeen or {})[ID.gnome], "combat : bandeau caché, pas oublié")
  assert(O.Check() == false and not b:IsShown(), "pas de bandeau en combat")
  assert(O.Invite(ID.gnome) == 0 and #invited == 0 and lastPrinted("impossible en combat."), "pas d'invitation en combat")
  S.combat = false
  fire("PLAYER_REGEN_ENABLED")
  assert(b:IsShown(), "fin du combat : bandeau revenu")
  -- Rencontre de boss (hors combat) : pareil
  fire("ENCOUNTER_START", 1, "Mekgineer Thermaplugg", 1, 5)
  assert(not b:IsShown(), "rencontre : bandeau caché")
  fire("PLAYER_REGEN_ENABLED")
  assert(not b:IsShown() and O.Invite(ID.gnome) == 0 and #invited == 0, "rencontre en cours : ni bandeau ni invitation")
  fire("ENCOUNTER_END", 1, "Mekgineer Thermaplugg", 1, 5, 1)
  assert(b:IsShown(), "fin de la rencontre : bandeau revenu")
  -- Kaelys rejoint mon groupe : bandeau mis à jour
  S.party = "Kaelys"
  fire("GROUP_ROSTER_UPDATE")
  assert(b:IsShown() and b.info:GetText():find("1 déjà dans ton groupe", 1, true) and b.go:GetText() == "Inviter Bramm", "groupe changé : bandeau à jour")
  -- Pas chef du groupe : rien d'envoyé, le bandeau reste (le chat dit pourquoi)
  local leader = UnitIsGroupLeader
  UnitIsGroupLeader = function() return false end
  rawget(b.go, "scripts").OnClick(b.go)
  assert(#invited == 0 and b:IsShown() and lastPrinted("seul le chef du groupe ou un assistant peut inviter."), "pas chef du groupe : bandeau gardé")
  UnitIsGroupLeader = leader
  -- « Inviter Bramm » : une invitation (Kaelys déjà là, Zorg hors ligne, @mirka à la main), bandeau fermé pour de bon
  rawget(b.go, "scripts").OnClick(b.go)
  assert(table.concat(invited, ",") == "Bramm", "invitations : " .. table.concat(invited, ","))
  assert(lastPrinted("1 invitation(s) envoyée(s).") and lastPrinted("à inviter à la main (inscrits Discord) : @mirka"), "invitations dites dans le chat")
  assert(not b:IsShown() and ForeverRosterDB.outingsSeen[ID.gnome], "bandeau fermé, une fois par sortie")
  clock = clock + 60
  assert(O.Check() == false and not b:IsShown(), "pas deux fois")
  quiet("bandeau du créateur")

  -- 21:16 : bandeau d'un inscrit (Maraudon, 21:30, créée par Pikou) : « Chuchoter Pikou » ouvre la saisie, n'envoie rien
  clock = base + 46 * 60
  assert(O.Check() == true and b:IsShown() and b.kind == "member" and b.id == ID.mara, "bandeau d'un inscrit")
  assert(b.head:GetText():find("Maraudon", 1, true) and b.head:GetText():find("3/5 inscrits", 1, true), "Maraudon à 21:30, 3/5 inscrits")
  assert(b.info:GetText():find("Créée par Pikou · tu viens en DPS", 1, true) and b.go:GetText() == "Chuchoter Pikou" and b.later:GetText() == "OK", "Créée par Pikou · Chuchoter Pikou · OK")
  for _, s in ipairs(b.slots) do assert(not s.text:IsShown(), "pas de ligne des inscrits chez un inscrit") end
  rawget(b.go, "scripts").OnClick(b.go)
  assert(table.concat(tells, ",") == "Pikou" and not b:IsShown() and ForeverRosterDB.outingsSeen[ID.mara], "saisie du chuchotement ouverte, bandeau fermé")
  -- Sans fonction du jeu pour ouvrir la saisie : la commande à taper ; jamais pour un « @pseudo »
  ChatFrame_SendTell = nil
  assert(O.Whisper("Pikou") == false and lastPrinted("pour chuchoter à Pikou : /w Pikou"), "chuchotement : commande donnée")
  assert(O.Whisper("@mirka") == false, "pas de chuchotement à un pseudo Discord")
  -- Pikou dans mon groupe : plus rien à lui dire (pas de bandeau ; ouvert, il se ferme pour de bon)
  ForeverRosterDB.outingsSeen[ID.mara] = nil
  S.party = "Pikou"
  assert(O.Check() == false and not b:IsShown(), "créateur déjà dans mon groupe : pas de bandeau")
  S.party = nil
  assert(O.Check() == true and b:IsShown() and b.id == ID.mara, "bandeau revenu (jamais fermé)")
  S.party = "Pikou"
  fire("GROUP_ROSTER_UPDATE")
  assert(not b:IsShown() and ForeverRosterDB.outingsSeen[ID.mara], "invité par Pikou : bandeau fermé pour de bon")
  S.party = nil
  quiet("bandeau d'un inscrit")

  -- « Dès que complet » : l'Élite se complète (nouvelles données du site) → bandeau tout de suite (Brindille, mon autre perso)
  clock = clock + 60
  assert(ns.UI.LoadFromSite(frg("Aldo,Bea,Cid")), "données mises à jour")
  assert(b:IsShown() and b.id == ID.elite and b.head:GetText():find("Élite de la Vallée", 1, true) and b.head:GetText():find("complet", 1, true)
    and b.info:GetText():find("tu viens en Tank avec Brindille", 1, true) and b.go:GetText() == "Chuchoter Torvin", "sortie complète : bandeau")
  rawget(b.later, "scripts").OnClick(b.later)
  assert(not b:IsShown() and ForeverRosterDB.outingsSeen[ID.elite], "« OK » : fermé")
  assert(ns.UI.LoadFromSite(frg("Aldo,Bea,Cid")) and O.Check() == false and not b:IsShown(), "mêmes données rechargées : pas de nouveau bandeau")
  quiet("dès que complet")

  -- Habillage du site : onglet et bandeau (reconstruits), bouton principal plein doré
  ForeverRosterDB.skin = "site"
  assert(loadfile("addon/ForeverRoster/UI.lua"))("ForeverRoster", ns)
  ns.UI.Show("sorties")
  assert(shownText("Gnomeregan", "ta sortie") and shownText("Maraudon", "tu viens en DPS"), "onglet Sorties, habillage du site")
  ForeverRosterDB.outingsSeen[ID.mara] = nil
  clock = base + 50 * 60
  assert(O.Check() == true, "bandeau, habillage du site")
  local b2 = O.Banner()
  assert(b2 ~= b and b2.skin and b2:IsShown() and b2.go.label:GetText() == "Chuchoter Pikou" and b2.go.selected, "bandeau reconstruit, bouton doré")
  rawget(b2.later, "scripts").OnClick(b2.later)
  -- États vides : aucun groupe, puis un groupe sans sortie ; ancien groupe gardé sans le champ outings
  ForeverRosterDB.groups = {}
  ns.UI.Refresh()
  assert(shownText("Aucun groupe chargé"), "onglet vide : aucun groupe")
  ForeverRosterDB.skin = keep.skin
  assert(loadfile("addon/ForeverRoster/UI.lua"))("ForeverRoster", ns)
  assert(ns.UI.LoadFromSite("FRG;1;g-vide;" .. base .. ";Les Veilleurs\nR;r1;" .. (base + 7200) .. ";Molten Core;;\nEND;1"))
  ForeverRosterDB.groups.ancien = { id = "ancien", at = 1, name = "Ancien", raids = {}, patterns = {}, bis = {} }
  ns.UI.Show("sorties")
  assert(#O.List() == 0 and shownText("Aucune sortie aujourd'hui ni demain.", "inscris-toi sur le site ou sur Discord"), "onglet vide : aucune sortie")
  assert(O.Check() == false, "ancien groupe sans sorties : rien")
  quiet("habillages et états vides")

  -- Rien envoyé aux autres joueurs ni au chat (seulement des lignes pour moi)
  assert(#sent == sentBefore and #said == saidBefore, "rien envoyé aux autres joueurs ni au chat")

  -- Remise en place
  time, UnitName, InCombatLockdown, IsInGroup, GetNumGroupMembers, GetNumSubgroupMembers = keep.time, keep.UnitName, keep.InCombatLockdown, keep.IsInGroup,
    keep.GetNumGroupMembers, keep.GetNumSubgroupMembers
  IsInGuild, GetNumGuildMembers, GetGuildRosterInfo, UnitIsConnected, C_PartyInfo, ChatFrame_SendTell, C_GuildInfo = nil, nil, nil, nil, nil, nil, nil
  ForeverRosterDB.groups, ForeverRosterDB.raidLogs, ForeverRosterDB.lastLoad, ForeverRosterDB.tab = keep.groups, keep.raidLogs, keep.lastLoad, keep.tab
  ForeverRosterDB.outingsSeen, ForeverRosterDB.chars["Brindille-Forever EU"] = nil, nil
end
sorties()

-- 9. Aller-retour avec Roster Companion (lancé par le test Rust de l'appli : RC_HELPER = son exécutable).
-- L'addon écrit sa sauvegarde, l'appli (Rust) la lit et écrit ForeverRoster_Data, l'addon relit ce fichier.
local helper = os.getenv("RC_HELPER")
if helper and helper ~= "" then
  local function esc(str) return (str:gsub("\\", "\\\\"):gsub("\"", "\\\""):gsub("\n", "\\n"):gsub("\r", "\\r")) end
  -- Sauvegarde au format du jeu : ["clé"] = valeur, tableaux suivis de « -- [n] »
  local function ser(v, out, depth)
    local t = type(v)
    if t == "string" then out[#out + 1] = "\"" .. esc(v) .. "\""
    elseif t == "number" or t == "boolean" then out[#out + 1] = tostring(v)
    elseif t == "table" then
      out[#out + 1] = "{\n"
      local n = #v
      for i = 1, n do ser(v[i], out, depth + 1) out[#out + 1] = ", -- [" .. i .. "]\n" end
      local keys = {}
      for k in pairs(v) do if not (type(k) == "number" and k >= 1 and k <= n and k % 1 == 0) then keys[#keys + 1] = k end end
      table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
      for _, k in ipairs(keys) do
        out[#out + 1] = "[" .. (type(k) == "string" and ("\"" .. esc(k) .. "\"") or tostring(k)) .. "] = "
        ser(v[k], out, depth + 1)
        out[#out + 1] = ",\n"
      end
      out[#out + 1] = "}"
    else out[#out + 1] = "nil" end
  end
  -- Quelque chose à envoyer : le perso et un bilan du chef de raid repassent « non envoyés »
  ForeverRosterDB.chars["Tournicoti-Forever EU"].sentSig = nil
  local logId
  for id, log in pairs(ForeverRosterDB.raidLogs) do if next(log.people) then log.sentAt = nil log.given = 1 logId = id end end
  assert(logId, "un bilan à envoyer")
  -- Relève de la guilde (section 8 quinquies) dans la sauvegarde, à renvoyer : un bloc « frl » dans la boîte d'envoi (1.6.2)
  local guildKey = "Les Veilleurs-Forever EU-Horde"
  local guild = ForeverRosterDB.guilds and ForeverRosterDB.guilds[guildKey]
  assert(guild and guild.roster and ForeverRosterDB.chars["Tournicoti-Forever EU"].levels, "relève de la guilde dans la sauvegarde")
  guild.sentSig = nil
  fire("PLAYER_LOGOUT")
  local frl
  for _, b in ipairs(ForeverRosterDB.outbox.blocks) do if b.kind == "frl" then frl = b end end
  assert(frl and frl.key == "frl:" .. guildKey and frl.text:match("^FRL;1;Les Veilleurs;"), "relevé de la guilde dans la boîte d'envoi")
  local out = { "\nForeverRosterDB = " }
  ser(ForeverRosterDB, out, 0)
  out[#out + 1] = "\n"
  local sv, dir = os.tmpname(), os.tmpname()
  os.remove(dir)
  assert(os.execute("mkdir -p '" .. dir .. "'") == 0, "dossier des addons")
  local f = assert(io.open(sv, "wb")) f:write(table.concat(out)) f:close()
  -- L'appli lit la sauvegarde et écrit ForeverRoster_Data et ses copies (étape 1), puis de nouvelles données (étape 2)
  local function app(step)
    local cmd = string.format("RC_SV='%s' RC_ADDONS='%s' RC_STEP=%d '%s' --exact helper_ecrit_data_lua --nocapture --quiet > /dev/null", sv, dir, step, helper)
    local ok = os.execute(cmd)
    assert(ok == 0 or ok == true, "l'appli a lu la sauvegarde et écrit ForeverRoster_Data (étape " .. step .. ")")
  end
  app(1)
  -- Le jeu charge Data.lua comme un fichier d'addon
  ForeverRosterData = nil
  dofile(dir .. "/ForeverRoster_Data/Data.lua")
  assert(type(ForeverRosterData) == "table" and ForeverRosterData.v == 1, "Data.lua chargé")
  fire("PLAYER_LOGIN")
  for _, e in ipairs(ns.Export.Pending()) do assert(e.key ~= "Tournicoti-Forever EU", "perso marqué envoyé par l'accusé de l'appli") end
  assert(ForeverRosterDB.raidLogs[logId].sentAt, "bilan marqué envoyé par l'accusé de l'appli")
  assert(guild.ackSig == frl.sig and guild.sentSig == frl.sig, "relevé de la guilde marqué envoyé par l'accusé de l'appli")
  local function groupNames()
    local names = {}
    for _, g in ipairs(ns.Group.List()) do names[#names + 1] = g.name end
    return table.concat(names, ",")
  end
  assert(groupNames():find("Les \"Veilleurs\"", 1, true), "données du site chargées, guillemets compris")
  assert(ns.Companion.StatusText():find("bilan de", 1, true) and ns.Companion.StatusText():find("relevé de la guilde « Les Veilleurs »", 1, true),
    "compte rendu de l'appli affiché")

  -- Actualisation sans /reload : l'appli dépose de nouvelles données, l'addon charge la copie suivante
  ADDONS_DIR = dir
  local function left() return ns.Companion.SlotsLeft() end
  assert(left() == 20, "20 copies chargeables")
  local ok, msg, changed = ns.Companion.Refresh()
  assert(ok and not changed and msg:find("rien de nouveau", 1, true) and msg:find("Encore 19 actualisations possibles", 1, true), msg)
  app(2)
  ok, msg, changed = ns.Companion.Refresh()
  assert(ok and changed and msg:find("actualisées", 1, true) and msg:find("Encore 18", 1, true), msg)
  assert(groupNames():find("Les Retardataires", 1, true), "nouvelles données chargées sans /reload")
  -- En combat : remis à la fin du combat
  InCombatLockdown = function() return true end
  ok, msg = ns.Companion.Refresh()
  assert(not ok and msg:find("fin du combat", 1, true), msg)
  InCombatLockdown = function() return false end
  fire("PLAYER_REGEN_ENABLED")
  assert(left() == 17, "chargée après le combat")
  -- Toute seule aux moments utiles, jamais deux fois en moins de 2 min
  local realTime, clock = time, time()
  time = function() return clock end
  assert(not ns.Companion.AutoRefresh("window") and left() == 17, "pas d'actualisation trop rapprochée")
  clock = clock + 3 * 60
  assert(ns.Companion.AutoRefresh("window") and left() == 16, "fenêtre ouverte : chargée toute seule")
  clock = clock + 3 * 60
  fire("READY_CHECK")
  assert(left() == 15, "appel : chargée toute seule")
  clock = clock + 3 * 60
  IsInRaid = function() return true end
  fire("GROUP_ROSTER_UPDATE")
  assert(left() == 14, "entrée dans un groupe de raid : chargée toute seule")
  clock = clock + 3 * 60
  fire("GROUP_ROSTER_UPDATE")
  assert(left() == 14, "déjà en raid : rien")
  IsInRaid = function() return false end
  fire("GROUP_ROSTER_UPDATE")
  local realInstance = IsInInstance
  IsInInstance = function() return true, "raid" end
  fire("PLAYER_ENTERING_WORLD")
  assert(left() == 13, "entrée dans une instance de raid : chargée toute seule")
  IsInInstance = realInstance
  -- 30 et 5 min avant un raid (vérifié toutes les 30 s), une fois chacun
  clock = clock + 3 * 60
  assert(ns.Group.Load("FRG;1;g9;" .. clock .. ";Soirée\nR;r9;" .. (clock + 29 * 60) .. ";Onyxia;;;journal\nEND;1", true, true))
  ns.Companion.Tick()
  assert(left() == 12, "30 min avant le raid : chargée toute seule")
  ns.Companion.Tick()
  assert(left() == 12, "une seule fois par moment")
  clock = clock + 25 * 60
  ns.Companion.Tick()
  assert(left() == 11, "5 min avant le raid : chargée toute seule")
  -- Synchroniser : recharge l'interface (bouton, commande, touche), jamais en combat
  local reloads, realReload = 0, ReloadUI
  ReloadUI = function() reloads = reloads + 1 end
  InCombatLockdown = function() return true end
  assert(not ns.Companion.Reload() and reloads == 0, "pas de rechargement en combat")
  InCombatLockdown = function() return false end
  run("synchroniser")
  ForeverRoster_Reload()
  assert(reloads == 2, "commande et touche rechargent l'interface")
  ReloadUI = realReload
  ForeverRoster_Refresh()
  assert(left() == 10, "touche « Charger les nouveautés »")
  -- Mode passif : au moins une actualisation par heure
  clock = clock + 59 * 60
  ns.Companion.Tick()
  assert(left() == 10, "pas avant une heure")
  clock = clock + 61
  ns.Companion.Tick()
  assert(left() == 9, "une heure sans actualisation : chargée toute seule")
  for _ = 1, 9 do ok, msg = ns.Companion.Refresh() end
  assert(ok and msg:find("dernière actualisation", 1, true), msg)
  ok, msg = ns.Companion.Refresh()
  assert(not ok and msg:find("/reload", 1, true), msg)
  -- Plus de copie : fenêtre de l'addon « Recharger / Plus tard », hors combat, au plus une fois par heure ; le clic recharge
  clock = clock + 3 * 60
  local before = #printed
  local asks, realAsk, shown = 0, ns.UI.AskReload, nil
  ns.UI.AskReload = function(text) asks = asks + 1 shown = realAsk(text) return shown end
  InCombatLockdown = function() return true end
  fire("READY_CHECK")
  assert(asks == 0, "pas de fenêtre en combat")
  InCombatLockdown = function() return false end
  fire("READY_CHECK")
  fire("READY_CHECK")
  assert(asks == 1 and shown and shown.text.text:find("20 actualisations", 1, true), "proposé une seule fois")
  local said = 0
  for k = before + 1, #printed do if printed[k]:find("20 actualisations", 1, true) then said = said + 1 end end
  assert(said == 1, "copies épuisées : dit une seule fois dans le chat")
  clock = clock + 61 * 60
  ns.Companion.Tick()
  assert(asks == 2, "reproposé au bout d'une heure (mode passif)")
  local reloads2, realReload2 = 0, ReloadUI
  ReloadUI = function() reloads2 = reloads2 + 1 end
  rawget(shown.go, "scripts").OnClick(shown.go)
  ReloadUI = realReload2
  ns.UI.AskReload = realAsk
  assert(reloads2 == 1, "« Recharger » recharge l'interface")
  run("actualiser")
  time = realTime
  ADDONS_DIR = nil
  os.remove(sv)
  assert(os.execute("rm -rf '" .. dir .. "'") == 0)
  ForeverRosterData = nil
  print = function(...) io.stdout:write(table.concat({ ... }, " ") .. "\n") end
  print("aller-retour avec Roster Companion : bon")
end

if failures > 0 then os.exit(1) end
local export = ns.Export.Build()
assert(export:find("\nP;Leatherworking;150;225\n"), "compétence lue dans la fenêtre de métier")
-- API moderne des métiers : GetProfessions (indices avec des trous) + GetProfessionInfo
function GetProfessions() return nil, nil, nil, 4, 5, nil end
function GetProfessionInfo(i) if i == 4 then return "Pêche", 0, 75, 150 elseif i == 5 then return "Cooking", 0, 120, 150 end end
export = ns.Export.Build()
assert(export:find("\nP;Pêche;75;150\n") and export:find("\nP;Cooking;120;150\n"), "métiers par GetProfessions")
assert(export:match("^FRC;2;Tournicoti;") and export:find("\nG;1:16866\n"), "export de base")
assert(export:find("\nR;Leatherworking;s2152\n"), "patron dans l'export")
-- Données des tests affichées telles quelles : noms de groupes et de raids, textes collés, joueurs fictifs du raid d'essai,
-- groupes écrits par Roster Companion dans l'aller-retour de la section 9 (test Rust de l'appli : RC_HELPER)
local FIXTURES = { "Raid du soir", "Autre groupe", "Groupe rapide", "Les Veilleurs", "Relevé", "present;site", "Nyssaël", "Sylvaë", "Groupes 3 et 4",
  "Les Retardataires", "Soirée", "Soft reserve cachée", "Greta Coulé", "Élite de la Vallée", "Toutes les quêtes : prenez-les avant d'entrer." }
LOCALE_AUDIT.check("ForeverRoster", FIXTURES)
print = function(...) io.stdout:write(table.concat({ ... }, " ") .. "\n") end
print("wow_sim : tout est bon ; partage : vraie signature du site vérifiée (" .. shareChecks .. " fois)")
