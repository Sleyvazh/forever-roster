-- Sorties donjon (1.6.1) : groupes de 5 du jour et de demain, venus du site dans les blocs FRG (lignes X, Format.lua).
-- Onglet « Sorties » de la fenêtre (UI.lua) et, au bon moment, un bandeau : chez le créateur (un de mes persos),
-- « <Donjon> à <heure>, complet » et « Inviter les N » ; chez un inscrit, « Chuchoter <créateur> ». Le bandeau paraît
-- 15 min avant l'heure (sortie « dès que complet » : dès qu'elle est complète), une fois par sortie, jamais en combat ni
-- pendant une rencontre. Rien n'est envoyé aux autres joueurs (ni chat, ni message d'addon) ; l'inscription se fait sur
-- le site ou sur Discord (v1). Mes persos sont reconnus par leur prénom (Group.MyChars).
local _, ns = ...
local L, N = ns.L, ns.N
local K = ns.Kit
local O = {}
ns.Outings = O

local SOON = 15 * 60  -- bandeau : 15 min avant l'heure…
local LATE = 60 * 60  -- … et jusqu'à 1 h après (ensuite le groupe est fait ou la sortie est tombée)
local KEEP = 2 * 3600 -- une sortie disparaît 2 h après son heure (comme sur le site)
local TICK = 30       -- s : bandeau vérifié toutes les 30 s
local DAY = 86400
local LABEL = N("sorties")
local GOLD, GREY, GREEN = K.GOLD, K.GREY, K.GREEN
local ROLES = { "Tank", "Heal", "DPS" }
local ROLE_NAME = { Tank = N("Tank"), Heal = N("Heal"), DPS = N("DPS") }
local ONLINE, OFFLINE = { 0.25, 0.83, 0.25 }, { 0.45, 0.47, 0.52 }

--------------------------------------------------------------------------------------------------------------------
-- Outils
--------------------------------------------------------------------------------------------------------------------
-- Fonction du jeu qui peut manquer ou lever une erreur : ses valeurs, sinon rien
local function back(ok, ...) if ok then return ... end end
local function call(fn, ...)
  if type(fn) ~= "function" then return end
  return back(pcall(fn, ...))
end
local function yes(v) return not ns.secret(v) and (v == true or v == 1) end
-- Prénom seul, en minuscules (« Greta Coulé », « Greta-Forever EU » → greta) ; « @pseudo » reste tel quel
local function key(name) return ((ns.text(name):gsub("^%s+", "")):match("^[^%-%s]+") or ""):lower() end
local function manual(name) return name:sub(1, 1) == "@" end
local function roleName(role) return ROLE_NAME[role] and L[ROLE_NAME[role]] or role end

-- Combat ou rencontre en cours (Guild.lua suit ENCOUNTER_START / ENCOUNTER_END) : ni bandeau ni invitation
local function busy()
  if ns.Guild and ns.Guild.Busy then return ns.Guild.Busy() end
  return yes(call(InCombatLockdown))
end
O.Busy = busy

-- Minuit (heure locale) du jour de t ; jour de t : 0 aujourd'hui, 1 demain, sinon nil
local function midnight(t)
  local d = date("*t", t)
  return t - ((d.hour or 0) * 3600 + (d.min or 0) * 60 + (d.sec or 0))
end
local function dayOf(t, now)
  local day = date("%Y-%m-%d", t)
  if day == date("%Y-%m-%d", now) then return 0 end
  if day == date("%Y-%m-%d", midnight(now) + DAY + 12 * 3600) then return 1 end
  return nil
end

local function seenDB()
  ForeverRosterDB.outingsSeen = ForeverRosterDB.outingsSeen or {}
  return ForeverRosterDB.outingsSeen
end

--------------------------------------------------------------------------------------------------------------------
-- Sorties des groupes chargés
--------------------------------------------------------------------------------------------------------------------
-- Inscrits d'un rôle
local function members(o, role) return role == "Tank" and o.tanks or role == "Heal" and o.heals or o.dps end
O.Members = members

