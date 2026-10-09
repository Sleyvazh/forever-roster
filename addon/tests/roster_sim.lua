-- Simulation de l'API de WoW Retail (12.x) pour l'addon Roster : lua5.1 addon/tests/roster_sim.lua (depuis la racine du dépôt).
-- Charge les fichiers de addon/Roster/Roster.toc dans l'ordre (addon/Roster, sinon addon/shared). Les fichiers du socle
-- (Core.lua, UI.lua, Minimap.lua) absents sont remplacés par une version minimale du contrat entre les deux moitiés de l'addon ;
-- Test.lua (raid d'essai) absent est ignoré.
-- Scénario : données du site, invitations, placement, versions, file des messages pendant un boss, relevé du raid, bilan,
-- distribution du butin (section 9 : chef de butin, passer automatique, conseil, jets, échange, raid d'essai), retours
-- du raid de test (section 10 : échange ouvert par le gagnant, objets portables, tout au conseil, détail des reçus), pages
-- et fenêtres dans les deux habillages, valeurs secrètes. Échoue au premier problème.
local printed = {}
local verbose = os.getenv("ROSTER_SIM_VERBOSE") -- messages de l'addon affichés au fil de l'eau
function print(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end
  printed[#printed + 1] = table.concat(t, " ")
  if verbose then io.stderr:write(printed[#printed], "\n") end
end
local function errors() local n = 0 for _, l in ipairs(printed) do if l:find("erreur") then n = n + 1 end end return n end
local function lastPrinted(pattern, init, plain) for i = #printed, 1, -1 do if printed[i]:find(pattern, init, plain) then return printed[i] end end return nil end

--------------------------------------------------------------------------------------------------------------------
-- Horloge et minuteurs (C_Timer) : le temps avance à la demande
--------------------------------------------------------------------------------------------------------------------
local BASE = 1794513000 - 2 * 3600
local clock = BASE
local timers = {}
local function schedule(delay, fn, every) timers[#timers + 1] = { at = clock + delay, fn = fn, every = every } end
local function advance(sec)
  local target = clock + sec
  while true do
    local best, bi
    for i, t in ipairs(timers) do if t.at <= target and (not best or t.at < best.at) then best, bi = t, i end end
    if not best then break end
    table.remove(timers, bi)
    clock = math.max(clock, best.at)
    if best.every then schedule(best.every, best.fn, best.every) end
    best.fn()
  end
  clock = target
end

--------------------------------------------------------------------------------------------------------------------
-- Cadres : toute méthode existe et ne fait rien (sauf texte, visibilité et scripts, utiles aux vérifications)
--------------------------------------------------------------------------------------------------------------------
TEXTS = setmetatable({}, { __mode = "v" })
local function frame()
  local f = { shown = false, text = "", scripts = {} }
  return setmetatable(f, { __index = function(_, k)
    if k == "Show" then return function(self) self.shown = true local h = rawget(self, "scripts").OnShow if h then h(self) end end end
    if k == "Hide" then return function(self) self.shown = false local h = rawget(self, "scripts").OnHide if h then h(self) end end end
    if k == "IsShown" then return function(self) return self.shown end end
    if k == "SetText" then return function(self, v) self.text = v if v then TEXTS[v] = self end end end
    if k == "GetText" then return function(self) return self.text end end
    if k == "SetScript" then return function(self, n, fn) rawget(self, "scripts")[n] = fn end end
    if k == "GetScript" then return function(self, n) return rawget(self, "scripts")[n] end end
    if k == "HookScript" then return function(self, n, fn) local old = rawget(self, "scripts")[n] rawget(self, "scripts")[n] = function(...) if old then old(...) end fn(...) end end end
    if k == "GetStringHeight" or k == "GetStringWidth" then return function() return 100 end end
    if k:match("^Create") then return function() return frame() end end
    return function() end
  end })
end
local events = {}
local function fire(e, ...)
  for _, f in ipairs(events[e] or {}) do local h = rawget(f, "scripts").OnEvent if h then h(f, e, ...) end end
end

--------------------------------------------------------------------------------------------------------------------
-- Valeurs secrètes (12.x) : toute utilisation autre que issecretvalue lève une erreur
--------------------------------------------------------------------------------------------------------------------
local secrets = setmetatable({}, { __mode = "k" })
local function secretValue(label)
  local u = newproxy(true)
  local mt = getmetatable(u)
  local function boom() error("valeur secrète utilisée : " .. label, 2) end
  mt.__index, mt.__newindex, mt.__concat, mt.__lt, mt.__le, mt.__len, mt.__call = boom, boom, boom, boom, boom, boom, boom
  mt.__tostring = function() return "<secret>" end
  secrets[u] = true
  return u
end

--------------------------------------------------------------------------------------------------------------------
-- État du jeu simulé
--------------------------------------------------------------------------------------------------------------------
local S = {
  raid = false, leader = true, assistant = false, combat = false,
  lockdown = false, hideRestriction = false, restricted = {}, -- verrou des messages (rencontre de boss)
  members = { { name = "Kaeldra", realm = "Hyjal", class = "PRIEST", subgroup = 1 } },
  invites = {}, converted = 0, moves = 0, sent = {}, whispers = {}, throttled = 0, prefixes = {},
  addons = {}, -- joueurs qui ont l'addon : nom complet → version
  instance = nil, quality = {},
  -- Butin (R3b) : jets du butin de groupe en cours, sacs, objets portés, échange
  loot = {}, rollCalls = {}, confirms = {}, bags = { [0] = {}, {}, {}, {}, {} }, equipped = {}, tradeLeft = {}, items = {}, ilvl = {}, equipLoc = {},
  -- Objets portables (0.3) : sous-classe d'armure (1 tissu… 4 plaques ; sinon objet divers), ligne rouge de l'infobulle,
  -- objets que le jeu ne connaît pas du tout
  armor = {}, redLine = {}, unknownItem = {},
}
local function fullOf(m) return m.name .. "-" .. m.realm end
local function findMember(full) for i, m in ipairs(S.members) do if fullOf(m) == full then return m, i end end end
local function rosterUpdate() schedule(0.05, function() fire("GROUP_ROSTER_UPDATE") end) end
local function countIn(g) local n = 0 for _, m in ipairs(S.members) do if m.subgroup == g then n = n + 1 end end return n end
local function firstFree() for g = 1, 8 do if countIn(g) < 5 then return g end end end
-- Un invité accepte
local function accept(full, class)
  local name, realm = full:match("^([^%-]+)%-(.+)$")
  if not S.raid then assert(#S.members < 5, "un groupe hors raid ne dépasse pas 5") end
  S.members[#S.members + 1] = { name = name, realm = realm, class = class or "WARRIOR", subgroup = S.raid and firstFree() or 1 }
  rosterUpdate()
end
local function leave(full)
  local _, i = findMember(full)
  table.remove(S.members, i)
  rosterUpdate()
end
local function unitMember(unit)
  if unit == "player" then return S.members[1] end
  local n = tonumber(tostring(unit):match("^party(%d)$"))
  if n and not S.raid then return S.members[n + 1] end
  n = tonumber(tostring(unit):match("^raid(%d+)$"))
  if n and S.raid then return S.members[n] end
end
local function inGroup() return S.raid or #S.members > 1 end
-- Allocation des messages d'addon par préfixe (10, +1 par seconde) : le jeu refuse au-delà
local allowance, allowanceAt = 10, BASE
local LOOT_Q = { [242394] = 4, [242395] = 4, [242396] = 3, [242397] = 4, [242398] = 4, [242399] = 4, [242400] = 4, [242401] = 4 }
local function idOf(item) return type(item) == "number" and item or tonumber(tostring(item or ""):match("item:(%d+)")) end
local function bagCount(id)
  local n = 0
  for bag = 0, 4 do for _, link in pairs(S.bags[bag]) do if idOf(link) == id then n = n + 1 end end end
  return n
end

local BLIZZARD = {
  UIParent = frame(), UISpecialFrames = {}, GameTooltip = frame(), Minimap = frame(), StaticPopupDialogs = {}, UIPanelWindows = {},
  RAID_CLASS_COLORS = { PRIEST = { colorStr = "ffffffff" }, WARRIOR = { colorStr = "ffc69b6d" }, DRUID = { colorStr = "ffff7c0a" } },
  SlashCmdList = {}, UNKNOWNOBJECT = "Unknown",
  LOOT_ITEM = "%s reçoit le butin : %s.", LOOT_ITEM_MULTIPLE = "%s reçoit le butin : %sx%d.",
  LOOT_ITEM_SELF = "Vous recevez le butin : %s.", LOOT_ITEM_SELF_MULTIPLE = "Vous recevez le butin : %sx%d.",
  Enum = {
    SendAddonMessageResult = { Success = 0, AddonMessageThrottle = 3, NotInGroup = 5, ChannelThrottle = 8, AddOnMessageLockdown = 11 },
    AddOnRestrictionType = { Combat = 0, Encounter = 1, ChallengeMode = 2, PvPMatch = 3, Map = 4, Chat = 5 },
    AddOnRestrictionState = { Inactive = 0, Activating = 1, Active = 2 },
  },
  CreateFrame = function()
    local f = frame()
    f.RegisterEvent = function(self, e) events[e] = events[e] or {} table.insert(events[e], self) end
    return f
  end,
  time = function() return math.floor(clock) end,
  date = function(f, t) return os.date(f, t) end,
  GetTime = function() return clock - BASE + 1000 end,
  strtrim = function(s) return (tostring(s):gsub("^%s+", ""):gsub("%s+$", "")) end,
  wipe = function(t) for k in pairs(t) do t[k] = nil end return t end,
  tinsert = table.insert, tremove = table.remove,
  issecretvalue = function(v) return secrets[v] == true end,
  C_Timer = {
    After = function(d, fn) schedule(d, fn) end,
    NewTicker = function(d, fn) schedule(d, fn, d) return { Cancel = function() end } end,
  },
  C_AddOns = { GetAddOnMetadata = function(_, field) return field == "Version" and "0.1.0" or nil end },
  GetNormalizedRealmName = function() return "Hyjal" end,
  GetRealmName = function() return "Hyjal" end,
  UnitFullName = function(unit)
    local m = unitMember(unit)
    if unit == "npc" then m = S.tradePartner end -- partenaire de l'échange
    if not m then return nil end
    if m.secretName then return secretValue("UnitFullName"), nil end
    return m.name, (unit == "player" or m.realm ~= "Hyjal") and m.realm or nil
  end,
  UnitName = function(unit) local m = unitMember(unit) if m then return m.name, m.realm ~= "Hyjal" and m.realm or nil end end,
  UnitClass = function(unit) local m = unitMember(unit) if m then return "Classe", m.class end end,
  UnitIsConnected = function() return true end,
  IsInRaid = function() return S.raid end,
  IsInGroup = function() return inGroup() end,
  GetNumGroupMembers = function() return inGroup() and #S.members or 0 end,
  GetNumSubgroupMembers = function() return S.raid and 0 or #S.members - 1 end,
  GetRaidRosterInfo = function(i)
    local m = S.raid and S.members[i]
    if not m then return nil end
    local name = m.secretName and secretValue("GetRaidRosterInfo") or (m.unknown and "Unknown") or (m.realm == "Hyjal" and m.name or fullOf(m))
    local rank = i == 1 and (S.leader and 2 or (S.assistant and 1 or 0)) or (S.leaderFull == fullOf(m) and 2 or 0)
    return name, rank, m.subgroup, 90, "Classe", m.class, "Faille", true, false, nil, false, "DAMAGER"
  end,
  UnitIsGroupLeader = function() return S.leader end,
  UnitIsGroupAssistant = function() return S.assistant end,
  InCombatLockdown = function() return S.combat end,
  IsEncounterInProgress = function() return S.inEncounter == true end,
  GetInstanceInfo = function()
    local i = S.instance
    if not i then return "Khaz Algar", "none", 0, "", 5, 0, false, 2552, 1 end
    return i.secret and secretValue("GetInstanceInfo") or i.name, "raid", i.difficulty, "Héroïque", 30, 0, true, 2900, #S.members
  end,
  C_Item = {
    GetItemQualityByID = function(id) return LOOT_Q[id] end,
    GetDetailedItemLevelInfo = function(item) local id = idOf(item) return id and (S.ilvl[id] or 639) or nil end,
    GetItemInfoInstant = function(item)
      local id = idOf(item)
      if not id or S.unknownItem[id] then return nil end
      local a = S.armor[id]
      return id, a and "Armure" or "Divers", a and ({ "Tissu", "Cuir", "Mailles", "Plaques" })[a] or "Divers", S.equipLoc[id] or "", 1234, a and 4 or 15, a or 0
    end,
    GetItemInfo = function(item)
      local link = S.items[idOf(item) or 0]
      if not link then return nil end
      return link:match("|h%[(.-)%]|h"), link, 4
    end,
    GetItemCount = function(id) return bagCount(id) end,
    RequestLoadItemDataByID = function() end,
  },
  -- Butin de groupe (R3b)
  RANDOM_ROLL_RESULT = "%s obtient un %d (%d-%d).",
  BIND_TRADE_TIME_REMAINING = "Vous pouvez échanger cet objet avec les joueurs qui pouvaient aussi le ramasser pendant encore %s.",
  GetLootRollItemLink = function(id)
    local r = S.loot[id]
    if not r then return nil end
    return r.secret and secretValue("GetLootRollItemLink") or r.link
  end,
  GetLootRollItemInfo = function(id)
    local r = S.loot[id]
    if not r then return nil end
    return 1234, r.link:match("|h%[(.-)%]|h"), 1, r.quality or 4, true, r.need or false, r.greed ~= false, false, 0, 0, 0, 0, r.transmog or false
  end,
  GetLootRollTimeLeft = function(id) return S.loot[id] and (S.loot[id].left or 115000) or 0 end,
  RollOnLoot = function(id, kind) S.rollCalls[#S.rollCalls + 1] = { id = id, kind = kind } end,
  ConfirmLootRoll = function(id, kind) S.confirms[#S.confirms + 1] = { id = id, kind = kind } end,
  StaticPopup_Hide = function(which) S.popupHidden = which end,
  GetInventoryItemLink = function(_, slot) return S.equipped[slot] end,
  C_Container = {
    GetContainerNumSlots = function(bag) return (bag >= 0 and bag <= 4) and 16 or 0 end,
    GetContainerItemLink = function(bag, slot) return S.bags[bag] and S.bags[bag][slot] end,
    PickupContainerItem = function(bag, slot)
      assert(not S.combat, "objet pris en combat")
      S.cursor = S.bags[bag][slot] S.picked = { bag, slot }
      S.picks = S.picks or {} S.picks[#S.picks + 1] = bag .. ":" .. slot
    end,
  },
  C_TooltipInfo = {
    GetBagItem = function(bag, slot)
      local link = S.bags[bag] and S.bags[bag][slot]
      if not link then return nil end
      local lines = { { leftText = link:match("|h%[(.-)%]|h") }, { leftText = "Lié quand ramassé" } }
      if S.tradeLeft[link] then lines[#lines + 1] = { leftText = "|cff00ccff" .. BIND_TRADE_TIME_REMAINING:gsub("%%s", S.tradeLeft[link]) .. "|r" } end
      return { type = 0, lines = lines }
    end,
    -- Infobulle d'un lien : nom (violet), type d'objet, et la ligne rouge du jeu (arme non maniée, jeton d'autres classes…)
    GetHyperlink = function(link)
      local id = idOf(link)
      local known = id and S.items[id]
      if not known then return { type = 0, lines = { { leftText = "Récupération des informations sur l'objet", leftColor = { r = 1, g = 0.125, b = 0.125 } } } } end
      local white = { r = 1, g = 1, b = 1 }
      local lines = { { leftText = known:match("|h%[(.-)%]|h"), leftColor = { r = 0.64, g = 0.21, b = 0.93 } }, { leftText = "Lié quand ramassé", leftColor = white } }
      local redLine = S.redLine[id]
      if redLine then
        lines[#lines + 1] = { leftText = redLine.left or "Deux mains", leftColor = redLine.left and { r = 1, g = 0.125, b = 0.125 } or white,
          rightText = redLine.right, rightColor = redLine.right and { r = 1, g = 0.125, b = 0.125 } or nil }
      end
      return { type = 0, lines = lines }
    end,
  },
  RETRIEVING_ITEM_INFO = "Récupération des informations sur l'objet",
  ClearCursor = function() S.cursor = nil end,
  ClickTradeButton = function(i) assert(not S.combat, "échange en combat") S.tradeSlots = S.tradeSlots or {} assert(not S.tradeSlots[i], "case d'échange déjà prise") S.tradeSlots[i] = S.cursor S.cursor = nil end,
  GetTradePlayerItemLink = function(i) return S.tradeSlots and S.tradeSlots[i] end,
  CheckInteractDistance = function(unit)
    if S.distance == "secret" then return secretValue("CheckInteractDistance") end
    if S.distance == "nil" then return nil end
    return S.far ~= unit
  end,
  InitiateTrade = function(unit) assert(not S.combat, "échange en combat") S.tradeWith = unit end,
  C_PartyInfo = {
    InviteUnit = function(name) assert(type(name) == "string" and name:find("^[^%-]+%-.+$"), "invitation par « Prénom-Royaume »") S.invites[#S.invites + 1] = name end,
    ConvertToRaid = function()
      assert(not S.combat, "ConvertToRaid en combat")
      assert(S.leader and not S.raid and #S.members > 1, "ConvertToRaid : chef d'un groupe")
      S.converted = S.converted + 1
      S.raid = true
      rosterUpdate()
    end,
  },
  SetRaidSubgroup = function(index, g)
    assert(not S.combat, "SetRaidSubgroup en combat")
    assert(countIn(g) < 5, "SetRaidSubgroup vers un groupe plein")
    S.moves = S.moves + 1
    schedule(0.1, function() S.members[index].subgroup = g fire("GROUP_ROSTER_UPDATE") fire("GROUP_ROSTER_UPDATE") end)
  end,
  SwapRaidSubgroup = function(a, b)
    assert(not S.combat, "SwapRaidSubgroup en combat")
    S.moves = S.moves + 1
    schedule(0.1, function()
      local ma, mb = S.members[a], S.members[b]
      ma.subgroup, mb.subgroup = mb.subgroup, ma.subgroup
      fire("GROUP_ROSTER_UPDATE")
    end)
  end,
  C_RestrictedActions = { IsAddOnRestrictionActive = function(t) return not S.hideRestriction and S.restricted[t] == true end },
  C_ChatInfo = {
    RegisterAddonMessagePrefix = function(p) S.prefixes[p] = true return 0 end,
    InChatMessagingLockdown = function() return not S.hideRestriction and S.lockdown end,
    AreOutgoingAddonChatMessagesRestricted = function() return S.stuckHint or (not S.hideRestriction and S.lockdown) end,
    SendAddonMessage = function(prefix, msg, dist, target)
      assert(S.prefixes[prefix], "préfixe enregistré")
      assert(#msg <= 255 and #prefix <= 16, "longueurs")
      if S.lockdown then return 11 end
      allowance = math.min(10, allowance + (clock - allowanceAt)) allowanceAt = clock
      if allowance < 1 then S.throttled = S.throttled + 1 return 3 end
      allowance = allowance - 1
      S.sent[#S.sent + 1] = { prefix = prefix, msg = msg, dist = dist, target = target }
      -- Le message revient à l'expéditeur (canal du groupe) ; les autres addons répondent à la question des versions
      if dist == "RAID" or dist == "PARTY" then
        schedule(0.01, function() fire("CHAT_MSG_ADDON", prefix, msg, dist, "Kaeldra-Hyjal") end)
        if msg == "VQ" then
          for _, m in ipairs(S.members) do
            local v = S.addons[fullOf(m)]
            if v then schedule(0.5, function() fire("CHAT_MSG_ADDON", prefix, "VR;" .. v, dist, fullOf(m)) end) end
          end
        end
      end
      return 0
    end,
    SendChatMessage = function(msg, chatType, _, target)
      assert(not S.lockdown, "message du chat pendant le verrou")
      S.whispers[#S.whispers + 1] = { msg = msg, chatType = chatType, target = target }
    end,
  },
}
-- Variables de l'interface de Blizzard : l'addon ne doit jamais les réassigner, même à l'identique (taint)
for k in pairs(BLIZZARD) do rawset(_G, k, nil) end
local reassigned = {}
setmetatable(_G, { __index = BLIZZARD, __newindex = function(t, k, v)
  if BLIZZARD[k] ~= nil then reassigned[#reassigned + 1] = k end
  rawset(t, k, v)
end })

--------------------------------------------------------------------------------------------------------------------
-- Socle (agent A) : version minimale du contrat si Core.lua, UI.lua ou Minimap.lua manquent
--------------------------------------------------------------------------------------------------------------------
local STUBS = {}
STUBS["Core.lua"] = function(ns)
  ns.name, ns.version, ns.LOGO = "Roster", "0.1.0", "Interface\\AddOns\\Roster\\Media\\Logo"
  function ns.db() return RosterDB end
  function ns.print(...) print("Roster :", ...) end
  local f, handlers = CreateFrame("Frame"), {}
  function ns.on(event, fn)
    if not handlers[event] then
      if not pcall(f.RegisterEvent, f, event) then return false end
      handlers[event] = {}
    end
    table.insert(handlers[event], fn)
    return true
  end
  f:SetScript("OnEvent", function(_, event, ...)
    for _, fn in ipairs(handlers[event] or {}) do
      local ok, err = pcall(fn, ...)
      if not ok then ns.print("erreur " .. tostring(err)) end
    end
  end)
  function ns.safe(label, fn, ...)
    local ok, err = pcall(fn, ...)
    if not ok then ns.print("erreur (" .. label .. ") " .. tostring(err)) end
    return ok
  end
  ns.on("ADDON_LOADED", function(name) if name == "Roster" then RosterDB = RosterDB or {} end end)
end
STUBS["UI.lua"] = function(ns)
  local shown = {}
  ns.UI = {
    Show = function(tab) shown.tab = tab end,
    Refresh = function() for key in pairs(ns.Pages and ns.Pages.pages or {}) do ns.Pages.Refresh(key) end end,
    Toggle = function() end, Quick = function() end,
  }
end
STUBS["Minimap.lua"] = function(ns) ns.Minimap = { Update = function() ns.Minimap.pending = ns.Data.PendingCount() ns.Minimap.rec = ns.Recorder.IsRecording() end } end
-- Raid d'essai (/roster test) : simulé dans roster_ui_test.lua ; ici, seuls ses crochets ns.Loot.test le sont (section 9)
STUBS["Test.lua"] = function() end

local ns = {}
local function addonFile(line)
  for _, dir in ipairs({ "addon/Roster/", "addon/shared/" }) do
    local f = io.open(dir .. line)
    if f then f:close() return dir .. line end
  end
end
local stubbed = {}
for line in io.lines("addon/Roster/Roster.toc") do
  line = line:gsub("%s+$", "")
  if line:match("%.lua$") then
    local path = addonFile(line)
    if path then assert(loadfile(path))("Roster", ns)
    else
      assert(STUBS[line], "fichier du .toc introuvable : " .. line)
      STUBS[line](ns)
      stubbed[#stubbed + 1] = line
    end
  end
end
fire("ADDON_LOADED", "Roster")
fire("PLAYER_LOGIN")
fire("PLAYER_ENTERING_WORLD", true, false)
assert(RosterDB, "sauvegarde RosterDB")
for mod, fn in pairs({ Format = "ParseRRG", Comm = "Send", Groups = "Current", Data = "Load", Compo = "Invite", Recorder = "Sample", Pages = "Build" }) do
  assert(ns[mod] and ns[mod][fn], "module chargé : " .. mod)
end
assert(S.prefixes.RosterRT, "préfixe RosterRT enregistré")
assert(errors() == 0, "chargement sans erreur : " .. tostring(lastPrinted("erreur")))
local F, D, G, Cm, Co, R, P = ns.Format, ns.Data, ns.Groups, ns.Comm, ns.Compo, ns.Recorder, ns.Pages

-- Pages construites dans les deux habillages (« jeu » puis « site »), avant toute donnée
local function buildPages(skin)
  RosterDB.skin = skin
  for _, key in ipairs({ "raids", "enraid", "compo" }) do
    local page = CreateFrame("Frame")
    assert(P.Build(key, page), "page " .. key)
    P.Refresh(key)
  end
end
buildPages(nil)
assert(P.state.raids.empty and errors() == 0, "pages vides sans erreur")

--------------------------------------------------------------------------------------------------------------------
-- 1. Données du site : groupes (RRG), compo (RRR), textes refusés
--------------------------------------------------------------------------------------------------------------------
local RAID_ID = "4a1e43ea-54e8-4b49-888f-5e19b5754f61"
local T = BASE + 3600 -- raid dans 1 h
local RRG = table.concat({
  "RRG;1;g1;" .. BASE .. ";Les Veilleurs",
  "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "R;r2;" .. (T + 7 * 86400) .. ";Kith'ix;mythic;20;;;journal",
  "END;2",
  "RRG;1;g2;" .. BASE .. ";Pasta",
  "R;r3;0;Raid à définir;normal;25;tentative;Tharok-Hyjal;softres",
  "END;1",
}, "\n")
local ok, msg = D.Load(RRG)
assert(ok and msg:find("2 groupes") and msg:find("3 raids"), "groupes chargés : " .. tostring(msg))
assert(#G.List() == 2 and #G.Raids() == 3 and G.Raids()[3].raid.time == 0, "raids à venir, sans date à la fin")
assert(G.Current() and G.Current().raid.id == RAID_ID, "raid en cours (dans moins de 2 h)")
assert(D.Summary():find("2 groupes chargés le "), "résumé : " .. D.Summary())
-- Un seul groupe : ajouté ou mis à jour ; plusieurs : remplacent
assert(D.Load("RRG;1;g3;" .. BASE .. ";Troisième\nEND;0") and #G.List() == 3, "un groupe ajouté")
assert(D.Load("RRG;1;g3;" .. BASE .. ";Troisième (renommé)\nEND;0") and #G.List() == 3, "un groupe mis à jour")
assert(D.Load(RRG) and #G.List() == 2, "plusieurs groupes remplacent")
ok, msg = D.Load("FRG;1;g;0;Forever\nEND;0")
assert(not ok and msg == "Ce texte vient de Forever Roster (WoW Forever) : colle-le dans l'addon Forever Roster.", "texte de Forever refusé")
ok, msg = D.Load("FRR;1;x;0;Raid\nM;Greta;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1")
assert(not ok and msg:find("Forever Roster"), "compo de Forever refusée")
ok, msg = D.Load("RRG;1;g;0;G\nR;r;0;Raid;normal;20;;;\nEND;3")
assert(not ok and msg:find("incomplet"), "texte tronqué")
ok, msg = D.Load("RRG;2;g;0;G\nEND;0")
assert(not ok and msg:find("mets l'addon à jour"), "version plus récente")
ok, msg = D.Load("RRB;1;x;0;0;A-B;R;I;1;heroic\nEND;0")
assert(not ok and msg:find("colle%-le sur le site"), "bilan collé dans l'addon")
assert(not D.Load("bonjour"), "texte inconnu")
assert(#G.List() == 2, "textes refusés : rien de changé")

local RRR = table.concat({
  "RRR;1;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20",
  "M;Kaeldra-Hyjal;PRIEST;Heal;Holy;1;1;present;site",
  "M;Tharok-Hyjal;WARRIOR;Tank;Protection;1;2;present;site",
  "M;Brumelune-Ysondre;DRUID;Heal;Restoration;1;3;late;site",
  "M;Ilyra-Hyjal;MAGE;DPS;Frost;1;4;present;site",
  "M;Vex-Kael'Thas;DEMONHUNTER;DPS;Devourer;2;1;present;site",
  "M;Orvane-Hyjal;EVOKER;DPS;Augmentation;2;2;present;site",
  "M;Sylvane-Hyjal;HUNTER;DPS;Marksmanship;2;3;tentative;site",
  "M;Mordak-Ysondre;DEATHKNIGHT;Tank;Blood;2;4;present;site",
  "M;Petit Pois;;;;2;5;present;discord",
  "M;Grumbar-Hyjal;SHAMAN;DPS;Enhancement;0;0;bench;site",
  "END;10",
}, "\n")
ok, msg = D.Load(RRR)
assert(ok and msg:find("Faille de Sporefall") and msg:find("10 persos"), "compo chargée : " .. tostring(msg))
local function states() local out = {} for _, s in ipairs(Co.Status()) do out[s.m.name] = s.state end return out end
local st = states()
assert(st["Kaeldra-Hyjal"] == "ok" and st["Tharok-Hyjal"] == "missing" and st["Petit Pois"] == "manual" and st["Grumbar-Hyjal"] == "bench", "état de la compo hors groupe")

--------------------------------------------------------------------------------------------------------------------
-- 2. Invitations : jamais en combat ; 4 d'abord (groupe de 5), passage en raid, puis la suite
--------------------------------------------------------------------------------------------------------------------
S.combat = true
assert(not Co.Invite() and #S.invites == 0 and lastPrinted("impossible en combat"), "pas d'invitation en combat")
S.combat = false
assert(Co.Invite(), "invitations")
assert(#S.invites == 4 and S.invites[1] == "Tharok-Hyjal" and S.invites[2] == "Brumelune-Ysondre" and S.invites[4] == "Vex-Kael'Thas", "4 invitations (groupe de 5)")
assert(lastPrinted("Petit Pois") and lastPrinted("3 en attente du passage en raid"), "inscrit Discord à la main, la suite en attente")
for _, n in ipairs(S.invites) do assert(n ~= "Grumbar-Hyjal", "banc pas invité") end
accept("Tharok-Hyjal", "WARRIOR")
advance(1)
assert(S.converted == 1 and S.raid, "passage en raid dès le premier arrivé")
assert(#S.invites == 7 and S.invites[5] == "Orvane-Hyjal" and S.invites[7] == "Mordak-Ysondre", "la suite invitée une fois en raid")
assert(lastPrinted("raid formé : 3 invitations de plus"), "message du passage en raid")
-- Arrivées dans le désordre : les groupes ne sont pas ceux de la compo
for _, n in ipairs({ "Vex-Kael'Thas", "Orvane-Hyjal", "Sylvane-Hyjal", "Mordak-Ysondre", "Brumelune-Ysondre", "Ilyra-Hyjal" }) do accept(n) advance(1) end
assert(#S.members == 8 and findMember("Vex-Kael'Thas").subgroup == 1 and findMember("Ilyra-Hyjal").subgroup == 2, "raid formé, groupes mélangés")
st = states()
assert(st["Vex-Kael'Thas"] == "move" and st["Mordak-Ysondre"] == "ok" and st["Tharok-Hyjal"] == "ok", "à déplacer / bon groupe")

--------------------------------------------------------------------------------------------------------------------
-- 3. Placement : jamais en combat ; un déplacement à la fois jusqu'à ce que chacun soit dans son groupe
--------------------------------------------------------------------------------------------------------------------
S.combat = true
assert(not Co.Arrange() and S.moves == 0, "pas de placement en combat")
S.combat = false
assert(Co.Arrange() and Co.arranging, "placement lancé")
advance(20)
assert(not Co.arranging and lastPrinted("groupes placés"), "placement terminé")
for _, m in ipairs(S.members) do
  local want = ({ Kaeldra = 1, Tharok = 1, Brumelune = 1, Ilyra = 1, Vex = 2, Orvane = 2, Sylvane = 2, Mordak = 2 })[m.name]
  assert(m.subgroup == want, "groupe de " .. m.name .. " : " .. m.subgroup)
end
assert(S.moves <= 8, "déplacements : " .. S.moves)
st = states()
assert(st["Vex-Kael'Thas"] == "ok" and st["Brumelune-Ysondre"] == "ok", "compo respectée")
assert(Co.Arrange() == true and lastPrinted("les groupes sont déjà bons"), "rien à placer")
-- Combat pendant le placement : interrompu
findMember("Ilyra-Hyjal").subgroup, findMember("Vex-Kael'Thas").subgroup = 2, 1
Co.Arrange()
S.combat = true
advance(2)
assert(not Co.arranging and lastPrinted("placement interrompu : combat"), "placement interrompu en combat")
S.combat = false
Co.Arrange()
advance(5)
assert(findMember("Ilyra-Hyjal").subgroup == 1 and findMember("Vex-Kael'Thas").subgroup == 2, "placement repris")
-- Assistant : peut placer ; simple membre : non
S.leader = false
assert(not Co.Arrange() and lastPrinted("chef du raid ou assistant"), "simple membre : pas de placement")
S.leader = true

--------------------------------------------------------------------------------------------------------------------
-- 4. Versions de l'addon (VQ / VR) : Mordak n'a pas l'addon ; le chef peut lui chuchoter d'un clic
--------------------------------------------------------------------------------------------------------------------
S.addons = { ["Tharok-Hyjal"] = "0.1.0", ["Brumelune-Ysondre"] = "0.0.9", ["Ilyra-Hyjal"] = "0.1.0", ["Vex-Kael'Thas"] = "0.1.0", ["Orvane-Hyjal"] = "0.1.0", ["Sylvane-Hyjal"] = "0.1.1" }
local sentBefore = #S.sent
assert(Cm.AskVersions(), "question des versions")
assert(S.sent[sentBefore + 1].msg == "VQ" and S.sent[sentBefore + 1].dist == "RAID" and S.sent[sentBefore + 1].prefix == "RosterRT", "VQ au raid")
advance(7)
local rows = {}
for _, r in ipairs(Cm.Rows()) do rows[r.name] = r.state end
assert(rows["Kaeldra-Hyjal"] == "ok" and rows["Tharok-Hyjal"] == "ok" and rows["Sylvane-Hyjal"] == "ok" and rows["Brumelune-Ysondre"] == "old" and rows["Mordak-Ysondre"] == "none", "versions : à jour, ancienne, sans addon")
assert(Cm.Versions()["Vex-Kael'Thas"] == "0.1.0" and Cm.Versions()["Kaeldra-Hyjal"] == "0.1.0" and Cm.Versions()["Mordak-Ysondre"] == nil, "table des versions")
-- Un autre demande : je réponds avec ma version
fire("CHAT_MSG_ADDON", "RosterRT", "VQ", "RAID", "Tharok-Hyjal")
assert(S.sent[#S.sent].msg == "VR;0.1.0" and S.sent[#S.sent].dist == "RAID", "réponse VR")
fire("CHAT_MSG_ADDON", "AutrePréfixe", "VR;9.9.9", "RAID", "Mordak-Ysondre")
assert(Cm.Rows() and Cm.Versions()["Mordak-Ysondre"] == nil, "autre préfixe ignoré")
-- Onglet En raid : chef de raid → bouton « Chuchoter » pour Mordak
buildPages(nil)
assert(#P.state.enraid.whisper == 1 and P.state.enraid.whisper[1] == "Mordak-Ysondre", "chuchoter : proposé au chef pour le joueur sans addon")
local wb = TEXTS["Chuchoter"]
assert(wb and wb.shown, "bouton Chuchoter")
rawget(wb, "scripts").OnClick(wb)
assert(#S.whispers == 1 and S.whispers[1].chatType == "WHISPER" and S.whispers[1].target == "Mordak-Ysondre"
  and S.whispers[1].msg == "Salut ! Pour ce raid, on utilise l'addon Roster (compo, présence et distribution du butin) : pense à l'installer.", "chuchotement envoyé")
-- Simple membre : ni bouton ni chuchotement
S.leader = false
P.Refresh("enraid")
assert(#P.state.enraid.whisper == 0, "simple membre : pas de bouton Chuchoter")
assert(not Cm.Whisper("Mordak-Ysondre") and #S.whispers == 1, "simple membre : pas de chuchotement")
S.assistant = true
P.Refresh("enraid")
assert(#P.state.enraid.whisper == 1, "assistant : bouton Chuchoter")
S.leader, S.assistant = true, false

--------------------------------------------------------------------------------------------------------------------
-- 5. File des messages : retenus pendant une rencontre de boss, envoyés après ; limite de 10 + 1 par seconde
--------------------------------------------------------------------------------------------------------------------
local function startEncounter(id, name)
  S.lockdown, S.restricted[1], S.restricted[5], S.inEncounter = true, true, true, true
  fire("ADDON_RESTRICTION_STATE_CHANGED", 1, 2)
  fire("ENCOUNTER_START", id, name, 15, 20)
end
local function endEncounter(id, name, success)
  S.inEncounter = false
  fire("ENCOUNTER_END", id, name, 15, 20, success, {})
  schedule(0.5, function()
    S.lockdown, S.restricted[1], S.restricted[5] = false, false, false
    fire("ADDON_RESTRICTION_STATE_CHANGED", 1, 0)
  end)
end
advance(30)
sentBefore = #S.sent
startEncounter(3176, "Gardienne des spores")
assert(Cm.Send("XA;1") and Cm.Send("XA;2"), "messages acceptés dans la file")
Cm.AskVersions()
assert(#S.sent == sentBefore and Cm.Held() == 3, "rien ne part pendant la rencontre")
assert(lastPrinted("question prête : elle part au groupe dès la fin du combat de boss"), "question retenue annoncée")
assert(not Cm.Whisper("Mordak-Ysondre") and lastPrinted("pas pendant un combat de boss"), "pas de chuchotement pendant la rencontre")
advance(20)
assert(#S.sent == sentBefore and Cm.Held() == 3, "toujours retenus (nouveaux essais)")
-- Les relevés continuent pendant le combat
endEncounter(3176, "Gardienne des spores", 1)
advance(3)
assert(Cm.Held() == 0 and S.sent[sentBefore + 1].msg == "XA;1" and S.sent[sentBefore + 2].msg == "XA;2" and S.sent[sentBefore + 3].msg == "VQ", "envoyés dans l'ordre après la rencontre")
advance(7)
-- Restriction non annoncée par le jeu : l'envoi répond AddOnMessageLockdown, le message attend quand même
S.lockdown, S.hideRestriction = true, true
sentBefore = #S.sent
Cm.Send("XB;1")
assert(Cm.Held() == 1 and #S.sent == sentBefore, "AddOnMessageLockdown : gardé")
S.lockdown, S.hideRestriction = false, false
advance(4)
assert(Cm.Held() == 0 and S.sent[#S.sent].msg == "XB;1", "renvoyé au nouvel essai")
-- Rafale : 15 messages, jamais refusés par la limite du jeu
advance(15)
sentBefore = #S.sent
for i = 1, 15 do Cm.Send("XC;" .. i) end
assert(Cm.Held() > 0, "rafale : une partie attend")
advance(10)
assert(Cm.Held() == 0 and #S.sent == sentBefore + 15 and S.throttled == 0 and S.sent[#S.sent].msg == "XC;15", "rafale envoyée au rythme permis")
-- Indication de restriction restée vraie hors rencontre alors que l'envoi passe : nouvel essai au bout de 10 s,
-- puis l'indication est ignorée (le résultat de l'envoi fait foi)
advance(15)
S.stuckHint = true
sentBefore = #S.sent
Cm.Send("XD;1") Cm.Send("XD;2")
advance(5)
assert(Cm.Held() == 2 and #S.sent == sentBefore, "indication de restriction : on attend d'abord")
advance(10)
assert(Cm.Held() == 0 and S.sent[#S.sent].msg == "XD;2", "nouvel essai réussi : partis")
Cm.Send("XD;3")
assert(Cm.Held() == 0 and S.sent[#S.sent].msg == "XD;3", "indication ignorée ensuite")
S.stuckHint = false
-- Message chuchoté à soi-même : traité tout de suite ; un message envoyé depuis le traitement part ensuite
local got = {}
Cm.On("ZT", function(sender, f) got[#got + 1] = sender .. ":" .. f[2] if f[2] == "1" then Cm.Send("ZT;2", "WHISPER", "Kaeldra-Hyjal") end end)
Cm.Send("ZT;1", "WHISPER", "Kaeldra-Hyjal")
assert(#got == 2 and got[1] == "Kaeldra-Hyjal:1" and got[2] == "Kaeldra-Hyjal:2" and Cm.Held() == 0, "à soi-même, sans boucle")
-- ENCOUNTER_END manqué : la file repart dès que le jeu ne signale plus de rencontre
S.inEncounter = true
fire("ENCOUNTER_START", 3175, "Essai", 15, 20)
Cm.Send("XE;1")
assert(Cm.Held() == 1, "rencontre commencée : retenu")
S.inEncounter = false -- sortie de l'instance pendant le combat, sans ENCOUNTER_END
advance(4)
assert(Cm.Held() == 0 and S.sent[#S.sent].msg == "XE;1", "pas de rencontre en cours pour le jeu : parti")

--------------------------------------------------------------------------------------------------------------------
-- 6. Relevé du raid : présence chaque minute, un retard, un départ, un boss, du butin ; bilan RRB
--------------------------------------------------------------------------------------------------------------------
local log = R.Current()
assert(log and log.raidId == RAID_ID and R.IsRecording(), "relevé démarré sur le raid du site")
assert(log.encounters[1] and log.encounters[1].id == 3176 and log.encounters[1].success, "fin de rencontre notée")
S.instance = { name = "Faille de Sporefall", difficulty = 15 }
-- Zephyra arrive 20 minutes après l'heure du raid
advance(T + 20 * 60 - clock)
accept("Zephyra-Hyjal", "DRUID")
advance(10 * 60)
local zeph = log.people["Zephyra-Hyjal"]
assert(zeph and zeph.first > T + 10 * 60, "arrivée en retard relevée")
-- Ilyra part
leave("Ilyra-Hyjal")
advance(10 * 60)
-- Boss vaincu puis butin : épique de Tharok, rare ignoré, épique pour moi, message secret ignoré
startEncounter(3177, "Kith'ix")
advance(5 * 60)
endEncounter(3177, "Kith'ix", 1)
advance(2)
fire("CHAT_MSG_LOOT", "Tharok-Hyjal reçoit le butin : |cnIQ4:|Hitem:242394::::::::90:::::|h[Lame de Sporefall]|h|r.", "", "", "", "")
fire("CHAT_MSG_LOOT", "Vex reçoit le butin : |cnIQ3:|Hitem:242396::::::::90:::::|h[Bleu]|h|r.", "", "", "", "")
fire("CHAT_MSG_LOOT", "Vous recevez le butin : |Hitem:242395::::::::90:::::|h[Anneau]|h.", "", "", "", "")
fire("CHAT_MSG_LOOT", "Tharok a choisi Besoin pour : |cnIQ4:|Hitem:242394|h[Lame]|h|r", "", "", "", "")
fire("CHAT_MSG_LOOT", secretValue("CHAT_MSG_LOOT"), "", "", "", "")
assert(#log.loot == 2 and log.loot[1].who == "Tharok-Hyjal" and log.loot[1].id == 242394 and log.loot[1].boss == "Kith'ix", "butin épique d'un autre, avec le boss")
assert(log.loot[2].who == "Kaeldra-Hyjal" and log.loot[2].id == 242395, "mon butin (qualité donnée par le jeu)")
-- Le seuil de qualité se règle (rare)
RosterDB.lootQuality = 3
fire("CHAT_MSG_LOOT", "Vex-Kael'Thas reçoit le butin : |cnIQ3:|Hitem:242396::::::::90:::::|h[Bleu]|h|r.", "", "", "", "")
assert(#log.loot == 3 and log.loot[3].who == "Vex-Kael'Thas", "seuil rare")
RosterDB.lootQuality = nil
advance(10 * 60)
local status = R.Status()
assert(status.present == 8 and #status.late == 1 and status.late[1] == "Zephyra-Hyjal" and #status.left == 1 and status.left[1] == "Ilyra-Hyjal", "présents, retard, départ")
assert(#status.bosses == 2 and status.loot == 3, "boss et butin")
assert(log.instance == "Faille de Sporefall" and log.difficulty == "heroic" and R.IsLead(log), "instance, difficulté, chef de raid")
-- Bilan
local text, n = D.ExportText(false)
assert(n == 1 and D.PendingCount() == 1, "un bilan à envoyer")
local lines = {}
for l in text:gmatch("[^\n]+") do lines[#lines + 1] = l end
assert(lines[1] == "RRB;1;" .. RAID_ID .. ";" .. log.start .. ";" .. log.stop .. ";Kaeldra-Hyjal;Faille de Sporefall;Faille de Sporefall;1;heroic", "en-tête RRB : " .. lines[1])
assert(text:find("\nA;Ilyra%-Hyjal;%d+;%d+;%d+\n") and text:find("\nA;Vex%-Kael'Thas;") and text:find("\nA;Zephyra%-Hyjal;" .. zeph.first .. ";"), "présence")
assert(text:find("\nL;242394;Tharok%-Hyjal;%d+;Kith'ix;;;;[^;\n]+\n") and text:find("\nL;242395;Kaeldra%-Hyjal;%d+;Kith'ix;;;;[^;\n]+\n"), "butin (méthode, réponse, détail vides ; nom de l'objet)")
assert(text:find("\nE;3176;Gardienne des spores;%d+;1\nE;3177;Kith'ix;%d+;1\nEND;14$"), "rencontres et END (9 A + 3 L + 2 E)")
-- Envoyé (Ctrl+C) ; un relevé fait entre l'export et la copie repart à la prochaine synchro
D.MarkSent()
assert(D.PendingCount() == 0 and select(2, D.ExportText(false)) == 0, "bilan envoyé")
advance(60)
assert(D.PendingCount() == 1, "nouveau relevé : à renvoyer")
D.ExportText(false)
advance(60)
D.MarkSent()
assert(D.PendingCount() == 1, "relevé fait après l'export : encore à envoyer")
assert(select(2, D.ExportText(true)) == 1, "tout renvoyer : bilans récents")
D.MarkSent()
assert(D.PendingCount() == 0, "tout envoyé")
-- Pages pendant le raid, dans les deux habillages
buildPages(nil)
assert(P.state.enraid.recording and P.state.compo.ok == 7 and P.state.compo.total == 9 and P.state.raids.raids == 3, "pages du raid (Ilyra partie) : " .. P.state.compo.ok .. "/" .. P.state.compo.total .. ", " .. P.state.raids.raids .. " raids")
buildPages("site")
assert(errors() == 0, "pages sans erreur : " .. tostring(lastPrinted("erreur")))

--------------------------------------------------------------------------------------------------------------------
-- 9. Distribution du butin (R3b) : chef de butin, passer automatique, objets reçus, conseil, jets, échange, file
--------------------------------------------------------------------------------------------------------------------
local Lo, LU = ns.Loot, ns.LootUI
assert(Lo and LU and Lo.Master and LU.ShowLoot, "modules du butin chargés")
-- Messages d'addon et du chat envoyés depuis une position (recherche du dernier qui correspond)
local function sentMsg(pattern, from, dist)
  for i = #S.sent, from or 1, -1 do local e = S.sent[i] if e.msg:find(pattern) and (not dist or e.dist == dist) then return e, i end end
end
local function said(pattern, from)
  for i = #S.whispers, from or 1, -1 do if S.whispers[i].msg:find(pattern, 1, true) then return S.whispers[i] end end
end
local function printedSince(mark, text) for i = mark + 1, #printed do if printed[i]:find(text, 1, true) then return printed[i] end end end
local function addon(sender, msg, dist) fire("CHAT_MSG_ADDON", "RosterRT", msg, dist or "RAID", sender) end
local function item(id, name, bonus) local l = "|cnIQ4:|Hitem:" .. id .. "::::::::90:::::" .. (bonus or "") .. "|h[" .. name .. "]|h|r" S.items[id] = l return l end
local LEGS, RING, TRINKET = item(242394, "Jambières de l'Étreinte toxique", "1:6652"), item(242395, "Anneau des spores"), item(242397, "Fiole de spores")
local CLOAK, HELM, BOOTS = item(242398, "Cape de la Faille"), item(242399, "Heaume de Kith'ix"), item(242400, "Bottes de Sporefall")
local OLD_LEGS = item(230001, "Vieilles jambières")
S.equipLoc = { [242394] = "INVTYPE_LEGS", [242395] = "INVTYPE_FINGER", [242397] = "INVTYPE_TRINKET", [242398] = "INVTYPE_CLOAK", [242399] = "INVTYPE_HEAD" }
S.ilvl = { [230001] = 626, [242111] = 636 }
S.equipped[7] = OLD_LEGS
-- Données du site avec le conseil du raid (L) et les objets reçus (N)
ok, msg = D.Load(table.concat({
  "RRG;1;g1;" .. BASE .. ";Les Veilleurs",
  "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "O;Kaeldra-Hyjal,Grumbar-Hyjal",
  "L;" .. RAID_ID .. ";Kaeldra-Hyjal,Tharok-Hyjal,Brumelune-Ysondre",
  "N;saison;depuis le 05/11/2026;Tharok-Hyjal:2,Vex-Kael'Thas+Ilyra-Hyjal:1",
  "END;1",
}, "\n"))
assert(ok and R.IsRecording() and G.Current().raid.id == RAID_ID, "données du site avec le conseil : " .. tostring(msg))
local council = Lo.CouncilNames()
assert(#council == 3 and council[2] == "Tharok-Hyjal", "conseil du raid présent (ligne L)")
for _, e in ipairs(Lo.Items()) do Lo.Remove(e.key) end -- objets reçus plus haut (relevé)

-- 9a. Chef de butin : le chef de raid, ou celui qu'il désigne ; distribution d'office (raid en mode conseil)
assert(Lo.Master() == "Kaeldra-Hyjal" and Lo.IsMaster() and Lo.Enabled() and Lo.AutoPass(), "chef de raid = chef de butin, distribution d'office")
local mark = #S.sent
assert(Lo.SetMaster("Tharok-Hyjal") and Lo.Master() == "Tharok-Hyjal" and not Lo.IsMaster(), "chef de butin désigné")
advance(1)
assert(sentMsg("^ML;1;Tharok%-Hyjal$", mark + 1, "RAID"), "ML au raid")
addon("Vex-Kael'Thas", "ML;0;Vex-Kael'Thas")
assert(Lo.Enabled() and Lo.Master() == "Tharok-Hyjal", "ML d'un autre joueur ignoré")
addon("Tharok-Hyjal", "ML;0;Tharok-Hyjal")
assert(not Lo.Enabled() and Lo.Master() == "Tharok-Hyjal", "le chef de butin coupe la distribution")
addon("Tharok-Hyjal", "ML;1;Tharok-Hyjal")
assert(Lo.Enabled() and lastPrinted("Tharok distribue"), "le chef de butin la rallume (message au joueur)")
mark = #S.sent
addon("Orvane-Hyjal", "MQ")
advance(1)
assert(sentMsg("^ML;1;Tharok%-Hyjal$", mark + 1), "réponse à MQ (chef de raid)")
S.leader = false
assert(not Lo.SetMaster("Vex-Kael'Thas") and lastPrinted("seul le chef de raid"), "simple membre : pas de désignation")
assert(not Lo.SetEnabled(false) and Lo.Enabled(), "simple membre (pas chef de butin) : distribution inchangée")
S.leader = true
-- Onglet En raid : section Butin, désigner depuis la liste
buildPages(nil)
local es = P.state.enraid.loot
assert(es and es.master == "Tharok-Hyjal" and es.canDesignate and es.canSet and es.enabled, "onglet En raid : section Butin")
rawget(TEXTS["Désigner un autre"], "scripts").OnClick(TEXTS["Désigner un autre"])
P.Refresh("enraid") -- la fenêtre principale n'est pas ouverte : la page est rafraîchie à la main
es = P.state.enraid.loot
assert(#es.designate == 7 and es.designate[7] == "Zephyra-Hyjal", "liste des membres à désigner : " .. table.concat(es.designate, ", "))
rawget(TEXTS["Désigner"], "scripts").OnClick(TEXTS["Désigner"])
assert(Lo.Master() == "Zephyra-Hyjal", "désigné d'un clic")
assert(Lo.SetMaster(nil) and Lo.IsMaster() and Lo.Master() == "Kaeldra-Hyjal", "le chef de raid reprend le butin")
assert(Lo.SetEnabled(false) and not Lo.Enabled() and Lo.SetEnabled(true) and Lo.Enabled(), "distribution coupée puis remise")
advance(2)

-- 9b. Joueur : attend le LR du chef de butin (20 s au plus) puis passe ; sans LR, ne passe pas et le dit
assert(Lo.SetMaster("Tharok-Hyjal"), "Tharok chef de butin")
S.loot[10] = { link = LEGS, need = true }
fire("START_LOOT_ROLL", 10, 120000)
assert(#S.rollCalls == 0 and Lo.pending[10], "en attente du LR")
addon("Vex-Kael'Thas", "LR;242394")
assert(#S.rollCalls == 0, "LR d'un autre que le chef de butin ignoré")
addon("Tharok-Hyjal", "LR;242394")
assert(#S.rollCalls == 1 and S.rollCalls[1].id == 10 and S.rollCalls[1].kind == 0 and lastPrinted("c'est le chef de butin qui distribue"), "passe après le LR")
-- LR arrivé avant le jet (le jeu ne prévient pas tout le monde en même temps)
S.loot[11] = { link = BOOTS }
addon("Tharok-Hyjal", "LR;242400")
fire("START_LOOT_ROLL", 11, 120000)
assert(#S.rollCalls == 2 and S.rollCalls[2].id == 11 and S.rollCalls[2].kind == 0, "LR déjà reçu : passe tout de suite")
-- Passer automatique coupé (Options)
RosterDB.autoPass = false
S.loot[12] = { link = LEGS }
fire("START_LOOT_ROLL", 12, 120000)
addon("Tharok-Hyjal", "LR;242394")
assert(#S.rollCalls == 2 and lastPrinted("passer automatique coupé chez toi"), "passer automatique coupé : rien n'est passé")
RosterDB.autoPass = nil
-- Pas de LR en 20 s : ne passe pas, le dit
S.loot[13] = { link = RING }
fire("START_LOOT_ROLL", 13, 120000)
advance(19)
assert(#S.rollCalls == 2 and not lastPrinted("pas de signal du chef de butin"), "pas encore 20 s")
advance(2)
assert(#S.rollCalls == 2 and printedSince(0, "pas de signal du chef de butin pour " .. RING), "sans LR en 20 s : pas passé, message")
-- Jet presque fini : attente plus courte
S.loot[14] = { link = HELM, left = 8000 }
fire("START_LOOT_ROLL", 14, 120000)
advance(7)
assert(printedSince(0, "pas de signal du chef de butin pour " .. HELM), "attente bornée par la fin du jet")
-- Butin ordinaire (rare) sans LR : pas de message
local pmark = #printed
S.loot[15] = { link = "|cnIQ3:|Hitem:242396::::|h[Bleu]|h|r", quality = 3 }
fire("START_LOOT_ROLL", 15, 120000)
advance(21)
assert(not printedSince(pmark, "Bleu"), "objet sous le seuil : silencieux")
-- Valeurs secrètes : ignorées
S.loot[16] = { link = LEGS, secret = true }
fire("START_LOOT_ROLL", 16, 120000)
fire("START_LOOT_ROLL", secretValue("rollID"), 120000)
assert(not Lo.pending[16] and errors() == 0, "jet illisible ignoré")
-- Conseil vu d'un joueur membre du conseil : LO du chef de butin seulement, réponse au conseil, LC qui ferme
addon("Vex-Kael'Thas", "LO;77001;item:242394::::::::90:::::;Faux")
assert(#Lo.Offers() == 0, "LO d'un autre que le chef de butin ignoré")
addon("Tharok-Hyjal", "LO;77002;item:242394::::::::90:::::1:6652;Jambières de l'Étreinte toxique")
local po = Lo.Offers()
assert(#po == 1 and po[1].from == "Tharok-Hyjal" and po[1].link == LEGS and LU.state.offer.session == "77002", "fenêtre de réponse ouverte")
local pc = Lo.Council("77002")
assert(pc and pc.master == "Tharok-Hyjal" and not pc.isMaster and LU.state.council.session == "77002", "membre du conseil : fenêtre du conseil")
mark = #S.sent
assert(Lo.Answer("77002", "bis", ""), "réponse")
advance(1)
local pt = {}
for i = mark + 1, #S.sent do if S.sent[i].msg:find("^LA;77002;bis;230001:626;$") then pt[S.sent[i].target] = true end end
assert(pt["Tharok-Hyjal"] and pt["Brumelune-Ysondre"], "réponse au chef de butin et au conseil")
addon("Vex-Kael'Thas", "LA;77002;upgrade;242111:630;sans données;Brumelune-Ysondre;r", "RAID")
assert(not Lo.Council("77002").cands[2], "relais d'un autre que le chef de butin ignoré")
addon("Tharok-Hyjal", "LA;77002;upgrade;242111:630;sans données;Vex-Kael'Thas;r", "RAID")
addon("Tharok-Hyjal", "LA;77002;bis;;chuchoté;Mordak-Ysondre", "WHISPER")
local rc = Lo.Council("77002")
local rvex, rmor
for _, x in ipairs(rc.cands) do if x.name == "Vex-Kael'Thas" then rvex = x elseif x.name == "Mordak-Ysondre" then rmor = x end end
assert(rvex and rvex.response == "upgrade" and rvex.note == "sans données" and not rvex.whispered and rvex.gear[1].ilvl == 630, "réponse relayée par le chef de butin : note et objet porté gardés")
assert(rmor and rmor.whispered and rmor.note == "", "réponse chuchotée relayée")
addon("Brumelune-Ysondre", "LV;77002;Kaeldra-Hyjal", "WHISPER")
assert(Lo.Council("77002").cands[1].votes == 1 and not Lo.AwardCouncil("77002", "Kaeldra-Hyjal"), "vote reçu ; seul le chef de butin donne")
addon("Tharok-Hyjal", "LC;77002;Kaeldra-Hyjal")
assert(#Lo.Offers() == 0 and Lo.Council("77002").closed and Lo.Council("77002").winner == "Kaeldra-Hyjal", "LC : conseil terminé")
addon("Tharok-Hyjal", "RS;242397;msos")
assert(lastPrinted("/roll 100 en spé principale, /roll 99 en spé secondaire"), "RS : rappel des jets")
-- LW : l'attribution du chef de butin notée aussi dans mon relevé (bilans du raid qui concordent)
local mylog = R.Current()
assert(mylog, "relevé en cours")
local nLoot = #mylog.loot
fire("CHAT_MSG_LOOT", "Tharok-Hyjal reçoit le butin : " .. LEGS .. ".", "", "", "", "")
assert(#mylog.loot == nLoot + 1 and mylog.loot[nLoot + 1].who == "Tharok-Hyjal", "objet ramassé par le chef de butin")
addon("Vex-Kael'Thas", "LW;1-242394-9;242394;Vex-Kael'Thas;ml;;")
assert(mylog.loot[nLoot + 1].who == "Tharok-Hyjal", "LW d'un autre que le chef de butin ignoré")
addon("Tharok-Hyjal", "LW;1-242394-9;242394;Brumelune-Ysondre;council;bis;3 votes")
local lw = mylog.loot[nLoot + 1]
assert(#mylog.loot == nLoot + 1 and lw.who == "Brumelune-Ysondre" and lw.method == "council" and lw.response == "bis" and lw.detail == "3 votes", "LW : gagnant noté")
addon("Tharok-Hyjal", "LW;1-242394-9;242394;Mordak-Ysondre;roll;;MS 87")
assert(#mylog.loot == nLoot + 1 and lw.who == "Mordak-Ysondre" and lw.method == "roll" and lw.response == "" and lw.detail == "MS 87", "LW : nouveau gagnant du même objet")
assert(not mylog.distributed, "pas distribué par moi")
table.remove(mylog.loot, nLoot + 1)
assert(Lo.SetMaster(nil) and Lo.IsMaster(), "de nouveau chef de butin")
advance(2)

-- 9c. Chef de butin : prend l'objet (Besoin, sinon Transmo, sinon Cupidité), confirme, envoie le LR
mark = #S.sent
S.loot[20] = { link = LEGS, need = true }
fire("START_LOOT_ROLL", 20, 120000)
assert(S.rollCalls[#S.rollCalls].id == 20 and S.rollCalls[#S.rollCalls].kind == 1, "chef : Besoin")
fire("CONFIRM_LOOT_ROLL", 20, 1, "BIND")
assert(S.confirms[1] and S.confirms[1].id == 20 and S.confirms[1].kind == 1 and S.popupHidden == "CONFIRM_LOOT_ROLL", "objet lié : jet confirmé")
fire("CONFIRM_LOOT_ROLL", 99, 1, "BIND")
assert(#S.confirms == 1, "jet pris à la main : pas confirmé par l'addon")
S.loot[21] = { link = RING, transmog = true }
fire("START_LOOT_ROLL", 21, 120000)
assert(S.rollCalls[#S.rollCalls].id == 21 and S.rollCalls[#S.rollCalls].kind == 4, "chef : Transmo à défaut de Besoin")
S.loot[22] = { link = TRINKET }
fire("START_LOOT_ROLL", 22, 120000)
assert(S.rollCalls[#S.rollCalls].id == 22 and S.rollCalls[#S.rollCalls].kind == 2, "chef : Cupidité à défaut")
local calls = #S.rollCalls
S.loot[23] = { link = CLOAK, greed = false }
fire("START_LOOT_ROLL", 23, 120000)
assert(#S.rollCalls == calls and printedSince(0, "tu ne peux pas prendre " .. CLOAK), "chef pas éligible : rien pris, pas de LR")
S.loot[24] = { link = "|cnIQ3:|Hitem:242396::::|h[Bleu]|h|r", quality = 3, need = true }
fire("START_LOOT_ROLL", 24, 120000)
assert(#S.rollCalls == calls, "chef : butin ordinaire laissé au jet habituel")
advance(2)
assert(sentMsg("^LR;242394$", mark + 1, "RAID") and sentMsg("^LR;242395$", mark + 1) and sentMsg("^LR;242397$", mark + 1) and not sentMsg("^LR;242398$", mark + 1), "LR au raid pour les objets pris")
-- Le chef reçoit les jambières : à distribuer, place dans les sacs et minuteur d'échange lus
S.bags[0][3], S.tradeLeft[LEGS] = LEGS, "1 h 58 min"
local logLines = #log.loot
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. LEGS .. ".", "", "", "", "")
local items = Lo.Items()
local legs = items[#items]
assert(#items == 1 and legs.itemId == 242394 and legs.status == "new" and legs.bag == 0 and legs.slot == 3 and legs.ilvl == 639, "objet reçu : à distribuer")
assert(legs.expires and math.abs(legs.expires - (time() + 7080)) <= 1 and legs.name == "Jambières de l'Étreinte toxique", "minuteur d'échange lu dans l'infobulle")
assert(#log.loot == logLines + 1 and log.loot[#log.loot].who == "Kaeldra-Hyjal", "bilan : ramassé par le chef de butin")
-- Mordak (sans l'addon) gagne l'anneau : signalé au chef, qui lui chuchote de le garder
fire("CHAT_MSG_LOOT", "Mordak-Ysondre reçoit le butin : " .. RING .. ".", "", "", "", "")
local np = Lo.NotPassed()
assert(#np == 1 and np[1].name == "Mordak-Ysondre" and np[1].itemId == 242395 and lastPrinted("Mordak%-Ysondre a gagné"), "pas passé : signalé au chef de butin")
local wmark = #S.whispers
assert(Lo.WhisperNotPassed("Mordak-Ysondre"), "chuchotement au joueur qui n'a pas passé")
assert(S.whispers[wmark + 1].chatType == "WHISPER" and S.whispers[wmark + 1].target == "Mordak-Ysondre" and S.whispers[wmark + 1].msg:find("garde l'objet pour l'instant", 1, true), "chuchoté : garder pour l'échange")
assert(np[1].whispered and not Lo.WhisperNotPassed("Mordak-Ysondre"), "chuchoté une fois")
-- Fiole reçue un peu après le message (le jeu la pose ensuite dans les sacs)
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. TRINKET .. ".", "", "", "", "")
local trinket = Lo.Items()[2]
assert(trinket.itemId == 242397 and not trinket.bag and not trinket.expires, "pas encore dans les sacs")
S.bags[1][5], S.tradeLeft[TRINKET] = TRINKET, "1 h 59 min"
advance(1.5)
assert(trinket.bag == 1 and trinket.slot == 5 and trinket.expires, "retrouvé dans les sacs")
-- Cape et heaume reçus (en dehors des jets : objets épiques reçus pendant la distribution)
S.bags[2][1], S.bags[2][2], S.tradeLeft[CLOAK], S.tradeLeft[HELM] = CLOAK, HELM, "1 h 50 min", "25 min"
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. CLOAK .. ".", "", "", "", "")
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. HELM .. ".", "", "", "", "")
fire("CHAT_MSG_LOOT", "Vous recevez le butin : |cnIQ3:|Hitem:242396::::|h[Bleu]|h|r.", "", "", "", "")
items = Lo.Items()
local cloak, helm = items[3], items[4]
assert(#items == 4 and cloak.itemId == 242398 and helm.itemId == 242399 and helm.expires - time() == 1500, "objets reçus (le rare reste au joueur)")
LU.ShowLoot()
assert(LU.state.loot.items == 4 and LU.state.loot.master and LU.state.loot.notPassed == 1, "fenêtre du butin")
advance(2)

-- 9d. Conseil : proposé au raid, réponses (une chuchotée par un joueur sans addon), votes, « Donner »
mark, wmark = #S.sent, #S.whispers
local okC, sid = Lo.StartCouncil(legs.key)
assert(okC and sid and legs.status == "council" and legs.session == sid, "conseil lancé")
advance(1)
local lo = sentMsg("^LO;", mark + 1, "RAID")
assert(lo and lo.msg == "LO;" .. sid .. ";item:242394::::::::90:::::1:6652;Jambières de l'Étreinte toxique", "LO : chaîne de l'objet sans couleurs, nom : " .. tostring(lo and lo.msg))
assert(said("Roster : conseil du butin pour " .. LEGS, wmark + 1) and said("chuchote-moi bis, up, os ou transmo", wmark + 1).chatType == "RAID", "conseil annoncé dans le raid")
local offers = Lo.Offers()
assert(#offers == 1 and offers[1].session == sid and offers[1].link == LEGS and offers[1].from == "Kaeldra-Hyjal" and not offers[1].answered, "fenêtre de réponse chez moi aussi")
assert(LU.state.offer.session == sid and LU.state.council.session == sid, "fenêtres de réponse et du conseil ouvertes")
-- Ma réponse : au conseil (Tharok, Brumelune) en privé, avec l'objet porté et son niveau
mark = #S.sent
assert(Lo.Answer(sid, "upgrade", "petit gain ; deux pièces"), "réponse envoyée")
advance(2)
local la = sentMsg("^LA;" .. sid, mark + 1)
assert(la and la.dist == "WHISPER" and la.msg == "LA;" .. sid .. ";upgrade;230001:626;petit gain   deux pièces", "LA chuchoté : " .. tostring(la and la.msg))
local targets = {}
for i = mark + 1, #S.sent do if S.sent[i].msg:find("^LA;") then targets[S.sent[i].target] = true end end
assert(targets["Tharok-Hyjal"] and targets["Brumelune-Ysondre"] and not targets["Kaeldra-Hyjal"] and not targets["Vex-Kael'Thas"], "LA au conseil seulement")
assert(offers[1].answered and #Lo.Offers() == 1 and LU.state.offer.session == nil, "répondu : fenêtre de réponse fermée")
-- Réponses des autres : Tharok (addon), Vex (addon, Off-spec), Mordak chuchote « BIS » (sans addon)
mark = #S.sent
addon("Tharok-Hyjal", "LA;" .. sid .. ";bis;242111:636;BiS pour moi", "WHISPER")
addon("Vex-Kael'Thas", "LA;" .. sid .. ";off;;", "WHISPER")
addon("Orvane-Hyjal", "LA;" .. sid .. ";super;;", "WHISPER")
advance(1)
-- Chef de butin : chaque réponse relayée au raid (le joueur sans les données du site ne connaît pas le conseil)
local rt, rv = sentMsg("^LA;" .. sid .. ";bis;242111:636;BiS pour moi;Tharok%-Hyjal;r$", mark + 1), sentMsg("^LA;" .. sid .. ";off;;;Vex%-Kael'Thas;r$", mark + 1)
assert(rt and rt.dist == "RAID" and rv and rv.dist == "RAID" and not sentMsg("^LA;" .. sid .. ";super", mark + 1), "réponses relayées au raid par le chef de butin")
addon("Kaeldra-Hyjal", rt.msg, "RAID") -- mon relais revenu par le canal du raid : ignoré
mark = #S.sent
fire("CHAT_MSG_WHISPER", " BIS ", "Mordak-Ysondre", "", "", "Mordak-Ysondre")
fire("CHAT_MSG_WHISPER", "salut", "Sylvane-Hyjal", "", "", "Sylvane-Hyjal")
fire("CHAT_MSG_WHISPER", secretValue("whisper"), "Sylvane-Hyjal")
advance(2)
local relay = sentMsg("^LA;" .. sid .. ";bis;;chuchoté;Mordak%-Ysondre$", mark + 1)
assert(relay and relay.dist == "WHISPER", "réponse chuchotée relayée au conseil")
-- Votes : Tharok et Brumelune (conseil), Vex (pas du conseil : ignoré), moi
addon("Tharok-Hyjal", "LV;" .. sid .. ";Tharok-Hyjal", "WHISPER")
addon("Brumelune-Ysondre", "LV;" .. sid .. ";Mordak-Ysondre", "WHISPER")
addon("Brumelune-Ysondre", "LV;" .. sid .. ";Tharok-Hyjal", "WHISPER") -- vote changé
addon("Vex-Kael'Thas", "LV;" .. sid .. ";Vex-Kael'Thas", "WHISPER")
assert(Lo.Vote(sid, "Mordak-Ysondre") and Lo.Vote(sid, "Mordak-Ysondre") and Lo.Council(sid).myVote == nil, "vote retiré")
assert(Lo.Vote(sid, "Tharok-Hyjal"), "mon vote")
local c = Lo.Council(sid)
assert(#c.cands == 4 and c.cands[1].name == "Tharok-Hyjal" and c.cands[1].response == "bis" and c.cands[1].votes == 3 and c.myVote == "Tharok-Hyjal", "conseil : Tharok en tête (BiS, 3 votes)")
assert(c.cands[2].name == "Mordak-Ysondre" and c.cands[2].whispered and c.cands[2].votes == 0, "réponse chuchotée")
assert(c.cands[3].name == "Kaeldra-Hyjal" and c.cands[3].note == "petit gain   deux pièces" and c.cands[3].gear[1].id == 230001 and c.cands[3].gear[1].ilvl == 626, "ma réponse : note, objet porté")
assert(c.cands[4].name == "Vex-Kael'Thas" and c.cands[4].response == "off", "réponse Off-spec")
assert(c.cands[1].gear[1].id == 242111 and c.cands[1].gear[1].ilvl == 636 and c.cands[1].note == "BiS pour moi", "objets portés et note de Tharok")
assert(c.cands[1].receivedSite == 2 and c.cands[1].receivedTonight == 1 and c.cands[1].received == 3, "Reçus : site (N) et ce soir")
assert(c.cands[4].receivedSite == 1 and c.counts.short == "saison", "Reçus : persos d'un même joueur ensemble")
assert(Lo.Counts({ method = "council", response = "bis" }) and Lo.Counts({ method = "roll", detail = "MS 87" }) and Lo.Counts({ method = "ml" }) and Lo.Counts({})
  and not Lo.Counts({ method = "council", response = "transmo" }) and not Lo.Counts({ method = "roll", detail = "OS 54" })
  and not Lo.Counts({ method = "roll", detail = "jet 54" }) and not Lo.Counts({ method = "ml", detail = "gardé" }), "Reçus : même règle que le site")
assert(#c.waiting == 4 and #c.council == 3 and c.isMaster, "en attente : les autres membres")
LU.ShowCouncil(sid)
assert(LU.state.council.rows == 4 and not LU.state.council.closed, "fenêtre du conseil")
-- « Donner » : annonce au raid, chuchotement au gagnant, LC, ligne du bilan
mark, wmark = #S.sent, #S.whispers
logLines = #log.loot
assert(Lo.AwardCouncil(sid, "Tharok-Hyjal"), "objet donné au conseil")
advance(1)
local ann = S.whispers[wmark + 1]
assert(ann and ann.chatType == "RAID" and ann.msg == "Roster : Tharok reçoit " .. LEGS .. " (conseil : BiS)", "annonce au raid : " .. tostring(ann and ann.msg))
local tell = S.whispers[wmark + 2]
assert(tell and tell.chatType == "WHISPER" and tell.target == "Tharok-Hyjal" and tell.msg:find("^Tu reçois " .. LEGS:gsub("%p", "%%%0") .. " : passe me voir pour l'échange %(encore 1 h 5%d min%)%.$"), "chuchoté au gagnant : " .. tostring(tell and tell.msg))
assert(sentMsg("^LC;" .. sid .. ";Tharok%-Hyjal$", mark + 1, "RAID"), "LC au raid")
assert(sentMsg("^LW;" .. legs.key:gsub("%-", "%%-") .. ";242394;Tharok%-Hyjal;council;bis;3 votes$", mark + 1, "RAID"), "LW au raid : les autres relevés notent le gagnant")
assert(legs.status == "awarded" and legs.winner == "Tharok-Hyjal" and legs.method == "council" and legs.detail == "3 votes", "objet attribué")
local line
for _, l in ipairs(log.loot) do if l.id == 242394 and l.awarded then line = l end end
assert(#log.loot == logLines and line and line.who == "Tharok-Hyjal" and line.method == "council" and line.response == "bis" and line.detail == "3 votes", "bilan : la ligne du chef devient celle du gagnant")
assert(Lo.Council(sid).closed and Lo.Council(sid).winner == "Tharok-Hyjal" and #Lo.Offers() == 0, "conseil terminé, réponses fermées")
assert(not Lo.Vote(sid, "Vex-Kael'Thas"), "plus de vote après le conseil")

-- 9e. Jets MS / OS : premier jet de chacun, bon dé, égalité entre ex æquo seulement
mark, wmark = #S.sent, #S.whispers
assert(Lo.StartRoll(trinket.key, "msos") and trinket.status == "roll", "jets MS / OS lancés")
advance(1)
assert(sentMsg("^RS;242397;msos$", mark + 1, "RAID") and said("Roster : jets pour " .. TRINKET .. " : /roll 100 en spé principale (MS), /roll 99 en spé secondaire (OS).", wmark + 1), "RS et annonce")
fire("CHAT_MSG_SYSTEM", "Tharok obtient un 87 (1-100).")
fire("CHAT_MSG_SYSTEM", "Vex-Kael'Thas obtient un 87 (1-100).")
fire("CHAT_MSG_SYSTEM", "Orvane obtient un 95 (1-99).")
fire("CHAT_MSG_SYSTEM", "Tharok obtient un 99 (1-100).")
fire("CHAT_MSG_SYSTEM", "Sylvane obtient un 30 (1-50).")
fire("CHAT_MSG_SYSTEM", "Brumelune-Ysondre obtient un 70 (2-100).")
local r = Lo.Rolls(trinket.key)
assert(#r.rows == 3 and r.tie and #r.winners == 2 and r.rows[3].name == "Orvane-Hyjal" and r.rows[3].kind == "os", "jets : MS d'abord, égalité à 87")
assert(r.rows[1].roll == 87 and r.rows[2].roll == 87, "seul le premier jet de Tharok compte")
assert(not Lo.AwardRoll(trinket.key), "égalité : pas de gagnant")
fire("CHAT_MSG_SYSTEM", secretValue("system"))
assert(Lo.Rolls(trinket.key).hidden, "message secret : jets illisibles signalés")
wmark = #S.whispers
assert(Lo.Reroll(trinket.key), "relance")
assert(said("Roster : égalité pour " .. TRINKET .. " entre Tharok, Vex-Kael'Thas : relancez, /roll 100.", wmark + 1), "relance annoncée")
fire("CHAT_MSG_SYSTEM", "Orvane obtient un 99 (1-100).")
fire("CHAT_MSG_SYSTEM", "Vex-Kael'Thas obtient un 12 (1-100).")
fire("CHAT_MSG_SYSTEM", "Tharok obtient un 45 (1-99).")
fire("CHAT_MSG_SYSTEM", "Tharok obtient un 45 (1-100).")
r = Lo.Rolls(trinket.key)
assert(#r.rows == 2 and not r.tie and r.winners[1] == "Tharok-Hyjal" and #r.previous == 1 and r.round == 2, "relance : seuls les ex æquo, bon dé")
LU.ShowLoot()
assert(LU.state.loot.rolls and LU.state.loot.rolls.winners[1] == "Tharok-Hyjal", "jets dans la fenêtre du butin")
wmark = #S.whispers
assert(Lo.AwardRoll(trinket.key), "donné au gagnant")
assert(S.whispers[wmark + 1].msg == "Roster : Tharok reçoit " .. TRINKET .. " (MS 45)", "annonce : MS 45")
line = nil
for _, l in ipairs(log.loot) do if l.id == 242397 and l.awarded then line = l end end
assert(line and line.who == "Tharok-Hyjal" and line.method == "roll" and line.response == "" and line.detail == "MS 45", "bilan : jets MS")
assert(not Lo.StartRoll(trinket.key, "free") and lastPrinted("déjà attribué"), "objet attribué : plus de jets")

-- 9f. Jet libre, donné d'un clic dans la fenêtre du butin
assert(Lo.StartRoll(cloak.key, "free"), "jet libre")
assert(said("Roster : jet libre pour " .. CLOAK .. " : /roll 100."), "jet libre annoncé")
fire("CHAT_MSG_SYSTEM", "Sylvane obtient un 54 (1-100).")
fire("CHAT_MSG_SYSTEM", "Orvane obtient un 80 (1-99).")
fire("CHAT_MSG_SYSTEM", "Brumelune-Ysondre obtient un 33 (1-100).")
LU.ShowLoot()
wmark = #S.whispers
rawget(TEXTS["Donner à Sylvane"], "scripts").OnClick(TEXTS["Donner à Sylvane"])
assert(cloak.status == "awarded" and cloak.winner == "Sylvane-Hyjal" and cloak.detail == "jet 54", "jet libre donné d'un clic")
assert(S.whispers[wmark + 1].msg == "Roster : Sylvane reçoit " .. CLOAK .. " (jet libre 54)" and S.whispers[wmark + 2].target == "Sylvane-Hyjal", "annonce et chuchotement")

-- 9g. Garder : annoncé, rien de chuchoté, noté « ml » pour moi
wmark = #S.whispers
assert(Lo.Keep(helm.key) and helm.status == "kept", "gardé")
assert(#S.whispers == wmark + 1 and S.whispers[wmark + 1].msg == "Roster : Kaeldra reçoit " .. HELM .. " (gardé)", "annonce : gardé")
line = nil
for _, l in ipairs(log.loot) do if l.id == 242399 and l.awarded then line = l end end
assert(line and line.who == "Kaeldra-Hyjal" and line.method == "ml" and line.detail == "gardé", "bilan : gardé par le chef de butin")
assert(R.IsLead(log) and log.distributed, "bilan du chef de butin")

-- 9h. Échange : jamais en combat, à portée, objet posé à l'ouverture, remis à la fermeture
LU.ShowHandover()
assert(LU.state.handover.items == 3, "objets à remettre : jambières, fiole et cape")
S.combat = true
assert(not Lo.Trade(legs.key) and not S.tradeWith and lastPrinted("pas d'échange en combat"), "pas d'échange en combat")
S.combat = false
S.far = "raid2"
assert(not Lo.Trade(legs.key) and lastPrinted("trop loin"), "trop loin")
S.far = nil
assert(Lo.Trade(legs.key) and S.tradeWith == "raid2", "échange demandé à Tharok (raid2)")
S.tradePartner = findMember("Vex-Kael'Thas")
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(not S.tradeSlots, "échange avec un autre joueur : rien posé")
fire("TRADE_CLOSED")
advance(2)
assert(Lo.Trade(legs.key), "échange redemandé")
S.tradePartner = findMember("Tharok-Hyjal")
fire("TRADE_SHOW")
assert(not S.tradeSlots, "objets posés un instant après l'ouverture (fenêtre prête)")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
-- Tharok a gagné les jambières et la fiole : les deux sont posées
assert(S.tradeSlots and S.tradeSlots[1] == LEGS and S.tradeSlots[2] == TRINKET and S.picked[1] == 1 and S.picked[2] == 5, "objets posés dans les deux premières cases")
assert(lastPrinted("objets posés dans l'échange avec Tharok : " .. LEGS .. ", " .. TRINKET, 1, true), "objets posés : dit dans le chat")
S.bags[0][3], S.bags[1][5], S.tradeSlots = nil, nil, nil -- échange accepté des deux côtés
fire("TRADE_CLOSED")
fire("TRADE_CLOSED")
advance(2)
assert(legs.status == "traded" and trinket.status == "traded" and lastPrinted("remis à Tharok : "), "échange terminé : remis")
LU.ShowHandover()
assert(LU.state.handover.items == 1, "reste la cape")
assert(Lo.MarkTraded(cloak.key) and cloak.status == "traded", "remis à la main")

-- 9i. Pendant une rencontre de boss : attributions et jets refusés, LR gardé puis envoyé
S.bags[3][1] = BOOTS
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. BOOTS .. ".", "", "", "", "")
local boots = Lo.Items()[#Lo.Items()]
startEncounter(3178, "Kith'ix")
wmark = #S.whispers
assert(not Lo.Award(boots.key, "Vex-Kael'Thas", "ml") and lastPrinted("pas pendant un combat de boss : attribue"), "pas d'attribution pendant la rencontre")
assert(not Lo.StartRoll(boots.key, "msos") and not Lo.StartCouncil(boots.key) and #S.whispers == wmark and boots.status == "new", "ni jets ni conseil pendant la rencontre")
mark = #S.sent
S.loot[30] = { link = RING, need = true }
fire("START_LOOT_ROLL", 30, 120000)
assert(Cm.Held() >= 1 and not sentMsg("^LR;", mark + 1), "LR gardé pendant la rencontre")
buildPages(nil)
endEncounter(3178, "Kith'ix", 1)
advance(3)
assert(Cm.Held() == 0 and sentMsg("^LR;242395$", mark + 1, "RAID"), "LR envoyé après la rencontre")
assert(Lo.Award(boots.key, "Vex-Kael'Thas", "ml") and S.whispers[#S.whispers - 1].msg == "Roster : Vex-Kael'Thas reçoit " .. BOOTS .. " (choix du chef de butin)", "donné par le chef de butin après le combat")

-- 9j. Fenêtres dans les deux habillages (l'offre d'un nouveau conseil, le conseil, les objets à remettre)
S.bags[3][2] = RING
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. RING .. ".", "", "", "", "")
local ring = Lo.Items()[#Lo.Items()]
local _, sid2 = Lo.StartCouncil(ring.key)
local function allWindows()
  LU.ShowLoot() LU.ShowCouncil(sid2) LU.ShowOffer() LU.ShowHandover() LU.Refresh()
  assert(LU.state.offer.session == sid2 and LU.state.council.session == sid2, "fenêtres ouvertes")
end
allWindows()
RosterDB.skin = "site"
assert(loadfile("addon/Roster/LootUI.lua"))("Roster", ns)
LU = ns.LootUI
allWindows()
buildPages("site")
RosterDB.skin = nil
assert(Lo.Cancel(ring.key) and ring.status == "new" and #Lo.Offers() == 0, "conseil annulé : réponses fermées")
assert(errors() == 0, "butin sans erreur : " .. tostring(lastPrinted("erreur")))

-- 9k. Raid d'essai (crochets de Test.lua) : membres, messages, chat et échange simulés ; rien dans le bilan ni la sauvegarde
local tsent, tsaid, ttrade = {}, {}, {}
local realItems, realLog, realCalls, realSaid = #RosterDB.loot.items, #log.loot, #S.rollCalls, #S.whispers
Lo.test = {
  members = { { name = "Kaeldra-Hyjal", class = "PRIEST", subgroup = 1 }, { name = "Gorrak-Hyjal", class = "WARRIOR", subgroup = 1 },
    { name = "Mirelle-Hyjal", class = "PRIEST", subgroup = 2, addon = false } },
  send = function(m, dist, target) tsent[#tsent + 1] = { msg = m, dist = dist, target = target } return true end,
  say = function(text, chatType, target) tsaid[#tsaid + 1] = { msg = text, chatType = chatType, target = target } end,
  trade = function(entry) ttrade[#ttrade + 1] = entry end,
}
assert(Lo.IsMaster() and Lo.Enabled() and #Lo.Items() == 0, "essai : chef de butin, liste à part")
local te = Lo.AddTestItem(LEGS, 3600)
assert(te and #Lo.Items() == 1 and te.expires == time() + 3600 and #RosterDB.loot.items == realItems, "essai : objet ajouté en mémoire")
local _, tsid = Lo.StartCouncil(te.key)
assert(tsent[1].msg:find("^LO;" .. tsid) and tsent[1].dist == "RAID" and tsaid[1].chatType == "RAID", "essai : LO et annonce simulés")
Cm.Deliver("Gorrak-Hyjal", "LA;" .. tsid .. ";bis;;", "WHISPER")
Cm.Deliver("Gorrak-Hyjal", "LV;" .. tsid .. ";Gorrak-Hyjal", "WHISPER")
local tc = Lo.Council(tsid)
assert(#tc.cands == 1 and tc.cands[1].votes == 1 and #tc.waiting == 2, "essai : réponse et vote simulés")
assert(Lo.AwardCouncil(tsid, "Gorrak-Hyjal") and te.status == "awarded", "essai : objet donné")
assert(tsaid[#tsaid - 1].msg == "Roster : Gorrak reçoit " .. LEGS .. " (conseil : BiS)" and tsaid[#tsaid].chatType == "WHISPER" and tsaid[#tsaid].target == "Gorrak-Hyjal", "essai : annonce et chuchotement simulés")
assert(#log.loot == realLog and #Lo.testLog.loot == 1 and #S.whispers == realSaid, "essai : rien dans le bilan ni dans le chat")
assert(Lo.Trade(te.key) and ttrade[1] == te, "essai : échange simulé")
local te2 = Lo.AddTestItem(CLOAK)
assert(Lo.StartRoll(te2.key, "free") and Lo.OnRoll("Gorrak-Hyjal", 88, 1, 100) and Lo.Rolls(te2.key).winners[1] == "Gorrak-Hyjal", "essai : jet injecté")
fire("START_LOOT_ROLL", 20, 120000)
assert(#S.rollCalls == realCalls, "essai : pas de RollOnLoot")
Lo.StopTest()
assert(Lo.test == nil and #Lo.Items() == realItems and #Lo.testItems == 0, "fin de l'essai : vraie liste")
assert(errors() == 0, "essai sans erreur : " .. tostring(lastPrinted("erreur")))

--------------------------------------------------------------------------------------------------------------------
-- 10. Retours du raid de test (0.3) : échange ouvert par le gagnant, objets portables, tout au conseil, détail des reçus
--------------------------------------------------------------------------------------------------------------------
-- Dans une fonction : le bloc principal approche la limite de 200 variables locales de Lua 5.1
local function feedback()
-- Objets retirés un à un (la liste change pendant le retrait)
local function clearItems() while #Lo.Items() > 0 do Lo.Remove(Lo.Items()[1].key) end end
clearItems()
findMember("Sylvane-Hyjal").class, findMember("Orvane-Hyjal").class, findMember("Brumelune-Ysondre").class = "HUNTER", "EVOKER", "DRUID"
local function unitOf(full) local _, i = findMember(full) return "raid" .. i end
local function cand(c, name) for _, x in ipairs(c and c.cands or {}) do if x.name == name then return x end end end
local function offerOf(session) for _, o in ipairs(Lo.Offers()) do if o.session == session then return o end end end
local function whisper(text, from) fire("CHAT_MSG_WHISPER", text, from, "", "", from) end
-- Objet reçu par le chef de butin, rangé dans les sacs à la place donnée
local function receive(link, bag, slot, left)
  S.bags[bag][slot] = link
  if left then S.tradeLeft[link] = left end
  fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. link .. ".", "", "", "", "")
  local all = Lo.Items()
  return all[#all]
end

-- 10a. Échange ouvert par le gagnant : ses objets posés sans « Échanger », remis à la fermeture
local BRACERS, GLOVES, BELT = item(242410, "Brassards de la Faille"), item(242411, "Gantelets de Kith'ix"), item(242412, "Ceinture des spores")
local b1, b2, b3 = receive(BRACERS, 4, 1, "1 h 30 min"), receive(GLOVES, 4, 2, "1 h 30 min"), receive(BELT, 4, 3, "1 h 30 min")
assert(b1.bag == 4 and b1.slot == 1 and b3.slot == 3 and #Lo.Items() == 3, "trois objets rangés")
assert(Lo.Award(b1.key, "Vex-Kael'Thas", "ml") and Lo.Award(b2.key, "Vex-Kael'Thas", "ml") and Lo.Award(b3.key, "Sylvane-Hyjal", "ml"), "objets attribués")
local hv = Lo.Handover("Vex-Kael'Thas")
assert(#hv == 2 and hv[1] == b1 and hv[2] == b2 and #Lo.Handover("Sylvane-Hyjal") == 1 and #Lo.Handover("Tharok-Hyjal") == 0, "L.Handover : objets d'un gagnant")
pmark = #printed
S.tradeSlots, S.tradeWith, S.picks = {}, nil, {}
S.tradePartner = findMember("Vex-Kael'Thas") -- Vex ouvre l'échange lui-même
fire("TRADE_SHOW")
assert(not S.tradeSlots[1], "rien avant que la fenêtre soit prête")
advance(0.4)
assert(S.tradeSlots[1] == BRACERS and not S.tradeSlots[2], "un objet à la fois")
advance(0.6)
assert(S.tradeWith == nil and S.tradeSlots[1] == BRACERS and S.tradeSlots[2] == GLOVES and not S.tradeSlots[3], "objets de Vex posés dans les cases libres")
assert(S.picks[1] == "4:1" and S.picks[2] == "4:2" and #S.picks == 2 and S.cursor == nil, "pris dans les sacs, curseur vide")
assert(printedSince(pmark, "objets posés dans l'échange avec Vex-Kael'Thas : " .. BRACERS .. ", " .. GLOVES .. "."), "posés : dit dans le chat")
S.bags[4][1], S.bags[4][2], S.tradeSlots = nil, nil, nil -- échange accepté
fire("TRADE_CLOSED")
fire("TRADE_CLOSED")
advance(2)
assert(b1.status == "traded" and b2.status == "traded" and printedSince(pmark, "remis à Vex-Kael'Thas : " .. BRACERS .. ", " .. GLOVES .. "."), "remis à Vex")
-- Échange annulé : rien ne change
pmark = #printed
S.tradeSlots, S.tradePartner = {}, findMember("Sylvane-Hyjal")
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(S.tradeSlots[1] == BELT, "ceinture posée pour Sylvane")
S.tradeSlots = nil -- annulé : la ceinture reste dans les sacs
fire("TRADE_CLOSED")
advance(2)
assert(b3.status == "awarded" and not printedSince(pmark, "remis à Sylvane"), "échange annulé : rien ne change")
-- Objet déjà dans l'échange (posé à la main) : pas posé deux fois, remis quand même
pmark, S.picks = #printed, {}
S.tradeSlots = { [3] = BELT }
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(#S.picks == 0 and not S.tradeSlots[1] and printedSince(pmark, "objets posés dans l'échange avec Sylvane : " .. BELT), "déjà dans l'échange : rien de plus")
S.bags[4][3], S.tradeSlots = nil, nil
fire("TRADE_CLOSED")
advance(2)
assert(b3.status == "traded" and printedSince(pmark, "remis à Sylvane : " .. BELT), "remis à Sylvane")
-- Deux exemplaires du même objet pour Orvane, sacs triés depuis (places notées périmées) : deux places différentes
local SHARD = item(242413, "Fragment de la Faille")
local t1, t2 = receive(SHARD, 3, 5), receive(SHARD, 3, 6)
assert(t1.slot == 5 and t2.slot == 6, "deux exemplaires, deux places")
Lo.Award(t1.key, "Orvane-Hyjal", "ml") Lo.Award(t2.key, "Orvane-Hyjal", "ml")
S.bags[3][5], S.bags[3][6], S.bags[2][8], S.bags[2][9] = nil, nil, SHARD, SHARD
S.tradeSlots, S.tradePartner, S.picks = {}, findMember("Orvane-Hyjal"), {}
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(#S.picks == 2 and S.picks[1] ~= S.picks[2] and S.picks[1] == "2:8" and S.picks[2] == "2:9" and S.tradeSlots[2] == SHARD, "jamais deux fois la même case des sacs")
S.bags[2][8], S.bags[2][9], S.tradeSlots = nil, nil, nil
fire("TRADE_CLOSED")
advance(2)
assert(t1.status == "traded" and t2.status == "traded", "deux exemplaires remis")
-- Objet introuvable, délai d'échange passé, plus de case libre : pas posés, avec la raison
local CHARM, ORB, IDOL = item(242414, "Breloque de la Faille"), item(242415, "Orbe de Kith'ix"), item(242416, "Idole des spores")
local ch, orb, idol = receive(CHARM, 4, 4), receive(ORB, 4, 5, "10 min"), receive(IDOL, 4, 6)
for _, e in ipairs({ ch, orb, idol }) do Lo.Award(e.key, "Zephyra-Hyjal", "ml") end
S.bags[4][4] = nil -- vendue par erreur
orb.expires = time() - 5
pmark, S.picks = #printed, {}
S.tradeSlots, S.tradePartner = { "a", "b", "c", "d", "e", "f" }, findMember("Zephyra-Hyjal")
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(#S.picks == 0 and printedSince(pmark, IDOL .. " (plus de case libre dans l'échange)") and printedSince(pmark, ORB .. " (délai d'échange passé)"), "échange plein, délai passé")
S.tradeSlots = nil
fire("TRADE_CLOSED")
advance(2)
pmark = #printed
S.tradeSlots = {}
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(printedSince(pmark, "pas posé pour Zephyra : " .. CHARM .. " (introuvable dans tes sacs)") and S.tradeSlots[1] == IDOL, "introuvable : dit ; l'idole posée")
S.tradeSlots = nil
fire("TRADE_CLOSED")
advance(2)
-- En combat : rien n'est pris dans les sacs
pmark, S.picks = #printed, {}
S.tradeSlots, S.combat = {}, true
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(#S.picks == 0 and printedSince(pmark, "en combat : pose les objets"), "combat : rien posé")
S.combat, S.tradeSlots = false, nil
fire("TRADE_CLOSED")
advance(2)
-- Partenaire illisible (valeur secrète) : rien posé, dit
pmark, S.picks = #printed, {}
S.tradePartner = { name = "Zephyra", realm = "Hyjal", secretName = true }
fire("TRADE_SHOW")
advance(1) -- objets posés un à un (0,3 s, puis 0,2 s entre deux)
assert(#S.picks == 0 and printedSince(pmark, "le jeu ne donne pas le nom du partenaire"), "partenaire secret : rien posé")
fire("TRADE_CLOSED")
advance(2)

-- 10b. « Échanger » sans fenêtre : message du jeu (UI_ERROR_MESSAGE), sinon la marche à suivre
local RELIC = item(242417, "Relique de la Faille")
local relic = receive(RELIC, 4, 7)
Lo.Award(relic.key, "Mordak-Ysondre", "ml")
pmark = #printed
assert(Lo.Trade(relic.key) and S.tradeWith == unitOf("Mordak-Ysondre"), "échange demandé à Mordak")
fire("UI_ERROR_MESSAGE", 51, secretValue("UI_ERROR_MESSAGE"))
fire("UI_ERROR_MESSAGE", 50, "Mordak est occupé.")
advance(3)
assert(not printedSince(pmark, "pas de fenêtre"), "on attend la fenêtre 4 s")
advance(2)
assert(printedSince(pmark, "pas de fenêtre d'échange avec Mordak-Ysondre. Le jeu dit : « Mordak est occupé. » Sinon, demande-lui d'ouvrir l'échange"), "sans fenêtre : message du jeu")
pmark = #printed
assert(Lo.Trade(relic.key), "échange redemandé")
advance(5)
assert(printedSince(pmark, "pas de fenêtre d'échange avec Mordak-Ysondre : demande-lui d'ouvrir l'échange avec toi (clic droit sur ton portrait › Échanger), l'objet sera posé tout seul."), "sans fenêtre ni message : la marche à suivre")
fire("UI_ERROR_MESSAGE", 50, "Trop tard.") -- après l'attente : sans effet
-- Distance : refus seulement si le jeu dit vraiment « non » (false), pas pour nil ni une valeur secrète
S.distance = "nil"
assert(Lo.Trade(relic.key), "distance inconnue (nil) : pas de refus")
S.distance = "secret"
assert(Lo.Trade(relic.key), "distance secrète : pas de refus")
S.distance, S.far = nil, unitOf("Mordak-Ysondre")
assert(not Lo.Trade(relic.key) and lastPrinted("trop loin"), "trop loin (false)")
S.far = nil
-- Fenêtre ouverte pendant l'attente : pas de message, objet posé
advance(5)
pmark = #printed
assert(Lo.Trade(relic.key), "échange demandé")
S.tradeSlots, S.tradePartner = {}, findMember("Mordak-Ysondre")
fire("TRADE_SHOW")
advance(5)
assert(S.tradeSlots[1] == RELIC and not printedSince(pmark, "pas de fenêtre"), "fenêtre ouverte : objet posé, pas de message")
local picked = #S.picks
assert(Lo.Trade(relic.key) and #S.picks == picked and not S.tradeSlots[2], "fenêtre déjà ouverte avec lui : rien de plus")
S.tradeSlots = nil
fire("TRADE_CLOSED")
advance(2)
assert(relic.status == "awarded", "annulé : toujours à remettre")

-- 10c. Objets portables : armure du type de la classe, cape pour tous, infobulle (ligne rouge), objet inconnu
local PLATE, CLOTH, CAPE = item(242420, "Cuirasse de la Faille"), item(242421, "Capuche des spores"), item(242422, "Cape des spores")
local POLEARM, CLASSTOKEN = item(242423, "Hallebarde de Kith'ix"), item(242424, "Jeton de Kith'ix")
local UNKNOWN = "|cnIQ4:|Hitem:242425::::::::90:::::|h[Objet pas encore connu]|h|r"
S.armor[242420], S.armor[242421], S.armor[242422] = 4, 1, 1
S.equipLoc[242420], S.equipLoc[242421], S.equipLoc[242422], S.equipLoc[242423] = "INVTYPE_CHEST", "INVTYPE_HEAD", "INVTYPE_CLOAK", "INVTYPE_2HWEAPON"
S.redLine[242423] = { right = "Arme d'hast" }
S.redLine[242424] = { left = "|cffff2020Classes : Guerrier, Paladin, Chevalier de la mort|r" }
local can, why = Lo.CanUse(PLATE)
assert(can == false and why == "armure en plaques : pas ton type d'armure", "prêtre : pas de plaques (" .. tostring(why) .. ")")
assert(Lo.CanUse(CLOTH) == true and Lo.CanUse(CAPE) == true and Lo.CanUse(RING) == true, "tissu, cape, anneau : portables")
can, why = Lo.CanUse(POLEARM)
assert(can == false and why == "Arme d'hast", "arme non maniée : ligne rouge à droite")
can, why = Lo.CanUse(CLASSTOKEN)
assert(can == false and why == "Classes : Guerrier, Paladin, Chevalier de la mort", "jeton d'autres classes : ligne rouge à gauche")
assert(Lo.CanUse(UNKNOWN) == nil, "objet pas encore connu du jeu : nil")
S.unknownItem[242426] = true
assert(Lo.CanUse("item:242426") == nil and Lo.CanUse(nil) == nil, "objet inconnu : nil")
S.equipped[5] = PLATE
assert(Lo.CanUse(PLATE) == false, "règle de l'armure, même pour un objet porté (le jeu ne laisse pas un prêtre porter des plaques)")
S.equipped[5] = nil
S.members[1].class = secretValue("UnitClass")
assert(Lo.CanUse(PLATE) == nil, "classe secrète : nil")
S.members[1].class = "PRIEST"
assert(Lo.CanUseClass(PLATE, "WARRIOR") == true and Lo.CanUseClass(PLATE, "HUNTER") == false and Lo.CanUseClass(CLOTH, "mage") == true, "règle de l'armure d'un autre joueur")
assert(Lo.CanUseClass(CAPE, "WARRIOR") == nil and Lo.CanUseClass(POLEARM, "PRIEST") == nil and Lo.CanUseClass(PLATE, nil) == nil and Lo.CanUseClass(PLATE, "INCONNU") == nil, "règle de l'armure : sans avis")

-- 10d. Ma réponse : BiS / Upgrade / Off-spec refusés sur ce que je ne peux pas porter ; réponse changée
local plate = receive(PLATE, 2, 10, "1 h 50 min")
local _, psid = Lo.StartCouncil(plate.key)
local po = offerOf(psid)
assert(po and po.usable == false and po.reason == "armure en plaques : pas ton type d'armure" and po.num == 1, "proposition : pas portable, avec la raison")
local okA, amsg = Lo.Answer(psid, "bis", "")
assert(okA == false and amsg:find("tu ne peux pas porter " .. PLATE, 1, true) and lastPrinted("réponds Transmo ou Passer"), "BiS refusé")
assert(not Lo.Answer(psid, "upgrade", "") and not Lo.Answer(psid, "off", "") and #Lo.Council(psid).cands == 0, "Upgrade et Off-spec refusés, rien d'envoyé")
assert(Lo.Answer(psid, "transmo", "pour le look") and cand(Lo.Council(psid), "Kaeldra-Hyjal").response == "transmo", "Transmo accepté")
assert(Lo.Answer(psid, "pass", "") and cand(Lo.Council(psid), "Kaeldra-Hyjal").response == "pass" and #Lo.Council(psid).cands == 1, "réponse changée")
-- Proposition d'un objet pas encore connu : nil, recalculé quand le jeu le reçoit
local unk = receive(UNKNOWN, 2, 11)
local _, usid = Lo.StartCouncil(unk.key)
assert(offerOf(usid).usable == nil and offerOf(usid).num == 2, "objet inconnu : on laisse tout")
fire("GET_ITEM_INFO_RECEIVED", secretValue("itemID"), true)
assert(offerOf(usid).usable == nil, "toujours inconnu")
S.items[242425] = UNKNOWN
fire("GET_ITEM_INFO_RECEIVED", 242425, true)
assert(offerOf(usid).usable == true, "objet arrivé : portable")
Lo.Cancel(unk.key)

-- 10e. Règle de l'armure sur les réponses des autres (chef de butin et conseil) : BiS d'un chasseur sur des plaques → Transmo
mark = #S.sent
whisper("bis", "Sylvane-Hyjal")
advance(1)
local xs = cand(Lo.Council(psid), "Sylvane-Hyjal")
assert(xs and xs.response == "transmo" and xs.asked == "bis" and xs.canUse == false and xs.whispered, "chuchoté « bis » d'un chasseur sur des plaques : Transmo")
assert(sentMsg("^LA;" .. psid .. ";transmo;;chuchoté;Sylvane%-Hyjal$", mark + 1, "WHISPER"), "relais au conseil : déjà Transmo")
whisper("os", "Tharok-Hyjal")
local xt = cand(Lo.Council(psid), "Tharok-Hyjal")
assert(xt.response == "off" and xt.canUse == true and not xt.asked, "guerrier : plaques, Off-spec gardé")
mark = #S.sent
addon("Orvane-Hyjal", "LA;" .. psid .. ";upgrade;;vieil addon", "WHISPER") -- addon 0.2 : pas de règle chez lui
advance(1)
local xo = cand(Lo.Council(psid), "Orvane-Hyjal")
assert(xo.response == "transmo" and xo.asked == "upgrade" and xo.canUse == false and xo.note == "vieil addon", "addon 0.2 : Upgrade d'un évocateur sur des plaques → Transmo, note gardée")
assert(sentMsg("^LA;" .. psid .. ";transmo;;vieil addon;Orvane%-Hyjal;r$", mark + 1, "RAID"), "relayé au raid en Transmo")
addon("Zephyra-Hyjal", "LA;" .. psid .. ";transmo;;", "WHISPER")
assert(cand(Lo.Council(psid), "Zephyra-Hyjal").response == "transmo" and cand(Lo.Council(psid), "Zephyra-Hyjal").canUse == false, "Transmo d'un druide : inchangé, signalé")
-- Membre du conseil (Tharok chef de butin) : la réponse relayée est jugée chez moi aussi
assert(Lo.SetMaster("Tharok-Hyjal"), "Tharok chef de butin")
addon("Tharok-Hyjal", "LO;88001;" .. F.ItemString(PLATE) .. ";Cuirasse de la Faille")
assert(Lo.Council("88001") and offerOf("88001").num == 2, "conseil de Tharok : numéro chez moi")
addon("Tharok-Hyjal", "LA;88001;bis;;chuchoté;Sylvane-Hyjal", "WHISPER")
addon("Tharok-Hyjal", "LA;88001;bis;;;Mordak-Ysondre;r", "RAID")
local mc = Lo.Council("88001")
assert(cand(mc, "Sylvane-Hyjal").response == "transmo" and cand(mc, "Mordak-Ysondre").response == "bis", "conseil : règle de l'armure appliquée chez moi aussi")
addon("Tharok-Hyjal", "LC;88001;Mordak-Ysondre")
assert(Lo.SetMaster(nil) and Lo.IsMaster(), "de nouveau chef de butin")
Lo.Cancel(plate.key)
advance(2)

-- 10f. Tout au conseil : un LO par objet, une seule annonce (découpée si longue), numéros, chuchotements « bis 2 »
clearItems()
local long = {}
for i = 1, 4 do
  long[i] = receive(item(242430 + i, "Objet au nom vraiment très long de la Faille de Sporefall n° " .. i, "4:6652:10354:10373:1540"), 1, 10 + i, "1 h 40 min")
end
local keep = receive(item(242435, "Bague de la Faille"), 1, 15)
keep.status = "kept" -- déjà gardée : pas proposée
mark, wmark = #S.sent, #S.whispers
local nAll, sessions = Lo.StartAllCouncils()
advance(15) -- file des messages : 10 d'affilée, puis 1 par seconde
assert(nAll == 4 and #sessions == 4 and long[1].session == sessions[1] and long[4].session == sessions[4] and keep.status == "kept", "tout au conseil : 4 objets")
local los = 0
for i = mark + 1, #S.sent do if S.sent[i].msg:find("^LO;") and S.sent[i].dist == "RAID" then los = los + 1 end end
assert(los == 4, "un LO par objet : " .. los)
local ann = {}
for i = wmark + 1, #S.whispers do if S.whispers[i].chatType == "RAID" then ann[#ann + 1] = S.whispers[i].msg end end
local whole = table.concat(ann, " ")
assert(#ann >= 2, "annonce longue découpée : " .. #ann .. " messages")
for _, m in ipairs(ann) do assert(#m <= 255, "message de 255 octets au plus : " .. #m) end
assert(ann[1]:find("^Roster : conseil du butin, 4 objets : 1 |cnIQ4:") and whole:find("1 " .. long[1].link, 1, true) and whole:find("4 " .. long[4].link .. ".", 1, true)
  and ann[#ann]:find("chuchote%-moi bis, up, os ou transmo suivi du numéro %(« bis 2 »%)%.$"), "une seule annonce numérotée : " .. whole)
local nlinks = 0
for _ in whole:gmatch("|Hitem:") do nlinks = nlinks + 1 end
assert(nlinks == 4 and not whole:find("Bague", 1, true), "chaque lien entier, une fois")
assert(LU.state.council.session == sessions[1], "fenêtre du conseil sur le premier objet")
local offs = Lo.Offers()
assert(#offs == 4 and offs[1].num == 1 and offs[4].num == 4 and offs[2].session == sessions[2], "propositions numérotées chez moi")
-- Chuchotements avec numéro
whisper("up 2", "Tharok-Hyjal")
whisper("3 BIS", "Mordak-Ysondre")
whisper("os #4", "Vex-Kael'Thas")
whisper("bis4", "Zephyra-Hyjal")
assert(cand(Lo.Council(sessions[2]), "Tharok-Hyjal").response == "upgrade" and cand(Lo.Council(sessions[3]), "Mordak-Ysondre").response == "bis", "« up 2 », « 3 bis »")
assert(cand(Lo.Council(sessions[4]), "Vex-Kael'Thas").response == "off" and cand(Lo.Council(sessions[4]), "Zephyra-Hyjal").response == "bis", "« os #4 », « bis4 »")
assert(not cand(Lo.Council(sessions[1]), "Tharok-Hyjal") and not cand(Lo.Council(sessions[3]), "Tharok-Hyjal"), "seul l'objet visé")
-- Sans numéro, plusieurs conseils : rappel chuchoté une fois par lot ; numéro inconnu : rappel aussi
wmark = #S.whispers
whisper("bis", "Brumelune-Ysondre")
whisper("transmo", "Brumelune-Ysondre")
local reminders = 0
for i = wmark + 1, #S.whispers do if S.whispers[i].target == "Brumelune-Ysondre" then reminders = reminders + 1 assert(S.whispers[i].msg == Lo.REMIND and S.whispers[i].chatType == "WHISPER") end end
assert(reminders == 1, "rappel une fois : " .. reminders)
for i = 1, 4 do assert(not cand(Lo.Council(sessions[i]), "Brumelune-Ysondre"), "sans numéro : pas de réponse") end
whisper("bis 9", "Sylvane-Hyjal")
assert(said("Pas d'objet n° 9 au conseil", wmark + 1).target == "Sylvane-Hyjal", "numéro inconnu : rappel")
whisper("salut 2", "Orvane-Hyjal")
assert(not cand(Lo.Council(sessions[2]), "Orvane-Hyjal") and (not said("Précise", wmark + 1) or said("Précise", wmark + 1).target ~= "Orvane-Hyjal"), "pas une réponse : ignoré")
-- Pendant le verrou du chat : pas de rappel (et pas noté : il partira au chuchotement suivant)
S.lockdown = true
whisper("bis", "Orvane-Hyjal")
S.lockdown = false
advance(4)
assert(not said("Précise", wmark + 1) or said("Précise", wmark + 1).target ~= "Orvane-Hyjal", "verrou du chat : pas de rappel")
whisper("bis", "Orvane-Hyjal")
assert(said("Précise", wmark + 1).target == "Orvane-Hyjal", "rappel après le verrou")
-- Liste des conseils (bande d'objets) et mon vote
assert(Lo.Vote(sessions[2], "Tharok-Hyjal"), "vote")
-- Conseils de moins de 2 h (les précédents, terminés ou annulés, compris), dans l'ordre de proposition
local all, cl = Lo.Councils(), {}
for pos, x in ipairs(all) do for i, sid in ipairs(sessions) do if x.session == sid then cl[i], x.pos = x, pos end end end
assert(#all == 7 and all[1].session == psid and all[1].closed and all[2].session == usid and all[3].session == "88001" and not all[3].isMaster, "Councils : tous ceux de moins de 2 h")
assert(cl[1].pos == 4 and cl[4].pos == 7 and cl[1].num == 1 and cl[4].num == 4 and cl[2].link == long[2].link, "Councils : ordre de proposition et numéros")
assert(cl[2].answers == 1 and cl[2].waiting == #Lo.Members() - 1 and cl[2].myVote == "Tharok-Hyjal" and not cl[2].closed and cl[2].isMaster and cl[1].myVote == nil, "Councils : réponses, attente, mon vote")
assert(Lo.Council(sessions[3]).num == 3, "Council : numéro")
-- Un conseil de plus : numéro suivant, annonce numérotée
local ring2 = receive(item(242436, "Anneau de Kith'ix"), 1, 16)
wmark = #S.whispers
local _, s5 = Lo.StartCouncil(ring2.key)
assert(Lo.Council(s5).num == 5 and said("Roster : conseil du butin, objet 5 : " .. ring2.link .. ". Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo suivi du numéro (« bis 5 »).", wmark + 1), "conseil de plus : n° 5")
-- Un conseil terminé garde son numéro ; plus aucun conseil ouvert : la numérotation repart de 1, les rappels aussi
assert(Lo.AwardCouncil(sessions[2], "Tharok-Hyjal") and Lo.Councils()[cl[2].pos].closed and Lo.Councils()[cl[2].pos].winner == "Tharok-Hyjal", "conseil 2 terminé")
whisper("bis 3", "Sylvane-Hyjal")
assert(cand(Lo.Council(sessions[3]), "Sylvane-Hyjal") and cand(Lo.Council(sessions[3]), "Sylvane-Hyjal").response == "bis", "les autres numéros ne bougent pas")
for _, e in ipairs({ long[1], long[3], long[4], ring2 }) do Lo.Cancel(e.key) end
assert(#Lo.Offers() == 0, "tout annulé")
wmark = #S.whispers
local _, s1 = Lo.StartCouncil(long[1].key)
assert(Lo.Council(s1).num == 1 and said("Roster : conseil du butin pour " .. long[1].link .. ". Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo.", wmark + 1), "repart de 1, forme courte")
whisper("transmo", "Brumelune-Ysondre")
assert(cand(Lo.Council(s1), "Brumelune-Ysondre").response == "transmo", "un seul conseil : sans numéro, valable")
Lo.StartCouncil(long[3].key)
wmark = #S.whispers
whisper("bis", "Brumelune-Ysondre")
assert(said(Lo.REMIND, wmark + 1).target == "Brumelune-Ysondre", "nouveau lot : rappel de nouveau")
-- Chef de butin seulement ; pas pendant le verrou du chat ; rien à proposer
for _, e in ipairs({ long[1], long[3] }) do Lo.Cancel(e.key) end
S.lockdown = true
assert(select(1, Lo.StartAllCouncils()) == 0 and long[1].status == "new" and lastPrinted("pas pendant un combat de boss"), "verrou du chat : pas de conseil")
S.lockdown = false
advance(4)
assert(Lo.SetMaster("Tharok-Hyjal") and select(1, Lo.StartAllCouncils()) == 0 and lastPrinted("seul le chef de butin lance le conseil") and long[1].status == "new", "pas chef de butin : pas de conseil")
assert(Lo.SetMaster(nil) and Lo.IsMaster(), "de nouveau chef de butin")
clearItems()
assert(select(1, Lo.StartAllCouncils()) == 0 and lastPrinted("aucun objet à proposer"), "tout au conseil : plus rien")
advance(2)

-- 10g. Colonne « Reçus » : ligne D du site + ce soir (BiS · Upgrade · Jets MS) ; Off-spec, Transmo, OS, jet libre et
-- objet gardé jamais comptés, par tous les chemins (chef de butin, LW, relevé sans méthode, butin de groupe, chuchoté)
ok, msg = D.Load(table.concat({
  "RRG;1;g1;" .. BASE .. ";Les Veilleurs",
  "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "L;" .. RAID_ID .. ";Kaeldra-Hyjal,Tharok-Hyjal,Brumelune-Ysondre",
  "N;saison;depuis le 05/11/2026;Tharok-Hyjal:5,Vex-Kael'Thas+Ilyra-Hyjal:2,Sylvane-Hyjal:1",
  "D;Tharok-Hyjal:2:1:1,Mordak-Ysondre:1:0:2",
  "END;1",
}, "\n"))
assert(ok, "données du site avec D : " .. tostring(msg))
assert(Lo.Category({ method = "council", response = "bis" }) == "bis" and Lo.Category({ method = "council", response = "upgrade" }) == "up"
  and Lo.Category({ method = "roll", detail = "MS 87" }) == "ms" and Lo.Category({ method = "council", response = "off" }) == nil
  and Lo.Category({ method = "roll", detail = "OS 54" }) == nil and Lo.Category({ method = "ml" }) == nil and Lo.Category({}) == nil and Lo.Category(nil) == nil, "L.Category")
local function recv(name) local s, t, _, d = Lo.Received(name) return s, t, d end
local s0, n0, d0 = recv("Mordak-Ysondre")
assert(s0 == 3 and d0.bis >= 1 and d0.ms >= 2, "ligne D sans entrée N : entrée créée (total = somme)")
local sT, tT, dT = recv("Tharok-Hyjal")
assert(sT == 5, "N : Tharok 5")
local sV, _, dV = recv("Vex-Kael'Thas")
assert(sV == 2 and dV.bis == 0 and dV.up == 0, "entrée N sans D : 0")
-- Chemin 1 : attribution par le chef de butin
local nextItem = 0
local function won(name, method, response, detail)
  local id = 242440 + nextItem
  nextItem = nextItem + 1
  local e = receive(item(id, "Objet " .. id), 0, 1)
  S.bags[0][1] = nil
  assert(e and Lo.Award(e.key, name, method, response, detail), "attribué : " .. tostring(detail))
  return e
end
local s1b, t1b, d1b = recv("Brumelune-Ysondre")
local mine0 = select(2, recv("Kaeldra-Hyjal"))
won("Brumelune-Ysondre", "council", "off", "1 vote")
won("Brumelune-Ysondre", "council", "transmo", "0 vote")
won("Brumelune-Ysondre", "roll", nil, "OS 54")
won("Brumelune-Ysondre", "roll", nil, "jet 54")
assert(Lo.Keep(receive(item(242460, "Objet gardé"), 0, 2).key), "gardé")
assert(select(2, recv("Brumelune-Ysondre")) == t1b and select(2, recv("Kaeldra-Hyjal")) == mine0, "Off-spec, Transmo, OS, jet libre, gardé : jamais comptés")
local raw = receive(item(242461, "Pas encore distribué"), 0, 3)
assert(select(2, recv("Kaeldra-Hyjal")) == mine0, "objet du chef de butin pas encore distribué : pas compté")
won("Brumelune-Ysondre", "council", "bis", "2 votes")
won("Brumelune-Ysondre", "council", "upgrade", "1 vote")
won("Brumelune-Ysondre", "roll", nil, "MS 87")
won("Brumelune-Ysondre", "ml", nil, "")
local _, t1c, d1c = recv("Brumelune-Ysondre")
assert(t1c == t1b + 4 and d1c.bis == d1b.bis + 1 and d1c.up == d1b.up + 1 and d1c.ms == d1b.ms + 1, "BiS, Upgrade, MS et choix du chef : comptés (" .. t1c - t1b .. ")")
-- Réponse chuchotée « os » / « transmo » puis « Donner » : pas comptée
local wo = receive(item(242462, "Objet chuchoté"), 0, 4)
local _, wsid = Lo.StartCouncil(wo.key)
whisper("os", "Brumelune-Ysondre")
assert(Lo.AwardCouncil(wsid, "Brumelune-Ysondre") and wo.response == "off", "réponse chuchotée Off-spec donnée")
local wt = receive(item(242463, "Objet chuchoté 2"), 0, 5)
local _, wsid2 = Lo.StartCouncil(wt.key)
whisper("transmo", "Brumelune-Ysondre")
assert(Lo.AwardCouncil(wsid2, "Brumelune-Ysondre") and wt.response == "transmo", "réponse chuchotée Transmo donnée")
assert(select(2, recv("Brumelune-Ysondre")) == t1c, "réponses chuchotées Off-spec / Transmo : pas comptées")
-- Détail dans le conseil
local wb = receive(item(242464, "Objet au conseil"), 0, 6)
local _, bsid = Lo.StartCouncil(wb.key)
whisper("bis", "Mordak-Ysondre")
whisper("up", "Tharok-Hyjal")
local xc = cand(Lo.Council(bsid), "Tharok-Hyjal")
assert(xc.receivedBis == dT.bis and xc.receivedUp == dT.up and xc.receivedMs == dT.ms and xc.received == xc.receivedSite + xc.receivedTonight, "Council : détail des reçus")
Lo.Cancel(wb.key)
-- Chemin 2 : LW chez un autre relevé (Tharok chef de butin) ; objets du chef de butin pas encore distribués : pas comptés
assert(Lo.SetMaster("Tharok-Hyjal"), "Tharok chef de butin")
local _, tz0 = recv("Zephyra-Hyjal")
local _, tth0 = recv("Tharok-Hyjal")
for i, d in ipairs({ { "council", "off", "1 vote" }, { "council", "transmo", "" }, { "roll", "", "OS 12" }, { "roll", "", "jet 33" } }) do
  fire("CHAT_MSG_LOOT", "Tharok-Hyjal reçoit le butin : " .. item(242470 + i, "Objet LW " .. i) .. ".", "", "", "", "")
  assert(select(2, recv("Tharok-Hyjal")) == tth0, "ramassé par le chef de butin : pas compté")
  addon("Tharok-Hyjal", "LW;k" .. i .. ";" .. (242470 + i) .. ";Zephyra-Hyjal;" .. d[1] .. ";" .. d[2] .. ";" .. d[3])
end
fire("CHAT_MSG_LOOT", "Tharok-Hyjal reçoit le butin : " .. item(242475, "Objet LW gardé") .. ".", "", "", "", "")
addon("Tharok-Hyjal", "LW;k5;242475;Tharok-Hyjal;ml;;gardé")
assert(select(2, recv("Zephyra-Hyjal")) == tz0 and select(2, recv("Tharok-Hyjal")) == tth0, "LW : Off-spec, Transmo, OS, jet libre, gardé jamais comptés")
fire("CHAT_MSG_LOOT", "Tharok-Hyjal reçoit le butin : " .. item(242476, "Objet LW BiS") .. ".", "", "", "", "")
addon("Tharok-Hyjal", "LW;k6;242476;Zephyra-Hyjal;council;bis;3 votes")
local _, tz1, dz1 = recv("Zephyra-Hyjal")
assert(tz1 == tz0 + 1 and dz1.bis >= 1, "LW : BiS compté")
-- Chemin 3 : ligne du relevé sans méthode (objet seulement noté) : compte, sans catégorie
local _, to0, do0 = recv("Orvane-Hyjal")
fire("CHAT_MSG_LOOT", "Orvane-Hyjal reçoit le butin : " .. item(242477, "Objet noté") .. ".", "", "", "", "")
local _, to1, do1 = recv("Orvane-Hyjal")
assert(to1 == to0 + 1 and do1.bis == do0.bis and do1.up == do0.up and do1.ms == do0.ms, "objet seulement noté : compte, sans catégorie")
assert(Lo.SetMaster(nil) and Lo.IsMaster(), "de nouveau chef de butin")
-- Chemin 4 : objet gagné au butin de groupe par un joueur qui n'a pas passé : noté, compte (même règle que le site)
local _, ts0 = recv("Sylvane-Hyjal")
S.loot[40] = { link = item(242478, "Objet de groupe"), need = true }
fire("START_LOOT_ROLL", 40, 120000)
fire("CHAT_MSG_LOOT", "Sylvane-Hyjal reçoit le butin : " .. S.loot[40].link .. ".", "", "", "", "")
assert(Lo.NotPassed()[#Lo.NotPassed()].name == "Sylvane-Hyjal" and select(2, recv("Sylvane-Hyjal")) == ts0 + 1, "butin de groupe gagné sans passer : compté comme objet noté")
-- Raid d'essai : objets reçus avec détail, échange ouvert par un gagnant fictif, règle de l'armure en option
Lo.Remove(raw.key)
local shown = {}
Lo.test = {
  members = { { name = "Kaeldra-Hyjal", class = "PRIEST" }, { name = "Gorrak-Hyjal", class = "WARRIOR" }, { name = "Lyra-Hyjal", class = "MAGE" } },
  counts = { short = "saison", label = "saison", entries = { { names = { "Gorrak-Hyjal" }, n = 4, bis = 2, up = 1, ms = 1 }, { names = { "Lyra-Hyjal" }, n = 1 } } },
  send = function() return true end, say = function() end, trade = function() end,
  tradeShow = function(partner, list) shown[#shown + 1] = { partner = partner, n = #list } end,
}
local sg, tg, _, dg = Lo.Received("Gorrak-Hyjal")
local _, _, _, dl = Lo.Received("Lyra-Hyjal")
assert(sg == 4 and tg == 0 and dg.bis == 2 and dg.up == 1 and dg.ms == 1 and dl.bis == 0 and dl.ms == 0, "essai : test.counts avec détail")
local te3 = Lo.AddTestItem(PLATE, 3600)
local _, tsid3 = Lo.StartCouncil(te3.key)
Cm.Deliver("Lyra-Hyjal", "LA;" .. tsid3 .. ";bis;;", "WHISPER")
assert(cand(Lo.Council(tsid3), "Lyra-Hyjal").response == "bis", "essai : règle de l'armure coupée par défaut")
Lo.test.armorRule = true
Cm.Deliver("Lyra-Hyjal", "LA;" .. tsid3 .. ";bis;;", "WHISPER")
assert(cand(Lo.Council(tsid3), "Lyra-Hyjal").response == "transmo", "essai : règle de l'armure si test.armorRule")
assert(Lo.Award(te3.key, "Gorrak-Hyjal", "council", "bis", "1 vote"), "essai : donné")
S.picks = {}
fire("TRADE_SHOW") -- vrai échange pendant l'essai : ignoré
assert(#shown == 0 and #S.picks == 0, "essai : vrai échange ignoré")
Lo.OnTradeShow("Gorrak-Hyjal")
assert(#shown == 1 and shown[1].partner == "Gorrak-Hyjal" and shown[1].n == 1 and lastPrinted("objets posés dans l'échange avec Gorrak %(raid d'essai%)"), "essai : crochet tradeShow")
assert(Lo.CanUse(PLATE) == false, "essai : ma classe du jeu (prêtre)")
Lo.StopTest()
fire("TRADE_CLOSED")
clearItems()
advance(2)
assert(errors() == 0, "retours du raid de test sans erreur : " .. tostring(lastPrinted("erreur")))
end
feedback()

--------------------------------------------------------------------------------------------------------------------
-- 7. Valeurs secrètes renvoyées par le jeu : rien ne casse, rien n'est gardé
--------------------------------------------------------------------------------------------------------------------
findMember("Mordak-Ysondre").secretName = true
S.instance.secret = true
fire("CHAT_MSG_ADDON", "RosterRT", "VR;0.1.0", "RAID", secretValue("sender"))
fire("CHAT_MSG_ADDON", secretValue("prefix"), "VR;0.1.0", "RAID", "Mordak-Ysondre")
fire("ENCOUNTER_END", 3178, secretValue("encounterName"), 15, 20, 0, {})
fire("ENCOUNTER_END", secretValue("encounterID"), "Boss", 15, 20, secretValue("success"), {})
fire("ADDON_RESTRICTION_STATE_CHANGED", 1, secretValue("state"))
advance(120)
Cm.Rows() Co.Status()
P.Refresh("enraid") P.Refresh("compo") P.Refresh("raids")
assert(log.encounters[#log.encounters].id == 3178 and log.encounters[#log.encounters].name == "", "nom de boss secret : vide")
local function noSecret(t, path, seen)
  seen = seen or {}
  if seen[t] then return end
  seen[t] = true
  for k, v in pairs(t) do
    assert(not secrets[k] and not secrets[v], "valeur secrète gardée : " .. path .. "." .. tostring(k))
    if type(v) == "table" then noSecret(v, path .. "." .. tostring(k), seen) end
  end
end
noSecret(RosterDB, "RosterDB")
-- Membre pas encore dans le cache du jeu (« Unknown ») : ignoré
findMember("Mordak-Ysondre").secretName, findMember("Mordak-Ysondre").unknown = nil, true
advance(60)
assert(not log.people.Unknown and not log.people["Unknown-Hyjal"], "« Unknown » ignoré")
findMember("Mordak-Ysondre").unknown = nil
S.instance.secret = nil
-- Groupe hors raid avec un nom secret (UnitFullName)
assert(errors() == 0, "valeurs secrètes sans erreur : " .. tostring(lastPrinted("erreur")))

--------------------------------------------------------------------------------------------------------------------
-- 8. Fin du raid, relevé coupé, compo effacée 12 h après
--------------------------------------------------------------------------------------------------------------------
S.raid = false
S.members = { S.members[1], { name = "Tharok", realm = "Hyjal", class = "WARRIOR", subgroup = 1, secretName = true } }
rosterUpdate()
advance(61)
assert(not R.IsRecording() and lastPrinted("relevé du raid terminé"), "relevé terminé en quittant le raid")
assert(#Cm.Roster() == 2 and Cm.Roster()[2].name == nil, "groupe : nom secret ignoré")
P.Refresh("enraid") P.Refresh("compo")
S.members = { S.members[1] }
RosterDB.record = false
S.raid = true
advance(61)
assert(not R.IsRecording(), "relevé coupé dans les options")
-- Retour dans le raid : relevé repris ; groupe gardé toute la nuit : arrêté 6 h après l'heure prévue
RosterDB.record = nil
advance(61)
assert(R.IsRecording() and lastPrinted("relevé du raid repris"), "relevé repris")
advance(T + 6 * 3600 + 120 - clock)
assert(not R.IsRecording() and lastPrinted("6 h après l'heure prévue"), "relevé arrêté 6 h après l'heure du raid")
S.raid, RosterDB.record = false, nil
assert(Co.Get(), "compo gardée pendant le raid")
advance(T + 12 * 3600 + 60 - clock)
assert(Co.Get() == nil and RosterDB.compo == nil, "compo effacée 12 h après l'heure du raid")
Co.Clear()
buildPages(nil)
buildPages("site")
assert(errors() == 0, "fin sans erreur : " .. tostring(lastPrinted("erreur")))
assert(#reassigned == 0, "variables de Blizzard réassignées par l'addon : " .. table.concat(reassigned, ", "))
print = function(...) io.stdout:write(table.concat({ ... }, " "), "\n") end
print("roster_sim : tout est bon" .. (#stubbed > 0 and (" (socle simulé : " .. table.concat(stubbed, ", ") .. ")") or ""))
