-- Export des persos vers le site (format FRC v1, un bloc par perso, voir docs/addon-format.md).
-- Chaque perso est relevé automatiquement quand il change ; l'export les contient tous.
local _, ns = ...
local E = {}
ns.Export = E

-- Emplacements d'équipement du jeu (sans chemise ni tabard)
local SLOTS = { 1, 2, 3, 15, 5, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18 }

-- Patrons connus : relevés à chaque ouverture d'une fenêtre de métier (le jeu ne les donne pas autrement)
local function idFrom(link, kind)
  return link and tonumber(link:match(kind .. ":(%d+)"))
end
local function scan(numFn, infoFn, recipeLinkFn, itemLinkFn, nameFn)
  if not numFn then return end
  local prof = nameFn and nameFn()
  if not prof or prof == "" or prof == "UNKNOWN" then return end
  local db = ns.charDB()
  db.recipes[prof] = db.recipes[prof] or {}
  local list, n = db.recipes[prof], 0
  for i = 1, numFn() or 0 do
    local name, kind = infoFn(i)
    if name and kind ~= "header" and kind ~= "subheader" then
      local spell = recipeLinkFn and idFrom(recipeLinkFn(i), "enchant")
      local item = itemLinkFn and idFrom(itemLinkFn(i), "item")
      local enchant = (not spell and itemLinkFn) and idFrom(itemLinkFn(i), "enchant")
      local key = spell and ("s" .. spell) or enchant and ("s" .. enchant) or item and ("i" .. item)
      if key and not list[key] then list[key] = true n = n + 1 end
    end
  end
  if n > 0 then ns.print(n .. " patron(s) de " .. prof .. " ajouté(s) à l'export.") end
end

-- Compétence du métier ouvert, gardée pour l'export (repli si le jeu ne liste pas les compétences)
local function remember(prof, rank, maxRank)
  if not prof or prof == "" or not tonumber(rank) then return end
  local db = ns.charDB()
  db.skills = db.skills or {}
  db.skills[prof] = { tonumber(rank), tonumber(maxRank) or 0 }
end

local function scanTradeSkill()
  if GetTradeSkillLine then remember(GetTradeSkillLine()) end
  scan(GetNumTradeSkills, function(i) local name, kind = GetTradeSkillInfo(i) return name, kind end,
    GetTradeSkillRecipeLink, GetTradeSkillItemLink, function() return (GetTradeSkillLine()) end)
end
local function scanCraft()
  scan(GetNumCrafts, function(i) local name, _, kind = GetCraftInfo(i) return name, kind end,
    GetCraftRecipeLink, GetCraftItemLink, function() return (GetCraftDisplaySkillLine and GetCraftDisplaySkillLine()) or (GetCraftSkillLine and GetCraftSkillLine(1)) end)
end
-- API moderne des métiers (C_TradeSkillUI) : la recette est directement l'identifiant du sort
local function scanModern()
  local T = C_TradeSkillUI
  if not (T and T.GetAllRecipeIDs) then return end
  local line = T.GetBaseProfessionInfo and T.GetBaseProfessionInfo() or (T.GetTradeSkillLine and { professionName = (T.GetTradeSkillLine()) })
  local prof = type(line) == "table" and (line.professionName or line.parentProfessionName) or nil
  if not prof or prof == "" then return end
  remember(prof, line.skillLevel, line.maxSkillLevel)
  local db = ns.charDB()
  db.recipes[prof] = db.recipes[prof] or {}
  local n = 0
  for _, id in ipairs(T.GetAllRecipeIDs() or {}) do
    local info = T.GetRecipeInfo and T.GetRecipeInfo(id)
    if (not info or info.learned) and not db.recipes[prof]["s" .. id] then db.recipes[prof]["s" .. id] = true n = n + 1 end
  end
  if n > 0 then ns.print(n .. " patron(s) de " .. prof .. " ajouté(s) à l'export.") end
end
local function onTradeSkill()
  C_Timer.After(0.3, function()
    ns.safe("patrons", function()
      if GetNumTradeSkills then scanTradeSkill() else scanModern() end
      if E.autoSnapshot then E.autoSnapshot() end
    end)
  end)
end
ns.on("TRADE_SKILL_SHOW", onTradeSkill)
ns.on("TRADE_SKILL_UPDATE", onTradeSkill)
ns.on("TRADE_SKILL_LIST_UPDATE", onTradeSkill)
if GetNumCrafts then
  local onCraft = function() C_Timer.After(0.3, function() ns.safe("patrons", scanCraft) end) end
  ns.on("CRAFT_SHOW", onCraft)
  ns.on("CRAFT_UPDATE", onCraft)
end

