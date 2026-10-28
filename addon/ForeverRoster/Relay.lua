-- Relais des inscriptions faites en jeu (1.6.3) : un joueur sans Roster Companion confie ses clics d'inscription (onglet
-- Raids, rappel de raid) à un officier de la guilde qui a l'appli ; l'officier les garde et les envoie au site dans son
-- propre bloc FRC (lignes V, Export.lua), au /reload ou à la déconnexion. Le site refait ses contrôles (officier, membre,
-- réglage du joueur) et garde le dernier mot (spec B4). Le copier-coller marche toujours : la ligne S du joueur part
-- comme avant.
-- Messages (préfixe FRoster, file de fond de Raid.lua, 255 octets au plus ; docs/addon-format.md) :
--   SUP;<groupe>;<raid>;<statut>;<clic>;<guid>   joueur → GUILD : « mon inscription en jeu » (clic : heure du serveur)
--   SUA;<raid>;<clic>                            officier → joueur, chuchoté au nom complet : « reçue, je la transmets »
--   RLY;<groupe>,<groupe>…                       officier → GUILD : « je transmets pour ces groupes »
-- Joueur : confie si l'appli n'est pas active ici, l'option « Confier… » activée (ForeverRosterDB.confide ~= false) et en
-- guilde ; au clic (1 à 3 s), à la connexion (40 à 60 s : celles pas confiées, ou confiées depuis plus de 6 h) et à
-- l'annonce d'un relais (RLY : 2 à 6 s, au plus une fois par minute) ; 10 SUP au plus d'un coup.
-- Officier : relaie si l'appli est active, l'option « Transmettre… » activée (ForeverRosterDB.relaying ~= false), en
-- guilde, et pour les groupes où un de ses persos est dans la ligne O (officiers, signée). Inscriptions gardées dans
-- ForeverRosterDB.relayed["<prénom>|<raid>"] = { group, raid, status, at, name, guid, got, from, outKey, outSig } ;
-- oubliées à l'accusé de l'appli (Companion.lua), au Ctrl+C de l'export qui les contient, 7 jours après réception ou
-- 24 h après le raid. Fenêtre « Envoyer au site » (hors combat, hors instance, au plus toutes les 30 min).
-- Chaque étape s'écrit au journal du partage (Share.lua : Sh.Log, fenêtre /fr partage). Heure : ns.Group.Now().
local _, ns = ...
local L, N = ns.L, ns.N
local R = {}
ns.Relay = R

