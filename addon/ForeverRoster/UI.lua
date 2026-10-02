-- Fenêtre unique à onglets (Raids, Compo, Patrons, Export) et alerte au butin, à l'habillage de l'interface de Forever.
local _, ns = ...
local U = {}
ns.UI = U

local GOLD, GREY, GREEN, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cff6fb7ff"
local STATE = {
  ok = "|cff4fd35fbon groupe|r", move = "|cfff0b43cà déplacer|r", missing = "|cffff6b5eabsent du raid|r",
  manual = "|cff9aa3b6inscrit Discord : à inviter à la main|r", bench = "|cff9aa3b6banc|r",
}
local CLASS_COLOR = RAID_CLASS_COLORS or {}

-- Habillage de l'interface de Forever (relevé sur la fiche de perso) : cadre « PortraitFrameTemplate » aux textures
-- de Forever, fonds de la fiche, barres de titre de section, lignes alternées, onglets à icône sur le côté.
local ART = {
  bg = "UI-Character-Info-General-BG", header = "UI-Character-Info-Title", line = "UI-Character-Info-Line-Bounce2",
  inset = "common-insideframe", tab = "common-sidetab", tabMask = "common-sidetab-mask", tabSelected = "common-sidetab-selected",
  tabHover = "common-sidetab-hover", divider = "UI-Character-Info-ScrollLine",
}

local function atlas(tex, name)
  if tex.SetAtlas and pcall(tex.SetAtlas, tex, name, false) then return true end
  return false
end

local function window(name, title, w, h, icon)
  local ok, f = pcall(CreateFrame, "Frame", name, UIParent, "PortraitFrameTemplate")
  if not ok or not f then f = CreateFrame("Frame", name, UIParent, "BasicFrameTemplateWithInset") end
  f:SetSize(w, h)
  f:SetPoint("CENTER")
  f:SetMovable(true) f:EnableMouse(true) f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving) f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:SetFrameStrata("DIALOG")
  f:SetClampedToScreen(true)
  -- Fond de la fiche de perso de Forever, sous le cadre (le cadre est dessiné par-dessus)
  local bg = f:CreateTexture(nil, "BACKGROUND", nil, -6)
  bg:SetPoint("TOPLEFT", 2, -2) bg:SetPoint("BOTTOMRIGHT", -2, 2)
  if not atlas(bg, ART.bg) then bg:SetColorTexture(0.06, 0.05, 0.04, 0.95) end
  function f:SetWindowTitle(text)
    if self.SetTitle then self:SetTitle(text)
    elseif self.TitleContainer and self.TitleContainer.TitleText then self.TitleContainer.TitleText:SetText(text)
    else
      self.titleText = self.titleText or self:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      self.titleText:SetPoint("TOP", 0, -5) self.titleText:SetText(text)
    end
  end
  function f:SetIcon(tex)
    if self.SetPortraitToAsset then pcall(self.SetPortraitToAsset, self, tex)
    elseif self.PortraitContainer and self.PortraitContainer.portrait then self.PortraitContainer.portrait:SetTexture(tex) end
  end
  f:SetWindowTitle(title)
  f:SetIcon(icon or "Interface\\Icons\\INV_Misc_Book_09")
  tinsert(UISpecialFrames, name) -- Échap ferme la fenêtre
  f:Hide()
  return f
end

-- Cadre intérieur de Forever autour d'une zone (champ à coller, texte d'export)
local function inset(parent, region)
  local t = parent:CreateTexture(nil, "BORDER")
  t:SetPoint("TOPLEFT", region, "TOPLEFT", -6, 6) t:SetPoint("BOTTOMRIGHT", region, "BOTTOMRIGHT", 6, -6)
  if not atlas(t, ART.inset) then t:SetColorTexture(0, 0, 0, 0.45) end
  local back = parent:CreateTexture(nil, "BACKGROUND", nil, -4)
  back:SetPoint("TOPLEFT", region, "TOPLEFT", -4, 4) back:SetPoint("BOTTOMRIGHT", region, "BOTTOMRIGHT", 4, -4)
  back:SetColorTexture(0, 0, 0, 0.35)
end

