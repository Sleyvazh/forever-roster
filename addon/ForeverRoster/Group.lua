-- Données du groupe (FRG v1, collées depuis le site) : inscriptions aux raids en jeu,
-- patrons recherchés (infobulles, sacs) et alerte quand on ramasse un patron recherché.
local _, ns = ...
local G = {}
ns.Group = G

local GOLD, GREY, GREEN = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f"

-- Statuts proposés en jeu (le banc reste une décision des officiers, sur le site)
G.STATUSES = {
  { key = "present", label = "Présent" }, { key = "late", label = "En retard" },
  { key = "tentative", label = "Peut-être" }, { key = "absent", label = "Absent" },
}
G.LABEL = { present = "Présent", late = "En retard", tentative = "Peut-être", alt = "Reroll", bench = "Banc", absent = "Absent" }

local function db()
  ForeverRosterDB.groups = ForeverRosterDB.groups or {}
  return ForeverRosterDB.groups
end

function G.Load(text)
  local group, err = ns.Format.ParseFRG(text)
  if not group then return nil, err end
  db()[group.id] = group
  local n = 0
  for _ in pairs(group.patterns) do n = n + 1 end
  ns.print(string.format("groupe « %s » chargé : %d raid(s), %d patron(s) suivis.", group.name, #group.raids, n))
  return group
end

function G.List()
  local out = {}
  for _, g in pairs(db()) do out[#out + 1] = g end
  table.sort(out, function(a, b) return (a.name or "") < (b.name or "") end)
  return out
end

-- Raids à venir de tous les groupes chargés, avec mon inscription (faite en jeu, sinon celle du site)
function G.Raids()
  local now, mine, out = time(), ns.charDB().signups or {}, {}
  for _, g in pairs(db()) do
    for _, r in ipairs(g.raids or {}) do
      if r.time == 0 or r.time > now - 3 * 3600 then
        local s = mine[r.id]
        out[#out + 1] = { group = g, raid = r, status = s and s.status or nil, onSite = r.status, siteChar = r.char }
      end
    end
  end
  table.sort(out, function(a, b)
    local ta, tb = a.raid.time == 0 and math.huge or a.raid.time, b.raid.time == 0 and math.huge or b.raid.time
    return ta < tb
  end)
  return out
end

-- Inscription en jeu : gardée pour ce perso, envoyée au site avec le prochain /fr export
function G.SignUp(groupId, raidId, status, raidTime)
  local c = ns.charDB()
  c.signups = c.signups or {}
  c.signups[raidId] = { group = groupId, status = status, time = raidTime or 0 }
  ns.print("inscription notée : " .. (G.LABEL[status] or status) .. ". Fais /fr export puis colle-le sur ta fiche pour l'envoyer au site.")
end

function G.SignupLines()
  local lines, now = {}, time()
  for raidId, s in pairs(ns.charDB().signups or {}) do
    if (s.time or 0) == 0 or s.time > now - 86400 then lines[#lines + 1] = { "S", s.group, raidId, s.status } end
  end
  table.sort(lines, function(a, b) return a[3] < b[3] end)
  return lines
end

-- Qui recherche / connaît le patron (tous groupes confondus, sans doublon)
function G.Who(itemId)
  local wanted, known, seenW, seenK, recipe = {}, {}, {}, {}, nil
  for _, g in pairs(db()) do
    local p = g.patterns and g.patterns[itemId]
    if p then
      recipe = recipe or p.recipe
      for _, n in ipairs(p.wanted) do if not seenW[n] then seenW[n] = true wanted[#wanted + 1] = n end end
      for _, n in ipairs(p.known) do if not seenK[n] then seenK[n] = true known[#known + 1] = n end end
    end
  end
  if not recipe then return nil end
  return { recipe = recipe, wanted = wanted, known = known }
end

local function itemIdFrom(link) return link and tonumber(tostring(link):match("item:(%d+)")) end
G.itemIdFrom = itemIdFrom

local function linkFor(itemId, fallback)
  local _, link = GetItemInfo and GetItemInfo(itemId)
  return link or ("[" .. (fallback or ("objet " .. itemId)) .. "]")
end

-- Patrons suivis présents dans les sacs
function G.BagPatterns()
  local out, seen = {}, {}
  local C = C_Container
  local numSlots = (C and C.GetContainerNumSlots) or GetContainerNumSlots
  local itemAt = (C and C.GetContainerItemID) or GetContainerItemID
  if not (numSlots and itemAt) then return out end
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    for slot = 1, numSlots(bag) or 0 do
      local id = itemAt(bag, slot)
      if id and not seen[id] then
        seen[id] = true
        local who = G.Who(id)
        if who then out[#out + 1] = { itemId = id, who = who } end
      end
    end
  end
  table.sort(out, function(a, b) return a.who.recipe < b.who.recipe end)
  return out
end

local function joinNames(list, max)
  if #list == 0 then return nil end
  local shown = {}
  for i = 1, math.min(#list, max or 8) do shown[i] = list[i] end
  return table.concat(shown, ", ") .. (#list > #shown and (" +" .. (#list - #shown)) or "")
end
G.joinNames = joinNames

-- « J'ai loot ce patron » : annonce dans le raid ou le groupe, avec qui le recherche
function G.Announce(itemId, link)
  local who = G.Who(itemId)
  if not who then return end
  local text = (link or linkFor(itemId, who.recipe)) .. " : " .. (joinNames(who.wanted, 10) and ("recherché par " .. joinNames(who.wanted, 10)) or "personne ne le recherche")
    .. (joinNames(who.known, 5) and (" · déjà connu par " .. joinNames(who.known, 5)) or "")
  local channel = (IsInRaid and IsInRaid() and "RAID") or (IsInGroup and IsInGroup() and "PARTY") or nil
  if channel and SendChatMessage then SendChatMessage(text, channel) else ns.print(text) end
end

-- Infobulles : ligne « Forever Roster » sur les patrons suivis
local function addLines(tooltip, itemId)
  local who = itemId and G.Who(itemId)
  if not who or not tooltip or not tooltip.AddLine then return end
  tooltip:AddLine(" ")
  tooltip:AddLine(GOLD .. "Forever Roster|r")
  tooltip:AddLine(joinNames(who.wanted) and ("Recherché par : " .. GREEN .. joinNames(who.wanted) .. "|r") or (GREY .. "Personne ne le recherche|r"), 1, 1, 1, true)
  if joinNames(who.known) then tooltip:AddLine(GREY .. "Connu par : " .. joinNames(who.known) .. "|r", 1, 1, 1, true) end
  if tooltip.Show then tooltip:Show() end
end
G.addTooltipLines = addLines

local hooked = false
local function hookTooltips()
  if hooked then return end
  hooked = true
  if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
      ns.safe("infobulle", addLines, tooltip, data and data.id)
    end)
  elseif GameTooltip and GameTooltip.HookScript then
    for _, tt in ipairs({ GameTooltip, ItemRefTooltip }) do
      pcall(tt.HookScript, tt, "OnTooltipSetItem", function(self)
        local _, link = self:GetItem()
        ns.safe("infobulle", addLines, self, itemIdFrom(link))
      end)
    end
  end
end
ns.on("PLAYER_LOGIN", function() ns.safe("infobulles", hookTooltips) end)
G.hookTooltips = hookTooltips

-- Butin : un patron suivi ramassé par moi → alerte avec bouton « Annoncer »
local function isMine(msg, ...)
  local me = UnitName("player")
  for i = 1, select("#", ...) do
    local who = select(i, ...)
    if type(who) == "string" and who ~= "" and (Ambiguate and Ambiguate(who, "none") or who:gsub("%-.*$", "")) == me then return true end
  end
  for _, pattern in ipairs({ LOOT_ITEM_SELF, LOOT_ITEM_SELF_MULTIPLE, LOOT_ITEM_PUSHED_SELF, LOOT_ITEM_PUSHED_SELF_MULTIPLE }) do
    if type(pattern) == "string" then
      local prefix = pattern:match("^(.-)%%")
      if prefix and prefix ~= "" and msg:sub(1, #prefix) == prefix then return true end
    end
  end
  return false
end
-- CHAT_MSG_LOOT : texte, nom du joueur (2e argument), …, nom du joueur (5e argument selon les versions)
function G.OnLoot(msg, playerName, _, _, playerName2)
  if type(msg) ~= "string" then return end
  local link = msg:match("|c%x+|Hitem:[^|]+|h%[[^%]]+%]|h|r") or msg:match("|Hitem:[^|]+|h%[[^%]]+%]|h")
  local id = itemIdFrom(link)
  if not id or not G.Who(id) then return end
  if not isMine(msg, playerName, playerName2) then return end
  local who = G.Who(id)
  ns.print("patron suivi ramassé : " .. (link or who.recipe) .. " · " .. (joinNames(who.wanted) and ("recherché par " .. joinNames(who.wanted)) or "personne ne le recherche"))
  if ns.UI and ns.UI.LootAlert then ns.UI.LootAlert(id, link, who) end
end
ns.on("CHAT_MSG_LOOT", function(...) G.OnLoot(...) end)
