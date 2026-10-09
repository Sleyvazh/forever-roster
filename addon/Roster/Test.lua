-- Raid d'essai (/roster test) : seul et hors groupe, tu es chef de butin d'un raid fictif (toi et 9 joueurs) pour essayer
-- la distribution par Roster : objets reçus, tout au conseil (réponses à chaque objet selon l'armure de chaque classe,
-- objets portés, votes), jets MS / OS avec égalité, jet libre, garder, échange, joueur sans l'addon qui n'a pas passé, et
-- la fenêtre de réponse d'un joueur (deux objets proposés, dont un qu'il ne peut pas porter). Le moteur du butin
-- (Loot.lua) lit ns.Loot.test : membres fictifs, messages d'addon (T.send), chat (T.say) et échange (T.trade). Rien ne
-- part au chat du raid, aux autres joueurs ni au site : les annonces s'affichent dans ta fenêtre de chat, après « [essai] ».
local _, ns = ...
local T = { active = false }
ns.Test = T
local K, F = ns.Kit, ns.Format
local GREY, GREEN, ORANGE = K.GREY, K.GREEN, "|cfff0b43c"

-- Joueurs fictifs (classes et spés de Retail) ; Tharok et Brumelune sont au conseil, Orvane n'a pas l'addon
local PLAYERS = {
  { name = "Kaeldra-Hyjal", class = "DEMONHUNTER", role = "Tank", spec = "Vengeance", subgroup = 1 },
  { name = "Tharok-Hyjal", class = "WARRIOR", role = "Tank", spec = "Protection", subgroup = 1, council = true },
  { name = "Brumelune-Ysondre", class = "DRUID", role = "Heal", spec = "Restoration", subgroup = 1, council = true },
  { name = "Thessaly-Ysondre", class = "PALADIN", role = "Heal", spec = "Holy", subgroup = 1 },
  { name = "Orvane-Hyjal", class = "SHAMAN", role = "Heal", spec = "Restoration", subgroup = 2, noAddon = true },
  { name = "Vex-Kael'Thas", class = "ROGUE", role = "DPS", spec = "Outlaw", subgroup = 2 },
  { name = "Lysenn-Dalaran", class = "EVOKER", role = "DPS", spec = "Devastation", subgroup = 2 },
  { name = "Mirwen-Hyjal", class = "MAGE", role = "DPS", spec = "Frost", subgroup = 2 },
  { name = "Ashlen-Hyjal", class = "DEATHKNIGHT", role = "DPS", spec = "Unholy", subgroup = 2 },
}
local CHEF, NOADDON = "Tharok-Hyjal", "Orvane-Hyjal" -- chef de butin fictif (côté joueur), joueur sans l'addon
-- Objets reçus sur la saison (colonne « Reçus » du conseil, comme les lignes N et D des données du site) : total, puis
-- BiS, Upgrade et jets MS (les autres objets qui comptent sont dans le total seulement)
local RECEIVED = { ["Kaeldra-Hyjal"] = { 3, 1, 1, 1 }, ["Tharok-Hyjal"] = { 1, 0, 1, 0 }, ["Brumelune-Ysondre"] = { 2, 1, 0, 0 },
  ["Thessaly-Ysondre"] = { 0, 0, 0, 0 }, ["Orvane-Hyjal"] = { 1, 0, 0, 1 }, ["Vex-Kael'Thas"] = { 4, 1, 2, 0 },
  ["Lysenn-Dalaran"] = { 0, 0, 0, 0 }, ["Mirwen-Hyjal"] = { 2, 0, 1, 1 }, ["Ashlen-Hyjal"] = { 1, 1, 0, 0 } }

