-- Simulation de l'API de WoW Retail pour l'addon Roster : charge les fichiers du .toc dans l'ordre, puis la fenêtre,
-- les commandes /roster, les onglets dans les deux habillages, la synchro rapide, les options, la minicarte, la
-- liste des addons de la minicarte et le raid d'essai de la distribution du butin (R3b, retours du test 0.3 : tout au
-- conseil, bandes d'objets, objets portables, détail des reçus), de bout en bout, dans les deux habillages.
-- lua5.1 addon/tests/roster_ui_test.lua (depuis la racine du dépôt).
-- Les fichiers de jeu (Format, Comm, Groups, Compo, Recorder, Loot, Pages, LootUI) absents sont remplacés par des
-- doublures qui respectent le contrat ; présents, ce sont eux qui servent. Fonctions du contrat 0.3 absentes du moteur :
-- doublures aussi (« Loot 0.3 » dans le message final).
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
-- Temps : immédiat par défaut ; en mode différé (raid d'essai), C_Timer.After attend advance(secondes)
local clock, elapsed, deferred, timers = 1790000000, 0, false, {}
function time() return clock + math.floor(elapsed) end
function GetServerTime() return time() end
function GetTime() return 1000 + elapsed end
local tickers = {}
C_Timer = {
  After = function(sec, fn) if deferred then timers[#timers + 1] = { at = elapsed + (sec or 0), fn = fn } else fn() end end,
  NewTicker = function(_, fn) tickers[#tickers + 1] = fn return { Cancel = function() end } end,
}
local function advance(sec)
  local stop = elapsed + sec
  while true do
    local best, bi
    for i, t in ipairs(timers) do if t.at <= stop and (not best or t.at < best.at) then best, bi = t, i end end
    if not best then break end
    table.remove(timers, bi)
    elapsed = math.max(elapsed, best.at)
    best.fn()
  end
  elapsed = stop
end
local function tick() for _, fn in ipairs(tickers) do fn() end end
-- Version lue dans le .toc
local TOC_VERSION
for line in io.lines("addon/Roster/Roster.toc") do TOC_VERSION = TOC_VERSION or line:match("^## Version: (%S+)") end
C_AddOns = { GetAddOnMetadata = function(name, key) assert(name == "Roster", "nom de l'addon") if key == "Version" then return TOC_VERSION end end }
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
-- Envois réels (messages d'addon, chat) : comptés ; aucun pendant le raid d'essai
local realSends, realChat = 0, 0
C_ChatInfo = { RegisterAddonMessagePrefix = function() return true end, SendAddonMessage = function() realSends = realSends + 1 return 0 end,
  InChatMessagingLockdown = function() return false end, SendChatMessage = function() realChat = realChat + 1 end }
function SendChatMessage() realChat = realChat + 1 end
-- Objets portés (raid d'essai) : liens avec bonus, niveau d'objet, emplacement, classe et sous-classe d'objet (4 armure :
-- 1 tissu, 2 cuir, 3 mailles, 4 plaques, 0 divers ; 2 arme). Le joueur est druide (cuir) : il ne peut pas porter les
-- spallières (plaques) ni la cuirasse (tissu).
local WORN = { [1] = { 237101, "Heaume du veilleur", "INVTYPE_HEAD", 4, 2 }, [3] = { 237103, "Spallières de l'aube", "INVTYPE_SHOULDER", 4, 4 },
  [5] = { 237105, "Cuirasse des cimes", "INVTYPE_CHEST", 4, 1 }, [7] = { 237107, "Jambières runiques", "INVTYPE_LEGS", 4, 2 },
  [11] = { 237111, "Anneau de braise", "INVTYPE_FINGER", 4, 0 }, [12] = { 237112, "Anneau de givre", "INVTYPE_FINGER", 4, 0 },
  [16] = { 237116, "Lame du crépuscule", "INVTYPE_WEAPON", 2, 7 } }
-- Objets de secours du raid d'essai, et ceux d'une autre armure (côté joueur : mailles 18817, cuir 16901)
local ITEM = { [19019] = { "INVTYPE_WEAPON", 2, 7 }, [17076] = { "INVTYPE_2HWEAPON", 2, 8 }, [18814] = { "INVTYPE_NECK", 4, 0 },
  [16901] = { "INVTYPE_LEGS", 4, 2 }, [18817] = { "INVTYPE_HEAD", 4, 3 }, [32837] = { "INVTYPE_WEAPON", 2, 9 } }
for _, w in pairs(WORN) do ITEM[w[1]] = { w[3], w[4], w[5] } end
local SUBTYPE = { [0] = "Divers", "Tissu", "Cuir", "Mailles", "Plaques" }
local naked = false
function GetInventoryItemLink(unit, slot)
  local w = unit == "player" and not naked and WORN[slot]
  return w and ("|cffa335ee|Hitem:" .. w[1] .. "::::::::90:577::6:2:12251:1540|h[" .. w[2] .. "]|h|r") or nil
end
C_Item = { GetItemInfo = function() return nil end, GetItemQualityByID = function() return 4 end, RequestLoadItemDataByID = function() end,
  GetDetailedItemLevelInfo = function(item) return tostring(item):find("item:2371") and 678 or 671, false, 650 end,
  GetItemIconByID = function(id) return 134400 + id % 100 end,
  GetItemInfoInstant = function(item)
    local s = tostring(item)
    local id = tonumber(s:match("item:(%d+)") or s:match("^(%d+)$"))
    local it = ITEM[id] or { "INVTYPE_HEAD", 4, 4 }
    return id, it[2] == 2 and "Arme" or "Armure", it[2] == 2 and "Épée" or SUBTYPE[it[3]], it[1], 0, it[2], it[3]
  end }
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
local GAME = { ["Format.lua"] = true, ["Comm.lua"] = true, ["Groups.lua"] = true, ["Compo.lua"] = true, ["Recorder.lua"] = true, ["Pages.lua"] = true,
  ["Loot.lua"] = true, ["LootUI.lua"] = true }
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

-- Doublure du moteur du butin (Loot.lua), selon le contrat de R3b : objets du chef de butin, conseil (LO, LA, LV, LC),
-- jets (RS, premier jet de chacun, relance des ex æquo), attribution annoncée au raid et chuchotée au gagnant, garder,
-- échange, propositions reçues et réponses, joueurs sans l'addon qui n'ont pas passé. Mode essai : ns.Loot.test.
local function lootStub()
  local L, F = {}, ns.Format
  local items, councils, rolls, offers, notPassed = {}, {}, {}, {}, {}
  local seq, master, enabled, activeRoll = 0, nil, false, nil
  local LABEL = { bis = "BiS", upgrade = "Upgrade", off = "Off-spec", transmo = "Transmo" }
  local function me() return ns.Comm.Me() end
  local function test() return L.test end
  local function send(msg, dist, target) if test() then return test().send(msg, dist, target) end return ns.Comm.Send(msg, dist, target) end
  local function say(text, chatType, target)
    if test() then return test().say(text, chatType, target) end
    SendChatMessage(text, chatType, nil, target)
  end
  local function find(key) for _, e in ipairs(items) do if e.key == key then return e end end end
  local function ui() if ns.LootUI and ns.LootUI.Refresh then ns.LootUI.Refresh() end end
  local function first(name) return (F.Split(name)) end
  local function councilNames() return test() and test().council or { me() } end
  function L.Master() return test() and me() or master or me() end
  function L.IsMaster() return test() ~= nil or F.SameName(L.Master(), me()) end
  function L.SetMaster(name) master = F.FullName(name) end
  function L.Enabled() return test() ~= nil or enabled end
  function L.SetEnabled(on) enabled = on and true or false end
  function L.AutoPass() local d = ns.db() return not (d and d.autoPass == false) end
  function L.Items() return items end
  function L.AddTestItem(link, expires)
    seq = seq + 1
    local e = { key = "o" .. seq, itemId = tonumber(link:match("item:(%d+)")), link = link, name = link:match("|h%[(.-)%]|h"),
      ilvl = 678, quality = 4, at = time(), expires = time() + (expires or 7200), status = "new" }
    items[#items + 1] = e
    ui()
    return e.key
  end
  function L.StartCouncil(key)
    local e = find(key)
    if not (e and e.status == "new") then return nil end
    seq = seq + 1
    local s = tostring(seq)
    e.status, e.session = "council", s
    councils[s] = { key = key, link = e.link, name = e.name, ilvl = e.ilvl, cands = {}, closed = false }
    send("LO;" .. s .. ";" .. e.link:match("|H(item:[^|]+)|h") .. ";" .. e.name, "RAID")
    ui()
    return s
  end
  function L.IsCouncil() return true end
  function L.Council(s) return councils[tostring(s)] end
  local function cand(c, name)
    for _, x in ipairs(c.cands) do if F.SameName(x.name, name) then return x end end
    local x = { name = F.FullName(name), votes = 0, voters = {} }
    c.cands[#c.cands + 1] = x
    return x
  end
  local function vote(c, voter, name)
    local k = F.Key(voter)
    for _, x in ipairs(c.cands) do if x.voters[k] then x.voters[k] = nil x.votes = x.votes - 1 end end
    if name and name ~= "" then local x = cand(c, name) x.voters[k] = true x.votes = x.votes + 1 end
  end
  function L.Vote(s, name)
    local c = councils[tostring(s)]
    if not c or c.closed then return false end
    c.myVote = name
    vote(c, me(), name)
    for _, n in ipairs(councilNames()) do if not F.SameName(n, me()) then send("LV;" .. s .. ";" .. (name or ""), "WHISPER", n) end end
    ui()
    return true
  end
  function L.StartRoll(key, kind)
    local e = find(key)
    if not (e and e.status == "new") then return false end
    e.status, activeRoll = "roll", key
    rolls[key] = { kind = kind, rows = {}, winners = {} }
    send("RS;" .. e.itemId .. ";" .. kind, "RAID")
    say("Jets pour " .. e.link .. (kind == "free" and " : /roll 100" or " : MS /roll 100, OS /roll 99"), "RAID")
    ui()
    return true
  end
  local function best(list, field)
    local top, who = nil, {}
    for _, x in ipairs(list) do
      local v = x[field]
      if v then if not top or v > top then top, who = v, { x } elseif v == top then who[#who + 1] = x end end
    end
    return who, top
  end
  function L.OnRoll(name, value, lo, hi)
    local r = activeRoll and rolls[activeRoll]
    if not r or lo ~= 1 then return end
    local kind = (r.kind == "free" and hi == 100 and "free") or (r.kind ~= "free" and ((hi == 100 and "ms") or (hi == 99 and "os"))) or nil
    if not kind then return end
    name = F.FullName(name)
    local row
    for _, x in ipairs(r.rows) do if F.SameName(x.name, name) then row = x end end
    if row then
      if not (r.tie and row.tied and not row.reroll) then return end -- le premier jet compte ; seuls les ex æquo relancent
      row.reroll = value
    else
      r.rows[#r.rows + 1] = { name = name, roll = value, hi = hi, kind = kind }
    end
    local group = {}
    for _, x in ipairs(r.rows) do if x.kind == (r.kind == "free" and "free" or "ms") then group[#group + 1] = x end end
    if #group == 0 then for _, x in ipairs(r.rows) do if x.kind == "os" then group[#group + 1] = x end end end
    local who, top = best(group, "roll")
    if #who > 1 then
      local all = true
      for _, x in ipairs(who) do x.tied = true if not x.reroll then all = false end end
      if all then who = best(who, "reroll") end
    end
    r.winners, r.tie = {}, nil
    for _, x in ipairs(who) do r.winners[#r.winners + 1] = x.name end
    if #who > 1 then
      r.tie = r.winners
      if not r.announced then
        r.announced = true
        local names = {}
        for _, x in ipairs(who) do names[#names + 1] = first(x.name) end
        say("Égalité à " .. top .. " : " .. table.concat(names, " et ") .. " relancent", "RAID")
      end
    end
    ui()
  end
  function L.Rolls(key) return rolls[key] end
  function L.Award(key, winner, method, response, detail)
    local e = find(key)
    if not e then return false end
    winner = F.FullName(winner)
    e.status, e.winner, e.method, e.response, e.detail = "awarded", winner, method, response, detail
    if activeRoll == key then activeRoll = nil end
    local c = e.session and councils[e.session]
    if c then c.closed = true send("LC;" .. e.session .. ";" .. winner, "RAID") end
    local why = method == "council" and ("conseil : " .. (LABEL[response] or "")) or detail or "chef de butin"
    say(first(winner) .. " reçoit " .. e.link .. " (" .. why .. ")", "RAID")
    say("Tu reçois " .. e.link .. " : passe me voir pour l'échange", "WHISPER", winner)
    ui()
    return true
  end
  function L.Keep(key)
    local e = find(key)
    if not (e and e.status == "new") then return false end
    e.status, e.winner, e.method = "kept", me(), "ml"
    say(first(me()) .. " garde " .. e.link, "RAID")
    ui()
    return true
  end
  function L.Trade(key)
    local e = find(key)
    if not (e and e.status == "awarded") then return false end
    if test() then return test().trade(e) end
    return false
  end
  function L.Remove(key) for i, e in ipairs(items) do if e.key == key then table.remove(items, i) break end end ui() end
  function L.Offers() return offers end
  function L.Answer(s, response, note)
    local o = offers[tostring(s)]
    if not o or o.closed then return false end
    o.response, o.note = response, note
    local seen = {}
    for _, n in ipairs({ o.from, unpack(councilNames()) }) do
      local k = F.Key(n)
      if k and not seen[k] then seen[k] = true send("LA;" .. s .. ";" .. response .. ";;" .. (note or ""), "WHISPER", n) end
    end
    ui()
    return true
  end
  function L.NotPassed() return notPassed end
  function L.WhisperNotPassed(name)
    for _, x in ipairs(notPassed) do
      if F.SameName(x.name, name) then
        x.whispered = true
        say("Tu as gagné " .. (x.link or "un objet") .. " au butin de groupe : garde-le, je viens te l'échanger.", "WHISPER", x.name)
        ui()
        return true
      end
    end
    return false
  end
  function L.StopTest()
    for _, t in ipairs({ items, councils, rolls, offers, notPassed }) do wipe(t) end
    activeRoll, L.test = nil, nil
  end
  -- Messages des autres addons (et les siens, reçus comme en jeu)
  ns.Comm.On("LO", function(sender, f)
    if not F.SameName(sender, L.Master()) then return end
    local s = f[2]
    offers[s] = offers[s] or { session = s, from = sender, name = f[4], link = "|cffa335ee|H" .. f[3] .. "|h[" .. (f[4] or "?") .. "]|h|r" }
    if ns.LootUI and ns.LootUI.ShowOffer then ns.LootUI.ShowOffer(s) end
  end)
  ns.Comm.On("LA", function(sender, f)
    local c = councils[f[2]]
    if not c or c.closed then return end
    local x = cand(c, sender)
    x.response, x.gear, x.note = f[3], f[4], f[5]
    x.received = test() and test().received and test().received[x.name] or 0
    ui()
  end)
  ns.Comm.On("LV", function(sender, f) local c = councils[f[2]] if c and not c.closed then vote(c, sender, f[3]) ui() end end)
  ns.Comm.On("LC", function(_, f) local o = offers[f[2]] if o then o.closed, o.winner = true, f[3] end ui() end)
  return L
end
if ns.Loot == nil then ns.Loot = lootStub() stub.Loot = true end
install("LootUI", { ShowLoot = function() end, ShowCouncil = function() end, ShowOffer = function() end, ShowHandover = function() end, Refresh = function() end })

-- Contrat des retours du raid de test (moteur 0.3, fait à part) : doublures posées seulement là où le moteur ne l'a pas
-- encore. L.CanUseClass (règle de l'armure), L.CanUse (le joueur est druide), L.StartAllCouncils, L.Councils (numéro =
-- ordre de proposition) ; et, seulement sans ce contrat : L.Council complété (num ; par candidat canUse, receivedBis,
-- receivedUp, receivedMs : site et ce soir) et L.OnWhisper qui lit « bis 2 » (règle de l'armure du chef de butin).
local Lo = ns.Loot
local NEW = Lo.StartAllCouncils ~= nil and Lo.Councils ~= nil and Lo.CanUseClass ~= nil
local function stubNew(fn, impl) if Lo[fn] == nil then Lo[fn] = impl stub["Loot 0.3"] = true end end
local ARMOR = { MAGE = 1, PRIEST = 1, WARLOCK = 1, DEMONHUNTER = 2, DRUID = 2, MONK = 2, ROGUE = 2, EVOKER = 3, HUNTER = 3, SHAMAN = 3,
  DEATHKNIGHT = 4, PALADIN = 4, WARRIOR = 4 }
local ARMOR_NAME = { "tissu", "cuir", "mailles", "plaques" }
local ARMOR_SLOT = { INVTYPE_HEAD = true, INVTYPE_SHOULDER = true, INVTYPE_CHEST = true, INVTYPE_ROBE = true, INVTYPE_WAIST = true,
  INVTYPE_LEGS = true, INVTYPE_FEET = true, INVTYPE_WRIST = true, INVTYPE_HAND = true }
stubNew("CanUseClass", function(item, class)
  local _, _, _, loc, _, cls, sub = C_Item.GetItemInfoInstant(item or "")
  if not (cls == 4 and ARMOR_SLOT[loc or ""] and ARMOR_NAME[sub or 0] and ARMOR[class or ""]) then return nil end
  if ARMOR[class] == sub then return true end
  return false, "armure en " .. ARMOR_NAME[sub]
end)
stubNew("CanUse", function(item) local _, class = UnitClass("player") return Lo.CanUseClass(item, class) end)
local function rawCouncils()
  local list = {}
  for _, c in pairs(Lo.councils or {}) do if time() - (c.at or 0) < 7200 then list[#list + 1] = c end end
  table.sort(list, function(a, b)
    if (a.at or 0) ~= (b.at or 0) then return (a.at or 0) < (b.at or 0) end
    return (tonumber(a.session) or 0) < (tonumber(b.session) or 0)
  end)
  return list
end
local engineCouncil = Lo.Council
stubNew("Councils", function()
  local out = {}
  for i, raw in ipairs(rawCouncils()) do
    local c = engineCouncil(raw.session)
    out[i] = { session = raw.session, num = i, link = c.link, name = c.name, ilvl = c.ilvl, itemId = c.itemId, master = c.master,
      closed = c.closed, winner = c.winner, answers = #c.cands, waiting = #c.waiting, myVote = c.myVote }
  end
  return out
end)
stubNew("StartAllCouncils", function()
  local sessions, fresh = {}, {}
  for _, e in ipairs(Lo.Items()) do if e.status == "new" then fresh[#fresh + 1] = e end end
  for _, e in ipairs(fresh) do
    local ok, sid = Lo.StartCouncil(e.key)
    if not ok then break end
    sessions[#sessions + 1] = (type(ok) == "string" and ok) or sid or e.session
  end
  if sessions[1] and ns.LootUI.ShowCouncil then ns.LootUI.ShowCouncil(sessions[1]) end
  return #sessions, sessions
end)
if not NEW then
  local F = ns.Format
  local function numOf(session) for i, raw in ipairs(rawCouncils()) do if raw.session == session then return i end end end
  -- Détail des objets reçus : entrée du site (D) et objets de ce soir (conseil BiS / Upgrade, jet MS)
  local function detail(name)
    local e = Lo.test and F.CountFor(Lo.test.counts, name)
    local bis, up, ms = e and e.bis or 0, e and e.up or 0, e and e.ms or 0
    for _, l in ipairs(Lo.test and Lo.testLog.loot or {}) do
      for _, nm in ipairs(e and e.names or { name }) do
        if F.SameName(l.who, nm) then
          if l.method == "council" and l.response == "bis" then bis = bis + 1
          elseif l.method == "council" and l.response == "upgrade" then up = up + 1
          elseif l.method == "roll" and tostring(l.detail):find("^MS") then ms = ms + 1 end
          break
        end
      end
    end
    return bis, up, ms
  end
  Lo.Council = function(session)
    local c = engineCouncil(session)
    if not c then return nil end
    local raw = Lo.councils[session]
    if c.num == nil then c.num = numOf(session) end
    for _, x in ipairs(c.cands) do
      local m = Lo.Member(x.name)
      if x.canUse == nil and raw and m and m.class then x.canUse = Lo.CanUseClass(raw.itemString, m.class) end
      if x.receivedBis == nil then x.receivedBis, x.receivedUp, x.receivedMs = detail(x.name) end
    end
    return c
  end
  local onWhisper = Lo.OnWhisper
  local WH = { bis = "bis", up = "upgrade", upgrade = "upgrade", os = "off", off = "off", transmo = "transmo", pass = "pass", passe = "pass" }
  Lo.OnWhisper = function(text, sender)
    local word, num = tostring(text or ""):lower():match("^%s*(%S+)%s+(%d+)%s*$")
    if not (word and WH[word]) then return onWhisper and onWhisper(text, sender) end
    local r, who, m = WH[word], F.FullName(sender), Lo.Member(sender)
    local raw = rawCouncils()[tonumber(num)]
    if not (raw and who) or raw.closed then return end
    if (r == "bis" or r == "upgrade" or r == "off") and m and Lo.CanUseClass(raw.itemString, m.class) == false then r = "transmo" end
    ns.Comm.Deliver(ns.Comm.Me(), "LA;" .. raw.session .. ";" .. r .. ";;chuchoté;" .. who, "SELF")
  end
end
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
  { "Compo", "Invite" }, { "Compo", "Arrange" }, { "Comm", "AskVersions" }, { "LootUI", "ShowLoot" }, { "LootUI", "ShowCouncil" },
  { "LootUI", "ShowOffer" }, { "LootUI", "ShowHandover" } }) do spy(s[1], s[2]) end
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
-- Bouton « label » de la ligne d'une liste dont le texte affiché contient « pattern » (deux lignes Oui / Non dans Options)
local function clickRow(pattern, label)
  for text, fs in pairs(TEXTS) do
    local row = type(text) == "string" and fs:GetText() == text and text:find(pattern, 1, true) and fs.parent
    if row then
      for _, group in ipairs({ rawget(row, "sbuttons") or {}, rawget(row, "buttons") or {} }) do
        for _, b in pairs(group) do
          local t = rawget(b, "label") and b.label:GetText() or b:GetText()
          if t == label and b:IsShown() then return script(b, "OnClick") end
        end
      end
    end
  end
  error("bouton « " .. label .. " » de la ligne « " .. pattern .. " »")
end

-- 1. Chargement : socle, couleurs de Roster dans la boîte à outils, contrôle des modules
assert(TOC_VERSION and ns.name == "Roster" and ns.version == TOC_VERSION and ns.LOGO == "Interface\\AddOns\\Roster\\Media\\Logo", "nom, version, logo")
assert(ns.db() == nil, "pas de sauvegarde avant ADDON_LOADED")
local K = ns.Kit
assert(K and K.C.gold == ns.palette.gold and K.C.frame == ns.palette.frame and K.ACCENT == "|cffa9c6ea", "accent argent-azur dans la boîte à outils")
assert(K.hex({ 1, 0, 0.5 }) == "|cffff0080", "code couleur")
ns.UI.Refresh() -- fenêtre jamais construite : sans effet
fire("ADDON_LOADED", "AutreAddon")
assert(RosterDB == nil, "ADDON_LOADED d'un autre addon ignoré")
fire("ADDON_LOADED", "Roster")
assert(RosterDB and RosterDB.version == TOC_VERSION and ns.db() == RosterDB, "sauvegarde créée")
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
assert(printed[before + 1]:find("version " .. TOC_VERSION, 1, true) and #printed - before >= 9, "aide")
local help = table.concat(printed, "\n", before + 1)
assert(help:find("/roster butin", 1, true) and help:find("/roster remettre", 1, true) and help:find("/roster test", 1, true), "aide : butin, remettre, test")
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
clickRow("Relever la présence", "Non")
assert(RosterDB.record == false and RosterDB.autoPass == nil, "relevé coupé")
clickRow("Relever la présence", "Oui")
assert(RosterDB.record == nil, "relevé remis (nil = activé)")
-- Distribution par Roster : passer automatiquement (nil = oui, false = non ; lu par Loot.lua)
assert(ns.Loot.AutoPass() == true, "passer automatiquement par défaut")
clickRow("Passer automatiquement quand le chef de butin distribue (Distribution par Roster)", "Non")
assert(RosterDB.autoPass == false and ns.Loot.AutoPass() == false and RosterDB.record == nil, "passer automatiquement coupé")
local autoRow
for text, fs in pairs(TEXTS) do if type(text) == "string" and fs:GetText() == text and text:find("Passer automatiquement", 1, true) then autoRow = text end end
assert(autoRow and autoRow:find("non") and autoRow:find("passe toi-même", 1, true), "option coupée : explication")
clickRow("Passer automatiquement", "Oui")
assert(RosterDB.autoPass == nil and ns.Loot.AutoPass() == true, "passer automatiquement remis (nil = activé)")
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


-- 8. Distribution du butin (R3b, retours du raid de test 0.3) : commandes, puis le raid d'essai de bout en bout (moteur de
-- Loot.lua ou sa doublure). Minuteurs différés : les joueurs fictifs répondent, votent et lancent leurs dés quand le temps
-- avance (advance).
local Lt, T, F = ns.Loot, ns.Test, ns.Format
local U = ns.LootUI
local function entries()
  local list, out = Lt.Items() or {}, {}
  if #list > 0 then for _, e in ipairs(list) do out[#out + 1] = e end
  else
    for _, e in pairs(list) do out[#out + 1] = e end
    table.sort(out, function(a, b) return (a.at or 0) < (b.at or 0) end)
  end
  return out
end
local function byStatus(st) local c = 0 for _, e in ipairs(entries()) do if e.status == st then c = c + 1 end end return c end
local function nameOf(x) return type(x) == "table" and (x.name or x[1]) or x end
local function cand(c, name) for _, x in ipairs(c and c.cands or {}) do if F.SameName(x.name, name) then return x end end end
local function votesOf(x) if type(x.votes) == "number" then return x.votes end local k = 0 for _ in pairs(x.voters or x.votes or {}) do k = k + 1 end return k end
local function offerOf(s) for _, o in ipairs(Lt.Offers() or {}) do if tostring(o.session) == tostring(s) then return o end end end
-- Ligne de chat de l'essai (« [essai] … ») affichée depuis la ligne « from »
local function said(from, pattern)
  for i = from + 1, #printed do if printed[i]:find("^|cff9aa3b6%[essai%]|r ") and printed[i]:find(pattern) then return printed[i] end end
end
-- Fenêtres du butin : bande d'objets (boutons affichés), lignes du tableau du conseil et leurs boutons, réponses
local function win(kind) return ns.LootUI.Windows()[kind] end
local function chips(w) local out = {} for _, b in ipairs(w.band.chips) do if b:IsShown() then out[#out + 1] = b end end return out end
local function rows(w) local out = {} for k = 1, w.grid.n do out[k] = w.grid.rows[k] end return out end
local function rowOf(w, who) for _, r in ipairs(rows(w)) do if r.cells[1]:GetText():find(who, 1, true) then return r end end end
local function rowButton(r, label) for _, b in ipairs(r and r.buttons or {}) do if b:IsShown() and b:GetText() == label then return b end end end
local function give(w, who) script(assert(rowButton(assert(rowOf(w, who), "ligne de " .. who), "Donner"), "« Donner » pour " .. who), "OnClick") end
-- Donner au premier joueur fictif qui le veut (pas toi)
local function giveFirst(w)
  for _, r in ipairs(rows(w)) do
    local b = rowButton(r, "Donner")
    if b and not r.cells[1]:GetText():find("Tournicoti", 1, true) then script(b, "OnClick") return end
  end
  error("personne à qui donner")
end
local function answer(key) script(win("offer").buttons[key], "OnClick") end
local function respOf(s) local o = offerOf(s) return o and o.answered and o.response end
local function hasCheck(text) return tostring(text):find("ReadyCheck-Ready", 1, true) ~= nil end
run("butin")
assert(n("LootUI.ShowLoot") == 1, "/roster butin : fenêtre du butin")
run("remettre")
assert(n("LootUI.ShowHandover") == 1, "/roster remettre : objets à remettre")
deferred = true
local sends0, chat0, pending0 = realSends, realChat, #ns.Recorder.Pending()
IsInGroup = function() return true end
run("essai")
assert(not T.active and Lt.test == nil and printed[#printed]:find("hors groupe"), "raid d'essai refusé dans un groupe")
IsInGroup = function() return false end
run("test")
assert(T.active and Lt.test and T.panel and T.panel:IsShown(), "raid d'essai lancé, panneau affiché")
esc = {}
for _, name in ipairs(UISpecialFrames) do esc[name] = true end
assert(esc.RosterTest, "Échap ferme le panneau de l'essai")
local members, noAddon = Lt.test.members, 0
assert(#members == 10 and F.SameName(members[1].name, ns.Comm.Me()) and Lt.IsMaster() and Lt.Enabled(), "toi, chef de butin, et 9 joueurs fictifs")
for _, m in ipairs(members) do
  assert(m.name:find("^[^%-]+%-[^%-]+$") and m.class and m.subgroup and m.online, "membre « Prénom-Royaume » : " .. m.name)
  if m.addon == false then noAddon = noAddon + 1 end
end
assert(noAddon == 1 and type(Lt.test.send) == "function" and type(Lt.test.say) == "function" and type(Lt.test.trade) == "function", "crochets du moteur")
local kd = F.CountFor(Lt.test.counts, "Kaeldra-Hyjal")
assert(kd and kd.n == 3 and kd.bis == 1 and kd.up == 1 and kd.ms == 1, "objets reçus sur la saison, avec le détail (D)")
run("test")
assert(T.active and not T.panel:IsShown(), "/roster test : panneau masqué, essai en cours")
run("test")
assert(T.panel:IsShown(), "/roster test : panneau réaffiché")

-- Étape 1 : trois objets portés par le joueur, délai d'échange 1 h 52 (et 25 min pour l'un) ; « Tout au conseil (3) »
local loots = n("LootUI.ShowLoot")
click("Recevoir 3 objets")
local its, late = entries(), 0
assert(#its == 3 and byStatus("new") == 3 and n("LootUI.ShowLoot") > loots, "3 objets reçus, fenêtre du butin")
for _, e in ipairs(its) do
  assert(e.key ~= nil and e.link:find("|Hitem:2371%d+:"), "objet porté par le joueur")
  local left = (e.expires or 0) - time()
  if left <= 25 * 60 then late = late + 1 else assert(left >= 110 * 60, "1 h 52 pour l'échange") end
end
assert(late == 1, "un objet à 25 min (en orange)")
assert(U.state.loot.fresh == 3 and TEXTS["Tout au conseil (3)"] and TEXTS["Tout au conseil (3)"]:IsShown(), "fenêtre du butin : « Tout au conseil (3) »")
tick()

-- Étape 2 : tout au conseil ; chacun répond à chaque objet selon son armure (le heaume est en cuir, les spallières en
-- plaques, la cuirasse en tissu), Orvane chuchote « bis 1 », Tharok et Brumelune votent sur chaque objet
local before = #printed
click("Tout au conseil")
its = entries()
local s1, s2, s3 = its[1].session, its[2].session, its[3].session
assert(byStatus("council") == 3 and s1 and s2 and s3, "les 3 objets au conseil d'un coup")
assert(tostring(lastArgs["LootUI.ShowCouncil"][1]) == tostring(s1) and U.state.council.session == s1, "fenêtre du conseil sur le premier objet")
local cw = win("council")
assert(#U.state.council.band == 3 and #chips(cw) == 3 and U.state.council.band[1].num == 1 and U.state.council.band[3].num == 3, "bande du conseil : 3 objets numérotés")
advance(20)
local c1 = Lt.Council(s1)
assert(c1 and #c1.cands >= 9, "les 9 joueurs répondent")
local kael, orv, tharok = cand(c1, "Kaeldra-Hyjal"), cand(c1, "Orvane-Hyjal"), cand(c1, "Tharok-Hyjal")
local function wears(x, id)
  if type(x.gear) ~= "table" then return tostring(x.gear):find(id, 1, true) ~= nil end
  for _, g in ipairs(x.gear) do if tostring(g.id) == id then return true end end
  return false
end
assert(kael and kael.response == "bis" and kael.note == "2e pièce" and wears(kael, "237101"), "réponse, objet porté et note")
assert(tharok and tharok.response == "transmo" and tharok.note == "", "règle de l'armure : un guerrier répond Transmo sur du cuir")
assert(orv and orv.response == "transmo" and said(before, "Orvane%-Hyjal.* te chuchote : bis 1"), "« bis 1 » chuchoté sans l'addon, Transmo (armure) chez le chef de butin")
assert(votesOf(kael) == 1 and votesOf(cand(c1, "Vex-Kael'Thas")) == 1, "Tharok et Brumelune votent pour deux joueurs différents")
local c2 = Lt.Council(s2)
for _, s in ipairs({ s2, s3 }) do
  local c, wanted, nv = Lt.Council(s), false, 0
  assert(#c.cands >= 8, "chacun répond à chaque objet")
  for _, x in ipairs(c.cands) do
    nv = nv + votesOf(x)
    if x.response == "bis" or x.response == "upgrade" or x.response == "off" then wanted = true end
  end
  assert(nv == (wanted and 2 or 0), "Tharok et Brumelune votent sur chaque objet")
end
for _, nm in ipairs({ "Kaeldra-Hyjal", "Brumelune-Ysondre", "Vex-Kael'Thas", "Lysenn-Dalaran", "Mirwen-Hyjal" }) do
  local x = cand(c2, nm)
  assert(x and (x.response == "transmo" or x.response == "pass"), "plaques : " .. nm .. " répond Transmo ou Passer")
end

-- Ta réponse (chef de butin) : bande de 3 objets, réponse, objet suivant tout seul ; objet pas portable : Transmo, Passer
local ow = win("offer")
assert(offerOf(s1) and ow and ow:IsShown() and U.state.offer.session == s1, "fenêtre de réponse chez le chef de butin aussi, sur le premier objet")
assert(#U.state.offer.band == 3 and #chips(ow) == 3 and #U.state.offer.buttons == 5, "bande de 3 objets ; objet portable : cinq réponses")
ow.note:SetText("pour voir")
answer("upgrade")
assert(respOf(s1) == "upgrade" and U.state.offer.session == s2, "réponse envoyée, objet suivant tout seul")
local mine = cand(Lt.Council(s1), ns.Comm.Me())
assert(mine and mine.response == "upgrade" and mine.note == "pour voir", "ta réponse au conseil, avec la note")
assert(U.state.offer.usable == false and table.concat(U.state.offer.buttons, ",") == "transmo,pass", "objet pas portable : seulement Transmo et Passer")
assert(not ow.buttons.bis:IsShown() and not ow.buttons.upgrade:IsShown() and not ow.buttons.off:IsShown() and ow.buttons.transmo:IsShown() and ow.buttons.pass:IsShown(), "boutons BiS, Upgrade et Off-spec masqués")
assert(ow.warn:IsShown() and ow.warn:GetText():find("Tu ne peux pas porter cet objet", 1, true), "raison affichée")
assert(ow.note:GetText() == "" and not ow.close:IsShown(), "note propre à chaque objet")
answer("transmo")
assert(U.state.offer.session == s3 and not U.state.offer.done, "objet suivant sans réponse")
answer("pass")
assert(U.state.offer.done and U.state.offer.session == s3 and ow:IsShown() and ow.close:IsShown(), "tout répondu : la fenêtre reste ouverte, « Fermer »")
assert(ow.done:GetText():find("Tes réponses", 1, true), "tes réponses résumées")
for i, r in ipairs({ "upgrade", "transmo", "pass" }) do
  local b = U.state.offer.band[i]
  assert(b.answered and b.response == r and hasCheck(b.text), "bande : coche et initiale de la réponse")
end
ns.LootUI.ShowOffer(s2)
assert(U.state.offer.session == s2, "U.ShowOffer(session) choisit cet objet")
script(chips(ow)[1], "OnClick")
assert(U.state.offer.session == s1 and ow.note:GetText() == "pour voir", "bande : retour au premier objet, avec sa note")
answer("bis")
assert(respOf(s1) == "bis" and cand(Lt.Council(s1), ns.Comm.Me()).response == "bis" and U.state.offer.session == s1, "réponse changée tant que le conseil est ouvert")

-- Conseil : ton vote départage, « Donner », puis le conseil suivant tout seul
cw = win("council")
assert(U.state.council.session == s1, "conseil du premier objet")
script(assert(rowButton(rowOf(cw, "Kaeldra"), "Voter"), "« Voter »"), "OnClick")
advance(1)
assert(votesOf(cand(Lt.Council(s1), "Kaeldra-Hyjal")) == 2, "ton vote départage")
before = #printed
give(cw, "Kaeldra")
advance(1)
local e1 = entries()[1]
assert(e1.status == "awarded" and F.SameName(e1.winner, "Kaeldra-Hyjal") and e1.response == "bis", "objet donné (conseil : BiS)")
assert(said(before, "%] .*Kaeldra.* reçoit ") and said(before, "^|cff9aa3b6%[essai%]|r À Kaeldra"), "annonce au raid et chuchotement, dans ta fenêtre seulement")
assert(U.state.council.session == s2, "« Donner » : conseil ouvert suivant")
assert(U.state.council.band[1].closed and hasCheck(U.state.council.band[1].text) and U.state.council.band[1].text:find("Kaeldra", 1, true), "bande : coche et gagnant")
assert(U.state.council.band[2].text:find("^|cff%x+%d+/10|r$"), "bande : réponses sur joueurs (« 9/10 »)")
-- Spallières en plaques : Kaeldra ne peut pas les porter ; colonne « Reçus » : total et détail
local kr = rowOf(cw, "Kaeldra")
assert(kr.cells[1]:GetText():find("ne peut pas le porter", 1, true) and kr.cells[2]:GetText():find("^|cff9aa3b6"), "ne peut pas le porter : réponse grisée, mention")
assert(not rowOf(cw, "Tharok").cells[1]:GetText():find("ne peut pas", 1, true), "un guerrier peut porter des plaques")
assert(kr.cells[5]:GetText():find("^|cffffffff%d+|r") and kr.cells[5]:GetText():find("\n|cff9aa3b6%d+ BiS · %d+ Up · %d+ MS|r$"), "Reçus : total, puis BiS · Up · MS")
GameTooltip.lines = {}
GameTooltip.AddLine = function(self, text) self.lines[#self.lines + 1] = text end
script(kr.hover[5], "OnEnter")
local tipText = table.concat(GameTooltip.lines, "\n")
assert(tipText:find("sur le site", 1, true) and tipText:find("ce soir", 1, true) and tipText:find("Ne comptent pas : Off-spec, Transmo, jets OS et libres, objets gardés.", 1, true), "infobulle des reçus : site, ce soir, ce qui compte")
GameTooltip.AddLine = nil
-- Tri par objets reçus (en-tête), le moins servi d'abord, ceux qui passent en bas ; puis retour au tri du moteur
script(cw.sort, "OnClick")
assert(U.state.council.byReceived and cw.grid.head[5]:GetText():find("(tri)", 1, true), "tri par objets reçus")
local prev, passing = -1, false
for _, r in ipairs(rows(cw)) do
  local recv = tonumber(r.cells[5]:GetText():match("^|cffffffff(%d+)"))
  if r.cells[2]:GetText():find("Passer", 1, true) then passing = true
  else assert(recv and not passing and recv >= prev, "tri : le moins servi d'abord, ceux qui passent en bas") prev = recv end
end
script(cw.sort, "OnClick")
assert(not U.state.council.byReceived, "retour au tri par réponse, puis votes")
giveFirst(cw)
advance(1)
assert(U.state.council.session == s3 and entries()[2].status == "awarded", "conseil suivant après « Donner »")
giveFirst(cw)
advance(1)
assert(byStatus("council") == 0 and U.state.council.session == s3, "plus de conseil ouvert : le dernier reste affiché")
for _, b in ipairs(U.state.council.band) do assert(b.closed and hasCheck(b.text), "bande : conseils terminés, cochés") end
script(chips(cw)[1], "OnClick")
assert(U.state.council.session == s1, "bande : clic sur le premier objet")
ns.LootUI.ShowCouncil(s2)
assert(U.state.council.session == s2, "U.ShowCouncil(session) choisit ce conseil")
assert(not ow:IsShown(), "conseils terminés : fenêtre de réponse fermée")

-- Étape 3 : jets MS / OS (plus rien à distribuer : un objet de plus arrive), égalité à 87, relance des ex æquo
before = #printed
click("Lancer les jets MS / OS")
local e2 = entries()[4]
assert(#entries() == 4 and e2.status == "roll" and said(before, "tu reçois le butin"), "un objet de plus arrive, jets ouverts")
advance(4.2)
local r2 = Lt.Rolls(e2.key)
assert(r2 and r2.tie, "égalité à 87")
assert(said(before, "Ashlen%-Hyjal.* obtient un 87 %(1%-100%)") and said(before, "Vex%-Kael'Thas.* obtient un 87") and said(before, "obtient un 95 %(1%-99%)"), "jets dans ta fenêtre de chat")
advance(1)
assert(said(before, "égalité entre .*Relancer"), "égalité signalée : « Relancer »")
assert(Lt.Reroll(e2.key), "relance des ex æquo")
advance(5)
r2 = Lt.Rolls(e2.key)
assert(not r2.tie and r2.winners and F.SameName(nameOf(r2.winners[1]), "Vex-Kael'Thas") and said(before, "obtient un 71"), "relance : Vex l'emporte")
Lt.Award(e2.key, "Vex-Kael'Thas", "roll", nil, "MS 71")

-- Étape 4 : jet libre
click("Lancer le jet libre")
local e3 = entries()[5]
advance(5)
local r3 = Lt.Rolls(e3.key)
assert(e3.status == "roll" and r3 and not r3.tie and F.SameName(nameOf(r3.winners[1]), "Mirwen-Hyjal"), "jet libre : Mirwen l'emporte")
Lt.Award(e3.key, "Mirwen-Hyjal", "roll", nil, "jet 88")

-- Étape 5 : garder (plus d'objet à attribuer : un de plus arrive)
click("Garder le suivant")
its = entries()
assert(#its == 6 and its[6].status == "kept", "objet gardé")

-- Étape 6 : objets à remettre, minicarte, échange simulé
local handovers = n("LootUI.ShowHandover")
click("Objets à remettre")
assert(n("LootUI.ShowHandover") == handovers + 1 and byStatus("awarded") == 5, "objets à remettre")
assert(win("handover").hintText:GetText():find("posés tout seuls", 1, true), "échange : objets posés tout seuls")
M.Update()
assert(M.handover == 5, "minicarte : 5 objets à remettre")
script(M.button, "OnEnter")
IsShiftKeyDown = function() return true end
script(M.button, "OnClick", "LeftButton")
IsShiftKeyDown = function() return false end
assert(n("LootUI.ShowHandover") == handovers + 2 and not ns.UI.IsShown(), "minicarte : Maj+clic, objets à remettre")
T.Refresh()
before = #printed
click("Échanger")
advance(3)
assert(byStatus("traded") == 1 and byStatus("awarded") == 4 and said(before, "échange réussi"), "échange simulé réussi")

-- Étape 7 : joueur sans l'addon qui n'a pas passé, chuchotement
before = #printed
click("Orvane gagne un objet")
local found
for _, x in pairs(Lt.NotPassed() or {}) do if F.SameName(nameOf(x), "Orvane-Hyjal") then found = x end end
assert(found and said(before, "Orvane%-Hyjal.* reçoit le butin"), "joueur sans l'addon : il n'a pas passé")
click("Chuchoter à Orvane")
assert(said(before, "^|cff9aa3b6%[essai%]|r À Orvane"), "chuchoté à Orvane, dans ta fenêtre seulement")

-- Étape 8 : côté joueur, Tharok propose deux objets (le second en mailles : pas pour un druide) ; un troisième arrive
-- pendant ta réponse ; réponse changée ; Tharok termine ses conseils après ta dernière réponse
before = #printed
click("Recevoir 2 propositions")
assert(tostring(lastArgs["LootUI.ShowOffer"][1]) == "901" and offerOf("901") and offerOf("902"), "deux objets proposés")
assert(ow:IsShown() and U.state.offer.session == "901" and #U.state.offer.band == 2 and #U.state.offer.buttons == 5, "bande de 2 objets, le premier choisi")
ns.Comm.Deliver("Tharok-Hyjal", "LO;903;item:237107::::::::90:577::6:2:12251:1540;Jambières runiques", "RAID")
assert(#U.state.offer.band == 3 and #chips(ow) == 3 and U.state.offer.session == "901", "un nouvel objet s'ajoute à la bande sans voler la sélection")
answer("bis")
assert(respOf("901") == "bis" and U.state.offer.session == "902", "objet suivant tout seul")
assert(U.state.offer.usable == false and table.concat(U.state.offer.buttons, ",") == "transmo,pass" and U.state.offer.band[2].text == "", "objet d'une autre armure : seulement Transmo et Passer")
answer("transmo")
assert(U.state.offer.session == "903", "objet suivant sans réponse")
script(chips(ow)[1], "OnClick")
answer("pass")
assert(respOf("901") == "pass" and U.state.offer.session == "903", "réponse changée, puis l'objet encore sans réponse")
answer("upgrade")
assert(U.state.offer.done and ow.close:IsShown(), "tout répondu")
advance(8)
assert(not offerOf("901") and not offerOf("902") and offerOf("903") and ow:IsShown() and #U.state.offer.band == 1 and U.state.offer.session == "903", "Tharok termine ses deux conseils ; le troisième reste")
assert(said(before, "Tharok%-Hyjal.* : Kaeldra.* reçoit .*Heaume") and said(before, "Tournicoti reçoit .*%(conseil : Transmo%)"), "réponse changée prise en compte")
script(ow.close, "OnClick")
assert(not ow:IsShown(), "« Fermer »")
ns.Comm.Deliver("Tharok-Hyjal", "LC;903;Kaeldra-Hyjal", "RAID")
assert(not offerOf("903") and not ow:IsShown(), "dernier conseil terminé : la fenêtre reste fermée")
ns.Comm.Deliver("Tharok-Hyjal", "LO;904;item:237101::::::::90:577::6:2:12251:1540;Heaume du veilleur", "RAID")
assert(ow:IsShown() and U.state.offer.session == "904" and #U.state.offer.band == 1, "un seul objet proposé")
answer("off")
assert(respOf("904") == "off" and not ow:IsShown(), "un seul objet : fenêtre fermée après la réponse (comme en 0.2)")
ns.Comm.Deliver("Tharok-Hyjal", "LC;904;Kaeldra-Hyjal", "RAID")
assert(not offerOf("904") and not ow:IsShown(), "conseil terminé")
tick()

-- Conseils suivants : six objets ; « Tout au conseil (6) » de la fenêtre du butin, moteur sans L.StartAllCouncils (repli :
-- un conseil par objet) ; anneau : deux objets portés par réponse ; bande trop longue : flèches ; jets au hasard
click("Recevoir 3 objets")
click("Recevoir 3 objets")
assert(U.state.loot.fresh == 6 and TEXTS["Tout au conseil (6)"]:IsShown(), "« Tout au conseil (6) »")
local all = Lt.StartAllCouncils
Lt.StartAllCouncils = nil
click("Tout au conseil (6)")
Lt.StartAllCouncils = all
assert(byStatus("council") == 6 and U.state.council.session == entries()[7].session, "repli : un conseil par objet, fenêtre sur le premier")
advance(30)
local ring
for _, e in ipairs(entries()) do if e.status == "council" and e.link:find("Anneau de givre", 1, true) then ring = e end end
local c5, pair = Lt.Council(ring.session), false
assert(#c5.cands >= 8, "conseil suivant : chacun répond")
for _, x in ipairs(c5.cands) do
  local g = x.gear
  if type(g) == "table" and #g == 2 and g[1].id == 237111 and g[2].id == 237112 and g[1].ilvl and g[2].ilvl then pair = true end
  if type(g) == "string" and g:find("^237111:%d+,237112:%d+$") then pair = true end
end
assert(pair, "anneau : les deux anneaux portés")
assert(ow:IsShown() and #U.state.offer.band == 6, "ta réponse : 6 objets dans la bande")
for _, b in ipairs(ow.band.chips) do b.num.GetStringWidth = function() return 150 end end -- boutons larges
ow.band.Layout()
assert(#chips(ow) < 6 and ow.band.next:IsShown() and not ow.band.prev:IsShown(), "bande trop longue : flèche")
script(ow.band.next, "OnClick")
assert(ow.band.first == 2 and ow.band.prev:IsShown(), "flèche : objets suivants")
local last = chips(ow)[#chips(ow)]
script(last, "OnClick")
local visible = false
for _, b in ipairs(chips(ow)) do if b.entry.key == U.state.offer.session then visible = true end end
assert(U.state.offer.session == last.entry.key and visible, "objet choisi dans la bande, toujours visible")
for _, b in ipairs(ow.band.chips) do b.num.GetStringWidth = nil end
click("Lancer les jets MS / OS")
advance(10)
its = entries()
assert(its[#its].status == "roll" and #Lt.Rolls(its[#its].key).rows >= 4, "jets suivants au hasard")

-- Tout est resté local : aucun message d'addon ni ligne de chat envoyés, rien de relevé pour le site
assert(realSends == sends0 and realChat == chat0, "rien n'est parti au raid ni aux joueurs")
assert(#ns.Recorder.Pending() == pending0, "rien de relevé pour le site")
assert(errors() == baseErrors and failures == 0, "raid d'essai sans erreur")
-- Recommencer, quitter, /roster test fin ; rejoindre un groupe arrête l'essai
click("Recommencer")
assert(T.active and Lt.test and #entries() == 0, "recommencé : plus d'objets")
assert(not win("council"):IsShown() and not ow:IsShown(), "fenêtres du butin fermées")
click("Quitter l'essai")
assert(not T.active and Lt.test == nil and not T.panel:IsShown(), "essai quitté")
run("test")
run("test fin")
assert(not T.active and Lt.test == nil, "/roster test fin")
run("test")
click("Recevoir 3 objets")
click("Tout au conseil")
IsInGroup = function() return true end
fire("GROUP_ROSTER_UPDATE")
IsInGroup = function() return false end
assert(not T.active and Lt.test == nil and #entries() == 0 and printed[#printed]:find("terminé"), "groupe rejoint : essai arrêté")
before = #printed
advance(30)
assert(not said(before, "."), "plus rien de l'essai après l'arrêt")
deferred = false
assert(#reassigned == 0 and errors() == baseErrors and failures == 0, "raid d'essai : aucune erreur")

-- 9. Habillage du site : fenêtres reconstruites (interface rechargée), chaque onglet, la synchro rapide, les options
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
-- Raid d'essai et fenêtres du butin dans l'habillage du site, sans objet porté (objets de secours) ni icône (nom court)
RosterDB.skin = "site"
naked = true
local iconByID = C_Item.GetItemIconByID
C_Item.GetItemIconByID = nil
assert(loadfile("addon/Roster/LootUI.lua"))("Roster", ns)
assert(loadfile("addon/Roster/Test.lua"))("Roster", ns)
T, U = ns.Test, ns.LootUI
deferred = true
run("test")
assert(T.active and T.panel:IsShown(), "raid d'essai (site)")
click("Recevoir 3 objets")
its = entries()
assert(#its == 3 and its[1].link:find("|Hitem:19019:", 1, true) and its[1].link:find("[Objet d'essai 1]", 1, true), "objets de secours")
assert(win("loot"):IsShown() and U.state.loot.fresh == 3, "fenêtre du butin (site) : « Tout au conseil (3) »")
click("Tout au conseil")
advance(20)
assert(#Lt.Council(entries()[1].session).cands >= 9, "réponses du conseil (site)")
ow = win("offer")
assert(ow:IsShown() and #chips(ow) == 3 and U.state.offer.band[1].text:find("Objet d'essai", 1, true), "bande (site) : nom court sans icône")
answer("bis") answer("upgrade") answer("pass")
assert(U.state.offer.done and ow.close:IsShown(), "tout répondu (site)")
script(ow.close, "OnClick")
assert(not ow:IsShown(), "« Fermer » (site)")
cw = win("council")
assert(cw:IsShown() and #chips(cw) == 3, "bande du conseil (site)")
script(cw.sort, "OnClick")
assert(U.state.council.byReceived, "tri par objets reçus (site)")
giveFirst(cw)
advance(1)
assert(U.state.council.session == entries()[2].session, "conseil suivant (site)")
giveFirst(cw) advance(1) giveFirst(cw) advance(1)
assert(byStatus("council") == 0 and byStatus("awarded") == 3, "trois objets donnés (site)")
click("Recevoir 2 propositions")
assert(ow:IsShown() and #U.state.offer.band == 2, "côté joueur (site) : deux objets")
answer("bis")
assert(U.state.offer.usable == false and table.concat(U.state.offer.buttons, ",") == "transmo,pass", "autre armure (site) : Transmo et Passer")
answer("transmo")
advance(8)
assert(not ow:IsShown(), "conseils de Tharok terminés (site)")
run("test fin")
advance(30)
deferred, naked, RosterDB.skin = false, false, nil
C_Item.GetItemIconByID = iconByID
assert(not T.active and Lt.test == nil, "essai arrêté (site)")
assert(errors() == baseErrors and failures == 0, "habillage du site sans erreur")

-- 10. Aucune variable de Blizzard réassignée, aucune erreur
assert(#reassigned == 0, "variables de Blizzard réassignées par l'addon : " .. table.concat(reassigned, ", "))
local stubs = {}
for mod in pairs(stub) do stubs[#stubs + 1] = mod end
table.sort(stubs)
print = function(...) io.stdout:write(table.concat({ ... }, " ") .. "\n") end
print("roster_ui_test : tout est bon" .. (#stubs > 0 and (" (doublures : " .. table.concat(stubs, ", ") .. ")") or ""))
