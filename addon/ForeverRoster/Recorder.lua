-- Relevé du raid : pendant un raid prévu sur le site (données chargées en jeu), l'addon note chaque minute qui est dans
-- le groupe de raid, et le butin de qualité épique ou plus (réglable). Le bilan (bloc FRB) part au site avec la
-- synchro habituelle ; seul celui d'un officier du groupe y est enregistré. Rien à faire pendant le raid.
local _, ns = ...
local R = {}
ns.Recorder = R

local KEEP_DAYS = 30
local QUALITY = { ff8000 = 5, a335ee = 4, ["0070dd"] = 3, ["1eff00"] = 2, ffffff = 1 }
R.QUALITY_LABEL = { [2] = "Inhabituel", [3] = "Rare", [4] = "Épique", [5] = "Légendaire" }

local function db()
  ForeverRosterDB.raidLogs = ForeverRosterDB.raidLogs or {}
  return ForeverRosterDB.raidLogs
end
local function short(name) return (tostring(name or ""):match("^[^%-]+")) or "" end

function R.Enabled() return not ForeverRosterDB.noRecord end
function R.MinQuality() return ForeverRosterDB.lootQuality or 4 end
function R.Current() return R.current and db()[R.current] or nil end

-- Raid du site en cours : un raid chargé dont l'heure prévue est passée depuis moins de 3 h, ou dans moins de 2 h
function R.SiteRaid(now)
  local best, bestGap
  for _, e in ipairs(ns.Group.Raids()) do
    local t = e.raid.time or 0
    if t > 0 and now >= t - 2 * 3600 then
      local gap = math.abs(now - t)
      if not bestGap or gap < bestGap then best, bestGap = e, gap end
    end
  end
  return best
end

local function stop(msg)
  local log = R.Current()
  R.current = nil
  if log and msg then ns.print(msg) end
  if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
end

-- Un relevé : qui est dans le groupe de raid en ce moment
function R.Sample()
  if not R.Enabled() or not IsInRaid() then
    stop(R.current and ("relevé du raid terminé : il part au site avec ta prochaine synchro (ta touche, Ctrl+C)."))
    return
  end
  local now = time()
  local log = R.Current()
  if not log then
    local e = R.SiteRaid(now)
    if not e then return end
    log = db()[e.raid.id]
    if not log then
      log = { raidId = e.raid.id, name = e.raid.name, group = e.group.id, start = now, people = {}, loot = {} }
      db()[e.raid.id] = log
    end
    R.current = e.raid.id
    ns.print("relevé du raid démarré : |cffe3b54b" .. (log.name or "raid") .. "|r (présence et butin, envoyés avec ta synchro). Onglet Options pour le couper.")
  end
  log.recorder = UnitName("player")
  -- Instance réelle (bilan v2) : nom donné par le jeu, pour le catalogue de butin du site
  if GetInstanceInfo then
    local inst, kind = GetInstanceInfo()
    if kind == "raid" and inst and inst ~= "" then log.instance = inst end
  end
  for i = 1, GetNumGroupMembers() do
    local name = short(GetRaidRosterInfo(i))
    if name ~= "" then
      local p = log.people[name]
      if not p then p = { first = now, last = now, n = 0 } log.people[name] = p end
      p.last, p.n = now, p.n + 1
    end
  end
  log.stop, log.updated = now, now
  if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
end

