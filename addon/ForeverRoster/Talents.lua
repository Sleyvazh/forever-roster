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