-- Premier conseil : souhaits écrits (nom, réponse, note, écart de niveau de l'objet porté) ; la règle de l'armure passe
-- ensuite (Transmo ou Passer si ce n'est pas l'armure de la classe) ; whisper : sans l'addon, chuchoté avec le numéro de
-- l'objet (« bis 1 ») et corrigé par le chef de butin. Tharok et Brumelune votent pour les deux premiers qui le veulent.
local ANSWERS = {
  { "Kaeldra-Hyjal", "bis", "2e pièce", -13 }, { "Tharok-Hyjal", "upgrade", "petit gain", -6 },
  { NOADDON, "bis", whisper = true }, { "Lysenn-Dalaran", "upgrade", "", -9 },
  { "Brumelune-Ysondre", "off", "pour la spé équilibre", -3 }, { "Vex-Kael'Thas", "upgrade", "", -8 },
  { "Ashlen-Hyjal", "upgrade", "+16 niveaux", -16 }, { "Mirwen-Hyjal", "bis", "", -11 }, { "Thessaly-Ysondre", "pass", "", 0 },
}
-- Type d'armure de chaque classe (1 tissu, 2 cuir, 3 mailles, 4 plaques) et emplacements où il compte : règle locale si le
-- moteur n'a pas L.CanUseClass
local ARMOR = { MAGE = 1, PRIEST = 1, WARLOCK = 1, DEMONHUNTER = 2, DRUID = 2, MONK = 2, ROGUE = 2, EVOKER = 3, HUNTER = 3, SHAMAN = 3,
  DEATHKNIGHT = 4, PALADIN = 4, WARRIOR = 4 }
local ARMOR_SLOT = { INVTYPE_HEAD = true, INVTYPE_SHOULDER = true, INVTYPE_CHEST = true, INVTYPE_ROBE = true, INVTYPE_WAIST = true,
  INVTYPE_LEGS = true, INVTYPE_FEET = true, INVTYPE_WRIST = true, INVTYPE_HAND = true }
-- Premiers jets : MS (/roll 100) et OS (/roll 99), égalité à 87 puis relance ; jet libre
local MSOS = { { "Ashlen-Hyjal", 87, 100 }, { "Mirwen-Hyjal", 42, 100 }, { "Vex-Kael'Thas", 87, 100 }, { "Lysenn-Dalaran", 95, 99 }, { "Thessaly-Ysondre", 61, 99 } }
local REROLL = { ["Ashlen-Hyjal"] = 34, ["Vex-Kael'Thas"] = 71 }
local FREE = { { "Tharok-Hyjal", 23 }, { "Mirwen-Hyjal", 88 }, { "Kaeldra-Hyjal", 54 } }
local LABEL = { bis = "BiS", upgrade = "Upgrade", off = "Off-spec", transmo = "Transmo", pass = "Passer" }
local TRADE, LATE = 112 * 60, 25 * 60 -- délai d'échange restant : 1 h 52, et 25 min pour le troisième objet (en orange)
local CLOSE_AFTER = 6 -- secondes : Tharok termine ses conseils (côté joueur) une fois que tu as répondu à tout

local function me() return (ns.Comm and ns.Comm.Me and ns.Comm.Me()) or "?" end
local function show(name) return F.Display(name) end
local function player(name) for _, p in ipairs(PLAYERS) do if F.SameName(p.name, name) then return p end end end
local function colored(name)
  local p = player(name)
  local cls = p and p.class
  if not cls and F.SameName(name, me()) then local ok, _, c = pcall(UnitClass, "player") cls = ok and F.usable(c) and c or nil end
  return K.colored(cls, show(name))
end
local function nameOf(x) return type(x) == "table" and (x.name or x[1]) or x end
-- Ligne de chat de l'essai : dans ta fenêtre seulement
local function chat(text) print(GREY .. "[essai]|r " .. text) end

-- Action différée, abandonnée si l'essai s'est arrêté (ou a recommencé) entre-temps
local run = 0
local function after(sec, fn)
  local id = run
  C_Timer.After(sec, function() if T.active and run == id then ns.safe("raid d'essai", fn) end end)
end

-- Moteur du butin (Loot.lua) et ses fenêtres (LootUI.lua) : appels protégés, sans effet s'ils manquent
local function loot(fn, ...)
  local L = ns.Loot
  if not (L and L[fn]) then return nil end
  local res = { pcall(L[fn], ...) }
  if res[1] then return unpack(res, 2, table.maxn(res)) end
  ns.print("|cffff6060erreur (butin, " .. fn .. ")|r " .. tostring(res[2]))
end
local function window(fn, ...) if ns.LootUI and ns.LootUI[fn] then ns.safe("butin", ns.LootUI[fn], ...) end end
local function refresh()
  window("Refresh")
  if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
  if T.Refresh then ns.safe("raid d'essai", T.Refresh) end
end
-- Objets du chef de butin, dans l'ordre d'arrivée
local function items()
  local list, out = loot("Items"), {}
  if type(list) ~= "table" then return out end
  if #list > 0 then
    for _, e in ipairs(list) do if type(e) == "table" and e.key ~= nil then out[#out + 1] = e end end
  else
    for _, e in pairs(list) do if type(e) == "table" and e.key ~= nil then out[#out + 1] = e end end
    table.sort(out, function(a, b) if (a.at or 0) ~= (b.at or 0) then return (a.at or 0) < (b.at or 0) end return tostring(a.key) < tostring(b.key) end)
  end
  return out
end
local function find(key) for _, e in ipairs(items()) do if e.key == key then return e end end end
local function nextNew() for _, e in ipairs(items()) do if e.status == "new" then return e end end end
-- Premier conseil encore ouvert (fenêtre du conseil), sinon le dernier lancé
local function openCouncil()
  for _, e in ipairs(items()) do if e.status == "council" and e.session then return e.session end end
  return T.state and T.state.lastCouncil
end
local function size(t) local n = 0 if type(t) == "table" then for _ in pairs(t) do n = n + 1 end end return n end

-- Objets de l'essai : ceux que tu portes (connus du jeu : infobulles et niveaux justes), sinon des objets connus de tous
local SLOTS = { 1, 3, 5, 7, 10, 15, 16, 6, 8, 9, 2, 11, 13, 17, 12, 14 } -- tête, épaules, torse, jambes, mains, dos, arme…
local FALLBACK = { 19019, 17076, 18814, 16901, 18817, 32837 }
local function wornLink(slot)
  local ok, link = pcall(GetInventoryItemLink, "player", slot)
  if ok and F.usable(link) and link:find("|Hitem:%d") then return link end
end
local function fallbackLink(id, label)
  local ok, name, link = false, nil, nil
  if C_Item and C_Item.GetItemInfo then ok, name, link = pcall(C_Item.GetItemInfo, id) end
  if ok and F.usable(link) then return link end
  return "|cffa335ee|Hitem:" .. id .. "::::::::::::::|h[" .. ((ok and F.usable(name)) and name or ("Objet d'essai " .. label)) .. "]|h|r"
end
-- Objet d'une autre armure que la tienne (côté joueur) : Couronne de destruction (mailles), ou Jambières de
-- Rage-d'orage (cuir) pour une classe en mailles
local MAIL, LEATHER = 18817, 16901
local function myClass() local ok, _, class = pcall(UnitClass, "player") return ok and F.usable(class) and class or nil end
local function otherArmorLink()
  local mail = ARMOR[myClass() or ""] == 3
  return fallbackLink(mail and LEATHER or MAIL, mail and "(cuir)" or "(mailles)")
end
local function links()
  local out, seen = {}, {}
  for _, slot in ipairs(SLOTS) do
    local link = wornLink(slot)
    local id = link and link:match("|Hitem:(%d+)")
    if id and not seen[id] then seen[id] = true out[#out + 1] = link end
  end
  T.worn = #out
  for i, id in ipairs(FALLBACK) do
    if #out >= 6 then break end
    out[#out + 1] = fallbackLink(id, tostring(i))
  end
  return out
end
local function nextLink()
  local s, list = T.state, links()
  s.received = s.received + 1
  return list[(s.received - 1) % #list + 1]
end
local function itemString(link) return tostring(link or ""):match("|H(item:[^|]+)|h") end
local function itemName(link) return ((tostring(link or ""):match("|h%[(.-)%]|h") or "?"):gsub("[;|]", "")) end
local function itemIdOf(s) return tonumber(tostring(s or ""):match("item:(%d+)")) end
local function levelOf(item)
  if not (C_Item and C_Item.GetDetailedItemLevelInfo) or not item then return nil end
  local ok, lvl = pcall(C_Item.GetDetailedItemLevelInfo, item)
  return ok and type(lvl) == "number" and not F.secret(lvl) and lvl or nil
end

-- Objets portés d'un joueur fictif sur l'emplacement de l'objet (« objet:niveau », deux pour les anneaux et les bijoux)
local PAIRS = { INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 } }
local function gear(id, ilvl, delta)
  if not id then return "" end
  local function one(itemId, lvl) return lvl and (itemId .. ":" .. lvl) or tostring(itemId) end
  local loc
  if C_Item and C_Item.GetItemInfoInstant then
    local ok, _, _, _, l = pcall(C_Item.GetItemInfoInstant, id)
    loc = ok and F.usable(l) and l or nil
  end
  local pair = PAIRS[loc or ""]
  if not pair then return one(id, ilvl and ilvl + (delta or 0)) end
  local out = {}
  for k, slot in ipairs(pair) do
    local worn = itemIdOf(wornLink(slot)) or id
    out[k] = one(worn, ilvl and ilvl + (delta or 0) - (k - 1) * 3)
  end
  return table.concat(out, ",")
end

--------------------------------------------------------------------------------------------------------------------
-- Joueurs fictifs : réponses et votes du conseil, jets, chuchotement de celui qui n'a pas l'addon
--------------------------------------------------------------------------------------------------------------------
local function deliver(sender, msg, dist) if ns.Comm and ns.Comm.Deliver then ns.Comm.Deliver(sender, msg, dist) end end
local function shuffled(list)
  local out = {}
  for i, v in ipairs(list) do out[i] = v end
  for i = #out, 2, -1 do local j = math.random(i) out[i], out[j] = out[j], out[i] end
  return out
end
-- Règle de l'armure : le moteur (L.CanUseClass), sinon le type d'armure de la classe sur les emplacements d'armure
local function wears(class, item)
  local L = ns.Loot
  if L and L.CanUseClass then
    local ok, r = pcall(L.CanUseClass, item, class)
    if ok then return r ~= false end
  end
  local info = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
  if not (info and item and ARMOR[class or ""]) then return true end
  local ok, _, _, _, loc, _, classID, subID = pcall(info, item)
  if not ok or classID ~= 4 or not ARMOR_SLOT[loc or ""] or type(subID) ~= "number" or subID < 1 or subID > 4 then return true end
  return ARMOR[class] == subID
end
local WANT = { bis = 1, upgrade = 2, off = 3 }
-- Réponse permise : BiS, Upgrade ou Off-spec seulement sur son armure, sinon Transmo (Passer pour un Off-spec)
local function fit(name, kind, item)
  local p = player(name)
  if p and WANT[kind] and not wears(p.class, item) then return kind == "off" and "pass" or "transmo", true end
  return kind, false
end
-- Conseils suivants : chacun répond, au hasard dans ce que son armure permet ; Orvane chuchote sur le premier objet
-- d'une annonce
local KINDS = { "bis", "upgrade", "upgrade", "off", "transmo", "pass" }
local function randomAnswers(item, firstOfBatch)
  local out = {}
  for _, p in ipairs(shuffled(PLAYERS)) do
    if p.noAddon then
      if firstOfBatch then out[#out + 1] = { p.name, "upgrade", whisper = true } end
    else
      local kind = KINDS[math.random(#KINDS)]
      if WANT[kind] and not wears(p.class, item) then kind = math.random(2) == 1 and "transmo" or "pass" end
      out[#out + 1] = { p.name, kind, "", -math.random(0, 20) }
    end
  end
  return out
end
-- Votes de Tharok et Brumelune pour ceux qui le veulent (BiS, puis Upgrade, puis Off-spec, après la règle de l'armure,
-- aussi pour la réponse chuchotée) : premier conseil, les deux premiers (égalité : à toi de départager) ; ensuite au hasard
local function votesFor(answers, item, first)
  local list = {}
  for i, a in ipairs(answers) do
    local kind = fit(a[1], a[2], item)
    if WANT[kind] then list[#list + 1] = { name = a[1], rank = WANT[kind], i = i } end
  end
  if #list == 0 then return {} end
  table.sort(list, function(x, y) if x.rank ~= y.rank then return x.rank < y.rank end return x.i < y.i end)
  if first then return { { "Tharok-Hyjal", list[1].name }, { "Brumelune-Ysondre", (list[2] or list[1]).name } } end
  return { { "Tharok-Hyjal", list[math.random(#list)].name }, { "Brumelune-Ysondre", list[math.random(#list)].name } }
end
-- Réponse chuchotée par un joueur sans l'addon, avec le numéro de l'objet (« bis 1 », « up 2 » ; sans numéro si le
-- moteur ne numérote pas) : le moteur la lit dans le chat
local WHISPERED = { bis = "bis", upgrade = "up", off = "os", transmo = "transmo" }
local function councilNum(session)
  local c = loot("Council", session)
  if type(c) == "table" and c.num then return c.num end
  local list = loot("Councils")
  for _, x in ipairs(type(list) == "table" and list or {}) do if tostring(x.session) == session then return x.num end end
  return nil
end
local function whisper(session, name, response)
  local num = councilNum(session)
  local text = (WHISPERED[response] or response) .. (num and (" " .. num) or "")
  chat(colored(name) .. " te chuchote : " .. text)
  loot("OnWhisper", text, name)
end

-- Objet proposé au conseil (LO) : chacun répond après quelques secondes (selon son armure), puis Tharok et Brumelune
-- votent. Tout au conseil : un LO par objet, les réponses s'étalent d'un objet à l'autre.
function T.OnCouncil(session, item)
  local s = T.state
  session = tostring(session or "")
  if session == "" or s.councils[session] then return end
  s.councils[session], s.lastCouncil = true, session
  s.nCouncil = s.nCouncil + 1
  local first = s.nCouncil == 1
  -- Objets proposés ensemble (au même instant) : chacun un peu après le précédent
  local now = GetTime and GetTime() or 0
  local batchFirst = not (s.lastLO and now - s.lastLO < 2)
  s.lag, s.lastLO = batchFirst and 0 or (s.lag + 0.6), now
  local lag = s.lag
  local c = loot("Council", session)
  local id = itemIdOf(item) or (type(c) == "table" and itemIdOf(c.link))
  local ilvl = type(c) == "table" and tonumber(c.ilvl) or levelOf(item)
  local answers = first and ANSWERS or randomAnswers(item, batchFirst)
  for i, a in ipairs(answers) do
    local kind, changed = a[2], false
    if not a.whisper then kind, changed = fit(a[1], a[2], item) end
    local note = changed and "" or (a[3] or "")
    after(lag + 0.8 + i * 0.5 + math.random() * 0.4, function()
      if a.whisper then whisper(session, a[1], a[2])
      else deliver(a[1], "LA;" .. session .. ";" .. kind .. ";" .. gear(id, ilvl, a[4]) .. ";" .. note, "WHISPER") end
    end)
  end
  for i, v in ipairs(votesFor(answers, item, first)) do
    after(lag + 1.5 + #answers * 0.6 + i * 0.9, function() deliver(v[1], "LV;" .. session .. ";" .. v[2], "WHISPER") end)
  end
  if first or batchFirst then
    after(0.3, function()
      chat(first and ("les joueurs répondent à chaque objet (Transmo ou Passer si ce n'est pas l'armure de leur classe) ; Orvane, sans "
        .. "l'addon, te chuchote sa réponse avec le numéro de l'objet. Tharok et Brumelune votent : départage, puis « Donner ».")
        or "les joueurs répondent à chaque objet, puis Tharok et Brumelune votent.")
    end)
  end
end

-- Jets ouverts (RS) : les joueurs fictifs lancent leurs dés ; égalité : les ex æquo relancent
local function rollKey(id)
  local key
  for _, e in ipairs(items()) do if e.status == "roll" and tostring(e.itemId) == tostring(id) then key = e.key end end
  return key or T.state.lastRollKey
end
local function roll(st, name, value, hi)
  st.hi[F.Key(name) or name] = hi
  chat(colored(name) .. " obtient un " .. value .. " (1-" .. hi .. ").")
  loot("OnRoll", name, value, 1, hi)
end
-- Égalité : le moteur attend « Relancer » du chef de butin (seuls les ex æquo relancent)
local function tieCheck(key)
  local r = loot("Rolls", key)
  if type(r) == "table" and r.tie and r.open ~= false then
    local list = {}
    for _, n in ipairs(r.winners or {}) do list[#list + 1] = colored(n) end
    chat("égalité entre " .. table.concat(list, " et ") .. " : « Relancer » dans la fenêtre du butin.")
  end
end
-- Relance demandée par le chef de butin (crochet du moteur) : les ex æquo fictifs relancent le même dé
function T.reroll(key, winners, kind)
  local st = T.state and T.state.rolls[key]
  if not st then return end
  local hi = kind == "os" and 99 or 100
  local i = 0
  for _, n in ipairs(winners or {}) do
    local p = player(n)
    if p then
      i = i + 1
      after(0.8 * i, function() roll(st, p.name, REROLL[p.name] or math.random(1, hi), hi) end)
    end
  end
end
function T.OnRolls(id, kind)
  local s = T.state
  local key = rollKey(id)
  if not key then return end
  if s.rolls[key] then return end
  local st = { hi = {} }
  s.rolls[key] = st
  local list
  if kind == "free" then
    s.nFree = s.nFree + 1
    list = s.nFree == 1 and FREE or {}
    if s.nFree > 1 then for i, p in ipairs(shuffled(PLAYERS)) do if i <= 3 then list[i] = { p.name, math.random(1, 100) } end end end
  else
    s.nMsos = s.nMsos + 1
    list = s.nMsos == 1 and MSOS or {}
    if s.nMsos > 1 then
      for i, p in ipairs(shuffled(PLAYERS)) do if i <= 4 then list[i] = { p.name, math.random(1, i == 4 and 99 or 100), i == 4 and 99 or 100 } end end
    end
  end
  for i, r in ipairs(list) do after(0.7 * i, function() roll(st, r[1], r[2], r[3] or 100) end) end
  after(0.7 * #list + 1, function() tieCheck(key) end)
  after(0.2, function()
    chat(kind == "free" and "jet libre : fais /roll 100 si tu veux jouer aussi."
      or "jets ouverts : fais /roll 100 (MS) ou /roll 99 (OS) si tu veux jouer aussi.")
  end)
end

-- Côté joueur : tes réponses aux objets proposés par Tharok (chef de butin fictif). Une réponse peut changer tant que son
-- conseil est ouvert ; Tharok termine ses conseils (LC) quelques secondes après ta réponse au dernier objet proposé.
local function closeOffer(o)
  if o.closed then return end
  o.closed = true
  local r = o.response
  local mine = r ~= nil and r ~= "pass"
  local winner = mine and me() or "Kaeldra-Hyjal"
  chat("[Raid] " .. colored(CHEF) .. " : " .. show(winner) .. " reçoit " .. o.link .. " (conseil : " .. (LABEL[mine and r or "bis"] or r) .. ")")
  if mine then chat(colored(CHEF) .. " te chuchote : Tu reçois " .. o.link .. " : passe me voir pour l'échange") end
  deliver(CHEF, "LC;" .. o.session .. ";" .. winner, "RAID")
end
function T.OnAnswer(session, response)
  local s = T.state
  local o = s.offers[tostring(session)]
  if not o or o.closed then return end
  o.response, o.answered = response, true
  for _, x in ipairs(s.offerBatch or {}) do if not x.answered then return end end
  if s.closing then return end
  s.closing = true
  after(CLOSE_AFTER, function()
    s.closing = false
    for _, x in ipairs(s.offerBatch or {}) do closeOffer(x) end
    refresh()
  end)
end

--------------------------------------------------------------------------------------------------------------------
-- Crochets du moteur (ns.Loot.test) : messages d'addon, chat, échange
--------------------------------------------------------------------------------------------------------------------
-- Message d'addon : rien ne part ; comme en jeu, tu reçois les tiens au raid et ceux que tu te chuchotes
function T.send(msg, dist, target)
  if not (T.active and F.usable(msg)) then return false end
  local f = F.split(msg)
  local m = me()
  local private = dist == "WHISPER"
  if not private or (target and F.SameName(target, m)) then after(0.05, function() deliver(m, msg, dist or "RAID") end) end
  if f[1] == "LO" and not private then T.OnCouncil(f[2], f[3])
  elseif f[1] == "RS" then T.OnRolls(f[2], f[3])
  elseif f[1] == "LA" then T.OnAnswer(f[2], f[3]) end
  return true
end
-- Annonce au raid ou chuchotement : dans ta fenêtre de chat seulement
local CHANNEL = { RAID = "Raid", RAID_WARNING = "Avertissement", PARTY = "Groupe", INSTANCE_CHAT = "Instance", SAY = "Dire" }
function T.say(text, chatType, target)
  if not (T.active and F.usable(text)) then return false end
  if chatType == "WHISPER" then chat("À " .. colored(target or "?") .. " : " .. text)
  else chat("[" .. (CHANNEL[chatType or "RAID"] or "Raid") .. "] " .. colored(me()) .. " : " .. text) end
  return true
end
-- Échange simulé : il réussit après un instant
function T.trade(entry)
  if type(entry) ~= "table" then entry = find(entry) end
  if not (T.active and entry) then return false end
  local link = entry.link or entry.name or "objet"
  chat("échange avec " .. colored(entry.winner or "?") .. " : " .. link .. "...")
  after(1.5, function()
    loot("MarkTraded", entry.key)
    chat(GREEN .. "échange réussi|r : " .. link .. " remis à " .. colored(entry.winner or "?") .. ".")
    refresh()
  end)
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Étapes du panneau
--------------------------------------------------------------------------------------------------------------------
local function receive(expires)
  local link = nextLink()
  chat("tu reçois le butin : " .. link .. ".")
  return loot("AddTestItem", link, expires)
end
function T.Receive()
  for i = 1, 3 do receive(i == 3 and LATE or TRADE) end
  window("ShowLoot")
  refresh()
end
-- Objet à attribuer ; s'il n'en reste pas (tous au conseil ou attribués), un de plus arrive
local function pending()
  local e = nextNew()
  if not e then receive(TRADE) e = nextNew() end
  return e
end
-- Tout au conseil : une annonce numérotée, un conseil par objet (moteur sans L.StartAllCouncils : un à la fois)
function T.Council()
  local fresh = {}
  for _, e in ipairs(items()) do if e.status == "new" then fresh[#fresh + 1] = e end end
  if #fresh == 0 then ns.print("aucun objet à attribuer : « Recevoir 3 objets » d'abord (panneau du raid d'essai).") return end
  local first
  if ns.Loot and ns.Loot.StartAllCouncils then
    local _, sessions = loot("StartAllCouncils")
    first = type(sessions) == "table" and sessions[1] or nil
  else
    for _, e in ipairs(fresh) do
      local res, sid = loot("StartCouncil", e.key)
      local now = find(e.key)
      first = first or (now and now.status == "council" and now.session) or sid or ((type(res) == "string" or type(res) == "number") and res) or nil
      if not res then break end
    end
  end
  if first ~= nil then window("ShowCouncil", first) end
  refresh()
end
function T.Roll(kind)
  local e = pending()
  if not e then return end
  T.state.lastRollKey = e.key
  loot("StartRoll", e.key, kind)
  window("ShowLoot")
  refresh()
end
function T.Keep()
  local e = nextNew()
  if not e then receive(TRADE) e = nextNew() end
  if not e then return end
  loot("Keep", e.key)
  window("ShowLoot")
  refresh()
end
function T.Handover() window("ShowHandover") end
-- Orvane (sans l'addon) n'a pas passé et gagne un objet au butin de groupe
function T.NotPassed()
  local link = nextLink()
  chat(colored(NOADDON) .. " reçoit le butin : " .. link .. ". Sans l'addon, il n'a pas passé.")
  loot("AddTestNotPassed", NOADDON, link)
  refresh()
end
-- Côté joueur : Tharok propose deux objets d'un coup (mêmes messages LO que dans un vrai raid) ; le second n'est pas de
-- ton armure (seulement Transmo ou Passer)
function T.Offer()
  local s = T.state
  local batch, parts = {}, {}
  for i, link in ipairs({ nextLink(), otherArmorLink() }) do
    s.offerSeq = s.offerSeq + 1
    local o = { session = tostring(900 + s.offerSeq), link = link }
    s.offers[o.session] = o
    batch[i], parts[i] = o, i .. " " .. link
  end
  s.offerBatch, s.closing = batch, false
  chat("[Raid] " .. colored(CHEF) .. " : au conseil, " .. table.concat(parts, ", ") .. ". Réponds dans la fenêtre, ou chuchote-moi bis, up, os ou transmo suivi du numéro.")
  for _, o in ipairs(batch) do deliver(CHEF, "LO;" .. o.session .. ";" .. (itemString(o.link) or "item:0") .. ";" .. itemName(o.link), "RAID") end
  window("ShowOffer", batch[1].session)
  refresh()
end

--------------------------------------------------------------------------------------------------------------------
-- Début et fin de l'essai
--------------------------------------------------------------------------------------------------------------------
local function inGroup()
  if ns.Comm and ns.Comm.InGroup then return ns.Comm.InGroup() end
  local ok, v = pcall(IsInGroup)
  return ok and v == true
end
function T.Start()
  if T.active then T.Show() return true end
  if inGroup() then ns.print("le raid d'essai se lance hors groupe : quitte d'abord ton groupe.") return false end
  if not (ns.Loot and ns.Loot.AddTestItem) then
    ns.print("|cffff6060module Loot non chargé|r (fais /console scriptErrors 1 puis /reload pour voir l'erreur)")
    return false
  end
  run = run + 1
  T.active = true
  T.state = { received = 0, councils = {}, nCouncil = 0, rolls = {}, nMsos = 0, nFree = 0, offerSeq = 0, offers = {}, lag = 0 }
  local m = me()
  local ok, _, class = pcall(UnitClass, "player")
  local members = { { name = m, class = ok and F.usable(class) and class or nil, subgroup = 1, online = true, addon = true } }
  local council = { m }
  for _, p in ipairs(PLAYERS) do
    members[#members + 1] = { name = p.name, class = p.class, role = p.role, spec = p.spec, subgroup = p.subgroup, online = true, addon = not p.noAddon }
    if p.council then council[#council + 1] = p.name end
  end
  local counts = { short = "saison", label = "Reçus · saison", entries = {} }
  for _, p in ipairs(PLAYERS) do
    local r = RECEIVED[p.name] or { 0, 0, 0, 0 }
    counts.entries[#counts.entries + 1] = { names = { p.name }, n = r[1], bis = r[2], up = r[3], ms = r[4] }
  end
  ns.Loot.test = { armorRule = true, members = members, council = council, counts = counts, send = T.send, say = T.say, trade = T.trade, reroll = T.reroll }
  -- Objets de secours (et ceux d'une autre armure, côté joueur) demandés au jeu dès maintenant : leurs noms seront prêts
  if C_Item and C_Item.RequestLoadItemDataByID then
    if #links() < 6 then for _, id in ipairs(FALLBACK) do pcall(C_Item.RequestLoadItemDataByID, id) end end
    pcall(C_Item.RequestLoadItemDataByID, MAIL)
    pcall(C_Item.RequestLoadItemDataByID, LEATHER)
  end
  ns.print("raid d'essai lancé : tu es chef de butin, avec 9 joueurs fictifs. Rien ne part au chat du raid, aux autres joueurs ni au site.")
  T.Show()
  refresh()
  return true
end
function T.Stop()
  if not T.active then return end
  T.active = false
  run = run + 1
  if ns.Loot then
    if ns.Loot.StopTest then ns.safe("raid d'essai", ns.Loot.StopTest) end
    ns.Loot.test = nil
  end
  if T.panel then T.panel:Hide() end
  ns.print("raid d'essai terminé.")
  refresh()
end
function T.Restart() T.Stop() T.Start() end
-- /roster test : lance l'essai, ou affiche / masque son panneau
function T.Toggle()
  if not T.active then return T.Start() end
  if T.panel and T.panel:IsShown() then T.panel:Hide() else T.Show() end
end
ns.on("GROUP_ROSTER_UPDATE", function()
  if T.active and inGroup() then ns.print("tu as rejoint un groupe : raid d'essai arrêté.") T.Stop() end
end)

--------------------------------------------------------------------------------------------------------------------
-- Panneau de l'essai : une étape par ligne
--------------------------------------------------------------------------------------------------------------------
local function signature()
  local s = T.state or {}
  local parts = { tostring(s.lastCouncil), size(loot("NotPassed")) }
  for _, o in ipairs(s.offerBatch or {}) do parts[#parts + 1] = o.session .. tostring(o.response) .. tostring(o.closed) end
  for _, e in ipairs(items()) do parts[#parts + 1] = tostring(e.key) .. ":" .. tostring(e.status) .. ":" .. tostring(e.winner) end
  return table.concat(parts, ",")
end
-- Tenu à jour quand le moteur change (réponses, jets, échanges) ; tes réponses lues aussi dans le moteur, au cas où
local function watch()
  if not (T.active and T.panel and T.panel:IsShown()) then return end
  local offers = loot("Offers")
  for _, o in ipairs(T.state.offerBatch or {}) do
    for _, x in pairs(type(offers) == "table" and not o.closed and offers or {}) do
      if type(x) == "table" and tostring(x.session) == o.session and x.answered and x.response and x.response ~= o.response then
        T.OnAnswer(o.session, x.response)
      end
    end
  end
  if signature() ~= T.sig then T.Refresh() end
end
local function build()
  local w = K.window("RosterTest", "Raid d'essai", 600, 600)
  local p = CreateFrame("Frame", nil, w)
  p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
  w.hintText = K.hint(p, "")
  K.itemTips(p)
  w.list = K.list(p, -40)
  T.panel = w
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(1, function() ns.safe("raid d'essai", watch) end) end
end
function T.Show()
  if not T.active then return T.Start() end
  if not T.panel then build() end
  K.front(T.panel)
  T.panel:Show()
  T.Refresh()
end

local function rosterText()
  local by = { Tank = {}, Heal = {}, DPS = {} }
  for _, p in ipairs(PLAYERS) do
    local t = by[p.role]
    t[#t + 1] = colored(p.name) .. (p.noAddon and (GREY .. " (sans l'addon)|r") or "")
  end
  return K.roleIcon("Tank") .. " " .. table.concat(by.Tank, ", ") .. "   " .. K.roleIcon("Heal") .. " " .. table.concat(by.Heal, ", ")
    .. "\n" .. K.roleIcon("DPS") .. " " .. table.concat(by.DPS, ", ") .. "   et toi, " .. colored(me()) .. "."
end
function T.Refresh()
  local p = T.panel
  if not (p and p:IsShown() and T.active) then return end
  T.sig = signature()
  local L, all, count = p.list, items(), {}
  for _, e in ipairs(all) do count[e.status or "?"] = (count[e.status or "?"] or 0) + 1 end
  p.hintText:SetText(ORANGE .. "Tu es chef de butin, avec 9 joueurs fictifs. Rien ne part au chat du raid, aux autres joueurs ni au site.|r")
  L.Reset()
  L.Header("Le raid")
  L.Add(rosterText() .. "\n" .. GREY .. "Conseil du butin : toi, Tharok et Brumelune. Les annonces s'affichent dans ta fenêtre de chat, après [essai].|r")
  L.Header("1. Recevoir des objets")
  L.Add("Le butin de groupe te donne 3 objets (ceux que tu portes : infobulles du jeu) ; les autres ont passé. Échange possible pendant 2 h : "
    .. "il reste 1 h 52 pour deux d'entre eux, 25 min pour le troisième (en orange)." .. GREY .. "\nReçus : " .. #all .. " · à attribuer : " .. (count.new or 0) .. "|r",
    { { "Recevoir 3 objets", 150, function() T.Receive() end }, { "Fenêtre du butin", 150, function() window("ShowLoot") end } })
  L.Header("2. Tout au conseil")
  local buttons = { { "Tout au conseil", 150, function() T.Council() end } }
  if T.state.lastCouncil then buttons[2] = { "Fenêtre du conseil", 160, function() window("ShowCouncil", openCouncil()) end } end
  L.Add("Les objets à distribuer partent au conseil d'un coup (une annonce, objets numérotés). Chacun répond à chaque objet avec ses "
    .. "objets portés : Transmo ou Passer si ce n'est pas l'armure de sa classe. Orvane, sans l'addon, te chuchote « bis 1 ». Tharok et "
    .. "Brumelune votent sur chaque objet. La bande du haut passe d'un objet à l'autre ; vote pour départager, puis « Donner » : la "
    .. "fenêtre passe au conseil suivant. Réponds aussi si tu veux (fenêtre « ta réponse »)."
    .. GREY .. "\nConseils en cours : " .. (count.council or 0) .. "|r", buttons)
  L.Header("3. Jets MS / OS")
  L.Add("MS : /roll 100, OS : /roll 99 ; le premier jet de chacun compte. Ashlen et Vex font 87 : seuls les ex æquo relancent. Puis « Donner » au gagnant. "
    .. "S'il ne reste rien à distribuer, un objet de plus arrive.",
    { { "Lancer les jets MS / OS", 190, function() T.Roll("msos") end } })
  L.Header("4. Jet libre")
  L.Add("Tout le monde peut faire /roll 100 : le plus haut l'emporte (un objet de plus arrive si besoin).",
    { { "Lancer le jet libre", 170, function() T.Roll("free") end } })
  L.Header("5. Garder")
  L.Add("Personne n'en a besoin : tu gardes l'objet (désenchantement, banque de guilde), sans échange. Aussi « Garder » dans la fenêtre du butin.",
    { { "Garder le suivant", 160, function() T.Keep() end } })
  L.Header("6. Objets à remettre")
  L.Add("Chaque objet attribué attend son échange : le gagnant à portée, dans les 2 h. « Échanger » ouvre l'échange (ici simulé : il réussit)."
    .. GREY .. "\nÀ remettre : " .. (count.awarded or 0) .. " · remis : " .. (count.traded or 0) .. "|r",
    { { "Objets à remettre", 160, function() T.Handover() end } })
  for _, e in ipairs(all) do
    if e.status == "awarded" then
      local key = e.key
      L.Add((e.link or e.name or "?") .. " pour " .. colored(e.winner or "?"), { { "Échanger", 110, function() loot("Trade", key) refresh() end } })
    end
  end
  L.Header("7. Joueur sans l'addon")
  L.Add("Orvane n'a pas l'addon : il n'a pas passé et gagne un objet au butin de groupe. Roster te le signale : chuchote-lui de le garder pour l'échange.",
    { { "Orvane gagne un objet", 190, function() T.NotPassed() end } })
  local np = loot("NotPassed")
  if type(np) == "table" then
    for _, x in pairs(np) do
      local name = nameOf(x)
      if F.usable(name) then
        L.Add(colored(name) .. " : " .. tostring(type(x) == "table" and x.link or ""),
          { { "Chuchoter à " .. (F.Split(name) or name), 180, function() loot("WhisperNotPassed", name) refresh() end } })
      end
    end
  end
  L.Header("8. Côté joueur")
  L.Add("Tharok, chef de butin fictif, te propose deux objets d'un coup : la fenêtre de réponse des joueurs, avec la bande d'objets. "
    .. "Le second n'est pas de ton armure : seulement Transmo ou Passer. Après chaque réponse, la fenêtre passe à l'objet suivant ; "
    .. "tu peux changer une réponse tant que Tharok n'a pas terminé (quelques secondes après ta dernière réponse).",
    { { "Recevoir 2 propositions", 200, function() T.Offer() end } })
  L.Header("Fin")
  local done = (count.awarded or 0) + (count.traded or 0) + (count.kept or 0)
  L.Add(GREY .. done .. (done > 1 and " objets attribués" or " objet attribué") .. " pendant l'essai. Le vrai butin de groupe (passer automatiquement), "
    .. "l'échange et les annonces restent à vérifier dans un vrai raid.|r",
    { { "Recommencer", 130, function() T.Restart() end }, { "Quitter l'essai", 140, function() T.Stop() end } })
  L.Done()
end

return T