local STATUSES = { present = true, late = true, tentative = true, absent = true } -- statuts qu'on choisit en jeu
local MAX_SUP = 10         -- SUP envoyés au plus d'un coup (connexion, RLY)
local RECONFIDE = 6 * 3600 -- confiée depuis plus longtemps, toujours pas réglée : confiée de nouveau
local RLY_GAP = 60         -- RLY entendu : renvoi au plus une fois par minute
local MAX_KEPT = 200       -- inscriptions gardées au plus par l'officier (la plus ancienne reçue sort)
local MAX_LINES = 60       -- lignes V au plus par bloc (le site n'en lit pas plus)
local KEEP_GOT = 7 * 86400 -- gardée au plus 7 jours après réception
local KEEP_RAID = 86400    -- ... et jusqu'à 24 h après le raid
local CLIC_PAST, CLIC_FUTURE = 7 * 86400, 5 * 60 -- heure du clic acceptée : maintenant − 7 j à maintenant + 5 min
local WINDOW_DELAY = 60    -- fenêtre : 1 min après la première inscription pas encore écrite dans la sauvegarde
local WINDOW_GAP = 1800    -- ... au plus toutes les 30 min
local WINDOW_LINES = 5     -- inscriptions nommées dans la fenêtre, puis « et N autres »

--------------------------------------------------------------------------------------------------------------------
-- Outils
--------------------------------------------------------------------------------------------------------------------
local function now() return ns.Group.Now() end
local function first(name) return ns.Group.First(name) end
local function me() return first(UnitName and UnitName("player")) end
local function after(sec, fn)
  if C_Timer and C_Timer.After then C_Timer.After(sec, fn) else fn() end
end
local function jitter(a, b) return (ns.Share and ns.Share.Jitter) and ns.Share.Jitter(a, b) or a end
-- Heure Unix écrite dans un message ou une ligne : chiffres seuls (pas de « %d » : sa taille dépend du système)
local function stamp(t) return tostring(math.floor(tonumber(t) or 0)) end
local function yes(fn)
  local ok, r = pcall(function() return fn ~= nil and fn() end)
  return ok and not ns.secret(r) and r and true or false
end
local function inGuild() return yes(IsInGuild) end
local function inCombat() return yes(InCombatLockdown) end
local function inInstance()
  if type(IsInInstance) ~= "function" then return false end
  local ok, r = pcall(IsInInstance)
  if not ok then return false end
  return ns.secret(r) or r == true or r == 1 -- valeur secrète : prudence, on se croit en instance
end
local function refresh()
  if ns.UI and ns.UI.Refresh then ns.safe(N("affichage"), ns.UI.Refresh) end
  if ns.Minimap and ns.Minimap.Update then ns.safe(N("minicarte"), ns.Minimap.Update) end
end

-- Journal du partage (Share.lua) : une ligne traduite ; certaines ne se disent qu'une fois par session
local noted = {}
local function note(fmt, ...)
  if not (ns.Share and ns.Share.Log) then return end
  local ok, text = pcall(L, fmt, ...)
  ns.Share.Log(ok and text or fmt)
end
local function noteOnce(key, fmt, ...)
  if noted[key] then return end
  noted[key] = true
  note(fmt, ...)
end

local function store()
  ForeverRosterDB.relayed = ForeverRosterDB.relayed or {}
  return ForeverRosterDB.relayed
end
local function keyOf(name, raidId) return first(name) .. "|" .. tostring(raidId) end

-- Raid d'un groupe de mes données (Group.lua), ou nil
local function raidOf(groupId, raidId)
  local g = ForeverRosterDB.groups and ForeverRosterDB.groups[groupId]
  for _, r in ipairs(g and g.raids or {}) do if r.id == raidId then return r, g end end
  return nil, g
end
local function raidName(groupId, raidId)
  local r = raidOf(groupId, raidId)
  return r and r.name or tostring(raidId)
end

-- GUID d'un perso « Player-<serveur>-<hex> », sinon "" (absent, secret ou d'une autre forme)
local function cleanGuid(v)
  v = ns.str(v)
  if v and #v <= 80 and v:match("^Player%-%d+%-%x+$") then return v end
  return ""
end
local function myGuid()
  if type(UnitGUID) ~= "function" then return "" end
  local ok, v = pcall(UnitGUID, "player")
  return ok and cleanGuid(v) or ""
end

--------------------------------------------------------------------------------------------------------------------
-- Réglages et rôles
--------------------------------------------------------------------------------------------------------------------
function R.ConfideOn() return not (ForeverRosterDB and ForeverRosterDB.confide == false) end
function R.RelayOn() return not (ForeverRosterDB and ForeverRosterDB.relaying == false) end
local function appHere() return ns.Companion ~= nil and ns.Companion.Active() end

