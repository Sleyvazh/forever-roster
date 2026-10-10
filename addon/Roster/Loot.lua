-- Distribution du butin par Roster (lot R3b), comme RCLootCouncil : le chef de butin (chef de raid, ou celui qu'il
-- désigne) prend chaque objet du butin de groupe, les autres addons passent ; entre les pulls, il décide (conseil du
-- butin, jets MS / OS, jet libre, garder), l'annonce dans le raid et le chuchote au gagnant, puis lui échange l'objet
-- (2 h, joueurs présents au butin). Messages entre addons : docs/addon-format.md (section Roster, ML à LW).
-- Retours du raid de test (0.3) :
--   - échange : dès qu'une fenêtre d'échange s'ouvre avec un gagnant (qu'il l'ait ouverte ou non), ses objets sont posés
--     (6 au plus) ; remis quand ils ont quitté les sacs à la fermeture. « Échanger » sans fenêtre : message du jeu ou marche
--     à suivre (L.Trade, L.OnTradeShow, L.FillTrade, L.OnTradeClosed, L.Handover) ;
--   - objets portables : BiS, Upgrade, Off-spec seulement sur ce qu'on peut porter (L.CanUse : armure du type exact de la
--     classe, sinon infobulle du jeu) ; chez le chef de butin et le conseil, la règle de l'armure fait d'une telle réponse
--     d'un autre joueur une réponse Transmo (L.CanUseClass) ;
--   - tout au conseil d'un coup, numéroté (L.StartAllCouncils, L.Councils) ; « bis 2 » chuchoté vise l'objet 2 ;
--   - colonne « Reçus » détaillée : BiS · Upgrade · Jets MS (ligne D du site, L.Category, L.Received).
-- WoW 12.x : messages d'addon et chat bloqués pendant une rencontre de boss (file de Comm.lua), textes du chat
-- (jets, chuchotements) secrets pendant le verrou du chat : jamais comparés ni gardés.
-- Raid d'essai (Test.lua) : ns.Loot.test remplace le raid, ses membres, les messages, le chat et l'échange ; rien n'est
-- écrit dans le bilan ni dans la sauvegarde. Crochets : send, say, trade(entry), reroll, et facultatifs tradeShow(partner,
-- objets) (échange ouvert par un gagnant fictif) et armorRule (true : la règle de l'armure s'applique aussi aux réponses
-- des joueurs fictifs) ; counts (objets reçus, avec bis / up / ms par entrée si voulu).
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
local order = 0 -- ordre de proposition des conseils
local function nextOrder() order = order + 1 return order end
local function num(v) return type(v) == "number" and not secret(v) and v or nil end

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
-- Messages du chat de 255 octets au plus, liens compris : morceaux { texte, séparateur } joints tant qu'ils tiennent,
-- jamais coupés (un lien coupé ne s'afficherait pas)
L.CHAT_MAX = 255
function L.ChatLines(pieces, max)
  max = max or L.CHAT_MAX
  local out, cur = {}, nil
  for _, p in ipairs(pieces) do
    local text, sep = p[1] or "", p[2] or ""
    if cur and #cur + #sep + #text <= max then cur = cur .. sep .. text
    else
      if cur then out[#out + 1] = cur end
      cur = text
    end
  end
  if cur then out[#out + 1] = cur end
  return out
end
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
-- place déjà prise par un autre objet de la liste, ni une place de « exclude » (« sac:case » → true : déjà posée
-- dans l'échange)
function L.FindInBags(e, exclude)
  local C = C_Container
  if not (C and C.GetContainerNumSlots and C.GetContainerItemLink) then return nil end
  local claimed = {}
  for k in pairs(exclude or {}) do claimed[k] = true end
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
-- Attributions pas encore notées dans le bilan (relevé en pause au moment du clic : /reload, groupe quitté un
-- instant…) : rattrapées dès que le relevé reprend, avant l'export et avant de retirer un vieil objet
-- (jamais deux à la fois : noter rafraîchit la minicarte, qui relit la liste des objets)
local logging = false
function L.LogAwards()
  if logging or L.test or not (ns.Recorder and ns.Recorder.Award) then return 0 end
  logging = true
  local ok, n = pcall(function()
    local done = 0
    for _, e in ipairs(store().items) do
      if not e.logged and e.winner and (e.status == "awarded" or e.status == "traded" or e.status == "kept") then
        local idx = ns.Recorder.Award(e.itemId, e.winner, e.method, e.response, e.detail, e.name, e.logIndex, e.key, nil, e.at)
        if idx then e.logIndex, e.logged, done = idx, true, done + 1 end
      end
    end
    return done
  end)
  logging = false
  if not ok then error(n, 0) end
  return n
end
L.IsLogging = function() return logging end

function L.Prune()
  if not L.test then L.LogAwards() end
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
L.councils = {} -- session → { session, num, order, key, itemId, itemString, link, name, ilvl, master, cands[clé] = {…}, votes[clé du votant] = { voter, cand }, closed, winner, at }
L.offers = {}   -- { session, num, itemString, itemId, link, name, from, at, answered, response, closed, usable, reason }
L.COUNCIL_KEEP = 2 * 3600 -- conseils listés (L.Councils) : ceux de moins de 2 h

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

-- Conseils ouverts par moi (chef de butin), par numéro. Numéro d'un nouveau conseil : le suivant des conseils ouverts ;
-- aucun conseil ouvert : la numérotation repart de 1 (nouveau lot : les rappels chuchotés repartent aussi)
L.batch = 0
local reminded = {} -- clé du joueur → true : rappel « précise le numéro » déjà chuchoté dans ce lot
local function openCouncils()
  local out = {}
  for _, c in pairs(L.councils) do if c.key and not c.closed and same(c.master, me()) then out[#out + 1] = c end end
  table.sort(out, function(a, b) return (a.num or 0) < (b.num or 0) end)
  return out
end
local function nextNum()
  local open = openCouncils()
  if #open == 0 then L.batch, reminded = L.batch + 1, {} return 1 end
  return (open[#open].num or #open) + 1
end

-- Objet proposé au conseil : LO au raid (et traité chez moi), sans annonce ; renvoie la session et le numéro
local function propose(e)
  L.Cancel(e.key, true)
  local sid, n = newSession(), nextNum()
  local itemString = F.ItemString(e.link) or ("item:" .. e.itemId)
  e.status, e.session = "council", sid
  L.councils[sid] = { session = sid, num = n, order = nextOrder(), key = e.key, itemId = e.itemId, itemString = itemString, link = e.link,
    name = e.name, ilvl = e.ilvl, master = me(), cands = {}, votes = {}, at = time() }
  -- Nom joint : affiché chez les autres tant que leur jeu ne connaît pas l'objet ; message de 255 caractères au plus
  local head = "LO;" .. sid .. ";" .. itemString .. ";"
  broadcast(head .. F.cut(F.clean(e.name or ""), math.max(0, 250 - #head)), true)
  return sid, n
end

-- Annonce au raid des objets proposés ({ num, link }) : un seul conseil ouvert, forme courte ; sinon numérotée, avec la
-- forme du chuchotement (« bis 2 »), en plusieurs messages si besoin
local HINT = "Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo"
local function announceCouncils(list)
  if #list == 1 and #openCouncils() == 1 then
    announce("Roster : conseil du butin pour " .. list[1].link .. ". " .. HINT .. ".")
    return
  end
  local tail = { HINT .. " suivi du numéro (« bis " .. (list[2] or list[1]).num .. " »).", " " }
  local pieces
  if #list == 1 then
    pieces = { { "Roster : conseil du butin, objet " .. list[1].num .. " : " .. list[1].link .. "." }, tail }
  else
    pieces = { { "Roster : conseil du butin, " .. #list .. " objets :" } }
    for i, x in ipairs(list) do pieces[#pieces + 1] = { x.num .. " " .. x.link .. (i == #list and "." or ""), i == 1 and " " or ", " } end
    pieces[#pieces + 1] = tail
  end
  for _, line in ipairs(L.ChatLines(pieces)) do announce(line) end
end

local function canPropose()
  if not L.IsMaster() then ns.print("seul le chef de butin lance le conseil.") return false end
  if not L.test and not Cm.Channel() then ns.print("il faut être en groupe ou en raid.") return false end
  if chatLocked() then ns.print(LOCKED) return false end
  return true
end

function L.StartCouncil(key)
  if not L.IsMaster() then ns.print("seul le chef de butin lance le conseil.") return false end
  local e = L.Find(key)
  if not e then return false end
  if e.status == "council" and e.session and L.councils[e.session] and not L.councils[e.session].closed then
    ui("ShowCouncil", e.session)
    return true, e.session
  end
  if e.status ~= "new" then ns.print("objet déjà attribué : " .. e.link .. ".") return false end
  if not canPropose() then return false end
  local sid, n = propose(e)
  announceCouncils({ { num = n, link = e.link } })
  ui("ShowCouncil", sid)
  refresh()
  return true, sid
end

-- Tout au conseil d'un coup : chaque objet à distribuer (dans l'ordre de la liste) a son LO et son numéro, une seule
-- annonce au raid. Renvoie le nombre d'objets proposés et leurs sessions.
function L.StartAllCouncils()
  local todo = {}
  for _, e in ipairs(L.Items()) do if e.status == "new" then todo[#todo + 1] = e end end
  if #todo == 0 then
    if L.IsMaster() then ns.print("aucun objet à proposer au conseil.") end
    return 0, {}
  end
  if not canPropose() then return 0, {} end
  local sessions, shown = {}, {}
  for _, e in ipairs(todo) do
    local sid, n = propose(e)
    sessions[#sessions + 1] = sid
    shown[#shown + 1] = { num = n, link = e.link }
  end
  announceCouncils(shown)
  ui("ShowCouncil", sessions[1])
  refresh()
  return #sessions, sessions
end

-- Numéro d'une proposition reçue : comme le chef de butin (le suivant des propositions ouvertes, 1 s'il n'y en a pas) ;
-- le format LO ne le porte pas
local function nextOfferNum()
  local max = 0
  for _, o in ipairs(L.offers) do if not o.closed and (o.num or 0) > max then max = o.num end end
  return max + 1
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
  local o = { session = sid, num = (c and c.num) or nextOfferNum(), itemString = itemString, itemId = id, link = link, name = name, from = sender,
    at = time(), answered = false }
  -- Puis-je le porter ? (nil : objet pas encore connu du jeu, recalculé à son arrivée)
  o.usable, o.reason = L.CanUse(itemString)
  L.offers[#L.offers + 1] = o
  -- Raid d'essai : la proposition d'un chef de butin fictif te met côté joueur (pas de conseil chez toi)
  if not c and not L.test and L.IsCouncil(sender) then
    L.councils[sid] = { session = sid, num = o.num, order = nextOrder(), itemId = id, itemString = itemString, link = link, name = name,
      ilvl = ilvlOf(itemString), master = sender, cands = {}, votes = {}, at = time() }
    ui("ShowCouncil", sid)
  end
  ui("ShowOffer", sid)
  refresh()
end)

-- Objet arrivé dans le cache du jeu : « puis-je le porter ? » recalculé pour les propositions encore sans réponse sûre
local function itemArrived(id)
  local changed = false
  for _, o in ipairs(L.offers) do
    if not o.closed and o.usable == nil and (secret(id) or not num(id) or o.itemId == id) then
      o.usable, o.reason = L.CanUse(o.itemString)
      if o.usable ~= nil then changed = true end
    end
  end
  if changed then refresh() end
end
ns.on("GET_ITEM_INFO_RECEIVED", function(id) ns.safe("butin", itemArrived, id) end)
ns.on("ITEM_DATA_LOAD_RESULT", function(id) ns.safe("butin", itemArrived, id) end)

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

--------------------------------------------------------------------------------------------------------------------
-- Objets portables (retours du raid de test) : BiS, Upgrade et Off-spec seulement sur ce qu'on peut porter
--------------------------------------------------------------------------------------------------------------------
-- Armure (Enum.ItemClass.Armor = 4) aux emplacements d'armure : le type exact de la classe (choix de Flo). La cape (tissu)
-- est pour tous : elle n'est pas dans cette liste.
local ARMOR_SLOTS = { INVTYPE_HEAD = true, INVTYPE_SHOULDER = true, INVTYPE_CHEST = true, INVTYPE_ROBE = true, INVTYPE_WAIST = true,
  INVTYPE_LEGS = true, INVTYPE_FEET = true, INVTYPE_WRIST = true, INVTYPE_HAND = true }
-- Sous-classe d'armure (Enum.ItemArmorSubclass) : 1 tissu, 2 cuir, 3 mailles, 4 plaques
L.ARMOR_OF = { MAGE = 1, PRIEST = 1, WARLOCK = 1, DEMONHUNTER = 2, DRUID = 2, MONK = 2, ROGUE = 2, EVOKER = 3, HUNTER = 3, SHAMAN = 3,
  DEATHKNIGHT = 4, PALADIN = 4, WARRIOR = 4 }
local ARMOR_NAME = { "tissu", "cuir", "mailles", "plaques" }

-- Identifiant, emplacement, classe et sous-classe d'un objet, sans demander le serveur (nil : objet inconnu)
local function itemInfo(item)
  if not usable(item) and type(item) ~= "number" then return nil end
  local info = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
  local ok, id, _, _, loc, _, classID, subID = call(info, item)
  if not ok or not num(id) then return nil end
  return id, usable(loc) and loc or "", num(classID), num(subID)
end
-- Armure soumise à la règle du type : sous-classe (1 à 4), sinon nil
local function armorType(item)
  local id, loc, classID, subID = itemInfo(item)
  if not id or classID ~= 4 or not ARMOR_SLOTS[loc] or not ARMOR_NAME[subID or 0] then return nil, id end
  return subID, id
end
local function myClass()
  local ok, _, token = call(UnitClass, "player")
  return ok and usable(token) and token or nil
end
L.MyClass = myClass

-- Règle de l'armure seule, pour la réponse d'un autre joueur : false (pas son type), true, nil (pas une armure, classe
-- ou objet inconnus)
function L.CanUseClass(item, class)
  local sub = armorType(item)
  local want = usable(class) and L.ARMOR_OF[class:upper()] or nil
  if not (sub and want) then return nil end
  return sub == want
end

-- Couleur rouge d'une ligne d'infobulle (texte « pas pour toi » du jeu : arme non maniée, classes d'un jeton…)
local function red(c)
  if type(c) ~= "table" or secret(c) then return false end
  local r, g, b = num(c.r), num(c.g), num(c.b)
  return r ~= nil and g ~= nil and b ~= nil and r > 0.9 and g < 0.3 and b < 0.3
end
local function plain(s) return F.trim((s:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""))) end
local tipCache = {} -- chaîne de l'objet → { usable, reason } (résultats sûrs seulement)
-- Infobulle du jeu (C_TooltipInfo.GetHyperlink) : une ligne en rouge, à gauche ou à droite, dit que l'objet n'est pas
-- pour moi. Objet pas encore connu du jeu : nil (l'infobulle serait incomplète), chargement demandé.
local function tooltipCheck(item, id)
  local str = F.ItemString(item) or ("item:" .. id)
  local hit = tipCache[str]
  if hit then return hit[1], hit[2] end
  if not (C_TooltipInfo and C_TooltipInfo.GetHyperlink) then return nil end
  local getInfo = (C_Item and C_Item.GetItemInfo) or GetItemInfo
  local okI, name = call(getInfo, str)
  if not (okI and usable(name)) then
    if C_Item and C_Item.RequestLoadItemDataByID then call(C_Item.RequestLoadItemDataByID, id) end
    return nil
  end
  local ok, data = pcall(C_TooltipInfo.GetHyperlink, str)
  if not ok or type(data) ~= "table" or secret(data) or type(data.lines) ~= "table" then return nil end
  local seen = false
  for _, line in ipairs(data.lines) do
    if type(line) == "table" and not secret(line) then
      seen = true
      for _, side in ipairs({ { line.leftText, line.leftColor }, { line.rightText, line.rightColor } }) do
        local text = usable(side[1]) and plain(side[1]) or ""
        if text ~= "" and red(side[2]) then
          if text == RETRIEVING_ITEM_INFO then return nil end -- « Récupération des informations… »
          tipCache[str] = { false, F.cut(text, 80) }
          return false, tipCache[str][2]
        end
      end
    end
  end
  if not seen then return nil end
  tipCache[str] = { true }
  return true
end

-- Puis-je porter cet objet ? usable (true, false, nil si inconnu : on laisse tout), raison (texte court). Mon perso :
-- classe du jeu (UnitClass, raid d'essai compris). Un objet que je porte déjà (même identifiant) est portable.
function L.CanUse(item)
  local ok, usableNow, reason = pcall(function()
    local id, loc = itemInfo(item)
    if not id then
      local want = F.ItemId(item)
      if want and C_Item and C_Item.RequestLoadItemDataByID then call(C_Item.RequestLoadItemDataByID, want) end
      return nil
    end
    local sub = armorType(item)
    if sub then
      local want = L.ARMOR_OF[myClass() or ""]
      if not want then return nil end
      if sub == want then return true end
      return false, "armure en " .. ARMOR_NAME[sub] .. " : pas ton type d'armure"
    end
    return tooltipCheck(item, id)
  end)
  if not ok then return nil end
  return usableNow, reason
end

local function findOffer(sid) for _, o in ipairs(L.offers) do if o.session == sid then return o end end return nil end
function L.Offers()
  local out = {}
  for _, o in ipairs(L.offers) do if not o.closed then out[#out + 1] = o end end
  return out
end

-- Ma réponse (changeable tant que le conseil est ouvert) : BiS, Upgrade et Off-spec refusés sur un objet que je ne peux
-- pas porter (renvoie false et le message)
local GEAR = { bis = true, upgrade = true, off = true }
function L.Answer(session, response, note)
  local o = findOffer(session)
  if not o or o.closed or not L.RESPONSES[response] then return false end
  if GEAR[response] then
    local can, why = L.CanUse(o.itemString)
    if can == false then
      local msg = "tu ne peux pas porter " .. o.link .. (why and (" (" .. why .. ")") or "") .. " : réponds Transmo ou Passer."
      ns.print(msg)
      return false, msg
    end
  end
  local gear = F.GearText(L.Equipped(o.itemString))
  local msg = "LA;" .. session .. ";" .. response .. ";" .. gear .. ";" .. F.cut(F.trim(F.clean(note or "")), 60)
  toCouncil(msg, o.from)
  Cm.Deliver(me(), msg, "SELF")
  o.answered, o.response = time(), response
  ui("ShowOffer")
  refresh()
  return true
end

-- Règle de l'armure sur la réponse d'un autre joueur (chef de butin et conseil) : BiS, Upgrade ou Off-spec sur une
-- armure qui n'est pas du type de sa classe devient Transmo. Raid d'essai : seulement si test.armorRule.
local function armorRuleOn() return not L.test or L.test.armorRule == true end
local function classOf(name)
  local m = member(name)
  if m and usable(m.class) then return m.class end
  if same(name, me()) then return myClass() end
  return nil
end
local function checked(c, who, response)
  if not (GEAR[response] and armorRuleOn()) or same(who, me()) then return response, nil end
  if L.CanUseClass(c.itemString, classOf(who)) == false then return "transmo", false end
  return response, nil
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
  local response, canUse = checked(c, who, f[3])
  c.cands[F.Fold(who)] = { name = who, response = response, asked = response ~= f[3] and f[3] or nil, canUse = canUse, gear = F.Gear(f[4]),
    note = whispered and "" or F.txt(f[5], 60), whispered = whispered, at = time() }
  -- Chef de butin : chaque réponse reçue d'un joueur est relayée au raid ; seuls les membres du conseil (qui ont ce
  -- conseil) la gardent. Un joueur sans les données du site ne l'envoie qu'au chef de butin.
  if not relayed and not L.test and same(c.master, me()) and not same(sender, me()) then
    send("LA;" .. c.session .. ";" .. response .. ";" .. F.clean(f[4] or "") .. ";" .. F.cut(F.clean(F.txt(f[5], 60)), 60) .. ";" .. who .. ";r")
  end
  refresh()
end)

-- Réponse chuchotée au chef de butin (« bis », « up », « os », « transmo », « passe »), suivie ou précédée du numéro de
-- l'objet (« bis 2 », « 2 bis ») ; sans numéro, valable s'il n'y a qu'un conseil ouvert, sinon rappel chuchoté (une fois
-- par lot de conseils)
local WHISPERED = { bis = "bis", up = "upgrade", upgrade = "upgrade", os = "off", off = "off", offspec = "off", ["off-spec"] = "off",
  transmo = "transmo", transmog = "transmo", pass = "pass", passe = "pass", ["je passe"] = "pass" }
function L.ParseWhisper(text)
  if not usable(text) then return nil end
  local s = F.trim(text):lower()
  local word, n = s:match("^(.-)%s*#?(%d+)$")
  if not (word and word ~= "") then n, word = s:match("^#?(%d+)%s*(.-)$") end
  if not (word and word ~= "") then word, n = s, nil end
  local r = WHISPERED[F.trim(word)]
  return r, r and tonumber(n) or nil
end
L.REMIND = "Précise le numéro de l'objet, par exemple « bis 2 »."
L.REMIND_UNKNOWN = "Pas d'objet n° %d au conseil : réponds avec un numéro de l'annonce, par exemple « bis 2 »."
local function remind(who, text)
  local k = fold(who)
  if not k or reminded[k] or chatLocked() then return false end
  if sendChat(text, "WHISPER", who) then reminded[k] = true end
  return true
end
function L.OnWhisper(text, sender)
  if not (usable(text) and usable(sender)) or not L.IsMaster() then return end
  local r, n = L.ParseWhisper(text)
  if not r then return end
  local who = F.FullName(sender)
  local open = openCouncils()
  if not who or #open == 0 then return end
  local c
  if n then for _, x in ipairs(open) do if x.num == n then c = x end end
  elseif #open == 1 then c = open[1] end
  if not c then remind(who, n and string.format(L.REMIND_UNKNOWN, n) or L.REMIND) return end
  -- Règle de l'armure appliquée avant le relais : le conseil (même avec un addon 0.2) reçoit déjà Transmo
  local asked = r
  r = checked(c, who, r)
  local msg = "LA;" .. c.session .. ";" .. r .. ";;chuchoté;" .. who
  toCouncil(msg, me())
  Cm.Deliver(me(), msg, "SELF")
  local x = r ~= asked and c.cands[F.Fold(who)]
  if x then x.asked, x.canUse = asked, false end
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
-- Catégorie d'un objet reçu, détail de la colonne « Reçus » (BiS · Upgrade · Jets MS) : "bis" (conseil BiS), "up"
-- (conseil Upgrade), "ms" (jet dont le détail commence par « MS »), nil (les autres, qui comptent ou non)
function L.Category(l)
  if type(l) ~= "table" then return nil end
  if l.method == "council" then
    if l.response == "bis" then return "bis" end
    if l.response == "upgrade" then return "up" end
    return nil
  end
  if l.method == "roll" and F.trim(l.detail):find("^MS") then return "ms" end
  return nil
end

-- Objets reçus d'un joueur : compte du site (N), ce soir (bilan en cours), l'objet N du site, et le détail
-- { bis, up, ms } = site (ligne D) + ce soir (L.Category)
function L.Received(name)
  local c = L.test and L.test.counts or ns.Groups.Counts(ns.Groups.LootRaid())
  local entry = F.CountFor(c, name)
  local names = entry and entry.names or { name }
  local log = L.test and L.testLog or ns.Recorder.Current()
  local tonight = 0
  local detail = { bis = tonumber(entry and entry.bis) or 0, up = tonumber(entry and entry.up) or 0, ms = tonumber(entry and entry.ms) or 0 }
  -- Objets du chef de butin pas encore distribués (ramassés, sans méthode) : pas les siens
  local holder = L.Enabled() and L.Master()
  for _, l in ipairs(log and log.loot or {}) do
    local waiting = holder and (l.method or "") == "" and same(l.who, holder)
    if not waiting and L.Counts(l) then
      for _, n in ipairs(names) do
        if same(l.who, n) then
          tonight = tonight + 1
          local cat = L.Category(l)
          if cat then detail[cat] = detail[cat] + 1 end
          break
        end
      end
    end
  end
  return entry and entry.n or 0, tonight, c, detail
end

-- Conseils de moins de 2 h, dans l'ordre de proposition (bande d'objets des fenêtres) : { session, num, link, name,
-- ilvl, itemId, master, closed, winner, answers, waiting, myVote, isMaster }
function L.Councils()
  local list, now, members, mine = {}, time(), L.Members(), fold(me())
  for _, c in pairs(L.councils) do if now - (c.at or 0) < L.COUNCIL_KEEP then list[#list + 1] = c end end
  table.sort(list, function(a, b) return (a.order or 0) < (b.order or 0) end)
  local out = {}
  for _, c in ipairs(list) do
    local answers, waiting = 0, 0
    for _ in pairs(c.cands) do answers = answers + 1 end
    for _, m in ipairs(members) do if not c.cands[m.key] then waiting = waiting + 1 end end
    local v = mine and c.votes[mine]
    out[#out + 1] = { session = c.session, num = c.num, link = c.link, name = c.name, ilvl = c.ilvl, itemId = c.itemId, master = c.master,
      closed = c.closed == true, winner = c.winner, answers = answers, waiting = waiting, myVote = v and v.cand or nil, isMaster = same(c.master, me()) }
  end
  return out
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
  local out = { session = c.session, num = c.num, key = c.key, itemId = c.itemId, link = c.link, name = c.name, ilvl = c.ilvl, master = c.master,
    closed = c.closed == true, winner = c.winner, myVote = myVote, cands = {}, waiting = {}, council = L.CouncilNames(), isMaster = same(c.master, me()) }
  local _, _, counts = L.Received(me())
  out.counts = counts
  -- Classes des membres (règle de l'armure), lues une fois
  local members, classes, rule = L.Members(), {}, armorRuleOn()
  for _, m in ipairs(members) do if usable(m.class) then classes[m.key] = m.class end end
  for k, x in pairs(c.cands) do
    local vs = voters[k] or {}
    table.sort(vs)
    local gear = {}
    for _, g in ipairs(x.gear or {}) do gear[#gear + 1] = { id = g.id, ilvl = g.ilvl, link = L.LinkFor(g.id) } end
    local site, tonight, _, d = L.Received(x.name)
    -- Peut-il le porter ? false : la règle de l'armure dit non pour sa classe (réponse devenue Transmo s'il voulait BiS…)
    local canUse = x.canUse
    if canUse == nil and rule then canUse = L.CanUseClass(c.itemString, classes[k] or (same(x.name, me()) and myClass() or nil)) end
    out.cands[#out.cands + 1] = { name = x.name, response = x.response, asked = x.asked, canUse = canUse, gear = gear, note = x.note or "",
      whispered = x.whispered, received = site + tonight, receivedSite = site, receivedTonight = tonight,
      receivedBis = d.bis, receivedUp = d.up, receivedMs = d.ms, votes = #vs, voters = vs }
  end
  table.sort(out.cands, function(a, b)
    local ra, rb = RANK[a.response] or 9, RANK[b.response] or 9
    if ra ~= rb then return ra < rb end
    if a.votes ~= b.votes then return a.votes > b.votes end
    return a.name < b.name
  end)
  for _, m in ipairs(members) do if not c.cands[m.key] then out.waiting[#out.waiting + 1] = m.name end end
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
    local was = logging
    logging = true
    local ok, idx = pcall(ns.Recorder.Award, e.itemId, full, method, response, detail, e.name, e.logIndex, e.key, nil, e.at)
    logging = was
    if ok then e.logIndex, e.logged = idx, idx ~= nil else ns.print("|cffff6060erreur (bilan)|r " .. tostring(idx)) end
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
-- Échange au gagnant. Dès qu'une fenêtre d'échange s'ouvre (TRADE_SHOW) avec un joueur à qui des objets sont attribués,
-- qu'il l'ait ouverte lui-même ou que le chef de butin ait cliqué « Échanger » (InitiateTrade), ses objets sont posés
-- dans les cases libres (6 au plus) ; à la fermeture, chaque objet dont le nombre d'exemplaires dans les sacs a baissé
-- est remis. « Échanger » sans fenêtre au bout de 4 s : le message d'erreur du jeu (UI_ERROR_MESSAGE) s'il y en a un,
-- sinon la marche à suivre (le gagnant ouvre l'échange). Jamais en combat.
--------------------------------------------------------------------------------------------------------------------
L.TRADE_WAIT = 4      -- secondes : fenêtre d'échange attendue après « Échanger »
L.TRADE_DELAY = 0.3   -- secondes : la fenêtre d'échange doit être prête avant d'y poser les objets
L.TRADE_STEP = 0.2    -- secondes entre deux objets posés
L.trading = nil       -- échange ouvert : { partner, at, placed = { { key, itemId, bag, slot, tradeSlot, count } }, closing }
L.tradeAsk = nil      -- « Échanger » en attente de la fenêtre : { winner, at, errors }
local tradeOpen = false

local function countOf(id)
  local getCount = (C_Item and C_Item.GetItemCount) or GetItemCount
  local ok, n = call(getCount, id)
  if ok and type(n) == "number" and not secret(n) then return n end
  return nil
end
local function inCombat() local ok, v = call(InCombatLockdown) return ok and not secret(v) and v == true end
local function links(entries) local out = {} for _, e in ipairs(entries) do out[#out + 1] = e.link end return table.concat(out, ", ") end
-- Cases d'échange du joueur (MAX_TRADABLE_ITEMS : 6 ; la 7e est « ne sera pas échangé »)
local function tradeSlots()
  local n = num(MAX_TRADABLE_ITEMS) or 6
  return math.max(1, math.min(6, n))
end

-- Objets attribués à un gagnant, pas encore remis (dans l'ordre de la liste)
function L.Handover(name)
  local out = {}
  if not name then return out end
  for _, e in ipairs(list()) do if e.status == "awarded" and e.winner and same(e.winner, name) then out[#out + 1] = e end end
  return out
end
local function anyAwarded() for _, e in ipairs(list()) do if e.status == "awarded" then return true end end return false end

-- Partenaire de l'échange ouvert : « Prénom-Royaume » (UnitFullName("npc"), sinon UnitName("npc")), nil si illisible
local function tradePartner()
  local ok, name, realm = call(UnitFullName, "npc")
  if not (ok and usable(name) and name ~= "") then ok, name, realm = call(UnitName, "npc") end
  if ok and usable(name) and name ~= "" then return F.FullName(name, usable(realm) and realm or nil) end
  return nil
end

function L.Trade(key)
  local e = L.Find(key)
  if not (e and e.winner and e.status == "awarded") then return false end
  if L.test then
    if L.test.trade then ns.safe("raid d'essai", L.test.trade, e) end
    return true
  end
  local who = F.Display(e.winner)
  if inCombat() then ns.print("pas d'échange en combat : réessaie juste après.") return false end
  local m = member(e.winner)
  if not (m and m.unit) then ns.print(who .. " n'est pas dans le groupe.") return false end
  -- Trop loin seulement si le jeu le dit vraiment (false) : ni valeur secrète, ni nil
  local okD, near = call(CheckInteractDistance, m.unit, 2)
  if okD and not secret(near) and near == false then ns.print(who .. " est trop loin pour échanger : rapproche-toi.") return false end
  -- Fenêtre déjà ouverte : avec le gagnant, ses objets y sont (re)posés ; avec un autre, à fermer d'abord
  if tradeOpen then
    local t = L.trading
    if t and same(t.partner, e.winner) then L.FillTrade(e.winner) return true end
    ns.print("un échange est déjà ouvert" .. (t and (" avec " .. F.Display(t.partner)) or "") .. " : ferme-le d'abord.")
    return false
  end
  local ask = { winner = e.winner, at = time(), errors = {} }
  L.tradeAsk = ask
  if not call(InitiateTrade, m.unit) then
    L.tradeAsk = nil
    ns.print("le jeu n'a pas permis d'ouvrir l'échange avec " .. who .. ".")
    return false
  end
  ns.print("échange demandé à " .. who .. " : ses objets seront posés tout seuls dans la fenêtre d'échange.")
  if C_Timer and C_Timer.After then C_Timer.After(L.TRADE_WAIT, function() ns.safe("échange", L.TradeTimeout, ask) end) end
  return true
end

L.NO_WINDOW = "demande-lui d'ouvrir l'échange avec toi (clic droit sur ton portrait › Échanger), l'objet sera posé tout seul."
-- Pas de fenêtre d'échange 4 s après « Échanger » : ce que le jeu a dit, sinon la marche à suivre
function L.TradeTimeout(ask)
  if L.tradeAsk ~= ask then return end -- fenêtre ouverte entre-temps, ou nouvelle demande
  L.tradeAsk = nil
  local who = F.Display(ask.winner)
  local err = ask.errors[#ask.errors]
  if err then ns.print("pas de fenêtre d'échange avec " .. who .. ". Le jeu dit : « " .. err .. " » Sinon, " .. L.NO_WINDOW)
  else ns.print("pas de fenêtre d'échange avec " .. who .. " : " .. L.NO_WINDOW) end
end
ns.on("UI_ERROR_MESSAGE", function(_, message)
  local ask = L.tradeAsk
  if not ask or not usable(message) or #ask.errors >= 5 then return end
  local text = plain(message)
  if text ~= "" then ask.errors[#ask.errors + 1] = F.cut(text, 120) end
end)

-- Fenêtre d'échange ouverte, par n'importe qui : les objets attribués au partenaire y seront posés. Raid d'essai : pas de
-- vrai échange ; Test.lua peut simuler un échange ouvert par un gagnant fictif (partner) : crochet test.tradeShow, sinon
-- test.trade pour chaque objet.
function L.OnTradeShow(partner)
  if L.test then
    local full = F.FullName(partner)
    local items = L.Handover(full)
    if #items == 0 then return end
    ns.print("objets posés dans l'échange avec " .. F.Display(full) .. " (raid d'essai) : " .. links(items) .. ".")
    if L.test.tradeShow then ns.safe("raid d'essai", L.test.tradeShow, full, items)
    elseif L.test.trade then for _, e in ipairs(items) do ns.safe("raid d'essai", L.test.trade, e) end end
    return
  end
  tradeOpen = true
  L.tradeAsk = nil -- une fenêtre s'est ouverte : plus d'attente
  if L.trading and not L.trading.closing then L.trading = nil end -- fin d'un échange précédent jamais vue
  local full = tradePartner()
  if not full then
    if anyAwarded() then ns.print("échange : le jeu ne donne pas le nom du partenaire, pose les objets à la main.") end
    return
  end
  if #L.Handover(full) == 0 then return end
  L.trading = { partner = full, at = time(), placed = {} }
  if C_Timer and C_Timer.After then C_Timer.After(L.TRADE_DELAY, function() ns.safe("échange", L.FillTrade, full) end)
  else L.FillTrade(full) end
end

-- Pose les objets attribués au partenaire dans les cases libres de l'échange ouvert ; jamais deux fois la même case des
-- sacs, ni un objet déjà dans l'échange. Dit dans le chat ce qui a été posé, et ce qui ne l'a pas été (et pourquoi).
function L.FillTrade(full)
  if L.test or not tradeOpen then return false end
  local t = L.trading
  if not (t and not t.closing and same(t.partner, full)) then return false end
  local items = L.Handover(full)
  if #items == 0 then return false end
  local who = F.Display(full)
  if inCombat() then ns.print("en combat : pose les objets de " .. who .. " à la main, ou rouvre l'échange après le combat.") return false end
  local max = tradeSlots()
  -- Cases déjà prises, et objets déjà dans l'échange (posés à la main, ou par un premier passage)
  local taken, inTrade = {}, {}
  for i = 1, max do
    local ok, link = call(GetTradePlayerItemLink, i)
    if ok and secret(link) then taken[i] = true
    elseif ok and usable(link) and link ~= "" then
      taken[i] = true
      local id = F.ItemId(link)
      if id then inTrade[id] = (inTrade[id] or 0) + 1 end
    end
  end
  local done, used = {}, {}
  for _, p in ipairs(t.placed) do
    done[p.key] = true
    if p.bag then used[p.bag .. ":" .. p.slot] = true end
    if p.tradeSlot then taken[p.tradeSlot] = true end -- case réservée (objet peut-être pas encore posé)
    if p.itemId and (inTrade[p.itemId] or 0) > 0 then inTrade[p.itemId] = inTrade[p.itemId] - 1 end
  end
  local placed, missed, steps, free = {}, {}, {}, 1
  for _, e in ipairs(items) do
    if not done[e.key] then
      if (inTrade[e.itemId] or 0) > 0 then
        inTrade[e.itemId] = inTrade[e.itemId] - 1
        t.placed[#t.placed + 1] = { key = e.key, itemId = e.itemId, count = countOf(e.itemId) }
        placed[#placed + 1] = e.link
      elseif e.expires and time() > e.expires then
        missed[#missed + 1] = e.link .. " (délai d'échange passé)"
      else
        while free <= max and taken[free] do free = free + 1 end
        local bag, slot
        if free <= max then bag, slot = L.FindInBags(e, used) end
        if free > max then missed[#missed + 1] = e.link .. " (plus de case libre dans l'échange)"
        elseif not bag then missed[#missed + 1] = e.link .. " (introuvable dans tes sacs)"
        else
          used[bag .. ":" .. slot] = true
          e.bag, e.slot = bag, slot
          taken[free] = true
          t.placed[#t.placed + 1] = { key = e.key, itemId = e.itemId, bag = bag, slot = slot, tradeSlot = free, count = countOf(e.itemId) }
          steps[#steps + 1] = { bag = bag, slot = slot, tradeSlot = free, itemId = e.itemId }
          placed[#placed + 1] = e.link
        end
      end
    end
  end
  -- Un objet à la fois (le serveur traite chaque case) : prendre dans le sac, poser dans la case d'échange
  for i, s in ipairs(steps) do
    local function put()
      if not tradeOpen or L.trading ~= t or inCombat() then return end
      local okL, link = call(C_Container and C_Container.GetContainerItemLink, s.bag, s.slot)
      if not (okL and usable(link) and F.ItemId(link) == s.itemId) then return end -- sacs changés entre-temps
      call(ClearCursor)
      call(C_Container and C_Container.PickupContainerItem, s.bag, s.slot)
      call(ClickTradeButton, s.tradeSlot)
    end
    if i == 1 or not (C_Timer and C_Timer.After) then put()
    else C_Timer.After((i - 1) * L.TRADE_STEP, function() ns.safe("échange", put) end) end
  end
  if #placed > 0 then ns.print("objets posés dans l'échange avec " .. who .. " : " .. table.concat(placed, ", ") .. ". Vérifie, puis valide l'échange.") end
  if #missed > 0 then ns.print("pas posé pour " .. who .. " : " .. table.concat(missed, ", ") .. ".") end
  refresh()
  return #placed > 0
end

-- Fenêtre fermée : chaque objet posé qui a quitté les sacs (moins d'exemplaires qu'avant) est remis ; échange annulé :
-- rien ne change
function L.OnTradeClosed()
  tradeOpen = false
  local t = L.trading
  if not t or t.closing then return end
  t.closing = true
  local function check()
    if L.trading == t then L.trading = nil end
    -- Exemplaires partis, par objet (deux exemplaires du même objet : deux de moins)
    local before, gone = {}, {}
    for _, p in ipairs(t.placed) do
      if p.count and (not before[p.itemId] or p.count > before[p.itemId]) then before[p.itemId] = p.count end
    end
    for id, n in pairs(before) do
      local now = countOf(id)
      gone[id] = now and (n - now) or 0
    end
    local given = {}
    for _, p in ipairs(t.placed) do
      local e = (gone[p.itemId] or 0) > 0 and L.Find(p.key)
      if e and e.status == "awarded" then
        e.status, e.tradedAt, e.bag, e.slot = "traded", time(), nil, nil
        given[#given + 1] = e.link
        gone[p.itemId] = gone[p.itemId] - 1
      end
    end
    if #given > 0 then ns.print("remis à " .. F.Display(t.partner) .. " : " .. table.concat(given, ", ") .. ".") end
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
  L.councils, L.offers, L.rollSessions, L.activeRoll, L.trading, L.tradeAsk = {}, {}, {}, nil, nil, nil
  reminded = {}
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
