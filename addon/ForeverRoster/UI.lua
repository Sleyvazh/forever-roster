-- Fenêtre unique à onglets (Raids, Compo, Patrons, Export) et alerte au butin.
local _, ns = ...
local U = {}
ns.UI = U

local GOLD, GREY, GREEN, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cff6fb7ff"
local STATE = {
  ok = "|cff4fd35fbon groupe|r", move = "|cfff0b43cà déplacer|r", missing = "|cffff6b5eabsent du raid|r",
  manual = "|cff9aa3b6inscrit Discord : à inviter à la main|r", bench = "|cff9aa3b6banc|r",
}
local CLASS_COLOR = RAID_CLASS_COLORS or {}

local function window(name, title, w, h)
  local f = CreateFrame("Frame", name, UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(w, h)
  f:SetPoint("CENTER")
  f:SetMovable(true) f:EnableMouse(true) f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving) f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:SetFrameStrata("DIALOG")
  f.title = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  f.title:SetPoint("TOP", 0, -5)
  f.title:SetText(title)
  tinsert(UISpecialFrames, name) -- Échap ferme la fenêtre
  f:Hide()
  return f
end

local function textArea(parent, x, y, w, h)
  local sf = CreateFrame("ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", x, y)
  sf:SetSize(w, h)
  local eb = CreateFrame("EditBox", nil, sf)
  eb:SetMultiLine(true)
  eb:SetFontObject(ChatFontNormal)
  eb:SetWidth(w)
  eb:SetAutoFocus(false)
  eb:SetScript("OnEscapePressed", eb.ClearFocus)
  sf:SetScrollChild(eb)
  local bg = sf:CreateTexture(nil, "BACKGROUND")
  bg:SetPoint("TOPLEFT", -4, 4) bg:SetPoint("BOTTOMRIGHT", 22, -4)
  bg:SetColorTexture(0, 0, 0, 0.45)
  return eb, sf
end

local function button(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 24)
  b:SetText(label)
  b:SetScript("OnClick", onClick)
  return b
end

local function hint(parent, text, y)
  local h = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  h:SetPoint("TOPLEFT", 4, y) h:SetWidth(550) h:SetJustifyH("LEFT")
  h:SetText(text)
  return h
end

