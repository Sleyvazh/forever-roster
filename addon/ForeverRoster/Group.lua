-- Données des groupes (FRG v1, collées depuis le site) : inscriptions aux raids en jeu,
-- patrons recherchés et BiS (infobulles, sacs, alerte au butin), patrons « recherchés » marqués en jeu ; partage des
-- groupes signés par le site avec la guilde et le raid (addon/shared/Share.lua, en bas de ce fichier).
local _, ns = ...
local L, N = ns.L, ns.N
local G = {}
ns.Group = G

local GOLD, GREY, GREEN, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cff6fb7ff"

-- Statuts proposés en jeu (le banc reste une décision des officiers, sur le site)
-- Couleurs : celles du site (thème sombre), pour reconnaître un statut d'un coup d'œil. Noms traduits à l'affichage (L[…]).
G.STATUSES = {
  { key = "present", label = N("Présent"), color = { 0.31, 0.83, 0.37 } }, { key = "late", label = N("En retard"), color = { 0.94, 0.71, 0.24 } },
  { key = "tentative", label = N("Peut-être"), color = { 0.66, 0.69, 0.76 } }, { key = "absent", label = N("Absent"), color = { 1, 0.42, 0.37 } },
}
G.LABEL = { present = N("Présent"), late = N("En retard"), tentative = N("Peut-être"), alt = N("Reroll"), bench = N("Banc"), absent = N("Absent") }
-- Nom d'un statut dans la langue de l'interface (statut inconnu : tel quel)
function G.StatusLabel(status) return G.LABEL[status] and L[G.LABEL[status]] or status end

local function db()
  ForeverRosterDB.groups = ForeverRosterDB.groups or {}
  return ForeverRosterDB.groups
end

-- Prénom seul, en minuscules, comme le reste de l'addon : sans royaume ni nom de famille de Forever
-- (« Greta Coulé », « Greta-Forever EU » → greta)
local function first(name)
  return ((ns.text(name):gsub("^%s+", "")):match("^[^%-%s]+") or ""):lower()
end

-- Prénom seul comme on l'affiche, casse gardée : « Greta-Forever EU », « Greta Coulé-Forever EU » → Greta
local function shortName(name)
  return (ns.text(name):gsub("^%s+", ""):match("^[^%-%s]+")) or ""
end

-- Heure du statut sur le site (r.siteAt, 1.6.3) de l'inscription d'un raid de mes propres données : celle de l'entrée de la
-- liste des inscrits (ligne Y) au prénom de r.char, jamais une entrée « ? » (prénom porté par deux joueurs). Sans liste,
-- sans inscription ou sans perso : nil. Le statut et le perso restent ceux de la ligne R.
local function siteAtOf(g, r)
  local list = r.char and g.signups and g.signups[r.id]
  if not list then return nil end
  local k = first(r.char)
  for _, e in ipairs(list) do
    if not e.dup and first(e.name) == k then return e.at end
  end
  return nil
end
local function stampSite(g)
  for _, r in ipairs(g.raids or {}) do r.siteAt = siteAtOf(g, r) end
end

-- Groupes lus (ParseFRG) rangés dans la sauvegarde ; replace : ils remplacent tous ceux déjà chargés
local function store(groups, replace)
  if replace then wipe(db()) end
  for _, g in ipairs(groups) do db()[g.id] = g end
  ns.safe(N("consommables"), G.CountConsumables)
  ns.safe(N("inscriptions"), G.Reconcile)
  -- Sorties donjon (lignes X, 1.6.1) : bandeau dû peut-être tout de suite (Outings.lua)
  if ns.Outings and ns.Outings.Check then ns.safe(N("sorties"), ns.Outings.Check) end
end