-- Barre de défilement : moderne et fine (comme la fiche de perso) si le client la propose
local function scrollFrame(parent)
  local ok, sf = pcall(CreateFrame, "ScrollFrame", nil, parent, "ScrollFrameTemplate")
  if ok and sf then return sf, 16 end
  return CreateFrame("ScrollFrame", nil, parent, "UIPanelScrollFrameTemplate"), 26
end

local function textArea(parent, x, y, w, h)
  local sf, bar = scrollFrame(parent)
  sf:SetPoint("TOPLEFT", x, y)
  sf:SetSize(w - bar, h)
  local eb = CreateFrame("EditBox", nil, sf)
  eb:SetMultiLine(true)
  eb:SetFontObject(ChatFontNormal)
  eb:SetWidth(w - bar)
  eb:SetAutoFocus(false)
  eb:SetScript("OnEscapePressed", eb.ClearFocus)
  sf:SetScrollChild(eb)
  local box = CreateFrame("Frame", nil, parent)
  box:SetPoint("TOPLEFT", x, y) box:SetSize(w, h)
  inset(parent, box)
  -- Clic n'importe où dans la zone : le curseur va dans le champ
  sf:EnableMouse(true)
  sf:SetScript("OnMouseDown", function() eb:SetFocus() end)
  return eb, sf
end

local function button(parent, label, w, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 24)
  b:SetText(label)
  b:SetScript("OnClick", onClick)
  return b
end

-- Consigne de l'onglet, en haut à droite du portrait
local function hint(parent, text)
  local h = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  h:SetPoint("TOPLEFT", 52, -2) h:SetWidth(480) h:SetJustifyH("LEFT")
  h:SetText(text)
  return h
end

