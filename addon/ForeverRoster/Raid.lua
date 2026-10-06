-- En raid (lot G) : messages entre addons, qui a l'addon, appel aux consommables, fiches de boss (en ciblant le boss,
-- avant le pull), butin du maître du butin (soft reserve avec bonus SR+, jets MS / OS ou libre, conseil du butin),
-- objets à remettre par échange. Tout ce qui dépend du client de Forever est protégé : sans l'API, la fonction se tait.
-- Raid d'essai (Test.lua) : RA.test remplace le raid, ses membres et les messages ; rien ne part au site ni au chat.
local _, ns = ...
local RA = {}
ns.Raid = RA

local PREFIX = "FRoster"
local TRADE_WINDOW = 2 * 3600

-- Prénom seul : sans royaume (« -Royaume ») ni nom de famille de Forever (« John Poutre » → « John »)
local function short(n) return (tostring(n or ""):match("^[^%-%s]+")) or "" end
local function me() return UnitName("player") or "?" end
local function channel()
  if RA.test then return "RAID" end
  return (IsInRaid and IsInRaid() and "RAID") or (IsInGroup and IsInGroup() and "PARTY") or nil
end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end if RA.RefreshWindows then RA.RefreshWindows() end end
local function linkFor(id) return ns.Group.linkFor(id) end
-- Lien d'un objet pour une annonce : le vrai lien ; raid d'essai (annonce dans ta fenêtre seulement) : lien d'affichage
local function sayLink(item)
  if item.link then return item.link end
  if RA.test then return ns.Group.displayLink(item.itemId, item.name, item.quality) end
  return linkFor(item.itemId)
end
local function db(key) ForeverRosterDB[key] = ForeverRosterDB[key] or {} return ForeverRosterDB[key] end
-- Comparaison de noms (boss) : casse, accents et ponctuation ignorés
local function norm(s)
  s = tostring(s or ""):lower()
  for a, b in pairs({ ["é"] = "e", ["è"] = "e", ["ê"] = "e", ["à"] = "a", ["â"] = "a", ["ô"] = "o", ["î"] = "i", ["û"] = "u", ["ç"] = "c", ["œ"] = "oe" }) do s = s:gsub(a, b) end
  return (s:gsub("[^%w]", ""))
end

