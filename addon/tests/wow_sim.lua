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
C_Timer = { After = function(_, fn) fn() end }
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
function GetNumSubgroupMembers() return 0 end
function UnitIsGroupLeader() return true end
function UnitIsGroupAssistant() return false end
function InCombatLockdown() return false end
function Ambiguate(n) return n end
function time() return 1790000000 end

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
-- 5. Compo
run("compo")
assert(ns.Compo.Load("FRR;1;x;0;Raid\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1"))
assert(ns.Compo.Status()[1].state == "ok", "le joueur est dans son propre groupe")
run("aide")

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