-- Plusieurs groupes (page Addon du site) : ils remplacent ceux déjà chargés. Un seul groupe : il est ajouté ou mis à jour.
-- replace : tous les groupes du joueur, qui remplacent toujours ceux chargés ; quiet : sans message.
-- how : d'où viennent les données, noté dans chaque groupe (origin, onglet Synchro) : "companion" (Roster Companion),
-- sinon collées. Ce sont mes données : mes champs personnels (statut et perso de chaque raid) datent de g.at (mineAt) et
-- restent ceux de la ligne R ; l'heure de mon statut sur le site (r.siteAt) vient de la liste des inscrits (ligne Y).
function G.Load(text, replace, quiet, how)
  local groups, err = ns.Format.ParseFRG(text)
  if not groups then return nil, err end
  local raids, patterns, bis = 0, 0, 0
  for _, g in ipairs(groups) do
    g.origin = { at = time(), companion = how == "companion" or nil }
    g.mineAt = g.at
    stampSite(g)
    raids = raids + #g.raids
    for _ in pairs(g.patterns) do patterns = patterns + 1 end
    for _ in pairs(g.bis) do bis = bis + 1 end
  end
  store(groups, #groups > 1 or replace)
  if not quiet then ns.print(L("%d groupe(s) chargé(s) : %d raid(s), %d patron(s) et %d objet(s) BiS suivis.", #groups, raids, patterns, bis)) end
  return groups
end

-- Roster Companion (1.5.9) : tous mes groupes du site, lus d'un coup (ParseFRG les sépare), et chacun ne remplace le
-- mien que s'il est strictement plus récent (« généré le » de l'en-tête, g.at) : une version plus récente reçue d'un
-- autre joueur (partage) reste, avec son texte signé et son origine, l'appli ayant pu relever le site avant lui.
-- Ce sont mes données : dans un groupe gardé, mes champs personnels (statut et perso de chaque raid) viennent quand
-- même de l'appli s'ils sont plus récents que mes derniers à moi (mineAt), comme un bloc partagé plus récent garde
-- les miens (avec l'heure de leur statut sur le site, r.siteAt, tirée de la liste des inscrits de l'appli). Un groupe
-- absent du texte disparaît (quitté sur le site). Sans message.
-- Renvoie les groupes lus et le nombre de ceux pris à l'appli ; nil et l'erreur si le texte est illisible.
function G.LoadNewer(text, how)
  local groups, err = ns.Format.ParseFRG(text)
  if not groups then return nil, err end
  local list, taken = {}, 0
  for i, g in ipairs(groups) do
    stampSite(g)
    local old = db()[g.id]
    if old and (tonumber(old.at) or 0) >= g.at then
      if g.at > (tonumber(old.mineAt) or tonumber(old.at) or 0) then
        local mine = {}
        for _, r in ipairs(g.raids) do mine[r.id] = r end
        for _, r in ipairs(old.raids or {}) do
          local m = mine[r.id]
          if m then r.status, r.char, r.siteAt, r.unknown = m.status, m.char, m.siteAt, nil end
        end
        old.mineAt = g.at
      end
      list[i] = old
    else
      g.origin = { at = time(), companion = how == "companion" or nil }
      g.mineAt = g.at
      list[i] = g
      taken = taken + 1
    end
  end
  store(list, true)
  return groups, taken
end

function G.List()
  local out = {}
  for _, g in pairs(db()) do out[#out + 1] = g end
  table.sort(out, function(a, b) return (a.name or "") < (b.name or "") end)
  return out
end

-- Inscriptions faites en jeu (c.signups[raidId] = { group, status, time = heure du raid, at = heure du clic,
-- outSig, sent, sentAt }) : gardées pour le perso jusqu'à ce que le site les ait enregistrées (1.5.4).
-- L'heure du clic compte dans l'empreinte du perso : chaque clic part au site, même pour remettre un statut déjà
-- envoyé (avant, l'addon croyait l'avoir déjà envoyé et le gardait pour lui). Une fois enregistrée sur le site,
-- l'inscription faite en jeu est oubliée : un changement fait ensuite sur le site n'est plus écrasé au prochain envoi.
local KEEP = 86400 -- envoyée jusqu'à 24 h après l'heure du raid

local function live(s, now) return (s.time or 0) == 0 or s.time > (now or time()) - KEEP end

local function findRaid(groupId, raidId)
  local g = db()[groupId]
  if not g then return nil, nil end
  for _, r in ipairs(g.raids or {}) do if r.id == raidId then return g, r end end
  return g, nil
end

-- Prénom du perso d'une clé « Prénom-Royaume »
local function nameOf(key) return (key or ""):match("^(.-)%-") or key end

-- Où en est une inscription faite en jeu : "sent" (le site l'a reçue), "outbox" (écrite au dernier /reload,
-- Roster Companion l'envoie), "todo" (pas encore sortie du jeu)
function G.SignupState(s)
  if s.sent then return "sent" end
  if s.outSig and ns.Companion and ns.Companion.Active() then return "outbox" end
  return "todo"
end

-- Raids à venir de tous les groupes chargés, avec mon inscription (faite en jeu, sinon celle du site)
-- siteState : ce que la liste des inscrits du site dit de mes persos pour ce raid (G.SiteSignup : "mine", "none",
-- "unknown" ; nil sans liste), pour dire « pas d'inscription » plutôt que « inconnue »
function G.Raids()
  local now, mine, out, own = time(), ns.charDB().signups or {}, {}, nil
  for _, g in pairs(db()) do
    for _, r in ipairs(g.raids or {}) do
      if r.time == 0 or r.time > now - 3 * 3600 then
        local s = mine[r.id]
        local siteState
        if g.signups and g.signups[r.id] then
          own = own or G.MyChars() -- relevés une fois, seulement si un site a donné sa liste (G.Raids sert aussi aux infobulles)
          siteState = select(2, G.SiteSignup(g, r.id, own))
        end
        -- unknown : raid arrivé avec les données d'un autre joueur (partage), mon inscription sur le site n'y est pas
        out[#out + 1] = { group = g, raid = r, status = s and s.status or nil, state = s and G.SignupState(s) or nil, onSite = r.status, siteChar = r.char,
          unknown = r.unknown or nil, siteState = siteState }
      end
    end
  end
  table.sort(out, function(a, b)
    local ta, tb = a.raid.time == 0 and math.huge or a.raid.time, b.raid.time == 0 and math.huge or b.raid.time
    return ta < tb
  end)
  return out
end

-- Heure à comparer à celle du site (1.6.3) : GetServerTime() (heure du serveur de jeu) s'il existe et répond un nombre,
-- sinon time(). Elle date le clic d'une inscription en jeu (s.at), que G.Reconcile met en face de r.siteAt.
function G.Now()
  if GetServerTime then
    local ok, t = pcall(GetServerTime)
    if ok and type(t) == "number" then return t end
  end
  return time()
end

-- Inscription en jeu : gardée pour ce perso, envoyée au site avec le prochain export (ou le prochain /reload avec
-- Roster Companion). Le statut déjà enregistré sur le site pour ce perso : rien à envoyer (un choix pas encore parti
-- est annulé), sauf si un choix précédent est déjà en route (les données du site ne le montrent peut-être pas encore).
function G.SignUp(groupId, raidId, status, raidTime)
  local c = ns.charDB()
  c.signups = c.signups or {}
  local old, label = c.signups[raidId], G.StatusLabel(status)
  local inflight = old and (old.outSig ~= nil or old.sent or old.inflight) or nil
  local _, r = findRaid(groupId, raidId)
  if r and r.status == status and (r.char == nil or r.char == UnitName("player")) and not inflight then
    c.signups[raidId] = nil
    ns.print(L("inscription : %s, c'est déjà ton statut sur le site.", label))
    return
  end
  c.signups[raidId] = { group = groupId, status = status, time = raidTime or 0, at = G.Now(), inflight = inflight }
  if ns.Companion and ns.Companion.Active() then
    ns.print(L("inscription notée : %s. « Envoyer maintenant » (onglet Raids) l'envoie au site tout de suite, sinon elle part au prochain /reload.", label))
  else
    ns.print(L("inscription notée : %s. Elle part au site avec ta prochaine synchro.", label))
  end
end

function G.SignupLines(c)
  local lines, now = {}, time()
  for raidId, s in pairs((c or ns.charDB()).signups or {}) do
    if live(s, now) then lines[#lines + 1] = { "S", s.group, raidId, s.status } end
  end
  table.sort(lines, function(a, b) return a[3] < b[3] end)
  return lines
end

-- Heures des clics, pour l'empreinte du perso ("" sans inscription horodatée : empreinte inchangée depuis 1.5.3)
function G.SignupStamp(c)
  local parts, now = {}, time()
  for raidId, s in pairs(c.signups or {}) do
    if s.at and live(s, now) then parts[#parts + 1] = raidId .. "@" .. s.at end
  end
  table.sort(parts)
  return #parts > 0 and ("@" .. table.concat(parts, ",")) or ""
end

-- Écrites pour l'appli (outbox, au /reload ou à la déconnexion) dans le bloc d'empreinte sig
function G.MarkOut(c, sig)
  for _, s in pairs(c.signups or {}) do if live(s) and not s.sent then s.outSig = sig end end
end

-- Le site a reçu le bloc d'empreinte sig (accusé de l'appli) ; sig nil : export copié (Ctrl+C)
function G.MarkReceived(c, sig, at)
  for _, s in pairs(c.signups or {}) do
    if live(s) and not s.sent and (sig == nil or s.outSig == sig) then s.sent, s.sentAt = true, at or time() end
  end
end

-- Après chaque chargement des données du site : oublie les inscriptions faites en jeu que le site a enregistrées
-- (même statut), celles qu'il a reçues puis changées (données plus récentes que l'accusé : le site a le dernier mot),
-- celles d'un raid retiré, et celles d'un raid passé depuis plus de 24 h. Sans faire repartir le perso.
-- Données reçues d'un autre joueur (partage) : mes champs personnels y datent de mes dernières données à moi
-- (g.mineAt), pas de g.at ; un raid nouveau pour moi (r.unknown) ne dit rien de mon inscription.
-- Le site a le dernier mot (1.6.3) : si son statut pour moi date d'après mon clic (r.siteAt >= s.at : il l'a changé depuis,
-- ou il a enregistré ce clic), l'inscription faite en jeu est oubliée.
function G.Reconcile()
  local now = time()
  for key, c in pairs(ForeverRosterDB.chars or {}) do
    if c.signups and next(c.signups) then
      -- 1.5.3 et avant : pas d'heure de clic ; déjà reçue si le perso n'avait plus rien à envoyer
      local wasSent = ns.Export.IsSent(c)
      ns.Export.Quietly(c, function()
        for raidId, s in pairs(c.signups) do
          if not s.at and not s.sent and wasSent then s.sent, s.sentAt = true, c.sentAt or 0 end
          local g, r = findRaid(s.group, raidId)
          local drop = not live(s, now)
          if not drop and g then
            drop = not r
              or (r.status == s.status and (r.char == nil or r.char == nameOf(key)))
              or (s.sent and not r.unknown and (g.mineAt or g.at or 0) > (s.sentAt or 0))
              or (r.siteAt and s.at and r.siteAt >= s.at)
          end
          if drop then c.signups[raidId] = nil end
        end
      end)
    end
  end
end
ns.on("PLAYER_LOGIN", function() ns.safe(N("inscriptions"), G.Reconcile) end)

-- Patrons marqués « recherché » en jeu (true) ou retirés (false), pour ce perso, envoyés avec l'export
function G.IsWantedHere(itemId) return (ns.charDB().wanted or {})[itemId] == true end
function G.ToggleWanted(itemId, name)
  local c = ns.charDB()
  c.wanted = c.wanted or {}
  local on = not (c.wanted[itemId] == true or (c.wanted[itemId] == nil and G.WantedBySiteForMe(itemId)))
  c.wanted[itemId] = on
  name = name or L("objet %s", itemId)
  ns.print(on and L("%s : marqué recherché. Envoyé au site avec ton prochain export.", name) or L("%s : retiré des recherchés. Envoyé au site avec ton prochain export.", name))
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
  C_Timer.After(2, function() counting = false ns.safe(N("consommables"), G.CountConsumables) end)
end
for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "BAG_UPDATE_DELAYED", "BANKFRAME_OPENED" }) do ns.on(event, countSoon) end

local function itemIdFrom(link) return tonumber(ns.text(link):match("item:(%d+)")) end
G.itemIdFrom = itemIdFrom

-- Noms d'objets déjà vus (raid d'essai, fenêtres du butin) : affichés tant que le jeu n'a pas répondu
G.names = {}
local function linkFor(itemId, fallback)
  local _, link = ns.ItemInfo(itemId)
  if not link then ns.RequestItem(itemId) end
  return link or ("[" .. (fallback or G.names[itemId] or L("objet %s", itemId)) .. "]")
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
  return "|c" .. (QCOLOR[quality or 1] or "ffffffff") .. "|Hitem:" .. itemId .. "|h[" .. (name or G.names[itemId] or L("objet %s", itemId)) .. "]|h|r"
