-- Roster Companion (lot K1) : l'appli (en option) qui fait la synchro sans copier-coller.
-- Jeu → site : à la déconnexion (et au /reload), l'addon range dans sa sauvegarde les blocs à envoyer (outbox : persos,
-- relevé de chaque guilde depuis 1.6.2, bilans) ; l'appli les lit et les envoie. Site → jeu : l'appli écrit les données
-- des groupes et les accusés de réception dans l'addon ForeverRoster_Data (variable ForeverRosterData), lu à la connexion
-- et au /reload.
-- Actualisation sans /reload (1.4) : l'appli copie aussi ses données dans ForeverRoster_Data1 à 20, chargés à la demande.
-- Le jeu lit leurs fichiers au moment du chargement : chaque copie donne une actualisation, une seule fois par session
-- (le /reload remet tout à zéro). Le jeu ne voit pas les fichiers créés après son lancement (vérifié sur Forever) :
-- l'addon ne peut pas savoir quand l'appli a du nouveau, il charge donc aux moments utiles (1.5) : ouverture de la
-- fenêtre, 30 et 5 min avant un raid, appel, entrée en raid, et au moins toutes les heures (1.5.1) ; et à la demande
-- (bouton, touche, /fr actualiser). Les 20 copies utilisées : le jeu interdit à un addon de recharger l'interface tout
-- seul (il faut un clic ou une touche), l'addon le propose donc dans sa propre fenêtre, au plus une fois par heure.
-- Sans l'appli, rien ne change : la synchro rapide et le copier-coller restent là.
local _, ns = ...
local L, N = ns.L, ns.N
local C = {}
ns.Companion = C

