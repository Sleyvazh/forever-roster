-- Distribution du butin par Roster (lot R3b), comme RCLootCouncil : le chef de butin (chef de raid, ou celui qu'il
-- désigne) prend chaque objet du butin de groupe, les autres addons passent ; entre les pulls, il décide (conseil du
-- butin, jets MS / OS, jet libre, garder), l'annonce dans le raid et le chuchote au gagnant, puis lui échange l'objet
-- (2 h, joueurs présents au butin). Messages entre addons : docs/addon-format.md (section Roster, ML à LW).
-- WoW 12.x : messages d'addon et chat bloqués pendant une rencontre de boss (file de Comm.lua), textes du chat
-- (jets, chuchotements) secrets pendant le verrou du chat : jamais comparés ni gardés.
-- Raid d'essai (Test.lua) : ns.Loot.test remplace le raid, ses membres, les messages, le chat et l'échange ; rien n'est
-- écrit dans le bilan ni dans la sauvegarde.
local _, ns = ...
local L = {}
ns.Loot = L
local F, Cm = ns.Format, ns.Comm

local secret, usable = F.secret, F.usable
L.WAIT_LR = 20          -- secondes : attente du LR du chef de butin avant de passer
L.KEEP = 12 * 3600      -- objets du chef de butin gardés 12 h au plus
L.ML_EVERY = 10         -- secondes : état de la distribution renvoyé au plus toutes les 10 s quand le raid change
L.NOT_PASSED_KEEP = 2 * 3600
L.test = nil
L.testItems, L.testNotPassed, L.testLog = {}, {}, { loot = {} }

local function db() return ns.db and ns.db() end
local function me() return Cm.Me() end
local function same(a, b) return F.SameName(a, b) end
local function fold(name) return F.Key(name) end
local function call(fn, ...) if type(fn) ~= "function" then return false end return pcall(fn, ...) end
local function flag(v) return not secret(v) and v ~= nil and v ~= false and v ~= 0 end
local function refresh()
  if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
  if ns.LootUI and ns.LootUI.Refresh then ns.safe("fenêtres du butin", ns.LootUI.Refresh) end
end
local function ui(fn, ...)
  local U = ns.LootUI
  if U and U[fn] then ns.safe("fenêtres du butin", U[fn], ...) end
end
local function minQuality() return (ns.Recorder and ns.Recorder.MinQuality and ns.Recorder.MinQuality()) or 4 end
local seq = 0
local function nextSeq() seq = seq + 1 return seq end

-- Réponses au conseil (libellés choisis par Flo) et ordre d'affichage
L.RESPONSES = { bis = "BiS", upgrade = "Upgrade", off = "Off-spec", transmo = "Transmo", pass = "Passer" }
L.ORDER = { "bis", "upgrade", "off", "transmo", "pass" }
local RANK = { bis = 1, upgrade = 2, off = 3, transmo = 4, pass = 5 }
-- Types de jet du butin de groupe (Enum.LootRollType) : passer, besoin, cupidité, transmo
local ROLL = { pass = 0, need = 1, greed = 2, transmog = 4 }
local ROLL_LABEL = { [1] = "Besoin", [2] = "Cupidité", [4] = "Transmo" }

--------------------------------------------------------------------------------------------------------------------
-- Sauvegarde : objets du chef de butin et joueurs qui n'ont pas passé (RosterDB.loot), état de la distribution
-- (RosterDB.lootState). Raid d'essai : en mémoire seulement.
--------------------------------------------------------------------------------------------------------------------
local function store()
  local d = db()
  if not d then return { items = {}, notPassed = {} } end
  d.loot = d.loot or {}
  d.loot.items = d.loot.items or {}
  d.loot.notPassed = d.loot.notPassed or {}
  return d.loot
end
local function list() if L.test then return L.testItems end return store().items end
local function notPassedList() if L.test then return L.testNotPassed end return store().notPassed end
local function state()
  if L.test then return {} end
  local d = db()
  if not d then return {} end
  -- État d'un autre soir (sauvegarde gardée d'une session à l'autre) : oublié au bout de 12 h
  if d.lootState and d.lootState.at and time() - d.lootState.at > L.KEEP then d.lootState = nil end
  d.lootState = d.lootState or {}
  return d.lootState
end

