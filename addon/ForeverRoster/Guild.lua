-- Relève de la guilde (1.6.0) : liste de guilde, journal de guilde, banque de guilde (seulement pendant qu'elle est
-- ouverte), niveau et XP des persos du compte. Relève silencieuse, gardée dans la sauvegarde de l'addon
-- (ForeverRosterDB.guilds ; xp, levels et guild de chaque perso de ForeverRosterDB.chars). Envoi au site (1.6.2) : le
-- texte FRL v1 de chaque guilde (Format.lua, docs/addon-format.md) part avec la synchro (Ctrl+C de l'onglet Synchro et de
-- la synchro rapide, après les persos) et dans la boîte d'envoi de Roster Companion (Companion.lua), seulement quand sa
-- forme stable a changé depuis le dernier envoi. Rien ne part aux autres joueurs. /fr guilde montre ce qui a été relevé
-- et donne le texte à copier.
-- Client de Forever : API de Retail 12.1.5 avec les restrictions de Midnight. Chaque fonction du jeu est cherchée au
-- moment de l'appel (elle peut manquer sur ce client) et appelée sous pcall ; chaque valeur rendue passe par ns.secret /
-- ns.str (Core.lua). Rien n'est demandé ni relu en combat ou pendant une rencontre : c'est remis à la fin.
local _, ns = ...
local L, N = ns.L, ns.N
local K = ns.Kit
local G = {}
ns.Guild = G

local GAP = 10 * 60        -- liste et journal de guilde : demandés au plus toutes les 10 min
local XP_GAP = 60          -- XP : relue au plus une fois par minute
local LOGIN_DELAY = 15     -- secondes après la connexion (le client reçoit d'abord sa guilde)
local WAIT = 10            -- secondes : réponse attendue à une demande de liste ou de journal (sinon lu tel quel)
local BANK_WAIT = 3        -- secondes : réponse attendue pour un onglet de la banque ou un journal (sinon lu tel quel)
local MAX_MEMBERS = 1000   -- une guilde de WoW compte 1000 membres au plus
local MAX_EVENTS = 100     -- journal de guilde : les 100 derniers événements
local MAX_BANK_LOG = 50    -- journal de chaque onglet de la banque, et celui de l'or : 50 lignes au plus
local MAX_TABS = 16        -- onglets de la banque lus au plus (8 sur Retail)
local GUILD_BANKER = 10    -- Enum.PlayerInteractionType.GuildBanker de Retail, si l'énumération manque
local LABEL, BANK_LABEL = N("relève de la guilde"), N("relève de la banque de guilde")

--------------------------------------------------------------------------------------------------------------------
-- Appels au jeu et valeurs rendues
--------------------------------------------------------------------------------------------------------------------
-- Fonction du jeu qui peut manquer (client différent) ou lever une erreur : ses valeurs, sinon rien
local function back(ok, ...) if ok then return ... end end
local function call(fn, ...)
  if type(fn) ~= "function" then return end
  return back(pcall(fn, ...))
end
-- Chaîne lisible et bornée (sans couper un caractère UTF-8), sinon nil (absente, secrète ou d'un autre type)
local function str(v, max)
  v = ns.str(v)
  if v and #v > max then v = v:sub(1, max):gsub("[\192-\255][\128-\191]*$", "") end
  return v
end
-- Nombre lisible, sinon nil
local function num(v)
  if ns.secret(v) or type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then return nil end
  return v
end
-- Vrai lisible (true, ou 1 des anciennes fonctions)
local function yes(v) return not ns.secret(v) and (v == true or v == 1) end
local function me() return str((call(UnitName, "player")), 40) or "" end

-- Clé d'un membre : prénom seul, en minuscules. Le jeu peut renvoyer « Prénom », « Prénom Nom » (nom de famille de
-- Forever : à vérifier sur la bêta) ou « Prénom-Royaume » : le nom brut est gardé tel quel pour l'affichage.
function G.Key(name) return ((name or ""):match("^[^%-%s]+") or ""):lower() end

-- « Il y a » donné par le jeu (années, mois, jours, heures) en heures ; nil si rien n'est lisible
local function hoursAgo(y, mo, d, h)
  y, mo, d, h = num(y), num(mo), num(d), num(h)
  if not (y or mo or d or h) then return nil end
  return (((y or 0) * 12 + (mo or 0)) * 30 + (d or 0)) * 24 + (h or 0)
end
-- Les plus récents d'abord (à égalité, l'ordre du jeu), max au plus
local function newest(list, max)
  table.sort(list, function(a, b)
    if (a.hours or 0) ~= (b.hours or 0) then return (a.hours or 0) < (b.hours or 0) end
    return a.i < b.i
  end)
  for k = #list, max + 1, -1 do list[k] = nil end
  for _, e in ipairs(list) do e.i = nil end
  return list