-- Butin vu dans le chat pendant le relevé (le sien et celui des autres)
function R.OnLoot(msg, playerName, _, _, playerName2)
  local log = R.Current()
  if not log or type(msg) ~= "string" then return end
  local color, id = msg:match("|cff(%x%x%x%x%x%x)|Hitem:(%d+)")
  id = tonumber(id)
  if not id or (QUALITY[(color or ""):lower()] or 0) < R.MinQuality() then return end
  local who = short((playerName2 ~= nil and playerName2 ~= "" and playerName2) or (playerName ~= nil and playerName ~= "" and playerName) or UnitName("player"))
  local boss = (R.boss and time() - R.boss.at < 15 * 60) and R.boss.name or ""
  local entry = { id = id, who = who, at = time(), boss = boss }
  -- Attribution décidée dans la fenêtre du butin (jets SR, MS/OS, conseil) : notée avec l'objet
  local key = id .. ":" .. who
  local award = R.awards[key]
  if award and time() - award.at < 10 * 60 then entry.method, entry.response, entry.detail = award.method, award.response, award.detail R.awards[key] = nil end
  log.loot[#log.loot + 1] = entry
  log.updated = time()
  if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
end

-- Attributions en attente (objet:joueur → méthode, réponse, détail) : jointes au butin quand le jeu l'annonce
R.awards = {}
function R.Award(itemId, who, method, response, detail)
  R.awards[itemId .. ":" .. short(who)] = { method = method, response = response, detail = detail, at = time() }
end
-- Objet gardé par le maître du butin puis échangé au gagnant : le butin noté change de main
function R.Reassign(itemId, from, to, method, detail)
  local log = R.Current() or R.Last()
  if not log then return false end
  for i = #log.loot, 1, -1 do
    local l = log.loot[i]
    if l.id == itemId and l.who == short(from) then
      l.who, l.method, l.detail = short(to), method or l.method, detail or l.detail
      log.updated = time()
      return true
    end
  end
  return false
end
-- Dernier bilan (raid fini depuis peu) : un échange après la fin du relevé y est encore noté
function R.Last()
  local best
  for _, log in pairs(db()) do if not best or (log.stop or 0) > (best.stop or 0) then best = log end end
  return best and time() - (best.stop or 0) < 3 * 3600 and best or nil
end

-- Appel aux consommables lancé en raid : gardé avec le bilan (lignes Q et K), le dernier remplace le précédent
function R.SetCall(call)
  local log = R.Current()
  if not log then return false end
  log.call, log.updated = call, time()
  return true
end

-- Bilans pas encore envoyés au site (ou modifiés depuis)
function R.Pending()
  local out = {}
  for _, log in pairs(db()) do
    if (log.updated or 0) > (log.sentAt or 0) and next(log.people) then out[#out + 1] = log end
  end
  table.sort(out, function(a, b) return (a.start or 0) < (b.start or 0) end)
  return out
end
function R.Recent(days)
  local out, since = {}, time() - (days or 3) * 86400
  for _, log in pairs(db()) do if (log.stop or 0) >= since and next(log.people) then out[#out + 1] = log end end
  table.sort(out, function(a, b) return (a.start or 0) < (b.start or 0) end)
  return out
end
function R.MarkSent(logs)
  for _, log in ipairs(logs or {}) do log.sentAt = log.updated or time() end
end

-- Bloc FRB d'un bilan (version 2 : instance réelle, attribution de chaque objet, appel aux consommables)
function R.Block(log)
  local F = ns.Format
  local lines = { "FRB;2;" .. F.clean(log.raidId) .. ";" .. (log.start or 0) .. ";" .. (log.stop or log.start or 0) .. ";" .. F.clean(log.recorder) .. ";" .. F.clean(log.name) .. ";" .. F.clean(log.instance) }
  local names = {}
  for name in pairs(log.people) do names[#names + 1] = name end
  table.sort(names)
  for _, name in ipairs(names) do
    local p = log.people[name]
    lines[#lines + 1] = "A;" .. F.clean(name) .. ";" .. p.first .. ";" .. p.last .. ";" .. p.n
  end
  for _, l in ipairs(log.loot) do
    local line = "L;" .. l.id .. ";" .. F.clean(l.who) .. ";" .. l.at .. ";" .. F.clean(l.boss)
    if l.method then line = line .. ";" .. F.clean(l.method) .. ";" .. F.clean(l.response) .. ";" .. F.clean(l.detail) end
    lines[#lines + 1] = line
  end
  -- Hors du compte de END : appel aux consommables (un site plus ancien ignore ces lignes)
  if log.call then
    lines[#lines + 1] = "Q;" .. (log.call.at or 0) .. ";" .. F.clean(log.call.by)
    local who = {}
    for name in pairs(log.call.counts or {}) do who[#who + 1] = name end
    table.sort(who)
    for _, name in ipairs(who) do
      local c, items = log.call.counts[name], {}
      if c then
        local idList = {}
        for id in pairs(c) do idList[#idList + 1] = id end
        table.sort(idList)
        for _, id in ipairs(idList) do items[#items + 1] = id .. ":" .. c[id] end
      end
      lines[#lines + 1] = "K;" .. F.clean(name) .. ";" .. (c and table.concat(items, ",") or "-")
    end
  end
  lines[#lines + 1] = "END;" .. (#names + #log.loot)
  return table.concat(lines, "\n")
end

function R.Prune()
  local limit = time() - KEEP_DAYS * 86400
  for id, log in pairs(db()) do if (log.stop or log.start or 0) < limit then db()[id] = nil end end
end

-- Relevé chaque minute ; aussi dès que le groupe change (début de raid), au plus une fois toutes les 10 s
local lastRoster = 0
local function tick() ns.safe("relevé du raid", R.Sample) end
ns.on("PLAYER_LOGIN", function()
  ns.safe("relevé du raid", R.Prune)
  if C_Timer.NewTicker then C_Timer.NewTicker(60, tick) else
    local function loop() tick() C_Timer.After(60, loop) end
    C_Timer.After(60, loop)
  end
end)
ns.on("GROUP_ROSTER_UPDATE", function()
  if time() - lastRoster < 10 then return end
  lastRoster = time()
  tick()
end)
ns.on("CHAT_MSG_LOOT", function(...) ns.safe("butin", R.OnLoot, ...) end)
-- Dernier boss vaincu : noté avec le butin des 15 minutes qui suivent
ns.on("ENCOUNTER_END", function(_, name, _, _, success)
  if success == 1 or success == true then R.boss = { name = tostring(name or ""), at = time() } end
end)