-- Places prises, places en tout, complet
function O.Count(o)
  local filled, total = #o.tanks + #o.heals + #o.dps, o.places[1] + o.places[2] + o.places[3]
  return filled, total, total > 0 and filled >= total
end

-- Sorties à afficher : du jour ou de demain, pas passées depuis plus de 2 h ; « dès que complet » (heure 0) : jusqu'à
-- la fin du lendemain du jour où le site a donné les données. Triées par jour, puis « dès que complet », puis heure.
-- { group, o, day (0 aujourd'hui, 1 demain) }
function O.List(now)
  now = now or time()
  local out, seen = {}, {}
  for _, g in ipairs(ns.Group.List()) do
    for _, o in ipairs(g.outings or {}) do
      local day
      if o.time == 0 then
        if (g.at or 0) == 0 or now < midnight(g.at) + 2 * DAY then day = 0 end
      elseif o.time > now - KEEP then
        -- Commencée (même la veille, juste avant minuit) : du jour
        day = o.time <= now and 0 or dayOf(o.time, now)
      end
      if day and not seen[o.id] then
        seen[o.id] = true
        out[#out + 1] = { group = g, o = o, day = day }
      end
    end
  end
  table.sort(out, function(a, b)
    if a.day ~= b.day then return a.day < b.day end
    if a.o.time ~= b.o.time then return a.o.time < b.o.time end
    return a.o.title < b.o.title
  end)
  return out
end

function O.Find(id)
  for _, e in ipairs(O.List()) do if e.o.id == id then return e end end
  return nil
end

-- Ma place dans une sortie (mine : mes persos, Group.MyChars) : { creator, role, char, wait (rang), waitRole }
function O.Me(o, mine)
  mine = mine or ns.Group.MyChars()
  local me = { creator = mine[key(o.creator)] == true }
  for _, role in ipairs(ROLES) do
    for _, name in ipairs(members(o, role)) do
      if not me.role and mine[key(name)] then me.role, me.char = role, name end
    end
  end
  for i, w in ipairs(o.wait) do
    if not me.wait and mine[key(w.name)] then me.wait, me.waitRole, me.waitChar = i, w.role, w.name end
  end
  return me
end

-- Qui est en ligne, sa classe, qui est déjà dans mon groupe : clé (prénom) → { class, online (nil : inconnu), group }.
-- Guilde : liste du client (tenue à jour des connexions par le jeu), sinon la dernière relève (Guild.lua) ; groupe :
-- Compo.Roster. Valeurs secrètes laissées de côté.
function O.Presence()
  local out = {}
  local total = call(GetNumGuildMembers)
  if yes(call(IsInGuild)) and type(total) == "number" and not ns.secret(total) then
    for i = 1, math.min(total, 1000) do
      local name, _, _, _, _, _, _, _, online, _, class = call(GetGuildRosterInfo, i)
      name = ns.str(name)
      if name then out[key(name)] = { class = ns.str(class), online = not ns.secret(online) and (online == true or online == 1) } end
    end
  end
  if not next(out) and ns.Guild and ns.Guild.Current then
    local g = ns.Guild.Current()
    for _, m in ipairs(g and g.roster and g.roster.members or {}) do out[m.key] = { class = m.class, online = m.online and true or nil } end
  end
  local ok, roster = pcall(ns.Compo.Roster)
  for name, r in pairs(ok and roster or {}) do
    local k = key(name)
    out[k] = out[k] or {}
    out[k].group, out[k].online = true, r.online ~= false
  end
  return out
end

-- Ce que le créateur peut faire : invite (prénoms à inviter : pas déjà dans mon groupe, pas hors ligne), manual
-- (« @pseudo » : à inviter à la main), others (tous les autres inscrits, pour le bandeau), total (inscrits avec un
-- perso, hors moi), online (en ligne ou déjà dans mon groupe), grouped (déjà dans mon groupe)
function O.Plan(o, mine, pres)
  mine, pres = mine or ns.Group.MyChars(), pres or O.Presence()
  local plan = { invite = {}, manual = {}, others = {}, total = 0, online = 0, grouped = 0 }
  for _, role in ipairs(ROLES) do
    for _, name in ipairs(members(o, role)) do
      if not mine[key(name)] then
        local p = { name = name, role = role }
        plan.others[#plan.others + 1] = p
        if manual(name) then
          p.manual = true
          plan.manual[#plan.manual + 1] = name
        else
          local s = pres[key(name)]
          p.class, p.online, p.group = s and s.class, s and s.online, s and s.group
          plan.total = plan.total + 1
          if p.online or p.group then plan.online = plan.online + 1 end
          if p.group then plan.grouped = plan.grouped + 1
          elseif p.online ~= false then plan.invite[#plan.invite + 1] = name end
        end
      end
    end
  end
  return plan
end

--------------------------------------------------------------------------------------------------------------------
-- Actions : inviter (créateur), chuchoter (inscrits). Rien n'est envoyé tout seul.
--------------------------------------------------------------------------------------------------------------------
-- Invitations des inscrits qui sont des persos (C_PartyInfo.InviteUnit par Compo.lua), hors combat et hors rencontre,
-- seul ou chef du groupe ; un groupe de 5 au plus (pas de passage en raid). Les « @pseudo » : à inviter à la main.
function O.Invite(id)
  local e = O.Find(id)
  if not e then return 0 end
  if busy() then ns.print(L["impossible en combat."]) return 0 end
  if not ns.Compo.CanInvite() then return 0 end
  local plan = O.Plan(e.o)
  local inGroup = call(GetNumGroupMembers)
  inGroup = (type(inGroup) == "number" and not ns.secret(inGroup)) and inGroup or 0
  local room = yes(call(IsInRaid)) and 40 or (5 - math.max(1, inGroup))
  local sent, left = 0, {}
  for _, name in ipairs(plan.invite) do
    if sent < room then ns.Compo.InviteUnit(name) sent = sent + 1 else left[#left + 1] = name end
  end
  ns.print(L("%d invitation(s) envoyée(s).", sent))
  if #left > 0 then ns.print(L("groupe complet : pas d'invitation pour %s.", table.concat(left, ", "))) end
  if #plan.manual > 0 then ns.print(L("à inviter à la main (inscrits Discord) : %s", table.concat(plan.manual, ", "))) end
  return sent
end

-- Saisie d'un chuchotement au créateur, ouverte et vide : le joueur écrit et envoie lui-même (aucune action protégée)
function O.Whisper(name)
  name = ns.str(name)
  if not name or name == "" or manual(name) then return false end
  local util = ChatFrameUtil
  for _, fn in ipairs({ util and util.SendTell or false, ChatFrame_SendTell or false }) do
    if type(fn) == "function" and pcall(fn, name) then return true end
  end
  local open = (util and util.OpenChat) or ChatFrame_OpenChat
  if type(open) == "function" and pcall(open, "/w " .. name .. " ") then return true end
  ns.print(L("pour chuchoter à %s : /w %s", name, name))
  return false
end

--------------------------------------------------------------------------------------------------------------------
-- Textes communs à l'onglet et au bandeau
--------------------------------------------------------------------------------------------------------------------
local function hm(t) return date("%H:%M", t) end
local function levels(o)
  if not (o.min and o.max) then return "" end
  return GREY .. "  " .. (o.min == o.max and tostring(o.min) or (o.min .. "-" .. o.max)) .. "|r"
end
-- « Gnomeregan à 21:00, complet » / « Gnomeregan : complet » (dès que complet) ; sinon « 3/5 inscrits »
local function headline(o)
  local filled, total, full = O.Count(o)
  local state = full and (GREEN .. L["complet"] .. "|r") or L("%d/%d inscrits", filled, total)
  local title = GOLD .. o.title .. "|r"
  if o.time == 0 then return L("%s : %s", title, state) end
  return L("%s à %s, %s", title, hm(o.time), state)
end
O.Headline = headline
local function inviteLabel(plan)
  if #plan.invite == 1 then return L("Inviter %s", plan.invite[1]) end
  return L("Inviter les %d", #plan.invite)
end
-- Largeur d'un bouton d'après son texte (police du jeu, environ 7 px par caractère)
local function width(label, min) return math.max(min or 90, 28 + 7 * #(label:gsub("[\128-\191]", ""))) end
local function current() return key(UnitName and UnitName("player")) end

--------------------------------------------------------------------------------------------------------------------
-- Bandeau (fenêtre de la boîte à outils, habillage Forever ou site) : une fois par sortie, fermable
--------------------------------------------------------------------------------------------------------------------
local banner
local ready = false     -- quelques secondes après la connexion (le rappel de raid passe d'abord)
local announced = {}    -- ligne du chat déjà écrite pour cette sortie (session)

-- Bouton principal : rouge du jeu (Forever) ou plein doré (site) ; secondaire : gris (Forever) ou sombre (site)
local function primary(parent)
  if K.site() then
    local b = K.statusButton(parent)
    b.SetText = function(self, text) K.styleStatus(self, text, K.C.gold, true) end
    return b
  end
  return K.button(parent, "", 120, nil)
end
local function secondary(parent)
  local b = K.button(parent, "", 100, nil)
  if not K.site() then
    for _, part in ipairs({ "Left", "Middle", "Right" }) do
      local t = b[part]
      if type(t) == "table" and t.SetDesaturated then pcall(t.SetDesaturated, t, true) end
    end
    if b.SetNormalFontObject and GameFontHighlight then pcall(b.SetNormalFontObject, b, GameFontHighlight) end
  end
  return b
end

local function build()
  banner = K.window("ForeverRosterOuting", "Forever Roster", 400, 140, ns.LOGO)
  banner.skin, banner.id, banner.kind, banner.auto = K.site(), false, false, false
  local x = K.gapX()
  banner.x, banner.w = x, 400 - x - 16
  banner.head = banner:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  if GameFontHighlightMedium then banner.head:SetFontObject(GameFontHighlightMedium) end
  banner.head:SetPoint("TOPLEFT", x, -36) banner.head:SetWidth(banner.w) banner.head:SetJustifyH("LEFT")
  banner.slots = {}
  banner.info = banner:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  banner.info:SetWidth(banner.w) banner.info:SetJustifyH("LEFT")
  banner.go = primary(banner)
  banner.go:SetPoint("BOTTOMLEFT", x - 2, 14)
  banner.later = secondary(banner)
  -- Fermé par le joueur (croix, Échap, « Plus tard », « OK », action faite) : plus jamais pour cette sortie ;
  -- caché par un combat ou une rencontre : reviendra
  banner:SetScript("OnHide", function(self)
    if not self.auto and self.id then seenDB()[self.id] = time() end
    self.auto, self.id = false, false
  end)
end

-- Un nom de la ligne des inscrits (créateur) : losange vert s'il est en ligne, gris sinon ; couleur de classe
local function slot(i)
  local s = banner.slots[i]
  if not s then
    s = { dot = K.diamond(banner, 7), text = banner:CreateFontString(nil, "OVERLAY", "GameFontHighlight") }
    banner.slots[i] = s
  end
  return s
end

local function setButton(b, label, w, onClick)
  b:SetText(label)
  b:SetSize(w, 24)
  b:SetScript("OnClick", onClick)
  b:Show()
end

local function close() if banner then banner:Hide() end end

-- Bandeau d'une sortie : kind "creator" (Inviter) ou "member" (Chuchoter)
local function render(e, kind)
  if not banner or banner.skin ~= K.site() then
    if banner then banner.auto = true banner:Hide() end
    build()
  end
  local o, mine = e.o, ns.Group.MyChars()
  local again = banner:IsShown() -- remis à jour : il reste où le joueur l'a mis
  banner.id, banner.kind = o.id, kind
  banner.head:SetText(headline(o))
  for _, s in ipairs(banner.slots) do s.dot:Hide() s.text:Hide() end
  local y, height = -58, 0
  if kind == "creator" then
    -- Première fois : liste de guilde redemandée au jeu (qui est en ligne), le bandeau suit à GUILD_ROSTER_UPDATE
    if not again then call(C_GuildInfo and C_GuildInfo.GuildRoster) end
    local plan = O.Plan(o, mine)
    -- Ligne des inscrits : losange et prénom, à la ligne si la place manque
    local x, row = banner.x, 0
    for i, p in ipairs(plan.others) do
      local s = slot(i)
      local name = p.manual and (GREY .. p.name .. "|r") or (p.online == false and not p.group) and (GREY .. p.name .. "|r") or K.colored(p.class, p.name)
      s.text:SetText(name)
      local w = (s.text.GetStringWidth and s.text:GetStringWidth()) or 60
      if type(w) ~= "number" or w <= 0 then w = 60 end
      if x > banner.x and x + 12 + w > banner.x + banner.w then x, row = banner.x, row + 1 end
      s.dot:ClearAllPoints() s.dot:SetPoint("CENTER", banner, "TOPLEFT", x + 3, y - 7 - row * 18)
      K.solid(s.dot, (p.online or p.group) and ONLINE or OFFLINE)
      if p.manual then s.dot:Hide() else s.dot:Show() end
      s.text:ClearAllPoints() s.text:SetPoint("TOPLEFT", banner, "TOPLEFT", x + 11, y - row * 18)
      s.text:Show()
      x = x + 11 + w + 12
    end
    if #plan.others > 0 then y = y - 22 - row * 18 end
    local parts = { L("%d en ligne sur %d", plan.online, plan.total) }
    parts[2] = plan.grouped == 0 and L["aucun déjà dans ton groupe"] or L("%d déjà dans ton groupe", plan.grouped)
    if #plan.manual > 0 then parts[3] = L("à inviter à la main : %s", table.concat(plan.manual, ", ")) end
    banner.info:SetText(GREY .. table.concat(parts, " · ") .. "|r")
    if #plan.invite > 0 then
      local label = inviteLabel(plan)
      -- Fermé une fois les invitations parties ; sinon (combat, pas chef du groupe) il reste, le chat dit pourquoi
      setButton(banner.go, label, width(label, 120), function()
        local sent = 0
        ns.safe(N("invitations"), function() sent = O.Invite(o.id) end)
        if sent > 0 then close() end
      end)
      setButton(banner.later, L["Plus tard"], width(L["Plus tard"], 100), close)
    else
      banner.go:Hide()
      setButton(banner.later, L["OK"], 80, close)
    end
    if not announced[o.id] and plan.total > 0 then
      announced[o.id] = true
      local label = o.time > 0 and L("%s à %s", o.title, hm(o.time)) or o.title
      ns.print(plan.total > 1 and plan.online == plan.total and L("%s : les %d inscrits sont en ligne.", label, plan.total)
        or L("%s : %d en ligne sur %d.", label, plan.online, plan.total))
    end
  else
    local me = O.Me(o, mine)
    local who = me.char and key(me.char) ~= current() and L("tu viens en %s avec %s", roleName(me.role), me.char) or L("tu viens en %s", roleName(me.role))
    banner.info:SetText(GREY .. L("Créée par %s", o.creator) .. " · " .. who .. "|r")
    local label = L("Chuchoter %s", o.creator)
    setButton(banner.go, label, width(label, 120), function()
      ns.safe(N("chuchotement"), O.Whisper, o.creator)
      close()
    end)
    setButton(banner.later, L["OK"], 80, close)
  end
  banner.info:ClearAllPoints() banner.info:SetPoint("TOPLEFT", banner.x, y)
  banner.later:ClearAllPoints()
  if banner.go:IsShown() then banner.later:SetPoint("LEFT", banner.go, "RIGHT", 8, 0) else banner.later:SetPoint("BOTTOMLEFT", banner.x - 2, 14) end
  local infoH = banner.info.GetStringHeight and banner.info:GetStringHeight()
  height = -y + math.max(12, type(infoH) == "number" and infoH or 12) + 8 + 48
  banner:SetHeight(math.max(118, height))
  if again then return end
  -- Sous le rappel de raid s'il est ouvert, sinon en haut de l'écran
  banner:ClearAllPoints()
  local reminder = ns.UI and ns.UI.reminder
  if reminder and reminder:IsShown() then banner:SetPoint("TOP", reminder, "BOTTOM", 0, -8) else banner:SetPoint("TOP", 0, -140) end
  K.front(banner)
  banner:Show()
end

-- Bandeau dû pour une sortie : "creator", "member" ou nil
function O.Due(e, now, mine)
  local o = e.o
  local me = O.Me(o, mine)
  if not (me.creator or me.role) then return nil end
  local _, _, full = O.Count(o)
  if o.time == 0 then
    if not full then return nil end
  elseif now < o.time - SOON or now > o.time + LATE then
    return nil
  end
  if me.creator then
    local plan = O.Plan(o, mine)
    -- Personne d'autre d'inscrit, ou tout le monde déjà dans mon groupe : rien à faire
    if #plan.others == 0 or (#plan.manual == 0 and plan.grouped == plan.total) then return nil end
    return "creator"
  end
  -- Inscrit déjà dans le groupe du créateur : rien à faire
  local s = O.Presence()[key(o.creator)]
  if s and s.group then return nil end
  return "member"
end

-- Toutes les 30 s, après un combat, une rencontre, un chargement des données ou un changement de groupe : le bandeau
-- dû (le premier dans l'ordre de l'onglet), ou le bandeau ouvert remis à jour (inscrits, en ligne, déjà là)
function O.Check()
  if not (ready and ForeverRosterDB) then return false end
  if busy() then
    if banner and banner:IsShown() then banner.auto = true banner:Hide() end
    return false
  end
  local now, mine = time(), ns.Group.MyChars()
  if banner and banner:IsShown() then
    local e = O.Find(banner.id)
    local kind = e and O.Due(e, now, mine)
    -- Plus rien à faire (groupe formé, heure passée, sortie retirée) : fermé pour de bon
    if kind then render(e, kind) else banner:Hide() end
    return kind ~= nil
  end
  local seen = seenDB()
  for id, at in pairs(seen) do if at < now - 3 * DAY then seen[id] = nil end end
  for _, e in ipairs(O.List(now)) do
    if not seen[e.o.id] then
      local kind = O.Due(e, now, mine)
      if kind then render(e, kind) return true end
    end
  end
  return false
end

-- Combat ou rencontre : bandeau caché (il revient après)
local function hide() if banner and banner:IsShown() then banner.auto = true banner:Hide() end end
function O.Banner() return banner end

local function check() ns.safe(LABEL, O.Check) end
local ticker = false
ns.on("PLAYER_LOGIN", function()
  C_Timer.After(8, function() ready = true check() end)
  if not ticker and C_Timer.NewTicker then ticker = C_Timer.NewTicker(TICK, function()
    check()
    if ForeverRosterDB and ForeverRosterDB.tab == "sorties" and ns.UI and ns.UI.Refresh then ns.UI.Refresh() end
  end) or true end
end)
ns.on("PLAYER_REGEN_DISABLED", hide)
ns.on("ENCOUNTER_START", hide)
ns.on("PLAYER_REGEN_ENABLED", check)
ns.on("ENCOUNTER_END", check)
ns.on("GROUP_ROSTER_UPDATE", check)
ns.on("GUILD_ROSTER_UPDATE", function() if banner and banner:IsShown() then check() end end)

--------------------------------------------------------------------------------------------------------------------
-- Onglet « Sorties » (UI.lua) : sorties du jour et de demain, places par rôle, inscrits, attente, note, ma place
--------------------------------------------------------------------------------------------------------------------
local function roleLine(o, pres)
  local parts = {}
  for i, role in ipairs(ROLES) do
    local list, n = members(o, role), o.places[i]
    if n > 0 or #list > 0 then
      local names = {}
      for _, name in ipairs(list) do
        local s = not manual(name) and pres[key(name)]
        names[#names + 1] = (s and s.class) and K.colored(s.class, name) or name
      end
      for _ = #list + 1, n do names[#names + 1] = GREY .. L["libre"] .. "|r" end
      parts[#parts + 1] = K.roleIcon(role) .. " " .. table.concat(names, ", ")
    end
  end
  return table.concat(parts, "    ")
end

function O.FillTab(rows)
  local now, mine = time(), ns.Group.MyChars()
  local groups = ns.Group.List()
  local list = O.List(now)
  if #list == 0 then
    rows.Header(L["Sorties"])
    rows.Add(GREY .. (#groups == 0 and L["Aucun groupe chargé : sur le site, « Copier pour le jeu » (en haut de chaque page), puis colle dans l'onglet Synchro."]
      or (L["Aucune sortie aujourd'hui ni demain."] .. "\n" .. L["Crée-en une ou inscris-toi sur le site ou sur Discord."])) .. "|r")
    return
  end
  local pres, day = O.Presence(), nil
  for _, e in ipairs(list) do
    local o = e.o
    if e.day ~= day then
      day = e.day
      rows.Header(day == 0 and L["Aujourd'hui"] or L["Demain"])
    end
    local filled, total, full = O.Count(o)
    local when = o.time == 0 and L["dès que complet"] or hm(o.time)
    local lines = { GOLD .. o.title .. "|r" .. levels(o) .. "  " .. when .. GREY .. "  ·  " .. filled .. "/" .. total .. "|r" .. (full and ("  " .. GREEN .. L["complet"] .. "|r") or "") }
    lines[#lines + 1] = roleLine(o, pres)
    if #o.wait > 0 then
      local w = {}
      for _, x in ipairs(o.wait) do w[#w + 1] = x.role ~= "" and L("%s (%s)", x.name, roleName(x.role)) or x.name end
      lines[#lines + 1] = GREY .. L("En attente : %s", table.concat(w, ", ")) .. "|r"
    end
    if o.note ~= "" then lines[#lines + 1] = GREY .. L("« %s »", o.note) .. "|r" end
    local me = O.Me(o, mine)
    local foot = GREY .. L("Créée par %s", o.creator) .. (#groups > 1 and ("  ·  " .. (e.group.name or "")) or "") .. "|r"
    local buttons
    if me.creator then
      foot = foot .. "  ·  " .. GOLD .. L["ta sortie"] .. "|r"
      local plan = O.Plan(o, mine, pres)
      -- Inviter : seulement le jour même (le bandeau le propose aussi 15 min avant l'heure)
      if e.day == 0 and #plan.invite > 0 then
        local label = inviteLabel(plan)
        buttons = { { label, width(label, 120), function() ns.safe(N("invitations"), O.Invite, o.id) end } }
      end
    elseif me.role then
      local who = me.char and key(me.char) ~= current() and L("tu viens en %s avec %s", roleName(me.role), me.char) or L("tu viens en %s", roleName(me.role))
      foot = foot .. "  ·  " .. GREEN .. who .. "|r"
      local label = L("Chuchoter %s", o.creator)
      buttons = { { label, width(label, 120), function() ns.safe(N("chuchotement"), O.Whisper, o.creator) end } }
    elseif me.wait then
      foot = foot .. "  ·  " .. GOLD .. L("tu es en attente (n° %d)", me.wait) .. "|r"
    end
    lines[#lines + 1] = foot
    rows.Add(table.concat(lines, "\n"), buttons)
  end
end
