-- Données des groupes (FRG v1, collées depuis le site) : inscriptions aux raids en jeu,
-- patrons recherchés et BiS (infobulles, sacs, alerte au butin), patrons « recherchés » marqués en jeu.
local _, ns = ...
local G = {}
ns.Group = G

local GOLD, GREY, GREEN, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cff6fb7ff"

-- Statuts proposés en jeu (le banc reste une décision des officiers, sur le site)
-- Couleurs : celles du site (thème sombre), pour reconnaître un statut d'un coup d'œil
G.STATUSES = {
  { key = "present", label = "Présent", color = { 0.31, 0.83, 0.37 } }, { key = "late", label = "En retard", color = { 0.94, 0.71, 0.24 } },
  { key = "tentative", label = "Peut-être", color = { 0.66, 0.69, 0.76 } }, { key = "absent", label = "Absent", color = { 1, 0.42, 0.37 } },
}
G.LABEL = { present = "Présent", late = "En retard", tentative = "Peut-être", alt = "Reroll", bench = "Banc", absent = "Absent" }

local function db()
  ForeverRosterDB.groups = ForeverRosterDB.groups or {}
  return ForeverRosterDB.groups
end

-- Plusieurs groupes (page Addon du site) : ils remplacent ceux déjà chargés. Un seul groupe : il est ajouté ou mis à jour.
function G.Load(text)
  local groups, err = ns.Format.ParseFRG(text)
  if not groups then return nil, err end
  if #groups > 1 then wipe(db()) end
  local raids, patterns, bis = 0, 0, 0
  for _, g in ipairs(groups) do
    db()[g.id] = g
    raids = raids + #g.raids
    for _ in pairs(g.patterns) do patterns = patterns + 1 end
    for _ in pairs(g.bis) do bis = bis + 1 end
  end
  ns.print(string.format("%d groupe(s) chargé(s) : %d raid(s), %d patron(s) et %d objet(s) BiS suivis.", #groups, raids, patterns, bis))
  ns.safe("consommables", G.CountConsumables)
  return groups
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

-- Inscription en jeu : gardée pour ce perso, envoyée au site avec le prochain export
function G.SignUp(groupId, raidId, status, raidTime)
  local c = ns.charDB()
  c.signups = c.signups or {}
  c.signups[raidId] = { group = groupId, status = status, time = raidTime or 0 }
  ns.print("inscription notée : " .. (G.LABEL[status] or status) .. ". Elle part au site avec ta prochaine synchro.")
end

function G.SignupLines(c)
  local lines, now = {}, time()
  for raidId, s in pairs((c or ns.charDB()).signups or {}) do
    if (s.time or 0) == 0 or s.time > now - 86400 then lines[#lines + 1] = { "S", s.group, raidId, s.status } end
  end
  table.sort(lines, function(a, b) return a[3] < b[3] end)
  return lines
end

-- Patrons marqués « recherché » en jeu (true) ou retirés (false), pour ce perso, envoyés avec l'export
function G.IsWantedHere(itemId) return (ns.charDB().wanted or {})[itemId] == true end
function G.ToggleWanted(itemId, name)
  local c = ns.charDB()
  c.wanted = c.wanted or {}
  local on = not (c.wanted[itemId] == true or (c.wanted[itemId] == nil and G.WantedBySiteForMe(itemId)))
  c.wanted[itemId] = on
  ns.print((name or ("objet " .. itemId)) .. (on and " : marqué recherché." or " : retiré des recherchés.") .. " Envoyé au site avec ton prochain export.")
  return on
end
function G.WantedLines(c)
  local lines = {}
  for itemId, on in pairs((c or ns.charDB()).wanted or {}) do lines[#lines + 1] = { "W", itemId, on and 1 or 0 } end
  table.sort(lines, function(a, b) return a[2] < b[2] end)
  return lines
end

local function me() return UnitName("player") end
-- Le site dit déjà que ce perso le recherche
function G.WantedBySiteForMe(itemId)
  local who = G.Who(itemId)
  if not who then return false end
  for _, n in ipairs(who.wanted) do if n == me() then return true end end
  return false
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

-- Qui a cet objet comme BiS (et ne l'a pas encore)
function G.Bis(itemId)
  local out, seen = {}, {}
  for _, g in pairs(db()) do
    for _, n in ipairs(g.bis and g.bis[itemId] or {}) do if not seen[n] then seen[n] = true out[#out + 1] = n end end
  end
  return #out > 0 and out or nil
end

-- Réservations (soft reserve) d'un objet pour le prochain raid qui en a : { raid, list = { { name, bonus } } }
function G.Reserves(itemId)
  for _, e in ipairs(G.Raids()) do
    local list = e.group.reserves and e.group.reserves[e.raid.id] and e.group.reserves[e.raid.id][itemId]
    if list and #list > 0 then return { raid = e.raid, list = list } end
  end
  return nil
end
function G.ReserveText(r)
  local parts = {}
  for _, x in ipairs(r.list) do parts[#parts + 1] = x.name .. ((x.bonus or 0) > 0 and (" (+" .. x.bonus .. ")") or "") end
  return table.concat(parts, ", ")
end

-- Tout ce que l'addon sait d'un objet (patron suivi, BiS, marqué en jeu, réservé)
function G.Info(itemId)
  if not itemId then return nil end
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local mark = (ns.charDB().wanted or {})[itemId]
  local sr = G.Reserves(itemId)
  if not who and not bis and mark == nil and not sr then return nil end
  return { who = who, bis = bis, mark = mark, sr = sr }
end

-- Lot G : données du raid (préparation, butin) d'une entrée de G.Raids()
function G.RaidData(e)
  if not e then return nil end
  local g, id = e.group, e.raid.id
  return {
    entry = e, loot = e.raid.loot or "journal", reserves = (g.reserves or {})[id] or {},
    consumables = (g.consumables or {})[id] or {}, bosses = (g.bosses or {})[id] or {},
    council = ((g.council or {})[id] and #g.council[id] > 0) and g.council[id] or (g.officers or {}), roster = (g.roster or {})[id] or {},
    counts = g.counts,
  }
end

-- Consommables demandés par les raids chargés : comptés dans les sacs (et la banque) du perso connecté
function G.ConsumableIds()
  local set, out = {}, {}
  for _, g in pairs(db()) do
    for _, list in pairs(g.consumables or {}) do
      for _, c in ipairs(list) do if not set[c.itemId] then set[c.itemId] = true out[#out + 1] = c.itemId end end
    end
  end
  table.sort(out)
  return out
end
function G.CountConsumables()
  local ids = G.ConsumableIds()
  if #ids == 0 or not ns.HasItemCount() then return nil end
  local counts = {}
  for _, id in ipairs(ids) do counts[id] = ns.ItemCount(id, true) end
  local c = ns.charDB()
  c.consumables, c.consumablesAt = counts, time()
  return counts
end
function G.ConsumableLines(c)
  local counts = (c or ns.charDB()).consumables
  if not counts or not next(counts) then return {} end
  local list, parts = {}, {}
  for id in pairs(counts) do list[#list + 1] = id end
  table.sort(list)
  for _, id in ipairs(list) do parts[#parts + 1] = id .. ":" .. counts[id] end
  return { { "K", table.concat(parts, ",") } }
end
local counting = false
local function countSoon()
  if counting or not ForeverRosterDB then return end
  counting = true
  C_Timer.After(2, function() counting = false ns.safe("consommables", G.CountConsumables) end)
end
for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "BAG_UPDATE_DELAYED", "BANKFRAME_OPENED" }) do ns.on(event, countSoon) end

local function itemIdFrom(link) return link and tonumber(tostring(link):match("item:(%d+)")) end
G.itemIdFrom = itemIdFrom

-- Noms d'objets déjà vus (raid d'essai, fenêtres du butin) : affichés tant que le jeu n'a pas répondu
G.names = {}
local function linkFor(itemId, fallback)
  local _, link = ns.ItemInfo(itemId)
  if not link then ns.RequestItem(itemId) end
  return link or ("[" .. (fallback or G.names[itemId] or ("objet " .. itemId)) .. "]")
end
G.linkFor = linkFor

-- Lien à afficher dans les fenêtres de l'addon (jamais envoyé dans le chat) : celui du jeu s'il est connu, sinon un lien
-- construit (couleur de qualité, infobulle au survol) en attendant que le jeu reçoive l'objet (GET_ITEM_INFO_RECEIVED)
local QCOLOR = { [0] = "ff9d9d9d", [1] = "ffffffff", [2] = "ff1eff00", [3] = "ff0070dd", [4] = "ffa335ee", [5] = "ffff8000" }
function G.displayLink(itemId, name, quality)
  if name then G.names[itemId] = name end
  local _, link = ns.ItemInfo(itemId)
  if link then return link end
  ns.RequestItem(itemId)
  return "|c" .. (QCOLOR[quality or 1] or "ffffffff") .. "|Hitem:" .. itemId .. "|h[" .. (name or G.names[itemId] or ("objet " .. itemId)) .. "]|h|r"
end

-- Réponse du serveur aux objets demandés (ITEM_DATA_LOAD_RESULT : l'objet existe ou non)
G.loadResult = {}
ns.on("ITEM_DATA_LOAD_RESULT", function(id, ok) if id then G.loadResult[id] = ok and true or false end end)

-- /fr objet <id ou lien> : ce que le jeu répond pour un objet (diagnostic des « [objet 12345] »)
-- Fichiers du client (infos immédiates) d'un côté, serveur (nom, lien) de l'autre.
function G.Diagnose(itemId)
  local function api(name, fn) return name .. (fn and " présent" or " absent") end
  ns.print(string.format("objet %d · %s · %s · %s", itemId, api("GetItemInfo", GetItemInfo), api("C_Item.GetItemInfo", C_Item and C_Item.GetItemInfo),
    api("GetItemCount", GetItemCount or (C_Item and C_Item.GetItemCount))))
  local _, itemType, subType, equipLoc = ns.ItemInfoInstant(itemId)
  ns.print("fichiers du jeu : " .. (itemType and (itemType .. (subType and subType ~= "" and (" / " .. subType) or "") .. (equipLoc and equipLoc ~= "" and (" · " .. equipLoc) or "")) or "objet inconnu de ce client"))
  local missing = {}
  for _, e in ipairs(ns.missingEvents) do if e == "GET_ITEM_INFO_RECEIVED" or e == "ITEM_DATA_LOAD_RESULT" then missing[#missing + 1] = e end end
  if #missing > 0 then ns.print("événements absents de ce client : " .. table.concat(missing, ", ")) end
  local name, link = ns.ItemInfo(itemId)
  ns.print("serveur : " .. (link or (name and ("nom " .. name .. ", sans lien")) or "rien pour l'instant (demande envoyée)"))
  if not link then
    G.loadResult[itemId] = nil
    if C_Item and C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, itemId) else ns.ItemInfo(itemId) end
    C_Timer.After(3, function()
      local n2, l2 = ns.ItemInfo(itemId)
      local res = G.loadResult[itemId]
      ns.print("3 s plus tard : " .. (l2 or (n2 and ("nom " .. n2 .. ", sans lien"))
        or (res == false and "le serveur répond que cet objet n'existe pas (ou pas encore : phase, contenu de Forever)")
        or (itemType and "toujours rien : connu des fichiers du jeu, mais le serveur ne l'envoie pas")
        or "toujours rien, et inconnu des fichiers du jeu : cet objet n'existe pas dans Forever"))
      ns.print("pour comparer : /fr objet puis Maj+clic sur un objet de tes sacs.")
    end)
  end
end

-- Objets des sacs : patrons suivis / BiS, et patrons non suivis (pour les marquer « recherché »)
local function bagItems()
  local C = C_Container
  local numSlots = (C and C.GetContainerNumSlots) or GetContainerNumSlots
  local itemAt = (C and C.GetContainerItemID) or GetContainerItemID
  local out, seen = {}, {}
  if not (numSlots and itemAt) then return out end
  for bag = 0, (NUM_BAG_SLOTS or 4) do
    for slot = 1, numSlots(bag) or 0 do
      local id = itemAt(bag, slot)
      if id and not seen[id] then seen[id] = true out[#out + 1] = id end
    end
  end
  return out
end
local RECIPE_CLASS = (Enum and Enum.ItemClass and Enum.ItemClass.Recipe) or 9
local function isRecipe(id)
  local _, _, _, _, _, classID = ns.ItemInfoInstant(id)
  if not classID then return false end
  return classID == RECIPE_CLASS
end
function G.BagPatterns()
  local tracked, others = {}, {}
  for _, id in ipairs(bagItems()) do
    local info = G.Info(id)
    if info and (info.who or info.bis) then tracked[#tracked + 1] = { itemId = id, who = info.who, bis = info.bis }
    elseif isRecipe(id) then others[#others + 1] = { itemId = id } end
  end
  local name = function(e) return e.who and e.who.recipe or ns.ItemInfo(e.itemId) or "" end
  table.sort(tracked, function(a, b) return name(a) < name(b) end)
  return tracked, others
end

local function joinNames(list, max)
  if not list or #list == 0 then return nil end
  local shown = {}
  for i = 1, math.min(#list, max or 8) do shown[i] = list[i] end
  return table.concat(shown, ", ") .. (#list > #shown and (" +" .. (#list - #shown)) or "")
end
G.joinNames = joinNames

-- « J'ai loot ça » : annonce dans le raid ou le groupe, avec qui le recherche ou l'a en BiS
function G.AnnounceText(itemId, link)
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local parts = {}
  if who then parts[#parts + 1] = joinNames(who.wanted, 10) and ("patron recherché par " .. joinNames(who.wanted, 10)) or "patron que personne ne recherche" end
  if who and joinNames(who.known, 5) then parts[#parts + 1] = "déjà connu par " .. joinNames(who.known, 5) end
  if bis then parts[#parts + 1] = "BiS de " .. joinNames(bis, 10) end
  if #parts == 0 then return nil end
  return (link or linkFor(itemId, who and who.recipe)) .. " : " .. table.concat(parts, " · ")
end
function G.Announce(itemId, link)
  local text = G.AnnounceText(itemId, link)
  if not text then return end
  local channel = (IsInRaid and IsInRaid() and "RAID") or (IsInGroup and IsInGroup() and "PARTY") or nil
  if channel and SendChatMessage then SendChatMessage(text, channel) else ns.print(text) end
end

-- Infobulles : lignes « Forever Roster » sur les patrons suivis, les BiS et les patrons marqués en jeu
local function addLines(tooltip, itemId)
  local info = G.Info(itemId)
  if not info or not tooltip or not tooltip.AddLine then return end
  tooltip:AddLine(" ")
  tooltip:AddLine(GOLD .. "Forever Roster|r")
  if info.who then
    tooltip:AddLine(joinNames(info.who.wanted) and ("Recherché par : " .. GREEN .. joinNames(info.who.wanted) .. "|r") or (GREY .. "Personne ne le recherche|r"), 1, 1, 1, true)
    if joinNames(info.who.known) then tooltip:AddLine(GREY .. "Connu par : " .. joinNames(info.who.known) .. "|r", 1, 1, 1, true) end
  end
  if info.bis then tooltip:AddLine("BiS de : " .. BLUE .. joinNames(info.bis) .. "|r", 1, 1, 1, true) end
  if info.sr then tooltip:AddLine("SR (" .. info.sr.raid.name .. ") : " .. GREEN .. G.ReserveText(info.sr) .. "|r", 1, 1, 1, true) end
  if info.mark ~= nil then tooltip:AddLine(GREY .. (info.mark and "Marqué recherché par toi (à envoyer)" or "Retiré de tes recherchés (à envoyer)") .. "|r") end
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

-- Butin : un patron suivi ou un BiS ramassé par moi → alerte avec « Annoncer »
local function isMine(msg, ...)
  for i = 1, select("#", ...) do
    local who = select(i, ...)
    if type(who) == "string" and who ~= "" and (Ambiguate and Ambiguate(who, "none") or who:gsub("%-.*$", "")) == me() then return true end
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
  if not id or not (G.Who(id) or G.Bis(id)) then return end
  if not isMine(msg, playerName, playerName2) then return end
  ns.print("ramassé : " .. G.AnnounceText(id, link))
  if ns.UI and ns.UI.LootAlert then ns.UI.LootAlert(id, link) end
end
ns.on("CHAT_MSG_LOOT", function(...) G.OnLoot(...) end)
