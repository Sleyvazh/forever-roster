-- Conseil du butin défini en jeu (lot R4b, addon 0.4.1 ; étude « Roster autonome », §5.3 et §5.11 n° 6) : le conseil
-- vient de la guilde, sans le site. Membres = membres de la guilde d'un rang 1 à N (« rang minimal » N, 2 par défaut :
-- le maître de guilde et le rang suivant), plus les noms ajoutés à la main, moins ceux retirés à la main. Calcul en
-- continu sur la liste de guilde (pas « une fois » comme RCLootCouncil) : un officier promu entre tout seul, un ancien
-- officier rétrogradé sort tout seul (sauf s'il a été ajouté à la main).
-- Qui modifie (choix de Flo, 15/10) : les membres d'un rang 1 à N (« officiers »). Un nom ajouté à la main vote (et fera
-- foi pour l'historique avec la synchro entre officiers, R4g), mais ne modifie pas le conseil. On ne peut pas choisir un
-- rang minimal au-dessus du sien (on ne pourrait plus rien modifier).
-- Réglage, un par guilde (les persos du compte peuvent être dans des guildes différentes) :
--   RosterDB.hist.councils[<guilde-royaume, sans casse ni accents>] = { minRank, v, by, seq,
--     extra = { [clé du nom] = { name, on, v, by, seq } } }
--   on = true : ajouté, false : retiré, nil : suit son rang (gardé, avec sa version, pour la synchro R4g). Chaque
--   changement est une version (v : heure du serveur, by : auteur ; seq : horloge de l'historique, History.lua).
--   Gardé dans l'addon de celui qui le règle : quand il est chef de butin, le conseil de ce soir qui en découle part au
--   raid (MC, Loot.lua). Le partage du réglage entre officiers viendra avec la synchro (R4g, message HK).
-- Conseil de ce soir (Lo.CouncilSource, Loot.lua) : MC reçu du chef de butin, sinon ce conseil s'il a été réglé ici
-- (rang ou noms), sinon les lignes L / O du site, sinon ce conseil au rang par défaut ; membres présents dans le raid.
-- Confiance (Co.Trust, pour la synchro entre officiers) : « officer » (rang 1 à N), « member » (au conseil sans être
-- officier : ajouté à la main), false ; nil tant que la liste de guilde n'est pas lue (Co.WhenReady reprend plus tard).
-- Liste de guilde (client 12.1.5) : IsInGuild, GetGuildInfo("player"), GetNumGuildMembers, GetGuildRosterInfo (rang
-- 0 : maître de guilde), GuildControlGetNumRanks, GuildControlGetRankName (1 : maître de guilde), demandée au serveur
-- par C_GuildInfo.GuildRoster, reçue avec GUILD_ROSTER_UPDATE. Jamais lue ni demandée en combat ni pendant une
-- rencontre (reprise après) ; chaque valeur passe par les gardes des valeurs secrètes (F.usable, num) ; rien du jeu
-- n'est gardé dans la sauvegarde, sauf les noms ajoutés ou retirés.
-- Raid d'essai : la guilde fictive ns.Loot.test.guild = { name, ranks = { noms }, me = mon rang, members = { { name,
-- rank, class } } } ; réglage dans l'historique en mémoire (ns.Hist.test).
local _, ns = ...
local L = ns.L
local Co = {}
ns.Council = Co
local F, Cm = ns.Format, ns.Comm

local secret, usable = F.secret, F.usable
Co.DEFAULT_RANK = 2
Co.READ_DELAY = 2   -- secondes : lecture de la liste de guilde après GUILD_ROSTER_UPDATE (plusieurs regroupés)
Co.ASK_EVERY = 300  -- secondes entre deux demandes de la liste au serveur quand le jeu le propose (force : 10 s)
Co.MAX_HELD = 50    -- Co.WhenReady : demandes gardées au plus
Co.MAX_MEMBERS = 1000
-- Liste de guilde lue : { key, name, at, ranks = { [rang] = nom }, numRanks, members = { [clé] = { name, rank, class } },
-- n, myRank } ; { none = true } : pas dans une guilde ; nil : pas encore lue
Co.data = nil
local serial = 0 -- +1 à chaque lecture ou changement (cache des membres)
local held = {}