-- Liste défilante : lignes de texte avec boutons, réutilisées d'un affichage à l'autre
local function list(parent, top)
  local sf = CreateFrame("ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 4, top) sf:SetPoint("BOTTOMRIGHT", -26, 4)
  local body = CreateFrame("Frame", nil, sf)
  body:SetSize(540, 10)
  sf:SetScrollChild(body)
  local L, rows, y, i = { body = body }, {}, 0, 0
  local function row(k)
    if rows[k] then return rows[k] end
    local r = CreateFrame("Frame", nil, body)
    r:SetSize(540, 40)
    r.text = r:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    r.text:SetPoint("TOPLEFT", 0, 0) r.text:SetWidth(540) r.text:SetJustifyH("LEFT")
    r.buttons = {}
    rows[k] = r
    return r
  end
  function L.Reset() y, i = 0, 0 end
  -- Ligne de texte ; buttons : { { label, largeur, action }, … } affichés en dessous
  function L.Add(text, buttons)
    i = i + 1
    local r = row(i)
    for _, b in pairs(r.buttons) do b:Hide() end
    r.text:SetText(text)
    local h = math.max(18, (r.text.GetStringHeight and r.text:GetStringHeight() or 14) + 4)
    local x = 0
    for k, spec in ipairs(buttons or {}) do
      local b = r.buttons[k] or button(r, spec[1], spec[2], nil)
      r.buttons[k] = b
      b:SetSize(spec[2], 22) b:SetText(spec[1]) b:SetScript("OnClick", spec[3])
      b:ClearAllPoints() b:SetPoint("TOPLEFT", x, -h) b:Show()
      x = x + spec[2] + 6
    end
    local height = h + ((buttons and #buttons > 0) and 28 or 4)
    r:ClearAllPoints() r:SetPoint("TOPLEFT", 0, -y) r:SetHeight(height) r:Show()
    y = y + height
  end
  function L.Done()
    for k = i + 1, #rows do rows[k]:Hide() end
    body:SetHeight(y + 10)
  end
  return L
end

local function colored(cls, name)
  local c = CLASS_COLOR[cls]
  return c and ("|c" .. (c.colorStr or "ffffffff") .. name .. "|r") or name
end

-- Fenêtre principale
local main
local TABS = { { key = "raids", label = "Raids" }, { key = "compo", label = "Compo" }, { key = "patrons", label = "Patrons" }, { key = "export", label = "Export" } }
local pages, refreshers = {}, {}

local function buildRaids(p)
  hint(p, "Données du site : page " .. GOLD .. "Addon|r du site, « Copier les données de mes groupes », puis colle ici (Ctrl+V) et « Charger ».", 0)
  p.input = textArea(p, 4, -32, 520, 36)
  local load = button(p, "Charger", 100, function()
    local ok, err = ns.Group.Load(p.input:GetText())
    if ok then p.input:SetText("") p.input:ClearFocus() U.Refresh() else ns.print(err) end
  end)
  load:SetPoint("TOPLEFT", 4, -76)
  p.list = list(p, -108)
end
refreshers.raids = function(p)
  local G, L = ns.Group, p.list
  L.Reset()
  local groups = G.List()
  if #groups == 0 then
    L.Add("Aucun groupe chargé. Sur le site : page Addon, « Copier les données de mes groupes », puis colle ici.")
  else
    local names = {}
    for _, g in ipairs(groups) do names[#names + 1] = g.name .. GREY .. " (" .. date("%d/%m %H:%M", g.at) .. ")|r" end
    L.Add(GOLD .. "Groupes|r : " .. table.concat(names, ", "))
    L.Add(GOLD .. "Raids à venir|r  " .. GREY .. "(inscription de " .. (UnitName("player") or "ce perso") .. ", envoyée avec l'export)|r")
    local raids = G.Raids()
    if #raids == 0 then L.Add(GREY .. "  aucun raid à venir|r") end
    for _, e in ipairs(raids) do
      local when = e.raid.time > 0 and date("%d/%m %H:%M", e.raid.time) or "date à définir"
      local site = e.onSite and (GREY .. "  site : " .. (G.LABEL[e.onSite] or e.onSite) .. (e.siteChar and (" (" .. e.siteChar .. ")") or "") .. "|r") or ""
      local game = e.status and (GREEN .. "  en jeu : " .. G.LABEL[e.status] .. "|r") or ""
      local buttons = {}
      for _, st in ipairs(G.STATUSES) do
        buttons[#buttons + 1] = { (e.status == st.key and "> " or "") .. st.label, 96, function()
          G.SignUp(e.group.id, e.raid.id, st.key, e.raid.time) U.Refresh()
        end }
      end
      L.Add(e.raid.name .. "  " .. GREY .. when .. "|r" .. site .. game, buttons)
    end
  end
  L.Done()
end

local function buildCompo(p)
  hint(p, "Sur le site : page du raid, « Export pour le jeu », Copier, puis colle ici (Ctrl+V).", 0)
  p.input = textArea(p, 4, -20, 520, 48)
  local load = button(p, "Charger", 100, function()
    local ok, err = ns.Compo.Load(p.input:GetText())
    if ok then p.input:SetText("") p.input:ClearFocus() U.Refresh() else ns.print(err) end
  end)
  load:SetPoint("TOPLEFT", 4, -76)
  local invite = button(p, "Inviter", 100, function() ns.Compo.Invite() end)
  invite:SetPoint("LEFT", load, "RIGHT", 8, 0)
  local arrange = button(p, "Placer les groupes", 150, function() ns.Compo.Arrange() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 8, 0)
  p.list = list(p, -108)
end
refreshers.compo = function(p)
  local L = p.list
  L.Reset()
  local raid = ns.Compo.Get()
  if not raid then
    L.Add("Aucune compo chargée.")
  else
    local when = (raid.time and raid.time > 0) and date("%d/%m %H:%M", raid.time) or "date non fixée"
    local lines, group, ok, total = {}, nil, 0, 0
    for _, s in ipairs(ns.Compo.Status()) do
      local m = s.m
      if m.group ~= group then
        group = m.group
        lines[#lines + 1] = " "
        lines[#lines + 1] = GOLD .. (group > 0 and ("Groupe " .. group) or "Non placés") .. "|r"
      end
      lines[#lines + 1] = string.format("  %s  %s%s %s|r  %s%s", colored(m.class, m.name), GREY, m.role or "", m.spec or "", STATE[s.state] or s.state,
        (s.state ~= "missing" and s.online == false) and " |cffff6b5e(hors ligne)|r" or "")
      if m.group > 0 then total = total + 1 if s.state == "ok" then ok = ok + 1 end end
    end
    L.Add(GOLD .. raid.name .. "|r  (" .. when .. ")\n  " .. ok .. "/" .. total .. " persos placés au bon endroit")
    L.Add(table.concat(lines, "\n"))
  end
  L.Done()
end

local function buildPatrons(p)
  hint(p, "Patron vu ailleurs (hôtel des ventes, chat) : tape " .. GOLD .. "/fr cherche|r puis Maj+clic sur l'objet pour mettre son lien, et Entrée.", 0)
  p.list = list(p, -24)
end
refreshers.patrons = function(p)
  local G, L = ns.Group, p.list
  L.Reset()
  local tracked, others = G.BagPatterns()
  L.Add(GOLD .. "Dans tes sacs : suivis par ton groupe|r")
  if #tracked == 0 then L.Add(GREY .. "  aucun (charge les données du site dans l'onglet Raids)|r") end
  for _, e in ipairs(tracked) do
    local link = G.linkFor(e.itemId, e.who and e.who.recipe)
    local parts = {}
    if e.who then parts[#parts + 1] = G.joinNames(e.who.wanted) and (GREEN .. "recherché par " .. G.joinNames(e.who.wanted) .. "|r") or (GREY .. "personne ne le recherche|r") end
    if e.bis then parts[#parts + 1] = BLUE .. "BiS de " .. G.joinNames(e.bis) .. "|r" end
    L.Add(link .. "  " .. table.concat(parts, "  "), { { "Annoncer", 110, function() G.Announce(e.itemId) end } })
  end
  L.Add(" ")
  L.Add(GOLD .. "Autres patrons dans tes sacs|r  " .. GREY .. "(les marquer recherchés pour " .. (UnitName("player") or "ce perso") .. ")|r")
  if #others == 0 then L.Add(GREY .. "  aucun|r") end
  for _, e in ipairs(others) do
    local on = G.IsWantedHere(e.itemId)
    L.Add(G.linkFor(e.itemId), { { on and "Retirer" or "Je le recherche", 140, function() G.ToggleWanted(e.itemId, G.linkFor(e.itemId)) U.Refresh() end } })
  end
  local marks = ns.charDB().wanted or {}
  local any = false
  for itemId, on in pairs(marks) do
    if not any then L.Add(" ") L.Add(GOLD .. "Marqués en jeu|r  " .. GREY .. "(envoyés avec l'export)|r") any = true end
    L.Add(G.linkFor(itemId) .. "  " .. (on and (GREEN .. "recherché|r") or (GREY .. "retiré|r")), { { "Annuler", 90, function() marks[itemId] = nil U.Refresh() end } })
  end
  L.Done()
end

local function buildExport(p)
  hint(p, "Ctrl+C pour copier, puis sur le site : page " .. GOLD .. "Addon|r, « Mettre à jour mes persos » (ou la fiche d'un perso, « Importer depuis l'addon »). Tous tes persos relevés sont inclus.", 0)
  p.text = textArea(p, 4, -34, 520, 260)
  p.text:SetScript("OnTextChanged", function(self, user) if user then self:SetText(p.value or "") self:HighlightText() end end)
  local again = button(p, "Actualiser", 110, function() U.Refresh() end)
  again:SetPoint("TOPLEFT", 4, -304)
  p.chars = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.chars:SetPoint("TOPLEFT", 4, -336) p.chars:SetWidth(550) p.chars:SetJustifyH("LEFT")
end
refreshers.export = function(p)
  local ok, value = pcall(ns.Export.Build)
  if not ok then ns.print("|cffff6060erreur (export)|r " .. tostring(value)) return end
  p.value = value
  p.text:SetText(value)
  local names = {}
  for _, e in ipairs(ns.Export.Characters()) do
    local h = e.snap.header or {}
    names[#names + 1] = colored(h.class, h.name or e.key) .. GREY .. " niv. " .. (h.level or "?") .. ", relevé le " .. date("%d/%m %H:%M", e.snap.at or 0) .. "|r"
  end
  p.chars:SetText(GOLD .. "Persos inclus|r (" .. #names .. ") : " .. table.concat(names, " · ") ..
    "\n" .. GREY .. "Connecte-toi une fois avec un perso pour l'ajouter. Pour retirer un perso supprimé : /fr oublier Nom-Royaume.|r")
  p.text:SetFocus()
  p.text:HighlightText()
end

local builders = { raids = buildRaids, compo = buildCompo, patrons = buildPatrons, export = buildExport }

local function buildMain()
  main = window("ForeverRosterMain", "Forever Roster", 600, 600)
  main.tabs = {}
  for k, t in ipairs(TABS) do
    local b = button(main, t.label, 120, function() U.Show(t.key) end)
    b:SetPoint("TOPLEFT", 12 + (k - 1) * 126, -28)
    main.tabs[t.key] = b
    local p = CreateFrame("Frame", nil, main)
    p:SetPoint("TOPLEFT", 12, -60) p:SetPoint("BOTTOMRIGHT", -12, 12)
    p:Hide()
    builders[t.key](p)
    pages[t.key] = p
  end
  main:SetScript("OnShow", function() U.Refresh() end)
end

function U.Refresh()
  if not main or not main:IsShown() then return end
  local tab = ForeverRosterDB.tab or "raids"
  local fn = refreshers[tab]
  if fn then ns.safe("affichage", fn, pages[tab]) end
end

-- Ouvre la fenêtre sur un onglet (le dernier utilisé par défaut)
function U.Show(tab)
  if not main then buildMain() end
  tab = pages[tab] and tab or ForeverRosterDB.tab or "raids"
  ForeverRosterDB.tab = tab
  for key, p in pairs(pages) do
    if key == tab then p:Show() else p:Hide() end
    main.tabs[key]:SetEnabled(key ~= tab)
  end
  if main:IsShown() then U.Refresh() else main:Show() end
end
function U.Toggle()
  if main and main:IsShown() then main:Hide() else U.Show() end
end
-- Anciens noms (commandes /fr compo, /fr export)
function U.ShowCompo() U.Show("compo") end
function U.ShowExport() U.Show("export") end
function U.ShowGroup() U.Show("raids") end
U.RefreshCompo = U.Refresh
U.RefreshGroup = U.Refresh

ns.on("GROUP_ROSTER_UPDATE", function() if ForeverRosterDB and ForeverRosterDB.tab == "compo" then U.Refresh() end end)
ns.on("BAG_UPDATE_DELAYED", function() if ForeverRosterDB and ForeverRosterDB.tab == "patrons" then U.Refresh() end end)

-- Alerte : patron suivi ou BiS ramassé
local alert
function U.LootAlert(itemId, link)
  if not alert then
    alert = window("ForeverRosterLoot", "Forever Roster : objet suivi ramassé", 440, 140)
    alert:ClearAllPoints() alert:SetPoint("TOP", 0, -160)
    alert.text = alert:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    alert.text:SetPoint("TOPLEFT", 14, -32) alert.text:SetWidth(410) alert.text:SetJustifyH("LEFT")
    alert.announce = button(alert, "Annoncer au groupe", 160, nil)
    alert.announce:SetPoint("BOTTOMLEFT", 14, 12)
    local close = button(alert, "Fermer", 100, function() alert:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -14, 12)
  end
  local G = ns.Group
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local lines = { link or G.linkFor(itemId, who and who.recipe) }
  if who then lines[#lines + 1] = G.joinNames(who.wanted) and (GREEN .. "Patron recherché par " .. G.joinNames(who.wanted) .. "|r") or (GREY .. "Patron que personne ne recherche.|r") end
  if who and G.joinNames(who.known, 5) then lines[#lines + 1] = GREY .. "Déjà connu par " .. G.joinNames(who.known, 5) .. "|r" end
  if bis then lines[#lines + 1] = BLUE .. "BiS de " .. G.joinNames(bis) .. "|r" end
  alert.text:SetText(table.concat(lines, "\n"))
  alert.announce:SetScript("OnClick", function() G.Announce(itemId, link) alert:Hide() end)
  alert:Show()
end
