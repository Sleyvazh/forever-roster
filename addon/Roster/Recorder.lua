-- Relevé du raid : pendant un raid prévu sur le site (données chargées en jeu, de 2 h avant l'heure prévue à 3 h après),
-- dans un groupe de raid, l'addon note chaque minute qui est là, le butin de qualité épique ou plus vu dans le chat
-- (réglable), chaque fin de rencontre, l'instance et sa difficulté. Le bilan (bloc RRB) part avec la synchro ; le site
-- ne l'enregistre que d'un officier du groupe ou du créateur du raid. Rien à faire pendant le raid.
local _, ns = ...
local R = {}
ns.Recorder = R
local F = ns.Format

local KEEP_DAYS, KEEP_LOGS, BOSS_WINDOW = 14, 10, 15 * 60
R.MAX_HOURS = 6
local secret, usable = F.secret, F.usable
local function db() return ns.db and ns.db() end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function minimap() if ns.Minimap and ns.Minimap.Update then ns.safe("minicarte", ns.Minimap.Update) end end
local function logs()
  local d = db()
  if not d then return {} end
  d.logs = d.logs or {}
  return d.logs
end
local DIFFICULTY = { [14] = "normal", [15] = "heroic", [16] = "mythic" }
R.DIFFICULTY = DIFFICULTY

function R.Enabled() local d = db() return d ~= nil and d.record ~= false end
function R.MinQuality() local d = db() return (d and tonumber(d.lootQuality)) or 4 end
function R.Current() return R.current and logs()[R.current] or nil end
function R.IsRecording() return R.Current() ~= nil and R.Enabled() and ns.Comm.InRaid() end

local function stop(msg)
  local was = R.current
  R.current = nil
  if was and msg then ns.print(msg) end
  if was then minimap() refresh() end
end

-- 10 relevés au plus, 14 jours
function R.Prune()
  local all, list = logs(), {}
  local limit = time() - KEEP_DAYS * 86400
  for id, log in pairs(all) do
    if (log.stop or log.start or 0) < limit then all[id] = nil else list[#list + 1] = log end
  end
  table.sort(list, function(a, b) return (a.start or 0) > (b.start or 0) end)
  for i = KEEP_LOGS + 1, #list do if list[i].raidId ~= R.current then all[list[i].raidId] = nil end end
end

-- Instance et difficulté du jeu (raid seulement)
local function instance(log)
  if not GetInstanceInfo then return end
  local ok, name, kind, diff = pcall(GetInstanceInfo)
  if not ok or secret(kind) or kind ~= "raid" then return end
  if usable(name) and name ~= "" then log.instance = F.txt(name, 60) end
  if not secret(diff) and DIFFICULTY[diff] then log.difficulty = DIFFICULTY[diff] end
end

-- Un relevé : qui est dans le groupe de raid en ce moment
function R.Sample()
  if not db() then return end
  if not R.Enabled() or not ns.Comm.InRaid() then
    stop("relevé du raid terminé : le bilan part au site avec ta prochaine synchro (onglet Synchro).")
    return
  end
  local now = time()
  local log = R.Current()
  -- Groupe de raid gardé longtemps après le raid : le relevé s'arrête 6 h après l'heure prévue
  if log and (log.raidTime or 0) > 0 and now > log.raidTime + R.MAX_HOURS * 3600 then
    stop("relevé du raid terminé (" .. R.MAX_HOURS .. " h après l'heure prévue) : le bilan part au site avec ta prochaine synchro.")
    return
  end
  if not log then
    local e = ns.Groups.Current(now)
    if not e then return end
    log = logs()[e.raid.id]
    local resumed = log ~= nil
    if not log then
      log = { raidId = e.raid.id, name = e.raid.name, group = e.group.id, raidTime = e.raid.time, start = now, people = {}, loot = {}, encounters = {} }
      logs()[e.raid.id] = log
    end
    R.current = e.raid.id
    R.Prune()
    ns.print((resumed and "relevé du raid repris : " or "relevé du raid démarré : ") .. (log.name or "raid") .. " (présence, boss et butin, envoyés avec ta synchro). Onglet Options pour le couper.")
  end
  log.recorder = ns.Comm.Me()
  -- Chef de raid : celui qui mène le raid au moins la moitié des relevés
  log.ticks = (log.ticks or 0) + 1
  if ns.Comm.IsLeader() then log.leadTicks = (log.leadTicks or 0) + 1 end
  instance(log)
  local list = ns.Comm.Roster()
  for _, m in ipairs(list) do
    if m.name then
      local p = log.people[m.name]
      if not p then p = { first = now, last = now, n = 0 } log.people[m.name] = p end
      p.last, p.n = now, p.n + 1
    end
  end
  log.stop, log.updated = now, now
  minimap()
end

function R.IsLead(log)
  if not log then return false end
  return (log.leadTicks or 0) > 0 and (log.leadTicks or 0) * 2 >= math.max(1, log.ticks or 0)
end

-- Dernier boss vaincu : noté avec le butin des 15 minutes qui suivent
R.boss = nil
function R.OnEncounterEnd(encounterID, name, difficultyID, _, success)
  if secret(encounterID) or secret(success) then return end
  local won = success == 1 or success == true
  local bossName = usable(name) and F.txt(name, 60) or ""
  if won then R.boss = { name = bossName, at = time() } end
  local log = R.Current()
  if not log then return end
  log.encounters = log.encounters or {}
  log.encounters[#log.encounters + 1] = { id = tonumber(encounterID) or 0, name = bossName, at = time(), success = won }
  if not log.difficulty and not secret(difficultyID) and DIFFICULTY[difficultyID] then log.difficulty = DIFFICULTY[difficultyID] end
  log.updated = time()
  refresh()
end

-- Butin vu dans le chat pendant le relevé (le sien et celui des autres), d'après les textes du jeu
local parser
local function parse(msg)
  parser = parser or F.LootParser({ LOOT_ITEM = LOOT_ITEM, LOOT_ITEM_MULTIPLE = LOOT_ITEM_MULTIPLE, LOOT_ITEM_SELF = LOOT_ITEM_SELF, LOOT_ITEM_SELF_MULTIPLE = LOOT_ITEM_SELF_MULTIPLE })
  return parser(msg)
end
local function qualityOf(id)
  if C_Item and C_Item.GetItemQualityByID then
    local ok, q = pcall(C_Item.GetItemQualityByID, id)
    if ok and not secret(q) and type(q) == "number" then return q end
  end
  return nil
end
function R.OnLoot(msg)
  local log = R.Current()
  if not log or not usable(msg) then return end
  local who, id, quality, matched = parse(msg)
  if not matched or not id then return end
  quality = quality or qualityOf(id)
  if not quality or quality < R.MinQuality() then return end
  local full = who and F.FullName(who) or ns.Comm.Me()
  if not full then return end
  local boss = (R.boss and time() - R.boss.at < BOSS_WINDOW) and R.boss.name or ""
  -- Nom tel que le lien le montre (le site n'a pas la base des objets de Retail)
  local name = msg:match("|h%[(.-)%]|h")
  log.loot[#log.loot + 1] = { id = id, who = full, at = time(), boss = boss, name = name }
  log.updated = time()
  minimap()
  refresh()
end

-- Où en est le relevé (onglet En raid) : présents au dernier relevé, arrivés en retard, partis, boss vaincus, butin
function R.Status(log)
  log = log or R.Current()
  if not log then return nil end
  local out = { log = log, present = 0, late = {}, left = {}, bosses = {}, loot = #(log.loot or {}) }
  local ref = (log.raidTime or 0) > 0 and log.raidTime or log.start or 0
  for name, p in pairs(log.people or {}) do
    if p.last == log.stop then out.present = out.present + 1 else out.left[#out.left + 1] = name end
    if p.first > ref + 10 * 60 then out.late[#out.late + 1] = name end
  end
  table.sort(out.late) table.sort(out.left)
  for _, e in ipairs(log.encounters or {}) do if e.success then out.bosses[#out.bosses + 1] = e.name end end
  return out
end

-- Bilans pas encore envoyés au site (ou modifiés depuis), et ceux des derniers jours
function R.Pending()
  local out = {}
  for _, log in pairs(logs()) do
    if (log.updated or 0) > (log.sentAt or 0) and next(log.people or {}) then out[#out + 1] = log end
  end
  table.sort(out, function(a, b) return (a.start or 0) < (b.start or 0) end)
  return out
end
function R.Recent(days)
  local out, since = {}, time() - (days or 3) * 86400
  for _, log in pairs(logs()) do if (log.stop or 0) >= since and next(log.people or {}) then out[#out + 1] = log end end
  table.sort(out, function(a, b) return (a.start or 0) < (b.start or 0) end)
  return out
end
-- Dernier bilan relevé (le plus récent)
function R.Last()
  local best
  for _, log in pairs(logs()) do if not best or (log.stop or 0) > (best.stop or 0) then best = log end end
  return best
end

-- Bloc RRB d'un bilan
function R.Block(log)
  return F.BuildRRB({
    raidId = log.raidId, start = log.start, stop = log.stop, recorder = log.recorder, name = log.name, instance = log.instance,
    lead = R.IsLead(log), difficulty = log.difficulty, people = log.people, loot = log.loot, encounters = log.encounters,
  })
end

-- Relevé chaque minute ; aussi dès que le groupe change (début du raid), au plus une fois toutes les 10 s
local lastRoster, ticking = 0, false
local function tick() ns.safe("relevé du raid", R.Sample) end
ns.on("PLAYER_LOGIN", function()
  ns.safe("relevé du raid", R.Prune)
  if ticking or not C_Timer then return end
  ticking = true
  if C_Timer.NewTicker then C_Timer.NewTicker(60, tick)
  else
    local function loop() tick() C_Timer.After(60, loop) end
    C_Timer.After(60, loop)
  end
end)
ns.on("GROUP_ROSTER_UPDATE", function()
  if time() - lastRoster < 10 then return end
  lastRoster = time()
  tick()
end)
ns.on("CHAT_MSG_LOOT", function(msg) ns.safe("butin", R.OnLoot, msg) end)
ns.on("ENCOUNTER_END", function(...) ns.safe("fin de rencontre", R.OnEncounterEnd, ...) end)

return R