-- Lignes du perso connecté : équipement (G), métiers (P), patrons (R), talents (T).
-- quiet : relevé automatique, sans message dans le chat.
local function captureLines(quiet)
  local lines = {}
  ns.safe("équipement", function()
    for _, slot in ipairs(SLOTS) do
      local id = GetInventoryItemID("player", slot)
      if id then lines[#lines + 1] = { "G", slot, id } end
    end
  end)
  -- Métiers et compétences (noms tels qu'affichés par le jeu ; le site reconnaît l'anglais et le français).
  -- Trois sources, selon l'API du client : liste des compétences (Classic), GetProfessions (moderne),
  -- puis la dernière compétence vue dans chaque fenêtre de métier.
  local seen, profs = {}, 0
  local function add(name, rank, maxRank)
    if not name or name == "" or seen[name] then return end
    seen[name] = true
    lines[#lines + 1] = { "P", name, tonumber(rank) or 0, tonumber(maxRank) or 0 }
    profs = profs + 1
  end
  ns.safe("métiers", function()
    if not (GetNumSkillLines and GetSkillLineInfo) then return end
    for i = 1, GetNumSkillLines() or 0 do
      local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
      if not isHeader then add(name, rank, maxRank) end
    end
  end)
  ns.safe("métiers", function()
    if not (GetProfessions and GetProfessionInfo) then return end
    local idx = { GetProfessions() }
    for i = 1, 6 do
      if idx[i] then
        local name, _, rank, maxRank = GetProfessionInfo(idx[i])
        add(name, rank, maxRank)
      end
    end
  end)
  local db = ns.charDB()
  for prof, v in pairs(db.skills or {}) do add(prof, v[1], v[2]) end
  if profs == 0 and not quiet then ns.print("aucun métier lu : ouvre une fois chaque fenêtre de métier, puis actualise l'export.") end
  for prof, list in pairs(db.recipes or {}) do
    for key in pairs(list) do lines[#lines + 1] = { "R", prof, key } end
  end
  -- Chaque partie est protégée : une erreur (API du jeu différente) n'empêche pas d'exporter le reste
  local okT, talents, why = pcall(ns.Talents.Capture)
  if not quiet then
    if not okT then ns.print("talents non exportés : " .. tostring(talents))
    elseif not talents then ns.print("talents non exportés : " .. tostring(why)) end
  end
  if okT and talents then
    for _, n in ipairs(talents.nodes) do
      if n.visible then lines[#lines + 1] = { "T", n.id, n.rank, n.max, n.x, n.y, n.spell, n.sub, n.tree } end
    end
  end
  return lines
end

-- Relevé du perso connecté, gardé dans la sauvegarde (commune au compte) : l'export contient ainsi tous les persos.
function E.Snapshot(quiet)
  local _, raceFile = UnitRace("player")
  local c = ns.charDB()
  c.snapshot = {
    header = { name = UnitName("player"), realm = GetRealmName(), class = select(2, UnitClass("player")), race = raceFile,
      level = UnitLevel("player"), faction = (UnitFactionGroup("player")) },
    lines = captureLines(quiet), at = time(),
  }
  return c.snapshot
end

-- Relevé automatique quand quelque chose change (au plus un par seconde)
local pending = false
local function autoSnapshot()
  if pending or not ForeverRosterDB then return end
  pending = true
  C_Timer.After(1, function() pending = false ns.safe("relevé du perso", E.Snapshot, true) end)
end
E.autoSnapshot = autoSnapshot
for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_LEVEL_UP", "TRAIT_CONFIG_UPDATED",
  "SKILL_LINES_CHANGED", "PLAYER_LOGOUT" }) do
  ns.on(event, event == "PLAYER_LOGOUT" and function() ns.safe("relevé du perso", E.Snapshot, true) end or autoSnapshot)
end

-- Persos relevés sur ce compte (le perso connecté en premier)
function E.Characters()
  local current, out = ns.charKey(), {}
  for key, c in pairs(ForeverRosterDB.chars or {}) do
    if c.snapshot then out[#out + 1] = { key = key, current = key == current, snap = c.snapshot, char = c } end
  end
  table.sort(out, function(a, b)
    if a.current ~= b.current then return a.current end
    return a.key < b.key
  end)
  return out
end

function E.Forget(key)
  local c = ForeverRosterDB.chars and ForeverRosterDB.chars[key]
  if c then c.snapshot = nil end
end

local function block(c, snap)
  local lines = {}
  for _, l in ipairs(snap.lines or {}) do lines[#lines + 1] = l end
  ns.safe("inscriptions", function() for _, l in ipairs(ns.Group.SignupLines(c)) do lines[#lines + 1] = l end end)
  ns.safe("recherchés", function() for _, l in ipairs(ns.Group.WantedLines(c)) do lines[#lines + 1] = l end end)
  local h = {}
  for k, v in pairs(snap.header or {}) do h[k] = v end
  h.time, h.addon = snap.at or 0, ns.version
  return ns.Format.BuildFRC(h, lines)
end

-- Export : un bloc FRC par perso relevé (le perso connecté est relevé à l'instant). onlyCurrent : ce perso seul.
function E.Build(onlyCurrent)
  E.Snapshot(false)
  local blocks = {}
  for _, e in ipairs(E.Characters()) do
    if e.current or not onlyCurrent then blocks[#blocks + 1] = block(e.char, e.snap) end
  end
  return table.concat(blocks, "\n")
end
