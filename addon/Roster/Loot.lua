-- Distribution du butin par Roster (lot R3b), comme RCLootCouncil : le chef de butin (chef de raid, ou celui qu'il
-- désigne) prend chaque objet du butin de groupe, les autres addons passent ; entre les pulls, il décide (conseil du
-- butin, jets MS / OS, jet libre, garder), l'annonce dans le raid et le chuchote au gagnant, puis lui échange l'objet
-- (2 h, joueurs présents au butin). Messages entre addons : docs/addon-format.md (section Roster, ML à LW).
-- Retours du raid de test (0.3) :
--   - échange : dès qu'une fenêtre d'échange s'ouvre avec un gagnant (qu'il l'ait ouverte ou non), ses objets sont posés
--     (6 au plus) ; remis quand ils ont quitté les sacs à la fermeture. « Échanger » sans fenêtre : message du jeu ou marche
--     à suivre (Lo.Trade, Lo.OnTradeShow, Lo.FillTrade, Lo.OnTradeClosed, Lo.Handover) ;
--   - objets portables : BiS, Upgrade, Off-spec seulement sur ce qu'on peut porter (Lo.CanUse : armure du type exact de la
--     classe, armes que la classe manie (retours du raid du 11/10/2026), sinon infobulle du jeu) ; chez le chef de butin
--     et le conseil, la règle de l'armure et des armes fait d'une telle réponse d'un autre joueur une réponse Transmo
--     (Lo.CanUseClass) ;
--   - tout au conseil d'un coup, numéroté (Lo.StartAllCouncils, Lo.Councils) ; « bis 2 » chuchoté vise l'objet 2 ;
--   - colonne « Reçus » détaillée : BiS · Upgrade · Jets MS (ligne D du site, Lo.Category, Lo.Received).
-- Historique durable (R4a, 0.4.0 ; History.lua) : chaque attribution (Lo.Award, Lo.Keep), chaque LW reçu et chaque objet
-- gagné au butin de groupe sans passer y crée ou met à jour une entrée, sans raid du site ; LW porte l'identifiant, la
-- version et le niveau de l'entrée (champs 8 à 10). « Reçus » = site (N, D) + historique après la date des données du
-- site ; le chef de butin joint ses nombres à chaque réponse qu'il relaie (LA, champs 8 à 12) : le conseil voit les mêmes.
-- Conseil défini en jeu (R4b, 0.4.1 ; Council.lua) : le conseil de ce soir (Lo.CouncilSource) vient, dans l'ordre, du MC
-- du chef de butin, du conseil réglé en jeu, du site (lignes L / O), puis de la guilde au rang par défaut ; le chef de
-- butin envoie le sien au raid (MC) pour que tous les addons soient d'accord, même sans liste de guilde ni site.
-- WoW 12.x : messages d'addon et chat bloqués pendant une rencontre de boss (file de Comm.lua), textes du chat
-- (jets, chuchotements) secrets pendant le verrou du chat : jamais comparés ni gardés.
-- Raid d'essai (Test.lua) : ns.Loot.test remplace le raid, ses membres, les messages, le chat et l'échange ; rien n'est
-- écrit dans le bilan ni dans la sauvegarde (historique en mémoire : ns.Hist.test). Crochets : send, say, trade(entry),
-- reroll, et facultatifs tradeShow(partner, objets) (échange ouvert par un gagnant fictif) et armorRule (true : la règle
-- de l'armure et des armes s'applique aussi aux réponses des joueurs fictifs) ; counts (objets reçus, avec bis / up / ms
-- par entrée si voulu).
-- Langue (addon/shared/Locale.lua) : L["texte"] et L("format", …) traduisent à l'affichage ; le module s'appelle donc Lo.
-- Annonces et chuchotements partent dans la langue du chef de butin ; les chuchotements reçus sont lus en français et en
-- anglais (Lo.ParseWhisper). Restent en français : messages entre addons et détails pour le site (« gardé », « MS 87 »).
local _, ns = ...
local L, N = ns.L, ns.N
local Lo = {}
ns.Loot = Lo
local F, Cm = ns.Format, ns.Comm

local secret, usable = F.secret, F.usable
Lo.WAIT_LR = 20          -- secondes : attente du LR du chef de butin avant de passer
Lo.KEEP = 12 * 3600      -- objets du chef de butin gardés 12 h au plus
Lo.ML_EVERY = 10         -- secondes : état de la distribution renvoyé au plus toutes les 10 s quand le raid change
Lo.NOT_PASSED_KEEP = 2 * 3600
Lo.test = nil
Lo.testItems, Lo.testNotPassed = {}, {}

local function db() return ns.db and ns.db() end
local function me() return Cm.Me() end
local function same(a, b) return F.SameName(a, b) end
local function fold(name) return F.Key(name) end
local function call(fn, ...) if type(fn) ~= "function" then return false end return pcall(fn, ...) end
local function flag(v) return not secret(v) and v ~= nil and v ~= false and v ~= 0 end
local function refresh()
  if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
  if ns.LootUI and ns.LootUI.Refresh then ns.safe(L["fenêtres du butin"], ns.LootUI.Refresh) end
end
local function ui(fn, ...)
  local U = ns.LootUI
  if U and U[fn] then ns.safe(L["fenêtres du butin"], U[fn], ...) end
end
local function minQuality() return (ns.Recorder and ns.Recorder.MinQuality and ns.Recorder.MinQuality()) or 4 end
-- Historique (History.lua) : relevé de la soirée un instant après un changement de la distribution
local function histSoon()
  if ns.Hist and ns.Hist.Sample and C_Timer and C_Timer.After then
    C_Timer.After(1, function() ns.safe(L["historique du butin"], ns.Hist.Sample) end)
  end
end
local seq = 0
local function nextSeq() seq = seq + 1 return seq end
local order = 0 -- ordre de proposition des conseils
local function nextOrder() order = order + 1 return order end
local function num(v) return type(v) == "number" and not secret(v) and v or nil end

