-- Export du perso vers le site (format FRC v1, voir docs/addon-format.md).
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

local function scanTradeSkill()
  scan(GetNumTradeSkills, function(i) local name, kind = GetTradeSkillInfo(i) return name, kind end,
    GetTradeSkillRecipeLink, GetTradeSkillItemLink, function() return (GetTradeSkillLine()) end)
end
local function scanCraft()
  scan(GetNumCrafts, function(i) local name, _, kind = GetCraftInfo(i) return name, kind end,
    GetCraftRecipeLink, GetCraftItemLink, function() return (GetCraftDisplaySkillLine and GetCraftDisplaySkillLine()) or (GetCraftSkillLine and GetCraftSkillLine(1)) end)
end
ns.on("TRADE_SKILL_SHOW", function() C_Timer.After(0.3, scanTradeSkill) end)
ns.on("TRADE_SKILL_UPDATE", function() C_Timer.After(0.3, scanTradeSkill) end)
if GetNumCrafts then
  ns.on("CRAFT_SHOW", function() C_Timer.After(0.3, scanCraft) end)
  ns.on("CRAFT_UPDATE", function() C_Timer.After(0.3, scanCraft) end)
end

function E.Build()
  local lines = {}
  for _, slot in ipairs(SLOTS) do
    local id = GetInventoryItemID("player", slot)
    if id then lines[#lines + 1] = { "G", slot, id } end
  end
  -- Métiers et compétences (noms tels qu'affichés par le jeu ; le site reconnaît l'anglais et le français)
  if GetNumSkillLines then
    for i = 1, GetNumSkillLines() do
      local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
      if name and not isHeader then lines[#lines + 1] = { "P", name, rank or 0, maxRank or 0 } end
    end
  end
  local db = ns.charDB()
  for prof, list in pairs(db.recipes or {}) do
    for key in pairs(list) do lines[#lines + 1] = { "R", prof, key } end
  end
  local talents = ns.Talents.Capture()
  if talents then
    for _, n in ipairs(talents.nodes) do
      if n.visible then lines[#lines + 1] = { "T", n.id, n.rank, n.max, n.x, n.y, n.spell, n.sub, n.tree } end
    end
  end
  local _, raceFile = UnitRace("player")
  return ns.Format.BuildFRC({
    name = UnitName("player"), realm = GetRealmName(), class = select(2, UnitClass("player")), race = raceFile,
    level = UnitLevel("player"), faction = (UnitFactionGroup("player")), time = time(), addon = ns.version,
  }, lines)
end
