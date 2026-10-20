-- Pages des onglets Raids, En raid, Compo et Butin (historique, lot R4a) de la fenêtre principale, et de la page
-- Options › Conseil du butin (lot R4b) (construites par UI.lua : ns.Pages.Build(clé, page), puis ns.Pages.Refresh(clé) à
-- l'affichage). Listes et boutons de la boîte à outils commune (ns.Kit, deux habillages).
local _, ns = ...
local L, N = ns.L, ns.N
local P = {}
ns.Pages = P
local F = ns.Format

local GOLD, GREY, GREEN = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f"
local ORANGE, RED, BLUE, LIGHT = "|cfff0b43c", "|cffff6b5e", "|cff6fb7ff", "|cffc9cfdb"
local pages, builders, refreshers = {}, {}, {}
P.pages = pages
P.state = {} -- ce que chaque page affiche (tests hors jeu)

local function refreshUI() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
-- « mercredi 08/10 à 21:00 » (anglais : « Wed Oct 8, 21:00 ») ; Format.lua : F.When, F.Stamp
local function when(t) return F.When(t) end
P.when = when
-- « 2 joueurs » / « 1 joueur »… : clés N au singulier et au pluriel
local function count(n, one, many) return L(F.Many(n) and many or one, n) end
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
local function showTab(key) return function() if ns.UI and ns.UI.Show then ns.UI.Show(key) end end end
local function showCouncil() if ns.UI and ns.UI.ShowOptions then ns.UI.ShowOptions("council") end end
-- Classe d'un joueur (couleur du nom) : membre du raid, sinon de la guilde
local function classOf(name)
  local m = ns.Loot and ns.Loot.Member and ns.Loot.Member(name)
  return (m and m.class) or (ns.Council and ns.Council.ClassOf(name)) or nil
end

-- Conseil de ce soir (lot R4b) : membres présents et d'où vient ce conseil (Loot.lua, Lo.CouncilSource)
local SOURCE = {
  mc = N("envoyé par le chef de butin (%s), le même pour tous"),
  game = N("défini en jeu (Options › Conseil du butin)"),
  site = N("celui du site (conseil du raid, sinon officiers du groupe)"),
  guild = N("rangs 1 à %d de la guilde (rang par défaut, pas encore réglé en jeu)"),
  test = N("raid d'essai"),
}
local function sourceText(source, from)
  if source == "mc" then return L(SOURCE.mc, F.Display(from)) end
  if source == "guild" then return L(SOURCE.guild, ns.Council.MinRank()) end
  if SOURCE[source] then return L[SOURCE[source]] end
  return L["aucun : le chef de butin décide seul (règle le conseil dans Options › Conseil du butin, ou charge les données du site)"]
end
local function tonightLine(rows, state, buttons)
  local names, source, from = ns.Loot.CouncilSource()
  local shown = {}
  for i, n in ipairs(names) do shown[i] = who(n, classOf(n)) end
  state.council, state.councilSource = names, source
  rows.Add(L("Conseil de ce soir : %s", #shown > 0 and table.concat(shown, ", ") or (GREY .. L["personne"] .. "|r")) .. GREY .. "  " .. L["(et le chef de butin)"] .. "|r"
    .. "\n" .. GREY .. sourceText(source, from) .. "|r", buttons)
end

-- Soirée de l'historique (History.lua) : titre (date, instance, difficulté) et ligne (boss vaincus, présents, chef de butin)
local function nightTitle(n)
  if n.test then return L["Raid d'essai"] end
  local where = n.instance or L["instance de raid"]
  if n.difficulty and ns.Groups.DIFFICULTY[n.difficulty] then where = where .. " (" .. ns.Groups.Difficulty(n.difficulty) .. ")" end
  return L("%s · %s", when(n.start), where)
end
local function nightLine(n)
  local kills, people = 0, 0
  for _, b in ipairs(n.bosses or {}) do if b.kill then kills = kills + 1 end end
  for _ in pairs(n.people or {}) do people = people + 1 end
  local parts = { count(kills, N("%d boss vaincu"), N("%d boss vaincus")), count(people, N("%d présent"), N("%d présents")) }
  if n.ml then parts[#parts + 1] = L("chef de butin : %s", F.Display(n.ml)) end
  return table.concat(parts, " · ")
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
  if ns.safe then ns.safe(L["affichage"], fn, page) else fn(page) end
end

--------------------------------------------------------------------------------------------------------------------
-- Raids à venir
--------------------------------------------------------------------------------------------------------------------
builders.raids = function(p)
  ns.Kit.hint(p, L["Raids à venir de tes groupes."] .. " " .. GOLD .. L["Inscris-toi sur le site ou sur Discord."] .. "|r")
  p.list = ns.Kit.list(p, -40)
end
refreshers.raids = function(p)
  local G, rows = ns.Groups, p.list
  rows.Reset()
  local groups = G.List()
  local state = { raids = 0 }
  P.state.raids = state
  rows.Header(L["Raids à venir"])
  if #groups == 0 then
    state.empty = true
    rows.Add(GREY .. L["Aucun groupe chargé. Sur Roster, « Copier pour le jeu » (barre du haut), puis colle dans l'onglet Synchro : c'est chargé tout seul."] .. "|r")
    rows.Done()
    return
  end
  local list = {}
  for _, g in ipairs(groups) do list[#list + 1] = g.name end
  local d = ns.db() or {}
  rows.Add(GREY .. L("Groupes : %s", "|r" .. table.concat(list, ", ")) .. (d.groupsAt and (GREY .. "  " .. L("(chargés le %s)", F.Stamp(d.groupsAt)) .. "|r") or "")
    .. "\n" .. GREY .. L["Pas d'inscription en jeu : inscris-toi sur le site ou sur Discord, puis recopie les données du site."] .. "|r")
  local raids = G.Raids()
  if #raids == 0 then rows.Add(GREY .. L["Aucun raid à venir dans tes groupes."] .. "|r") end
  local current = G.Current()
  local me = ns.Comm.Me()
  for _, e in ipairs(raids) do
    local r = e.raid
    state.raids = state.raids + 1
    local info = {}
    if r.difficulty ~= "" then info[#info + 1] = G.Difficulty(r.difficulty) end
    if (r.size or 0) > 0 then info[#info + 1] = L("%d joueurs", r.size) end
    info[#info + 1] = e.group.name
    local mine
    if r.status then
      mine = (G.COLOR[r.status] or GREY) .. G.Label(r.status) .. "|r"
      if r.char then
        mine = mine .. GREY .. " " .. L("avec %s", "|r" .. F.Display(r.char))
        if not F.SameName(r.char, me) then mine = mine .. GREY .. " " .. L("(tu es connecté avec %s)", F.Display(me)) .. "|r" end
      end
    elseif r.unknown then
      -- Raid arrivé avec les données d'un autre joueur (partage) : mon inscription n'y est pas
      mine = GREY .. L["inscription inconnue (données reçues d'un autre joueur)"] .. "|r"
    else
      mine = GREY .. L["pas inscrit"] .. "|r"
    end
    local now = current and current.raid.id == r.id and (GREEN .. "  · " .. L["en cours"] .. "|r") or ""
    rows.Add(GOLD .. r.name .. "|r  " .. when(r.time) .. now .. "\n" .. GREY .. table.concat(info, " · ") .. "|r\n" .. L("Toi : %s", mine))
  end
  rows.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- En raid : relevé en cours, versions de l'addon (et chuchoter à ceux qui ne l'ont pas)
--------------------------------------------------------------------------------------------------------------------
builders.enraid = function(p)
  ns.Kit.hint(p, L["Pendant un raid prévu sur le site, l'addon relève tout seul la présence, les boss et le butin ; le bilan part avec ta synchro."])
  p.list = ns.Kit.list(p, -40)
end
local function recorderSection(rows, state)
  local R = ns.Recorder
  rows.Header(L["Relevé du raid"])
  local st = R.IsRecording() and R.Status()
  if st then
    local log = st.log
    local G = ns.Groups
    state.recording = true
    rows.Add(GOLD .. (log.name or "raid") .. "|r" .. GREY .. "  · " .. L("en cours depuis %s", date("%H:%M", log.start or time()))
      .. (log.instance and (" · " .. log.instance) or "") .. (log.difficulty and G.DIFFICULTY[log.difficulty] and (" (" .. G.Difficulty(log.difficulty) .. ")") or "") .. "|r\n"
      .. GREEN .. count(st.present, N("%d présent"), N("%d présents")) .. "|r" .. GREY .. " " .. L["au dernier relevé"] .. " · "
      .. count(#st.bosses, N("%d boss vaincu"), N("%d boss vaincus")) .. " · " .. count(st.loot, N("%d objet noté"), N("%d objets notés")) .. "|r")
    if #st.late > 0 then rows.Add(ORANGE .. L("Arrivés en retard : %s", "|r" .. names(st.late))) end
    if #st.left > 0 then rows.Add(RED .. L("Partis : %s", "|r" .. names(st.left))) end
    if #st.bosses > 0 then rows.Add(GREEN .. L("Boss vaincus : %s", "|r" .. table.concat(st.bosses, ", "))) end
  elseif not R.Enabled() then
    rows.Add(GREY .. L["Relevé coupé (onglet Options)."] .. "|r")
  elseif not ns.Groups.Current() then
    rows.Add(GREY .. L["Pas de raid du site dans les 2 h : charge les données du site (onglet Synchro) avant le raid."] .. "|r")
  else
    rows.Add(GREY .. L("Raid du site : %s. Le relevé démarre dès que tu es dans un groupe de raid.", ns.Groups.Current().raid.name) .. "|r")
  end
  local last = not st and R.Last()
  if last and next(last.people or {}) then
    local sent = (last.sentAt or 0) >= (last.updated or 0)
    local people = 0
    for _ in pairs(last.people) do people = people + 1 end
    rows.Add(GREY .. L("Dernier bilan : %s", "|r" .. (last.name or "raid")) .. GREY .. ", " .. L("le %s", F.Stamp(last.start or 0)) .. " · " .. count(people, N("%d joueur"), N("%d joueurs")) .. " · "
      .. (sent and L["envoyé au site"] or L["part avec ta prochaine synchro"]) .. "|r")
  end
end
local function versionsSection(rows, state)
  local Cm = ns.Comm
  rows.Header(L["Versions de l'addon"])
  state.whisper = {}
  if not Cm.InGroup() then
    rows.Add(GREY .. L["Hors groupe. La question part toute seule à l'arrivée dans un raid."] .. "|r")
    return
  end
  local list = Cm.Rows()
  local byVersion, order, none, wait, with = {}, {}, {}, {}, 0
  for _, r in ipairs(list) do
    if r.state == "ok" or r.state == "old" then
      with = with + 1
      if not byVersion[r.v] then byVersion[r.v] = {} order[#order + 1] = r.v end
      local l = byVersion[r.v]
      l[#l + 1] = who(r.name, r.class)
    elseif r.state == "none" then none[#none + 1] = r
    else wait[#wait + 1] = r end
  end
  table.sort(order, function(a, b) return Cm.versionKey(a) > Cm.versionKey(b) end)
  rows.Add(L("Roster dans le groupe : %s", GOLD .. with .. "/" .. #list .. "|r") .. (Cm.asking and (GREY .. "  · " .. L["question en attente de la fin du combat"] .. "|r") or ""))
  for _, v in ipairs(order) do
    local old = Cm.versionKey(v) < Cm.versionKey(ns.version)
    rows.Add((old and ORANGE or GREEN) .. L("%s : %s", old and L("%s (ancienne)", v) or v, "|r" .. table.concat(byVersion[v], ", ")))
  end
  local lead = Cm.IsLead()
  for _, r in ipairs(none) do
    local line = who(r.name, r.class) .. "  " .. RED .. L["sans addon"] .. "|r" .. (r.whispered and (GREY .. "  · " .. L("chuchoté à %s", date("%H:%M", r.whispered)) .. "|r") or "")
    if lead then
      state.whisper[#state.whisper + 1] = r.name
      rows.Add(line, { { L["Chuchoter"], 110, function() Cm.Whisper(r.name) end } })
    else
      rows.Add(line)
    end
  end
  if #none > 0 and not lead then rows.Add(GREY .. L["Le chef de raid ou un assistant peut leur chuchoter d'un clic d'installer Roster."] .. "|r") end
  if #none > 0 and lead then state.none = #none end
  if #wait > 0 then
    local waiting = {}
    for _, r in ipairs(wait) do waiting[#waiting + 1] = r.name end
    rows.Add(GREY .. L("En attente de réponse : %s", names(waiting)) .. "|r")
  end
  rows.Add(GREY .. L("La question part à l'arrivée dans un raid ; sans réponse en %d s : sans addon.", Cm.WAIT) .. "|r",
    { { L["Redemander"], 120, function() Cm.AskVersions() refreshUI() end } })
end
-- Butin (lot R3b) : chef de butin (le chef de raid en désigne un autre), distribution par Roster, accès aux fenêtres
local function lootUI(fn) return function() if ns.LootUI and ns.LootUI[fn] then ns.safe(L["butin"], ns.LootUI[fn]) end end end
local pickMaster = false -- liste des membres à désigner comme chef de butin, ouverte
local function lootSection(rows, state)
  local Lo, Cm = ns.Loot, ns.Comm
  if not Lo then return end
  rows.Header(L["Butin"])
  local st = { master = Lo.Master(), enabled = Lo.Enabled(), isMaster = Lo.IsMaster(), designate = {} }
  state.loot = st
  local items, toGive, toHand = Lo.Items(), 0, 0
  for _, e in ipairs(items) do
    if e.status == "awarded" then toHand = toHand + 1 elseif e.status ~= "kept" and e.status ~= "traded" then toGive = toGive + 1 end
  end
  st.toGive, st.toHand = toGive, toHand
  local windows = { { L["Fenêtre du butin"], 140, lootUI("ShowLoot") }, { L("Objets à remettre (%d)", toHand), 170, lootUI("ShowHandover") } }
  if not Cm.InGroup() and not Lo.test then
    rows.Add(GREY .. L["Hors groupe. En raid, le chef de raid est chef de butin, sauf s'il en désigne un autre ici. /roster butin : fenêtre du butin."] .. "|r", windows)
    return
  end
  local leader = Cm.IsLeader() and not Lo.test
  st.canDesignate = leader
  local roster = {}
  for _, m in ipairs(Lo.Members()) do roster[F.Key(m.name) or ""] = m end
  local function named(full) local m = roster[F.Key(full) or ""] return who(full, m and m.class) end
  rows.Add(L("Chef de butin : %s", st.master and named(st.master) or "?") .. (st.isMaster and (GREEN .. "  " .. L["(toi)"] .. "|r") or "")
    .. "\n" .. GREY .. L["Il reçoit le butin de groupe, décide entre les pulls (conseil, jets) et échange l'objet au gagnant."] .. "|r",
    leader and { { pickMaster and L["Fermer la liste"] or L["Désigner un autre"], 160, function() pickMaster = not pickMaster refreshUI() end } } or nil)
  if leader and pickMaster then
    local list = Lo.Members()
    table.sort(list, function(a, b) return a.name < b.name end)
    for _, m in ipairs(list) do
      if not F.SameName(m.name, st.master) then
        st.designate[#st.designate + 1] = m.name
        rows.Add("   " .. who(m.name, m.class) .. (m.addon and "" or (RED .. "  " .. L["sans addon"] .. "|r")),
          { { L["Désigner"], 100, function() Lo.SetMaster(m.name) pickMaster = false refreshUI() end } })
      end
    end
  end
  local canSet = leader or st.isMaster
  st.canSet = canSet
  local function set(on) return function() Lo.SetEnabled(on) refreshUI() end end
  rows.Add(L("Distribution par Roster : %s", st.enabled and (GREEN .. L["activée"] .. "|r") or (GREY .. L["coupée"] .. "|r"))
    .. "\n" .. GREY .. L["Activée, les addons des autres joueurs passent le butin de groupe pour que le chef de butin le reçoive (d'office pour un raid du site en mode conseil)."] .. "|r",
    canSet and { { L["Oui"], 80, set(true), { color = { 0.31, 0.83, 0.37 }, selected = st.enabled } },
      { L["Non"], 80, set(false), { color = { 0.6, 0.64, 0.71 }, selected = not st.enabled } } } or nil)
  if not st.isMaster then
    rows.Add(GREY .. L("Passer automatique : %s (onglet Options).", Lo.AutoPass() and L["oui"] or L["non"]) .. "|r")
  end
  -- Conseil de ce soir (lot R4b) : qui vote, et d'où vient ce conseil
  if Lo.CouncilSource then tonightLine(rows, st, { { L["Conseil du butin"], 150, showCouncil } }) end
  -- Soirée relevée par l'addon (historique durable, R4a), sans le site : instance de raid, distribution activée
  local H = ns.Hist
  local night = H and H.CurrentNight and H.CurrentNight()
  st.night = night and night.id or nil
  if night then
    rows.Add(GREEN .. L["Soirée relevée par l'addon"] .. "|r" .. GREY .. "  · " .. nightTitle(night) .. "\n" .. nightLine(night) .. "|r",
      { { L["Historique"], 120, showTab("loot") } })
  elseif st.enabled and Cm.InRaid() then
    rows.Add(GREY .. L["La soirée (présence, boss, butin) va dans l'historique de l'addon dès que tu es dans une instance de raid, distribution activée."] .. "|r")
  end
  local held = Cm.Held()
  if held > 0 then
    rows.Add(ORANGE .. count(held, N("%d message d'addon en attente de la fin du combat de boss."), N("%d messages d'addon en attente de la fin du combat de boss.")) .. "|r")
  end
  if st.isMaster or toGive + toHand > 0 then
    rows.Add(L("%s à distribuer · %s à remettre", GOLD .. toGive .. "|r", GOLD .. toHand .. "|r") .. GREY .. "  " .. L["(/roster butin)"] .. "|r", windows)
  end
end

refreshers.enraid = function(p)
  local rows = p.list
  local state = {}
  P.state.enraid = state
  rows.Reset()
  recorderSection(rows, state)
  lootSection(rows, state)
  versionsSection(rows, state)
  rows.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Compo : état de chaque perso, invitations, placement
--------------------------------------------------------------------------------------------------------------------
local STATE_COLOR = { ok = GREEN, move = ORANGE, missing = RED, manual = GREY, bench = GREY, unplaced = GREY }
builders.compo = function(p)
  local K = ns.Kit
  K.hint(p, L("Sur Roster : page du raid, onglet Compo, « Export pour le jeu », Copier, puis colle dans l'onglet %s.", GOLD .. L["Synchro"] .. "|r"))
  local invite = K.button(p, L["Inviter"], 90, function() ns.Compo.Invite() refreshUI() end)
  invite:SetPoint("TOPLEFT", 4, -40)
  local arrange = K.button(p, L["Placer les groupes"], 140, function() ns.Compo.Arrange() refreshUI() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 6, 0)
  local versions = K.button(p, L["Versions de l'addon"], 140, function()
    ns.Comm.AskVersions()
    if ns.UI and ns.UI.Show then ns.UI.Show("enraid") end
  end)
  versions:SetPoint("LEFT", arrange, "RIGHT", 6, 0)
  p.clear = K.button(p, L["Effacer la compo"], 130, function() ns.Compo.Clear() end)
  p.clear:SetPoint("LEFT", versions, "RIGHT", 6, 0)
  p.buttons = { invite = invite, arrange = arrange, versions = versions, clear = p.clear }
  p.list = K.list(p, -72)
end
refreshers.compo = function(p)
  local rows, G = p.list, ns.Groups
  local state = { members = 0 }
  P.state.compo = state
  rows.Reset()
  local raid = ns.Compo.Get()
  if p.clear then if raid then p.clear:Show() else p.clear:Hide() end end
  if not raid then
    rows.Header(L["Compo"])
    rows.Add(GREY .. L["Aucune compo chargée. Elle s'efface d'elle-même 12 h après l'heure du raid."] .. "|r")
    rows.Done()
    return
  end
  local info = { when(raid.time) }
  if raid.difficulty ~= "" then info[#info + 1] = G.Difficulty(raid.difficulty) end
  if (raid.size or 0) > 0 then info[#info + 1] = L("%d joueurs", raid.size) end
  local status, ok, total = ns.Compo.Status(), 0, 0
  for _, s in ipairs(status) do if s.m.group > 0 and s.m.status ~= "bench" then total = total + 1 if s.state == "ok" then ok = ok + 1 end end end
  state.ok, state.total = ok, total
  rows.Header(raid.name)
  rows.Add(GREY .. table.concat(info, " · ") .. "|r\n" .. L("%s persos placés au bon endroit", (ok == total and GREEN or GOLD) .. ok .. "/" .. total .. "|r")
    .. (ns.Compo.arranging and (GREY .. "  · " .. L["placement en cours"] .. "|r") or ""))
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
      rows.Header(g > 0 and L("Groupe %d", g) or (g == 0 and L["Pas placés"] or L["Banc"]))
    end
    local name = m.source == "discord" and (GREY .. m.name .. " (Discord)|r") or who(F.FullName(m.name) or m.name, m.class)
    local label = ns.Compo.STATE[s.state]
    rows.Add(string.format("%s  %s%s %s|r  %s%s|r%s", name, GREY, ns.Kit.roleIcon(m.role), m.spec or "", STATE_COLOR[s.state] or GREY,
      label and L[label] or s.state, (s.inGroup and s.online == false) and (RED .. " " .. L["(hors ligne)"] .. "|r") or ""))
  end
  rows.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Butin › Historique (lot R4a) : tout ce que Roster a distribué, gardé dans l'addon (ns.Hist), même sans le site, en
-- lecture seule. Recherche (joueur, objet ou boss), filtre (tout, ce qui compte, ce qui ne compte pas), regroupement par
-- soirée ou par joueur ; 150 objets affichés au plus. Raid d'essai : son historique en mémoire. Classement, Mains & alts
-- et Saisons viendront avec R4c et R4d (étude « Roster autonome », §5.11).
--------------------------------------------------------------------------------------------------------------------
local CAT = { bis = { N("BiS"), GREEN }, up = { N("Upgrade"), BLUE }, ms = { N("jet MS"), GOLD }, other = { N("autre"), LIGHT } }
local FILTERS = { all = N("Tous les objets"), counted = N("Ceux qui comptent"), skipped = N("Ceux qui ne comptent pas") }
local NEXT_FILTER = { all = "counted", counted = "skipped", skipped = "all" }
P.MAX_HISTORY = 150
local view = { group = "night", filter = "all", search = "" }
P.historyView = view -- (tests hors jeu)

-- Catégorie en pastille : BiS, Upgrade, jet MS, autre (compte) ; sinon « ne compte pas » en gris
local function catTag(e)
  local c = not e.excluded and CAT[e.cat or ""]
  if c then return c[2] .. "[" .. L[c[1]] .. "]|r" end
  return GREY .. "[" .. L["ne compte pas"] .. "]|r"
end
-- Méthode et détail : « conseil : BiS · 3 votes », « MS 87 », « jet libre 54 », « gardé », « butin de groupe, sans passer »
local function how(e)
  local Lo = ns.Loot
  if not e.method then return L["butin de groupe, sans passer"] end
  local text = Lo.awardLabel(e.method, e.response, e.detail, e.method == "ml" and e.detail == Lo.KEPT)
  if e.method == "council" and e.detail then text = text .. " · " .. e.detail end
  return text
end
local function itemText(e)
  local link = ns.Loot.LinkFor(e.item or e.itemId, e.name)
  return link .. (e.ilvl and (GREY .. "  " .. L("niv. %s", e.ilvl) .. "|r") or "")
end
local function matches(e, q)
  if q == "" then return true end
  for _, s in ipairs({ F.Display(e.winner), e.name or F.ItemName(e.item) or "", e.boss or "" }) do
    if F.Fold(s):find(q, 1, true) then return true end
  end
  return false
end

builders.loot = function(p)
  local K = ns.Kit
  p.hintText = K.hint(p, "")
  p.searchLabel = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.searchLabel:SetPoint("TOPLEFT", 8, -46)
  p.searchLabel:SetText(L["Chercher :"])
  p.search = CreateFrame("EditBox", nil, p, "InputBoxTemplate")
  p.search:SetSize(140, 22) p.search:SetPoint("TOPLEFT", 76, -40)
  p.search:SetAutoFocus(false) p.search:SetMaxLetters(40)
  p.search:SetScript("OnTextChanged", function(self) view.search = self:GetText() or "" P.Refresh("loot") end)
  p.search:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  p.group = K.button(p, "", 130, function() view.group = view.group == "night" and "player" or "night" P.Refresh("loot") end)
  p.group:SetPoint("TOPLEFT", 226, -40)
  p.filter = K.button(p, "", 170, function() view.filter = NEXT_FILTER[view.filter] or "all" P.Refresh("loot") end)
  p.filter:SetPoint("LEFT", p.group, "RIGHT", 6, 0)
  p.list = K.list(p, -72)
end
refreshers.loot = function(p)
  local H, rows = ns.Hist, p.list
  local test = ns.Loot and ns.Loot.test ~= nil
  local state = { total = 0, counted = 0, shown = 0, groups = 0, test = test, lines = {} }
  P.state.loot = state
  p.group:SetText(view.group == "night" and L["Par soirée"] or L["Par joueur"])
  p.filter:SetText(L[FILTERS[view.filter]])
  p.hintText:SetText((test and (ORANGE .. L["Raid d'essai : historique en mémoire, effacé à la fin de l'essai."] .. "|r ") or "")
    .. L["Tout ce que Roster distribue (attribué, gardé, gagné sans passer), gardé dans l'addon, même sans le site. Lecture seule."])
  rows.Reset()
  rows.Header(L["Historique"])
  local all = H and H.Entries() or {}
  local nights = H and #H.Nights() or 0
  for _, e in ipairs(all) do if e.cat and not e.excluded then state.counted = state.counted + 1 end end
  state.total = #all
  rows.Add(table.concat({ count(#all, N("%d objet enregistré"), N("%d objets enregistrés")),
    count(state.counted, N("%d compte"), N("%d comptent")), count(nights, N("%d soirée"), N("%d soirées")) }, " · "))
  if #all == 0 then
    state.empty = true
    rows.Add(GREY .. L["Aucun butin enregistré : il apparaîtra ici dès la première attribution (fenêtre du butin : /roster butin)."] .. "|r")
    rows.Done()
    return
  end
  -- Objets retenus (recherche, filtre), regroupés par soirée ou par joueur ; groupes dans l'ordre de leur objet le plus récent
  local q = F.Fold(F.trim(view.search or ""))
  local groups, order = {}, {}
  for _, e in ipairs(all) do
    local counted = e.cat ~= nil and not e.excluded
    local keep = (view.filter == "all" or (view.filter == "counted") == counted) and matches(e, q)
    if keep then
      local key
      if view.group == "player" then key = H.Person(e.winner) or "?"
      else key = (e.night and H.Night(e.night)) and e.night or "" end
      local g = groups[key]
      if not g then g = { key = key, list = {} } groups[key] = g order[#order + 1] = g end
      g.list[#g.list + 1] = e
    end
  end
  local kept = 0
  for _, g in ipairs(order) do kept = kept + #g.list end
  if kept < #all then rows.Add(GREY .. L("%d sur %d affichés.", kept, #all) .. "|r") end
  if kept == 0 then rows.Add(GREY .. L["Aucun objet ne correspond."] .. "|r") end
  for _, g in ipairs(order) do
    if state.shown >= P.MAX_HISTORY then break end
    state.groups = state.groups + 1
    local first = g.list[1]
    if view.group == "player" then
      local c = H.Count({ first.winner })
      rows.Header(who(first.winner, first.class) .. GREY .. "  · " .. count(#g.list, N("%d objet"), N("%d objets")) .. "|r")
      local d = {}
      for _, k in ipairs({ "bis", "up", "ms", "other" }) do if c[k] > 0 then d[#d + 1] = c[k] .. " " .. L[CAT[k][1]] end end
      rows.Add(GREY .. L("Comptent : %d", c.n) .. (#d > 0 and (" (" .. table.concat(d, " · ") .. ")") or "") .. "|r")
    else
      local n = g.key ~= "" and H.Night(g.key)
      rows.Header(n and nightTitle(n) or L["Hors soirée relevée"])
      if n then rows.Add(GREY .. nightLine(n) .. "|r") end
    end
    for _, e in ipairs(g.list) do
      if state.shown >= P.MAX_HISTORY then break end
      state.shown = state.shown + 1
      local text
      if view.group == "player" then
        text = itemText(e) .. "  " .. catTag(e) .. "\n" .. GREY .. how(e) .. (e.boss and (" · " .. e.boss) or "") .. " · " .. F.Stamp(e.at) .. "|r"
      else
        text = itemText(e) .. "  " .. GREY .. L["pour"] .. "|r " .. who(e.winner, e.class) .. "  " .. catTag(e) .. "\n"
          .. GREY .. how(e) .. (e.boss and (" · " .. e.boss) or "") .. " · " .. date("%H:%M", e.at) .. "|r"
      end
      state.lines[#state.lines + 1] = text
      rows.Add(text)
    end
  end
  if kept > state.shown then rows.Add(GREY .. L("+ %d de plus : affine la recherche.", kept - state.shown) .. "|r") end
  rows.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Options › Conseil du butin (lot R4b, Council.lua ; étude §5.11 n° 6) : rang minimal (« Changer le rang » puis
-- « Choisir » : 2 clics), membres qui en découlent (Retirer), officiers retirés à la main (Remettre), ajouter un membre
-- (complétion sur la liste de guilde ; un nom hors de la guilde s'écrit Prénom-Royaume), qui peut modifier, conseil de
-- ce soir. En lecture seule pour ceux qui ne peuvent pas modifier. Raid d'essai : la guilde fictive.
--------------------------------------------------------------------------------------------------------------------
local councilView = { add = "", pickRank = false }
P.councilView = councilView -- (tests hors jeu)
local function refreshCouncil() P.Refresh("council") end

-- « Ajouter » ou Entrée : un perso de la guilde qui porte ce prénom, sinon la seule suggestion, sinon le nom tapé
local function addTyped(p)
  local Co = ns.Council
  local q = F.trim(p.add:GetText() or "")
  if q == "" then return end
  local name = q
  if not Co.RankOf(q) then
    local list = Co.Suggest(q, 2)
    if #list == 1 then name = list[1].name end
  end
  if Co.Add(name) then
    p.add:SetText("")
    councilView.add = ""
    p.add:ClearFocus()
  end
  refreshCouncil()
end

builders.council = function(p)
  local K = ns.Kit
  p.addLabel = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.addLabel:SetPoint("TOPLEFT", 8, -78) p.addLabel:SetWidth(520) p.addLabel:SetJustifyH("LEFT")
  p.add = CreateFrame("EditBox", nil, p, "InputBoxTemplate")
  p.add:SetSize(170, 22) p.add:SetPoint("TOPLEFT", 150, -72)
  p.add:SetAutoFocus(false) p.add:SetMaxLetters(60)
  -- Frappe du joueur seulement (SetText de l'addon : rien)
  p.add:SetScript("OnTextChanged", function(self, user) if not user then return end councilView.add = self:GetText() or "" refreshCouncil() end)
  p.add:SetScript("OnEnterPressed", function() addTyped(p) end)
  p.add:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  p.addButton = K.button(p, L["Ajouter"], 100, function() addTyped(p) end)
  p.addButton:SetPoint("LEFT", p.add, "RIGHT", 8, 0)
  p.list = K.list(p, -104)
end

refreshers.council = function(p)
  local Co, rows = ns.Council, p.list
  local s = Co.Status()
  local state = { canModify = s.canModify, minRank = s.minRank, configured = s.configured, ready = s.ready, test = s.test, members = {}, removed = {}, suggestions = {}, ranks = {} }
  P.state.council = state
  local me = ns.Comm.Me()
  if s.canModify then
    p.addLabel:SetText(L["Ajouter un membre :"])
    p.add:Show() p.addButton:Show()
  else
    p.addLabel:SetText(GREY .. tostring(s.why or "") .. "|r")
    p.add:Hide() p.addButton:Hide()
  end
  rows.Reset()
  if s.test then rows.Add(ORANGE .. L["Raid d'essai : guilde fictive, réglage en mémoire effacé à la fin de l'essai."] .. "|r") end
  rows.Header(s.guild and L("Conseil du butin · %s", s.guild) or L["Conseil du butin"])
  rows.Add(GREY .. L["Membres : la guilde jusqu'au rang minimal, plus les noms ajoutés à la main, moins ceux retirés à la main. Calculé en continu : un officier promu entre tout seul, un ancien officier rétrogradé sort tout seul. Quand tu es chef de butin, le conseil de ce soir part au raid : tous les addons sont d'accord."] .. "|r")
  if not s.inGuild then
    if s.known then rows.Add(GREY .. L["Tu n'es pas dans une guilde : le conseil vient du chef de butin ou du site."] .. "|r")
    else rows.Add(GREY .. L["Liste de guilde pas encore lue : elle arrive quelques secondes après la connexion."] .. "|r",
      { { L["Actualiser"], 120, function() Co.Ask(true) Co.ReadSoon(1) end } }) end
  else
    -- Rang minimal : « Changer le rang » ouvre la liste des rangs, « Choisir » (2 clics)
    local setLine
    if s.setBy then setLine = L("réglé par %s le %s", F.Display(s.setBy), F.Stamp(s.setAt))
    elseif s.configured then setLine = L["rang par défaut ; noms ajoutés ou retirés en jeu"]
    else setLine = L["rang par défaut, pas encore réglé en jeu : le conseil du site passe d'abord, sinon ces membres"] end
    local span = s.minRank == 1 and L("(rang 1 sur %d)", s.numRanks) or L("(rangs 1 à %d sur %d)", s.minRank, s.numRanks)
    rows.Add(L("Rang minimal : %s", ns.Kit.ACCENT .. s.minRank .. " · " .. Co.RankName(s.minRank) .. "|r") .. GREY .. "  " .. span .. "|r"
      .. "\n" .. GREY .. setLine .. "|r",
      s.canModify and { { councilView.pickRank and L["Fermer la liste"] or L["Changer le rang"], 150, function() councilView.pickRank = not councilView.pickRank refreshCouncil() end } } or nil)
    if councilView.pickRank and s.canModify then
      for i = 1, s.numRanks do
        local current, above = i == s.minRank, i < (s.myRank or 1)
        state.ranks[i] = s.ranks[i]
        rows.Add("   " .. i .. " · " .. s.ranks[i] .. (current and (GREEN .. "  " .. L["(actuel)"] .. "|r") or "") .. (above and (GREY .. "  " .. L["(au-dessus de ton rang)"] .. "|r") or ""),
          (not current and not above) and { { L["Choisir"], 100, function() if Co.SetMinRank(i) then councilView.pickRank = false end refreshCouncil() end } } or nil)
      end
    end
    local mine = s.myRank and Co.RankName(s.myRank) or L["sans rang connu"]
    rows.Add((s.minRank == 1 and L("Qui peut modifier : le rang 1 (%s).", Co.RankNames(1)) or L("Qui peut modifier : les rangs 1 à %d (%s).", s.minRank, Co.RankNames(s.minRank))) .. "\n"
      .. (s.canModify and (GREEN .. L("Toi : %s, tu peux modifier.", mine)) or (GREY .. L("Toi : %s, lecture seule.", mine))) .. "|r")
    -- Membres, puis officiers retirés à la main
    rows.Header(L("Membres (%d)", #s.members))
    if #s.members == 0 then rows.Add(GREY .. L["Personne : ajoute un membre, ou choisis un rang plus bas."] .. "|r") end
    for _, m in ipairs(s.members) do
      state.members[#state.members + 1] = m.name
      local tag = m.rank and Co.RankName(m.rank) or L["hors de la guilde"]
      if m.added then tag = tag .. " · " .. L["ajout à la main"] end
      rows.Add(who(m.name, m.class) .. GREY .. "  · " .. tag .. "|r" .. (F.SameName(m.name, me) and (GREEN .. "  " .. L["(toi)"] .. "|r") or ""),
        s.canModify and { { L["Retirer"], 100, function() Co.Remove(m.name) refreshCouncil() end } } or nil)
    end
    if #s.removed > 0 then
      rows.Header(L["Retirés à la main"])
      for _, m in ipairs(s.removed) do
        state.removed[#state.removed + 1] = m.name
        rows.Add(who(m.name, m.class) .. GREY .. "  · " .. Co.RankName(m.rank) .. "|r",
          s.canModify and { { L["Remettre"], 100, function() Co.Add(m.name) refreshCouncil() end } } or nil)
      end
    end
    -- Complétion de « Ajouter un membre »
    local q = F.trim(councilView.add or "")
    if s.canModify and q ~= "" then
      rows.Header(L["Ajouter un membre"])
      local list = Co.Suggest(q, 8)
      for _, m in ipairs(list) do
        state.suggestions[#state.suggestions + 1] = m.name
        rows.Add(who(m.name, m.class) .. GREY .. "  · " .. Co.RankName(m.rank) .. "|r", { { L["Ajouter"], 100, function()
          if Co.Add(m.name) then p.add:SetText("") councilView.add = "" end
          refreshCouncil()
        end } })
      end
      if #list == 0 then rows.Add(GREY .. L("Aucun membre de la guilde ne correspond : « Ajouter » prend « %s » tel quel (Prénom-Royaume pour un autre royaume).", F.txt(q, 40)) .. "|r") end
    end
  end
  rows.Header(L["Ce soir"])
  if ns.Loot and (ns.Comm.InGroup() or ns.Loot.test) then tonightLine(rows, state)
  else rows.Add(GREY .. L["Hors groupe. En raid, le conseil de ce soir est celui du chef de butin."] .. "|r") end
  rows.Done()
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
