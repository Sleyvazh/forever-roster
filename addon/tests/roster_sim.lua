-- Simulation de l'API de WoW Retail (12.x) pour l'addon Roster : lua5.1 addon/tests/roster_sim.lua (depuis la racine du dépôt).
-- Charge les fichiers de addon/Roster/Roster.toc dans l'ordre (addon/Roster, sinon addon/shared). Les fichiers du socle
-- (Core.lua, UI.lua, Minimap.lua) absents sont remplacés par une version minimale du contrat entre les deux moitiés de l'addon ;
-- Test.lua (raid d'essai) absent est ignoré.
-- Scénario : données du site, invitations, placement, versions, file des messages pendant un boss, relevé du raid, bilan,
-- distribution du butin (section 9 : chef de butin, passer automatique, conseil, jets, échange, raid d'essai), retours
-- du raid de test (section 10 : échange ouvert par le gagnant, objets portables, tout au conseil, détail des reçus), pages
-- et fenêtres dans les deux habillages, valeurs secrètes. Échoue au premier problème.
-- Textes de l'interface (addon/tests/locale_audit.lua) ; langue du client : WOW_LOCALE (frFR par défaut)
LOCALE_AUDIT = dofile("addon/tests/locale_audit.lua")
function GetLocale() return os.getenv("WOW_LOCALE") or "frFR" end
local printed = {}
local verbose = os.getenv("ROSTER_SIM_VERBOSE") -- messages de l'addon affichés au fil de l'eau
function print(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end
  printed[#printed + 1] = table.concat(t, " ") LOCALE_AUDIT.show(printed[#printed])
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
    if k == "SetText" then return function(self, v) self.text = v if v then TEXTS[v] = self LOCALE_AUDIT.show(v) end end end
    if k == "AddLine" or k == "AddDoubleLine" then return function(_, x, y) LOCALE_AUDIT.show(x) LOCALE_AUDIT.show(y) end end
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
  -- objets que le jeu ne connaît pas du tout ; classe et sous-classe d'un objet qui n'est pas une armure à type (armes :
  -- classe 2 et Enum.ItemWeaponSubclass, bouclier : classe 4 et sous-classe 6)
  armor = {}, redLine = {}, unknownItem = {}, itemClass = {}, itemSub = {},
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
  IsInGuild = function() return S.guild == true end,
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
      return id, a and "Armure" or "Divers", a and ({ "Tissu", "Cuir", "Mailles", "Plaques" })[a] or "Divers", S.equipLoc[id] or "", 1234, S.itemClass[id] or (a and 4 or 15), a or S.itemSub[id] or 0
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
      -- Autres joueurs simulés (section 11 : partage des données du site), en guilde, en raid ou chuchotés
      if S.bus and (dist == "GUILD" or dist == "RAID" or dist == "WHISPER") then S.bus(msg, dist, target) end
      if dist == "GUILD" and S.guild then schedule(0.01, function() fire("CHAT_MSG_ADDON", prefix, msg, dist, "Kaeldra-Hyjal") end) end
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
      LOCALE_AUDIT.show(msg)
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
LOCALE_AUDIT.install(ns)
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
local THROWN = item(242427, "Hachette de lancer de Kith'ix")
local UNKNOWN = "|cnIQ4:|Hitem:242425::::::::90:::::|h[Objet pas encore connu]|h|r"
S.armor[242420], S.armor[242421], S.armor[242422] = 4, 1, 1
S.equipLoc[242420], S.equipLoc[242421], S.equipLoc[242422], S.equipLoc[242423] = "INVTYPE_CHEST", "INVTYPE_HEAD", "INVTYPE_CLOAK", "INVTYPE_2HWEAPON"
S.itemClass[242423], S.itemSub[242423] = 2, 6 -- arme d'hast
S.itemClass[242427], S.itemSub[242427], S.equipLoc[242427] = 2, 16, "INVTYPE_THROWN" -- arme de jet (type disparu : pas de règle)
S.redLine[242423] = { right = "Arme d'hast" }
S.redLine[242427] = { right = "Armes de jet" }
S.redLine[242424] = { left = "|cffff2020Classes : Guerrier, Paladin, Chevalier de la mort|r" }
local can, why = Lo.CanUse(PLATE)
assert(can == false and why == "armure en plaques : pas ton type d'armure", "prêtre : pas de plaques (" .. tostring(why) .. ")")
assert(Lo.CanUse(CLOTH) == true and Lo.CanUse(CAPE) == true and Lo.CanUse(RING) == true, "tissu, cape, anneau : portables")
can, why = Lo.CanUse(POLEARM)
assert(can == false and why == "arme d'hast : pas pour ta classe", "arme d'hast pour un prêtre : règle des armes, avant l'infobulle (" .. tostring(why) .. ")")
can, why = Lo.CanUse(THROWN)
assert(can == false and why == "Armes de jet", "arme sans règle : ligne rouge à droite de l'infobulle")
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
assert(Lo.CanUseClass(CAPE, "WARRIOR") == nil and Lo.CanUseClass(CLASSTOKEN, "PRIEST") == nil and Lo.CanUseClass(PLATE, nil) == nil and Lo.CanUseClass(PLATE, "INCONNU") == nil, "règle de l'armure : sans avis")

-- 10c bis. Règle des armes (retours du raid du 11/10/2026) : type d'arme, bouclier, objet tenu en main gauche ; pas
-- d'avis quand ce n'est pas sûr
local MACE2, STAFF, SHIELD, FRILL = item(242450, "Maillet de Kith'ix"), item(242451, "Bâton des spores"), item(242452, "Rempart de la Faille"), item(242453, "Orbe des spores")
local BOW, DAGGER, GLAIVE, WAND = item(242454, "Arc de la Faille"), item(242455, "Dague des spores"), item(242456, "Glaive de Kith'ix"), item(242457, "Baguette des spores")
local FISHPOLE = item(242458, "Canne à pêche de la Faille")
for id, cs in pairs({ [242450] = { 2, 5, "INVTYPE_2HWEAPON" }, [242451] = { 2, 10, "INVTYPE_2HWEAPON" }, [242452] = { 4, 6, "INVTYPE_SHIELD" },
  [242453] = { 4, 0, "INVTYPE_HOLDABLE" }, [242454] = { 2, 2, "INVTYPE_RANGED" }, [242455] = { 2, 15, "INVTYPE_WEAPON" },
  [242456] = { 2, 9, "INVTYPE_WEAPON" }, [242457] = { 2, 19, "INVTYPE_RANGEDRIGHT" }, [242458] = { 2, 20, "INVTYPE_2HWEAPON" } }) do
  S.itemClass[id], S.itemSub[id], S.equipLoc[id] = cs[1], cs[2], cs[3]
end
-- Moi (prêtre) : bâton, dague, baguette, objet tenu en main gauche oui ; masse à deux mains, bouclier, arc, glaive non
assert(Lo.CanUse(STAFF) == true and Lo.CanUse(DAGGER) == true and Lo.CanUse(WAND) == true and Lo.CanUse(FRILL) == true, "prêtre : bâton, dague, baguette, main gauche")
for _, x in ipairs({ { MACE2, "masse à deux mains" }, { SHIELD, "bouclier" }, { BOW, "arc" }, { GLAIVE, "glaive de guerre" } }) do
  can, why = Lo.CanUse(x[1])
  assert(can == false and why == x[2] .. " : pas pour ta classe", "prêtre : " .. x[2] .. " refusé (" .. tostring(why) .. ")")
end
assert(Lo.CanUse(FISHPOLE) == true, "canne à pêche : pas de règle, l'infobulle décide")
S.members[1].class = secretValue("UnitClass")
assert(Lo.CanUse(MACE2) == true, "classe secrète : pas de règle des armes, l'infobulle décide")
S.members[1].class = "PRIEST"
-- Les autres classes (classes du jeu, en majuscules ou non)
for _, x in ipairs({
  { MACE2, "WARRIOR", true }, { MACE2, "druid", true }, { MACE2, "HUNTER", false }, { MACE2, "PALADIN", true }, { MACE2, "ROGUE", false },
  { POLEARM, "DRUID", true }, { POLEARM, "EVOKER", false }, { POLEARM, "MONK", true }, { POLEARM, "SHAMAN", false },
  { STAFF, "HUNTER", true }, { STAFF, "PALADIN", false }, { STAFF, "DEATHKNIGHT", false },
  { SHIELD, "SHAMAN", true }, { SHIELD, "PALADIN", true }, { SHIELD, "WARRIOR", true }, { SHIELD, "DEATHKNIGHT", false }, { SHIELD, "EVOKER", false },
  { FRILL, "EVOKER", true }, { FRILL, "MONK", true }, { FRILL, "PALADIN", true }, { FRILL, "WARRIOR", false }, { FRILL, "HUNTER", false },
  { FRILL, "DEMONHUNTER", nil }, { BOW, "HUNTER", true }, { BOW, "MAGE", false }, { BOW, "WARRIOR", nil }, { BOW, "ROGUE", nil },
  { DAGGER, "DEMONHUNTER", true }, { DAGGER, "MONK", false }, { DAGGER, "PALADIN", false }, { GLAIVE, "DEMONHUNTER", true }, { GLAIVE, "WARRIOR", false },
  { WAND, "MAGE", true }, { WAND, "WARRIOR", false }, { FISHPOLE, "MAGE", nil }, { THROWN, "WARRIOR", nil }, { MACE2, nil, nil }, { MACE2, "INCONNU", nil },
}) do
  assert(Lo.CanUseClass(x[1], x[2]) == x[3], "règle des armes : " .. x[1]:match("%[(.-)%]") .. " / " .. tostring(x[2]) .. " → " .. tostring(x[3]))
end
-- Table complète : les 13 classes, chacune avec un avis sur chaque type, sauf les doutes notés
local nClasses = 0
for _ in pairs(Lo.WEAPONS_OF) do nClasses = nClasses + 1 end
assert(nClasses == 13, "règle des armes : 13 classes")
for class, t in pairs(Lo.WEAPONS_OF) do
  assert(Lo.ARMOR_OF[class], "classe de la règle des armes : " .. class)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  local doubts = ({ WARRIOR = 3, ROGUE = 3, DEMONHUNTER = 1 })[class] or 0
  assert(n == 17 - doubts, "règle des armes complète : " .. class .. " (" .. n .. ")")
end

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

-- 10e bis. Règle des armes au conseil (retours du raid du 11/10/2026) : une arme d'hast (pas pour un prêtre ni un
-- évocateur ; chasseur, druide et guerrier la manient)
do
  local hall = receive(POLEARM, 3, 9, "1 h 50 min")
  local _, hsid = Lo.StartCouncil(hall.key)
  local ho = offerOf(hsid)
  assert(ho and ho.usable == false and ho.reason == "arme d'hast : pas pour ta classe", "proposition : arme que je ne manie pas, avec la raison")
  local okW, wmsg = Lo.Answer(hsid, "bis", "")
  assert(okW == false and wmsg:find("(arme d'hast : pas pour ta classe) : réponds Transmo ou Passer.", 1, true), "ma réponse BiS refusée sur une arme : " .. tostring(wmsg))
  assert(not Lo.Answer(hsid, "off", "") and Lo.Answer(hsid, "transmo", ""), "Off-spec refusé, Transmo accepté")
  -- Joueur sans l'addon : « bis » chuchoté par un évocateur → Transmo, relayé ainsi au conseil
  mark = #S.sent
  whisper("bis", "Orvane-Hyjal")
  advance(10) -- file des messages : la proposition et ma réponse partent avant
  local xw = cand(Lo.Council(hsid), "Orvane-Hyjal")
  assert(xw and xw.response == "transmo" and xw.asked == "bis" and xw.canUse == false and xw.whispered, "« bis » chuchoté d'un évocateur sur une arme d'hast : Transmo")
  assert(sentMsg("^LA;" .. hsid .. ";transmo;;chuchoté;Orvane%-Hyjal$", mark + 1, "WHISPER"), "relais au conseil : déjà Transmo")
  -- Réponses d'addons : chasseur et druide la manient ; guerrier en Upgrade
  addon("Sylvane-Hyjal", "LA;" .. hsid .. ";bis;;", "WHISPER")
  addon("Brumelune-Ysondre", "LA;" .. hsid .. ";off;;", "WHISPER")
  addon("Tharok-Hyjal", "LA;" .. hsid .. ";upgrade;;", "WHISPER")
  local hc = Lo.Council(hsid)
  assert(cand(hc, "Sylvane-Hyjal").response == "bis" and cand(hc, "Sylvane-Hyjal").canUse == true, "chasseur : arme d'hast, BiS gardé")
  assert(cand(hc, "Brumelune-Ysondre").response == "off" and cand(hc, "Tharok-Hyjal").response == "upgrade" and cand(hc, "Tharok-Hyjal").canUse == true, "druide et guerrier : gardés")
  -- Transmo chuchoté ensuite par l'évocateur : réponse inchangée, grisée au conseil (« ne peut pas le porter »)
  whisper("transmo", "Orvane-Hyjal")
  local xt2 = cand(Lo.Council(hsid), "Orvane-Hyjal")
  assert(xt2.response == "transmo" and not xt2.asked and xt2.canUse == false, "Transmo d'un évocateur : signalé au conseil")
  -- Ma réponse (prêtre) : Transmo, signalée aussi
  assert(cand(Lo.Council(hsid), "Kaeldra-Hyjal").response == "transmo" and cand(Lo.Council(hsid), "Kaeldra-Hyjal").canUse == false, "ma réponse Transmo : signalée")
  Lo.Cancel(hall.key)
  S.bags[3][9] = nil
  advance(2)
end

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
-- Mots anglais (joueur sans l'addon, client anglais), avec ou sans numéro ; les mots français restent lus
for text, want in pairs({ ["upgrade 2"] = { "upgrade", 2 }, ["2 Upgrade"] = { "upgrade", 2 }, ["offspec"] = { "off" }, ["off-spec #3"] = { "off", 3 },
  ["off 1"] = { "off", 1 }, ["off spec 4"] = { "off", 4 }, ["TMOG 4"] = { "transmo", 4 }, ["transmog"] = { "transmo" }, ["pass"] = { "pass" },
  ["pass 3"] = { "pass", 3 }, ["passer 2"] = { "pass", 2 }, ["passe"] = { "pass" }, ["transmo 1"] = { "transmo", 1 }, ["os"] = { "off" } }) do
  local r, n = Lo.ParseWhisper(text)
  assert(r == want[1] and n == want[2], "chuchotement « " .. text .. " » : " .. tostring(r) .. " " .. tostring(n))
end
assert(Lo.ParseWhisper("need 2") == nil and Lo.ParseWhisper("hello") == nil, "mots inconnus : ignorés")
whisper("upgrade 4", "Sylvane-Hyjal")
whisper("tmog 1", "Orvane-Hyjal")
assert(cand(Lo.Council(sessions[4]), "Sylvane-Hyjal").response == "upgrade" and cand(Lo.Council(sessions[1]), "Orvane-Hyjal").response == "transmo", "« upgrade 4 », « tmog 1 »")
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
assert(#all == 8 and all[1].session == psid and all[1].closed and all[2].session == usid and all[3].session == "88001" and not all[3].isMaster
  and all[4].link:find("Hallebarde", 1, true) and all[4].closed, "Councils : tous ceux de moins de 2 h (dont l'arme d'hast du 10e bis)")
assert(cl[1].pos == 5 and cl[4].pos == 8 and cl[1].num == 1 and cl[4].num == 4 and cl[2].link == long[2].link, "Councils : ordre de proposition et numéros")
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

-- 10h. Bilan : chaque attribution notée, même relevé en pause (/reload) ; ligne retrouvée même si le nom du chef de butin
-- y est écrit autrement ; objets qui ne sont pas de l'équipement (Étincelles…) ni notés ni comptés ; rattrapage avant
-- l'export
assert(R.IsRecording(), "relevé en cours")
local HOOD, SPARK = item(242430, "Capuche de la Faille"), item(242431, "Étincelle des marées")
S.itemClass[242431] = 7 -- composant d'artisanat
local nLoot = #log.loot
local h1 = receive(HOOD, 4, 5, "1 h 50 min")
assert(#log.loot == nLoot + 1 and log.loot[nLoot + 1].who == "Kaeldra-Hyjal", "capuche ramassée par le chef de butin")
fire("CHAT_MSG_LOOT", "Mordak-Ysondre reçoit le butin : " .. SPARK .. ".", "", "", "", "")
fire("CHAT_MSG_LOOT", "Vous recevez le butin : " .. SPARK .. ".", "", "", "", "")
assert(#log.loot == nLoot + 1, "Étincelle (composant) : pas notée")
-- /reload : relevé en pause jusqu'au prochain relevé de la minute
local paused = R.current
R.current = nil
assert(Lo.Award(h1.key, "Vex-Kael'Thas", "council", "bis", "2 votes"), "capuche donnée pendant la pause du relevé")
local hl = log.loot[nLoot + 1]
assert(hl.who == "Vex-Kael'Thas" and hl.method == "council" and hl.response == "bis" and hl.detail == "2 votes" and #log.loot == nLoot + 1 and h1.logged, "notée quand même dans le bilan (relevé retrouvé à l'heure de l'objet)")
R.current = paused
-- Ligne de l'objet au nom d'un autre (chef de butin changé, nom écrit autrement) : retrouvée, pas de doublon
local CLOAK2 = item(242432, "Cape des marées")
local c2 = receive(CLOAK2, 4, 6, "1 h 50 min")
log.loot[#log.loot].who = "Tharok-Hyjal" -- ramassée sous un autre nom (chef de butin changé)
local before2 = #log.loot
assert(Lo.Award(c2.key, "Sylvane-Hyjal", "roll", nil, "MS 77"), "cape donnée")
assert(#log.loot == before2 and log.loot[before2].who == "Sylvane-Hyjal" and log.loot[before2].detail == "MS 77", "ligne du chef retrouvée malgré le nom")
-- Attribution pas notée (vieille version, relevé introuvable) : rattrapée avant l'export
h1.logged, h1.logIndex, hl.awarded, hl.method, hl.who, hl.response, hl.detail, hl.awardKey = nil, nil, nil, "", "Kaeldra-Hyjal", "", "", nil
assert(R.Block(log):find("L;242430;Vex%-Kael'Thas;%d+;[^;]*;council;bis;2 votes", 1) and h1.logged, "rattrapée avant l'export")
-- Composant attribué : rien dans le bilan
local s3 = receive(SPARK, 4, 7, "1 h 50 min")
local nl = #log.loot
assert(s3 and Lo.Award(s3.key, "Orvane-Hyjal", "ml") and #log.loot == nl and s3.logged, "composant attribué : rien dans le bilan")
clearItems()
assert(errors() == 0, "bilan sans erreur : " .. tostring(lastPrinted("erreur")))
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

--------------------------------------------------------------------------------------------------------------------
-- 11. Partage des données du site entre joueurs (addon/shared/Share.lua, Groups.lua) : texte canonique, annonces,
-- demandes, morceaux, vérifications, inscription gardée, option coupée, relais, pas de diffusions en double.
-- Les autres joueurs sont d'autres exemplaires de Share.lua (même minuteur, même horloge) reliés par un canal simulé ;
-- Kaeldra (moi) est l'addon complet.
--------------------------------------------------------------------------------------------------------------------
local realChecked = false
local function sharing()
local Sh = ns.Share
local ME = "Kaeldra-Hyjal"
Sh.random = function() return 0.5 end
-- Signature simulée pour la clé « test0001 » (somme de contrôle du texte canonique) ; les autres clés passent par la
-- vraie vérification (addon/shared/Crypto.lua), si elle est là
local realVerify = ns.Crypto.VerifyRSA
local function checksum(s)
  local a, b = 1, 0
  for i = 1, #s do a = (a + s:byte(i)) % 65521 b = (b + a) % 65521 end
  return "T" .. (b * 65536 + a) .. "=="
end
ns.SITE_KEYS.test0001 = { n = "00", e = 65537 }
ns.Crypto.VerifyRSA = function(keyId, message, sig)
  if keyId == "test0001" then return sig == checksum(message) end
  if realVerify then return realVerify(keyId, message, sig) end
  return false, "crypto"
end

-- Texte canonique calculé ici sans Share.lua : champs 7 et 8 des lignes R vidés
local function canon(lines)
  local out = {}
  for _, l in ipairs(lines) do
    if l:sub(1, 2) == "R;" then
      local f = {}
      for x in (l .. ";"):gmatch("([^;]*);") do f[#f + 1] = x end
      f[7], f[8] = "", ""
      l = table.concat(f, ";")
    end
    out[#out + 1] = l
  end
  return table.concat(out, "\n")
end
-- Bloc RRG comme le site l'écrit : en-tête, R (avec les champs personnels de celui qui l'a copié), autres lignes, M, Z, END
local function block(group, at, raids, extra, members, opts)
  opts = opts or {}
  local lines = { "RRG;" .. (opts.version or 1) .. ";" .. group .. ";" .. at .. ";Les Veilleurs" }
  for _, r in ipairs(raids) do lines[#lines + 1] = r end
  for _, x in ipairs(extra or {}) do lines[#lines + 1] = x end
  lines[#lines + 1] = "M;" .. table.concat(members, ",")
  local c = canon(lines)
  if not opts.unsigned then lines[#lines + 1] = "Z;" .. (opts.key or "test0001") .. ";" .. (opts.sig or checksum(c)) end
  for _, x in ipairs(opts.after or {}) do lines[#lines + 1] = x end
  lines[#lines + 1] = "END;" .. #raids
  return table.concat(lines, "\n"), c
end

-- 11.1 Texte canonique (RRG et FRG), membres, signature, texte partagé
local RAW = table.concat({
  "  RRG;1;g1;1794600000;Les Veilleurs \r",
  "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "",
  "\tR;r9;0;Raid;normal;25;;;journal",
  "O;Kaeldra-Hyjal",
  "M;Kaeldra-Hyjal, Tharok-Hyjal",
  "Z;test0001;abc=",
  "END;2",
  "RRG;1;g2;1794600000;Autre",
  "END;0",
}, "\n")
local info = Sh.Parse(RAW, "RRG")
assert(info and info.canonical == "RRG;1;g1;1794600000;Les Veilleurs\nR;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;;;council\nR;r9;0;Raid;normal;25;;;journal\nO;Kaeldra-Hyjal\nM;Kaeldra-Hyjal, Tharok-Hyjal",
  "texte canonique RRG : " .. tostring(info and info.canonical))
assert(info.group == "g1" and info.at == 1794600000 and info.name == "Les Veilleurs" and #info.members == 2 and info.members[2] == "Tharok-Hyjal", "en-tête et membres")
assert(info.keyId == "test0001" and info.sig == "abc=" and info.shared == info.canonical .. "\nZ;test0001;abc=\nEND;2", "signature et texte partagé")
assert(Sh.Canonical(info.shared, "RRG") == info.canonical, "un bloc déjà canonique est sa propre forme canonique")
assert(Sh.Canonical("FRG;1;g;5;Forever\nR;r;0;Onyxia;present;Greta;softres\nS;r;1;Greta:0\nM;Greta,Ulf\nEND;1", "FRG") == "FRG;1;g;5;Forever\nR;r;0;Onyxia;;;softres\nS;r;1;Greta:0\nM;Greta,Ulf", "texte canonique FRG : champs 5 et 6")
assert(Sh.Canonical("RRG;1;g;5;G\nR;r;0;Raid", "RRG") == nil and Sh.Canonical("RRG;1;g;5;G\nRRG;1;h;5;H\nEND;0", "RRG") == nil, "bloc incomplet")
assert(Sh.Parse(RAW, "FRG") == nil, "autre addon : rien")
assert(Sh.Status(RAW, "RRG") == "ok" and Sh.Status(info.canonical .. "\nEND;2", "RRG") == "unsigned" and Sh.Status(RAW:gsub("test0001", "inconnue"), "RRG") == "key", "état de la signature")
assert(not Sh.Verify(RAW, "RRG") and Sh.Verify((block("g1", 5, {}, nil, { ME })), "RRG"), "vérification")
-- Le texte collé garde les lignes M et Z, et le bloc signé pour le relayer
local gs = F.ParseRRG(RAW)
assert(gs and #gs == 2 and gs[1].members[2] == "Tharok-Hyjal" and gs[1].sig.key == "test0001" and gs[1].text and Sh.Canonical(gs[1].text, "RRG") == info.canonical, "M et Z lus, texte gardé")
assert(gs[2].text == nil and gs[2].members == nil and #gs[1].raids == 2 and gs[1].raids[1].status == "present", "bloc sans signature : pas de texte ; inscription lue")
-- Découpage : messages ≤ 255 octets, caractères UTF-8 entiers, remis bout à bout = le texte partagé
local bigRaids = {}
for i = 1, 24 do bigRaids[i] = "R;b" .. i .. ";" .. (T + i * 86400) .. ";Sanctum Žarkov Žžž " .. i .. ";heroic;20;;;council" end
local BIG = block("6f1c2a10-0000-4000-8000-0000000000f5", BASE + 3000, bigRaids, { "O;Kaeldra-Hyjal" }, { ME, "Tharok-Hyjal" })
local bigInfo = Sh.Parse(BIG, "RRG")
local chunks = Sh.Chunks(bigInfo.group, bigInfo.at, bigInfo.shared)
assert(chunks and #chunks >= 8, "texte long : plusieurs messages")
local joined = {}
for i, m in ipairs(chunks) do
  assert(#m <= 255, "message de " .. #m .. " octets")
  local g, a, k, n, payload = m:match("^SHD;([^;]+);(%d+);(%d+);(%d+);(.*)$")
  assert(g == bigInfo.group and tonumber(a) == bigInfo.at and tonumber(k) == i and tonumber(n) == #chunks and not payload:find("^[\128-\191]"), "morceau " .. i)
  joined[i] = payload
end
assert(table.concat(joined) == bigInfo.shared, "morceaux remis bout à bout")

-- 11.2 Plusieurs joueurs : canal simulé (guilde, raid, chuchotements), 50 ms de trajet
S.guild = true
local clients = {}
local function deliver(from, msg, dist, target)
  for _, c in ipairs(clients) do
    if c.name ~= from and ((dist == "GUILD" and c.guild) or (dist == "RAID" and c.raid) or (dist == "WHISPER" and c.name == target)) then
      schedule(0.05, function() c.Sh.OnMessage(from, msg, dist) end)
    end
  end
  if from ~= ME and ((dist == "GUILD" and S.guild) or (dist == "RAID" and S.raid) or (dist == "WHISPER" and target == ME)) then
    schedule(0.05, function() fire("CHAT_MSG_ADDON", "RosterRT", msg, dist, from) end)
  end
end
S.bus = function(msg, dist, target) deliver(ME, msg, dist, target) end
local function client(name, opts)
  opts = opts or {}
  local c = { name = name, guild = opts.guild ~= false, raid = opts.raid, groups = {}, applied = {}, notes = {}, sent = {}, on = true, chars = opts.chars or { name } }
  local cns = { L = ns.L, N = ns.N, Crypto = ns.Crypto, SITE_KEYS = ns.SITE_KEYS }
  assert(loadfile("addon/shared/Share.lua"))("Roster", cns)
  c.Sh = cns.Share
  c.Sh.random = function() return opts.rand or 0.5 end
  c.Sh.Setup({
    kind = "RRG",
    send = function(msg, dist, target)
      assert(#msg <= 255, "message de plus de 255 octets : " .. #msg)
      c.sent[#c.sent + 1] = { msg = msg, dist = dist, target = target }
      deliver(name, msg, dist, target)
    end,
    blocks = function()
      local out = {}
      for id, g in pairs(c.groups) do out[id] = { at = g.at, text = g.text } end
      return out
    end,
    apply = function(text, sender, dist)
      local i = c.Sh.Parse(text, "RRG")
      c.groups[i.group] = { at = i.at, text = text }
      c.applied[#c.applied + 1] = { group = i.group, at = i.at, from = sender, dist = dist }
      return true
    end,
    mine = function(list)
      for _, n in ipairs(list) do for _, m in ipairs(c.chars) do if n == m then return true end end end
      return false
    end,
    notify = function(text) c.notes[#c.notes + 1] = text end,
    enabled = function() return c.on end,
  })
  clients[#clients + 1] = c
  return c
end
local function hold(c, text) local i = c.Sh.Parse(text, "RRG") c.groups[i.group] = { at = i.at, text = text } end
local function msgs(list, pattern, from)
  local n = 0
  for i = from or 1, #list do if list[i].msg:find(pattern) then n = n + 1 end end
  return n
end
local function lastAt(c, group) return c.groups[group] and c.groups[group].at end
local function myGroup(id) for _, g in ipairs(G.List()) do if g.id == id then return g end end end
local function raidOf(g, id) for _, r in ipairs(g.raids) do if r.id == id then return r end end end
local function received() local n = 0 for _, l in ipairs(printed) do if l:find("reçues de", 1, true) then n = n + 1 end end return n end

-- Mes données de g1 (collées, sans signature) : inscrit « present » avec Kaeldra au raid RAID_ID, pas au raid r2
assert(D.Load(table.concat({ "RRG;1;g1;" .. BASE .. ";Les Veilleurs",
  "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "R;r2;" .. (T + 7 * 86400) .. ";Kith'ix;mythic;20;;;journal", "END;2" }, "\n")))
local g1 = myGroup("g1")
assert(g1 and g1.at == BASE and not g1.text and raidOf(g1, RAID_ID).status == "present", "g1 collé sans signature")
assert(Sh.Announce("GUILD") == 0, "rien de signé : aucune annonce")
-- Version T2 détenue par Tharok (copiée par lui : ses champs personnels), T3 par Vex
local T2, T3 = BASE + 1000, BASE + 2000
local MEMBERS = { ME, "Tharok-Hyjal", "Ilyra-Hyjal", "Vex-Kael'Thas" }
local function raids(status)
  return { "R;" .. RAID_ID .. ";" .. T .. ";Faille de Sporefall;heroic;20;" .. status .. ";Tharok-Hyjal;council",
    "R;r2;" .. (T + 7 * 86400) .. ";Kith'ix;mythic;20;;;journal",
    "R;r4;" .. (T + 14 * 86400) .. ";Manaforge Omega;heroic;20;present;Tharok-Hyjal;council" }
end
local V2 = block("g1", T2, raids("absent"), { "O;Tharok-Hyjal" }, MEMBERS)
local V3 = block("g1", T3, raids("late"), { "O;Tharok-Hyjal,Vex-Kael'Thas" }, MEMBERS)
local tharok = client("Tharok-Hyjal", { rand = 0 })
local ilyra = client("Ilyra-Hyjal")
local vex = client("Vex-Kael'Thas", { rand = 0.9 })
local zeph = client("Zephyra-Hyjal") -- de la guilde, pas membre du groupe
hold(tharok, V2) hold(vex, V3)

-- Tharok annonce : moi (plus ancien) et Ilyra (rien) demandons, Zephyra (rien, pas membre) aussi une fois ; Vex (plus
-- récent) ne demande pas mais répond par son annonce
local sent0 = #S.sent
assert(tharok.Sh.Announce("GUILD") == 1 and tharok.sent[1].msg == "SHV;RRG;g1;" .. T2 .. ";" .. #Sh.Parse(V2, "RRG").shared, "annonce SHV")
advance(0.3)
assert(msgs(S.sent, "^SHQ;g1;" .. BASE .. ";GUILD$", sent0 + 1) == 1 and S.sent[#S.sent].dist == "WHISPER" and S.sent[#S.sent].target == "Tharok-Hyjal", "données plus anciennes : demande chuchotée à Tharok")
assert(msgs(ilyra.sent, "^SHQ;g1;0;GUILD$") == 1 and msgs(zeph.sent, "^SHQ;g1;0;GUILD$") == 1, "sans données : demande (une fois)")
assert(msgs(vex.sent, "^SHQ") == 0, "données plus récentes : pas de demande")
advance(2)
assert(msgs(tharok.sent, "^SHD;g1;" .. T2 .. ";1;") == 1, "trois demandes, une seule diffusion")
for _, e in ipairs(tharok.sent) do if e.msg:find("^SHD") then assert(e.dist == "GUILD" and #e.msg <= 255, "diffusion sur la guilde") end end
-- Appliqué chez moi : nouvelles données, mon inscription gardée (raid RAID_ID), inconnue pour le raid nouveau
g1 = myGroup("g1")
assert(g1.at == T2 and g1.text and g1.origin.from == "Tharok-Hyjal" and Sh.Status(g1.text, "RRG") == "ok", "reçu de Tharok : appliqué et gardé signé")
local mine1 = raidOf(g1, RAID_ID)
assert(mine1.status == "present" and mine1.char == ME and not mine1.unknown, "mon inscription gardée (pas celle de Tharok)")
assert(raidOf(g1, "r2").status == nil and not raidOf(g1, "r2").unknown and raidOf(g1, "r4").unknown and raidOf(g1, "r4").status == nil, "pas inscrit / raid nouveau : inconnu")
assert(#g1.officers == 1 and g1.officers[1] == "Tharok-Hyjal" and #g1.members == 4, "lignes O et M")
assert(lastPrinted("Données de Les Veilleurs reçues de Tharok (site : ", 1, true) and received() == 1, "message dans le chat, une fois")
local origins = D.Origins()
assert(#origins == 2 and origins[1]:find("^Les Veilleurs : reçues de Tharok le ") and not origins[1]:find("non partagées", 1, true)
  and origins[2]:find("^Pasta : collées le .* · non partagées : pas signées par le site$"), "onglet Synchro : origine de chaque groupe")
assert(ilyra.applied[1] and ilyra.applied[1].at == T2 and ilyra.notes[1]:find("reçues de Tharok-Hyjal", 1, true), "Ilyra : appliqué")
buildPages(nil)
local unknownShown = false
for text in pairs(TEXTS) do if type(text) == "string" and text:find("inscription inconnue (données reçues d'un autre joueur)", 1, true) then unknownShown = true end end
assert(unknownShown and errors() == 0, "onglet Raids : inscription inconnue pour le raid nouveau")
assert(#zeph.applied == 0 and zeph.Sh.State().outsider.g1 and zeph.Sh.last.result == "member", "Zephyra pas membre : jamais appliqué")
assert(#vex.applied == 0, "Vex : version plus ancienne ignorée")
-- Vex répond par son annonce (T3) : tous la demandent, sauf Zephyra (déjà demandé sans données cette session)
advance(5)
assert(msgs(vex.sent, "^SHV;RRG;g1;" .. T3 .. ";") == 1, "réponse à une annonce plus ancienne")
advance(5)
assert(msgs(vex.sent, "^SHD;g1;" .. T3 .. ";1;") == 1 and msgs(zeph.sent, "^SHQ") == 1, "une diffusion ; Zephyra ne redemande pas")
assert(myGroup("g1").at == T3 and lastAt(tharok, "g1") == T3 and lastAt(ilyra, "g1") == T3, "tout le monde à T3")
mine1 = raidOf(myGroup("g1"), RAID_ID)
assert(mine1.status == "present" and mine1.char == ME and raidOf(myGroup("g1"), "r4").unknown and received() == 2, "inscription toujours gardée")
-- Plus personne ne demande : une annonce de la même version ne fait rien
local before = #S.sent
advance(Sh.QUIET + 1)
vex.Sh.Announce("GUILD")
advance(5)
assert(msgs(S.sent, "^SH", before + 1) == 0 and msgs(ilyra.sent, "^SHQ") == 2, "même version : ni demande ni diffusion")

-- 11.3 Morceaux dans le désordre, doublons, délai dépassé (messages reçus de Orvane, hors du canal simulé)
local function feed(list, from, dist) for _, m in ipairs(list) do fire("CHAT_MSG_ADDON", "RosterRT", m, dist or "GUILD", from or "Orvane-Hyjal") end end
local shuffled = {}
for i = #chunks, 1, -1 do
  shuffled[#shuffled + 1] = chunks[i]
  if i == 3 then shuffled[#shuffled + 1] = chunks[2] end -- doublon
end
feed(shuffled)
local big = myGroup(bigInfo.group)
assert(big and big.at == bigInfo.at and #big.raids == 24 and big.raids[24].name == "Sanctum Žarkov Žžž 24" and big.origin.from == "Orvane-Hyjal", "désordre et doublon : remis en ordre, appliqué")
assert(received() == 3 and next(Sh.State().rx) == nil, "appliqué une fois, rien en attente")
feed(shuffled)
assert(received() == 3, "même version renvoyée : ignorée")
-- Délai : le dernier morceau arrive 121 s après les autres
local SLOW = block("g6", BASE + 3000, { bigRaids[1], bigRaids[2], bigRaids[3] }, nil, { ME })
local slowInfo = Sh.Parse(SLOW, "RRG")
local slow = Sh.Chunks("g6", slowInfo.at, slowInfo.shared)
assert(#slow >= 2, "texte en plusieurs morceaux")
feed({ unpack(slow, 1, #slow - 1) })
advance(Sh.TIMEOUT + 1)
feed({ slow[#slow] })
assert(not myGroup("g6"), "délai dépassé : abandonné")
local pendingRx = 0
for _ in pairs(Sh.State().rx) do pendingRx = pendingRx + 1 end
assert(pendingRx == 1, "le morceau en retard attend seul")
advance(Sh.TIMEOUT + 1)
feed({ "SHV;FRG;x;1;1" })
assert(next(Sh.State().rx) == nil, "puis abandonné à son tour")

-- 11.4 Refusés, jamais appliqués : signature fausse, clé inconnue, pas membre, sans signature, lignes ajoutées, plus ancien
local function try(text, label, from)
  local i = Sh.Parse(text, "RRG")
  local shared = i.shared or (i.canonical .. "\n" .. i.endLine)
  local before = received()
  feed(Sh.Chunks(i.group, i.at, shared), from)
  assert(received() == before and not myGroup(i.group), label)
  return Sh.last and Sh.last.result
end
local T4 = BASE + 4000
local forged = block("g7", T4, raids("present"), nil, MEMBERS):gsub("Kith'ix", "Kith'ix (faux)")
assert(try(forged, "texte modifié : refusé") == "signature", "signature fausse")
assert(try((block("g7", T4 + 1, raids("present"), nil, MEMBERS, { key = "deadbeef" })), "clé inconnue : refusé") == "key", "clé inconnue")
assert(try((block("g7", T4 + 2, raids("present"), nil, { "Mordak-Ysondre", "Orvane-Hyjal" })), "pas membre : refusé") == "member", "pas membre")
assert(try((block("g7", T4 + 3, raids("present"), nil, MEMBERS, { unsigned = true })), "sans signature : refusé") == "invalid", "sans signature")
assert(try((block("g7", T4 + 4, raids("present"), nil, MEMBERS, { after = { "O;Mordak-Ysondre" } })), "ligne ajoutée après Z : refusé") == "signature", "ligne ajoutée")
local noM = block("g7", T4 + 5, raids("present"), nil, MEMBERS):gsub("\nM;[^\n]*", "")
assert(try(noM, "sans ligne M : refusé") == "members", "sans ligne M")
local OLD = block("g1", T2, raids("present"), nil, MEMBERS)
local oldInfo = Sh.Parse(OLD, "RRG")
feed(Sh.Chunks("g1", T2, oldInfo.shared))
assert(myGroup("g1").at == T3 and next(Sh.State().rx) == nil, "plus ancien que le mien : ignoré")
feed(Sh.Chunks(bigInfo.group, bigInfo.at + 1, (bigInfo.shared:gsub(tostring(bigInfo.at), tostring(bigInfo.at + 1), 1))), "Orvane-Hyjal", "WHISPER")
assert(myGroup(bigInfo.group).at == bigInfo.at, "données chuchotées : ignorées (guilde et raid seulement)")
-- Un texte forgé ne fait pas ignorer la vraie version (même groupe, même date) envoyée ensuite par un autre joueur
local GENUINE = block("g7", T4, raids("present"), nil, MEMBERS)
before = received()
feed(Sh.Chunks("g7", T4, Sh.Parse(GENUINE, "RRG").shared), "Vex-Kael'Thas")
assert(myGroup("g7") and myGroup("g7").at == T4 and received() == before + 1, "vraie version appliquée malgré le texte forgé")
-- Version signée que l'addon ne sait pas lire (format plus récent) : refusée, plus jamais demandée ; la suivante oui
local NEWER = block("g9", T4, raids("present"), nil, MEMBERS, { version = 2 })
assert(try(NEWER, "format plus récent : refusé") == "apply" and Sh.State().refused.g9[T4] == "apply", "format plus récent")
before = #S.sent
feed({ "SHV;RRG;g9;" .. T4 .. ";500" })
advance(1)
assert(msgs(S.sent, "^SHQ;g9;", before + 1) == 0, "version refusée : pas redemandée")
feed({ "SHV;RRG;g9;" .. (T4 + 10) .. ";500" })
advance(1)
assert(msgs(S.sent, "^SHQ;g9;0;GUILD", before + 1) == 1, "version suivante : demandée")
feed({ "SHV;RRG;g10;" .. (time() + 3 * 86400) .. ";500", "SHV;RRG;g10;" .. (T4 + 10) .. ";70000" })
advance(1)
assert(msgs(S.sent, "^SHQ;g10;", before + 1) == 0, "date dans le futur, texte trop long : pas demandés")

-- 11.5 Moi comme source : collage signé → annonce à la guilde ; demandes → une diffusion (file de Comm), relayée ensuite
local T5 = BASE + 5000
local MINE = block("g1", T5, raids("present"), { "O;Kaeldra-Hyjal" }, MEMBERS)
before = #S.sent
local okLoad = D.Load(MINE)
assert(okLoad and myGroup("g1").at == T5 and myGroup("g1").origin.from == nil and myGroup("g1").text, "collé : gardé signé")
assert(raidOf(myGroup("g1"), "r4").status == "present" and not raidOf(myGroup("g1"), "r4").unknown, "collé : mes inscriptions du site")
advance(4)
assert(msgs(S.sent, "^SHV;RRG;g1;" .. T5 .. ";", before + 1) == 1 and msgs(S.sent, "^SHV;RRG;" .. bigInfo.group:gsub("%-", "%%-"), before + 1) == 1, "annonce à la guilde après le collage (blocs signés)")
assert(msgs(S.sent, "^SHV;RRG;g2;", before + 1) == 0, "bloc sans signature : jamais annoncé")
advance(40)
local mineInfo = Sh.Parse(MINE, "RRG")
assert(msgs(S.sent, "^SHD;g1;" .. T5 .. ";1;", before + 1) == 1 and msgs(S.sent, "^SHD;g1;" .. T5 .. ";", before + 1) == #Sh.Chunks("g1", T5, mineInfo.shared), "une diffusion complète (trois demandes)")
assert(lastAt(tharok, "g1") == T5 and lastAt(vex, "g1") == T5 and lastAt(ilyra, "g1") == T5 and lastAt(zeph, "g1") == nil, "reçu par les membres")
assert(Sh.Canonical(tharok.groups.g1.text, "RRG") == mineInfo.canonical and not tharok.groups.g1.text:find(";present;", 1, true), "mes champs personnels ne partent pas")
for i = before + 1, #S.sent do assert(#S.sent[i].msg <= 255, "≤ 255 octets") end
-- Connexion : annonce à la guilde 20 à 40 s après
advance(Sh.QUIET)
before = #S.sent
fire("PLAYER_LOGIN")
advance(19)
assert(msgs(S.sent, "^SHV", before + 1) == 0, "pas avant 20 s")
advance(22)
assert(msgs(S.sent, "^SHV;RRG;g1;" .. T5, before + 1) == 1 and S.sent[#S.sent].dist == "GUILD", "annonce 20 à 40 s après la connexion")
assert(RosterDB.chars and RosterDB.chars[F.Fold(ME)] == ME, "perso noté parmi ceux du compte")
-- Arrivée dans un raid (Brumelune n'est pas de la guilde) : annonce au raid ; elle demande et reçoit
local brume = client("Brumelune-Ysondre", { guild = false, raid = true, chars = { "Brumelune-Ysondre" } })
MEMBERS[#MEMBERS + 1] = "Brumelune-Ysondre"
local T6 = BASE + 6000
local RAIDV = block("g1", T6, raids("present"), nil, MEMBERS)
D.Load(RAIDV)
advance(Sh.QUIET + 5)
before = #S.sent
S.raid = true
S.members[#S.members + 1] = { name = "Brumelune", realm = "Ysondre", class = "DRUID", subgroup = 1 }
rosterUpdate()
advance(10)
assert(msgs(S.sent, "^SHV;RRG;g1;" .. T6, before + 1) >= 1, "annonce au raid à l'arrivée")
for i = before + 1, #S.sent do if S.sent[i].msg:find("^SHV") then assert(S.sent[i].dist == "RAID", "annonce sur le canal du raid") end end
advance(30)
assert(lastAt(brume, "g1") == T6 and brume.applied[1].dist == "RAID", "joueur hors guilde : reçu par le raid")
-- Données reçues par le raid : relayées à la guilde (Brumelune n'en est pas, mais un joueur de la guilde dans le raid oui)
local T7 = BASE + 7000
local fromRaid = block("g1", T7, raids("present"), nil, MEMBERS)
hold(brume, fromRaid)
before = #S.sent
brume.Sh.Announce("RAID")
advance(30)
assert(myGroup("g1").at == T7 and myGroup("g1").origin.from == "Brumelune-Ysondre", "reçu par le raid")
assert(msgs(S.sent, "^SHV;RRG;g1;" .. T7, before + 1) == 1 and lastAt(tharok, "g1") == T7, "relayé à la guilde, reçu par Tharok")

-- 11.6 File de Comm : un message du butin passe avant une diffusion retenue (rencontre de boss)
local T8 = BASE + 8000
D.Load(block("g1", T8, raids("present"), nil, MEMBERS))
advance(Sh.QUIET + 5)
S.lockdown = true
before = #S.sent
ilyra.groups.g1 = nil
ilyra.Sh.Reset()
ilyra.Sh.OnMessage(ME, "SHV;RRG;g1;" .. T8 .. ";100", "GUILD")
advance(5)
assert(#S.sent == before and #Cm.queue >= 2 and Cm.Held() == 0, "diffusion retenue (pas comptée dans les messages en attente)")
Cm.Send("XF;1")
assert(Cm.Held() == 1 and Cm.queue[1].msg == "XF;1", "message du butin devant la diffusion")
S.lockdown = false
advance(30)
assert(S.sent[before + 1].msg == "XF;1" and msgs(S.sent, "^SHD;g1;" .. T8, before + 1) >= 1 and lastAt(ilyra, "g1") == T8, "parti d'abord, puis la diffusion")

-- 11.7 Option coupée : ni annonce ni envoi ; la réception continue
RosterDB.share = false
advance(Sh.QUIET + 5)
before = #S.sent
local T9 = BASE + 9000
D.Load(block("g1", T9, raids("present"), nil, MEMBERS))
fire("PLAYER_LOGIN")
advance(45)
assert(msgs(S.sent, "^SH[VD]", before + 1) == 0 and Sh.Announce("GUILD") == 0 and Sh.Announce("RAID") == 0, "coupé : aucune annonce")
ilyra.groups.g1 = nil
ilyra.Sh.Reset()
ilyra.Sh.OnMessage(ME, "SHV;RRG;g1;" .. T9 .. ";100", "GUILD") -- annonce entendue avant la coupure
advance(10)
assert(msgs(S.sent, "^SHD", before + 1) == 0 and lastAt(ilyra, "g1") ~= T9, "coupé : demande sans réponse")
local T10 = BASE + 10000
hold(vex, block("g1", T10, raids("present"), nil, MEMBERS))
vex.Sh.Announce("GUILD")
advance(10)
assert(myGroup("g1").at == T10 and msgs(S.sent, "^SHQ;g1;" .. T9 .. ";GUILD", before + 1) == 1, "coupé : réception (demande et application)")
assert(msgs(S.sent, "^SH[VD]", before + 1) == 0, "coupé : rien relayé")
RosterDB.share = nil

-- 11.8 Pas de tempête : deux sources de la même version, une seule diffusion ; annonces en double évitées
local T11 = BASE + 11000
local STORM = block("g8", T11, raids("present"), nil, { "Vex-Kael'Thas", "Ilyra-Hyjal", "Mirwen-Hyjal" })
local h1 = client("Sylvane-Hyjal", { rand = 0, raid = true })
local h2 = client("Orvane2-Hyjal", { rand = 0.9, raid = true })
hold(h1, STORM) hold(h2, STORM)
advance(Sh.QUIET + 5)
h1.Sh.OnMessage("Ilyra-Hyjal", "SHQ;g8;0;GUILD", "WHISPER")
h2.Sh.OnMessage("Vex-Kael'Thas", "SHQ;g8;0;GUILD", "WHISPER")
advance(5)
assert(msgs(h1.sent, "^SHD;g8;" .. T11 .. ";1;") == 1 and msgs(h2.sent, "^SHD") == 0, "la seconde source voit la diffusion et annule la sienne")
assert(lastAt(ilyra, "g8") == T11 and lastAt(vex, "g8") == T11 and not myGroup("g8"), "une diffusion pour tous (les membres)")
h1.Sh.OnMessage("Tharok-Hyjal", "SHQ;g8;0;GUILD", "WHISPER")
h2.Sh.OnMessage("Tharok-Hyjal", "SHQ;g8;0;GUILD", "WHISPER")
advance(5)
assert(msgs(h1.sent, "^SHD;g8;" .. T11 .. ";1;") == 1 and msgs(h2.sent, "^SHD") == 0, "pas deux fois en moins de 60 s")
-- Annonces : celle d'un autre il y a moins de 60 s suffit ; au raid (later), refaite à la fin du délai
assert(h1.Sh.Announce("RAID") == 1, "première annonce au raid")
advance(0.1)
assert(h2.Sh.Announce("RAID", true) == 0 and msgs(h2.sent, "^SHV") == 0, "même version annoncée à l'instant : pas d'annonce")
advance(Sh.QUIET + 6)
assert(msgs(h2.sent, "^SHV;RRG;g8;" .. T11) == 1, "refaite à la fin du délai (nouveaux venus)")
assert(h1.Sh.Announce("GUILD") == 1 and h1.Sh.Announce("GUILD") == 0, "pas deux annonces de suite")
-- Plusieurs joueurs plus récents entendent une annonce ancienne : une seule réponse
local olderC = client("Mirwen-Hyjal", { rand = 0.1 })
hold(olderC, (block("g8", T11 - 500, raids("present"), nil, { "Mirwen-Hyjal" })))
advance(Sh.QUIET + 5)
local answers = 0
for _, c in ipairs(clients) do answers = answers + msgs(c.sent, "^SHV;RRG;g8;" .. T11) end
olderC.Sh.Announce("GUILD")
advance(8)
local after8 = 0
for _, c in ipairs(clients) do after8 = after8 + msgs(c.sent, "^SHV;RRG;g8;" .. T11) end
assert(after8 - answers == 1 and lastAt(olderC, "g8") == T11, "une seule réponse à une annonce ancienne, puis mise à jour")

-- 11.9 Vraie signature du site (clé de test, addon/tests/fixtures) : vérifiée par Crypto.lua une fois fusionné
local REAL_SIG = "wdCuNRiT5QTvkUzGHnSsAAd1ti78hVLYZrVv7+0MSLMbJ6gm7vy7C7ozapF+b1i7I57sRuBW4fbYvrhznq6U7f9Y3CJGBhNZow6xlJjFYBrrD+zDmiUL3lubtg/gGOuGi1efCivBCuNP+dKqkW5VEWvgfzalhosDnFa1XiiaeFU0aAbODc8XX4VHYWoFBUHDZbOwE4xVf6NgSQcqJR8HPj6OTJAWt8cMj9Fzksq8Hvc0mN5rWiuL5c1RUT1/bD0iQgZsYnV8BYGJVjSRDVAHYkpg/tiHF7fuu+M+v0bmwShYnwhQS4ZB/EX1uWMovyWMBSzFoBxtp7Ii45WHXCyQbg=="
local REAL = table.concat({
  "RRG;1;5e1f0c2a-0000-4000-8000-0000000000aa;1794600000;Les Veilleurs",
  "R;9b1c2a10-0000-4000-8000-0000000000bb;1794700000;Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "O;Kaeldra-Hyjal",
  "M;Kaeldra-Hyjal,Tharok-Hyjal,Brumelune-Ysondre",
  "Z;a3de5db8;" .. REAL_SIG,
  "END;1",
}, "\n")
if realVerify then
  assert(loadfile("addon/tests/fixtures/SiteKeyTest.lua"))("Roster", ns)
  assert(Sh.Verify(REAL, "RRG"), "vraie signature du site (clé de test) : valide")
  assert(not Sh.Verify((REAL:gsub("heroic", "mythic")), "RRG"), "vraie signature, texte modifié : refusée")
  local ri = Sh.Parse(REAL, "RRG")
  feed(Sh.Chunks(ri.group, ri.at, ri.shared))
  assert(myGroup(ri.group) and myGroup(ri.group).raids[1].unknown, "bloc signé par le site : appliqué")
  realChecked = true
end
ns.Crypto.VerifyRSA = realVerify
S.bus, S.guild, S.raid = nil, false, false
S.members = { S.members[1] }
assert(errors() == 0, "partage sans erreur : " .. tostring(lastPrinted("erreur")))
end
sharing()
assert(#reassigned == 0, "variables de Blizzard réassignées par l'addon : " .. table.concat(reassigned, ", "))
-- Données du test autorisées par le contrôle des textes : noms de groupe et de raid écrits ici, noms d'objets du test
-- coupés à 14 octets dans la bande d'objets (LootUI, objet sans icône)
local LOOT_NAMES = { "Jambières de", "Anneau des spo", "Cuirasse de la", "Objet au nom v", "Objet au conse", "Objet chuchot", "Objet pas enco" }
LOCALE_AUDIT.check("Roster", { "Les Veilleurs", "Raid à définir", unpack(LOOT_NAMES) })
print = function(...) io.stdout:write(table.concat({ ... }, " "), "\n") end
print("roster_sim : tout est bon" .. (#stubbed > 0 and (" (socle simulé : " .. table.concat(stubbed, ", ") .. ")") or "")
  .. (realChecked and " ; partage : vraie signature du site vérifiée" or " ; partage : signature simulée (pas de ns.Crypto.VerifyRSA)"))
