-- Simulation de l'API de WoW Retail (12.x) pour l'addon Roster : lua5.1 addon/tests/roster_sim.lua (depuis la racine du dépôt).
-- Charge les fichiers de addon/Roster/Roster.toc dans l'ordre (addon/Roster, sinon addon/shared). Les fichiers du socle
-- (Core.lua, UI.lua, Minimap.lua) absents sont remplacés par une version minimale du contrat entre les deux moitiés de l'addon.
-- Scénario : données du site, invitations, placement, versions, file des messages pendant un boss, relevé du raid, bilan,
-- pages dans les deux habillages, valeurs secrètes. Échoue au premier problème.
local printed = {}
local verbose = os.getenv("ROSTER_SIM_VERBOSE") -- messages de l'addon affichés au fil de l'eau
function print(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring(select(i, ...)) end
  printed[#printed + 1] = table.concat(t, " ")
  if verbose then io.stderr:write(printed[#printed], "\n") end
end
local function errors() local n = 0 for _, l in ipairs(printed) do if l:find("erreur") then n = n + 1 end end return n end
local function lastPrinted(pattern) for i = #printed, 1, -1 do if printed[i]:find(pattern) then return printed[i] end end return nil end

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
local LOOT_Q = { [242394] = 4, [242395] = 4, [242396] = 3 }

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
    return name, i == 1 and (S.leader and 2 or (S.assistant and 1 or 0)) or 0, m.subgroup, 90, "Classe", m.class, "Faille", true, false, nil, false, "DAMAGER"
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
  C_Item = { GetItemQualityByID = function(id) return LOOT_Q[id] end },
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
  and S.whispers[1].msg == "Salut ! Pour ce raid, on utilise l'addon Roster (compo, présence, et bientôt le butin) : pense à l'installer.", "chuchotement envoyé")
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
