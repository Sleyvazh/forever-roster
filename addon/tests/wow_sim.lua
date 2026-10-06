-- Simulation minimale de l'API de WoW : charge l'addon dans l'ordre du .toc et lance ses commandes.
-- lua5.1 addon/tests/wow_sim.lua (depuis la racine du dépôt). Échoue si une commande lève une erreur.
local printed = {}
function print(...) local t = {} for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end printed[#printed + 1] = table.concat(t, " ") end

-- Cadres : toute méthode existe et ne fait rien (sauf texte et visibilité, utiles aux vérifications)
local function frame()
  local f = { shown = false, text = "", scripts = {} }
  return setmetatable(f, { __index = function(t, k)
    if k == "Show" then return function(self) self.shown = true local h = rawget(self, "scripts").OnShow if h then h(self) end end end
    if k == "Hide" then return function(self) self.shown = false local h = rawget(self, "scripts").OnHide if h then h(self) end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, v) self.text = v end end
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
function SendChatMessage(text, channel) said[#said + 1] = channel .. ":" .. text end
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

local ns = {}
for line in io.lines("addon/ForeverRoster/ForeverRoster.toc") do
  if line:match("%.lua$") then assert(loadfile("addon/ForeverRoster/" .. line))("ForeverRoster", ns) end
end
-- Déclenche ADDON_LOADED par le gestionnaire enregistré
fire("ADDON_LOADED", "ForeverRoster")
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
-- Objet pas encore renvoyé par le jeu : nom connu (raid d'essai), jamais « objet 16835 »
GetItemInfo = function() return nil end
assert(ns.Group.displayLink(16835):find("%[Cenarion Leggings%]"), "nom de l'objet porté connu avant la réponse du jeu")
GetItemInfo = realGetItemInfo
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
print = function(...) io.stdout:write(table.concat({ ... }, " ") .. "\n") end
print("wow_sim : tout est bon")
