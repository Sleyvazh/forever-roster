-- Pages des onglets Raids, En raid et Compo de la fenêtre principale (construites par UI.lua : ns.Pages.Build(clé, page),
-- puis ns.Pages.Refresh(clé) à l'affichage). Listes et boutons de la boîte à outils commune (ns.Kit, deux habillages).
local _, ns = ...
local P = {}
ns.Pages = P
local F = ns.Format

local GOLD, GREY, GREEN = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f"
local ORANGE, RED = "|cfff0b43c", "|cffff6b5e"
local pages, builders, refreshers = {}, {}, {}
P.pages = pages
P.state = {} -- ce que chaque page affiche (tests hors jeu)

local function refreshUI() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local DAYS = { "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi" }
-- « mercredi 08/10 à 21:00 »
local function when(t)
  if not t or t == 0 then return "date à définir" end
  return DAYS[date("*t", t).wday] .. " " .. date("%d/%m à %H:%M", t)
end
P.when = when
-- Nom coloré par classe ; royaume en gris s'il n'est pas celui du joueur
local function who(full, class)
  local name, realm = F.Split(full)
  local shown = F.Display(full)
  local text = ns.Kit.colored(class, name or shown)
  if shown ~= name then text = text .. GREY .. "-" .. (realm or "") .. "|r" end
  return text
end
local function names(list, max)
  local out = {}
  for i = 1, math.min(#list, max or 12) do out[i] = F.Display(list[i]) end
  return table.concat(out, ", ") .. (#list > #out and (" +" .. (#list - #out)) or "")
end

function P.Build(key, page)
  local b = builders[key]
  if not b or not page then return false end
  pages[key] = page
  b(page)
  return true
end
function P.Refresh(key)
  local page, fn = pages[key], refreshers[key]
  if not page or not fn then return end
  if ns.safe then ns.safe("affichage", fn, page) else fn(page) end
end

--------------------------------------------------------------------------------------------------------------------
-- Raids à venir
--------------------------------------------------------------------------------------------------------------------
builders.raids = function(p)
  ns.Kit.hint(p, "Raids à venir de tes groupes. " .. GOLD .. "Inscris-toi sur le site ou sur Discord.|r")
  p.list = ns.Kit.list(p, -40)
end
refreshers.raids = function(p)
  local G, L = ns.Groups, p.list
  L.Reset()
  local groups = G.List()
  local state = { raids = 0 }
  P.state.raids = state
  L.Header("Raids à venir")
  if #groups == 0 then
    state.empty = true
    L.Add(GREY .. "Aucun groupe chargé. Sur Roster, « Copier pour le jeu » (barre du haut), puis colle dans l'onglet Synchro : c'est chargé tout seul.|r")
    L.Done()
    return
  end
  local list = {}
  for _, g in ipairs(groups) do list[#list + 1] = g.name end
  local d = ns.db() or {}
  L.Add(GREY .. "Groupes : |r" .. table.concat(list, ", ") .. (d.groupsAt and (GREY .. "  (chargés le " .. date("%d/%m à %H:%M", d.groupsAt) .. ")|r") or "")
    .. "\n" .. GREY .. "Pas d'inscription en jeu : inscris-toi sur le site ou sur Discord, puis recopie les données du site.|r")
  local raids = G.Raids()
  if #raids == 0 then L.Add(GREY .. "Aucun raid à venir dans tes groupes.|r") end
  local current = G.Current()
  local me = ns.Comm.Me()
  for _, e in ipairs(raids) do
    local r = e.raid
    state.raids = state.raids + 1
    local info = {}
    if r.difficulty ~= "" then info[#info + 1] = G.DIFFICULTY[r.difficulty] or r.difficulty end
    if (r.size or 0) > 0 then info[#info + 1] = r.size .. " joueurs" end
    info[#info + 1] = e.group.name
    local mine
    if r.status then
      mine = (G.COLOR[r.status] or GREY) .. (G.LABEL[r.status] or r.status) .. "|r"
      if r.char then
        mine = mine .. GREY .. " avec |r" .. F.Display(r.char)
        if not F.SameName(r.char, me) then mine = mine .. GREY .. " (tu es connecté avec " .. F.Display(me) .. ")|r" end
      end
    else
      mine = GREY .. "pas inscrit|r"
    end
    local now = current and current.raid.id == r.id and (GREEN .. "  · en cours|r") or ""
    L.Add(GOLD .. r.name .. "|r  " .. when(r.time) .. now .. "\n" .. GREY .. table.concat(info, " · ") .. "|r\n" .. "Toi : " .. mine)
  end
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- En raid : relevé en cours, versions de l'addon (et chuchoter à ceux qui ne l'ont pas)
--------------------------------------------------------------------------------------------------------------------
builders.enraid = function(p)
  ns.Kit.hint(p, "Pendant un raid prévu sur le site, l'addon relève tout seul la présence, les boss et le butin ; le bilan part avec ta synchro.")
  p.list = ns.Kit.list(p, -40)
end
local function recorderSection(L, state)
  local R = ns.Recorder
  L.Header("Relevé du raid")
  local st = R.IsRecording() and R.Status()
  if st then
    local log = st.log
    state.recording = true
    L.Add(GOLD .. (log.name or "raid") .. "|r" .. GREY .. "  · en cours depuis " .. date("%H:%M", log.start or time())
      .. (log.instance and (" · " .. log.instance) or "") .. (log.difficulty and ns.Groups.DIFFICULTY[log.difficulty] and (" (" .. ns.Groups.DIFFICULTY[log.difficulty] .. ")") or "") .. "|r\n"
      .. GREEN .. F.plural(st.present, "présent") .. "|r" .. GREY .. " au dernier relevé · " .. F.plural(#st.bosses, "boss vaincu", "boss vaincus")
      .. " · " .. F.plural(st.loot, "objet noté", "objets notés") .. "|r")
    if #st.late > 0 then L.Add(ORANGE .. "Arrivés en retard : |r" .. names(st.late)) end
    if #st.left > 0 then L.Add(RED .. "Partis : |r" .. names(st.left)) end
    if #st.bosses > 0 then L.Add(GREEN .. "Boss vaincus : |r" .. table.concat(st.bosses, ", ")) end
    if ns.Comm.Held() > 0 then L.Add(GREY .. "Messages d'addon en attente de la fin du combat de boss : " .. ns.Comm.Held() .. ".|r") end
  elseif not R.Enabled() then
    L.Add(GREY .. "Relevé coupé (onglet Options).|r")
  elseif not ns.Groups.Current() then
    L.Add(GREY .. "Pas de raid du site dans les 2 h : charge les données du site (onglet Synchro) avant le raid.|r")
  else
    L.Add(GREY .. "Raid du site : " .. ns.Groups.Current().raid.name .. ". Le relevé démarre dès que tu es dans un groupe de raid.|r")
  end
  local last = not st and R.Last()
  if last and next(last.people or {}) then
    local sent = (last.sentAt or 0) >= (last.updated or 0)
    local count = 0
    for _ in pairs(last.people) do count = count + 1 end
    L.Add(GREY .. "Dernier bilan : |r" .. (last.name or "raid") .. GREY .. ", le " .. date("%d/%m à %H:%M", last.start or 0) .. " · " .. F.plural(count, "joueur") .. " · "
      .. (sent and "envoyé au site" or "part avec ta prochaine synchro") .. "|r")
  end
end
local function versionsSection(L, state)
  local Cm = ns.Comm
  L.Header("Versions de l'addon")
  state.whisper = {}
  if not Cm.InGroup() then
    L.Add(GREY .. "Hors groupe. La question part toute seule à l'arrivée dans un raid.|r")
    return
  end
  local rows = Cm.Rows()
  local byVersion, order, none, wait, with = {}, {}, {}, {}, 0
  for _, r in ipairs(rows) do
    if r.state == "ok" or r.state == "old" then
      with = with + 1
      if not byVersion[r.v] then byVersion[r.v] = {} order[#order + 1] = r.v end
      local l = byVersion[r.v]
      l[#l + 1] = who(r.name, r.class)
    elseif r.state == "none" then none[#none + 1] = r
    else wait[#wait + 1] = r end
  end
  table.sort(order, function(a, b) return Cm.versionKey(a) > Cm.versionKey(b) end)
  L.Add("Roster dans le groupe : " .. GOLD .. with .. "/" .. #rows .. "|r" .. (Cm.asking and (GREY .. "  · question en attente de la fin du combat|r") or ""))
  for _, v in ipairs(order) do
    local old = Cm.versionKey(v) < Cm.versionKey(ns.version)
    L.Add((old and ORANGE or GREEN) .. v .. (old and " (ancienne)" or "") .. " : |r" .. table.concat(byVersion[v], ", "))
  end
  local lead = Cm.IsLead()
  for _, r in ipairs(none) do
    local line = who(r.name, r.class) .. "  " .. RED .. "sans addon|r" .. (r.whispered and (GREY .. "  · chuchoté à " .. date("%H:%M", r.whispered) .. "|r") or "")
    if lead then
      state.whisper[#state.whisper + 1] = r.name
      L.Add(line, { { "Chuchoter", 110, function() Cm.Whisper(r.name) end } })
    else
      L.Add(line)
    end
  end
  if #none > 0 and not lead then L.Add(GREY .. "Le chef de raid ou un assistant peut leur chuchoter d'un clic d'installer Roster.|r") end
  if #none > 0 and lead then state.none = #none end
  if #wait > 0 then
    local list = {}
    for _, r in ipairs(wait) do list[#list + 1] = r.name end
    L.Add(GREY .. "En attente de réponse : " .. names(list) .. "|r")
  end
  L.Add(GREY .. "La question part à l'arrivée dans un raid ; sans réponse en " .. Cm.WAIT .. " s : sans addon.|r",
    { { "Redemander", 120, function() Cm.AskVersions() refreshUI() end } })
end
refreshers.enraid = function(p)
  local L = p.list
  local state = {}
  P.state.enraid = state
  L.Reset()
  recorderSection(L, state)
  versionsSection(L, state)
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Compo : état de chaque perso, invitations, placement
--------------------------------------------------------------------------------------------------------------------
local STATE_COLOR = { ok = GREEN, move = ORANGE, missing = RED, manual = GREY, bench = GREY, unplaced = GREY }
builders.compo = function(p)
  local K = ns.Kit
  K.hint(p, "Sur Roster : page du raid, onglet Compo, « Export pour le jeu », Copier, puis colle dans l'onglet " .. GOLD .. "Synchro|r.")
  local invite = K.button(p, "Inviter", 90, function() ns.Compo.Invite() refreshUI() end)
  invite:SetPoint("TOPLEFT", 4, -40)
  local arrange = K.button(p, "Placer les groupes", 140, function() ns.Compo.Arrange() refreshUI() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 6, 0)
  local versions = K.button(p, "Versions de l'addon", 140, function()
    ns.Comm.AskVersions()
    if ns.UI and ns.UI.Show then ns.UI.Show("enraid") end
  end)
  versions:SetPoint("LEFT", arrange, "RIGHT", 6, 0)
  p.clear = K.button(p, "Effacer la compo", 130, function() ns.Compo.Clear() end)
  p.clear:SetPoint("LEFT", versions, "RIGHT", 6, 0)
  p.buttons = { invite = invite, arrange = arrange, versions = versions, clear = p.clear }
  p.list = K.list(p, -72)
end
refreshers.compo = function(p)
  local L, G = p.list, ns.Groups
  local state = { members = 0 }
  P.state.compo = state
  L.Reset()
  local raid = ns.Compo.Get()
  if p.clear then if raid then p.clear:Show() else p.clear:Hide() end end
  if not raid then
    L.Header("Compo")
    L.Add(GREY .. "Aucune compo chargée. Elle s'efface d'elle-même 12 h après l'heure du raid.|r")
    L.Done()
    return
  end
  local info = { when(raid.time) }
  if raid.difficulty ~= "" then info[#info + 1] = G.DIFFICULTY[raid.difficulty] or raid.difficulty end
  if (raid.size or 0) > 0 then info[#info + 1] = raid.size .. " joueurs" end
  local status, ok, total = ns.Compo.Status(), 0, 0
  for _, s in ipairs(status) do if s.m.group > 0 and s.m.status ~= "bench" then total = total + 1 if s.state == "ok" then ok = ok + 1 end end end
  state.ok, state.total = ok, total
  L.Header(raid.name)
  L.Add(GREY .. table.concat(info, " · ") .. "|r\n" .. (ok == total and GREEN or GOLD) .. ok .. "/" .. total .. "|r persos placés au bon endroit"
    .. (ns.Compo.arranging and (GREY .. "  · placement en cours|r") or ""))
  -- Groupes dans l'ordre, puis les persos pas placés, puis le banc (ordre du site à l'intérieur)
  local function rank(s) return s.m.status == "bench" and 10 or (s.m.group > 0 and s.m.group or 9) end
  for i, s in ipairs(status) do s.i = i end
  table.sort(status, function(a, b) if rank(a) ~= rank(b) then return rank(a) < rank(b) end return a.i < b.i end)
  local group
  for _, s in ipairs(status) do
    local m = s.m
    state.members = state.members + 1
    local g = m.status == "bench" and -1 or m.group
    if g ~= group then
      group = g
      L.Header(g > 0 and ("Groupe " .. g) or (g == 0 and "Pas placés" or "Banc"))
    end
    local name = m.source == "discord" and (GREY .. m.name .. " (Discord)|r") or who(F.FullName(m.name) or m.name, m.class)
    L.Add(string.format("%s  %s%s %s|r  %s%s|r%s", name, GREY, ns.Kit.roleIcon(m.role), m.spec or "", STATE_COLOR[s.state] or GREY,
      ns.Compo.STATE[s.state] or s.state, (s.inGroup and s.online == false) and (RED .. " (hors ligne)|r") or ""))
  end
  L.Done()
end

-- Le groupe change : la compo (bon groupe, à déplacer) et les versions se mettent à jour, au plus deux fois par seconde
local soon = false
ns.on("GROUP_ROSTER_UPDATE", function()
  if soon then return end
  if not (C_Timer and C_Timer.After) then refreshUI() return end
  soon = true
  C_Timer.After(0.5, function() soon = false refreshUI() end)
end)

return P