-- Liste défilante façon fiche de perso : barres de titre de section, lignes alternées, boutons sous le texte
local function list(parent, top)
  local sf, bar = scrollFrame(parent)
  sf:SetPoint("TOPLEFT", 4, top) sf:SetPoint("BOTTOMRIGHT", -bar, 4)
  local width = 540 - bar
  local body = CreateFrame("Frame", nil, sf)
  body:SetSize(width, 10)
  sf:SetScrollChild(body)
  local L, rows, y, i, odd = { body = body }, {}, 0, 0, false
  local function row(k)
    if rows[k] then return rows[k] end
    local r = CreateFrame("Frame", nil, body)
    r:SetSize(width, 40)
    r.bg = r:CreateTexture(nil, "BACKGROUND")
    r.bg:SetAllPoints()
    r.text = r:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    r.text:SetJustifyH("LEFT")
    r.buttons = {}
    rows[k] = r
    return r
  end
  function L.Reset() y, i, odd = 0, 0, false end
  -- Barre de titre de section (comme « General » sur la fiche de perso)
  function L.Header(text)
    i = i + 1
    local r = row(i)
    for _, b in pairs(r.buttons) do b:Hide() end
    r.bg:ClearAllPoints() r.bg:SetPoint("CENTER", 0, 0) r.bg:SetSize(math.min(width, 320), 36)
    if not atlas(r.bg, ART.header) then r.bg:SetColorTexture(0.25, 0.18, 0.08, 0.8) end
    r.bg:Show()
    r.text:SetFontObject(GameFontHighlight)
    r.text:ClearAllPoints() r.text:SetPoint("CENTER", 0, 1) r.text:SetWidth(width - 20) r.text:SetJustifyH("CENTER")
    r.text:SetText(text)
    r:ClearAllPoints() r:SetPoint("TOPLEFT", 0, -y) r:SetHeight(40) r:Show()
    y, odd = y + 42, false
  end
  -- Ligne de texte ; buttons : { { label, largeur, action }, … } affichés en dessous
  function L.Add(text, buttons)
    i = i + 1
    local r = row(i)
    for _, b in pairs(r.buttons) do b:Hide() end
    r.text:SetFontObject(GameFontHighlight)
    r.text:ClearAllPoints() r.text:SetPoint("TOPLEFT", 10, -5) r.text:SetWidth(width - 20) r.text:SetJustifyH("LEFT")
    r.text:SetText(text)
    local h = math.max(14, (r.text.GetStringHeight and r.text:GetStringHeight() or 14))
    local x = 10
    for k, spec in ipairs(buttons or {}) do
      local b = r.buttons[k] or button(r, spec[1], spec[2], nil)
      r.buttons[k] = b
      b:SetSize(spec[2], 22) b:SetText(spec[1]) b:SetScript("OnClick", spec[3])
      b:ClearAllPoints() b:SetPoint("TOPLEFT", x, -(h + 9)) b:Show()
      x = x + spec[2] + 6
    end
    local height = h + 10 + ((buttons and #buttons > 0) and 28 or 0)
    -- Une ligne sur deux sur fond clair, comme les statistiques de la fiche
    odd = not odd
    r.bg:ClearAllPoints() r.bg:SetAllPoints()
    if odd and atlas(r.bg, ART.line) then r.bg:Show() else r.bg:Hide() end
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

-- Fenêtre principale : une page par onglet, onglets à icône sur le côté droit (comme la fiche de perso)
local main
local TABS = {
  { key = "raids", label = "Raids", icon = "Interface\\Icons\\INV_Misc_Head_Dragon_01" },
  { key = "compo", label = "Compo", icon = "Interface\\Icons\\Ability_Warrior_RallyingCry" },
  { key = "patrons", label = "Patrons", icon = "Interface\\Icons\\INV_Scroll_03" },
  { key = "export", label = "Export", icon = "Interface\\Icons\\INV_Letter_15" },
}
local pages, refreshers = {}, {}

local function buildRaids(p)
  hint(p, "Données du site : page " .. GOLD .. "Addon|r, « Copier les données de mes groupes », puis colle ici (Ctrl+V) et « Charger ».")
  p.input = textArea(p, 6, -42, 526, 40)
  local load = button(p, "Charger", 110, function()
    local ok, err = ns.Group.Load(p.input:GetText())
    if ok then p.input:SetText("") p.input:ClearFocus() U.Refresh() else ns.print(err) end
  end)
  load:SetPoint("TOPLEFT", 4, -94)
  p.list = list(p, -126)
end
refreshers.raids = function(p)
  local G, L = ns.Group, p.list
  L.Reset()
  local groups = G.List()
  if #groups == 0 then
    L.Header("Groupes")
    L.Add(GREY .. "Aucun groupe chargé : sur le site, page Addon, « Copier les données de mes groupes », puis colle ci-dessus.|r")
  else
    local names = {}
    for _, g in ipairs(groups) do names[#names + 1] = g.name .. GREY .. " (" .. date("%d/%m %H:%M", g.at) .. ")|r" end
    L.Header("Raids à venir")
    L.Add(GREY .. "Groupes : |r" .. table.concat(names, ", ") .. "\n" .. GREY .. "Inscription de " .. (UnitName("player") or "ce perso") .. ", envoyée au site avec l'export.|r")
    local raids = G.Raids()
    if #raids == 0 then L.Add(GREY .. "Aucun raid à venir.|r") end
    for _, e in ipairs(raids) do
      local when = e.raid.time > 0 and date("%d/%m %H:%M", e.raid.time) or "date à définir"
      local site = e.onSite and (GREY .. "  site : " .. (G.LABEL[e.onSite] or e.onSite) .. (e.siteChar and (" (" .. e.siteChar .. ")") or "") .. "|r") or ""
      local game = e.status and (GREEN .. "  en jeu : " .. G.LABEL[e.status] .. "|r") or ""
      local buttons = {}
      for _, st in ipairs(G.STATUSES) do
        buttons[#buttons + 1] = { (e.status == st.key and "> " or "") .. st.label, 100, function()
          G.SignUp(e.group.id, e.raid.id, st.key, e.raid.time) U.Refresh()
        end }
      end
      L.Add(GOLD .. e.raid.name .. "|r  " .. when .. site .. game, buttons)
    end
  end
  L.Done()
end

local function buildCompo(p)
  hint(p, "Sur le site : page du raid, « Export pour le jeu », Copier, puis colle ici (Ctrl+V) et « Charger ».")
  p.input = textArea(p, 6, -42, 526, 40)
  local load = button(p, "Charger", 110, function()
    local ok, err = ns.Compo.Load(p.input:GetText())
    if ok then p.input:SetText("") p.input:ClearFocus() U.Refresh() else ns.print(err) end
  end)
  load:SetPoint("TOPLEFT", 4, -94)
  local invite = button(p, "Inviter", 110, function() ns.Compo.Invite() end)
  invite:SetPoint("LEFT", load, "RIGHT", 8, 0)
  local arrange = button(p, "Placer les groupes", 160, function() ns.Compo.Arrange() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 8, 0)
  p.list = list(p, -126)
end
refreshers.compo = function(p)
  local L = p.list
  L.Reset()
  local raid = ns.Compo.Get()
  if not raid then
    L.Header("Compo")
    L.Add(GREY .. "Aucune compo chargée.|r")
  else
    local when = (raid.time and raid.time > 0) and date("%d/%m %H:%M", raid.time) or "date non fixée"
    local status, ok, total = ns.Compo.Status(), 0, 0
    for _, s in ipairs(status) do if s.m.group > 0 then total = total + 1 if s.state == "ok" then ok = ok + 1 end end end
    L.Header(raid.name .. "  ·  " .. when)
    L.Add(ok .. "/" .. total .. " persos placés au bon endroit")
    local group
    for _, s in ipairs(status) do
      local m = s.m
      if m.group ~= group then
        group = m.group
        L.Header(group > 0 and ("Groupe " .. group) or "Non placés")
      end
      L.Add(string.format("%s  %s%s %s|r  %s%s", colored(m.class, m.name), GREY, m.role or "", m.spec or "", STATE[s.state] or s.state,
        (s.state ~= "missing" and s.online == false) and " |cffff6b5e(hors ligne)|r" or ""))
    end
  end
  L.Done()
end

local function buildPatrons(p)
  hint(p, "Patron vu ailleurs (hôtel des ventes, chat) : tape " .. GOLD .. "/fr cherche|r, Maj+clic sur l'objet pour mettre son lien, puis Entrée.")
  p.list = list(p, -40)
end
refreshers.patrons = function(p)
  local G, L = ns.Group, p.list
  L.Reset()
  local tracked, others = G.BagPatterns()
  L.Header("Suivis par ton groupe")
  if #tracked == 0 then L.Add(GREY .. "Aucun dans tes sacs (charge les données du site dans l'onglet Raids).|r") end
  for _, e in ipairs(tracked) do
    local link = G.linkFor(e.itemId, e.who and e.who.recipe)
    local parts = {}
    if e.who then parts[#parts + 1] = G.joinNames(e.who.wanted) and (GREEN .. "recherché par " .. G.joinNames(e.who.wanted) .. "|r") or (GREY .. "personne ne le recherche|r") end
    if e.bis then parts[#parts + 1] = BLUE .. "BiS de " .. G.joinNames(e.bis) .. "|r" end
    L.Add(link .. "  " .. table.concat(parts, "  "), { { "Annoncer", 120, function() G.Announce(e.itemId) end } })
  end
  L.Header("Autres patrons de tes sacs")
  if #others == 0 then L.Add(GREY .. "Aucun.|r") end
  for _, e in ipairs(others) do
    local on = G.IsWantedHere(e.itemId)
    L.Add(G.linkFor(e.itemId), { { on and "Retirer" or "Je le recherche", 150, function() G.ToggleWanted(e.itemId, G.linkFor(e.itemId)) U.Refresh() end } })
  end
  local marks = ns.charDB().wanted or {}
  local any = false
  for itemId, on in pairs(marks) do
    if not any then L.Header("Marqués en jeu (envoyés avec l'export)") any = true end
    L.Add(G.linkFor(itemId) .. "  " .. (on and (GREEN .. "recherché|r") or (GREY .. "retiré|r")), { { "Annuler", 100, function() marks[itemId] = nil U.Refresh() end } })
  end
  L.Done()
end

local function buildExport(p)
  hint(p, "Ctrl+C pour copier, puis sur le site : page " .. GOLD .. "Addon|r, « Mettre à jour mes persos ». Tous tes persos relevés sont inclus.")
  p.text = textArea(p, 6, -42, 526, 270)
  p.text:SetScript("OnTextChanged", function(self, user) if user then self:SetText(p.value or "") self:HighlightText() end end)
  local again = button(p, "Actualiser", 120, function() U.Refresh() end)
  again:SetPoint("TOPLEFT", 4, -324)
  p.chars = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.chars:SetPoint("TOPLEFT", 6, -358) p.chars:SetWidth(530) p.chars:SetJustifyH("LEFT")
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

-- Onglet à icône sur le côté, comme ceux de la fiche de perso de Forever
local function sideTab(parent, index, t)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(54, 54)
  b:SetPoint("TOPLEFT", parent, "TOPRIGHT", -4, -44 - (index - 1) * 58)
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetSize(54, 60) bg:SetPoint("CENTER")
  if not atlas(bg, ART.tab) then bg:SetColorTexture(0.1, 0.08, 0.05, 0.9) end
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(46, 46) icon:SetPoint("CENTER", -3, 0)
  icon:SetTexture(t.icon)
  local okMask, mask = pcall(b.CreateMaskTexture, b)
  if okMask and mask and pcall(mask.SetAtlas, mask, ART.tabMask, false) then
    mask:SetSize(54, 60) mask:SetPoint("CENTER")
    icon:AddMaskTexture(mask)
  else
    icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  end
  b.selected = b:CreateTexture(nil, "OVERLAY")
  b.selected:SetSize(54, 60) b.selected:SetPoint("CENTER")
  if not atlas(b.selected, ART.tabSelected) then b.selected:SetColorTexture(1, 0.82, 0, 0.25) end
  b.selected:Hide()
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetSize(54, 60) hl:SetPoint("CENTER")
  if not atlas(hl, ART.tabHover) then hl:SetColorTexture(1, 1, 1, 0.15) end
  b:SetScript("OnClick", function() U.Show(t.key) end)
  b:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(t.label)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() GameTooltip:Hide() end)
  return b
end

local function buildMain()
  main = window("ForeverRosterMain", "Forever Roster", 600, 600)
  main.tabs = {}
  for k, t in ipairs(TABS) do
    main.tabs[t.key] = sideTab(main, k, t)
    local p = CreateFrame("Frame", nil, main)
    p:SetPoint("TOPLEFT", 14, -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
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
  for _, t in ipairs(TABS) do
    local on = t.key == tab
    if on then pages[t.key]:Show() main:SetWindowTitle("Forever Roster  ·  " .. t.label) else pages[t.key]:Hide() end
    if on then main.tabs[t.key].selected:Show() else main.tabs[t.key].selected:Hide() end
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

-- Alerte : patron suivi ou BiS ramassé (portrait : l'icône de l'objet)
local alert
function U.LootAlert(itemId, link)
  if not alert then
    alert = window("ForeverRosterLoot", "Objet suivi ramassé", 440, 150)
    alert:ClearAllPoints() alert:SetPoint("TOP", 0, -160)
    alert.text = alert:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    alert.text:SetPoint("TOPLEFT", 66, -34) alert.text:SetWidth(360) alert.text:SetJustifyH("LEFT")
    alert.announce = button(alert, "Annoncer au groupe", 170, nil)
    alert.announce:SetPoint("BOTTOMLEFT", 16, 14)
    local close = button(alert, "Fermer", 110, function() alert:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -16, 14)
  end
  local G = ns.Group
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local icon = (C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(itemId)) or (GetItemIcon and GetItemIcon(itemId))
  if icon then alert:SetIcon(icon) end
  local lines = { link or G.linkFor(itemId, who and who.recipe) }
  if who then lines[#lines + 1] = G.joinNames(who.wanted) and (GREEN .. "Patron recherché par " .. G.joinNames(who.wanted) .. "|r") or (GREY .. "Patron que personne ne recherche.|r") end
  if who and G.joinNames(who.known, 5) then lines[#lines + 1] = GREY .. "Déjà connu par " .. G.joinNames(who.known, 5) .. "|r" end
  if bis then lines[#lines + 1] = BLUE .. "BiS de " .. G.joinNames(bis) .. "|r" end
  alert.text:SetText(table.concat(lines, "\n"))
  alert.announce:SetScript("OnClick", function() G.Announce(itemId, link) alert:Hide() end)
  alert:Show()
end
