-- Messages entre addons Roster (préfixe RosterRT, champs séparés par « ; », canal du raid ou du groupe) et qui a l'addon.
-- WoW 12.x : pendant une rencontre de boss (et quand le jeu restreint les messages d'addon), SendAddonMessage renvoie
-- AddOnMessageLockdown. Les messages attendent alors dans une file et partent dès que le jeu le permet (fin de rencontre,
-- ADDON_RESTRICTION_STATE_CHANGED, ou nouvel essai toutes les quelques secondes), au rythme permis : 10 messages d'affilée
-- par préfixe, puis 1 par seconde. Aussi : les membres du groupe (noms « Prénom-Royaume ») et le chuchotement à ceux
-- qui n'ont pas l'addon.
local _, ns = ...
local C = {}
ns.Comm = C
local F = ns.Format

local PREFIX = "RosterRT"
C.PREFIX = PREFIX
local secret, usable = F.secret, F.usable
local function db() return ns.db and ns.db() end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function now() return GetTime and GetTime() or time() end
local function call(fn, ...) if not fn then return false end local ok, a, b = pcall(fn, ...) if ok then return true, a, b end return false end

--------------------------------------------------------------------------------------------------------------------
-- Membres du groupe
--------------------------------------------------------------------------------------------------------------------
-- Nom complet du joueur (UnitFullName("player") donne toujours le royaume, sauf avant PLAYER_LOGIN)
function C.Me()
  local ok, name, realm = call(UnitFullName, "player")
  if not (ok and usable(name)) then ok, name = call(UnitName, "player") realm = nil end
  return F.FullName(ok and name or nil, realm) or "?"
end

local function isTrue(v) return not secret(v) and v and true or false end
function C.InRaid() return isTrue(IsInRaid and IsInRaid()) end
function C.InGroup() return isTrue(IsInGroup and IsInGroup()) end
-- Chef du groupe ou assistant (hors groupe : seul, donc oui)
function C.IsLead()
  if not C.InGroup() then return true end
  return isTrue(UnitIsGroupLeader and UnitIsGroupLeader("player")) or isTrue(UnitIsGroupAssistant and UnitIsGroupAssistant("player"))
end
function C.IsLeader() return isTrue(UnitIsGroupLeader and UnitIsGroupLeader("player")) end

-- Membres : liste { name = "Prénom-Royaume" (nil si inconnu ou secret), key, index (raid), subgroup, online, class, rank }
-- et compte par sous-groupe. GetRaidRosterInfo donne « Prénom-Royaume » pour un autre royaume, « Unknown » (UNKNOWNOBJECT)
-- tant que le nom n'est pas dans le cache du jeu (12.0.5).
local function unknown(name) return name == "Unknown" or (UNKNOWNOBJECT ~= nil and name == UNKNOWNOBJECT) end
function C.Roster()
  local list, byKey, counts = {}, {}, { 0, 0, 0, 0, 0, 0, 0, 0 }
  local function add(e)
    list[#list + 1] = e
    if e.key then byKey[e.key] = e end
    if type(e.subgroup) == "number" and counts[e.subgroup] then counts[e.subgroup] = counts[e.subgroup] + 1 end
  end
  if C.InRaid() then
    local n = GetNumGroupMembers and GetNumGroupMembers() or 0
    if secret(n) then n = 0 end
    for i = 1, n do
      local ok, name, rank, subgroup, _, _, class, _, online = pcall(GetRaidRosterInfo, i)
      if ok then
        if secret(subgroup) then subgroup = nil end
        local full = (usable(name) and not unknown(name)) and F.FullName(name) or nil
        add({ name = full, key = full and F.Fold(full), index = i, subgroup = subgroup, online = isTrue(online),
          class = usable(class) and class or nil, rank = not secret(rank) and rank or 0 })
      end
    end
  else
    local units = { "player" }
    local n = GetNumSubgroupMembers and GetNumSubgroupMembers() or 0
    if secret(n) then n = 0 end
    for i = 1, math.min(n, 4) do units[#units + 1] = "party" .. i end
    for _, unit in ipairs(units) do
      local ok, name, realm = call(UnitFullName or UnitName, unit)
      local full = unit == "player" and C.Me() or ((ok and usable(name) and not unknown(name)) and F.FullName(name, realm) or nil)
      local okC, _, class = call(UnitClass, unit)
      local okO, online = call(UnitIsConnected, unit)
      add({ name = full, key = full and F.Fold(full), index = 0, subgroup = 1, online = unit == "player" or not okO or isTrue(online),
        class = okC and usable(class) and class or nil, rank = 0 })
    end
  end
  return list, byKey, counts
end

--------------------------------------------------------------------------------------------------------------------
-- File des messages
--------------------------------------------------------------------------------------------------------------------
local RESULT = (Enum and Enum.SendAddonMessageResult) or {}
local LOCKDOWN = RESULT.AddOnMessageLockdown or 11
local THROTTLED = { [RESULT.AddonMessageThrottle or 3] = true, [RESULT.ChannelThrottle or 8] = true }
local RTYPE = (Enum and Enum.AddOnRestrictionType) or {}
local BURST, MAX_WAIT = 10, 15 * 60
C.PROBE = 10 -- secondes : restriction annoncée hors rencontre, nouvel essai quand même

C.queue = {}
local tokens, tokensAt = BURST, nil
local encounter = false   -- entre ENCOUNTER_START et ENCOUNTER_END
local heldSince = nil     -- file bloquée depuis (nouvel essai forcé au bout de C.PROBE secondes hors rencontre)
local retryAt = nil

-- Le jeu restreint-il les messages d'addon en ce moment ? (rencontre de boss, clé mythique, JcJ, carte, verrou du chat)
-- Si un envoi passe alors que le jeu annonçait une restriction (hors rencontre), ces indications sont ignorées ensuite :
-- seul le résultat de l'envoi (AddOnMessageLockdown) fait alors attendre la file.
local hintsWrong = false
function C.Restricted()
  -- ENCOUNTER_END manqué (sortie de l'instance pendant le combat…) : le jeu dit si une rencontre est en cours
  if encounter and IsEncounterInProgress then
    local ok, r = call(IsEncounterInProgress)
    if ok and not secret(r) and r == false then encounter = false end
  end
  if encounter then return true end
  if hintsWrong then return false end
  if C_ChatInfo then
    local ok, r = call(C_ChatInfo.InChatMessagingLockdown)
    if ok and isTrue(r) then return true end
    ok, r = call(C_ChatInfo.AreOutgoingAddonChatMessagesRestricted)
    if ok and isTrue(r) then return true end
  end
  if C_RestrictedActions and C_RestrictedActions.IsAddOnRestrictionActive then
    for _, t in ipairs({ RTYPE.Encounter or 1, RTYPE.Chat or 5 }) do
      local ok, r = call(C_RestrictedActions.IsAddOnRestrictionActive, t)
      if ok and isTrue(r) then return true end
    end
  end
  return false
end

local function channel()
  -- Groupe formé par la recherche de groupe seulement : canal de l'instance
  if IsInGroup and isTrue(IsInGroup(LE_PARTY_CATEGORY_INSTANCE or 2)) and not isTrue(IsInGroup(LE_PARTY_CATEGORY_HOME or 1)) then return "INSTANCE_CHAT" end
  if C.InRaid() then return "RAID" end
  if C.InGroup() then return "PARTY" end
  return nil
end

local flush
local function retry(delay)
  local at = now() + delay
  if retryAt and retryAt <= at then return end
  retryAt = at
  if C_Timer and C_Timer.After then C_Timer.After(delay, function() retryAt = nil flush() end) end
end

-- Envoi d'un message de la file : true (parti, ou impossible : abandonné), false (à réessayer), et la raison
local function deliver(e)
  local api = C_ChatInfo and C_ChatInfo.SendAddonMessage
  if not api then return true end
  local dist = e.channel or channel()
  if not dist then return true end -- plus en groupe : sans objet
  if dist == "WHISPER" and F.SameName(e.target, C.Me()) then -- à soi-même : traité tout de suite
    C.Deliver(C.Me(), e.msg, "WHISPER")
    return true
  end
  local ok, res = pcall(api, PREFIX, e.msg, dist, e.target)
  if not ok then return true end
  if res == LOCKDOWN then return false, "lockdown" end
  if THROTTLED[res] then return false, "throttle" end
  return true
end

-- Envoie ce que la file peut envoyer maintenant ; s'arrête (nouvel essai programmé) si le jeu bloque ou limite
local function drain()
  local q = C.queue
  while #q > 0 do
    local e = q[1]
    local t = now()
    if t - e.at > MAX_WAIT then table.remove(q, 1) -- trop vieux (raid fini entre-temps)
    else
      -- Allocation du préfixe : 10 messages, +1 par seconde
      tokensAt = tokensAt or t
      tokens = math.min(BURST, tokens + (t - tokensAt))
      tokensAt = t
      if tokens < 1 then retry(1) return end
      local restricted = C.Restricted()
      -- Restriction annoncée hors rencontre depuis quelques secondes : on essaie quand même (le résultat de l'envoi fait foi)
      local probe = restricted and not encounter and heldSince and t - heldSince >= C.PROBE
      if restricted and not probe then heldSince = heldSince or t retry(3) refresh() return end
      local done, why = deliver(e)
      if not done then
        if why == "lockdown" then heldSince = heldSince or t retry(3) refresh() return end
        tokens = 0 retry(1) return
      end
      if probe then hintsWrong = true end
      tokens = tokens - 1
      heldSince = nil
      table.remove(q, 1)
      if e.onSent then ns.safe("message envoyé", e.onSent) end
    end
  end
  heldSince = nil
end
-- Un message ajouté pendant l'envoi (réponse à soi-même, onSent) part avec la boucle en cours
local flushing = false
function flush()
  if flushing then return end
  flushing = true
  local ok, err = pcall(drain)
  flushing = false
  if not ok then error(err, 0) end
end
C.Flush = function() flush() end

-- Envoi : channel (RAID, PARTY, WHISPER…) ou celui du groupe au moment de l'envoi ; onSent appelé quand il est parti
function C.Send(msg, dist, target, onSent)
  if not usable(msg) then return false end
  if not dist and not channel() then return false end
  C.queue[#C.queue + 1] = { msg = msg, channel = dist, target = target, at = now(), onSent = onSent }
  flush()
  return true
end
-- Messages en attente (combat de boss, limite du jeu)
function C.Held() return #C.queue end

--------------------------------------------------------------------------------------------------------------------
-- Réception
--------------------------------------------------------------------------------------------------------------------
local handlers = {}
function C.On(cmd, fn) handlers[cmd] = fn end
function C.Deliver(sender, msg, dist)
  local f = F.split(msg)
  local fn = handlers[f[1]]
  if fn then ns.safe("message " .. tostring(f[1]), fn, sender, f, dist) end
end

local function register()
  if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then call(C_ChatInfo.RegisterAddonMessagePrefix, PREFIX) end
end
register()
ns.on("PLAYER_LOGIN", register)
ns.on("CHAT_MSG_ADDON", function(prefix, text, dist, sender)
  if not (usable(prefix) and usable(text) and usable(sender)) or prefix ~= PREFIX then return end
  local who = F.FullName(sender)
  if who then C.Deliver(who, text, usable(dist) and dist or "RAID") end
end)
ns.on("ENCOUNTER_START", function() encounter = true end)
ns.on("ENCOUNTER_END", function()
  encounter = false
  -- La restriction se lève juste après la fin de la rencontre
  if C_Timer and C_Timer.After then C_Timer.After(1, flush) else flush() end
end)
ns.on("ADDON_RESTRICTION_STATE_CHANGED", function(_, state)
  if not secret(state) and state == 0 then flush() end -- Inactive
end)
ns.on("PLAYER_REGEN_ENABLED", function() if #C.queue > 0 then flush() end end)
ns.on("PLAYER_ENTERING_WORLD", function() encounter = false if #C.queue > 0 then flush() end end)

--------------------------------------------------------------------------------------------------------------------
-- Qui a l'addon : VQ (question) / VR;<version> (réponse de chacun)
--------------------------------------------------------------------------------------------------------------------
C.versions = {}  -- clé du nom → { name, v, at }
C.WAIT = 6       -- secondes : sans réponse passé ce délai, « sans addon »
local function versionKey(v)
  local a, b, c = tostring(v or ""):match("^(%d+)%.(%d+)%.?(%d*)")
  return (tonumber(a) or 0) * 10000 + (tonumber(b) or 0) * 100 + (tonumber(c) or 0)
end
C.versionKey = versionKey

-- auto : question automatique (arrivée dans un raid), au plus une fois toutes les 30 s ; sinon demandée par le joueur
function C.AskVersions(auto)
  if not channel() then
    if not auto then ns.print("il faut être en groupe ou en raid pour voir qui a l'addon.") end
    return false
  end
  if auto and C.lastAsk and now() - C.lastAsk < 30 then return false end
  C.lastAsk = now()
  C.asking, C.askedAt = true, nil
  C.Send("VQ", nil, nil, function() C.asking, C.askedAt = false, now() refresh() if C_Timer and C_Timer.After then C_Timer.After(C.WAIT + 0.5, refresh) end end)
  if not auto then
    ns.print(C.asking and "question prête : elle part au groupe dès la fin du combat de boss." or "question envoyée au groupe : réponses dans l'onglet En raid.")
  end
  refresh()
  return true
end
C.On("VQ", function(sender)
  if F.SameName(sender, C.Me()) then return end
  C.Send("VR;" .. tostring(ns.version or "?"))
end)
C.On("VR", function(sender, f)
  local k = F.Fold(sender)
  C.versions[k] = { name = sender, v = F.txt(f[2], 16), at = now() }
  refresh()
end)

-- Version de chaque membre qui a répondu (moi compris) : nom complet → version
function C.Versions()
  local out = { [C.Me()] = ns.version }
  for _, e in pairs(C.versions) do out[e.name] = e.v end
  return out
end

-- Membres et état : ok (même version ou plus récente), old (plus ancienne), none (pas de réponse : sans addon), wait
function C.Rows()
  local rows, mine, me = {}, versionKey(ns.version), F.Fold(C.Me())
  local list = C.Roster()
  for _, m in ipairs(list) do
    if m.name then
      local v = m.key == me and { v = ns.version } or C.versions[m.key]
      local state
      if v then state = versionKey(v.v) >= mine and "ok" or "old"
      elseif C.askedAt and now() - C.askedAt >= C.WAIT then state = "none"
      else state = "wait" end
      rows[#rows + 1] = { name = m.name, class = m.class, v = v and v.v, state = state, me = m.key == me, whispered = C.whispered[m.key] }
    end
  end
  table.sort(rows, function(a, b) return a.name < b.name end)
  return rows
end

-- Arrivée dans un groupe de raid : on demande qui a l'addon (après quelques secondes, le temps que le groupe se forme)
local wasRaid = false
ns.on("GROUP_ROSTER_UPDATE", function()
  local raid = C.InRaid()
  if raid and not wasRaid and C_Timer and C_Timer.After then C_Timer.After(3, function() C.AskVersions(true) end) end
  wasRaid = raid
end)

--------------------------------------------------------------------------------------------------------------------
-- Chuchoter d'installer Roster, sans lien (choix de Flo, en attendant CurseForge ; sur un clic du chef de raid ou d'un assistant seulement)
--------------------------------------------------------------------------------------------------------------------
C.WHISPER = "Salut ! Pour ce raid, on utilise l'addon Roster (compo, présence, et bientôt le butin) : pense à l'installer."
C.whispered = {} -- clé du nom → heure
function C.Whisper(name)
  local full = F.FullName(name)
  if not full then return false end
  if not (C.InGroup() and C.IsLead()) then ns.print("seul le chef de raid ou un assistant peut chuchoter aux joueurs sans l'addon.") return false end
  -- Pendant une rencontre de boss, le jeu bloque les messages des addons (chat compris)
  local ok, locked = call(C_ChatInfo and C_ChatInfo.InChatMessagingLockdown)
  if encounter or (ok and isTrue(locked)) then ns.print("pas pendant un combat de boss : réessaie juste après.") return false end
  local send = (C_ChatInfo and C_ChatInfo.SendChatMessage) or SendChatMessage
  if not send or not pcall(send, C.WHISPER, "WHISPER", nil, full) then ns.print("le jeu n'a pas permis le message à " .. F.Display(full) .. ".") return false end
  C.whispered[F.Fold(full)] = time()
  ns.print("chuchoté à " .. F.Display(full) .. " : installer l'addon Roster.")
  refresh()
  return true
end

return C