-- Message découpé pour le chat (255 caractères au plus), sur les séparateurs « · »
function RA.Chunks(text, max)
  max = max or 250
  local out, cur = {}, ""
  for part in (text .. " · "):gmatch("(.-) · ") do
    local add = cur == "" and part or (cur .. " · " .. part)
    if #add > max and cur ~= "" then out[#out + 1] = cur cur = part else cur = add end
  end
  if cur ~= "" then out[#out + 1] = cur end
  return out
end
function RA.Say(text)
  if RA.test then -- raid d'essai : dans ta fenêtre de chat seulement
    for _, line in ipairs(RA.Chunks(text)) do ns.print("|cff9aa3b6[essai]|r " .. line) end
    return
  end
  local ch = channel()
  for _, line in ipairs(RA.Chunks(text)) do
    if ch and SendChatMessage then SendChatMessage(line, ch) else ns.print(line) end
  end
end
local function isLeader()
  if RA.test then return true end
  if not (IsInGroup and IsInGroup()) then return true end
  return (UnitIsGroupLeader and UnitIsGroupLeader("player")) or (UnitIsGroupAssistant and UnitIsGroupAssistant("player")) or false
end
RA.isLeader = isLeader

-- Membres du groupe de raid (ou du groupe), prénoms seuls
function RA.Members()
  if RA.test then return { unpack(RA.test.members) } end
  local out = {}
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do
      local n = GetRaidRosterInfo(i)
      if n then out[#out + 1] = short(n) end
    end
  else
    out[1] = me()
    for i = 1, (GetNumSubgroupMembers and GetNumSubgroupMembers() or 0) do
      local n = UnitName("party" .. i)
      if n then out[#out + 1] = short(n) end
    end
  end
  return out
end
local function inGroup(name)
  for _, n in ipairs(RA.Members()) do if n == name then return true end end
  return false
end
local function unitFor(name)
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do
      if short(GetRaidRosterInfo(i)) == name then return "raid" .. i end
    end
  end
  for i = 1, 4 do if UnitName("party" .. i) == name then return "party" .. i end end
  return nil
end

-- Raid du site en cours (le relevé, sinon le raid chargé le plus proche dans le temps) et ses données
function RA.Current()
  if RA.test then return RA.test.data end
  local e
  local log = ns.Recorder.Current()
  if log then for _, x in ipairs(ns.Group.Raids()) do if x.raid.id == log.raidId then e = x end end end
  e = e or ns.Recorder.SiteRaid(time())
  return ns.Group.RaidData(e)
end

--------------------------------------------------------------------------------------------------------------------
-- Messages entre addons (même groupe de raid). Champs séparés par « ; », 255 caractères au plus.
--------------------------------------------------------------------------------------------------------------------
local handlers = {}
local function send(msg, dist, target)
  local api = (C_ChatInfo and C_ChatInfo.SendAddonMessage) or SendAddonMessage
  dist = dist or channel()
  if not api or not dist then return false end
  if dist == "WHISPER" and target == me() then -- à soi-même : traité tout de suite
    local f = ns.Format.split(msg)
    if handlers[f[1]] then ns.safe("message", handlers[f[1]], me(), f, "WHISPER") end
    return true
  end
  if RA.test then return RA.test.send(msg, dist, target) end
  return (pcall(api, PREFIX, msg, dist, target))
end
-- Message reçu d'un joueur (raid d'essai : réponses simulées des autres addons)
function RA.Deliver(sender, msg, dist)
  local f = ns.Format.split(msg)
  if handlers[f[1]] then ns.safe("message", handlers[f[1]], sender, f, dist or "RAID") end
end
ns.on("PLAYER_LOGIN", function()
  local reg = (C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix) or RegisterAddonMessagePrefix
  if reg then pcall(reg, PREFIX) end
end)
ns.on("CHAT_MSG_ADDON", function(prefix, text, dist, sender)
  if prefix ~= PREFIX or type(text) ~= "string" then return end
  local f = ns.Format.split(text)
  if handlers[f[1]] then handlers[f[1]](short(sender), f, dist) end
end)

--------------------------------------------------------------------------------------------------------------------
-- Qui a l'addon (et quelle version)
--------------------------------------------------------------------------------------------------------------------
RA.versions = {}
local function versionKey(v)
  local a, b, c = tostring(v or ""):match("^(%d+)%.(%d+)%.?(%d*)")
  return (tonumber(a) or 0) * 10000 + (tonumber(b) or 0) * 100 + (tonumber(c) or 0)
end
function RA.AskVersions(force)
  if not channel() then return end
  if not force and RA.askedAt and time() - RA.askedAt < 30 then return end
  RA.askedAt = time()
  send("VQ")
end
handlers.VQ = function() send("VR;" .. ns.version) end
handlers.VR = function(sender, f) RA.versions[sender] = { v = f[2] or "?", at = time() } refresh() end
-- Membres et leur version : ok, ancienne, absente (pas de réponse 5 s après la question), en attente
function RA.VersionRows()
  local rows, mine = {}, versionKey(ns.version)
  for _, n in ipairs(RA.Members()) do
    local v = n == me() and { v = ns.version } or RA.versions[n]
    local state = v and (versionKey(v.v) >= mine and "ok" or "old") or ((RA.askedAt and time() - RA.askedAt >= 5) and "none" or "wait")
    rows[#rows + 1] = { name = n, v = v and v.v, state = state }
  end
  return rows
end
local inRaid = false
ns.on("GROUP_ROSTER_UPDATE", function()
  local now = IsInRaid and IsInRaid() or false
  if now and not inRaid then C_Timer.After(3, function() RA.AskVersions() end) end
  inRaid = now
end)

--------------------------------------------------------------------------------------------------------------------
-- Consommables : appel en raid (chaque addon répond avec ses sacs), gardé avec le bilan
--------------------------------------------------------------------------------------------------------------------
function RA.CallConsumables()
  local d = RA.Current()
  local list = d and d.consumables or {}
  if #list == 0 then ns.print("aucun consommable demandé pour ce raid : sur le site, page du raid, onglet Préparation.") return false end
  if not channel() then ns.print("l'appel aux consommables se fait en groupe ou en raid.") return false end
  local ids = {}
  for _, c in ipairs(list) do ids[#ids + 1] = c.itemId end
  RA.call = { at = time(), by = me(), ids = ids, counts = {}, open = true, raidId = d.entry.raid.id }
  for _, n in ipairs(RA.Members()) do RA.call.counts[n] = false end
  send("CQ;" .. table.concat(ids, ","))
  C_Timer.After(8, function() RA.CloseCall() end)
  ns.print("appel aux consommables lancé : réponses dans l'onglet En raid.")
  refresh()
  return true
end
handlers.CQ = function(sender, f)
  local parts = {}
  for id in tostring(f[2] or ""):gmatch("%d+") do
    if #parts < 30 then parts[#parts + 1] = id .. ":" .. ((GetItemCount and GetItemCount(tonumber(id), true)) or 0) end
  end
  send("CR;" .. table.concat(parts, ","), "WHISPER", sender)
end
handlers.CR = function(sender, f)
  if not RA.call then return end
  local c = {}
  for id, n in tostring(f[2] or ""):gmatch("(%d+):(%d+)") do c[tonumber(id)] = tonumber(n) end
  RA.call.counts[sender] = c
  if not RA.call.open and not RA.test then ns.Recorder.SetCall({ at = RA.call.at, by = RA.call.by, counts = RA.call.counts }) end
  refresh()
end
function RA.CloseCall()
  if not RA.call then return end
  RA.call.open = false
  if not RA.test then ns.Recorder.SetCall({ at = RA.call.at, by = RA.call.by, counts = RA.call.counts }) end
  refresh()
end
-- Résumé de l'appel : prêts, incomplets (ce qui manque), sans réponse
function RA.CallSummary()
  local d, call = RA.Current(), RA.call
  if not call or not d then return nil end
  local out = { ready = {}, missing = {}, silent = {} }
  local names = {}
  for n in pairs(call.counts) do names[#names + 1] = n end
  table.sort(names)
  for _, n in ipairs(names) do
    local c = call.counts[n]
    if not c then out.silent[#out.silent + 1] = n
    else
      local lacks = {}
      for _, line in ipairs(d.consumables) do
        if ns.Format.Concerns(line.target, d.roster[n]) and (c[line.itemId] or 0) < line.n then
          lacks[#lacks + 1] = (line.name ~= "" and line.name or ("objet " .. line.itemId)) .. " " .. (c[line.itemId] or 0) .. "/" .. line.n
        end
      end
      if #lacks > 0 then out.missing[#out.missing + 1] = { name = n, lacks = lacks } else out.ready[#out.ready + 1] = n end
    end
  end
  return out
end
function RA.AnnounceMissing()
  local s = RA.CallSummary()
  if not s then return end
  local parts = {}
  for _, m in ipairs(s.missing) do parts[#parts + 1] = m.name .. " (" .. table.concat(m.lacks, ", ") .. ")" end
  if #parts > 0 then RA.Say("Consommables manquants : " .. table.concat(parts, " · ")) end
  if #s.silent > 0 then RA.Say("Pas de réponse (addon absent) : " .. table.concat(s.silent, ", ")) end
  if #parts == 0 and #s.silent == 0 then RA.Say("Consommables : tout le monde est prêt.") end
end

--------------------------------------------------------------------------------------------------------------------
-- Fiches de boss : en ciblant le boss, avant le pull ; fermées au début du combat. Le PNJ est appris au 1er combat.
--------------------------------------------------------------------------------------------------------------------
local function npcOf(unit)
  local guid = UnitGUID and UnitGUID(unit)
  local kind, id = tostring(guid or ""):match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)")
  if kind == "Creature" or kind == "Vehicle" then return tonumber(id) end
  return nil
end
function RA.Sheets()
  local d = RA.Current()
  local out = {}
  for _, s in pairs(d and d.bosses or {}) do if #s.rows > 0 then out[#out + 1] = s end end
  table.sort(out, function(a, b) return (a.name or "") < (b.name or "") end)
  return out
end
function RA.SheetFor(unit)
  local npc, name = npcOf(unit), UnitName and UnitName(unit)
  if RA.test then return npc and RA.test.sheet or nil end -- raid d'essai : n'importe quel PNJ joue Ragnaros
  if not npc and not name then return nil end
  local learned, names = db("bossNpcs"), db("bossNames")
  for _, s in ipairs(RA.Sheets()) do
    for _, id in ipairs(s.npcIds or {}) do if id == npc then return s end end
    if npc and s.encounterId and learned[npc] == s.encounterId then return s end
    if name and ((s.encounterId and names[s.encounterId] == name) or norm(s.name) == norm(name)) then return s end
  end
  return nil
end
-- Ce que le joueur doit faire sur ce boss (intitulés des lignes où il figure)
function RA.MyTasks(sheet, who)
  who = who or me()
  local out = {}
  for _, r in ipairs(sheet.rows) do
    for _, n in ipairs(r.names) do if n == who then out[#out + 1] = r.label ~= "" and r.label or "ta tâche" end end
  end
  return out
end
function RA.SheetLines(sheet, skipMine)
  local out = {}
  for _, r in ipairs(sheet.rows) do
    local who = table.concat(r.names, ", ")
    local value = who ~= "" and who or ""
    if r.text ~= "" then value = value ~= "" and (value .. " (" .. r.text .. ")") or r.text end
    out[#out + 1] = { label = r.label, value = value }
  end
  return out
end
function RA.AnnounceSheet(sheet)
  local parts = {}
  for _, l in ipairs(RA.SheetLines(sheet)) do parts[#parts + 1] = (l.label ~= "" and (l.label .. " : ") or "") .. l.value end
  RA.Say(sheet.name .. " · " .. table.concat(parts, " · "))
end
RA.dismissed = {}
ns.on("PLAYER_TARGET_CHANGED", function()
  if (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player")) then return end
  if UnitIsDead and UnitIsDead("target") then return end
  local s = RA.SheetFor("target")
  if not s then return end
  if RA.dismissed[s.name] and time() - RA.dismissed[s.name] < 300 then return end
  if RA.ShowSheet then RA.ShowSheet(s) end
end)
-- Début du combat : la fiche se ferme ; le boss (PNJ, nom dans la langue du client) est retenu pour la suite
ns.on("ENCOUNTER_START", function(encounterId, name)
  if RA.HideSheet then RA.HideSheet() end
  if not encounterId or RA.test then return end
  local learned = db("bossNpcs")
  for i = 1, 5 do local id = npcOf("boss" .. i) if id then learned[id] = encounterId end end
  local t = npcOf("target")
  if t and UnitCanAttack and UnitCanAttack("player", "target") then learned[t] = learned[t] or encounterId end
  if name then db("bossNames")[encounterId] = name end
end)
ns.on("PLAYER_REGEN_DISABLED", function() if RA.HideSheet then RA.HideSheet() end end)

--------------------------------------------------------------------------------------------------------------------
-- Butin : fenêtre du maître du butin, jets (SR avec bonus, MS / OS, libre), conseil, objets à remettre
--------------------------------------------------------------------------------------------------------------------
local QUALITY = { ff8000 = 5, a335ee = 4, ["0070dd"] = 3, ["1eff00"] = 2, ffffff = 1, ["9d9d9d"] = 0 }
local function qualityOf(link) return QUALITY[(tostring(link or ""):match("|cff(%x%x%x%x%x%x)") or ""):lower()] or 0 end
local function itemId(link) return tonumber(tostring(link or ""):match("item:(%d+)")) end

function RA.IsMasterLooter()
  if RA.test then return true end
  if IsMasterLooter then local ok, r = pcall(IsMasterLooter) if ok and r ~= nil then return r and true or false end end
  if not GetLootMethod then return false end
  local method, partyIdx, raidIdx = GetLootMethod()
  if method ~= "master" then return false end
  if IsInRaid and IsInRaid() then return raidIdx ~= nil and UnitIsUnit ~= nil and UnitIsUnit("raid" .. raidIdx, "player") end
  return partyIdx == 0
end

RA.items = {} -- objets proposés : { itemId, link, slot (sur le corps) ou nil (dans les sacs) }
-- Objets du corps ouvert, au-dessus du seuil de qualité du relevé (épique par défaut)
function RA.ReadLoot()
  local items, min = {}, ns.Recorder.MinQuality()
  for slot = 1, (GetNumLootItems and GetNumLootItems() or 0) do
    local link = GetLootSlotLink and GetLootSlotLink(slot)
    local id = itemId(link)
    if id and qualityOf(link) >= min then items[#items + 1] = { itemId = id, link = link, slot = slot } end
  end
  return items
end
ns.on("LOOT_OPENED", function()
  if RA.test or not RA.IsMasterLooter() then return end
  local items = RA.ReadLoot()
  if #items == 0 then return end
  -- Les objets déjà dans la liste (corps rouvert) gardent leur place ; ceux d'un autre corps remplacent la liste
  RA.items = items
  if RA.ShowLoot then RA.ShowLoot() end
end)
ns.on("LOOT_CLOSED", function() for _, it in ipairs(RA.items) do it.slot = nil end refresh() end)
ns.on("LOOT_SLOT_CLEARED", function(slot)
  for i = #RA.items, 1, -1 do if RA.items[i].slot == slot and not (RA.session and RA.session.item == RA.items[i]) then table.remove(RA.items, i) end end
  refresh()
end)
-- Objet ajouté à la main (lien), par ex. ramassé hors butin de maître : distribué ensuite par échange
function RA.AddItem(link)
  local id = itemId(link)
  if not id then return false end
  table.insert(RA.items, 1, { itemId = id, link = link })
  return true
end

-- Réservations de l'objet pour le raid en cours : { [nom] = bonus }
function RA.ReservesOf(id)
  local d = RA.Current()
  local list = d and d.reserves[id]
  if not list or #list == 0 then return nil end
  local out = {}
  for _, x in ipairs(list) do out[x.name] = x.bonus or 0 end
  return out, list
end

local parseRoll
local function rollParser()
  parseRoll = parseRoll or ns.Format.RollParser(RANDOM_ROLL_RESULT)
  return parseRoll
end
-- Jets : kind = "sr" (réservants seulement, bonus ajouté), "ms" (/roll 100), "os" (/roll 99), "free" (/roll 100, tout le monde)
function RA.StartRoll(item, kind, only)
  local eligible = nil
  if kind == "sr" then eligible = RA.ReservesOf(item.itemId) if not eligible then return false end end
  if only then -- relance entre ex æquo
    local e = {}
    for _, n in ipairs(only) do e[n] = eligible and eligible[n] or 0 end
    eligible = e
  end
  RA.session = { item = item, kind = kind, max = kind == "os" and 99 or 100, eligible = eligible, rolls = {}, ignored = {}, at = time(), reroll = only ~= nil }
  local link = sayLink(item)
  if kind == "sr" then
    local names = {}
    for n, b in pairs(eligible) do names[#names + 1] = n .. (b > 0 and (" (+" .. b .. ")") or "") end
    table.sort(names)
    RA.Say(link .. (only and " : égalité, relance entre " or " réservé (SR) par ") .. table.concat(names, ", ") .. " · /roll 100, bonus SR+ ajouté")
  elseif kind == "ms" then RA.Say(link .. " : jets en spé principale (MS) · /roll 100")
  elseif kind == "os" then RA.Say(link .. " : jets en spé secondaire (OS) · /roll 99")
  else RA.Say(link .. (only and (" : égalité, relance entre " .. table.concat(only, ", ")) or " : jet libre") .. " · /roll 100") end
  refresh()
  return true
end
function RA.OnRoll(name, roll, lo, hi)
  local s = RA.session
  if not s or s.kind == "council" or not name then return end
  if lo ~= 1 or hi ~= s.max then return end -- mauvais dé (ex. /roll 99 pendant les jets MS)
  if s.eligible and s.eligible[name] == nil then s.ignored[name] = s.ignored[name] or roll refresh() return end
  if s.rolls[name] then return end -- seul le premier jet compte
  local bonus = (s.kind == "sr" and s.eligible and s.eligible[name]) or 0
  s.rolls[name] = { roll = roll, bonus = bonus, total = roll + bonus }
  refresh()
end
ns.on("CHAT_MSG_SYSTEM", function(msg)
  if not RA.session then return end
  RA.OnRoll(rollParser()(msg))
end)
-- Classement : plus haut total d'abord ; tied = ex æquo en tête (au moins 2)
function RA.Ranking(s)
  s = s or RA.session
  local list = {}
  for n, r in pairs(s and s.rolls or {}) do list[#list + 1] = { name = n, roll = r.roll, bonus = r.bonus, total = r.total } end
  table.sort(list, function(a, b) if a.total ~= b.total then return a.total > b.total end return a.name < b.name end)
  local tied = {}
  for _, x in ipairs(list) do if x.total == list[1].total then tied[#tied + 1] = x.name end end
  return list, #tied > 1 and tied or nil
end

-- Candidat du butin de maître pour ce joueur (index de GetMasterLootCandidate)
local function candidate(slot, name)
  if not GetMasterLootCandidate then return nil end
  for i = 1, 40 do
    local c = GetMasterLootCandidate(slot, i)
    if c and short(c) == name then return i end
  end
  return nil
end
local function stillThere(item)
  return item.slot and GetLootSlotLink and itemId(GetLootSlotLink(item.slot)) == item.itemId
end
-- Donner l'objet : par le butin de maître si le corps est ouvert, sinon il part dans les objets à remettre
function RA.Give(item, winner, method, response, detail)
  local link = sayLink(item)
  local idx = stillThere(item) and candidate(item.slot, winner)
  if RA.test then -- raid d'essai : le corps est « ouvert », l'objet est donné (rien n'est noté pour le site)
    RA.test.award(item, winner, method, detail)
  elseif idx and GiveMasterLoot then
    ns.Recorder.Award(item.itemId, winner, method, response, detail)
    GiveMasterLoot(item.slot, idx)
  else
    ns.Recorder.Award(item.itemId, winner, method, response, detail)
    if winner ~= me() then RA.AddHandover(item, winner, method, response, detail) end
  end
  RA.Say(link .. " pour " .. winner .. (detail and detail ~= "" and (" (" .. detail .. ")") or ""))
  for i = #RA.items, 1, -1 do if RA.items[i] == item then table.remove(RA.items, i) end end
  if RA.session and RA.session.item == item then RA.session = nil end
  refresh()
end
-- Garder l'objet (le maître du butin le prend) pour le remettre plus tard par échange
function RA.Keep(item, winner, method, response, detail)
  local idx = not RA.test and stillThere(item) and candidate(item.slot, me())
  if idx and GiveMasterLoot then GiveMasterLoot(item.slot, idx) end
  if winner then RA.AddHandover(item, winner, method, response, detail) end
  for i = #RA.items, 1, -1 do if RA.items[i] == item then table.remove(RA.items, i) end end
  if RA.session and RA.session.item == item then RA.session = nil end
  refresh()
end
-- Attribuer selon les jets de la session en cours
function RA.AwardSession()
  local s = RA.session
  if not s then return end
  local list, tied = RA.Ranking(s)
  if #list == 0 or tied then return end
  local w = list[1]
  RA.Give(s.item, w.name, s.kind == "sr" and "sr" or "roll", nil, RA.RollDetail(s, w))
end
-- Détail noté avec l'objet : « 61 +20 = 81 » (SR), « MS 87 », « jet 54 »
function RA.RollDetail(s, w)
  if s.kind == "sr" then return w.bonus > 0 and (w.roll .. " +" .. w.bonus .. " = " .. w.total) or tostring(w.roll) end
  return (s.kind == "free" and "jet " or (s.kind:upper() .. " ")) .. w.roll
end

-- Objets à remettre (gardés par le maître du butin) : échange possible pendant 2 h après le ramassage
local function handoverList() return RA.test and RA.test.handover or db("handover") end
function RA.AddHandover(item, winner, method, response, detail)
  local list = handoverList()
  list[#list + 1] = { itemId = item.itemId, link = item.link, name = item.name, quality = item.quality, winner = winner, method = method, response = response, detail = detail, at = time() }
end
function RA.Handover()
  local list, now = handoverList(), time()
  for i = #list, 1, -1 do if now - list[i].at > TRADE_WINDOW then table.remove(list, i) end end
  return list
end
local function bagSlotOf(id)
  local C = C_Container
  local numSlots = (C and C.GetContainerNumSlots) or GetContainerNumSlots
  local itemAt = (C and C.GetContainerItemID) or GetContainerItemID
  if not (numSlots and itemAt) then return nil end
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    for slot = 1, numSlots(bag) or 0 do if itemAt(bag, slot) == id then return bag, slot end end
  end
  return nil
end
function RA.Trade(entry)
  if RA.test then return RA.test.trade(entry) end
  local unit = unitFor(entry.winner)
  if not unit then ns.print(entry.winner .. " n'est pas dans le groupe.") return false end
  if CheckInteractDistance and not CheckInteractDistance(unit, 2) then ns.print(entry.winner .. " est trop loin pour échanger.") return false end
  RA.trading = entry
  if InitiateTrade then InitiateTrade(unit) end
  return true
end
-- Fenêtre d'échange ouverte : l'objet est posé dans la 1re case ; échange fini : il quitte la liste et change de main
ns.on("TRADE_SHOW", function()
  local e = RA.trading
  if not e then return end
  e.before = GetItemCount and GetItemCount(e.itemId) or 0
  local bag, slot = bagSlotOf(e.itemId)
  local pick = (C_Container and C_Container.PickupContainerItem) or PickupContainerItem
  if bag and pick and ClickTradeButton then pick(bag, slot) ClickTradeButton(1) end
end)
ns.on("TRADE_CLOSED", function()
  local e = RA.trading
  if not e then return end
  C_Timer.After(1, function()
    RA.trading = nil
    local now = GetItemCount and GetItemCount(e.itemId) or 0
    if e.before and now < e.before then
      local list = db("handover")
      for i = #list, 1, -1 do if list[i] == e then table.remove(list, i) end end
      ns.Recorder.Reassign(e.itemId, me(), e.winner, e.method, e.detail)
      ns.print((e.link or ns.Group.displayLink(e.itemId)) .. " remis à " .. e.winner .. ".")
    end
    refresh()
  end)
end)

-- Conseil du butin : le maître du butin propose l'objet, chacun répond (BiS, Upgrade, Off-Spec, Transmo, Passer),
-- les membres du conseil votent. Réponses et votes ne sont envoyés qu'au conseil (et au maître du butin).
RA.councils = {} -- sessions vues par le conseil : [sid] = { itemId, ml, cands = { [nom] = { response, gear, note } }, votes = { [membre] = nom } }
RA.asks = {}     -- objets à qui répondre (joueur) : { sid, itemId, ml, at }
local RESPONSES = { bis = "BiS", upgrade = "Upgrade", off = "Off-Spec", transmo = "Transmo", pass = "Passer" }
RA.RESPONSES = RESPONSES
function RA.CouncilNames()
  local d = RA.Current()
  local out, seen = {}, {}
  for _, n in ipairs(d and d.council or {}) do if not seen[n] and inGroup(n) then seen[n] = true out[#out + 1] = n end end
  return out
end
local function councilTargets(ml)
  local out, seen = {}, {}
  for _, n in ipairs(RA.CouncilNames()) do if not seen[n] then seen[n] = true out[#out + 1] = n end end
  if ml and not seen[ml] then out[#out + 1] = ml end
  return out
end
local function toCouncil(msg, ml) for _, n in ipairs(councilTargets(ml)) do send(msg, "WHISPER", n) end end
function RA.IsCouncil(ml)
  for _, n in ipairs(councilTargets(ml)) do if n == me() then return true end end
  return false
end
function RA.StartCouncil(item)
  local sid = tostring(time() % 100000) .. tostring(item.itemId)
  RA.session = { item = item, kind = "council", sid = sid, rolls = {}, at = time() }
  RA.councils[sid] = { itemId = item.itemId, link = item.link, name = item.name, quality = item.quality, ml = me(), cands = {}, votes = {}, at = time() }
  send("LO;" .. sid .. ";" .. item.itemId)
  RA.Say(sayLink(item) .. " : conseil du butin · réponds dans la fenêtre de l'addon (ou chuchote bis, up, os au maître du butin)")
  if RA.ShowCouncil then RA.ShowCouncil(sid) end
  refresh()
end
handlers.LO = function(sender, f)
  local sid, id = f[2], tonumber(f[3])
  if not sid or not id then return end
  RA.asks[#RA.asks + 1] = { sid = sid, itemId = id, ml = sender, at = time() }
  if RA.IsCouncil(sender) then
    RA.councils[sid] = RA.councils[sid] or { itemId = id, ml = sender, cands = {}, votes = {}, at = time() }
    if RA.ShowCouncil then RA.ShowCouncil(sid) end
  end
  if RA.ShowAsk then RA.ShowAsk() end
end
-- Objets portés au même emplacement (pour comparer)
local SLOTS = {
  INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CHEST = { 5 }, INVTYPE_ROBE = { 5 }, INVTYPE_WAIST = { 6 },
  INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 }, INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 }, INVTYPE_TRINKET = { 13, 14 },
  INVTYPE_CLOAK = { 15 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_SHIELD = { 17 }, INVTYPE_2HWEAPON = { 16 }, INVTYPE_WEAPONMAINHAND = { 16 },
  INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_HOLDABLE = { 17 }, INVTYPE_RANGED = { 18 }, INVTYPE_THROWN = { 18 }, INVTYPE_RANGEDRIGHT = { 18 }, INVTYPE_RELIC = { 18 },
}
function RA.Equipped(id)
  local loc = GetItemInfoInstant and select(4, GetItemInfoInstant(id))
  local out = {}
  for _, slot in ipairs(SLOTS[loc or ""] or {}) do local e = GetInventoryItemID and GetInventoryItemID("player", slot) if e then out[#out + 1] = e end end
  return out
end
function RA.Respond(ask, response, note)
  local gear = table.concat(RA.Equipped(ask.itemId), ",")
  toCouncil("LA;" .. ask.sid .. ";" .. response .. ";" .. gear .. ";" .. ns.Format.clean(note or ""):sub(1, 80), ask.ml)
  for i = #RA.asks, 1, -1 do if RA.asks[i] == ask then table.remove(RA.asks, i) end end
  refresh()
end
handlers.LA = function(sender, f)
  local c = RA.councils[f[2] or ""]
  if not c or not RESPONSES[f[3] or ""] then return end
  local gear = {}
  for id in tostring(f[4] or ""):gmatch("%d+") do gear[#gear + 1] = tonumber(id) end
  c.cands[sender] = { response = f[3], gear = gear, note = f[5] or "" }
  refresh()
end
-- Réponse chuchotée par un joueur sans addon (« bis », « up », « os », « transmo ») au maître du butin
local WHISPERED = { bis = "bis", up = "upgrade", upgrade = "upgrade", os = "off", off = "off", transmo = "transmo", pass = "pass", passe = "pass" }
ns.on("CHAT_MSG_WHISPER", function(msg, sender)
  local s = RA.session
  if not s or s.kind ~= "council" then return end
  local r = WHISPERED[strtrim and strtrim(tostring(msg)):lower() or tostring(msg):lower()]
  if r then handlers.LA(short(sender), { "LA", s.sid, r, "", "chuchoté" }) end
end)
function RA.Vote(sid, cand)
  local c = RA.councils[sid]
  if not c then return end
  local v = c.votes[me()] == cand and "" or cand
  toCouncil("LV;" .. sid .. ";" .. v, c.ml)
end
handlers.LV = function(sender, f)
  local c = RA.councils[f[2] or ""]
  if not c then return end
  c.votes[sender] = (f[3] or "") ~= "" and f[3] or nil
  refresh()
end
-- Voix par candidat, et qui a voté pour qui
function RA.Tally(sid)
  local c = RA.councils[sid]
  local n, by = {}, {}
  for voter, cand in pairs(c and c.votes or {}) do n[cand] = (n[cand] or 0) + 1 by[#by + 1] = voter .. " pour " .. cand end
  table.sort(by)
  return n, by
end
function RA.AwardCouncil(sid, winner)
  local c = RA.councils[sid]
  local s = RA.session
  if not c or not s or s.sid ~= sid then return end
  local votes = RA.Tally(sid)[winner] or 0
  local cand = c.cands[winner]
  send("LC;" .. sid .. ";" .. winner)
  RA.Give(s.item, winner, "council", cand and cand.response ~= "pass" and cand.response or nil, votes .. " voix")
  RA.councils[sid] = nil
end
handlers.LC = function(_, f)
  RA.councils[f[2] or ""] = nil
  for i = #RA.asks, 1, -1 do if RA.asks[i].sid == f[2] then table.remove(RA.asks, i) end end
  refresh()
end

return RA