end

-- Réponse du serveur aux objets demandés (ITEM_DATA_LOAD_RESULT : l'objet existe ou non)
G.loadResult = {}
ns.on("ITEM_DATA_LOAD_RESULT", function(id, ok) if id then G.loadResult[id] = ok and true or false end end)

-- /fr objet <id ou lien> : ce que le jeu répond pour un objet (diagnostic des « [objet 12345] »)
-- Fichiers du client (infos immédiates) d'un côté, serveur (nom, lien) de l'autre.
function G.Diagnose(itemId)
  local function api(name, fn) return fn and L("%s présent", name) or L("%s absent", name) end
  ns.print(L("objet %d · %s · %s · %s", itemId, api("GetItemInfo", GetItemInfo), api("C_Item.GetItemInfo", C_Item and C_Item.GetItemInfo),
    api("GetItemCount", GetItemCount or (C_Item and C_Item.GetItemCount))))
  local _, itemType, subType, equipLoc = ns.ItemInfoInstant(itemId)
  ns.print(L("fichiers du jeu : %s", itemType and (itemType .. (subType and subType ~= "" and (" / " .. subType) or "") .. (equipLoc and equipLoc ~= "" and (" · " .. equipLoc) or "")) or L["objet inconnu de ce client"]))
  local missing = {}
  for _, e in ipairs(ns.missingEvents) do if e == "GET_ITEM_INFO_RECEIVED" or e == "ITEM_DATA_LOAD_RESULT" then missing[#missing + 1] = e end end
  if #missing > 0 then ns.print(L("événements absents de ce client : %s", table.concat(missing, ", "))) end
  local name, link = ns.ItemInfo(itemId)
  ns.print(L("serveur : %s", link or (name and L("nom %s, sans lien", name)) or L["rien pour l'instant (demande envoyée)"]))
  if not link then
    G.loadResult[itemId] = nil
    if C_Item and C_Item.RequestLoadItemDataByID then pcall(C_Item.RequestLoadItemDataByID, itemId) else ns.ItemInfo(itemId) end
    C_Timer.After(3, function()
      local n2, l2 = ns.ItemInfo(itemId)
      local res = G.loadResult[itemId]
      ns.print(L("3 s plus tard : %s", l2 or (n2 and L("nom %s, sans lien", n2))
        or (res == false and L["le serveur répond que cet objet n'existe pas (ou pas encore : phase, contenu de Forever)"])
        or (itemType and L["toujours rien : connu des fichiers du jeu, mais le serveur ne l'envoie pas"])
        or L["toujours rien, et inconnu des fichiers du jeu : cet objet n'existe pas dans Forever"]))
      ns.print(L["pour comparer : /fr objet puis Maj+clic sur un objet de tes sacs."])
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

-- « J'ai loot ça » : annonce dans le raid ou le groupe, avec qui le recherche ou l'a en BiS (dans la langue de celui qui annonce)
function G.AnnounceText(itemId, link)
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local parts = {}
  if who then parts[#parts + 1] = joinNames(who.wanted, 10) and L("patron recherché par %s", joinNames(who.wanted, 10)) or L["patron que personne ne recherche"] end
  if who and joinNames(who.known, 5) then parts[#parts + 1] = L("déjà connu par %s", joinNames(who.known, 5)) end
  if bis then parts[#parts + 1] = L("BiS de %s", joinNames(bis, 10)) end
  if #parts == 0 then return nil end
  return L("%s : %s", link or linkFor(itemId, who and who.recipe), table.concat(parts, " · "))
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
    tooltip:AddLine(joinNames(info.who.wanted) and L("Recherché par : %s", GREEN .. joinNames(info.who.wanted) .. "|r") or (GREY .. L["Personne ne le recherche"] .. "|r"), 1, 1, 1, true)
    if joinNames(info.who.known) then tooltip:AddLine(GREY .. L("Connu par : %s", joinNames(info.who.known)) .. "|r", 1, 1, 1, true) end
  end
  if info.bis then tooltip:AddLine(L("BiS de : %s", BLUE .. joinNames(info.bis) .. "|r"), 1, 1, 1, true) end
  if info.sr then tooltip:AddLine(L("SR (%s) : %s", info.sr.raid.name, GREEN .. G.ReserveText(info.sr) .. "|r"), 1, 1, 1, true) end
  if info.mark ~= nil then tooltip:AddLine(GREY .. (info.mark and L["Marqué recherché par toi (à envoyer)"] or L["Retiré de tes recherchés (à envoyer)"]) .. "|r") end
  if tooltip.Show then tooltip:Show() end
end
G.addTooltipLines = addLines

local hooked = false
local function hookTooltips()
  if hooked then return end
  hooked = true
  if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Item, function(tooltip, data)
      local id = data and data.id
      if ns.secret(id) then return end
      ns.safe(N("infobulle"), addLines, tooltip, id)
    end)
  elseif GameTooltip and GameTooltip.HookScript then
    for _, tt in ipairs({ GameTooltip, ItemRefTooltip }) do
      pcall(tt.HookScript, tt, "OnTooltipSetItem", function(self)
        local _, link = self:GetItem()
        ns.safe(N("infobulle"), addLines, self, itemIdFrom(link))
      end)
    end
  end
end
ns.on("PLAYER_LOGIN", function() ns.safe(N("infobulles"), hookTooltips) end)
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
  ns.print(L("ramassé : %s", G.AnnounceText(id, link)))
  if ns.UI and ns.UI.LootAlert then ns.UI.LootAlert(id, link) end
end
ns.on("CHAT_MSG_LOOT", function(...) G.OnLoot(...) end)

--------------------------------------------------------------------------------------------------------------------
-- Partage entre joueurs (addon/shared/Share.lua) : un joueur colle les données du site (ou les reçoit de Roster
-- Companion), son addon les annonce à la guilde et au raid ; les addons qui ont une version plus ancienne (ou rien)
-- la demandent, la vérifient (signature du site, ligne M : un de mes persos est membre du groupe) et l'appliquent en
-- gardant mes champs personnels. Option : ForeverRosterDB.share (nil : oui, par défaut ; false : ni annonce ni envoi,
-- la réception continue). Messages SHV, SHQ, SHD (préfixe FRoster, file de fond de Raid.lua) : docs/addon-format.md.
-- Un groupe dont le bloc n'est pas signé (ancien site, pas de clé, soft reserve cachée : chacun y reçoit d'autres
-- réservations) n'est jamais annoncé, et un bloc reçu sans signature n'est jamais appliqué.
--------------------------------------------------------------------------------------------------------------------
local Sh = ns.Share or {} -- Share.lua absent ou cassé : pas de partage, le reste de l'addon marche

function G.ShareOn()
  return not (ForeverRosterDB and ForeverRosterDB.share == false)
end

-- Mes persos (prénoms en minuscules) : celui-ci, ceux du compte déjà vus par l'addon (ForeverRosterDB.chars, clés
-- « Prénom-Royaume ») et ceux de mes inscriptions dans les données du site
function G.MyChars()
  local out = {}
  local function add(name) local k = first(name) if k ~= "" then out[k] = true end end
  add(UnitName and UnitName("player"))
  for key in pairs(ForeverRosterDB and ForeverRosterDB.chars or {}) do add(key) end
  for _, g in pairs(db()) do
    for _, r in ipairs(g.raids or {}) do if r.char then add(r.char) end end
  end
  return out
end

-- Mon inscription à un raid d'après la liste des inscrits du site (ligne Y, 1.6.3), pour des données reçues d'un autre
-- joueur. Renvoie l'entrée { name, status, at, dup } et l'état :
--   "mine"    : une seule entrée porte le prénom d'un de mes persos (G.MyChars), sans « ? » ;
--   "none"    : la liste est là et aucun de mes persos n'y est : pas inscrit ;
--   "unknown" : une entrée « ? » à mon prénom (porté par deux joueurs) ou plusieurs entrées à moi : on ne sait pas ;
--   nil, nil  : pas de liste pour ce raid (site plus ancien) : on ne sait rien de plus qu'avant.
-- own : mes persos déjà relevés (G.MyChars), pour ne pas les relever à chaque raid.
function G.SiteSignup(g, raidId, own)
  local list = g and g.signups and g.signups[raidId]
  if not list then return nil, nil end
  own = own or G.MyChars()
  local found
  for _, e in ipairs(list) do
    if own[first(e.name)] then
      if e.dup or found then return nil, "unknown" end
      found = e
    end
  end
  if found then return found, "mine" end
  return nil, "none"
end

local function inGuild()
  local ok, r = pcall(function() return IsInGuild and IsInGuild() end)
  return ok and r and true or false
end
local function inRaid()
  local ok, r = pcall(function() return IsInRaid and IsInRaid() end)
  return ok and r and true or false
end

-- Demande « qui a les données du site ? » (SHW) à la guilde, 25 à 45 s après la connexion (PLAYER_LOGIN : une fois par
-- session) : seulement si je suis en guilde à ce moment-là, que le partage soit activé ou non (on reçoit toujours). Qui a
-- des données signées et le partage activé annonce ses groupes (Share.lua). Une demande déjà prévue suffit.
local wantPending = false
function G.WantSoon()
  if wantPending or not (Sh.Want and Sh.Jitter) then return false end
  wantPending = true
  local function go()
    wantPending = false
    if inGuild() then Sh.Want("GUILD") end
  end
  local delay = Sh.Jitter(25, 45)
  if C_Timer and C_Timer.After then C_Timer.After(delay, go) else go() end
  return true
end

-- Annonce sur la guilde ou le raid dans min à max secondes (une annonce déjà prévue plus tôt suffit)
local soonAt = {}
function G.ShareSoon(dist, min, max)
  if not (Sh.Announce and Sh.Jitter) then return false end
  local delay = Sh.Jitter(min or 1, max or 3)
  local at = time() + delay
  if soonAt[dist] and soonAt[dist] <= at then return false end
  soonAt[dist] = at
  local function go()
    if soonAt[dist] == at then soonAt[dist] = nil end
    if not G.ShareOn() then return end
    if dist == "GUILD" and not inGuild() then return end
    if dist == "RAID" and not inRaid() then return end
    Sh.Announce(dist, dist == "RAID")
  end
  if C_Timer and C_Timer.After then C_Timer.After(delay, go) else go() end
  return true
end
-- Données neuves (collage, nouveautés de Roster Companion) : annoncées à la guilde et au raid (blocs signés seulement)
function G.ShareNew()
  G.ShareSoon("GUILD", 1, 3)
  G.ShareSoon("RAID", 1, 3)
end

-- Bloc reçu d'un autre joueur (déjà vérifié par Share.lua) : il remplace mes données de ce groupe (les autres groupes
-- restent). Pour chaque raid qui a une liste des inscrits du site (ligne Y, 1.6.3), mon inscription s'y lit (G.SiteSignup) :
-- statut, perso et heure du statut (r.siteAt) ; pas inscrit : rien (ni inconnu) ; inconnue (prénom « ? » ou deux persos à
-- moi) : r.unknown. Sans liste (site plus ancien) : mon inscription sur le site (statut et perso) est gardée pour chaque
-- raid que j'avais déjà, et un raid nouveau pour moi est inconnu (r.unknown). Mes champs personnels datent de g.at quand
-- tous les raids ont une liste, sinon toujours de mes dernières données à moi (mineAt, pour G.Reconcile) ; mes
-- inscriptions faites en jeu (c.signups) ne bougent pas, G.Reconcile les oublie si le site a le dernier mot. Puis relais
-- sur l'autre canal (guilde → raid, raid → guilde).
local function applyShared(text, sender, dist)
  local list = ns.Format.ParseFRG(text)
  local g = list and #list == 1 and list[1]
  if not (g and g.text) then return false end -- jamais un bloc sans signature
  local old = db()[g.id]
  local before = {}
  for _, r in ipairs(old and old.raids or {}) do before[r.id] = r end
  local own, every = G.MyChars(), true -- mes persos relevés avant que ce bloc ne remplace les données précédentes
  for _, r in ipairs(g.raids) do
    local e, state = G.SiteSignup(g, r.id, own)
    local o = before[r.id]
    if state == "mine" then r.status, r.char, r.siteAt, r.unknown = e.status, e.name, e.at, nil
    elseif state == "none" then r.status, r.char, r.siteAt, r.unknown = nil, nil, nil, nil
    elseif state == "unknown" then r.status, r.char, r.siteAt, r.unknown = nil, nil, nil, true
    else
      every = false
      if o then r.status, r.char, r.siteAt, r.unknown = o.status, o.char, o.siteAt, o.unknown
      else r.status, r.char, r.siteAt, r.unknown = nil, nil, nil, true end
    end
  end
  g.mineAt = every and g.at or (old and (old.mineAt or old.at) or 0)
  g.origin = { from = shortName(sender), at = time() } -- le prénom : le nom reçu est « Prénom-Royaume »
  store({ g }, false)
  if ns.UI and ns.UI.Refresh then ns.safe(N("partage des données du site"), ns.UI.Refresh) end
  if ns.Minimap and ns.Minimap.Update then ns.safe(N("minicarte"), ns.Minimap.Update) end
  G.ShareSoon(dist == "RAID" and "GUILD" or "RAID", 2, 6)
  return true
end

if Sh.Setup then Sh.Setup({
  kind = "FRG",
  -- File de fond de Raid.lua : après les messages du raid, au rythme permis par le jeu, jamais en combat
  send = function(msg, dist, target) return ns.Raid ~= nil and ns.Raid.SendLow(msg, dist, target) end,
  blocks = function()
    local out = {}
    for id, g in pairs(db()) do out[id] = { at = tonumber(g.at) or 0, text = g.text } end
    return out
  end,
  apply = applyShared,
  mine = function(list)
    local own = G.MyChars()
    for _, name in ipairs(list) do if own[first(name)] then return true end end
    return false
  end,
  notify = function(text) ns.print(text) end,
  enabled = G.ShareOn,
  display = shortName, -- Share.lua reçoit le nom brut (« Prénom-Royaume », pour chuchoter) ; on affiche le prénom
  stamp = function(at) return date("%d/%m %H:%M", at) end,
}) end

-- Origine des données de chaque groupe (onglet Synchro) : collées, chargées par Roster Companion ou reçues d'un joueur,
-- et quand ; pourquoi elles ne se partagent pas (bloc sans signature du site, clé du site pas encore dans l'addon)
local NOT_SHARED = { unsigned = N("pas signées par le site"), invalid = N("pas signées par le site"), key = N("clé du site inconnue") }
function G.Origins()
  local out = {}
  for _, g in ipairs(G.List()) do
    local o = type(g.origin) == "table" and g.origin or nil
    if not o then -- groupe chargé avant le partage : date du dernier chargement des données du site
      local last = ForeverRosterDB.lastLoad
      o = (last and last.groups) and { at = last.at, companion = last.companion } or {}
    end
    local when = o.at and date("%d/%m %H:%M", o.at)
    local how
    if o.from then how = when and L("reçues de %s le %s", o.from, when) or L("reçues de %s", o.from)
    elseif o.companion then how = when and L("chargées par Roster Companion le %s", when) or L["chargées par Roster Companion"]
    else how = when and L("collées le %s", when) or L["collées"] end
    local status = (g.text and Sh.Status) and Sh.Status(g.text, "FRG") or "unsigned"
    local why = G.ShareOn() and NOT_SHARED[status]
    out[#out + 1] = L("%s : %s", g.name or "?", how) .. (why and (" · " .. L("non partagées : %s", L[why])) or "")
  end
  return out
end

-- Connexion : annonce à la guilde 20 à 40 s après (le temps que tout charge), puis ma demande (SHW) 25 à 45 s après : qui
-- avait des données les annonce, les autres arrivent à ce moment-là. Les données de Roster Companion lues à la connexion
-- partent avec l'annonce ; celles chargées ensuite (actualisation) sont annoncées tout de suite (G.ShareNew).
ns.on("PLAYER_LOGIN", function()
  G.ShareSoon("GUILD", 20, 40)
  G.WantSoon()
end)

-- Arrivée dans un raid, ou raid qui s'agrandit : annonce au raid (pour ceux qui ne sont pas de la guilde)
local wasRaid, lastCount = false, 0
ns.on("GROUP_ROSTER_UPDATE", function()
  local raid = inRaid()
  local n = 0
  if raid and GetNumGroupMembers then
    local ok, c = pcall(GetNumGroupMembers)
    if ok and type(c) == "number" then n = c end
  end
  if raid and (not wasRaid or n > lastCount) then G.ShareSoon("RAID", 3, 8) end
  wasRaid, lastCount = raid, n
end)