-- Réponses au conseil (libellés choisis par Flo, en français : traduits à l'affichage par Lo.Label) et ordre d'affichage
Lo.RESPONSES = { bis = N("BiS"), upgrade = N("Upgrade"), off = N("Off-spec"), transmo = N("Transmo"), pass = N("Passer") }
Lo.ORDER = { "bis", "upgrade", "off", "transmo", "pass" }
--- Libellé d'une réponse dans la langue de l'interface (nil : réponse inconnue)
function Lo.Label(response)
  local label = Lo.RESPONSES[response or ""]
  return label and L[label] or nil
end
local RANK = { bis = 1, upgrade = 2, off = 3, transmo = 4, pass = 5 }
-- Types de jet du butin de groupe (Enum.LootRollType) : passer, besoin, cupidité, transmo
local ROLL = { pass = 0, need = 1, greed = 2, transmog = 4 }
local ROLL_LABEL = { [1] = N("Besoin"), [2] = N("Cupidité"), [4] = N("Transmo") }

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
local function list() if Lo.test then return Lo.testItems end return store().items end
local function notPassedList() if Lo.test then return Lo.testNotPassed end return store().notPassed end
local function state()
  if Lo.test then return {} end
  local d = db()
  if not d then return {} end
  -- État d'un autre soir (sauvegarde gardée d'une session à l'autre) : oublié au bout de 12 h
  if d.lootState and d.lootState.at and time() - d.lootState.at > Lo.KEEP then d.lootState = nil end
  d.lootState = d.lootState or {}
  return d.lootState
end

--------------------------------------------------------------------------------------------------------------------
-- Membres du raid, chef de raid, chef de butin
--------------------------------------------------------------------------------------------------------------------
-- { name, key, class, subgroup, online, addon, unit, leader } ; raid d'essai : les membres simulés (moi compris)
function Lo.Members()
  local out, mine = {}, fold(me())
  if Lo.test then
    local seen = false
    for _, m in ipairs(Lo.test.members or {}) do
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
  for _, m in ipairs(Lo.Members()) do if m.key == k then return m end end
  return nil
end
Lo.Member = member

-- Chef de raid (chef du groupe hors raid) ; seul ou en raid d'essai : moi
function Lo.Leader()
  if Lo.test or not Cm.InGroup() then return me() end
  for _, m in ipairs(Lo.Members()) do if m.leader then return m.name end end
  return nil
end

-- Chef de butin : celui que le chef de raid a désigné s'il est encore dans le raid, sinon le chef de raid
function Lo.Master()
  if Lo.test or not Cm.InGroup() then return me() end
  local s = state()
  if s.master and member(s.master) then return s.master end
  return Lo.Leader()
end
function Lo.IsMaster()
  if Lo.test then return true end
  local m = Lo.Master()
  return m ~= nil and same(m, me())
end

-- Distribution par Roster : décidée par le chef de raid ou le chef de butin (ML) ; d'office, activée quand le raid
-- chargé est en mode « conseil » sur le site
function Lo.DefaultOn()
  local e = ns.Groups and ns.Groups.LootRaid and ns.Groups.LootRaid()
  return e ~= nil and e.raid.loot == "council"
end
function Lo.Enabled()
  if Lo.test then return true end
  local s = state()
  if s.on ~= nil then return s.on == true end
  return Lo.DefaultOn()
end
-- Passer automatique : réglage de chaque joueur (Options), activé par défaut
function Lo.AutoPass() local d = db() return not (d and d.autoPass == false) end

--------------------------------------------------------------------------------------------------------------------
-- Messages (préfixe RosterRT, file de Comm.lua) et chat
--------------------------------------------------------------------------------------------------------------------
local function send(msg, dist, target)
  if Lo.test then
    if dist == "WHISPER" and same(target, me()) then Cm.Deliver(me(), msg, "WHISPER") return true end
    if Lo.test.send then ns.safe(L["raid d'essai"], Lo.test.send, msg, dist or "RAID", target) end
    return true
  end
  return Cm.Send(msg, dist, target)
end
Lo.send = send
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
  if Lo.test then
    if Lo.test.say then ns.safe(L["raid d'essai"], Lo.test.say, text, chatType, target) end
    return true
  end
  local api = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
  if not api then return false end
  return (pcall(api, text, chatType, nil, target))
end
local function announce(text)
  local ch = Lo.test and "RAID" or Cm.Channel()
  if not ch then ns.print(text) return false end
  return sendChat(text, ch)
end
Lo.announce = announce
-- Messages du chat de 255 octets au plus, liens compris : morceaux { texte, séparateur } joints tant qu'ils tiennent,
-- jamais coupés (un lien coupé ne s'afficherait pas)
Lo.CHAT_MAX = 255
function Lo.ChatLines(pieces, max)
  max = max or Lo.CHAT_MAX
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
local function chatLocked() return not Lo.test and Cm.ChatLocked() end
local LOCKED = N("pas pendant un combat de boss : réessaie juste après le combat.")

--------------------------------------------------------------------------------------------------------------------
-- État de la distribution : ML (chef de raid ou chef de butin → raid), MQ (demande)
--------------------------------------------------------------------------------------------------------------------
local lastML = 0
-- force : le conseil de ce soir (MC) repart même s'il n'a pas changé (nouveau chef de butin, demande MQ)
local function sendML(force)
  if Lo.test or not Cm.InGroup() then return false end
  lastML = time()
  local ok = send("ML;" .. (Lo.Enabled() and "1" or "0") .. ";" .. F.clean(Lo.Master() or ""))
  if Lo.IsMaster() and Lo.Enabled() and Lo.SendCouncil then Lo.SendCouncil(force) end
  return ok
end
Lo.SendState = sendML

function Lo.SetMaster(name)
  if Lo.test then ns.print(L["raid d'essai : tu restes chef de butin."]) return false end
  if not Cm.InGroup() then ns.print(L["il faut être en groupe ou en raid pour désigner un chef de butin."]) return false end
  if not Cm.IsLeader() then ns.print(L["seul le chef de raid désigne le chef de butin."]) return false end
  local full = name and F.FullName(name)
  if full and not member(full) then ns.print(L("%s n'est pas dans le raid.", F.Display(full))) return false end
  local s = state()
  if s.on == nil then s.on = Lo.Enabled() end -- l'état d'office devient celui de tous
  s.master = (full and not same(full, me())) and full or nil
  s.at = time()
  Lo.mc = nil -- conseil de ce soir de l'ancien chef de butin : le nouveau envoie le sien
  sendML(true)
  local m = Lo.Master()
  local shown = m and F.Display(m) or "?"
  ns.print(Lo.IsMaster() and L("chef de butin : %s (toi).", shown) or L("chef de butin : %s.", shown))
  refresh()
  return true
end

function Lo.SetEnabled(on)
  if Lo.test then return true end
  if not (Lo.IsMaster() or (Cm.InGroup() and Cm.IsLeader())) then
    ns.print(L["seul le chef de raid ou le chef de butin active la distribution par Roster."])
    return false
  end
  local s = state()
  s.on, s.at = on and true or false, time()
  sendML(true)
  ns.print(s.on and L["distribution du butin par Roster activée : les autres joueurs passeront le butin de groupe."]
    or L["distribution du butin par Roster coupée : butin de groupe habituel."])
  histSoon()
  refresh()
  return true
end

Cm.On("ML", function(sender, f, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) then return end
  local leader = Lo.Leader()
  local fromLeader = leader ~= nil and same(sender, leader)
  if not (fromLeader or same(sender, Lo.Master())) then return end -- seuls le chef de raid et le chef de butin décident
  local s = state()
  local wasOn, wasMaster = Lo.Enabled(), Lo.Master()
  s.on, s.at = f[2] == "1", time()
  if fromLeader then
    local named = F.FullName(F.txt(f[3], 60))
    s.master = (named and not same(named, sender)) and named or nil
  end
  local on, m = Lo.Enabled(), Lo.Master()
  -- Autre chef de butin : son conseil de ce soir (MC) remplacera celui de l'ancien ; devenu chef de butin : j'envoie le mien
  if not same(m, wasMaster) then Lo.mc = nil end
  if on and Lo.IsMaster() and (not wasOn or not same(m, wasMaster)) and C_Timer and C_Timer.After then
    C_Timer.After(1, function() ns.safe(L["conseil du butin"], Lo.SendCouncil, true) end)
  end
  if on ~= wasOn or not same(m, wasMaster) then
    if not on then ns.print(L["distribution du butin par Roster coupée : butin de groupe habituel."])
    elseif Lo.IsMaster() then ns.print(L["tu es chef de butin : les objets du butin de groupe te reviennent (fenêtre du butin : /roster butin)."])
    else
      ns.print(L("distribution du butin par Roster : %s distribue. %s", m and F.Display(m) or L["le chef de butin"],
        Lo.AutoPass() and L["Tu passeras automatiquement le butin de groupe (Options pour le couper)."] or L["Passer automatique coupé chez toi (Options)."]))
    end
    histSoon()
  end
  refresh()
end)

Cm.On("MQ", function(sender, _, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) then return end
  if Cm.IsLeader() or Lo.IsMaster() then sendML(true) end
end)

-- Arrivée dans un groupe, /reload en groupe : on demande l'état ; le groupe change : le chef de raid et le chef de
-- butin le renvoient (au plus toutes les 10 s) ; groupe quitté : l'état est oublié
local wasGroup, lastCount, mlDue = false, 0, false
local function ask() if not Lo.test and Cm.InGroup() and not Cm.IsLeader() then send("MQ") end end
local function rosterChanged()
  if Lo.test then return end
  local inGroup = Cm.InGroup()
  local count = inGroup and #(Cm.Roster()) or 0
  if inGroup and not wasGroup and C_Timer and C_Timer.After then C_Timer.After(4, ask) end
  if not inGroup and wasGroup then
    -- Groupe quitté : état oublié, conseils et jets arrêtés (les objets restent à remettre)
    local d = db()
    if d then d.lootState = nil end
    Lo.pending, Lo.offers, Lo.activeRoll, Lo.mc = {}, {}, nil, nil
    for _, c in pairs(Lo.councils) do c.closed = true end
    for _, s in pairs(Lo.rollSessions) do s.open = false end
    for _, e in ipairs(list()) do if e.status == "council" or e.status == "roll" then e.status = "new" end end
    ui("Refresh")
  end
  if inGroup and wasGroup and count > lastCount and (Cm.IsLeader() or Lo.IsMaster()) and not mlDue then
    local wait = math.max(0, Lo.ML_EVERY - (time() - lastML))
    if wait == 0 or not (C_Timer and C_Timer.After) then sendML()
    else mlDue = true C_Timer.After(wait, function() mlDue = false sendML() end) end
  end
  wasGroup, lastCount = inGroup, count
end
ns.on("GROUP_ROSTER_UPDATE", function() ns.safe(L["butin"], rosterChanged) end)
ns.on("PLAYER_ENTERING_WORLD", function(login, reload)
  if (login or reload) and C_Timer and C_Timer.After then C_Timer.After(5, function() ns.safe(L["butin"], ask) end) end
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
Lo.ilvlOf = ilvlOf
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
function Lo.LinkFor(item, name, quality)
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
  return "|cnIQ" .. quality .. ":|H" .. str .. "|h[" .. F.clean(name or L("objet %d", id)) .. "]|h|r"
end

function Lo.Find(key)
  for _, e in ipairs(list()) do if e.key == key then return e end end
  return nil
end
local function newEntry(link, expires)
  local id = F.ItemId(link)
  if not id then return nil end
  local e = { key = string.format("%d-%d-%d", time(), id, nextSeq()), itemId = id, link = link, name = F.ItemName(link) or ("objet " .. id), -- nolocale (sauvegardé, envoyé)
    ilvl = ilvlOf(link), quality = qualityOf(link, id), at = time(), expires = expires, status = "new" }
  local all = list()
  all[#all + 1] = e
  return e
end

-- Place de l'objet dans les sacs (sacs 0 à 4) : même lien d'abord (bonus compris), sinon même objet ; jamais une
-- place déjà prise par un autre objet de la liste, ni une place de « exclude » (« sac:case » → true : déjà posée
-- dans l'échange)
function Lo.FindInBags(e, exclude)
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
function Lo.TradeTimeLeft(bag, slot)
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
function Lo.Locate(e, tries)
  if Lo.test or Lo.Find(e.key) ~= e then return false end
  local bag, slot = Lo.FindInBags(e)
  if bag then
    e.bag, e.slot, e.missing = bag, slot, nil
    local left = Lo.TradeTimeLeft(bag, slot)
    if left then e.expires = time() + left end
    refresh()
    return true
  end
  tries = (tries or 0) + 1
  if tries <= 4 and C_Timer and C_Timer.After then C_Timer.After(tries, function() ns.safe(L["butin"], Lo.Locate, e, tries) end) end
  return false
end

-- Objets plus vieux que 12 h, ou dont l'échange n'est plus possible, retirés
-- Attributions pas encore notées dans le bilan (relevé en pause au moment du clic : /reload, groupe quitté un
-- instant…) : rattrapées dès que le relevé reprend, avant l'export et avant de retirer un vieil objet
-- (jamais deux à la fois : noter rafraîchit la minicarte, qui relit la liste des objets)
local logging = false
function Lo.LogAwards()
  if logging or Lo.test or not (ns.Recorder and ns.Recorder.Award) then return 0 end
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
Lo.IsLogging = function() return logging end

function Lo.Prune()
  if not Lo.test then Lo.LogAwards() end
  local all, now = list(), time()
  for i = #all, 1, -1 do
    local e = all[i]
    local done = e.status == "traded" or e.status == "kept"
    local expired = not done and e.expires and now > e.expires
    if expired and e.status == "awarded" and e.winner then
      ns.print(L("délai d'échange passé, objet pas remis à %s : %s.", F.Display(e.winner), e.link))
    end
    if expired or now - (e.at or 0) > Lo.KEEP then
      if e.session and Lo.councils[e.session] then Lo.councils[e.session].closed = true end
      if Lo.activeRoll == e.key then Lo.activeRoll = nil end
      table.remove(all, i)
    end
  end
  local np = notPassedList()
  for i = #np, 1, -1 do if now - (np[i].at or 0) > Lo.NOT_PASSED_KEEP then table.remove(np, i) end end
end

function Lo.Items()
  Lo.Prune()
  return list()
end

-- Raid d'essai : objet reçu comme par le butin de groupe
function Lo.AddTestItem(link, expiresIn)
  if not Lo.test then return nil end
  local e = newEntry(link, expiresIn and (time() + expiresIn) or nil)
  if not e then return nil end
  ui("ShowLoot")
  refresh()
  return e
end

function Lo.Remove(key)
  local all = list()
  for i = #all, 1, -1 do
    local e = all[i]
    if e.key == key then
      Lo.Cancel(key, true)
      table.remove(all, i)
    end
  end
  refresh()
end

-- Objet échangé à la main (sans passer par « Échanger ») : marqué remis
function Lo.MarkTraded(key)
  local e = Lo.Find(key)
  if not e then return false end
  e.status, e.tradedAt = "traded", time()
  refresh()
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Butin de groupe : le chef de butin prend l'objet (Besoin, sinon Transmo, sinon Cupidité) et l'annonce (LR) ;
-- les autres attendent ce LR (20 s au plus) puis passent
--------------------------------------------------------------------------------------------------------------------
Lo.pending = {}   -- rollID → { rollID, itemId, link, quality, at } (joueur : en attente du LR)
Lo.taken = {}     -- rollID → { itemId, choice } (chef de butin : jets pris par l'addon, à confirmer)
Lo.signals = {}   -- itemId → heure du dernier LR reçu
Lo.rolled = {}    -- itemId → { at, n, link } (chef de butin : objets pris, pour repérer qui les gagne à sa place)

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
  it.link = it.link or (it.itemId and Lo.LinkFor(it.itemId)) or it.name or "?"
  it.quality = it.quality or qualityOf(it.link, it.itemId)
  return it
end
-- Durée en millisecondes (jets du butin de groupe) ou en secondes : ramenée en secondes
local function seconds(v)
  if type(v) ~= "number" or secret(v) then return nil end
  return v > 600 and v / 1000 or v
end
local function signalFor(id) local t = Lo.signals[id] return t ~= nil and time() - t <= 60 end

function Lo.PassRoll(p)
  if Lo.pending[p.rollID] ~= p then return false end
  Lo.pending[p.rollID] = nil
  if not Lo.AutoPass() then
    ns.print(L("le chef de butin distribue %s : passer automatique coupé chez toi (Options), à toi de choisir.", p.link))
    return false
  end
  call(RollOnLoot, p.rollID, ROLL.pass)
  ns.print(L("jet passé pour %s : c'est le chef de butin qui distribue.", p.link))
  return true
end

function Lo.RollTimeout(rollID, p)
  if Lo.pending[rollID] ~= p then return end
  if signalFor(p.itemId) then Lo.PassRoll(p) return end
  Lo.pending[rollID] = nil
  if p.quality and p.quality < minQuality() then return end
  ns.print(L("pas de signal du chef de butin pour %s (il n'y a peut-être pas droit) : tu n'as pas passé, à toi de choisir.", p.link))
end

-- Chef de butin : prend l'objet et prévient les autres addons
function Lo.TakeRoll(rollID, it)
  if it.quality and it.quality < minQuality() then return false end -- butin ordinaire : jet habituel
  local choice = (it.canNeed and ROLL.need) or (it.canTransmog and ROLL.transmog) or (it.canGreed and ROLL.greed) or nil
  if not choice then
    ns.print(L("tu ne peux pas prendre %s (ni Besoin, ni Transmo, ni Cupidité) : les autres joueurs ne passeront pas leur jet.", it.link))
    return false
  end
  Lo.taken[rollID] = { itemId = it.itemId, choice = choice }
  call(RollOnLoot, rollID, choice)
  local r = Lo.rolled[it.itemId]
  Lo.rolled[it.itemId] = { at = time(), n = (r and time() - r.at < 600 and r.n or 0) + 1, link = it.link }
  send("LR;" .. it.itemId)
  ns.print(L("butin de groupe : %s pris (%s) ; les autres addons passent.", it.link, L[ROLL_LABEL[choice]]))
  refresh()
  return true
end

function Lo.OnStartRoll(rollID, rollTime)
  if Lo.test or type(rollID) ~= "number" or secret(rollID) then return end
  if not (Cm.InGroup() and Lo.Enabled()) then return end
  local it = rollItem(rollID)
  if not it.itemId then return end
  if Lo.IsMaster() then Lo.TakeRoll(rollID, it) return end
  local p = { rollID = rollID, itemId = it.itemId, link = it.link, quality = it.quality, at = time() }
  Lo.pending[rollID] = p
  if signalFor(it.itemId) then Lo.PassRoll(p) return end
  -- Attente du LR : 20 s au plus, et jamais au-delà de la fin du jet
  local wait = Lo.WAIT_LR
  local okT, left = call(GetLootRollTimeLeft, rollID)
  left = (okT and seconds(left)) or seconds(rollTime)
  if left then wait = math.max(1, math.min(wait, left - 2)) end
  if C_Timer and C_Timer.After then C_Timer.After(wait, function() ns.safe(L["butin"], Lo.RollTimeout, rollID, p) end) end
end

Cm.On("LR", function(sender, f, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) then return end
  if not same(sender, Lo.Master()) then return end -- seul le chef de butin
  local id = tonumber(f[2])
  if not id then return end
  Lo.signals[id] = time()
  for _, p in pairs(Lo.pending) do if p.itemId == id then Lo.PassRoll(p) end end
end)

ns.on("START_LOOT_ROLL", function(rollID, rollTime) ns.safe(L["butin de groupe"], Lo.OnStartRoll, rollID, rollTime) end)
ns.on("CANCEL_LOOT_ROLL", function(rollID)
  if type(rollID) ~= "number" or secret(rollID) then return end
  Lo.pending[rollID], Lo.taken[rollID] = nil, nil
end)
-- Objet lié quand on le ramasse : le jeu demande confirmation du jet pris par l'addon
ns.on("CONFIRM_LOOT_ROLL", function(rollID, rollType)
  if type(rollID) ~= "number" or secret(rollID) or not Lo.taken[rollID] then return end
  local choice = (type(rollType) == "number" and not secret(rollType)) and rollType or Lo.taken[rollID].choice
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
function Lo.OnLoot(msg)
  if Lo.test or not usable(msg) then return end
  if not (Cm.InGroup() and Lo.Enabled() and Lo.IsMaster()) then return end
  lootParser = lootParser or F.LootParser({ LOOT_ITEM = LOOT_ITEM, LOOT_ITEM_MULTIPLE = LOOT_ITEM_MULTIPLE, LOOT_ITEM_SELF = LOOT_ITEM_SELF, LOOT_ITEM_SELF_MULTIPLE = LOOT_ITEM_SELF_MULTIPLE })
  local who, id, quality, matched = lootParser(msg)
  if not matched or not id then return end
  local link = linkIn(msg) or Lo.LinkFor(id)
  local r = Lo.rolled[id]
  if r and time() - r.at > 600 then Lo.rolled[id], r = nil, nil end
  if who == nil then
    -- Reçu par le chef de butin : à distribuer (objets pris au butin de groupe, et tout objet à partir du seuil du relevé)
    quality = quality or qualityOf(link, id)
    if not r and (not quality or quality < minQuality()) then return end
    if r then r.n = r.n - 1 if r.n <= 0 then Lo.rolled[id] = nil end end
    local e = newEntry(link, nil)
    if not e then return end
    Lo.Locate(e)
    ns.print(L("objet reçu, à distribuer entre les pulls (fenêtre du butin) : %s.", link))
    ui("ShowLoot")
    refresh()
    return
  end
  -- Gagné par un autre joueur alors que le chef de butin l'avait pris : il n'a pas passé (sans l'addon ?)
  if not r then return end
  r.n = r.n - 1
  if r.n <= 0 then Lo.rolled[id] = nil end
  local full = F.FullName(who)
  if not full or same(full, me()) then return end
  local np = notPassedList()
  np[#np + 1] = { name = full, link = link, itemId = id, at = time() }
  -- Historique : noté pour lui (compte comme un objet seulement noté sur le site)
  if ns.Hist and ns.Hist.Noted then ns.safe(L["historique du butin"], ns.Hist.Noted, full, link, id) end
  ns.print(L("%s a gagné %s au butin de groupe (il n'a pas passé : sans l'addon ?). Fenêtre du butin : « Chuchoter » pour lui demander de garder l'objet pour l'échange.", F.Display(full), link))
  ui("ShowLoot")
  refresh()
end
ns.on("CHAT_MSG_LOOT", function(msg) ns.safe(L["butin"], Lo.OnLoot, msg) end)

-- Raid d'essai : un joueur fictif sans l'addon gagne un objet au butin de groupe
function Lo.AddTestNotPassed(name, link)
  local full = Lo.test and F.FullName(name)
  local id = link and F.ItemId(link)
  if not (full and id) then return false end
  local np = notPassedList()
  np[#np + 1] = { name = full, link = link, itemId = id, at = time() }
  if ns.Hist and ns.Hist.Noted then ns.safe(L["historique du butin"], ns.Hist.Noted, full, link, id) end -- historique de l'essai
  ui("ShowLoot")
  refresh()
  return true
end

function Lo.NotPassed()
  Lo.Prune()
  return notPassedList()
end
-- Chuchoté dans la langue du chef de butin (texte français, traduit à l'envoi)
Lo.NOT_PASSED_WHISPER = N("Tu as gagné %s au butin de groupe : garde l'objet pour l'instant, c'est moi qui distribue le butin du raid. Je te dirai à qui l'échanger.")
function Lo.WhisperNotPassed(name)
  local full = F.FullName(name)
  if not full then return false end
  if not Lo.IsMaster() then ns.print(L["seul le chef de butin peut leur chuchoter."]) return false end
  if chatLocked() then ns.print(L[LOCKED]) return false end
  local sent = false
  for _, n in ipairs(notPassedList()) do
    if same(n.name, full) and not n.whispered then
      if sendChat(L(Lo.NOT_PASSED_WHISPER, n.link), "WHISPER", full) then n.whispered, sent = time(), true end
    end
  end
  if sent then ns.print(L("chuchoté à %s : garder l'objet pour l'échange.", F.Display(full))) end
  refresh()
  return sent
end

--------------------------------------------------------------------------------------------------------------------
-- Conseil du butin : LO (proposé au raid), LA (réponses au conseil), LV (votes), LC (terminé)
--------------------------------------------------------------------------------------------------------------------
Lo.councils = {} -- session → { session, num, order, key, itemId, itemString, link, name, ilvl, master, cands[clé] = {…}, votes[clé du votant] = { voter, cand }, closed, winner, at }
Lo.offers = {}   -- { session, num, itemString, itemId, link, name, from, at, answered, response, closed, usable, reason }
Lo.COUNCIL_KEEP = 2 * 3600 -- conseils listés (Lo.Councils) : ceux de moins de 2 h

-- Conseil de ce soir (lot R4b, étude §5.3), membres présents dans le raid, pris dans l'ordre : le conseil envoyé par le
-- chef de butin (MC, s'il n'est pas moi) ; le conseil défini en jeu s'il a été réglé (Council.lua) ; celui du site (ligne
-- L du raid, sinon O) ; celui de la guilde au rang par défaut. Renvoie les noms, la source (« mc », « game », « site »,
-- « guild », « test » ; nil : aucun, le chef de butin décide seul) et, pour « mc », le chef de butin qui l'a envoyé.
-- Raid d'essai : test.council, sinon la guilde fictive (test.guild), sinon moi.
Lo.mc = nil -- dernier conseil complet reçu du chef de butin : { master, id, names, at }
function Lo.CouncilSource()
  local Co = ns.Council
  local names, source, from
  if Lo.test then
    if Lo.test.council then names, source = Lo.test.council, "test"
    elseif Lo.test.guild and Co then names, source = Co.Members(), "game"
    else names, source = { me() }, "test" end
  else
    local mc = Lo.mc
    if mc and Cm.InGroup() and not Lo.IsMaster() and same(mc.master, Lo.Master()) then names, source, from = mc.names, "mc", mc.master
    elseif Co and Co.Ready() and Co.Configured() then names, source = Co.Members(), "game"
    else
      local site = ns.Groups.Council(ns.Groups.LootRaid())
      if #site > 0 then names, source = site, "site" -- nolocale (source)
      elseif Co and Co.Ready() then names, source = Co.Members(), "guild" end
    end
  end
  local out, seen = {}, {}
  for _, n in ipairs(names or {}) do
    local full = F.FullName(n)
    local k = full and F.Fold(full)
    if k and not seen[k] and member(full) then seen[k] = true out[#out + 1] = full end
  end
  return out, source, from
end
function Lo.CouncilNames() return (Lo.CouncilSource()) end
local function inCouncil(name)
  for _, n in ipairs(Lo.CouncilNames()) do if same(n, name) then return true end end
  return false
end
function Lo.IsCouncil(master)
  if Lo.test or Lo.IsMaster() then return true end
  if master and same(master, me()) then return true end
  return inCouncil(me())
end
-- Chuchoté au conseil et au chef de butin, sauf moi (traité tout de suite chez moi par l'appelant)
local function toCouncil(msg, master)
  local done = { [fold(me())] = true }
  local targets = Lo.CouncilNames()
  targets[#targets + 1] = master
  for _, n in ipairs(targets) do
    local k = fold(n)
    if k and not done[k] then done[k] = true send(msg, "WHISPER", n) end
  end
end

local function newSession() return string.format("%d%02d", time() % 1000000, nextSeq() % 100) end

-- Conseils ouverts par moi (chef de butin), par numéro. Numéro d'un nouveau conseil : le suivant des conseils ouverts ;
-- aucun conseil ouvert : la numérotation repart de 1 (nouveau lot : les rappels chuchotés repartent aussi)
Lo.batch = 0
local reminded = {} -- clé du joueur → true : rappel « précise le numéro » déjà chuchoté dans ce lot
local function openCouncils()
  local out = {}
  for _, c in pairs(Lo.councils) do if c.key and not c.closed and same(c.master, me()) then out[#out + 1] = c end end
  table.sort(out, function(a, b) return (a.num or 0) < (b.num or 0) end)
  return out
end
local function nextNum()
  local open = openCouncils()
  if #open == 0 then Lo.batch, reminded = Lo.batch + 1, {} return 1 end
  return (open[#open].num or #open) + 1
end

-- Objet proposé au conseil : LO au raid (et traité chez moi), sans annonce ; renvoie la session et le numéro
local function propose(e)
  Lo.Cancel(e.key, true)
  local sid, n = newSession(), nextNum()
  local itemString = F.ItemString(e.link) or ("item:" .. e.itemId)
  e.status, e.session = "council", sid
  Lo.councils[sid] = { session = sid, num = n, order = nextOrder(), key = e.key, itemId = e.itemId, itemString = itemString, link = e.link,
    name = e.name, ilvl = e.ilvl, master = me(), cands = {}, votes = {}, at = time() }
  -- Nom joint : affiché chez les autres tant que leur jeu ne connaît pas l'objet ; message de 255 caractères au plus
  local head = "LO;" .. sid .. ";" .. itemString .. ";"
  broadcast(head .. F.cut(F.clean(e.name or ""), math.max(0, 250 - #head)), true)
  return sid, n
end

-- Annonce au raid des objets proposés ({ num, link }) : un seul conseil ouvert, forme courte ; sinon numérotée, avec la
-- forme du chuchotement (« bis 2 »), en plusieurs messages si besoin. Dans la langue du chef de butin : les mots à
-- chuchoter aussi (anglais : bis, up, os ou transmog), tous lus par Lo.ParseWhisper.
local function announceCouncils(list)
  if #list == 1 and #openCouncils() == 1 then
    announce(L("Roster : conseil du butin pour %s. Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo.", list[1].link))
    return
  end
  local tail = { L("Réponds dans la fenêtre de Roster, ou chuchote-moi bis, up, os ou transmo suivi du numéro (« bis %d »).", (list[2] or list[1]).num), " " }
  local pieces
  if #list == 1 then
    pieces = { { L("Roster : conseil du butin, objet %d : %s.", list[1].num, list[1].link) }, tail }
  else
    pieces = { { L("Roster : conseil du butin, %d objets :", #list) } }
    for i, x in ipairs(list) do pieces[#pieces + 1] = { x.num .. " " .. x.link .. (i == #list and "." or ""), i == 1 and " " or ", " } end
    pieces[#pieces + 1] = tail
  end
  for _, line in ipairs(Lo.ChatLines(pieces)) do announce(line) end
end

local function canPropose()
  if not Lo.IsMaster() then ns.print(L["seul le chef de butin lance le conseil."]) return false end
  if not Lo.test and not Cm.Channel() then ns.print(L["il faut être en groupe ou en raid."]) return false end
  if chatLocked() then ns.print(L[LOCKED]) return false end
  -- Conseil de ce soir envoyé avant les objets (s'il a changé) : ses membres ouvrent la fenêtre du conseil au LO
  Lo.SendCouncil(false)
  return true
end

function Lo.StartCouncil(key)
  if not Lo.IsMaster() then ns.print(L["seul le chef de butin lance le conseil."]) return false end
  local e = Lo.Find(key)
  if not e then return false end
  if e.status == "council" and e.session and Lo.councils[e.session] and not Lo.councils[e.session].closed then
    ui("ShowCouncil", e.session)
    return true, e.session
  end
  if e.status ~= "new" then ns.print(L("objet déjà attribué : %s.", e.link)) return false end
  if not canPropose() then return false end
  local sid, n = propose(e)
  announceCouncils({ { num = n, link = e.link } })
  ui("ShowCouncil", sid)
  refresh()
  return true, sid
end

-- Tout au conseil d'un coup : chaque objet à distribuer (dans l'ordre de la liste) a son LO et son numéro, une seule
-- annonce au raid. Renvoie le nombre d'objets proposés et leurs sessions.
function Lo.StartAllCouncils()
  local todo = {}
  for _, e in ipairs(Lo.Items()) do if e.status == "new" then todo[#todo + 1] = e end end
  if #todo == 0 then
    if Lo.IsMaster() then ns.print(L["aucun objet à proposer au conseil."]) end
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

-- Membre du conseil : le conseil d'un objet proposé par le chef de butin (fenêtre du conseil)
local function councilFor(o)
  if Lo.councils[o.session] then return end
  Lo.councils[o.session] = { session = o.session, num = o.num, order = nextOrder(), itemId = o.itemId, itemString = o.itemString, link = o.link,
    name = o.name, ilvl = ilvlOf(o.itemString), master = o.from, cands = {}, votes = {}, at = time() }
  ui("ShowCouncil", o.session)
end

-- Numéro d'une proposition reçue : comme le chef de butin (le suivant des propositions ouvertes, 1 s'il n'y en a pas) ;
-- le format LO ne le porte pas
local function nextOfferNum()
  local max = 0
  for _, o in ipairs(Lo.offers) do if not o.closed and (o.num or 0) > max then max = o.num end end
  return max + 1
end

Cm.On("LO", function(sender, f, dist)
  if echo(sender, dist) then return end
  if dist ~= "SELF" and not Lo.test and not same(sender, Lo.Master()) then return end -- seul le chef de butin propose
  local sid = F.txt(f[2], 20)
  local itemString = usable(f[3]) and f[3]:match("^item:[%d:%-]+") or nil
  if sid == "" or not itemString then return end
  for _, o in ipairs(Lo.offers) do if o.session == sid then return end end
  local id = F.ItemId(itemString)
  local name = F.txt(f[4], 80)
  local c = Lo.councils[sid]
  local link = (c and c.link) or Lo.LinkFor(itemString, name ~= "" and name or nil)
  local o = { session = sid, num = (c and c.num) or nextOfferNum(), itemString = itemString, itemId = id, link = link, name = name, from = sender,
    at = time(), answered = false }
  -- Puis-je le porter ? (nil : objet pas encore connu du jeu, recalculé à son arrivée)
  o.usable, o.reason = Lo.CanUse(itemString)
  Lo.offers[#Lo.offers + 1] = o
  -- Raid d'essai : la proposition d'un chef de butin fictif te met côté joueur (pas de conseil chez toi)
  if not c and not Lo.test and Lo.IsCouncil(sender) then councilFor(o) end
  ui("ShowOffer", sid)
  refresh()
end)

-- Objet arrivé dans le cache du jeu : « puis-je le porter ? » recalculé pour les propositions encore sans réponse sûre
local function itemArrived(id)
  local changed = false
  for _, o in ipairs(Lo.offers) do
    if not o.closed and o.usable == nil and (secret(id) or not num(id) or o.itemId == id) then
      o.usable, o.reason = Lo.CanUse(o.itemString)
      if o.usable ~= nil then changed = true end
    end
  end
  if changed then refresh() end
end
ns.on("GET_ITEM_INFO_RECEIVED", function(id) ns.safe(L["butin"], itemArrived, id) end)
ns.on("ITEM_DATA_LOAD_RESULT", function(id) ns.safe(L["butin"], itemArrived, id) end)

-- Objets portés au même emplacement (pour comparer) : { { id, ilvl, link } }, deux au plus
local SLOTS = {
  INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CHEST = { 5 }, INVTYPE_ROBE = { 5 }, INVTYPE_WAIST = { 6 },
  INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 }, INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 },
  INVTYPE_CLOAK = { 15 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_SHIELD = { 17 }, INVTYPE_2HWEAPON = { 16 }, INVTYPE_WEAPONMAINHAND = { 16 },
  INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_HOLDABLE = { 17 }, INVTYPE_RANGED = { 16 }, INVTYPE_RANGEDRIGHT = { 16 }, INVTYPE_THROWN = { 16 },
}
function Lo.Equipped(item)
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
Lo.ARMOR_OF = { MAGE = 1, PRIEST = 1, WARLOCK = 1, DEMONHUNTER = 2, DRUID = 2, MONK = 2, ROGUE = 2, EVOKER = 3, HUNTER = 3, SHAMAN = 3,
  DEATHKNIGHT = 4, PALADIN = 4, WARRIOR = 4 }
local ARMOR_NAME = { N("tissu"), N("cuir"), N("mailles"), N("plaques") }

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
Lo.MyClass = myClass

-- Armes, boucliers et objets tenus en main gauche (retours du raid du 11/10/2026 : pas de BiS sur une arme que la classe
-- ne peut pas équiper, sauf Transmo). Règles de Retail (Midnight 12.x), relues le 12/10/2026 :
--   - warcraft.wiki.gg, encadré « Weapon skills » de chaque page de classe (Death knight, Demon hunter, Druid, Evoker,
--     Hunter, Mage, Monk, Paladin, Priest, Rogue, Shaman, Warlock, Warrior), recoupé avec le texte des pages (paladin :
--     « cannot … wield daggers, fist weapons or staves » ; voleur : « cannot equip two-handed weapons or shields » ;
--     chasseur : « all weapons except wands, maces, two-handed maces, and warglaives ») et la page « Proficiency »
--     (boucliers : guerrier, paladin et chaman seulement) ;
--   - patch 12.1 (août 2026, notes reprises par Icy Veins et Skill Capped) : « Demon Hunters can now equip daggers » ;
--   - objets tenus en main gauche : listes « Off-hand Frill » des guides de transmogrification d'Icy Veins (druide, mage,
--     moine, paladin, prêtre, chaman, démoniste ; aucune pour guerrier, voleur, chasseur, chevalier de la mort, chasseur
--     de démons) ; l'évocateur, venu après, en porte (main gauche de ses guides BiS, sans double maniement).
-- Pas sûr : pas d'avis (nil, on laisse faire ; chez moi, l'infobulle du jeu tranche) : guerrier et voleur avec arc, arme
-- à feu ou arbalète (le wiki les donne encore, sans usage depuis 5.0.4) ; chasseur de démons avec un objet tenu en main
-- gauche (Dévoreur, spécialisation d'intelligence de 12.0). Cannes à pêche, armes « diverses » et types disparus (armes
-- de jet, lances) : pas d'avis non plus.
-- Sous-classe d'arme (Enum.ItemClass.Weapon = 2, Enum.ItemWeaponSubclass) → type ; bouclier (armure, sous-classe 6) et
-- objet tenu en main gauche (INVTYPE_HOLDABLE) en plus
local WEAPON_KIND = { [0] = "axe1", [1] = "axe2", [2] = "bow", [3] = "gun", [4] = "mace1", [5] = "mace2", [6] = "polearm", [7] = "sword1",
  [8] = "sword2", [9] = "warglaive", [10] = "staff", [13] = "fist", [15] = "dagger", [18] = "crossbow", [19] = "wand" }
local KIND_NAME = { axe1 = N("hache à une main"), axe2 = N("hache à deux mains"), bow = N("arc"), gun = N("arme à feu"),
  mace1 = N("masse à une main"), mace2 = N("masse à deux mains"), polearm = N("arme d'hast"), sword1 = N("épée à une main"),
  sword2 = N("épée à deux mains"), warglaive = N("glaive de guerre"), staff = N("bâton"), fist = N("arme de pugilat"), dagger = N("dague"),
  crossbow = N("arbalète"), wand = N("baguette"), shield = N("bouclier"), frill = N("objet tenu en main gauche") }
-- Ce que chaque classe manie ; les autres types sont refusés, sauf ceux pas sûrs (DOUBT)
local WIELDS = {
  DEATHKNIGHT = "axe1 axe2 mace1 mace2 sword1 sword2 polearm",
  DEMONHUNTER = "axe1 sword1 warglaive fist dagger",
  DRUID = "mace1 mace2 polearm staff fist dagger frill",
  EVOKER = "axe1 axe2 mace1 mace2 sword1 sword2 staff fist dagger frill",
  HUNTER = "axe1 axe2 sword1 sword2 polearm staff fist dagger bow gun crossbow",
  MAGE = "sword1 staff dagger wand frill",
  MONK = "axe1 mace1 sword1 polearm staff fist frill",
  PALADIN = "axe1 axe2 mace1 mace2 sword1 sword2 polearm shield frill",
  PRIEST = "mace1 staff dagger wand frill",
  ROGUE = "axe1 mace1 sword1 fist dagger",
  SHAMAN = "axe1 axe2 mace1 mace2 staff fist dagger shield frill",
  WARLOCK = "sword1 staff dagger wand frill",
  WARRIOR = "axe1 axe2 mace1 mace2 sword1 sword2 polearm staff fist dagger shield",
}
local DOUBT = { WARRIOR = "bow gun crossbow", ROGUE = "bow gun crossbow", DEMONHUNTER = "frill" }
-- Lo.WEAPONS_OF[classe][type] : true (la classe le manie), false (non), nil (pas d'avis)
Lo.WEAPONS_OF = {}
for class, list in pairs(WIELDS) do
  local t = {}
  for kind in pairs(KIND_NAME) do t[kind] = false end
  for kind in list:gmatch("%S+") do t[kind] = true end
  for kind in (DOUBT[class] or ""):gmatch("%S+") do t[kind] = nil end
  Lo.WEAPONS_OF[class] = t
end
-- Type d'arme (clé de KIND_NAME) d'un objet, sinon nil (pas une arme, type sans règle, objet inconnu)
local function weaponKind(item)
  local id, loc, classID, subID = itemInfo(item)
  if not id then return nil end
  if classID == 2 then return WEAPON_KIND[subID or -1] end
  if loc == "INVTYPE_SHIELD" or (classID == 4 and subID == 6) then return "shield" end
  if loc == "INVTYPE_HOLDABLE" then return "frill" end
  return nil
end
-- Règle des armes pour une classe : true, false, nil (pas d'avis) ; et le type de l'arme
local function wields(item, class)
  local kind = weaponKind(item)
  local prof = kind and usable(class) and Lo.WEAPONS_OF[class:upper()]
  if not prof then return nil, kind end
  return prof[kind], kind
end

-- Règle de l'armure et des armes, pour la réponse d'un autre joueur : false (pas son type d'armure, arme qu'il ne manie
-- pas), true, nil (ni armure ni arme soumise à la règle, classe ou objet inconnus, pas d'avis)
function Lo.CanUseClass(item, class)
  local sub = armorType(item)
  if sub then
    local want = usable(class) and Lo.ARMOR_OF[class:upper()] or nil
    if not want then return nil end
    return sub == want
  end
  return (wields(item, class))
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
-- classe du jeu (UnitClass, raid d'essai compris). Armure : règle du type ; arme, bouclier ou objet tenu en main gauche
-- que ma classe ne manie pas : non ; sinon l'infobulle du jeu (lignes rouges : jeton ou arme réservés à des classes…).
function Lo.CanUse(item)
  local ok, usableNow, reason = pcall(function()
    local id = itemInfo(item)
    if not id then
      local want = F.ItemId(item)
      if want and C_Item and C_Item.RequestLoadItemDataByID then call(C_Item.RequestLoadItemDataByID, want) end
      return nil
    end
    local sub = armorType(item)
    if sub then
      local want = Lo.ARMOR_OF[myClass() or ""]
      if not want then return nil end
      if sub == want then return true end
      return false, L("armure en %s : pas ton type d'armure", L[ARMOR_NAME[sub]])
    end
    local can, kind = wields(item, myClass())
    if can == false then return false, L("%s : pas pour ta classe", L[KIND_NAME[kind]]) end
    return tooltipCheck(item, id)
  end)
  if not ok then return nil end
  return usableNow, reason
end

local function findOffer(sid) for _, o in ipairs(Lo.offers) do if o.session == sid then return o end end return nil end
function Lo.Offers()
  local out = {}
  for _, o in ipairs(Lo.offers) do if not o.closed then out[#out + 1] = o end end
  return out
end

-- Ma réponse (changeable tant que le conseil est ouvert) : BiS, Upgrade et Off-spec refusés sur un objet que je ne peux
-- pas porter (renvoie false et le message)
local GEAR = { bis = true, upgrade = true, off = true }

-- Nombres du chef de butin joints à chaque réponse qu'il relaie (étude §5.4, champs 8 à 12 de LA) : « ;<total>;<BiS>;
-- <Upgrade>;<jets MS>;<main si alt> », ou « ;-;;;; » s'il n'a ni données du site ni historique (chacun voit alors ses
-- propres nombres). Le main (R4c) reste vide pour l'instant.
local function countTail(who)
  if not Lo.HasCounts() then return ";-;;;;" end
  local site, mine, _, d = Lo.Received(who)
  local main = ns.Hist and ns.Hist.MainOf and ns.Hist.MainOf(who)
  return ";" .. (site + mine) .. ";" .. d.bis .. ";" .. d.up .. ";" .. d.ms .. ";" .. F.clean(main or "")
end
Lo.CountTail = countTail
-- Nombres du chef de butin lus dans un LA : { n, bis, up, ms, main }, { none = true } (pas d'historique chez lui), nil
local function relayedCounts(f)
  if f[8] == "-" then return { none = true } end
  local n = tonumber(f[8])
  if not n then return nil end
  return { n = n, bis = tonumber(f[9]) or 0, up = tonumber(f[10]) or 0, ms = tonumber(f[11]) or 0, main = F.FullName(F.txt(f[12], 60)) }
end

function Lo.Answer(session, response, note)
  local o = findOffer(session)
  if not o or o.closed or not Lo.RESPONSES[response] then return false end
  if GEAR[response] then
    local can, why = Lo.CanUse(o.itemString)
    if can == false then
      local msg = why and L("tu ne peux pas porter %s (%s) : réponds Transmo ou Passer.", o.link, why)
        or L("tu ne peux pas porter %s : réponds Transmo ou Passer.", o.link)
      ns.print(msg)
      return false, msg
    end
  end
  local gear = F.GearText(Lo.Equipped(o.itemString))
  local msg = "LA;" .. session .. ";" .. response .. ";" .. gear .. ";" .. F.cut(F.trim(F.clean(note or "")), 60) -- nolocale (message entre addons)
  -- Chef de butin qui répond à son propre objet : ses nombres en fin de ligne (champs 6 et 7 vides : pas un relais)
  if same(o.from, me()) then msg = msg .. ";;" .. countTail(me()) end
  toCouncil(msg, o.from)
  Cm.Deliver(me(), msg, "SELF")
  o.answered, o.response = time(), response
  ui("ShowOffer")
  refresh()
  return true
end

-- Règle de l'armure et des armes sur la réponse d'un autre joueur (chef de butin et conseil) : BiS, Upgrade ou Off-spec
-- sur une armure qui n'est pas du type de sa classe, ou sur une arme qu'elle ne manie pas, devient Transmo. Raid
-- d'essai : seulement si test.armorRule.
local function armorRuleOn() return not Lo.test or Lo.test.armorRule == true end
local function classOf(name)
  local m = member(name)
  if m and usable(m.class) then return m.class end
  if same(name, me()) then return myClass() end
  return nil
end
local function checked(c, who, response)
  if not (GEAR[response] and armorRuleOn()) or same(who, me()) then return response, nil end
  if Lo.CanUseClass(c.itemString, classOf(who)) == false then return "transmo", false end
  return response, nil
end

Cm.On("LA", function(sender, f, dist) -- nolocale (message entre addons)
  if echo(sender, dist) then return end
  local c = Lo.councils[F.txt(f[2], 20)]
  if not c or c.closed or not Lo.RESPONSES[f[3] or ""] then return end
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
    note = whispered and "" or F.txt(f[5], 60), whispered = whispered, at = time(),
    ml = same(sender, c.master) and relayedCounts(f) or nil } -- nombres du chef de butin (0.4), de lui seulement
  -- Chef de butin : chaque réponse reçue d'un joueur est relayée au raid, avec ses nombres (0.4) ; seuls les membres du
  -- conseil (qui ont ce conseil) la gardent. Un joueur sans les données du site ne l'envoie qu'au chef de butin.
  if not relayed and not Lo.test and same(c.master, me()) and not same(sender, me()) then
    send("LA;" .. c.session .. ";" .. response .. ";" .. F.clean(f[4] or "") .. ";" .. F.cut(F.clean(F.txt(f[5], 60)), 60) .. ";" .. who .. ";r" .. countTail(who)) -- nolocale
  end
  refresh()
end)

-- Réponse chuchotée au chef de butin (« bis », « up », « os », « transmo », « passe »), suivie ou précédée du numéro de
-- l'objet (« bis 2 », « 2 bis ») ; sans numéro, valable s'il n'y a qu'un conseil ouvert, sinon rappel chuchoté (une fois
-- par lot de conseils). Mots français et anglais, quelle que soit la langue du chef de butin : bis ; up, upgrade ; os, off,
-- offspec, off-spec ; transmo, transmog, tmog ; passe, passer, pass.
local WHISPERED = { bis = "bis", up = "upgrade", upgrade = "upgrade", os = "off", off = "off", offspec = "off", ["off-spec"] = "off",
  ["off spec"] = "off", transmo = "transmo", transmog = "transmo", tmog = "transmo", pass = "pass", passe = "pass", passer = "pass",
  ["je passe"] = "pass" }
function Lo.ParseWhisper(text)
  if not usable(text) then return nil end
  local s = F.trim(text):lower()
  local word, n = s:match("^(.-)%s*#?(%d+)$")
  if not (word and word ~= "") then n, word = s:match("^#?(%d+)%s*(.-)$") end
  if not (word and word ~= "") then word, n = s, nil end
  local r = WHISPERED[F.trim(word)]
  return r, r and tonumber(n) or nil
end
-- Rappels chuchotés dans la langue du chef de butin (textes français, traduits à l'envoi)
Lo.REMIND = N("Précise le numéro de l'objet, par exemple « bis 2 ».")
Lo.REMIND_UNKNOWN = N("Pas d'objet n° %d au conseil : réponds avec un numéro de l'annonce, par exemple « bis 2 ».")
local function remind(who, text)
  local k = fold(who)
  if not k or reminded[k] or chatLocked() then return false end
  if sendChat(text, "WHISPER", who) then reminded[k] = true end
  return true
end
function Lo.OnWhisper(text, sender)
  if not (usable(text) and usable(sender)) or not Lo.IsMaster() then return end
  local r, n = Lo.ParseWhisper(text)
  if not r then return end
  local who = F.FullName(sender)
  local open = openCouncils()
  if not who or #open == 0 then return end
  local c
  if n then for _, x in ipairs(open) do if x.num == n then c = x end end
  elseif #open == 1 then c = open[1] end
  if not c then remind(who, n and L(Lo.REMIND_UNKNOWN, n) or L[Lo.REMIND]) return end
  -- Règle de l'armure et des armes appliquée avant le relais : le conseil (même avec un addon 0.2) reçoit déjà Transmo
  local asked = r
  r = checked(c, who, r)
  local msg = "LA;" .. c.session .. ";" .. r .. ";;chuchoté;" .. who .. ";" .. countTail(who) -- nolocale (message entre addons ; 7e champ vide)
  toCouncil(msg, me())
  Cm.Deliver(me(), msg, "SELF")
  local x = r ~= asked and c.cands[F.Fold(who)]
  if x then x.asked, x.canUse = asked, false end
end
ns.on("CHAT_MSG_WHISPER", function(text, sender) ns.safe(L["conseil du butin"], Lo.OnWhisper, text, sender) end)

function Lo.Vote(session, name)
  local c = Lo.councils[session]
  if not c or c.closed then return false end
  if not Lo.IsCouncil(c.master) then ns.print(L["tu n'es pas du conseil du butin."]) return false end
  local full = F.FullName(name)
  if not full then return false end
  local mine = c.votes[fold(me())]
  local msg = "LV;" .. session .. ";" .. ((mine and same(mine.cand, full)) and "" or full)
  toCouncil(msg, c.master)
  Cm.Deliver(me(), msg, "SELF")
  return true
end

Cm.On("LV", function(sender, f)
  local c = Lo.councils[F.txt(f[2], 20)]
  if not c or c.closed then return end
  if not (Lo.test or same(sender, c.master) or inCouncil(sender)) then return end
  local cand = F.FullName(F.txt(f[3], 60))
  c.votes[fold(sender)] = cand and { voter = sender, cand = cand } or nil
  refresh()
end)

Cm.On("LC", function(sender, f, dist)
  if echo(sender, dist) then return end
  local sid = F.txt(f[2], 20)
  local c = Lo.councils[sid]
  if c and (dist == "SELF" or Lo.test or same(sender, c.master)) then
    c.closed, c.winner = true, F.FullName(F.txt(f[3], 60))
  end
  local o = findOffer(sid)
  if o and (dist == "SELF" or Lo.test or same(sender, o.from)) then o.closed = true end
  ui("ShowOffer")
  refresh()
end)

--------------------------------------------------------------------------------------------------------------------
-- Conseil de ce soir envoyé par le chef de butin (lot R4b) : MC;<id>;<partie>/<parties>;<Prénom-Royaume>,… au raid,
-- membres du conseil présents (lui compris s'il en est), en parties de 255 octets au plus (noms jamais coupés). Accepté
-- seulement du chef de butin ; appliqué quand toutes les parties sont là. Un addon 0.4.0 ou 0.3 l'ignore (message inconnu).
--------------------------------------------------------------------------------------------------------------------
Lo.MC_EVERY = 600 -- secondes : le même conseil n'est renvoyé qu'au bout de 10 min (sauf demande, nouveau chef de butin)
Lo.MC_PARTS = 20
local lastMC, lastMCText, mcSeq = 0, nil, 0
--- Chef de butin : envoie le conseil de ce soir s'il a changé (force : même s'il n'a pas changé). Rien sans conseil connu
--- (ni réglé en jeu, ni site, ni guilde) : chacun garde le sien. Renvoie true si envoyé.
function Lo.SendCouncil(force)
  if Lo.test or not Cm.InGroup() or not Lo.IsMaster() or not Lo.Enabled() then return false end
  local names, source = Lo.CouncilSource()
  if not source then return false end
  local list = {}
  for i, n in ipairs(names) do list[i] = F.clean(n) end
  local text = table.concat(list, ",")
  if not force and text == lastMCText and time() - lastMC < Lo.MC_EVERY then return false end
  lastMC, lastMCText, mcSeq = time(), text, mcSeq + 1
  local id = string.format("%d%02d", time() % 100000, mcSeq % 100)
  local room = 250 - #("MC;" .. id .. ";" .. Lo.MC_PARTS .. "/" .. Lo.MC_PARTS .. ";")
  local parts, cur = {}, ""
  for _, n in ipairs(list) do
    if cur ~= "" and #cur + 1 + #n > room then parts[#parts + 1] = cur cur = n
    else cur = cur == "" and n or (cur .. "," .. n) end
  end
  parts[#parts + 1] = cur
  if #parts > Lo.MC_PARTS then return false end
  for i, p in ipairs(parts) do send("MC;" .. id .. ";" .. i .. "/" .. #parts .. ";" .. p) end
  return true
end
--- Le conseil défini en jeu a changé (réglage, liste de guilde) : le chef de butin renvoie le conseil de ce soir 2 s
--- après (plusieurs changements d'affilée : un seul MC)
Lo.MC_DELAY = 2
local councilDue = false
function Lo.CouncilChanged()
  if not Lo.test and not councilDue and Cm.InGroup() and Lo.IsMaster() and Lo.Enabled() then
    if C_Timer and C_Timer.After then
      councilDue = true
      C_Timer.After(Lo.MC_DELAY, function() councilDue = false ns.safe(L["conseil du butin"], Lo.SendCouncil, false) end)
    else
      Lo.SendCouncil(false)
    end
  end
  refresh()
end

local mcParts = nil -- parties reçues du MC en cours : { id, master, n, parts, got }
Cm.On("MC", function(sender, f, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) or not same(sender, Lo.Master()) then return end
  local id = F.txt(f[2], 12)
  local i, n = tostring(f[3] or ""):match("^(%d+)/(%d+)$")
  i, n = tonumber(i), tonumber(n)
  if id == "" or not (i and n) or i < 1 or i > n or n > Lo.MC_PARTS then return end
  local p = mcParts
  if not (p and p.id == id and p.n == n and same(p.master, sender)) then
    p = { id = id, master = sender, n = n, parts = {}, got = 0 }
    mcParts = p
  end
  if p.parts[i] == nil then p.parts[i], p.got = F.txt(f[4], 255), p.got + 1 end
  if p.got < p.n then return end
  mcParts = nil
  local names, seen = {}, {}
  for k = 1, p.n do
    for x in (p.parts[k] .. ","):gmatch("([^,]*),") do
      local full = F.FullName(F.txt(x, 60))
      local key = full and F.Fold(full)
      if key and not seen[key] then seen[key] = true names[#names + 1] = full end
    end
  end
  local was = Lo.IsCouncil(sender)
  Lo.mc = { master = sender, id = id, names = names, at = time() }
  -- Devenu membre du conseil : les objets de ce chef de butin déjà proposés (LO reçu avant le MC) ont leur conseil
  if not was and Lo.IsCouncil(sender) then
    for _, o in ipairs(Lo.offers) do if not o.closed and same(o.from, sender) then councilFor(o) end end
  end
  refresh()
end)

-- Objets reçus d'un joueur : compte du site (ligne N, ses persos ensemble) et ce soir (bilan en cours), même règle que
-- le site (lootSkipReason) : ne comptent pas une réponse Off-spec ou Transmo, un jet OS ou libre, un objet gardé
function Lo.Counts(l)
  local d = tostring(l.detail or "")
  if l.method == "council" then return l.response ~= "off" and l.response ~= "transmo" end
  if l.method == "roll" then return d:find("^OS") == nil and d:find("^jet") == nil end
  if l.method == "ml" then return d:find("^gardé") == nil end -- nolocale (détail du bilan)
  return true
end
Lo.KEPT = "gardé" -- nolocale (détail du bilan, pour le site ; affiché : L["gardé"])
-- Catégorie d'un objet reçu, détail de la colonne « Reçus » (BiS · Upgrade · Jets MS) : "bis" (conseil BiS), "up"
-- (conseil Upgrade), "ms" (jet dont le détail commence par « MS »), nil (les autres, qui comptent ou non)
function Lo.Category(l)
  if type(l) ~= "table" then return nil end
  if l.method == "council" then
    if l.response == "bis" then return "bis" end
    if l.response == "upgrade" then return "up" end
    return nil
  end
  if l.method == "roll" and F.trim(l.detail):find("^MS") then return "ms" end
  return nil
end

-- Objets reçus d'un joueur (étude §5.7) : compte du site (ligne N, ses persos ensemble ; détail D) plus les entrées de
-- l'historique de l'addon (History.lua) postérieures à la date de génération des données du site, sans double compte ;
-- sans données du site, l'historique seul. Renvoie : compte du site, compte de l'historique, bloc N du site (ou nil),
-- détail { bis, up, ms } (site + historique), date de génération des données du site (nil : tout l'historique).
-- Butin des alts : compté pour la personne (ns.Hist.Person ; liens main / alts en R4c).
local function histCount(names, since)
  local H = ns.Hist
  if H and H.Count then return H.Count(names, since) end
  return { n = 0, bis = 0, up = 0, ms = 0 }
end
function Lo.Received(name)
  local c, since
  if Lo.test then c = Lo.test.counts else c, since = ns.Groups.LootCounts() end
  since = c and since or nil
  local entry = F.CountFor(c, name)
  local mine = histCount(entry and entry.names or { name }, since)
  local detail = { bis = (tonumber(entry and entry.bis) or 0) + mine.bis, up = (tonumber(entry and entry.up) or 0) + mine.up,
    ms = (tonumber(entry and entry.ms) or 0) + mine.ms }
  return entry and entry.n or 0, mine.n, c, detail, since
end
-- Le chef de butin a-t-il des nombres à donner au conseil ? (données du site, ou historique de l'addon)
function Lo.HasCounts()
  if Lo.test then return true end
  return ns.Groups.LootCounts() ~= nil or (ns.Hist ~= nil and ns.Hist.HasData())
end

-- Conseils de moins de 2 h, dans l'ordre de proposition (bande d'objets des fenêtres) : { session, num, link, name,
-- ilvl, itemId, master, closed, winner, answers, waiting, myVote, isMaster }
function Lo.Councils()
  local list, now, members, mine = {}, time(), Lo.Members(), fold(me())
  for _, c in pairs(Lo.councils) do if now - (c.at or 0) < Lo.COUNCIL_KEEP then list[#list + 1] = c end end
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

function Lo.Council(session)
  local c = Lo.councils[session]
  if not c then return nil end
  local voters, myVote = {}, nil
  for k, v in pairs(c.votes) do
    local ck = fold(v.cand)
    if ck then voters[ck] = voters[ck] or {} table.insert(voters[ck], v.voter) end
    if k == fold(me()) then myVote = v.cand end
  end
  local out = { session = c.session, num = c.num, key = c.key, itemId = c.itemId, link = c.link, name = c.name, ilvl = c.ilvl, master = c.master,
    closed = c.closed == true, winner = c.winner, myVote = myVote, cands = {}, waiting = {}, council = Lo.CouncilNames(), isMaster = same(c.master, me()) }
  local _, _, counts, _, since = Lo.Received(me())
  out.counts, out.since = counts, since
  -- Classes des membres (règle de l'armure et des armes), lues une fois
  local members, classes, rule = Lo.Members(), {}, armorRuleOn()
  for _, m in ipairs(members) do if usable(m.class) then classes[m.key] = m.class end end
  for k, x in pairs(c.cands) do
    local vs = voters[k] or {}
    table.sort(vs)
    local gear = {}
    for _, g in ipairs(x.gear or {}) do gear[#gear + 1] = { id = g.id, ilvl = g.ilvl, link = Lo.LinkFor(g.id) } end
    local site, tonight, _, d = Lo.Received(x.name)
    local received, from = site + tonight, nil
    -- Nombres du chef de butin (relayés avec la réponse, 0.4) : ceux que tout le conseil voit ; « aucun historique chez
    -- lui » : chacun voit les siens
    local ml = not out.isMaster and x.ml or nil
    if ml and ml.none then out.mlNone, ml = true, nil end
    if ml then received, site, tonight, d, from = ml.n, nil, nil, ml, c.master end
    -- Peut-il le porter ? false : la règle de l'armure ou des armes dit non pour sa classe (réponse devenue Transmo s'il voulait BiS…)
    local canUse = x.canUse
    if canUse == nil and rule then canUse = Lo.CanUseClass(c.itemString, classes[k] or (same(x.name, me()) and myClass() or nil)) end
    out.cands[#out.cands + 1] = { name = x.name, response = x.response, asked = x.asked, canUse = canUse, gear = gear, note = x.note or "",
      whispered = x.whispered, received = received, receivedSite = site, receivedTonight = tonight, receivedFrom = from,
      receivedBis = d.bis, receivedUp = d.up, receivedMs = d.ms, main = ml and ml.main or nil, votes = #vs, voters = vs }
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
function Lo.AwardCouncil(session, name)
  local c = Lo.councils[session]
  local full = F.FullName(name)
  if not (c and c.key and full) then return false end
  local votes = 0
  for _, v in pairs(c.votes) do if same(v.cand, full) then votes = votes + 1 end end
  local cand = c.cands[F.Fold(full)]
  local response = cand and cand.response ~= "pass" and cand.response or nil
  return Lo.Award(c.key, full, "council", response, F.plural(votes, "vote"))
end

--------------------------------------------------------------------------------------------------------------------
-- Jets : MS (/roll 100) et OS (/roll 99), ou jet libre (/roll 100) ; le premier jet de chacun compte ; égalité :
-- seuls les ex æquo relancent. Un seul objet en jets à la fois (les jets du chat ne disent pas pour quel objet).
--------------------------------------------------------------------------------------------------------------------
Lo.rollSessions = {} -- clé de l'objet → { kind, rows, byKey, eligible, tieKind, round, previous, open, hidden, at }
Lo.activeRoll = nil
local KIND_RANK = { ms = 1, os = 2, free = 1 }

local function names(list)
  local out = {}
  for _, n in ipairs(list) do out[#out + 1] = F.Display(n) end
  return table.concat(out, ", ")
end

function Lo.StartRoll(key, kind)
  if not Lo.IsMaster() then ns.print(L["seul le chef de butin lance les jets."]) return false end
  local e = Lo.Find(key)
  if not e then return false end
  if e.status ~= "new" and e.status ~= "council" and e.status ~= "roll" then ns.print(L("objet déjà attribué : %s.", e.link)) return false end
  if chatLocked() then ns.print(L["pas pendant un combat de boss : les jets se font entre les pulls."]) return false end
  kind = kind == "free" and "free" or "msos"
  Lo.Cancel(key, true)
  if Lo.activeRoll and Lo.activeRoll ~= key then
    local other = Lo.Find(Lo.activeRoll)
    local s = Lo.rollSessions[Lo.activeRoll]
    if s then s.open = false end
    if other and other.status == "roll" then other.status = "new" end
  end
  Lo.rollSessions[key] = { kind = kind, rows = {}, byKey = {}, round = 1, previous = {}, open = true, at = time() }
  Lo.activeRoll = key
  e.status = "roll"
  broadcast("RS;" .. e.itemId .. ";" .. kind)
  if kind == "free" then announce(L("Roster : jet libre pour %s : /roll 100.", e.link))
  else announce(L("Roster : jets pour %s : /roll 100 en spé principale (MS), /roll 99 en spé secondaire (OS).", e.link)) end
  ui("ShowLoot")
  refresh()
  return true
end

function Lo.OnRoll(name, roll, lo, hi)
  local key = Lo.activeRoll
  local s = key and Lo.rollSessions[key]
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
  local s = Lo.activeRoll and Lo.rollSessions[Lo.activeRoll]
  if not (s and s.open) then return end
  if not usable(msg) then s.hidden = true refresh() return end
  rollParser = rollParser or F.RollParser(RANDOM_ROLL_RESULT)
  local name, roll, lo, hi = rollParser(msg)
  if name then ns.safe(L["jets"], Lo.OnRoll, name, roll, lo, hi) end
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

function Lo.Rolls(key)
  local s = Lo.rollSessions[key]
  if not s then return nil end
  local rows, winners, best = {}, {}, nil
  if #s.rows > 0 then rows, winners, best = ranking(s) end
  return { kind = s.kind, rows = rows, winners = winners, tie = #winners > 1, best = best, open = s.open, round = s.round,
    previous = s.previous, hidden = s.hidden, active = Lo.activeRoll == key, tieKind = s.tieKind }
end

-- Égalité : seuls les ex æquo relancent (même dé)
function Lo.Reroll(key)
  local s, e = Lo.rollSessions[key], Lo.Find(key)
  local r = Lo.Rolls(key)
  if not (s and e and r and r.tie) then return false end
  if not Lo.IsMaster() then return false end
  if chatLocked() then ns.print(L["pas pendant un combat de boss : les jets se font entre les pulls."]) return false end
  s.previous[#s.previous + 1] = r.rows
  s.eligible = {}
  for _, n in ipairs(r.winners) do s.eligible[F.Fold(n)] = true end
  s.tieKind = s.kind == "free" and "free" or r.best.kind
  s.rows, s.byKey, s.round, s.open, s.hidden = {}, {}, s.round + 1, true, nil
  Lo.activeRoll = key
  e.status = "roll"
  announce(L("Roster : égalité pour %s entre %s : relancez, /roll %d.", e.link, names(r.winners), s.tieKind == "os" and 99 or 100))
  if Lo.test and Lo.test.reroll then ns.safe(L["raid d'essai"], Lo.test.reroll, key, r.winners, s.tieKind) end
  refresh()
  return true
end

-- « Donner au gagnant » : détail noté dans le bilan comme Forever (« MS 87 », « OS 54 », « jet 54 »)
function Lo.AwardRoll(key)
  local r, s = Lo.Rolls(key), Lo.rollSessions[key]
  if not (r and s and r.best) or r.tie then return false end
  local detail = s.kind == "free" and ("jet " .. r.best.roll) or (r.best.kind:upper() .. " " .. r.best.roll)
  return Lo.Award(key, r.winners[1], "roll", nil, detail)
end

Cm.On("RS", function(sender, f, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) or not same(sender, Lo.Master()) then return end
  local id = tonumber(f[2])
  if not id then return end
  local link = Lo.LinkFor(id)
  if f[3] == "free" then ns.print(L("jet libre pour %s : /roll 100.", link))
  else ns.print(L("jets pour %s : /roll 100 en spé principale, /roll 99 en spé secondaire.", link)) end
end)

-- Conseil ou jets en cours sur un objet : arrêtés (l'objet redevient à distribuer) ; quiet : sans message
function Lo.Cancel(key, quiet)
  local e = Lo.Find(key)
  if not e then return false end
  if e.session and Lo.councils[e.session] and not Lo.councils[e.session].closed then
    broadcast("LC;" .. e.session .. ";", true)
  end
  local s = Lo.rollSessions[key]
  if s then s.open = false end
  if Lo.activeRoll == key then Lo.activeRoll = nil end
  if e.status == "council" or e.status == "roll" then e.status = "new" end
  if not quiet then refresh() end
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Attribution (un clic du chef de butin) : annoncée dans le raid et chuchotée au gagnant, notée dans le bilan
--------------------------------------------------------------------------------------------------------------------
-- Dans la langue de l'interface (annonce du chef de butin) ; le détail du bilan (« MS 87 », « jet 54 ») reste en français
local function awardLabel(method, response, detail, kept)
  if method == "council" then
    return (Lo.RESPONSES[response or ""] and response ~= "pass") and L("conseil : %s", Lo.Label(response)) or L["conseil"]
  end
  if method == "roll" then
    local d = tostring(detail or "")
    local n = d:match("^jet (%d+)")
    if n then return L("jet libre %s", n) end
    return d ~= "" and d or L["jets"]
  end
  return kept and L["gardé"] or L["choix du chef de butin"]
end
Lo.awardLabel = awardLabel

function Lo.Award(key, winner, method, response, detail)
  if not Lo.IsMaster() then ns.print(L["seul le chef de butin attribue le butin."]) return false end
  local e = Lo.Find(key)
  local full = F.FullName(winner)
  if not (e and full) then return false end
  if chatLocked() then ns.print(L("pas pendant un combat de boss : attribue %s juste après le combat.", e.link)) return false end
  method = method or "ml"
  response = Lo.RESPONSES[response or ""] and response ~= "pass" and response or nil
  detail = detail or ""
  local kept = same(full, me())
  -- Conseil terminé (les fenêtres de réponse se ferment), jets arrêtés
  if e.session and Lo.councils[e.session] and not Lo.councils[e.session].closed then broadcast("LC;" .. e.session .. ";" .. full, true) end
  local s = Lo.rollSessions[key]
  if s then s.open = false end
  if Lo.activeRoll == key then Lo.activeRoll = nil end
  e.status, e.winner, e.method, e.response, e.detail, e.awardedAt = kept and "kept" or "awarded", full, method, response, detail, time()
  announce(L("Roster : %s reçoit %s (%s)", F.Display(full), e.link, awardLabel(method, response, detail, kept)))
  if not kept then
    local left = e.expires and e.expires - time()
    sendChat((left and left > 0) and L("Tu reçois %s : passe me voir pour l'échange (encore %s).", e.link, F.Duration(left))
      or L("Tu reçois %s : passe me voir pour l'échange.", e.link), "WHISPER", full)
  end
  -- Historique durable (History.lua ; raid d'essai : en mémoire) : l'entrée de cette attribution, remplacée par une version
  -- plus récente si l'objet est attribué de nouveau. Une erreur ici n'empêche jamais l'attribution.
  local cand = e.session and Lo.councils[e.session] and Lo.councils[e.session].cands[F.Fold(full)]
  local entry
  if ns.Hist and ns.Hist.Award then
    local okH, res = pcall(ns.Hist.Award, e, full, method, response, detail, { note = cand and not cand.whispered and cand.note or nil })
    if okH then entry = res else ns.print("|cffff6060" .. L["erreur (historique du butin)"] .. "|r " .. tostring(res)) end
  end
  if not Lo.test then
    local was = logging
    logging = true
    local ok, idx = pcall(ns.Recorder.Award, e.itemId, full, method, response, detail, e.name, e.logIndex, e.key, nil, e.at)
    logging = was
    if ok then e.logIndex, e.logged = idx, idx ~= nil else ns.print("|cffff6060" .. L["erreur (bilan)"] .. "|r " .. tostring(idx)) end
    -- Les autres addons notent aussi le gagnant (bilan du site, historique) : champs 8 à 10 (0.4) = identifiant et version
    -- de l'entrée, niveau de l'objet ; un addon 0.3 ne lit que les 7 premiers
    local tail = entry and (";" .. entry.id .. ";" .. entry.v .. ";" .. (tonumber(e.ilvl) or "")) or ""
    send("LW;" .. e.key .. ";" .. e.itemId .. ";" .. full .. ";" .. method .. ";" .. (response or "") .. ";" .. F.cut(F.clean(detail), 40) .. tail)
  end
  refresh()
  return true
end

-- Garder (désenchantement, banque de guilde) : noté « gardé », ne compte pas dans les objets reçus
-- Attribution vue chez les autres joueurs (LW du chef de butin) : notée dans leur relevé, pas d'annonce
local METHODS = { council = true, roll = true, ml = true }
Cm.On("LW", function(sender, f, dist)
  if Lo.test or echo(sender, dist) or same(sender, me()) or not same(sender, Lo.Master()) then return end
  local id, winner, method = tonumber(f[3]), F.FullName(F.txt(f[4], 60)), f[5]
  if not (id and winner and METHODS[method or ""]) then return end
  local response = Lo.RESPONSES[f[6] or ""] and f[6] ~= "pass" and f[6] or nil
  local detail, key = F.txt(f[7], 40), F.txt(f[2], 40)
  ns.Recorder.Award(id, winner, method, response, detail, nil, nil, key, sender)
  -- Historique (0.4) : la même entrée que chez le chef de butin (identifiant et version : champs 8 et 9 ; niveau : 10) ;
  -- LW d'un addon 0.3 : identifiant tiré du chef de butin et de la clé de l'objet
  local hid = usable(f[8]) and #f[8] <= 40 and f[8]:match("^[%w%-]+$") or nil
  if ns.Hist and ns.Hist.FromLW then
    ns.safe(L["historique du butin"], ns.Hist.FromLW, sender, key, id, winner, method, response, detail, hid, tonumber(f[9]), tonumber(f[10]))
  end
end)

function Lo.Keep(key) return Lo.Award(key, me(), "ml", nil, Lo.KEPT) end

--------------------------------------------------------------------------------------------------------------------
-- Échange au gagnant. Dès qu'une fenêtre d'échange s'ouvre (TRADE_SHOW) avec un joueur à qui des objets sont attribués,
-- qu'il l'ait ouverte lui-même ou que le chef de butin ait cliqué « Échanger » (InitiateTrade), ses objets sont posés
-- dans les cases libres (6 au plus) ; à la fermeture, chaque objet dont le nombre d'exemplaires dans les sacs a baissé
-- est remis. « Échanger » sans fenêtre au bout de 4 s : le message d'erreur du jeu (UI_ERROR_MESSAGE) s'il y en a un,
-- sinon la marche à suivre (le gagnant ouvre l'échange). Jamais en combat.
--------------------------------------------------------------------------------------------------------------------
Lo.TRADE_WAIT = 4      -- secondes : fenêtre d'échange attendue après « Échanger »
Lo.TRADE_DELAY = 0.3   -- secondes : la fenêtre d'échange doit être prête avant d'y poser les objets
Lo.TRADE_STEP = 0.2    -- secondes entre deux objets posés
Lo.trading = nil       -- échange ouvert : { partner, at, placed = { { key, itemId, bag, slot, tradeSlot, count } }, closing }
Lo.tradeAsk = nil      -- « Échanger » en attente de la fenêtre : { winner, at, errors }
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
function Lo.Handover(name)
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

function Lo.Trade(key)
  local e = Lo.Find(key)
  if not (e and e.winner and e.status == "awarded") then return false end
  if Lo.test then
    if Lo.test.trade then ns.safe(L["raid d'essai"], Lo.test.trade, e) end
    return true
  end
  local who = F.Display(e.winner)
  if inCombat() then ns.print(L["pas d'échange en combat : réessaie juste après."]) return false end
  local m = member(e.winner)
  if not (m and m.unit) then ns.print(L("%s n'est pas dans le groupe.", who)) return false end
  -- Trop loin seulement si le jeu le dit vraiment (false) : ni valeur secrète, ni nil
  local okD, near = call(CheckInteractDistance, m.unit, 2)
  if okD and not secret(near) and near == false then ns.print(L("%s est trop loin pour échanger : rapproche-toi.", who)) return false end
  -- Fenêtre déjà ouverte : avec le gagnant, ses objets y sont (re)posés ; avec un autre, à fermer d'abord
  if tradeOpen then
    local t = Lo.trading
    if t and same(t.partner, e.winner) then Lo.FillTrade(e.winner) return true end
    ns.print(t and L("un échange est déjà ouvert avec %s : ferme-le d'abord.", F.Display(t.partner)) or L["un échange est déjà ouvert : ferme-le d'abord."])
    return false
  end
  local ask = { winner = e.winner, at = time(), errors = {} }
  Lo.tradeAsk = ask
  if not call(InitiateTrade, m.unit) then
    Lo.tradeAsk = nil
    ns.print(L("le jeu n'a pas permis d'ouvrir l'échange avec %s.", who))
    return false
  end
  ns.print(L("échange demandé à %s : ses objets seront posés tout seuls dans la fenêtre d'échange.", who))
  if C_Timer and C_Timer.After then C_Timer.After(Lo.TRADE_WAIT, function() ns.safe(L["échange"], Lo.TradeTimeout, ask) end) end
  return true
end

Lo.NO_WINDOW = N("demande-lui d'ouvrir l'échange avec toi (clic droit sur ton portrait › Échanger), l'objet sera posé tout seul.")
-- Pas de fenêtre d'échange 4 s après « Échanger » : ce que le jeu a dit, sinon la marche à suivre
function Lo.TradeTimeout(ask)
  if Lo.tradeAsk ~= ask then return end -- fenêtre ouverte entre-temps, ou nouvelle demande
  Lo.tradeAsk = nil
  local who = F.Display(ask.winner)
  local err = ask.errors[#ask.errors]
  if err then ns.print(L("pas de fenêtre d'échange avec %s. Le jeu dit : « %s » Sinon, %s", who, err, L[Lo.NO_WINDOW]))
  else ns.print(L("pas de fenêtre d'échange avec %s : %s", who, L[Lo.NO_WINDOW])) end
end
ns.on("UI_ERROR_MESSAGE", function(_, message)
  local ask = Lo.tradeAsk
  if not ask or not usable(message) or #ask.errors >= 5 then return end
  local text = plain(message)
  if text ~= "" then ask.errors[#ask.errors + 1] = F.cut(text, 120) end
end)

-- Fenêtre d'échange ouverte, par n'importe qui : les objets attribués au partenaire y seront posés. Raid d'essai : pas de
-- vrai échange ; Test.lua peut simuler un échange ouvert par un gagnant fictif (partner) : crochet test.tradeShow, sinon
-- test.trade pour chaque objet.
function Lo.OnTradeShow(partner)
  if Lo.test then
    local full = F.FullName(partner)
    local items = Lo.Handover(full)
    if #items == 0 then return end
    ns.print(L("objets posés dans l'échange avec %s (raid d'essai) : %s.", F.Display(full), links(items)))
    if Lo.test.tradeShow then ns.safe(L["raid d'essai"], Lo.test.tradeShow, full, items)
    elseif Lo.test.trade then for _, e in ipairs(items) do ns.safe(L["raid d'essai"], Lo.test.trade, e) end end
    return
  end
  tradeOpen = true
  Lo.tradeAsk = nil -- une fenêtre s'est ouverte : plus d'attente
  if Lo.trading and not Lo.trading.closing then Lo.trading = nil end -- fin d'un échange précédent jamais vue
  local full = tradePartner()
  if not full then
    if anyAwarded() then ns.print(L["échange : le jeu ne donne pas le nom du partenaire, pose les objets à la main."]) end
    return
  end
  if #Lo.Handover(full) == 0 then return end
  Lo.trading = { partner = full, at = time(), placed = {} }
  if C_Timer and C_Timer.After then C_Timer.After(Lo.TRADE_DELAY, function() ns.safe(L["échange"], Lo.FillTrade, full) end)
  else Lo.FillTrade(full) end
end

-- Pose les objets attribués au partenaire dans les cases libres de l'échange ouvert ; jamais deux fois la même case des
-- sacs, ni un objet déjà dans l'échange. Dit dans le chat ce qui a été posé, et ce qui ne l'a pas été (et pourquoi).
function Lo.FillTrade(full)
  if Lo.test or not tradeOpen then return false end
  local t = Lo.trading
  if not (t and not t.closing and same(t.partner, full)) then return false end
  local items = Lo.Handover(full)
  if #items == 0 then return false end
  local who = F.Display(full)
  if inCombat() then ns.print(L("en combat : pose les objets de %s à la main, ou rouvre l'échange après le combat.", who)) return false end
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
        missed[#missed + 1] = L("%s (délai d'échange passé)", e.link)
      else
        while free <= max and taken[free] do free = free + 1 end
        local bag, slot
        if free <= max then bag, slot = Lo.FindInBags(e, used) end
        if free > max then missed[#missed + 1] = L("%s (plus de case libre dans l'échange)", e.link)
        elseif not bag then missed[#missed + 1] = L("%s (introuvable dans tes sacs)", e.link)
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
      if not tradeOpen or Lo.trading ~= t or inCombat() then return end
      local okL, link = call(C_Container and C_Container.GetContainerItemLink, s.bag, s.slot)
      if not (okL and usable(link) and F.ItemId(link) == s.itemId) then return end -- sacs changés entre-temps
      call(ClearCursor)
      call(C_Container and C_Container.PickupContainerItem, s.bag, s.slot)
      call(ClickTradeButton, s.tradeSlot)
    end
    if i == 1 or not (C_Timer and C_Timer.After) then put()
    else C_Timer.After((i - 1) * Lo.TRADE_STEP, function() ns.safe(L["échange"], put) end) end
  end
  if #placed > 0 then ns.print(L("objets posés dans l'échange avec %s : %s. Vérifie, puis valide l'échange.", who, table.concat(placed, ", "))) end
  if #missed > 0 then ns.print(L("pas posé pour %s : %s.", who, table.concat(missed, ", "))) end
  refresh()
  return #placed > 0
end

-- Fenêtre fermée : chaque objet posé qui a quitté les sacs (moins d'exemplaires qu'avant) est remis ; échange annulé :
-- rien ne change
function Lo.OnTradeClosed()
  tradeOpen = false
  local t = Lo.trading
  if not t or t.closing then return end
  t.closing = true
  local function check()
    if Lo.trading == t then Lo.trading = nil end
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
      local e = (gone[p.itemId] or 0) > 0 and Lo.Find(p.key)
      if e and e.status == "awarded" then
        e.status, e.tradedAt, e.bag, e.slot = "traded", time(), nil, nil
        given[#given + 1] = e.link
        gone[p.itemId] = gone[p.itemId] - 1
      end
    end
    if #given > 0 then ns.print(L("remis à %s : %s.", F.Display(t.partner), table.concat(given, ", "))) end
    refresh()
  end
  if C_Timer and C_Timer.After then C_Timer.After(1, function() ns.safe(L["échange"], check) end) else check() end
end
ns.on("TRADE_SHOW", function() ns.safe(L["échange"], Lo.OnTradeShow) end)
ns.on("TRADE_CLOSED", function() ns.safe(L["échange"], Lo.OnTradeClosed) end)

-- Sacs changés : les objets pas encore retrouvés sont recherchés
ns.on("BAG_UPDATE_DELAYED", function()
  if Lo.test then return end
  for _, e in ipairs(list()) do if e.status == "new" and not e.bag then ns.safe(L["butin"], Lo.Locate, e, 4) end end
end)

--------------------------------------------------------------------------------------------------------------------
-- Raid d'essai : fin
--------------------------------------------------------------------------------------------------------------------
function Lo.StopTest()
  Lo.test = nil
  Lo.testItems, Lo.testNotPassed = {}, {}
  if ns.Hist and ns.Hist.StopTest then ns.Hist.StopTest() end
  Lo.councils, Lo.offers, Lo.rollSessions, Lo.activeRoll, Lo.trading, Lo.tradeAsk = {}, {}, {}, nil, nil, nil
  reminded = {}
  ui("Close")
  refresh()
end

-- Objets et minuteurs tenus à jour (délai d'échange, objets de plus de 12 h) : fenêtres du butin et onglet En raid
-- seulement (rafraîchir l'onglet Synchro lui rendrait le clavier)
local function tick()
  Lo.Prune()
  if ns.LootUI and ns.LootUI.Refresh then ns.LootUI.Refresh() end
  if ns.Pages and ns.Pages.Refresh then ns.Pages.Refresh("enraid") end
end
ns.on("PLAYER_LOGIN", function()
  ns.safe(L["butin"], Lo.Prune)
  -- Conseils et jets ne survivent pas à un /reload : leurs objets redeviennent à distribuer
  for _, e in ipairs(store().items) do if e.status == "council" or e.status == "roll" then e.status = "new" end end
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(30, function() ns.safe(L["butin"], tick) end) end
end)

return Lo