-- Joueur : mes inscriptions faites en jeu passent par un officier (pas d'appli ici, option activée, en guilde)
function R.CanConfide() return not appHere() and R.ConfideOn() and inGuild() end
-- Officier : je transmets celles des autres (appli active, option activée, en guilde)
function R.Eligible() return appHere() and R.RelayOn() and inGuild() end
-- Un de mes persos est officier de ce groupe (ligne O)
function R.Officer(g)
  local own = ns.Group.MyChars()
  for _, name in ipairs(g and g.officers or {}) do if own[first(name)] then return true end end
  return false
end
-- Pourquoi je ne relaie pas (fenêtre /fr partage) : toutes les raisons qui s'appliquent, des textes N traduits à
-- l'affichage ; vide si je relaie pour au moins un groupe chargé (appli active, option activée, en guilde, officier)
function R.WhyNot()
  local out = {}
  if not appHere() then out[#out + 1] = N("pas d'appli ici") end
  if not R.RelayOn() then out[#out + 1] = N("coupé") end
  if not inGuild() then out[#out + 1] = N("pas en guilde") end
  local officer = false
  for _, g in ipairs(ns.Group.List()) do
    if R.Officer(g) then officer = true break end
  end
  if not officer then out[#out + 1] = N("pas officier") end
  return out
end

--------------------------------------------------------------------------------------------------------------------
-- Joueur : confier mes inscriptions faites en jeu (SUP), « confiée à … » (SUA), renvoi à l'annonce d'un relais (RLY)
--------------------------------------------------------------------------------------------------------------------
local WHY = { click = N("clic"), login = N("connexion"), relay = N("relais annoncé") }

-- Inscription à (re)confier : vivante, pas reçue par le site, pas confiée (ou confiée depuis plus de 6 h)
local function toConfide(s, t)
  return type(s) == "table" and not s.sent and ns.Group.Live(s, t)
    and (type(s.confided) ~= "table" or t - (tonumber(s.confided.at) or 0) > RECONFIDE)
end

-- SUP de l'inscription du perso connecté à ce raid, sur la guilde ; why : "click", "login" ou "relay" (journal)
function R.Confide(raidId, why)
  if not R.CanConfide() then return false end
  local s = (ns.charDB().signups or {})[raidId]
  local t = now()
  if not (type(s) == "table" and STATUSES[s.status] and type(s.group) == "string" and s.group ~= "" and tonumber(s.at))
    or s.sent or not ns.Group.Live(s, t) then return false end
  local msg = table.concat({ "SUP", s.group, raidId, s.status, stamp(s.at), myGuid() }, ";")
  if not ns.Raid.SendLow(msg, "GUILD") then return false end
  s.relayAt = t -- proposée à la guilde : en route pour G.SignUp (un retour au statut du site doit repartir)
  note(N("SUP envoyé sur GUILD (%s) : %s, %s."), L[WHY[why] or WHY.click], raidName(s.group, raidId), ns.Group.StatusLabel(s.status))
  return true
end

-- Clic (G.SignUp) : confiée 1 à 3 s plus tard (un clic qui suit de près part avec le précédent : son statut au moment
-- de l'envoi)
local soon = {}
function R.ConfideSoon(raidId)
  if soon[raidId] or not R.CanConfide() then return false end
  soon[raidId] = true
  after(jitter(1, 3), function()
    soon[raidId] = nil
    ns.safe(N("relais"), R.Confide, raidId, "click")
  end)
  return true
end

-- Mes inscriptions faites en jeu à confier (connexion, RLY entendu), 10 au plus. Renvoie le nombre de SUP envoyés.
function R.ConfidePending(reason)
  if not R.CanConfide() then return 0 end
  local t, ids = now(), {}
  for raidId, s in pairs(ns.charDB().signups or {}) do if toConfide(s, t) then ids[#ids + 1] = raidId end end
  table.sort(ids)
  local n = 0
  for _, raidId in ipairs(ids) do
    if n >= MAX_SUP then break end
    if R.Confide(raidId, reason) then n = n + 1 end
  end
  return n
end

-- SUA chuchoté par un officier : mon inscription (même clic) lui est confiée. Seulement d'un officier du groupe de
-- l'inscription (ligne O de mes données) : un autre joueur ne la fait pas passer pour confiée (ignoré, dit au journal).
-- Le premier reçu ; un nouveau clic l'efface (nouvelle inscription) ; une confiée depuis plus de 6 h, renvoyée, prend la
-- réponse suivante.
local function onAck(name, f, dist)
  if dist ~= "WHISPER" or name == "" then return end
  local raidId, clic = f[2], tonumber(f[3])
  local s = raidId and (ns.charDB().signups or {})[raidId]
  if not (type(s) == "table" and clic and s.at == clic) then return end
  local g = ForeverRosterDB.groups and ForeverRosterDB.groups[s.group]
  local officer = false
  for _, o in ipairs(g and g.officers or {}) do if first(o) == first(name) then officer = true break end end
  if not officer then
    noteOnce("sua\1" .. name .. "\1" .. raidId .. "\1" .. clic, N("SUA de %s ignoré : pas officier de %s."), name,
      g and g.name or tostring(s.group))
    return
  end
  local t = now()
  if type(s.confided) == "table" and t - (tonumber(s.confided.at) or 0) <= RECONFIDE then return end
  s.confided = { by = name, at = t }
  note(N("SUA de %s : inscription à %s confiée."), name, raidName(s.group, raidId))
  refresh()
end

-- RLY entendu : un officier transmet pour ces groupes ; une inscription d'un de ces groupes pas encore confiée repart
local relayHeardAt
local function onRelay(name, f, dist)
  if dist ~= "GUILD" or name == "" or first(name) == me() or not R.CanConfide() then return end
  local groups = {}
  for id in (f[2] or ""):gmatch("[^,]+") do groups[id] = true end
  local t, any = now(), false
  for _, s in pairs(ns.charDB().signups or {}) do
    if toConfide(s, t) and groups[s.group] then any = true break end
  end
  if not any or (relayHeardAt and t - relayHeardAt < RLY_GAP) then return end
  relayHeardAt = t
  note(N("RLY de %s : mes inscriptions pas encore confiées repartent dans quelques secondes."), name)
  after(jitter(2, 6), function() ns.safe(N("relais"), R.ConfidePending, "relay") end)
end

--------------------------------------------------------------------------------------------------------------------
-- Officier : inscriptions confiées par la guilde (SUP), gardées puis écrites dans mon bloc FRC (lignes V)
--------------------------------------------------------------------------------------------------------------------
local REFUSE = {
  app = N("pas de relais ici : Roster Companion inactif"), off = N("pas de relais ici : option coupée"), guild = N("pas de relais ici : pas en guilde"),
  bad = N("message illisible"), group = N("groupe inconnu"), officer = N("je ne suis pas officier de ce groupe"), raid = N("raid inconnu"),
  past = N("raid passé"), status = N("statut inconnu"), member = N("pas dans la liste des membres du groupe"), mine = N("c'est un de mes persos"),
  clic = N("heure du clic hors limites"), guidOther = N("GUID d'un autre membre de la guilde"),
  guidDiff = N("GUID différent de celui de la liste de guilde"), older = N("inscription plus récente déjà gardée"),
}
local function refuse(name, code) note(N("SUP de %s ignoré : %s."), name, L[REFUSE[code]]) end

-- GUID de l'inscrit d'après la liste de guilde relevée (Guild.lua) : si un membre a ce GUID, son prénom doit être celui de
-- l'expéditeur ; GUID absent : celui du seul membre à ce prénom (s'il est connu) ; GUID inconnu de la liste alors que le
-- seul membre à ce prénom en a un autre (un GUID vide de la liste est inconnu) : refusé. Sans liste : tel quel. Renvoie
-- le GUID (ou "") ou nil et le refus.
local function checkGuid(name, guid)
  local g = ns.Guild and ns.Guild.Current and ns.Guild.Current()
  local members = g and g.roster and g.roster.members
  if type(members) ~= "table" or #members == 0 then return guid end
  local key, same, n = first(name), nil, 0
  for _, m in ipairs(members) do
    if guid ~= "" and m.guid == guid then
      if m.key ~= key then return nil, "guidOther" end
      return guid
    end
    if m.key == key then same, n = m, n + 1 end
  end
  local only = n == 1 and same or nil
  if guid == "" then return only and cleanGuid(only.guid) or "" end
  -- Un GUID vide dans la liste (membre relevé sans GUID) compte comme inconnu
  if only and only.guid and only.guid ~= "" and only.guid ~= guid then return nil, "guidDiff" end
  return guid
end

-- Inscriptions gardées, les plus anciennes reçues d'abord (à égalité, par clé : l'ordre des lignes V, donc l'empreinte du
-- perso, ne dépend pas du hasard de pairs), et leurs clés dans le même ordre
local function sorted()
  local list = {}
  for key, e in pairs(ForeverRosterDB and ForeverRosterDB.relayed or {}) do
    if type(e) == "table" then list[#list + 1] = { key = key, e = e } end
  end
  table.sort(list, function(a, b)
    local ga, gb = tonumber(a.e.got) or 0, tonumber(b.e.got) or 0
    if ga ~= gb then return ga < gb end
    return a.key < b.key
  end)
  local entries, keys = {}, {}
  for i, x in ipairs(list) do entries[i], keys[i] = x.e, x.key end
  return entries, keys
end
function R.Pending() return (sorted()) end
function R.Count() return #(sorted()) end

-- Ménage : reçues il y a plus de 7 jours, ou raid de mes données passé depuis plus de 24 h. Sans faire repartir mon perso.
local function prune(t)
  local db = ForeverRosterDB and ForeverRosterDB.relayed
  if not (db and next(db)) then return 0 end
  local drop = {}
  for key, e in pairs(db) do
    local r = type(e) == "table" and raidOf(e.group, e.raid)
    if type(e) ~= "table" or t - (tonumber(e.got) or 0) > KEEP_GOT or (r and (r.time or 0) > 0 and r.time < t - KEEP_RAID) then drop[#drop + 1] = key end
  end
  if #drop == 0 then return 0 end
  ns.Export.Quietly(ns.charDB(), function() for _, key in ipairs(drop) do db[key] = nil end end)
  note(N("Ménage du relais : %d inscription(s) oubliée(s) (reçues il y a plus de 7 jours ou raid passé)."), #drop)
  return #drop
end

-- SUP entendu sur la guilde : contrôles de la spec B3, dans l'ordre ; gardée (le clic le plus récent), puis SUA chuchoté
-- au nom de l'expéditeur tel que le jeu le donne (royaume compris)
local function onSignup(name, f, dist, _, raw)
  if dist ~= "GUILD" or name == "" or first(name) == me() then return end -- l'écho de mes propres messages
  if not R.Eligible() then
    local why = not appHere() and "app" or not R.RelayOn() and "off" or "guild"
    noteOnce("eligible\1" .. why, N("SUP de %s ignoré : %s."), name, L[REFUSE[why]])
    return
  end
  local groupId, raidId, status, clic, guid = f[2] or "", f[3] or "", f[4] or "", tonumber(f[5]), cleanGuid(f[6])
  if not clic or clic ~= math.floor(clic) then return refuse(name, "bad") end
  local t = now()
  local r, g = raidOf(groupId, raidId)
  if not g then return refuse(name, "group") end
  if not R.Officer(g) then return refuse(name, "officer") end
  if not r then return refuse(name, "raid") end
  if (r.time or 0) > 0 and r.time < t - KEEP_RAID then return refuse(name, "past") end
  if not STATUSES[status] then return refuse(name, "status") end
  local key, member = first(name), false
  for _, m in ipairs(g.members or {}) do if first(m) == key then member = true break end end
  if not member then return refuse(name, "member") end
  if ns.Group.MyChars()[key] then return refuse(name, "mine") end
  if clic < t - CLIC_PAST or clic > t + CLIC_FUTURE then return refuse(name, "clic") end
  local why
  guid, why = checkGuid(name, guid)
  if not guid then return refuse(name, why) end
  local db, k = store(), keyOf(name, raidId)
  local old = db[k]
  if type(old) == "table" and (tonumber(old.at) or 0) > clic then return refuse(name, "older") end
  local from = (type(raw) == "string" and raw ~= "") and raw or name
  local new = not (type(old) == "table" and old.at == clic)
  if new then
    db[k] = { group = groupId, raid = raidId, status = status, at = clic, name = name:sub(1, 40), guid = guid, got = t, from = from }
    -- 200 au plus : la plus ancienne reçue sort
    local list, keys = sorted()
    for i = 1, #list - MAX_KEPT do db[keys[i]] = nil end
    note(N("SUP de %s gardé : %s, %s ; SUA chuchoté."), name, raidName(groupId, raidId), ns.Group.StatusLabel(status))
    -- Fenêtre « Envoyer au site » : une minute plus tard (puis vérifiée toutes les 30 s)
    after(WINDOW_DELAY, function() ns.safe(N("relais"), R.Tick) end)
    refresh()
  else
    note(N("SUP de %s redit : SUA chuchoté de nouveau."), name)
  end
  ns.Raid.SendLow("SUA;" .. raidId .. ";" .. stamp(clic), "WHISPER", from)
end

-- Lignes V du bloc FRC du perso connecté (Export.lua) : { "V", groupe, raid, statut, prénom, guid, clic }, les plus
-- anciennes reçues d'abord, 60 au plus ; et les clés et clics de ces inscriptions (Ctrl+C : R.Forget)
local function lineOf(e) return { "V", e.group, e.raid, e.status, e.name, e.guid or "", stamp(e.at) } end
function R.Lines()
  local lines, sent = {}, {}
  local list, keys = sorted()
  for i = 1, math.min(#list, MAX_LINES) do
    lines[i] = lineOf(list[i])
    sent[keys[i]] = list[i].at
  end
  return lines, sent
end

-- Écrites pour l'appli (boîte d'envoi) dans le bloc key d'empreinte sig
function R.MarkOut(key, sig)
  local list = sorted()
  for i = 1, math.min(#list, MAX_LINES) do list[i].outKey, list[i].outSig = key, sig end
end

-- Lignes V écrites dans le bloc key d'empreinte sig (pour reconnaître ce bloc sur un autre perso que le connecté)
function R.Written(key, sig)
  local lines = {}
  for _, e in ipairs((sorted())) do
    if e.outKey == key and e.outSig == sig then lines[#lines + 1] = lineOf(e) end
  end
  return lines
end

-- Accusé de l'appli pour le bloc key d'empreinte sig : ses inscriptions sont sur le site, oubliées (un accusé revu ne
-- trouve plus rien). Appelé dans Export.Quietly : le perso ne repart pas. Renvoie le nombre d'oubliées.
function R.Ack(key, sig)
  local db, n = ForeverRosterDB.relayed, 0
  for k, e in pairs(db or {}) do
    if type(e) == "table" and e.outKey == key and e.outSig == sig then db[k] = nil n = n + 1 end
  end
  if n > 0 then note(N("Accusé de l'appli : %d inscription(s) relayée(s) reçue(s) par le site, oubliée(s)."), n) end
  return n
end

-- Ctrl+C d'un export qui les contient (sent : clés et clics, R.Lines) : oubliées, si leur clic n'a pas changé depuis
function R.Forget(sent)
  local db, n = ForeverRosterDB.relayed, 0
  for k, at in pairs(sent or {}) do
    local e = db and db[k]
    if type(e) == "table" and e.at == at then db[k] = nil n = n + 1 end
  end
  if n > 0 then note(N("Export copié : %d inscription(s) relayée(s) oubliée(s)."), n) end
  return n
end

--------------------------------------------------------------------------------------------------------------------
-- Officier : annonce (RLY), fenêtre « Envoyer au site », ménage
--------------------------------------------------------------------------------------------------------------------
local announced, loginReady = false, false

-- RLY;<groupes où je suis officier> sur la guilde (identifiants coupés pour tenir dans 255 octets) ; rien si je ne suis
-- officier d'aucun groupe ou pas éligible
function R.Announce()
  if not R.Eligible() then return false end
  local ids = {}
  for id, g in pairs(ForeverRosterDB.groups or {}) do
    if type(id) == "string" and id ~= "" and not id:find("[;,|]") and R.Officer(g) then ids[#ids + 1] = id end
  end
  table.sort(ids)
  local msg, n = "RLY;", 0
  for _, id in ipairs(ids) do
    local add = (n > 0 and "," or "") .. id
    if #msg + #add > 255 then break end
    msg, n = msg .. add, n + 1
  end
  if n == 0 or not ns.Raid.SendLow(msg, "GUILD") then return false end
  announced = true
  note(N("RLY envoyé sur GUILD : %d groupe(s)."), n)
  return true
end

-- Texte de la fenêtre : nombre, puis prénom, statut, raid et date (5 lignes au plus), puis la question
local function windowText(list)
  local n = #list
  local lines = { n > 1 and L("%d inscriptions faites en jeu par la guilde t'ont été confiées :", n)
    or L("%d inscription faite en jeu par la guilde t'a été confiée :", n) }
  for i = 1, math.min(n, WINDOW_LINES) do
    local e = list[i]
    local r = raidOf(e.group, e.raid)
    local raid, status = r and r.name or "?", ns.Group.StatusLabel(e.status)
    lines[#lines + 1] = (r and (r.time or 0) > 0) and L("%s : %s (%s, %s)", e.name, status, raid, date("%d/%m", r.time)) or L("%s : %s (%s)", e.name, status, raid)
  end
  local more = n - WINDOW_LINES
  if more > 0 then lines[#lines + 1] = more > 1 and L("et %d autres", more) or L("et %d autre", more) end
  lines[#lines + 1] = ""
  lines[#lines + 1] = n > 1 and L["Les envoyer au site maintenant ? L'interface se recharge (quelques secondes), puis Roster Companion les transmet."]
    or L["L'envoyer au site maintenant ? L'interface se recharge (quelques secondes), puis Roster Companion la transmet."]
  return table.concat(lines, "\n")
end
function R.WindowText() return windowText((sorted())) end

-- Toutes les 30 s (et une minute après chaque nouvelle inscription gardée) : ménage ; annonce si je deviens éligible
-- pendant la session (appli vue après la connexion) ; fenêtre si une inscription gardée pas encore écrite dans la
-- sauvegarde a été reçue il y a au moins une minute, hors combat, hors instance, au plus toutes les 30 min
local windowAt
function R.Tick()
  local t = now()
  prune(t)
  if not R.Eligible() then return end
  if loginReady and not announced then R.Announce() end
  if windowAt and t - windowAt < WINDOW_GAP then return end
  local list, due = sorted(), false
  for _, e in ipairs(list) do
    if not e.outSig and t - (tonumber(e.got) or t) >= WINDOW_DELAY then due = true break end
  end
  if not due or inCombat() or inInstance() or not (ns.UI and ns.UI.AskReload) then return end
  windowAt = t
  ns.UI.AskReload(windowText(list), L["Envoyer au site"])
  note(N("Fenêtre du relais affichée : %d inscription(s) à envoyer au site."), #list)
end

ns.Raid.On("SUP", function(...) ns.safe(N("relais"), onSignup, ...) end)
ns.Raid.On("SUA", function(...) ns.safe(N("relais"), onAck, ...) end)
ns.Raid.On("RLY", function(...) ns.safe(N("relais"), onRelay, ...) end)

-- Connexion : RLY 30 à 50 s après (si éligible), mes inscriptions à confier 40 à 60 s après, vérification toutes les 30 s
ns.on("PLAYER_LOGIN", function()
  announced, loginReady = false, false
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(30, function() ns.safe(N("relais"), R.Tick) end) end
  after(jitter(30, 50), function()
    loginReady = true
    if not announced then ns.safe(N("relais"), R.Announce) end
  end)
  after(jitter(40, 60), function() ns.safe(N("relais"), R.ConfidePending, "login") end)
end)