local function me() return Cm.Me() end
local function test() local Lo = ns.Loot return Lo and Lo.test or nil end
local function num(v) return type(v) == "number" and not secret(v) and v or nil end
local function call(fn, ...) if type(fn) ~= "function" then return false end return pcall(fn, ...) end
local function isTrue(v) return not secret(v) and v and true or false end
local function now() local H = ns.Hist return (H and H.Now) and H.Now() or time() end

-- En combat ou pendant une rencontre de boss : ni lecture ni demande au serveur
local encounter = false -- entre ENCOUNTER_START et ENCOUNTER_END
local function busy()
  local ok, c = call(InCombatLockdown)
  if ok and isTrue(c) then return true end
  local okE, e = call(IsEncounterInProgress)
  if okE and not secret(e) then
    if e == true then return true end
    if e == false then encounter = false end -- ENCOUNTER_END manqué (sortie de l'instance pendant le combat…)
  end
  return encounter
end
Co.Busy = busy

--------------------------------------------------------------------------------------------------------------------
-- Liste de guilde (raid d'essai : la guilde fictive)
--------------------------------------------------------------------------------------------------------------------
local function testData(g)
  local members, n = {}, 0
  for _, m in ipairs(g.members or {}) do
    local full = F.FullName(m.name)
    if full and tonumber(m.rank) then members[F.Fold(full)] = { name = full, rank = tonumber(m.rank), class = m.class } n = n + 1 end
  end
  local mine = F.Key(me())
  if mine then
    local ok, _, class = call(UnitClass, "player")
    members[mine] = { name = me(), rank = tonumber(g.me) or 1, class = ok and usable(class) and class or nil }
    n = n + 1
  end
  local ranks = g.ranks or {}
  return { key = "essai", name = g.name, test = true, ranks = ranks, numRanks = #ranks, members = members, n = n, myRank = tonumber(g.me) or 1 } -- nolocale (clé)
end
local function data()
  local t = test()
  if t then return type(t.guild) == "table" and testData(t.guild) or nil end
  return Co.data
end

--- Liste de guilde connue (lue, ou guilde fictive de l'essai) ?
function Co.Ready() local d = data() return d ~= nil and not d.none end
--- true : dans une guilde ; false : non ; nil : pas encore su
function Co.InGuild()
  local d = data()
  if not d then return nil end
  return not d.none
end
function Co.GuildName() local d = data() return d and d.name or nil end
function Co.NumRanks() local d = data() return d and d.numRanks or 0 end
--- Nom d'un rang (1 : maître de guilde)
function Co.RankName(rank)
  local d = data()
  local name = d and d.ranks and d.ranks[rank]
  return name or L("rang %d", tonumber(rank) or 0)
end
--- Rang d'un perso (1 : maître de guilde) ; false : pas dans la guilde ; nil : liste pas lue
function Co.RankOf(name)
  local d = data()
  if not d then return nil end
  if d.none then return false end
  local k = F.Key(name)
  local m = k and d.members[k]
  return m and m.rank or false
end
function Co.MyRank() return Co.RankOf(me()) or (data() or {}).myRank end
--- Classe d'un perso de la guilde (couleurs de l'interface)
function Co.ClassOf(name)
  local d = data()
  local k = F.Key(name)
  local m = d and not d.none and k and d.members[k]
  return m and m.class or nil
end

--------------------------------------------------------------------------------------------------------------------
-- Réglage (RosterDB.hist.councils, ou l'historique de l'essai)
--------------------------------------------------------------------------------------------------------------------
local function config(create)
  local d = data()
  local H = ns.Hist
  if not (d and d.key and H and H.Store) then return nil end
  local h = H.Store()
  if type(h.councils) ~= "table" then
    if not create then return nil end
    h.councils = {}
  end
  local c = h.councils[d.key]
  if type(c) ~= "table" then
    if not create then return nil end
    c = {}
    h.councils[d.key] = c
  end
  if type(c.extra) ~= "table" then c.extra = {} end
  return c
end
Co.Config = config

--- Rang minimal du conseil (1 à nombre de rangs ; 2 par défaut)
function Co.MinRank()
  local c = config(false)
  local r = (c and num(c.minRank)) or Co.DEFAULT_RANK
  local n = Co.NumRanks()
  if n > 0 then r = math.min(r, n) end
  return math.max(1, math.floor(r))
end
--- Le conseil a-t-il été réglé en jeu (rang choisi, ou noms ajoutés ou retirés) ? Alors il passe avant celui du site.
function Co.Configured()
  local c = config(false)
  if not c then return false end
  if num(c.minRank) then return true end
  for _, x in pairs(c.extra) do if x.on ~= nil then return true end end
  return false
end

-- Nom ajouté à la main (true), retiré à la main (false), ou qui suit son rang (nil)
local function extraOf(c, k) local x = c and k and c.extra[k] return x and x.on end

--- Membres du conseil : { { name, class, rank, added } } (rang, puis nom ; ajoutés hors de la guilde à la fin), et les
--- officiers retirés à la main
function Co.List()
  local d = data()
  if not d or d.none then return {}, {} end
  local c = config(false)
  local minRank = Co.MinRank()
  local list, removed, seen = {}, {}, {}
  for k, m in pairs(d.members) do
    if m.rank <= minRank then
      if extraOf(c, k) == false then removed[#removed + 1] = { name = m.name, class = m.class, rank = m.rank }
      else list[#list + 1] = { name = m.name, class = m.class, rank = m.rank } seen[k] = true end
    end
  end
  for k, x in pairs(c and c.extra or {}) do
    if x.on == true and not seen[k] and usable(x.name) then
      local m = d.members[k]
      list[#list + 1] = { name = m and m.name or x.name, class = m and m.class or nil, rank = m and m.rank or nil, added = true }
      seen[k] = true
    end
  end
  local function order(a, b)
    local ra, rb = a.rank or 99, b.rank or 99
    if ra ~= rb then return ra < rb end
    return F.Fold(a.name) < F.Fold(b.name)
  end
  table.sort(list, order)
  table.sort(removed, order)
  return list, removed
end
local cache = {}
--- Noms des membres du conseil (« Prénom-Royaume »)
function Co.Members()
  if not test() and cache.serial == serial and cache.data == Co.data then return cache.names end
  local out = {}
  for i, x in ipairs((Co.List())) do out[i] = x.name end
  if not test() then cache.serial, cache.data, cache.names = serial, Co.data, out end
  return out
end
--- Membre du conseil ? (nil : liste de guilde pas lue)
function Co.IsMember(name)
  local d = data()
  if not d then return nil end
  if d.none then return false end
  local k = F.Key(name)
  if not k then return false end
  local on = extraOf(config(false), k)
  if on ~= nil then return on end
  local m = d.members[k]
  return m ~= nil and m.rank <= Co.MinRank()
end
--- Officier (rang 1 à N : peut modifier le conseil) ? (nil : liste de guilde pas lue)
function Co.IsOfficer(name)
  local r = Co.RankOf(name)
  if r == nil then return nil end
  return r ~= false and r <= Co.MinRank()
end
--- Confiance (étude §5.3, §5.5) : « officer », « member », false ; nil : liste de guilde pas encore lue (Co.WhenReady)
function Co.Trust(name)
  local d = data()
  if not d then return nil end
  if d.none then return false end
  if Co.IsOfficer(name) then return "officer" end
  if Co.IsMember(name) then return "member" end
  return false
end
--- fn() tout de suite si la liste de guilde est lue (ou si l'on n'est pas dans une guilde), sinon dès qu'elle l'est
function Co.WhenReady(fn)
  if data() ~= nil then return fn() end
  if #held >= Co.MAX_HELD then table.remove(held, 1) end
  held[#held + 1] = fn
  return nil
end
function Co.Held() return #held end
local function release()
  local list = held
  held = {}
  for _, fn in ipairs(list) do ns.safe(L["conseil du butin"], fn) end
end

-- « Maître de guilde, Officier » : rangs 1 à n (quatre noms au plus)
local function rankNames(n)
  local out = {}
  for i = 1, math.min(n, 4) do out[i] = Co.RankName(i) end
  return table.concat(out, ", ") .. (n > 4 and ", …" or "")
end
Co.RankNames = rankNames

--- Puis-je modifier le conseil ? Renvoie true, ou false et la raison (dans la langue de l'interface)
function Co.CanModify()
  local d = data()
  if not d then return false, L["liste de guilde pas encore lue : réessaie dans un instant."] end
  if d.none then return false, L["tu n'es pas dans une guilde : le conseil du butin vient du site ou du chef de butin."] end
  local mine, minRank = Co.MyRank(), Co.MinRank()
  if mine and mine <= minRank then return true end
  local shown = mine and Co.RankName(mine) or L["sans rang connu"]
  if minRank == 1 then return false, L("seul le rang 1 de la guilde (%s) modifie le conseil du butin ; tu es %s.", rankNames(1), shown) end
  return false, L("seuls les rangs 1 à %d de la guilde (%s) modifient le conseil du butin ; tu es %s.", minRank, rankNames(minRank), shown)
end

-- Le conseil a changé (réglage, liste de guilde, guilde fictive) : le chef de butin renvoie le conseil de ce soir
local function changed()
  serial = serial + 1
  local Lo = ns.Loot
  if Lo and Lo.CouncilChanged then ns.safe(L["conseil du butin"], Lo.CouncilChanged) end
end
Co.Changed = changed

-- Nouvelle version d'un réglage : heure du serveur (+1 si la précédente est de la même seconde), auteur, horloge
local function stamp(x, oldV)
  local v = now()
  oldV = num(oldV)
  if oldV and oldV >= v then v = oldV + 1 end
  x.v, x.by = v, me()
  local H = ns.Hist
  if H and H.Bump then H.Bump(x) end
end

local function refuse(quiet, msg)
  if not quiet then ns.print(msg) end
  return false, msg
end

--- Rang minimal (officiers seulement) ; quiet : sans message
function Co.SetMinRank(rank, quiet)
  local ok, why = Co.CanModify()
  if not ok then return refuse(quiet, why) end
  rank = math.floor(tonumber(rank) or 0)
  local n = Co.NumRanks()
  if rank < 1 or (n > 0 and rank > n) then return false end
  local mine = Co.MyRank()
  if mine and rank < mine then
    return refuse(quiet, L["tu ne peux pas choisir un rang au-dessus du tien : tu ne pourrais plus modifier le conseil."])
  end
  local c = config(true)
  local oldV = c.v
  c.minRank = rank
  stamp(c, oldV)
  if not quiet then
    ns.print(rank == 1 and L("conseil du butin : rang 1 de la guilde seulement (%s).", rankNames(1))
      or L("conseil du butin : rangs 1 à %d de la guilde (%s).", rank, rankNames(rank)))
  end
  changed()
  return true
end

-- Nom tapé ou choisi : « Prénom » (royaume du joueur) ou « Prénom-Royaume » ; nom de la liste de guilde s'il y est
local function nameOf(name)
  local full = F.FullName(F.txt(name, 60))
  local base, realm = F.Split(full)
  if not base or #base < 2 or #base > 24 or base:find("[%s%d%p]") then return nil end
  local d = data()
  local m = d and not d.none and d.members[F.Fold(full)]
  if m then return m.name end
  -- Tapé en minuscules : majuscule au prénom, comme le jeu
  return base:sub(1, 1):upper() .. base:sub(2) .. (realm and ("-" .. realm) or "")
end

local function setExtra(full, on)
  local c = config(true)
  local k = F.Fold(full)
  local old = c.extra[k]
  local x = { name = full, on = on }
  stamp(x, old and old.v)
  c.extra[k] = x
  changed()
end

--- Ajoute un membre au conseil (officiers seulement) : un officier retiré suit de nouveau son rang, un autre nom est
--- ajouté à la main (de la guilde ou non). Renvoie true, ou false et la raison.
function Co.Add(name, quiet)
  local ok, why = Co.CanModify()
  if not ok then return refuse(quiet, why) end
  local full = nameOf(name)
  if not full then return refuse(quiet, L["nom illisible : écris Prénom ou Prénom-Royaume."]) end
  local shown = F.Display(full)
  if Co.IsMember(full) then return refuse(quiet, L("%s est déjà au conseil du butin.", shown)) end
  if Co.IsOfficer(full) then
    setExtra(full, nil)
    if not quiet then ns.print(L("conseil du butin : %s suit de nouveau son rang de guilde.", shown)) end
  else
    setExtra(full, true)
    if not quiet then ns.print(L("conseil du butin : ajout de %s, à la main.", shown)) end
  end
  return true
end

--- Retire un membre du conseil (officiers seulement) : un officier est retiré à la main, un nom ajouté à la main ne
--- l'est plus. Renvoie true, ou false et la raison.
function Co.Remove(name, quiet)
  local ok, why = Co.CanModify()
  if not ok then return refuse(quiet, why) end
  local full = nameOf(name)
  if not full then return refuse(quiet, L["nom illisible : écris Prénom ou Prénom-Royaume."]) end
  local shown = F.Display(full)
  if not Co.IsMember(full) then return refuse(quiet, L("%s n'est pas au conseil du butin.", shown)) end
  -- Officier : retiré à la main (false) ; nom ajouté à la main : suit de nouveau son rang (nil)
  local on = nil
  if Co.IsOfficer(full) then on = false end
  setExtra(full, on)
  if not quiet then ns.print(L("conseil du butin : retrait de %s.", shown)) end
  return true
end

--- Membres de la guilde dont le nom contient ce texte (sans casse ni accents), pas encore au conseil : complétion de
--- « Ajouter un membre » (rang, puis nom ; max au plus)
function Co.Suggest(text, max)
  local d = data()
  local q = F.Fold(F.trim(F.txt(text, 60)))
  if not d or d.none or q == "" then return {} end
  local starts, contains = {}, {}
  for k, m in pairs(d.members) do
    if not Co.IsMember(m.name) then
      local base = F.Fold(F.Split(m.name) or "")
      if base:sub(1, #q) == q or k:sub(1, #q) == q then starts[#starts + 1] = m
      elseif k:find(q, 1, true) then contains[#contains + 1] = m end
    end
  end
  local function order(a, b) if a.rank ~= b.rank then return a.rank < b.rank end return F.Fold(a.name) < F.Fold(b.name) end
  table.sort(starts, order)
  table.sort(contains, order)
  local out = {}
  for _, list in ipairs({ starts, contains }) do
    for _, m in ipairs(list) do if #out < (max or 8) then out[#out + 1] = { name = m.name, class = m.class, rank = m.rank } end end
  end
  return out
end

--- Tout ce que montre Options › Conseil du butin
function Co.Status()
  local d = data()
  local st = { test = test() ~= nil, known = d ~= nil, inGuild = d ~= nil and not d.none, ready = Co.Ready(), guild = d and d.name or nil,
    numRanks = Co.NumRanks(), minRank = Co.MinRank(), configured = Co.Configured(), myRank = Co.MyRank(), ranks = {} }
  for i = 1, st.numRanks do st.ranks[i] = Co.RankName(i) end
  local c = config(false)
  if c and num(c.minRank) then st.setBy, st.setAt = c.by, c.v end
  st.canModify, st.why = Co.CanModify()
  st.members, st.removed = Co.List()
  st.held = #held
  return st
end

--------------------------------------------------------------------------------------------------------------------
-- Lecture de la liste de guilde du jeu
--------------------------------------------------------------------------------------------------------------------
-- Ma guilde : { name, key, rank } ; false : pas dans une guilde ; nil : pas encore connue
local function identity()
  if type(IsInGuild) ~= "function" then return false end
  local okG, inGuild = call(IsInGuild)
  if not okG then return nil end
  if not isTrue(inGuild) then return false end
  local ok, gname, _, rankIndex, realm = call(GetGuildInfo, "player")
  if not (ok and usable(gname) and gname ~= "") then return nil end
  local r = (usable(realm) and realm ~= "") and F.Normalize(realm) or F.MyRealm()
  local name = F.txt(gname, 60)
  return { name = name, key = F.Fold(name .. "-" .. r), rank = num(rankIndex) and math.floor(rankIndex) + 1 or nil }
end
-- Signature du conseil (pour savoir s'il a changé)
local function signature() return Co.MinRank() .. ":" .. table.concat(Co.Members(), ",") end

local dirty = false
--- Lit la liste de guilde du jeu (jamais en combat ni pendant une rencontre : notée à reprendre). Renvoie true si elle
--- a été lue (ou si l'on n'est pas dans une guilde).
function Co.Read()
  if test() then return false end
  if busy() then dirty = true return false end
  dirty = false
  local before = Co.data and signature() or nil
  local id = identity()
  if id == false then
    local was = Co.data
    Co.data = { none = true, at = time() }
    if not (was and was.none) then
      release()
      changed()
    end
    return true
  end
  if not id then
    -- Dans une guilde, pas encore connue (rejointe à l'instant, connexion) : on ne sait plus
    if Co.data and Co.data.none then Co.data = nil serial = serial + 1 end
    return false
  end
  local okN, total = call(GetNumGuildMembers)
  total = okN and num(total) or 0
  if total <= 0 then return false end -- liste pas encore reçue du serveur
  local okR, nRanks = call(GuildControlGetNumRanks)
  nRanks = math.floor((okR and num(nRanks)) or 0)
  local ranks = {}
  for i = 1, math.min(nRanks, 20) do
    local ok, rn = call(GuildControlGetRankName, i)
    if ok and usable(rn) and rn ~= "" then ranks[i] = F.txt(rn, 40) end
  end
  local members, n, top = {}, 0, 0
  for i = 1, math.min(total, Co.MAX_MEMBERS) do
    local ok, name, rankName, rankIndex, _, _, _, _, _, _, _, class = call(GetGuildRosterInfo, i)
    local r = ok and num(rankIndex)
    local full = r and usable(name) and F.FullName(name)
    if full then
      r = math.floor(r) + 1
      members[F.Fold(full)] = { name = full, rank = r, class = (usable(class) and class ~= "") and class or nil }
      if not ranks[r] and usable(rankName) and rankName ~= "" then ranks[r] = F.txt(rankName, 40) end
      n, top = n + 1, math.max(top, r)
    end
  end
  if n == 0 then return false end
  Co.data = { key = id.key, name = id.name, at = time(), ranks = ranks, numRanks = math.max(nRanks, top), members = members, n = n, myRank = id.rank }
  serial = serial + 1
  release()
  if before ~= signature() then changed() end
  if ns.Pages and ns.Pages.Refresh then ns.Pages.Refresh("council") end
  return true
end

-- Lecture un instant après (les GUILD_ROSTER_UPDATE arrivent souvent en rafale)
local due = false
local function readSoon(delay)
  dirty = true
  if due then return end
  if not (C_Timer and C_Timer.After) then ns.safe(L["conseil du butin"], Co.Read) return end
  due = true
  C_Timer.After(delay or Co.READ_DELAY, function()
    due = false
    ns.safe(L["conseil du butin"], Co.Read)
  end)
end
Co.ReadSoon = readSoon

--- Demande la liste de guilde au serveur (au plus toutes les 5 min ; force : 10 s : connexion, arrivée dans un raid, page
--- Options › Conseil du butin), jamais en combat ni en rencontre
local lastAsk = nil
function Co.Ask(force)
  if test() or busy() then return false end
  local okG, inGuild = call(IsInGuild)
  if not (okG and isTrue(inGuild)) then
    if Co.data == nil then readSoon(1) end -- pas encore su : « pas dans une guilde » noté tout de suite
    return false
  end
  local t = time()
  if lastAsk and t - lastAsk < (force and 10 or Co.ASK_EVERY) then return false end
  lastAsk = t
  local api = C_GuildInfo and C_GuildInfo.GuildRoster
  return (call(api))
end

--- Raid d'essai : la guilde fictive a changé (rang d'un joueur)
function Co.TestChanged() changed() end

ns.on("PLAYER_ENTERING_WORLD", function(login, reload)
  encounter = false
  if (login or reload) and C_Timer and C_Timer.After then
    C_Timer.After(5, function() ns.safe(L["conseil du butin"], function() Co.Ask(true) readSoon(1) end) end)
  end
end)
ns.on("GUILD_ROSTER_UPDATE", function(canRequest)
  if not secret(canRequest) and canRequest == true then Co.Ask() end
  readSoon()
end)
ns.on("GUILD_RANKS_UPDATE", function() readSoon(1) end)
ns.on("PLAYER_GUILD_UPDATE", function(unit) if unit == nil or (not secret(unit) and unit == "player") then readSoon(1) end end)
ns.on("PLAYER_REGEN_ENABLED", function() if dirty then readSoon(1) end end)
ns.on("ENCOUNTER_START", function() encounter = true end)
ns.on("ENCOUNTER_END", function()
  encounter = false
  if dirty then readSoon(3) end
end)
-- Arrivée dans un raid : liste de guilde demandée (rangs à jour pour le conseil de ce soir)
local wasRaid = false
ns.on("GROUP_ROSTER_UPDATE", function()
  local raid = Cm.InRaid()
  if raid and not wasRaid then ns.safe(L["conseil du butin"], Co.Ask, true) end
  wasRaid = raid
end)

return Co