end

-- Combat ou rencontre en cours : rien n'est demandé ni relu
local encounter = false
local function busy()
  if yes(call(InCombatLockdown)) or yes(call(UnitAffectingCombat, "player")) then return true end
  if encounter then
    -- ENCOUNTER_END manqué (sortie de l'instance pendant le combat…) : le jeu dit si une rencontre est en cours
    local r = call(IsEncounterInProgress)
    if not ns.secret(r) and r == false then encounter = false end
  end
  return encounter or yes(call(IsEncounterInProgress))
end
G.Busy = busy

--------------------------------------------------------------------------------------------------------------------
-- Sauvegarde : une fiche par guilde (une guilde de Forever correspond à un couple règles + faction)
--------------------------------------------------------------------------------------------------------------------
local function guilds()
  ForeverRosterDB.guilds = ForeverRosterDB.guilds or {}
  return ForeverRosterDB.guilds
end
local function inGuild() return yes(call(IsInGuild)) end

-- Guilde du perso connecté (nom donné par le jeu, faction, royaume) : sa fiche (créée au besoin), sa clé, le rang du
-- joueur ; nil si le perso n'est pas dans une guilde ou si le client ne la connaît pas encore
local function current(create)
  if not inGuild() then return nil end
  local name, rank, rankIndex = call(GetGuildInfo, "player")
  name = str(name, 60)
  if not name or name == "" then return nil end
  local faction, realm = str((call(UnitFactionGroup, "player")), 20) or "", str((call(GetRealmName)), 60) or ""
  local key = name .. "-" .. realm .. "-" .. faction
  local g = guilds()[key]
  if not g and create then
    g = { name = name, faction = faction, realm = realm }
    guilds()[key] = g
  end
  if g then ns.charDB().guild = key end
  return g, key, str(rank, 60), num(rankIndex)
end

-- Guilde relevée pour le perso connecté (sans demander au jeu) : fiche et clé
function G.Current()
  local key = ForeverRosterDB and ns.charDB().guild
  return key and guilds()[key], key
end

-- Fiches de guilde qu'aucun perso du compte n'a plus : retirées
local function prune()
  local used = {}
  for _, c in pairs(ForeverRosterDB.chars or {}) do if c.guild then used[c.guild] = true end end
  for key in pairs(guilds()) do if not used[key] then guilds()[key] = nil end end
end

local refresh -- fenêtre /fr guilde à jour après chaque lecture (plus bas)

--------------------------------------------------------------------------------------------------------------------
-- Liste et journal de guilde : demandés au jeu (à la connexion, puis au plus toutes les 10 min), lus à sa réponse
--------------------------------------------------------------------------------------------------------------------
local asked = { roster = 0, events = 0 }        -- dernière demande de cette session
local waiting = { roster = false, events = false }
local pending = {}                              -- remis à la fin du combat : roster, events, xp, bank
local function due(kind, at) return time() - math.max(asked[kind], at or 0) >= GAP end

-- Plusieurs événements d'affilée : une seule lecture, une seconde après le premier
local soon = {}
local function later(what, fn, label)
  if soon[what] then return end
  soon[what] = true
  C_Timer.After(1, function() soon[what] = nil ns.safe(label or LABEL, fn) end)
end

function G.ReadRoster()
  if busy() then pending.roster = true return false end
  local g, _, rank, rankIndex = current(true)
  local total = num((call(GetNumGuildMembers))) or 0
  -- Guilde ou liste pas encore connues du client : redemandée au prochain passage (chaque minute)
  if not g or total < 1 then
    waiting.roster, asked.roster = false, 0
    return false
  end
  local officer = yes(call(C_GuildInfo and C_GuildInfo.CanViewOfficerNote)) or yes(call(CanViewOfficerNote))
  local members = {}
  for i = 1, math.min(total, MAX_MEMBERS) do
    local name, rankName, rIndex, level, _, _, note, onote, online, _, class, _, _, _, _, _, guid = call(GetGuildRosterInfo, i)
    name = str(name, 80)
    if name and name ~= "" then
      local m = { name = name, key = G.Key(name), rank = str(rankName, 60) or "", rankIndex = num(rIndex), level = num(level),
        class = str(class, 20) or "", note = str(note, 200) or "", online = yes(online) or nil, guid = str(guid, 80) }
      -- Note d'officier : seulement si le rang du joueur a le droit de la voir
      if officer then m.onote = str(onote, 200) or "" end
      if m.online then m.hours = 0 else m.hours = hoursAgo(call(GetGuildRosterLastOnline, i)) end
      members[#members + 1] = m
    end
  end
  if #members == 0 then
    waiting.roster, asked.roster = false, 0
    return false
  end
  waiting.roster = false
  table.sort(members, function(a, b) return a.name < b.name end)
  g.roster = { at = time(), by = me(), officer = officer, rank = rank or "", rankIndex = rankIndex, total = total, members = members }
  refresh()
  return true
end

function G.RequestRoster()
  if not inGuild() then return false end
  if busy() then pending.roster = true return false end
  local g = current(false)
  if not due("roster", g and g.roster and g.roster.at) then return false end
  pending.roster = nil
  asked.roster = time()
  local fn = (C_GuildInfo and C_GuildInfo.GuildRoster) or GuildRoster
  if type(fn) ~= "function" then return G.ReadRoster() end -- pas de demande possible : ce que le client a déjà
  waiting.roster = true
  call(fn)
  C_Timer.After(WAIT, function() if waiting.roster then ns.safe(LABEL, G.ReadRoster) end end)
  return true
end

function G.ReadEvents()
  if busy() then pending.events = true return false end
  local g = current(true)
  if not g then
    waiting.events, asked.events = false, 0
    return false
  end
  local total = num((call(GetNumGuildEvents))) or 0
  -- Journal vide alors qu'un journal a déjà été lu : réponse pas encore arrivée, l'ancien est gardé
  if total < 1 and g.events and #(g.events.list or {}) > 0 then return false end
  waiting.events = false
  local list = {}
  for i = 1, math.min(total, 500) do
    local kind, p1, p2, rank, y, mo, d, h = call(GetGuildEventInfo, i)
    kind = str(kind, 20)
    if kind and kind ~= "" then
      list[#list + 1] = { type = kind, p1 = str(p1, 80) or "", p2 = str(p2, 80) or "", rank = num(rank), hours = hoursAgo(y, mo, d, h), i = i }
    end
  end
  g.events = { at = time(), by = me(), total = total, list = newest(list, MAX_EVENTS) }
  refresh()
  return true
end

function G.RequestEvents()
  if not inGuild() then return false end
  if busy() then pending.events = true return false end
  local g = current(false)
  if not due("events", g and g.events and g.events.at) then return false end
  pending.events = nil
  asked.events = time()
  if type(QueryGuildEventLog) ~= "function" then return G.ReadEvents() end
  waiting.events = true
  call(QueryGuildEventLog)
  C_Timer.After(WAIT, function() if waiting.events then ns.safe(LABEL, G.ReadEvents) end end)
  return true
end

-- Chaque minute (et à la connexion) : guilde du perso notée, liste et journal demandés s'il est temps
function G.Tick()
  if not ForeverRosterDB then return end
  if busy() then
    if inGuild() then pending.roster, pending.events = true, true end
    return
  end
  if not inGuild() then ns.charDB().guild = nil return end
  current(true)
  G.RequestRoster()
  G.RequestEvents()
end

--------------------------------------------------------------------------------------------------------------------
-- Niveau et XP des persos du compte
--------------------------------------------------------------------------------------------------------------------
local xpAt = 0
function G.ReadXP(force)
  if busy() then pending.xp = true return false end
  if not force and time() - xpAt < XP_GAP then return false end
  local level = num((call(UnitLevel, "player")))
  if not level or level < 1 then return false end
  xpAt, pending.xp = time(), nil
  ns.charDB().xp = { level = level, xp = num((call(UnitXP, "player"))), max = num((call(UnitXPMax, "player"))), at = time() }
  refresh()
  return true
end

-- Montée de niveau : heure exacte, gardée par perso ; l'XP est relue juste après (UnitLevel peut encore donner l'ancien)
function G.LevelUp(level)
  level = num(level)
  if not level or level < 2 or level > 200 then return end
  local c = ns.charDB()
  c.levels = c.levels or {}
  -- Niveau déjà noté plus haut : autre perso du même nom (supprimé puis recréé), ses niveaux sont oubliés
  for lvl in pairs(c.levels) do if lvl >= level then c.levels[lvl] = nil end end
  c.levels[level] = time()
  later("xp", function() G.ReadXP(true) end)
end

--------------------------------------------------------------------------------------------------------------------
-- Banque de guilde : relevée seulement pendant qu'elle est ouverte. Onglets visibles un par un (QueryGuildBankTab, puis
-- GUILDBANKBAGSLOTS_CHANGED), puis leurs journaux et celui de l'or (QueryGuildBankLog, puis GUILDBANKLOG_UPDATE). Le
-- relevé remplace le précédent au fur et à mesure (dernier relevé seulement) ; un dépôt ou un retrait pendant que la
-- banque est ouverte est relu.
--------------------------------------------------------------------------------------------------------------------
local bankOpen, scan = false, nil
local function slots() return num(MAX_GUILDBANK_SLOTS_PER_TAB) or 98 end
local function moneyTab() return (num(MAX_GUILDBANK_TABS) or 8) + 1 end
local function itemId(link) return link and tonumber(link:match("item:(%d+)")) end

-- Relevé en cours écrit dans la sauvegarde
local function save()
  local items, log = {}, {}
  for tab = 1, scan.ntabs do
    for _, it in ipairs(scan.items[tab] or {}) do items[#items + 1] = it end
    for _, x in ipairs(scan.logs[tab] or {}) do log[#log + 1] = x end
  end
  scan.g.bank = { at = scan.at, by = scan.by, money = scan.money, ntabs = scan.ntabs, tabs = scan.tabs, items = items, log = log, moneyLog = scan.moneyLog }
  refresh()
end

local function readTab(tab)
  local items = {}
  for slot = 1, slots() do
    local id = itemId(str(call(GetGuildBankItemLink, tab, slot), 500))
    if id then
      local _, count = call(GetGuildBankItemInfo, tab, slot)
      items[#items + 1] = { tab = tab, slot = slot, id = id, n = num(count) or 1 }
    end
  end
  scan.items[tab] = items
  scan.tabs[tab].read = true
end

local function readLog(tab)
  local list = {}
  for i = 1, math.min(num((call(GetNumGuildBankTransactions, tab))) or 0, 200) do
    local kind, who, link, count, tab1, tab2, y, mo, d, h = call(GetGuildBankTransaction, tab, i)
    kind = str(kind, 20)
    if kind and kind ~= "" then
      list[#list + 1] = { tab = tab, type = kind, who = str(who, 80) or "", id = itemId(str(link, 500)), n = num(count), tab1 = num(tab1), tab2 = num(tab2),
        hours = hoursAgo(y, mo, d, h), i = i }
    end
  end
  scan.logs[tab] = newest(list, MAX_BANK_LOG)
end

local function readMoneyLog()
  local list = {}
  for i = 1, math.min(num((call(GetNumGuildBankMoneyTransactions))) or 0, 200) do
    local kind, who, amount, y, mo, d, h = call(GetGuildBankMoneyTransaction, i)
    kind = str(kind, 20)
    if kind and kind ~= "" then list[#list + 1] = { type = kind, who = str(who, 80) or "", amount = num(amount), hours = hoursAgo(y, mo, d, h), i = i } end
  end
  scan.moneyLog = newest(list, MAX_BANK_LOG)
end

-- Demande suivante (onglet, puis journaux) ; sans réponse du jeu au bout de quelques secondes, lu tel quel
local function step()
  if not (scan and bankOpen) then return end
  local nxt = table.remove(scan.queue, 1)
  if not nxt then scan.done = true return end
  local token = {}
  scan.current, scan.token = nxt, token
  if nxt.kind == "tab" then call(QueryGuildBankTab, nxt.tab) else call(QueryGuildBankLog, nxt.tab) end
  C_Timer.After(BANK_WAIT, function()
    if scan and scan.token == token then ns.safe(BANK_LABEL, G.ReadStep, false) end
  end)
end

-- Réponse à la demande en cours (answered : le jeu a répondu ; false : lu au bout du délai)
function G.ReadStep(answered)
  local cur = scan and scan.current
  if not (cur and bankOpen) then return end
  if busy() then pending.bank = true return end
  scan.current, scan.token = nil, nil
  if cur.kind == "tab" then
    readTab(cur.tab)
    if not answered then scan.tabs[cur.tab].late = true end
  elseif cur.tab == moneyTab() then readMoneyLog()
  else readLog(cur.tab) end
  scan.money = num((call(GetGuildBankMoney))) or scan.money
  save()
  step()
end

function G.BankOpened()
  if bankOpen and scan then return false end -- deux événements pour la même ouverture
  bankOpen = true
  if busy() then pending.bank = true return false end
  local g = current(true)
  if not g then return false end
  local ntabs = math.min(num((call(GetNumGuildBankTabs))) or 0, MAX_TABS)
  scan = { g = g, at = time(), by = me(), ntabs = ntabs, tabs = {}, items = {}, logs = {}, moneyLog = {}, queue = {}, money = num((call(GetGuildBankMoney))) }
  for tab = 1, ntabs do
    local name, _, viewable = call(GetGuildBankTabInfo, tab)
    -- Onglet que le rang du joueur ne voit pas : noté comme tel, jamais demandé
    scan.tabs[tab] = { name = str(name, 60) or "", visible = yes(viewable) or nil }
    if scan.tabs[tab].visible then scan.queue[#scan.queue + 1] = { kind = "tab", tab = tab } end
  end
  for tab = 1, ntabs do if scan.tabs[tab].visible then scan.queue[#scan.queue + 1] = { kind = "log", tab = tab } end end
  scan.queue[#scan.queue + 1] = { kind = "log", tab = moneyTab() }
  save()
  step()
  return true
end

function G.BankClosed()
  bankOpen, scan, pending.bank = false, nil, nil
end

-- Objets déplacés, déposés ou retirés après la relève, banque toujours ouverte : onglets lus relus (sans nouvelle demande)
function G.RereadBank()
  if not (scan and scan.done and bankOpen) or busy() then return end
  for tab = 1, scan.ntabs do if scan.tabs[tab].read then readTab(tab) end end
  scan.money = num((call(GetGuildBankMoney))) or scan.money
  save()
end

local function bankerType()
  local e = Enum and Enum.PlayerInteractionType
  return (e and num(e.GuildBanker)) or GUILD_BANKER
end

--------------------------------------------------------------------------------------------------------------------
-- Événements
--------------------------------------------------------------------------------------------------------------------
-- Fin du combat ou de la rencontre : ce qui attendait
local function resume()
  if busy() then return end
  if pending.roster then pending.roster = nil if waiting.roster then G.ReadRoster() else G.RequestRoster() end end
  if pending.events then pending.events = nil if waiting.events then G.ReadEvents() else G.RequestEvents() end end
  if pending.xp then G.ReadXP(true) end
  if pending.bank and bankOpen then pending.bank, scan = nil, nil G.BankOpened() end
end

local ticker = false
ns.on("PLAYER_LOGIN", function()
  C_Timer.After(LOGIN_DELAY, function() ns.safe(LABEL, function() G.ReadXP(true) G.Tick() prune() end) end)
  if not ticker and C_Timer.NewTicker then ticker = C_Timer.NewTicker(60, function() ns.safe(LABEL, G.Tick) end) or true end
end)
ns.on("PLAYER_REGEN_ENABLED", function() ns.safe(LABEL, resume) end)
ns.on("ENCOUNTER_START", function() encounter = true end)
ns.on("ENCOUNTER_END", function() encounter = false ns.safe(LABEL, resume) end)
ns.on("PLAYER_ENTERING_WORLD", function() encounter = false end)

ns.on("GUILD_ROSTER_UPDATE", function()
  local g = current(false)
  if waiting.roster or due("roster", g and g.roster and g.roster.at) then later("roster", G.ReadRoster) end
end)
ns.on("GUILD_EVENT_LOG_UPDATE", function()
  local g = current(false)
  if waiting.events or due("events", g and g.events and g.events.at) then later("events", G.ReadEvents) end
end)

ns.on("PLAYER_XP_UPDATE", function() G.ReadXP(false) end)
ns.on("PLAYER_LEVEL_UP", function(level) G.LevelUp(level) end)
ns.on("PLAYER_LOGOUT", function() G.ReadXP(true) end)

ns.on("PLAYER_INTERACTION_MANAGER_FRAME_SHOW", function(kind) if num(kind) == bankerType() then ns.safe(BANK_LABEL, G.BankOpened) end end)
ns.on("PLAYER_INTERACTION_MANAGER_FRAME_HIDE", function(kind) if num(kind) == bankerType() then G.BankClosed() end end)
-- Anciens événements de la banque (Classic, Retail d'avant 10.0) : ignorés si ce client ne les connaît pas
ns.on("GUILDBANKFRAME_OPENED", function() ns.safe(BANK_LABEL, G.BankOpened) end)
ns.on("GUILDBANKFRAME_CLOSED", function() G.BankClosed() end)
ns.on("GUILDBANKBAGSLOTS_CHANGED", function()
  if scan and scan.current and scan.current.kind == "tab" then G.ReadStep(true)
  elseif scan and scan.done then later("bank", G.RereadBank, BANK_LABEL) end
end)
ns.on("GUILDBANKLOG_UPDATE", function()
  if scan and scan.current and scan.current.kind == "log" then G.ReadStep(true) end
end)
ns.on("GUILDBANK_UPDATE_MONEY", function()
  if not (scan and bankOpen) or busy() then return end
  scan.money = num((call(GetGuildBankMoney))) or scan.money
  save()
end)

--------------------------------------------------------------------------------------------------------------------
-- Texte FRL v1 (Format.lua) d'une guilde relevée : la fiche, et les persos du compte qui en sont (avec leur GUID, relevé
-- par l'export du perso : Export.lua)
--------------------------------------------------------------------------------------------------------------------
function G.Data(key)
  local g = key and guilds()[key]
  if not g then return nil end
  local chars = {}
  for ckey, c in pairs(ForeverRosterDB.chars or {}) do
    if c.guild == key and (c.xp or c.levels) then
      local h = c.snapshot and c.snapshot.header
      chars[#chars + 1] = { name = ckey:match("^(.-)%-") or ckey, xp = c.xp, levels = c.levels, guid = h and h.guid }
    end
  end
  table.sort(chars, function(a, b) return a.name < b.name end)
  return { name = g.name, faction = g.faction, realm = g.realm, addon = ns.version, roster = g.roster, events = g.events, bank = g.bank, chars = chars }
end
function G.Text(key, stable)
  local d = G.Data(key)
  return d and ns.Format.BuildFRL(d, stable)
end

--------------------------------------------------------------------------------------------------------------------
-- Envoi au site (1.6.2) : un relevé par guilde, envoyé quand sa forme stable a changé depuis le dernier envoi (Ctrl+C de
-- la synchro, ou accusé de réception de Roster Companion : g.sentSig). Clé dans la boîte d'envoi et les accusés de
-- l'appli : « frl:<guilde>-<royaume>-<faction> ».
--------------------------------------------------------------------------------------------------------------------
G.PREFIX = "frl:"

-- Relevé d'une guilde à envoyer : { key, name, sig, text, g } ; nil s'il n'y a rien de relevé, ou (sauf all) si rien
-- n'a changé depuis le dernier envoi
local function entryOf(key, all)
  local g, d = guilds()[key], G.Data(key)
  if not (d and (d.roster or d.events or d.bank or #d.chars > 0)) then return nil end
  local sig = ns.Format.Hash(ns.Format.BuildFRL(d, true))
  if not all and g.sentSig == sig then return nil end
  return { key = key, name = g.name, sig = sig, text = ns.Format.BuildFRL(d), g = g }
end

-- Relevés à envoyer (all : tous ceux qui ont quelque chose), triés par clé
function G.Pending(all)
  local out = {}
  if not ForeverRosterDB then return out end
  for key in pairs(guilds()) do out[#out + 1] = entryOf(key, all) end
  table.sort(out, function(a, b) return a.key < b.key end)
  return out
end

-- Copié (Ctrl+C) : ces relevés sont sur le site jusqu'au prochain changement
function G.MarkSent(list)
  for _, e in ipairs(list or {}) do e.g.sentSig, e.g.sentAt = e.sig, time() end
end

-- Accusé de réception de Roster Companion (clé « frl:… ») : seulement un accusé pas encore vu (l'appli le redonne à
-- chaque chargement, il ne doit pas remplacer une empreinte plus récente notée par un Ctrl+C). Vrai si le relevé est
-- marqué envoyé.
function G.Ack(key, sig, at)
  local g = ForeverRosterDB.guilds and ForeverRosterDB.guilds[key]
  if not g or g.ackSig == sig then return false end
  g.ackSig = sig
  if g.sentSig == sig then return false end
  g.sentSig, g.sentAt = sig, at
  return true
end

-- Blocs de la boîte d'envoi (Companion.lua) : un par guilde à envoyer. previous : blocs de la boîte précédente ; un bloc
-- dont l'empreinte n'a pas changé est gardé tel quel (même texte), sinon il est remplacé.
function G.Outbox(previous)
  local before, out = {}, {}
  for _, b in ipairs(previous or {}) do
    if type(b) == "table" and b.kind == "frl" and type(b.key) == "string" then before[b.key] = b end
  end
  for _, e in ipairs(G.Pending()) do
    local key = G.PREFIX .. e.key
    local old = before[key]
    if old and old.sig == e.sig and type(old.text) == "string" then out[#out + 1] = old
    else out[#out + 1] = { kind = "frl", key = key, sig = e.sig, text = e.text } end
  end
  return out
end

--------------------------------------------------------------------------------------------------------------------
-- /fr guilde : ce qui a été relevé (diagnostic), son envoi au site, et le relevé à copier
--------------------------------------------------------------------------------------------------------------------
local GOLD, GREY, GREEN = K.GOLD, K.GREY, K.GREEN
local win, copy

local function when(t) return t and t > 0 and date("%d/%m %H:%M", t) or "?" end
local function ago(h)
  if not h then return L["inconnue"] end
  if h < 1 then return L["moins d'une heure"] end
  if h < 24 then return L("il y a %d h", h) end
  return L("il y a %d j %d h", math.floor(h / 24), h % 24)
end
local function coins(c)
  c = math.floor(c)
  return L("%d po %d pa %d pc", math.floor(c / 10000), math.floor(c / 100) % 100, c % 100)
end
local function shown(v) if v == nil or v == "" then return "?" end return tostring(v) end

local function addGuild(li, g)
  local r = g.roster
  li.Add(GOLD .. g.name .. "|r  ·  " .. g.faction .. GREY .. "  ·  " .. g.realm .. "|r" .. (r and r.rank ~= "" and ("\n" .. L("Ton rang : %s", r.rank)) or ""))
  if not r then
    li.Add(GREY .. L["Liste pas encore relevée (demandée à la connexion, puis toutes les 10 min, hors combat)."] .. "|r")
    return
  end
  li.Add(L("Membres : %d lus sur %d (liste relevée le %s)", #r.members, r.total or 0, when(r.at)) .. "\n" ..
    (r.officer and (GREEN .. L["Notes d'officier : visibles (ton rang les voit)"] .. "|r") or (GREY .. L["Notes d'officier : non visibles (ton rang ne les voit pas)"] .. "|r")))
  li.Header(L["5 membres, tels que lus"])
  -- Le perso connecté d'abord (nom avec ou sans nom de famille), puis les premiers de la liste
  local mine, list = G.Key(me()), {}
  for _, m in ipairs(r.members) do if m.key == mine and #list == 0 then list[1] = m end end
  for _, m in ipairs(r.members) do if #list < 5 and m ~= list[1] then list[#list + 1] = m end end
  for _, m in ipairs(list) do
    li.Add(K.colored(m.class, m.name) .. GREY .. "  " .. L("(clé : %s)", m.key) .. "|r\n" .. L("rang %s (%s) · niveau %s · %s · dernière connexion : %s",
      shown(m.rank), shown(m.rankIndex), shown(m.level), shown(m.class), m.online and L["en ligne"] or ago(m.hours)))
  end
end

local function addEvents(li, ev)
  li.Header(L["Journal de guilde"])
  if not ev then li.Add(GREY .. L["Journal pas encore relevé."] .. "|r") return end
  local last = ev.list[1]
  li.Add(L("%d événements gardés sur %d (relevé le %s)", #ev.list, ev.total or #ev.list, when(ev.at)) .. (last and ("\n" ..
    L("Dernier : %s · %s · %s", last.type, last.p1 .. (last.p2 ~= "" and (", " .. last.p2) or ""), ago(last.hours))) or ""))
end

local function addBank(li, b)
  li.Header(L["Banque de guilde"])
  if not b then li.Add(GREY .. L["Pas encore relevée : ouvre la banque de guilde (elle n'est relevée que pendant qu'elle est ouverte)."] .. "|r") return end
  local read, hidden, unread, late = 0, 0, 0, 0
  for tab = 1, b.ntabs or 0 do
    local t = b.tabs[tab]
    if t and not t.visible then hidden = hidden + 1 elseif t and t.read then read = read + 1 if t.late then late = late + 1 end elseif t then unread = unread + 1 end
  end
  li.Add(L("Relevée le %s par %s", when(b.at), shown(b.by)) .. "\n" ..
    L("Onglets : %d lus, %d non visibles (rang), %d pas encore lus", read, hidden, unread) ..
    (late > 0 and ("\n" .. GREY .. L("dont %d lus sans réponse du serveur (peut-être incomplets)", late) .. "|r") or "") .. "\n" ..
    L("Objets : %d · or : %s", #b.items, b.money and coins(b.money) or "?") .. "\n" ..
    L("Journaux : %d mouvements d'objets, %d d'or", #b.log, #b.moneyLog))
end

local function addChar(li)
  li.Header(L["Ton perso"])
  local c, name = ns.charDB(), me()
  local x = c.xp
  if x then
    local pct = (x.max or 0) > 0 and math.floor((x.xp or 0) * 100 / x.max) or 0
    li.Add(L("%s · niveau %d · XP %s / %s (%d %%) · relevée le %s", name, x.level, shown(x.xp), shown(x.max), pct, when(x.at)))
  else
    li.Add(GREY .. L["XP pas encore relevée."] .. "|r")
  end
  local top, n = nil, 0
  for lvl in pairs(c.levels or {}) do n = n + 1 if not top or lvl > top then top = lvl end end
  li.Add(top and L("Niveaux notés : %d (dernier : %d, le %s)", n, top, when(c.levels[top]))
    or (GREY .. L["Aucun niveau noté pour l'instant : l'heure de chaque montée de niveau est notée."] .. "|r"))
end

function G.Refresh()
  if not (win and win:IsShown()) then return end
  local li = win.list
  local g, key = G.Current()
  win.hintText:SetText(GREY .. L["Le relevé part au site avec ta synchro (onglet Synchro ou Roster Companion), seulement quand il a changé. Rien ne part aux autres joueurs."] .. "|r")
  li.Reset()
  li.Header(L["Guilde"])
  if g then addGuild(li, g)
  else li.Add(GREY .. (inGuild() and L["Guilde pas encore relevée : réessaie dans quelques secondes."] or L["Ce perso n'est pas dans une guilde."]) .. "|r") end
  if g then
    addEvents(li, g.events)
    addBank(li, g.bank)
  end
  addChar(li)
  local e = g and entryOf(key, true)
  if e then
    li.Header(L["Envoi au site"])
    local status
    if not g.sentAt then status = L["Pas encore envoyé : il part avec ta prochaine synchro."]
    elseif g.sentSig ~= e.sig then status = L("Envoyé le %s ; changé depuis : il repart avec ta prochaine synchro.", when(g.sentAt))
    else status = L("Envoyé le %s ; rien de nouveau depuis.", when(g.sentAt)) end
    li.Add(status .. "\n" .. GREY .. L["« Copier le relevé » : le texte FRL seul, à coller sur le site (Ctrl+V sur n'importe quelle page)."] .. "|r",
      { { L["Copier le relevé"], 170, function() G.ShowCopy(key) end } })
  end
  li.Done()
end
refresh = function() if win and win:IsShown() then G.Refresh() end end

function G.Show()
  -- Habillage changé depuis la construction (essai hors jeu ; en jeu, changer d'habillage recharge l'interface)
  if not win or win.skin ~= K.site() then
    if win then win:Hide() end
    win = ns.Raid.listWindow("ForeverRosterGuild", L["Relève de la guilde"], 520)
    win.skin = K.site()
  end
  K.front(win)
  win:Show()
  ns.safe(LABEL, G.Tick) -- relève due : demandée maintenant (hors combat)
  G.Refresh()
end

-- Relevé FRL dans une boîte sélectionnable : déjà sélectionné, Ctrl+C (Ctrl+A pour tout resélectionner). Ctrl+C le
-- marque envoyé, comme dans l'onglet Synchro.
function G.ShowCopy(key)
  local entry = entryOf(key, true)
  local text = entry and entry.text or G.Text(key) or ""
  if not copy or copy.skin ~= K.site() then
    if copy then copy:Hide() end
    copy = K.window("ForeverRosterGuildCopy", L["Relevé de la guilde (FRL)"], 560, 330)
    copy.skin = K.site()
    copy.hintText = copy:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    copy.hintText:SetPoint("TOPLEFT", K.gapX(), -34) copy.hintText:SetWidth(540 - K.gapX()) copy.hintText:SetJustifyH("LEFT")
    copy.box = K.textArea(copy, 18, -84, 524, 220)
    copy.box:SetScript("OnTextChanged", function(self, user) if user then self:SetText(copy.value or "") self:HighlightText() end end)
    copy.box:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
    copy.box:SetScript("OnEscapePressed", function() copy:Hide() end)
    copy.box:SetScript("OnKeyDown", function(_, k)
      if k == "C" and IsControlKeyDown and IsControlKeyDown() and copy.entry then
        G.MarkSent({ copy.entry })
        refresh()
      end
    end)
  end
  copy.value, copy.entry = text, entry
  copy.hintText:SetText(L["Le relevé est déjà sélectionné : Ctrl+C pour le copier (Ctrl+A pour tout resélectionner)."] .. "\n" ..
    GREY .. L("%d lignes. Sur le site : Ctrl+V sur n'importe quelle page.", select(2, text:gsub("\n", "\n")) + 1) .. "|r")
  copy.box:SetText(text)
  K.front(copy)
  copy:Show()
  copy.box:SetFocus()
  copy.box:HighlightText()
end

-- Fenêtres (tests hors jeu)
function G.Windows() return win, copy end