local ACTIVE_DAYS = 3
local SLOTS = 20           -- ForeverRoster_Data1 à 20 (9 avec l'appli 0.1.0 : les autres sont simplement absentes)
local AUTO_GAP = 2 * 60    -- actualisation toute seule seulement si la dernière (ou la connexion) date d'au moins 2 min
local RAID_MOMENTS = { 30, 5 } -- minutes avant un raid
local HOURLY = 3600        -- mode passif : au moins une actualisation par heure, et la proposition de recharger au plus une fois par heure
local dead = {}            -- copies absentes ou refusées pendant cette session
local refreshedAt = 0      -- connexion ou dernière actualisation (cette session)
local afterCombat = false
local momentsDone = {}     -- moments « avant le raid » déjà passés (cette session)
local exhaustedSaid = false
local reloadOfferedAt = 0

-- Données déposées par l'appli (format 1, docs/addon-format.md), ou nil
function C.Data()
  local d = rawget(_G, "ForeverRosterData")
  if type(d) == "table" and d.v == 1 then return d end
end

local function state()
  ForeverRosterDB.companion = ForeverRosterDB.companion or {}
  return ForeverRosterDB.companion
end

-- L'appli tourne : elle a écrit ses données il y a moins de 3 jours (sinon, retour au copier-coller)
function C.Active()
  local seen = ForeverRosterDB and ForeverRosterDB.companion and ForeverRosterDB.companion.seen
  return seen ~= nil and time() - seen < ACTIVE_DAYS * 86400
end

-- Accusés de réception : le site a reçu ces blocs (perso : empreinte envoyée ; relevé de guilde : empreinte de sa forme
-- stable ; bilan : date de mise à jour envoyée)
local function applyAcks(acks, at)
  if type(acks) ~= "table" then return 0 end
  local n = 0
  for key, sig in pairs(acks) do
    if type(key) == "string" and type(sig) == "string" then
      local raidId, guildKey = key:match("^frb:(.+)$"), key:match("^frl:(.+)$")
      if guildKey then
        if ns.Guild.Ack(guildKey, sig, at) then n = n + 1 end
      elseif raidId then
        local log = ForeverRosterDB.raidLogs and ForeverRosterDB.raidLogs[raidId]
        local t = tonumber(sig)
        if log and t and (log.sentAt or 0) < t then log.sentAt = t n = n + 1 end
      else
        local c = ForeverRosterDB.chars and ForeverRosterDB.chars[key]
        -- Seulement un accusé pas encore vu : les données de l'appli le gardent, il revient à chaque chargement et ne
        -- doit pas remplacer une empreinte plus récente (Ctrl+C, inscription oubliée sans renvoi : 1.5.4)
        if c and c.ackSig ~= sig then
          c.ackSig = sig
          if c.sentSig ~= sig then c.sentSig, c.sentAt = sig, at n = n + 1 end
        end
        if c then ns.safe(N("inscriptions"), ns.Group.MarkReceived, c, sig, at) end
      end
    end
  end
  return n
end

-- À la connexion (et à chaque actualisation) : accusés, puis données des groupes si elles sont plus récentes que
-- celles déjà chargées. Groupe par groupe (1.5.9, Group.LoadNewer) : un groupe dont j'ai déjà une version aussi récente
-- (reçue d'un joueur par le partage, l'appli ayant relevé le site avant lui) reste ; un groupe absent des données de
-- l'appli disparaît. Renvoie le nombre de groupes pris à l'appli (0 : plus aucun groupe), nil si rien n'a été chargé.
function C.Apply()
  local d = C.Data()
  if not d then return end
  local st = state()
  local at = tonumber(d.at) or time()
  st.seen, st.app = at, ns.Format.txt(d.app, 20)
  applyAcks(d.acks, at)
  if type(d.report) == "table" then
    local items = {}
    for i, v in ipairs(type(d.report.items) == "table" and d.report.items or {}) do if i <= 12 then items[#items + 1] = ns.Format.txt(v, 60) end end
    st.report = { at = tonumber(d.report.at) or at, items = items }
  end
  local frgAt = tonumber(d.frgAt) or 0
  local last = math.max(st.frgAt or 0, ForeverRosterDB.lastLoad and ForeverRosterDB.lastLoad.at or 0)
  local taken
  if type(d.frg) == "string" and frgAt > last then
    if d.frg == "" then
      -- Plus aucun groupe dans ce jeu
      wipe(ForeverRosterDB.groups or {})
      st.frgAt = frgAt
      ForeverRosterDB.lastLoad = { at = frgAt, none = true, companion = true }
      taken = 0
    else
      local ok, n = ns.Group.LoadNewer(d.frg, "companion")
      if ok then
        local raids, patterns = 0, 0
        for _, g in ipairs(ok) do raids = raids + #g.raids for _ in pairs(g.patterns) do patterns = patterns + 1 end end
        st.frgAt = frgAt
        ForeverRosterDB.lastLoad = { at = frgAt, groups = #ok, raids = raids, patterns = patterns, companion = true }
        taken = n
      end
    end
  end
  ns.safe(N("inscriptions"), ns.Group.Reconcile) -- accusés reçus : inscriptions faites en jeu à oublier
  if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
  return taken
end

-- Dernier chargement des données du site (ForeverRosterDB.lastLoad), en texte dans la langue de l'interface :
-- groupes (groups, raids, patterns), compo d'un raid (compo), plus aucun groupe (none) ; text : sauvegarde plus ancienne (texte en français)
function C.LoadText(last)
  if not last then return "" end
  if last.groups then return L("%d groupe(s), %d raid(s), %d patron(s) suivis", last.groups, last.raids or 0, last.patterns or 0) end
  if last.compo then return L("compo « %s » (onglet Compo)", last.compo) end
  if last.none then return L["aucun groupe"] end
  return last.text or ""
end

-- Fonctions de chargement : C_AddOns (clients récents) ou globales (Classic), cherchées à l'appel
local function addonApi(name) return (C_AddOns and C_AddOns[name]) or _G[name] end
local function isLoaded(name) local f = addonApi("IsAddOnLoaded") return f ~= nil and f(name) and true or false end
local function slotName(i) return "ForeverRoster_Data" .. i end

-- Copies encore chargeables dans cette session
function C.SlotsLeft()
  if not addonApi("LoadAddOn") then return 0 end
  local info, n = addonApi("GetAddOnInfo"), 0
  for i = 1, SLOTS do
    local name = slotName(i)
    if not dead[name] and not isLoaded(name) then
      if not info then n = n + 1
      else
        local ok, _, _, _, _, reason = pcall(info, name)
        if ok and reason ~= "MISSING" and reason ~= "DISABLED" then n = n + 1 end
      end
    end
  end
  return n
end

local function remaining(n)
  if n == 0 then return " " .. L["C'était la dernière actualisation possible avant un /reload."] end
  return " " .. (n > 1 and L("Encore %d actualisations possibles avant un /reload.", n) or L("Encore %d actualisation possible avant un /reload.", n))
end

-- Charge la copie suivante et applique ses données. Renvoie : copie chargée, message, données des groupes changées.
function C.Refresh()
  if not C.Active() then
    return false, L["Roster Companion n'a rien déposé récemment : pour charger les données du site, colle-les dans l'onglet Synchro."]
  end
  if InCombatLockdown() then
    afterCombat = true
    return false, L["actualisation à la fin du combat."]
  end
  local load = addonApi("LoadAddOn")
  if not load then return false, L["ce client ne permet pas de charger les données sans /reload."] end
  local d0 = C.Data()
  local at0, frg0 = d0 and tonumber(d0.at) or 0, state().frgAt or 0
  for i = 1, SLOTS do
    local name = slotName(i)
    if not dead[name] and not isLoaded(name) then
      local ok, loaded = pcall(load, name)
      if ok and loaded then
        refreshedAt = time()
        local taken = C.Apply()
        local d, changed = C.Data(), (state().frgAt or 0) > frg0
        local msg
        if changed then
          msg = L("données du site actualisées : %s.", ForeverRosterDB.lastLoad and C.LoadText(ForeverRosterDB.lastLoad) or L["groupes"])
          -- Données neuves : partagées avec la guilde et le raid (blocs signés par le site, Group.lua), seulement si un
          -- groupe au moins vient de l'appli (1.5.9 : un groupe gardé, plus récent, a déjà été annoncé par son auteur)
          if (taken or 0) > 0 and ns.Group.ShareNew then ns.Group.ShareNew() end
        elseif d and (tonumber(d.at) or 0) > at0 then
          msg = L["envois confirmés par le site, rien de nouveau dans les groupes."]
        else
          local at = d and tonumber(d.at)
          msg = at and L("rien de nouveau (dernières données de l'appli : %s).", date(L["%d/%m à %H:%M"], at)) or L["rien de nouveau."]
        end
        return true, msg .. remaining(C.SlotsLeft()), changed
      end
      dead[name] = true
    end
  end
  return false, L["plus d'actualisation possible dans cette session : /reload pour recharger les données du site."]
end

-- Actualisation toute seule (moments utiles) : rien si l'appli n'est pas là ou si la dernière actualisation est trop
-- récente ; message seulement s'il y a du nouveau, pour ne pas encombrer le chat
function C.AutoRefresh(reason)
  if not C.Active() or time() - refreshedAt < AUTO_GAP then return false end
  if C.SlotsLeft() == 0 then
    if reason ~= "window" then
      if not exhaustedSaid then
        exhaustedSaid = true
        ns.print(L["les 20 actualisations sans /reload de cette session sont utilisées : « Synchroniser » (onglet Synchro) ou /reload pour repartir."])
      end
      C.OfferReload()
    end
    return false
  end
  local ok, msg, changed = C.Refresh()
  if ok and changed then
    ns.print(msg)
    if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
  end
  return ok
end

-- Moments « avant le raid » : 30 et 5 min avant chaque raid chargé (fenêtre de 2 min, vérifiée toutes les 30 s)
function C.Tick()
  if not C.Active() then return end
  local now = time()
  -- Mode passif : au moins une actualisation par heure
  if now - refreshedAt >= HOURLY then C.AutoRefresh("hourly") end
  if not ns.Group or not ns.Group.Raids then return end
  for _, e in ipairs(ns.Group.Raids()) do
    local t = tonumber(e.raid.time) or 0
    if t > now then
      for _, m in ipairs(RAID_MOMENTS) do
        local key, at = e.raid.id .. ":" .. m, t - m * 60
        if not momentsDone[key] and now >= at then
          momentsDone[key] = true
          if now < at + 120 then C.AutoRefresh("raid") end
        end
      end
    end
  end
end

-- Bouton « Charger les nouveautés », sa touche et /fr actualiser
function C.RefreshCommand()
  local _, msg = C.Refresh()
  ns.print(msg)
  if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
end

-- Les 20 copies utilisées : fenêtre de l'addon « Recharger / Plus tard » (le clic permet le rechargement), hors combat,
-- au plus une fois par heure. Pas de StaticPopup : réassigner StaticPopupDialogs (variable de l'interface de Blizzard)
-- « contamine » l'interface du jeu (taint), qui bloque alors des actions de Blizzard au nom de l'addon (1.5.1).
function C.OfferReload()
  if InCombatLockdown() or time() - reloadOfferedAt < HOURLY or not (ns.UI and ns.UI.AskReload) then return false end
  reloadOfferedAt = time()
  ns.UI.AskReload(L["Les 20 actualisations sans /reload de cette session sont utilisées.\nRecharger l'interface pour recevoir les nouveautés du site (et envoyer tes persos) ?"])
  return true
end

-- Bouton « Synchroniser », sa touche et /fr synchroniser : le rechargement de l'interface écrit la sauvegarde
-- (l'appli envoie au site dans les secondes qui suivent) et recharge les données de l'appli. Pas en combat.
function C.Reload()
  if InCombatLockdown() then
    ns.print(L["pas de synchronisation en combat : réessaie à la fin du combat."])
    return false
  end
  ReloadUI()
  return true
end

-- À la déconnexion et au /reload (le jeu écrit la sauvegarde juste après) : blocs à envoyer par l'appli.
-- Écrit même sans appli : peu de place (seulement ce qui a changé), et l'appli installée plus tard a tout de suite de quoi envoyer.
-- Relevé de guilde (1.6.2) : un bloc par guilde, gardé tel quel tant que sa forme stable ne change pas (Guild.Outbox) ;
-- XP relue juste avant (sinon celle d'avant la déconnexion partirait).
function C.WriteOutbox()
  local blocks = ns.Export.Outbox()
  ns.safe(N("relève de la guilde"), function()
    ns.Guild.ReadXP(true)
    for _, b in ipairs(ns.Guild.Outbox(ForeverRosterDB.outbox and ForeverRosterDB.outbox.blocks)) do blocks[#blocks + 1] = b end
  end)
  for _, log in ipairs(ns.Recorder.Pending()) do
    blocks[#blocks + 1] = { kind = "frb", key = "frb:" .. log.raidId, sig = tostring(log.updated or 0), lead = ns.Recorder.IsLead(log), text = ns.Recorder.Block(log) }
  end
  ForeverRosterDB.outbox = { v = 1, at = time(), addon = ns.version, blocks = blocks }
end

-- Compte rendu de l'appli (écrit en français par l'appli) : « bilan de « Raid » » et « relevé de la guilde « Guilde » »
-- traduits à l'affichage, prénoms tels quels
local function reportItem(s)
  local raid, rest = tostring(s):match("^bilan de « (.-) »(.*)$") -- nolocale (texte de l'appli)
  if raid then return L("bilan de « %s »", raid) .. rest end
  local guild, more = tostring(s):match("^relevé de la guilde « (.-) »(.*)$") -- nolocale (texte de l'appli)
  if guild then return L("relevé de la guilde « %s »", guild) .. more end
  return s
end

-- Ligne de l'onglet Synchro quand l'appli s'en occupe
function C.StatusText(color)
  local st = state()
  local parts = {}
  if st.report and st.report.at then
    local when, items = date(L["%d/%m à %H:%M"], st.report.at), {}
    for i, v in ipairs(st.report.items) do items[i] = reportItem(v) end
    parts[#parts + 1] = #items > 0 and L("envoyés le %s : %s.", when, table.concat(items, ", ")) or L("envoyés le %s.", when)
  end
  if st.frgAt then parts[#parts + 1] = L("Données du site chargées : %s.", date(L["%d/%m à %H:%M"], st.frgAt)) end
  return (color or "") .. L["Roster Companion s'en occupe"] .. "|r" .. (#parts > 0 and (" · " .. table.concat(parts, " ")) or "")
end

ns.on("PLAYER_LOGIN", function()
  refreshedAt = time()
  ns.safe("Roster Companion", C.Apply)
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(30, function() ns.safe("Roster Companion", C.Tick) end) end
end)
ns.on("PLAYER_REGEN_ENABLED", function()
  if afterCombat then afterCombat = false ns.safe("Roster Companion", C.RefreshCommand) end
end)
-- Appel (ready check), entrée dans un groupe de raid ou dans une instance de raid
ns.on("READY_CHECK", function() ns.safe("Roster Companion", C.AutoRefresh, "ready") end)
local wasInRaid = false
ns.on("GROUP_ROSTER_UPDATE", function()
  local inRaid = IsInRaid and IsInRaid() or false
  if inRaid and not wasInRaid then ns.safe("Roster Companion", C.AutoRefresh, "raid") end
  wasInRaid = inRaid
end)
ns.on("PLAYER_ENTERING_WORLD", function()
  if not IsInInstance then return end
  local _, kind = IsInInstance()
  if kind == "raid" then ns.safe("Roster Companion", C.AutoRefresh, "instance") end
end)
ns.on("PLAYER_LOGOUT", function() ns.safe("Roster Companion", C.WriteOutbox) end)