--------------------------------------------------------------------------------------------------------------------
-- Membres du raid, chef de raid, chef de butin
--------------------------------------------------------------------------------------------------------------------
-- { name, key, class, subgroup, online, addon, unit, leader } ; raid d'essai : les membres simulés (moi compris)
function L.Members()
  local out, mine = {}, fold(me())
  if L.test then
    local seen = false
    for _, m in ipairs(L.test.members or {}) do
      local full = F.FullName(m.name)
      if full then
        local k = F.Fold(full)
        if k == mine then seen = true end
        out[#out + 1] = { name = full, key = k, class = m.class, subgroup = m.subgroup or 1, online = m.online ~= false,
          addon = k == mine or m.addon ~= false, leader = k == mine }
      end
    end
    if not seen then out[#out + 1] = { name = me(), key = mine, subgroup = 1, online = true, addon = true, leader = true } end
    return out
  end
  local with = {}
  for name in pairs(Cm.Versions()) do local k = fold(name) if k then with[k] = true end end
  for _, m in ipairs((Cm.Roster())) do
    if m.name then
      out[#out + 1] = { name = m.name, key = m.key, class = m.class, subgroup = m.subgroup, online = m.online, addon = with[m.key] == true,
        unit = m.unit, leader = m.leader }
    end
  end
  return out
end
local function member(name)
  local k = fold(name)
  if not k then return nil end
  for _, m in ipairs(L.Members()) do if m.key == k then return m end end
  return nil
end
L.Member = member

-- Chef de raid (chef du groupe hors raid) ; seul ou en raid d'essai : moi
function L.Leader()
  if L.test or not Cm.InGroup() then return me() end
  for _, m in ipairs(L.Members()) do if m.leader then return m.name end end
  return nil
end

-- Chef de butin : celui que le chef de raid a désigné s'il est encore dans le raid, sinon le chef de raid
function L.Master()
  if L.test or not Cm.InGroup() then return me() end
  local s = state()
  if s.master and member(s.master) then return s.master end
  return L.Leader()
end
function L.IsMaster()
  if L.test then return true end
  local m = L.Master()
  return m ~= nil and same(m, me())
end

-- Distribution par Roster : décidée par le chef de raid ou le chef de butin (ML) ; d'office, activée quand le raid
-- chargé est en mode « conseil » sur le site
function L.DefaultOn()
  local e = ns.Groups and ns.Groups.LootRaid and ns.Groups.LootRaid()
  return e ~= nil and e.raid.loot == "council"
end
function L.Enabled()
  if L.test then return true end
  local s = state()
  if s.on ~= nil then return s.on == true end
  return L.DefaultOn()
end
-- Passer automatique : réglage de chaque joueur (Options), activé par défaut
function L.AutoPass() local d = db() return not (d and d.autoPass == false) end

--------------------------------------------------------------------------------------------------------------------
-- Messages (préfixe RosterRT, file de Comm.lua) et chat
--------------------------------------------------------------------------------------------------------------------
local function send(msg, dist, target)
  if L.test then
    if dist == "WHISPER" and same(target, me()) then Cm.Deliver(me(), msg, "WHISPER") return true end
    if L.test.send then ns.safe("raid d'essai", L.test.send, msg, dist or "RAID", target) end
    return true
  end
  return Cm.Send(msg, dist, target)
end
L.send = send
-- Au raid ; self : traité aussi tout de suite chez moi (le retour du message par le jeu est ignoré)
local function broadcast(msg, self)
  local ok = send(msg)
  if self then Cm.Deliver(me(), msg, "SELF") end
  return ok
end
-- Message reçu de moi-même par le canal du groupe : déjà traité à l'envoi
local function echo(sender, dist) return dist ~= "SELF" and dist ~= "WHISPER" and same(sender, me()) end

-- Chat : canal du raid (ou du groupe, ou de l'instance) et chuchotements ; raid d'essai : test.say
local function sendChat(text, chatType, target)
  if L.test then
    if L.test.say then ns.safe("raid d'essai", L.test.say, text, chatType, target) end
    return true
  end
  local api = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
  if not api then return false end
  return (pcall(api, text, chatType, nil, target))
end
local function announce(text)
  local ch = L.test and "RAID" or Cm.Channel()
  if not ch then ns.print(text) return false end
  return sendChat(text, ch)
end
L.announce = announce
local function chatLocked() return not L.test and Cm.ChatLocked() end
local LOCKED = "pas pendant un combat de boss : réessaie juste après le combat."

--------------------------------------------------------------------------------------------------------------------
-- État de la distribution : ML (chef de raid ou chef de butin → raid), MQ (demande)
--------------------------------------------------------------------------------------------------------------------
local lastML = 0
local function sendML()
  if L.test or not Cm.InGroup() then return false end
  lastML = time()
  return send("ML;" .. (L.Enabled() and "1" or "0") .. ";" .. F.clean(L.Master() or ""))
end
L.SendState = sendML

function L.SetMaster(name)
  if L.test then ns.print("raid d'essai : tu restes chef de butin.") return false end
  if not Cm.InGroup() then ns.print("il faut être en groupe ou en raid pour désigner un chef de butin.") return false end
  if not Cm.IsLeader() then ns.print("seul le chef de raid désigne le chef de butin.") return false end
  local full = name and F.FullName(name)
  if full and not member(full) then ns.print(F.Display(full) .. " n'est pas dans le raid.") return false end
  local s = state()
  if s.on == nil then s.on = L.Enabled() end -- l'état d'office devient celui de tous
  s.master = (full and not same(full, me())) and full or nil
  s.at = time()
  sendML()
  local m = L.Master()
  ns.print("chef de butin : " .. (m and F.Display(m) or "?") .. (L.IsMaster() and " (toi)." or "."))
  refresh()
  return true
end

function L.SetEnabled(on)
  if L.test then return true end
  if not (L.IsMaster() or (Cm.InGroup() and Cm.IsLeader())) then
    ns.print("seul le chef de raid ou le chef de butin active la distribution par Roster.")
    return false
  end
  local s = state()
  s.on, s.at = on and true or false, time()
  sendML()
  ns.print("distribution du butin par Roster " .. (s.on and "activée : les autres joueurs passeront le butin de groupe." or "coupée : butin de groupe habituel."))
  refresh()
  return true
end

Cm.On("ML", function(sender, f, dist)
  if L.test or echo(sender, dist) or same(sender, me()) then return end
  local leader = L.Leader()
  local fromLeader = leader ~= nil and same(sender, leader)
  if not (fromLeader or same(sender, L.Master())) then return end -- seuls le chef de raid et le chef de butin décident
  local s = state()
  local wasOn, wasMaster = L.Enabled(), L.Master()
  s.on, s.at = f[2] == "1", time()
  if fromLeader then
    local named = F.FullName(F.txt(f[3], 60))
    s.master = (named and not same(named, sender)) and named or nil
  end
  local on, m = L.Enabled(), L.Master()
  if on ~= wasOn or not same(m, wasMaster) then
    if not on then ns.print("distribution du butin par Roster coupée : butin de groupe habituel.")
    elseif L.IsMaster() then ns.print("tu es chef de butin : les objets du butin de groupe te reviennent (fenêtre du butin : /roster butin).")
    else
      ns.print("distribution du butin par Roster : " .. (m and F.Display(m) or "le chef de butin") .. " distribue. " ..
        (L.AutoPass() and "Tu passeras automatiquement le butin de groupe (Options pour le couper)." or "Passer automatique coupé chez toi (Options)."))
    end
  end
  refresh()
end)

Cm.On("MQ", function(sender, _, dist)
  if L.test or echo(sender, dist) or same(sender, me()) then return end
  if Cm.IsLeader() or L.IsMaster() then sendML() end
end)

-- Arrivée dans un groupe, /reload en groupe : on demande l'état ; le groupe change : le chef de raid et le chef de
-- butin le renvoient (au plus toutes les 10 s) ; groupe quitté : l'état est oublié
local wasGroup, lastCount, mlDue = false, 0, false
local function ask() if not L.test and Cm.InGroup() and not Cm.IsLeader() then send("MQ") end end
local function rosterChanged()
  if L.test then return end
  local inGroup = Cm.InGroup()
  local count = inGroup and #(Cm.Roster()) or 0
  if inGroup and not wasGroup and C_Timer and C_Timer.After then C_Timer.After(4, ask) end
  if not inGroup and wasGroup then
    -- Groupe quitté : état oublié, conseils et jets arrêtés (les objets restent à remettre)
    local d = db()
    if d then d.lootState = nil end
    L.pending, L.offers, L.activeRoll = {}, {}, nil
    for _, c in pairs(L.councils) do c.closed = true end
    for _, s in pairs(L.rollSessions) do s.open = false end
    for _, e in ipairs(list()) do if e.status == "council" or e.status == "roll" then e.status = "new" end end
    ui("Refresh")
  end
  if inGroup and wasGroup and count > lastCount and (Cm.IsLeader() or L.IsMaster()) and not mlDue then
    local wait = math.max(0, L.ML_EVERY - (time() - lastML))
    if wait == 0 or not (C_Timer and C_Timer.After) then sendML()
    else mlDue = true C_Timer.After(wait, function() mlDue = false sendML() end) end
  end
  wasGroup, lastCount = inGroup, count
end
ns.on("GROUP_ROSTER_UPDATE", function() ns.safe("butin", rosterChanged) end)
ns.on("PLAYER_ENTERING_WORLD", function(login, reload)
  if (login or reload) and C_Timer and C_Timer.After then C_Timer.After(5, function() ns.safe("butin", ask) end) end
  wasGroup = Cm.InGroup()
  lastCount = wasGroup and #(Cm.Roster()) or 0
end)

--------------------------------------------------------------------------------------------------------------------
-- Objets du chef de butin
--------------------------------------------------------------------------------------------------------------------
local function ilvlOf(link)
  if C_Item and C_Item.GetDetailedItemLevelInfo and usable(link) then
    local ok, lvl = pcall(C_Item.GetDetailedItemLevelInfo, link)
    if ok and type(lvl) == "number" and not secret(lvl) then return lvl end
  end
  return nil
end
L.ilvlOf = ilvlOf
local function qualityOf(link, id)
  local q = F.QualityOf(link)
  if q then return q end
  if C_Item and C_Item.GetItemQualityByID and id then
    local ok, r = pcall(C_Item.GetItemQualityByID, id)
    if ok and type(r) == "number" and not secret(r) then return r end
  end
  return nil
end
-- Lien d'un objet connu par son identifiant (ou sa chaîne item:…) : celui du jeu s'il le connaît, sinon un lien construit
function L.LinkFor(item, name, quality)
  local id = type(item) == "number" and item or F.ItemId(item)
  if not id then return name or "?" end
  local str = type(item) == "string" and F.ItemString(item) or ("item:" .. id)
  local getInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo
  local ok, gname, glink, gq = call(getInfo, str)
  if ok and usable(glink) then return glink end
  if ok and usable(gname) then name = name or gname end
  if ok and type(gq) == "number" and not secret(gq) then quality = quality or gq end
  if not (ok and usable(gname)) and C_Item and C_Item.RequestLoadItemDataByID then call(C_Item.RequestLoadItemDataByID, id) end
  quality = quality or qualityOf(nil, id) or 4
  return "|cnIQ" .. quality .. ":|H" .. str .. "|h[" .. F.clean(name or ("objet " .. id)) .. "]|h|r"
end

function L.Find(key)
  for _, e in ipairs(list()) do if e.key == key then return e end end
  return nil
end
local function newEntry(link, expires)
  local id = F.ItemId(link)
  if not id then return nil end
  local e = { key = string.format("%d-%d-%d", time(), id, nextSeq()), itemId = id, link = link, name = F.ItemName(link) or ("objet " .. id),
    ilvl = ilvlOf(link), quality = qualityOf(link, id), at = time(), expires = expires, status = "new" }
  local all = list()
  all[#all + 1] = e
  return e
end

-- Place de l'objet dans les sacs (sacs 0 à 4) : même lien d'abord (bonus compris), sinon même objet ; jamais une
-- place déjà prise par un autre objet de la liste
function L.FindInBags(e)
  local C = C_Container
  if not (C and C.GetContainerNumSlots and C.GetContainerItemLink) then return nil end
  local claimed = {}
  for _, o in ipairs(list()) do
    if o ~= e and o.bag and o.status ~= "traded" and o.status ~= "kept" then claimed[o.bag .. ":" .. o.slot] = true end
  end
  local want = F.ItemString(e.link)
  local fb, fs
  for bag = 0, 4 do
    local ok, n = pcall(C.GetContainerNumSlots, bag)
    if ok and type(n) == "number" and not secret(n) then
      for slot = 1, n do
        local okL, link = pcall(C.GetContainerItemLink, bag, slot)
        if okL and usable(link) and F.ItemId(link) == e.itemId and not claimed[bag .. ":" .. slot] then
          if F.ItemString(link) == want then return bag, slot end
          fb, fs = fb or bag, fs or slot
        end
      end
    end
  end
  return fb, fs
end

-- Temps restant pour échanger l'objet (secondes), lu dans son infobulle (BIND_TRADE_TIME_REMAINING)
local tradeParser
function L.TradeTimeLeft(bag, slot)
  if not (C_TooltipInfo and C_TooltipInfo.GetBagItem) then return nil end
  tradeParser = tradeParser or F.TradeTimeParser(BIND_TRADE_TIME_REMAINING)
  local ok, left = pcall(function()
    local data = C_TooltipInfo.GetBagItem(bag, slot)
    if type(data) ~= "table" then return nil end
    for _, line in ipairs(data.lines or {}) do
      local sec = tradeParser(line.leftText)
      if sec then return sec end
    end
    return nil
  end)
  return ok and left or nil
end

-- Objet reçu : retrouvé dans les sacs (le jeu peut le poser un peu après le message), minuteur d'échange lu
function L.Locate(e, tries)
  if L.test or L.Find(e.key) ~= e then return false end
  local bag, slot = L.FindInBags(e)
  if bag then
    e.bag, e.slot, e.missing = bag, slot, nil
    local left = L.TradeTimeLeft(bag, slot)
    if left then e.expires = time() + left end
    refresh()
    return true
  end
  tries = (tries or 0) + 1
  if tries <= 4 and C_Timer and C_Timer.After then C_Timer.After(tries, function() ns.safe("butin", L.Locate, e, tries) end) end
  return false
end

-- Objets plus vieux que 12 h, ou dont l'échange n'est plus possible, retirés
function L.Prune()
  local all, now = list(), time()
  for i = #all, 1, -1 do
    local e = all[i]
    local done = e.status == "traded" or e.status == "kept"
    local expired = not done and e.expires and now > e.expires
    if expired and e.status == "awarded" and e.winner then
      ns.print("délai d'échange passé, objet pas remis à " .. F.Display(e.winner) .. " : " .. e.link .. ".")
    end
    if expired or now - (e.at or 0) > L.KEEP then
      if e.session and L.councils[e.session] then L.councils[e.session].closed = true end
      if L.activeRoll == e.key then L.activeRoll = nil end
      table.remove(all, i)
    end
  end
  local np = notPassedList()
  for i = #np, 1, -1 do if now - (np[i].at or 0) > L.NOT_PASSED_KEEP then table.remove(np, i) end end
end

function L.Items()
  L.Prune()
  return list()
end

-- Raid d'essai : objet reçu comme par le butin de groupe
function L.AddTestItem(link, expiresIn)
  if not L.test then return nil end
  local e = newEntry(link, expiresIn and (time() + expiresIn) or nil)
  if not e then return nil end
  ui("ShowLoot")
  refresh()
  return e
end

function L.Remove(key)
  local all = list()
  for i = #all, 1, -1 do
    local e = all[i]
    if e.key == key then
      L.Cancel(key, true)
      table.remove(all, i)
    end
  end
  refresh()
end

-- Objet échangé à la main (sans passer par « Échanger ») : marqué remis
function L.MarkTraded(key)
  local e = L.Find(key)
  if not e then return false end
  e.status, e.tradedAt = "traded", time()
  refresh()
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Butin de groupe : le chef de butin prend l'objet (Besoin, sinon Transmo, sinon Cupidité) et l'annonce (LR) ;
-- les autres attendent ce LR (20 s au plus) puis passent
--------------------------------------------------------------------------------------------------------------------
L.pending = {}   -- rollID → { rollID, itemId, link, quality, at } (joueur : en attente du LR)
L.taken = {}     -- rollID → { itemId, choice } (chef de butin : jets pris par l'addon, à confirmer)
L.signals = {}   -- itemId → heure du dernier LR reçu
L.rolled = {}    -- itemId → { at, n, link } (chef de butin : objets pris, pour repérer qui les gagne à sa place)

local function rollItem(rollID)
  local it = {}
  local ok, link = call(GetLootRollItemLink, rollID)
  if ok and usable(link) then it.link, it.itemId = link, F.ItemId(link) end
  local okI, _, name, _, quality, _, canNeed, canGreed, _, _, _, _, _, canTransmog = call(GetLootRollItemInfo, rollID)
  if okI then
    it.name = usable(name) and name or nil
    it.quality = type(quality) == "number" and not secret(quality) and quality or nil
    it.canNeed, it.canGreed, it.canTransmog = flag(canNeed), flag(canGreed), flag(canTransmog)
  end
  it.link = it.link or (it.itemId and L.LinkFor(it.itemId)) or it.name or "?"
  it.quality = it.quality or qualityOf(it.link, it.itemId)
  return it
end
-- Durée en millisecondes (jets du butin de groupe) ou en secondes : ramenée en secondes
local function seconds(v)
  if type(v) ~= "number" or secret(v) then return nil end
  return v > 600 and v / 1000 or v
end
local function signalFor(id) local t = L.signals[id] return t ~= nil and time() - t <= 60 end

function L.PassRoll(p)
  if L.pending[p.rollID] ~= p then return false end
  L.pending[p.rollID] = nil
  if not L.AutoPass() then
    ns.print("le chef de butin distribue " .. p.link .. " : passer automatique coupé chez toi (Options), à toi de choisir.")
    return false
  end
  call(RollOnLoot, p.rollID, ROLL.pass)
  ns.print("jet passé pour " .. p.link .. " : c'est le chef de butin qui distribue.")
  return true
end

function L.RollTimeout(rollID, p)
  if L.pending[rollID] ~= p then return end
  if signalFor(p.itemId) then L.PassRoll(p) return end
  L.pending[rollID] = nil
  if p.quality and p.quality < minQuality() then return end
  ns.print("pas de signal du chef de butin pour " .. p.link .. " (il n'y a peut-être pas droit) : tu n'as pas passé, à toi de choisir.")
end

-- Chef de butin : prend l'objet et prévient les autres addons
function L.TakeRoll(rollID, it)
  if it.quality and it.quality < minQuality() then return false end -- butin ordinaire : jet habituel
  local choice = (it.canNeed and ROLL.need) or (it.canTransmog and ROLL.transmog) or (it.canGreed and ROLL.greed) or nil
  if not choice then
    ns.print("tu ne peux pas prendre " .. it.link .. " (ni Besoin, ni Transmo, ni Cupidité) : les autres joueurs ne passeront pas leur jet.")
    return false
  end
  L.taken[rollID] = { itemId = it.itemId, choice = choice }
  call(RollOnLoot, rollID, choice)
  local r = L.rolled[it.itemId]
  L.rolled[it.itemId] = { at = time(), n = (r and time() - r.at < 600 and r.n or 0) + 1, link = it.link }
  send("LR;" .. it.itemId)
  ns.print("butin de groupe : " .. it.link .. " pris (" .. ROLL_LABEL[choice] .. ") ; les autres addons passent.")
  refresh()
  return true
end

function L.OnStartRoll(rollID, rollTime)
  if L.test or type(rollID) ~= "number" or secret(rollID) then return end
  if not (Cm.InGroup() and L.Enabled()) then return end
  local it = rollItem(rollID)
  if not it.itemId then return end
  if L.IsMaster() then L.TakeRoll(rollID, it) return end
  local p = { rollID = rollID, itemId = it.itemId, link = it.link, quality = it.quality, at = time() }
  L.pending[rollID] = p
  if signalFor(it.itemId) then L.PassRoll(p) return end
  -- Attente du LR : 20 s au plus, et jamais au-delà de la fin du jet
  local wait = L.WAIT_LR
  local okT, left = call(GetLootRollTimeLeft, rollID)
  left = (okT and seconds(left)) or seconds(rollTime)
  if left then wait = math.max(1, math.min(wait, left - 2)) end
  if C_Timer and C_Timer.After then C_Timer.After(wait, function() ns.safe("butin", L.RollTimeout, rollID, p) end) end
end

Cm.On("LR", function(sender, f, dist)
  if L.test or echo(sender, dist) or same(sender, me()) then return end
  if not same(sender, L.Master()) then return end -- seul le chef de butin
  local id = tonumber(f[2])
  if not id then return end
  L.signals[id] = time()
  for _, p in pairs(L.pending) do if p.itemId == id then L.PassRoll(p) end end
end)

ns.on("START_LOOT_ROLL", function(rollID, rollTime) ns.safe("butin de groupe", L.OnStartRoll, rollID, rollTime) end)
ns.on("CANCEL_LOOT_ROLL", function(rollID)
  if type(rollID) ~= "number" or secret(rollID) then return end
  L.pending[rollID], L.taken[rollID] = nil, nil
end)
-- Objet lié quand on le ramasse : le jeu demande confirmation du jet pris par l'addon
ns.on("CONFIRM_LOOT_ROLL", function(rollID, rollType)
  if type(rollID) ~= "number" or secret(rollID) or not L.taken[rollID] then return end
  local choice = (type(rollType) == "number" and not secret(rollType)) and rollType or L.taken[rollID].choice
  call(ConfirmLootRoll, rollID, choice)
  call(StaticPopup_Hide, "CONFIRM_LOOT_ROLL")
end)

--------------------------------------------------------------------------------------------------------------------
-- Butin vu dans le chat : objet reçu par le chef de butin (à distribuer), objet gagné par un autre (pas passé)
--------------------------------------------------------------------------------------------------------------------
local lootParser
local function linkIn(msg)
  return msg:match("(|c[^|]*|Hitem:[^|]+|h%[.-%]|h|r)") or msg:match("(|Hitem:[^|]+|h%[.-%]|h)")
end
function L.OnLoot(msg)
  if L.test or not usable(msg) then return end
  if not (Cm.InGroup() and L.Enabled() and L.IsMaster()) then return end
  lootParser = lootParser or F.LootParser({ LOOT_ITEM = LOOT_ITEM, LOOT_ITEM_MULTIPLE = LOOT_ITEM_MULTIPLE, LOOT_ITEM_SELF = LOOT_ITEM_SELF, LOOT_ITEM_SELF_MULTIPLE = LOOT_ITEM_SELF_MULTIPLE })
  local who, id, quality, matched = lootParser(msg)
  if not matched or not id then return end
  local link = linkIn(msg) or L.LinkFor(id)
  local r = L.rolled[id]
  if r and time() - r.at > 600 then L.rolled[id], r = nil, nil end
  if who == nil then
    -- Reçu par le chef de butin : à distribuer (objets pris au butin de groupe, et tout objet à partir du seuil du relevé)
    quality = quality or qualityOf(link, id)
    if not r and (not quality or quality < minQuality()) then return end
    if r then r.n = r.n - 1 if r.n <= 0 then L.rolled[id] = nil end end
    local e = newEntry(link, nil)
    if not e then return end
    L.Locate(e)
    ns.print("objet reçu, à distribuer entre les pulls (fenêtre du butin) : " .. link .. ".")
    ui("ShowLoot")
    refresh()
    return
  end
  -- Gagné par un autre joueur alors que le chef de butin l'avait pris : il n'a pas passé (sans l'addon ?)
  if not r then return end
  r.n = r.n - 1
  if r.n <= 0 then L.rolled[id] = nil end
  local full = F.FullName(who)
  if not full or same(full, me()) then return end
  local np = notPassedList()
  np[#np + 1] = { name = full, link = link, itemId = id, at = time() }
  ns.print(F.Display(full) .. " a gagné " .. link .. " au butin de groupe (il n'a pas passé : sans l'addon ?). Fenêtre du butin : « Chuchoter » pour lui demander de garder l'objet pour l'échange.")
  ui("ShowLoot")
  refresh()
end
ns.on("CHAT_MSG_LOOT", function(msg) ns.safe("butin", L.OnLoot, msg) end)

-- Raid d'essai : un joueur fictif sans l'addon gagne un objet au butin de groupe
function L.AddTestNotPassed(name, link)
  local full = L.test and F.FullName(name)
  local id = link and F.ItemId(link)
  if not (full and id) then return false end
  local np = notPassedList()
  np[#np + 1] = { name = full, link = link, itemId = id, at = time() }
  ui("ShowLoot")
  refresh()
  return true
end

function L.NotPassed()
  L.Prune()
  return notPassedList()
end
L.NOT_PASSED_WHISPER = "Tu as gagné %s au butin de groupe : garde l'objet pour l'instant, c'est moi qui distribue le butin du raid. Je te dirai à qui l'échanger."
function L.WhisperNotPassed(name)
  local full = F.FullName(name)
  if not full then return false end
  if not L.IsMaster() then ns.print("seul le chef de butin peut leur chuchoter.") return false end
  if chatLocked() then ns.print(LOCKED) return false end
  local sent = false
  for _, n in ipairs(notPassedList()) do
    if same(n.name, full) and not n.whispered then
      if sendChat(string.format(L.NOT_PASSED_WHISPER, n.link), "WHISPER", full) then n.whispered, sent = time(), true end
    end
  end
  if sent then ns.print("chuchoté à " .. F.Display(full) .. " : garder l'objet pour l'échange.") end
  refresh()
  return sent
end

--------------------------------------------------------------------------------------------------------------------
-- Conseil du butin : LO (proposé au raid), LA (réponses au conseil), LV (votes), LC (terminé)
--------------------------------------------------------------------------------------------------------------------
L.councils = {} -- session → { session, key, itemId, itemString, link, name, ilvl, master, cands[clé] = {…}, votes[clé du votant] = { voter, cand }, closed, winner, at }
L.offers = {}   -- { session, itemString, itemId, link, name, from, at, answered, response, closed }

-- Conseil : choisi pour le raid (RRG L), sinon les officiers (O), présents dans le raid
function L.CouncilNames()
  local names = L.test and (L.test.council or { me() }) or ns.Groups.Council(ns.Groups.LootRaid())
  local out, seen = {}, {}
  for _, n in ipairs(names or {}) do
    local full = F.FullName(n)
    local k = full and F.Fold(full)
    if k and not seen[k] and member(full) then seen[k] = true out[#out + 1] = full end
  end
  return out
end
local function inCouncil(name)
  for _, n in ipairs(L.CouncilNames()) do if same(n, name) then return true end end
  return false
end
function L.IsCouncil(master)
  if L.test or L.IsMaster() then return true end
  if master and same(master, me()) then return true end
  return inCouncil(me())
end
-- Chuchoté au conseil et au chef de butin, sauf moi (traité tout de suite chez moi par l'appelant)
local function toCouncil(msg, master)
  local done = { [fold(me())] = true }
  local targets = L.CouncilNames()
  targets[#targets + 1] = master
  for _, n in ipairs(targets) do
    local k = fold(n)
    if k and not done[k] then done[k] = true send(msg, "WHISPER", n) end
  end
end

local function newSession() return string.format("%d%02d", time() % 1000000, nextSeq() % 100) end

function L.StartCouncil(key)
  if not L.IsMaster() then ns.print("seul le chef de butin lance le conseil.") return false end
  local e = L.Find(key)
  if not e then return false end
  if e.status == "council" and e.session and L.councils[e.session] and not L.councils[e.session].closed then
    ui("ShowCouncil", e.session)
    return true, e.session
  end
  if e.status ~= "new" then ns.print("objet déjà attribué : " .. e.link .. ".") return false end
  if not L.test and not Cm.Channel() then ns.print("il faut être en groupe ou en raid.") return false end
  if chatLocked() then ns.print(LOCKED) return false end
  L.Cancel(key, true)
  local sid = newSession()
  local itemString = F.ItemString(e.link) or ("item:" .. e.itemId)
  e.status, e.session = "council", sid
  L.councils[sid] = { session = sid, key = e.key, itemId = e.itemId, itemString = itemString, link = e.link, name = e.name, ilvl = e.ilvl,
    master = me(), cands = {}, votes = {}, at = time() }
  -- Nom joint : affiché chez les autres tant que leur jeu ne connaît pas l'objet ; message de 255 caractères au plus
  local head = "LO;" .. sid .. ";" .. itemString .. ";"
  broadcast(head .. F.cut(F.clean(e.name or ""), math.max(0, 250 - #head)), true)
  announce("Roster : conseil du butin pour " .. e.link .. ". Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo.")
  ui("ShowCouncil", sid)
  refresh()
  return true, sid
end

Cm.On("LO", function(sender, f, dist)
  if echo(sender, dist) then return end
  if dist ~= "SELF" and not L.test and not same(sender, L.Master()) then return end -- seul le chef de butin propose
  local sid = F.txt(f[2], 20)
  local itemString = usable(f[3]) and f[3]:match("^item:[%d:%-]+") or nil
  if sid == "" or not itemString then return end
  for _, o in ipairs(L.offers) do if o.session == sid then return end end
  local id = F.ItemId(itemString)
  local name = F.txt(f[4], 80)
  local c = L.councils[sid]
  local link = (c and c.link) or L.LinkFor(itemString, name ~= "" and name or nil)
  L.offers[#L.offers + 1] = { session = sid, itemString = itemString, itemId = id, link = link, name = name, from = sender, at = time(), answered = false }
  -- Raid d'essai : la proposition d'un chef de butin fictif te met côté joueur (pas de conseil chez toi)
  if not c and not L.test and L.IsCouncil(sender) then
    L.councils[sid] = { session = sid, itemId = id, itemString = itemString, link = link, name = name, ilvl = ilvlOf(itemString),
      master = sender, cands = {}, votes = {}, at = time() }
    ui("ShowCouncil", sid)
  end
  ui("ShowOffer", sid)
  refresh()
end)

-- Objets portés au même emplacement (pour comparer) : { { id, ilvl, link } }, deux au plus
local SLOTS = {
  INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CHEST = { 5 }, INVTYPE_ROBE = { 5 }, INVTYPE_WAIST = { 6 },
  INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 }, INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 },
  INVTYPE_CLOAK = { 15 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_SHIELD = { 17 }, INVTYPE_2HWEAPON = { 16 }, INVTYPE_WEAPONMAINHAND = { 16 },
  INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_HOLDABLE = { 17 }, INVTYPE_RANGED = { 16 }, INVTYPE_RANGEDRIGHT = { 16 }, INVTYPE_THROWN = { 16 },
}
function L.Equipped(item)
  local info = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
  local ok, _, _, _, loc = call(info, item)
  local out = {}
  if not ok or not usable(loc) then return out end
  for _, slot in ipairs(SLOTS[loc] or {}) do
    local okL, link = call(GetInventoryItemLink, "player", slot)
    if okL and usable(link) and F.ItemId(link) then out[#out + 1] = { id = F.ItemId(link), ilvl = ilvlOf(link), link = link } end
  end
  return out
end

local function findOffer(sid) for _, o in ipairs(L.offers) do if o.session == sid then return o end end return nil end
function L.Offers()
  local out = {}
  for _, o in ipairs(L.offers) do if not o.closed then out[#out + 1] = o end end
  return out
end

function L.Answer(session, response, note)
  local o = findOffer(session)
  if not o or o.closed or not L.RESPONSES[response] then return false end
  local gear = F.GearText(L.Equipped(o.itemString))
  local msg = "LA;" .. session .. ";" .. response .. ";" .. gear .. ";" .. F.cut(F.trim(F.clean(note or "")), 60)
  toCouncil(msg, o.from)
  Cm.Deliver(me(), msg, "SELF")
  o.answered, o.response = time(), response
  ui("ShowOffer")
  refresh()
  return true
end

Cm.On("LA", function(sender, f, dist)
  if echo(sender, dist) then return end
  local c = L.councils[F.txt(f[2], 20)]
  if not c or c.closed or not L.RESPONSES[f[3] or ""] then return end
  local who, whispered, relayed = sender, false, false
  -- Réponse relayée par le chef de butin (6e champ : le joueur) : chuchotée par un joueur sans addon, ou (7e champ
  -- « r ») venue de l'addon d'un joueur qui n'a pas les données du site (il ne connaît pas le conseil)
  if (f[6] or "") ~= "" then
    if not same(sender, c.master) then return end
    who, relayed = F.FullName(F.txt(f[6], 60)), true
    if not who then return end
    whispered = f[7] ~= "r"
  end
  c.cands[F.Fold(who)] = { name = who, response = f[3], gear = F.Gear(f[4]), note = whispered and "" or F.txt(f[5], 60), whispered = whispered, at = time() }
  -- Chef de butin : chaque réponse reçue d'un joueur est relayée au raid ; seuls les membres du conseil (qui ont ce
  -- conseil) la gardent. Un joueur sans les données du site ne l'envoie qu'au chef de butin.
  if not relayed and not L.test and same(c.master, me()) and not same(sender, me()) then
    send("LA;" .. c.session .. ";" .. f[3] .. ";" .. F.clean(f[4] or "") .. ";" .. F.cut(F.clean(F.txt(f[5], 60)), 60) .. ";" .. who .. ";r")
  end
  refresh()
end)

-- Réponse chuchotée au chef de butin (« bis », « up », « os », « transmo », « passe ») pendant un conseil
local WHISPERED = { bis = "bis", up = "upgrade", upgrade = "upgrade", os = "off", off = "off", offspec = "off", ["off-spec"] = "off",
  transmo = "transmo", transmog = "transmo", pass = "pass", passe = "pass", ["je passe"] = "pass" }
function L.OnWhisper(text, sender)
  if not (usable(text) and usable(sender)) or not L.IsMaster() then return end
  local r = WHISPERED[F.trim(text):lower()]
  if not r then return end
  local c
  for _, x in pairs(L.councils) do if not x.closed and x.key and same(x.master, me()) and (not c or x.at > c.at) then c = x end end
  local who = F.FullName(sender)
  if not (c and who) then return end
  local msg = "LA;" .. c.session .. ";" .. r .. ";;chuchoté;" .. who
  toCouncil(msg, me())
  Cm.Deliver(me(), msg, "SELF")
end
ns.on("CHAT_MSG_WHISPER", function(text, sender) ns.safe("conseil du butin", L.OnWhisper, text, sender) end)

function L.Vote(session, name)
  local c = L.councils[session]
  if not c or c.closed then return false end
  if not L.IsCouncil(c.master) then ns.print("tu n'es pas du conseil du butin.") return false end
  local full = F.FullName(name)
  if not full then return false end
  local mine = c.votes[fold(me())]
  local msg = "LV;" .. session .. ";" .. ((mine and same(mine.cand, full)) and "" or full)
  toCouncil(msg, c.master)
  Cm.Deliver(me(), msg, "SELF")
  return true
end

Cm.On("LV", function(sender, f)
  local c = L.councils[F.txt(f[2], 20)]
  if not c or c.closed then return end
  if not (L.test or same(sender, c.master) or inCouncil(sender)) then return end
  local cand = F.FullName(F.txt(f[3], 60))
  c.votes[fold(sender)] = cand and { voter = sender, cand = cand } or nil
  refresh()
end)

Cm.On("LC", function(sender, f, dist)
  if echo(sender, dist) then return end
  local sid = F.txt(f[2], 20)
  local c = L.councils[sid]
  if c and (dist == "SELF" or L.test or same(sender, c.master)) then
    c.closed, c.winner = true, F.FullName(F.txt(f[3], 60))
  end
  local o = findOffer(sid)
  if o and (dist == "SELF" or L.test or same(sender, o.from)) then o.closed = true end
  ui("ShowOffer")
  refresh()
end)

-- Objets reçus d'un joueur : compte du site (ligne N, ses persos ensemble) et ce soir (bilan en cours), même règle que
-- le site (lootSkipReason) : ne comptent pas une réponse Off-spec ou Transmo, un jet OS ou libre, un objet gardé
function L.Counts(l)
  local d = tostring(l.detail or "")
  if l.method == "council" then return l.response ~= "off" and l.response ~= "transmo" end
  if l.method == "roll" then return d:find("^OS") == nil and d:find("^jet") == nil end
  if l.method == "ml" then return d:find("^gardé") == nil end
  return true
end
L.KEPT = "gardé"
function L.Received(name)
  local c = L.test and L.test.counts or ns.Groups.Counts(ns.Groups.LootRaid())
  local entry = F.CountFor(c, name)
  local names = entry and entry.names or { name }
  local log = L.test and L.testLog or ns.Recorder.Current()
  local tonight = 0
  -- Objets du chef de butin pas encore distribués (ramassés, sans méthode) : pas les siens
  local holder = L.Enabled() and L.Master()
  for _, l in ipairs(log and log.loot or {}) do
    local waiting = holder and (l.method or "") == "" and same(l.who, holder)
    if not waiting and L.Counts(l) then
      for _, n in ipairs(names) do if same(l.who, n) then tonight = tonight + 1 break end end
    end
  end
  return entry and entry.n or 0, tonight, c
end

function L.Council(session)
  local c = L.councils[session]
  if not c then return nil end
  local voters, myVote = {}, nil
  for k, v in pairs(c.votes) do
    local ck = fold(v.cand)
    if ck then voters[ck] = voters[ck] or {} table.insert(voters[ck], v.voter) end
    if k == fold(me()) then myVote = v.cand end
  end
  local out = { session = c.session, key = c.key, itemId = c.itemId, link = c.link, name = c.name, ilvl = c.ilvl, master = c.master,
    closed = c.closed == true, winner = c.winner, myVote = myVote, cands = {}, waiting = {}, council = L.CouncilNames(), isMaster = same(c.master, me()) }
  local _, _, counts = L.Received(me())
  out.counts = counts
  for k, x in pairs(c.cands) do
    local vs = voters[k] or {}
    table.sort(vs)
    local gear = {}
    for _, g in ipairs(x.gear or {}) do gear[#gear + 1] = { id = g.id, ilvl = g.ilvl, link = L.LinkFor(g.id) } end
    local site, tonight = L.Received(x.name)
    out.cands[#out.cands + 1] = { name = x.name, response = x.response, gear = gear, note = x.note or "", whispered = x.whispered,
      received = site + tonight, receivedSite = site, receivedTonight = tonight, votes = #vs, voters = vs }
  end
  table.sort(out.cands, function(a, b)
    local ra, rb = RANK[a.response] or 9, RANK[b.response] or 9
    if ra ~= rb then return ra < rb end
    if a.votes ~= b.votes then return a.votes > b.votes end
    return a.name < b.name
  end)
  for _, m in ipairs(L.Members()) do if not c.cands[m.key] then out.waiting[#out.waiting + 1] = m.name end end
  table.sort(out.waiting)
  return out
end

-- « Donner » du conseil : réponse du gagnant et nombre de voix (« 3 votes »)
function L.AwardCouncil(session, name)
  local c = L.councils[session]
  local full = F.FullName(name)
  if not (c and c.key and full) then return false end
  local votes = 0
  for _, v in pairs(c.votes) do if same(v.cand, full) then votes = votes + 1 end end
  local cand = c.cands[F.Fold(full)]
  local response = cand and cand.response ~= "pass" and cand.response or nil
  return L.Award(c.key, full, "council", response, F.plural(votes, "vote"))
end

--------------------------------------------------------------------------------------------------------------------
-- Jets : MS (/roll 100) et OS (/roll 99), ou jet libre (/roll 100) ; le premier jet de chacun compte ; égalité :
-- seuls les ex æquo relancent. Un seul objet en jets à la fois (les jets du chat ne disent pas pour quel objet).
--------------------------------------------------------------------------------------------------------------------
L.rollSessions = {} -- clé de l'objet → { kind, rows, byKey, eligible, tieKind, round, previous, open, hidden, at }
L.activeRoll = nil
local KIND_RANK = { ms = 1, os = 2, free = 1 }

local function names(list)
  local out = {}
  for _, n in ipairs(list) do out[#out + 1] = F.Display(n) end
  return table.concat(out, ", ")
end

function L.StartRoll(key, kind)
  if not L.IsMaster() then ns.print("seul le chef de butin lance les jets.") return false end
  local e = L.Find(key)
  if not e then return false end
  if e.status ~= "new" and e.status ~= "council" and e.status ~= "roll" then ns.print("objet déjà attribué : " .. e.link .. ".") return false end
  if chatLocked() then ns.print("pas pendant un combat de boss : les jets se font entre les pulls.") return false end
  kind = kind == "free" and "free" or "msos"
  L.Cancel(key, true)
  if L.activeRoll and L.activeRoll ~= key then
    local other = L.Find(L.activeRoll)
    local s = L.rollSessions[L.activeRoll]
    if s then s.open = false end
    if other and other.status == "roll" then other.status = "new" end
  end
  L.rollSessions[key] = { kind = kind, rows = {}, byKey = {}, round = 1, previous = {}, open = true, at = time() }
  L.activeRoll = key
  e.status = "roll"
  broadcast("RS;" .. e.itemId .. ";" .. kind)
  if kind == "free" then announce("Roster : jet libre pour " .. e.link .. " : /roll 100.")
  else announce("Roster : jets pour " .. e.link .. " : /roll 100 en spé principale (MS), /roll 99 en spé secondaire (OS).") end
  ui("ShowLoot")
  refresh()
  return true
end

function L.OnRoll(name, roll, lo, hi)
  local key = L.activeRoll
  local s = key and L.rollSessions[key]
  if not (s and s.open) then return false end
  if type(roll) ~= "number" or lo ~= 1 then return false end
  local full = F.FullName(name)
  if not full then return false end
  local kind
  if s.kind == "free" then
    if hi ~= 100 then return false end
    kind = "free"
  elseif s.tieKind then
    if hi ~= (s.tieKind == "os" and 99 or 100) then return false end
    kind = s.tieKind
  elseif hi == 100 then kind = "ms"
  elseif hi == 99 then kind = "os"
  else return false end
  local k = F.Fold(full)
  if s.eligible and not s.eligible[k] then return false end -- relance : seuls les ex æquo
  if s.byKey[k] then return false end                     -- seul le premier jet compte
  local row = { name = full, roll = roll, hi = hi, kind = kind }
  s.byKey[k] = row
  s.rows[#s.rows + 1] = row
  refresh()
  return true
end

-- Jets lus dans le chat (texte du jeu dans la langue du client) ; secret pendant le verrou du chat : illisible
local rollParser
ns.on("CHAT_MSG_SYSTEM", function(msg)
  local s = L.activeRoll and L.rollSessions[L.activeRoll]
  if not (s and s.open) then return end
  if not usable(msg) then s.hidden = true refresh() return end
  rollParser = rollParser or F.RollParser(RANDOM_ROLL_RESULT)
  local name, roll, lo, hi = rollParser(msg)
  if name then ns.safe("jets", L.OnRoll, name, roll, lo, hi) end
end)

local function ranking(s)
  local rows = {}
  for _, r in ipairs(s.rows) do rows[#rows + 1] = r end
  table.sort(rows, function(a, b)
    local ka, kb = KIND_RANK[a.kind] or 9, KIND_RANK[b.kind] or 9
    if ka ~= kb then return ka < kb end
    if a.roll ~= b.roll then return a.roll > b.roll end
    return a.name < b.name
  end)
  local winners, best = {}, rows[1]
  for _, r in ipairs(rows) do if r.kind == best.kind and r.roll == best.roll then winners[#winners + 1] = r.name end end
  return rows, winners, best
end

function L.Rolls(key)
  local s = L.rollSessions[key]
  if not s then return nil end
  local rows, winners, best = {}, {}, nil
  if #s.rows > 0 then rows, winners, best = ranking(s) end
  return { kind = s.kind, rows = rows, winners = winners, tie = #winners > 1, best = best, open = s.open, round = s.round,
    previous = s.previous, hidden = s.hidden, active = L.activeRoll == key, tieKind = s.tieKind }
end

-- Égalité : seuls les ex æquo relancent (même dé)
function L.Reroll(key)
  local s, e = L.rollSessions[key], L.Find(key)
  local r = L.Rolls(key)
  if not (s and e and r and r.tie) then return false end
  if not L.IsMaster() then return false end
  if chatLocked() then ns.print("pas pendant un combat de boss : les jets se font entre les pulls.") return false end
  s.previous[#s.previous + 1] = r.rows
  s.eligible = {}
  for _, n in ipairs(r.winners) do s.eligible[F.Fold(n)] = true end
  s.tieKind = s.kind == "free" and "free" or r.best.kind
  s.rows, s.byKey, s.round, s.open, s.hidden = {}, {}, s.round + 1, true, nil
  L.activeRoll = key
  e.status = "roll"
  announce("Roster : égalité pour " .. e.link .. " entre " .. names(r.winners) .. " : relancez, /roll " .. (s.tieKind == "os" and 99 or 100) .. ".")
  if L.test and L.test.reroll then ns.safe("raid d'essai", L.test.reroll, key, r.winners, s.tieKind) end
  refresh()
  return true
end

-- « Donner au gagnant » : détail noté dans le bilan comme Forever (« MS 87 », « OS 54 », « jet 54 »)
function L.AwardRoll(key)
  local r, s = L.Rolls(key), L.rollSessions[key]
  if not (r and s and r.best) or r.tie then return false end
  local detail = s.kind == "free" and ("jet " .. r.best.roll) or (r.best.kind:upper() .. " " .. r.best.roll)
  return L.Award(key, r.winners[1], "roll", nil, detail)
end

Cm.On("RS", function(sender, f, dist)
  if L.test or echo(sender, dist) or same(sender, me()) or not same(sender, L.Master()) then return end
  local id = tonumber(f[2])
  if not id then return end
  local link = L.LinkFor(id)
  if f[3] == "free" then ns.print("jet libre pour " .. link .. " : /roll 100.")
  else ns.print("jets pour " .. link .. " : /roll 100 en spé principale, /roll 99 en spé secondaire.") end
end)

-- Conseil ou jets en cours sur un objet : arrêtés (l'objet redevient à distribuer) ; quiet : sans message
function L.Cancel(key, quiet)
  local e = L.Find(key)
  if not e then return false end
  if e.session and L.councils[e.session] and not L.councils[e.session].closed then
    broadcast("LC;" .. e.session .. ";", true)
  end
  local s = L.rollSessions[key]
  if s then s.open = false end
  if L.activeRoll == key then L.activeRoll = nil end
  if e.status == "council" or e.status == "roll" then e.status = "new" end
  if not quiet then refresh() end
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Attribution (un clic du chef de butin) : annoncée dans le raid et chuchotée au gagnant, notée dans le bilan
--------------------------------------------------------------------------------------------------------------------
local function awardLabel(method, response, detail, kept)
  if method == "council" then return "conseil" .. (L.RESPONSES[response or ""] and response ~= "pass" and (" : " .. L.RESPONSES[response]) or "") end
  if method == "roll" then
    local d = tostring(detail or "")
    local n = d:match("^jet (%d+)")
    if n then return "jet libre " .. n end
    return d ~= "" and d or "jets"
  end
  return kept and L.KEPT or "choix du chef de butin"
end
L.awardLabel = awardLabel

function L.Award(key, winner, method, response, detail)
  if not L.IsMaster() then ns.print("seul le chef de butin attribue le butin.") return false end
  local e = L.Find(key)
  local full = F.FullName(winner)
  if not (e and full) then return false end
  if chatLocked() then ns.print("pas pendant un combat de boss : attribue " .. e.link .. " juste après le combat.") return false end
  method = method or "ml"
  response = L.RESPONSES[response or ""] and response ~= "pass" and response or nil
  detail = detail or ""
  local kept = same(full, me())
  -- Conseil terminé (les fenêtres de réponse se ferment), jets arrêtés
  if e.session and L.councils[e.session] and not L.councils[e.session].closed then broadcast("LC;" .. e.session .. ";" .. full, true) end
  local s = L.rollSessions[key]
  if s then s.open = false end
  if L.activeRoll == key then L.activeRoll = nil end
  e.status, e.winner, e.method, e.response, e.detail, e.awardedAt = kept and "kept" or "awarded", full, method, response, detail, time()
  announce("Roster : " .. F.Display(full) .. " reçoit " .. e.link .. " (" .. awardLabel(method, response, detail, kept) .. ")")
  if not kept then
    local left = e.expires and e.expires - time()
    sendChat("Tu reçois " .. e.link .. " : passe me voir pour l'échange" .. ((left and left > 0) and (" (encore " .. F.Duration(left) .. ")") or "") .. ".", "WHISPER", full)
  end
  if L.test then
    L.testLog.loot[#L.testLog.loot + 1] = { id = e.itemId, who = full, method = method, response = response or "", detail = detail, at = time() }
  else
    e.logIndex = ns.Recorder.Award(e.itemId, full, method, response, detail, e.name, e.logIndex, e.key)
    -- Les autres relevés (chef de raid…) notent aussi le gagnant : tous les bilans du raid concordent
    send("LW;" .. e.key .. ";" .. e.itemId .. ";" .. full .. ";" .. method .. ";" .. (response or "") .. ";" .. F.cut(F.clean(detail), 40))
  end
  refresh()
  return true
end

-- Garder (désenchantement, banque de guilde) : noté « gardé », ne compte pas dans les objets reçus
-- Attribution vue chez les autres joueurs (LW du chef de butin) : notée dans leur relevé, pas d'annonce
local METHODS = { council = true, roll = true, ml = true }
Cm.On("LW", function(sender, f, dist)
  if L.test or echo(sender, dist) or same(sender, me()) or not same(sender, L.Master()) then return end
  local id, winner, method = tonumber(f[3]), F.FullName(F.txt(f[4], 60)), f[5]
  if not (id and winner and METHODS[method or ""]) then return end
  local response = L.RESPONSES[f[6] or ""] and f[6] ~= "pass" and f[6] or nil
  ns.Recorder.Award(id, winner, method, response, F.txt(f[7], 40), nil, nil, F.txt(f[2], 40), sender)
end)

function L.Keep(key) return L.Award(key, me(), "ml", nil, L.KEPT) end

--------------------------------------------------------------------------------------------------------------------
-- Échange au gagnant : demande d'échange (InitiateTrade), objet posé à l'ouverture de la fenêtre, fin détectée
--------------------------------------------------------------------------------------------------------------------
local function countOf(id)
  local getCount = (C_Item and C_Item.GetItemCount) or GetItemCount
  local ok, n = call(getCount, id)
  if ok and type(n) == "number" and not secret(n) then return n end
  return nil
end

function L.Trade(key)
  local e = L.Find(key)
  if not (e and e.winner and e.status == "awarded") then return false end
  if L.test then
    if L.test.trade then ns.safe("raid d'essai", L.test.trade, e) end
    return true
  end
  if InCombatLockdown and InCombatLockdown() then ns.print("pas d'échange en combat : réessaie juste après.") return false end
  local m = member(e.winner)
  if not (m and m.unit) then ns.print(F.Display(e.winner) .. " n'est pas dans le groupe.") return false end
  local okD, near = call(CheckInteractDistance, m.unit, 2)
  if okD and near == false then ns.print(F.Display(e.winner) .. " est trop loin pour échanger : rapproche-toi.") return false end
  L.trading = { key = e.key, winner = e.winner, at = time(), count = countOf(e.itemId) }
  if not call(InitiateTrade, m.unit) then
    L.trading = nil
    ns.print("le jeu n'a pas permis d'ouvrir l'échange avec " .. F.Display(e.winner) .. ".")
    return false
  end
  ns.print("échange demandé à " .. F.Display(e.winner) .. " : l'objet sera posé tout seul dans la fenêtre d'échange.")
  return true
end

-- Fenêtre d'échange ouverte avec le gagnant : l'objet est posé dans la première case
function L.OnTradeShow()
  local t = L.trading
  if not t or time() - t.at > 120 then return end
  local e = L.Find(t.key)
  if not e then return end
  local okN, name, realm = call(UnitFullName or UnitName, "npc") -- le partenaire de l'échange
  if okN and usable(name) and not same(F.FullName(name, usable(realm) and realm or nil), t.winner) then return end
  local bag, slot = L.FindInBags(e)
  if not bag then ns.print("objet introuvable dans tes sacs : " .. e.link .. ".") return end
  t.count = t.count or countOf(e.itemId)
  call(ClearCursor)
  call(C_Container and C_Container.PickupContainerItem, bag, slot)
  call(ClickTradeButton, 1)
  t.placed = true
end
-- Fenêtre fermée : l'objet a quitté les sacs, il est remis
function L.OnTradeClosed()
  local t = L.trading
  if not t or t.closing then return end
  t.closing = true
  local function check()
    L.trading = nil
    local e = L.Find(t.key)
    if not e then return end
    local n = countOf(e.itemId)
    if t.count and n and n < t.count then
      e.status, e.tradedAt = "traded", time()
      ns.print("objet remis à " .. F.Display(e.winner) .. " : " .. e.link .. ".")
    end
    refresh()
  end
  if C_Timer and C_Timer.After then C_Timer.After(1, function() ns.safe("échange", check) end) else check() end
end
ns.on("TRADE_SHOW", function() ns.safe("échange", L.OnTradeShow) end)
ns.on("TRADE_CLOSED", function() ns.safe("échange", L.OnTradeClosed) end)

-- Sacs changés : les objets pas encore retrouvés sont recherchés
ns.on("BAG_UPDATE_DELAYED", function()
  if L.test then return end
  for _, e in ipairs(list()) do if e.status == "new" and not e.bag then ns.safe("butin", L.Locate, e, 4) end end
end)

--------------------------------------------------------------------------------------------------------------------
-- Raid d'essai : fin
--------------------------------------------------------------------------------------------------------------------
function L.StopTest()
  L.test = nil
  L.testItems, L.testNotPassed, L.testLog = {}, {}, { loot = {} }
  L.councils, L.offers, L.rollSessions, L.activeRoll, L.trading = {}, {}, {}, nil, nil
  ui("Close")
  refresh()
end

-- Objets et minuteurs tenus à jour (délai d'échange, objets de plus de 12 h) : fenêtres du butin et onglet En raid
-- seulement (rafraîchir l'onglet Synchro lui rendrait le clavier)
local function tick()
  L.Prune()
  if ns.LootUI and ns.LootUI.Refresh then ns.LootUI.Refresh() end
  if ns.Pages and ns.Pages.Refresh then ns.Pages.Refresh("enraid") end
end
ns.on("PLAYER_LOGIN", function()
  ns.safe("butin", L.Prune)
  -- Conseils et jets ne survivent pas à un /reload : leurs objets redeviennent à distribuer
  for _, e in ipairs(store().items) do if e.status == "council" or e.status == "roll" then e.status = "new" end end
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(30, function() ns.safe("butin", tick) end) end
end)

return L
