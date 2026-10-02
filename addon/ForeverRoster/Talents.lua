-- Talents de Forever : système moderne de Blizzard (C_Traits / C_ClassTalents) à la place des talents Classic.
local _, ns = ...
local T = {}
ns.Talents = T

local function spellInfo(id)
  if not id then return end
  if C_Spell and C_Spell.GetSpellInfo then
    local i = C_Spell.GetSpellInfo(id)
    if i then return i.name, i.iconID end
  end
  if GetSpellInfo then
    local name, _, icon = GetSpellInfo(id)
    return name, icon
  end
end

-- Talents du perso : un nœud par talent (position dans l'arbre, rang actuel, rang max, sort)
function T.Capture()
  if not (C_Traits and C_ClassTalents and C_ClassTalents.GetActiveConfigID) then return nil, "système de talents introuvable" end
  local configID = C_ClassTalents.GetActiveConfigID()
  if not configID then return nil, "aucune configuration de talents active" end
  local cfg = C_Traits.GetConfigInfo(configID)
  local nodes = {}
  for _, treeID in ipairs(cfg and cfg.treeIDs or {}) do
    for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
      local okN, n = pcall(C_Traits.GetNodeInfo, configID, nodeID)
      if okN and n and n.ID and n.ID ~= 0 then
        local entryID = (n.activeEntry and n.activeEntry.entryID) or (n.entryIDs and n.entryIDs[1])
        local spellID
        if entryID then
          pcall(function()
            local e = C_Traits.GetEntryInfo(configID, entryID)
            if e and e.definitionID then
              local d = C_Traits.GetDefinitionInfo(e.definitionID)
              spellID = d and (d.spellID or d.overriddenSpellID)
            end
          end)
        end
        local okS, name, icon = pcall(spellInfo, spellID)
        if not okS then name, icon = nil, nil end
        nodes[#nodes + 1] = {
          id = nodeID, tree = treeID, sub = n.subTreeID or 0, x = n.posX or 0, y = n.posY or 0,
          rank = n.currentRank or n.activeRank or 0, max = n.maxRanks or 0, spell = spellID or 0, name = name, icon = icon,
          visible = n.isVisible ~= false,
        }
      end
    end
  end
  return { configID = configID, treeIDs = cfg and cfg.treeIDs or {}, nodes = nodes }
end

-- Copie d'une table du jeu sans fonctions ni cycles (pour le diagnostic)
local function copy(v, depth)
  if type(v) ~= "table" then return (type(v) == "function" or type(v) == "userdata") and "<" .. type(v) .. ">" or v end
  if depth > 4 then return "<…>" end
  local out = {}
  for k, x in pairs(v) do out[k] = copy(x, depth + 1) end
  return out
end
local function keys(t)
  local out = {}
  if type(t) == "table" then for k in pairs(t) do out[#out + 1] = tostring(k) end end
  table.sort(out)
  return out
end

-- /fr talents : enregistre tout ce que le jeu expose sur les talents, pour le site (fichier SavedVariables)
function T.Dump()
  local d = { build = { GetBuildInfo() }, class = select(2, UnitClass("player")), level = UnitLevel("player") }
  d.api = { C_Traits = keys(C_Traits), C_ClassTalents = keys(C_ClassTalents), C_SpecializationInfo = keys(C_SpecializationInfo) }
  local globals = {}
  for k, v in pairs(_G) do
    if type(k) == "string" and type(v) == "function" and (k:find("Talent") or k:find("Trait") or k:find("Spec")) then globals[#globals + 1] = k end
  end
  table.sort(globals)
  d.globals = globals
  local ok, res = pcall(function()
    local configID = C_ClassTalents.GetActiveConfigID()
    local out = { configID = configID }
    out.config = copy(C_Traits.GetConfigInfo(configID), 0)
    out.nodes = {}
    for _, treeID in ipairs(out.config.treeIDs or {}) do
      out.treeInfo = copy(C_Traits.GetTreeInfo and C_Traits.GetTreeInfo(configID, treeID), 0)
      for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
        local n = copy(C_Traits.GetNodeInfo(configID, nodeID), 0)
        for _, entryID in ipairs(type(n) == "table" and n.entryIDs or {}) do
          local e = C_Traits.GetEntryInfo(configID, entryID)
          n["entry" .. entryID] = copy(e, 0)
          if e and e.definitionID then n["def" .. entryID] = copy(C_Traits.GetDefinitionInfo(e.definitionID), 0) end
        end
        out.nodes[#out.nodes + 1] = n
      end
    end
    return out
  end)
  d.talents = ok and res or ("erreur : " .. tostring(res))
  local okC, cap, why = pcall(T.Capture)
  d.capture = okC and (cap or why) or ("erreur : " .. tostring(cap))
  ForeverRosterDB.debug = d
  ns.print("diagnostic des talents enregistré (" .. (ok and #res.nodes or 0) .. " nœuds). Fais /reload, puis envoie le fichier ForeverRoster.lua de WTF\\Account\\<compte>\\SavedVariables.")
end
