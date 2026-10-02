-- Fenêtres : compo (coller l'export du site) et export du perso (texte à copier).
local _, ns = ...
local U = {}
ns.UI = U

local GOLD = "|cffe3b54b"
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

-- Compo
local compo
local function buildCompo()
  compo = window("ForeverRosterCompo", "Forever Roster : compo de raid", 520, 520)
  local hint = compo:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  hint:SetPoint("TOPLEFT", 14, -32) hint:SetWidth(490) hint:SetJustifyH("LEFT")
  hint:SetText("Sur le site : page du raid, Export pour le jeu, copie le texte, puis colle-le ici (Ctrl+V).")
  compo.input = textArea(compo, 14, -52, 470, 70)
  local load = button(compo, "Charger", 100, function()
    local ok, err = ns.Compo.Load(compo.input:GetText())
    if ok then compo.input:SetText("") compo.input:ClearFocus() U.RefreshCompo() else ns.print(err) end
  end)
  load:SetPoint("TOPLEFT", 14, -132)
  local invite = button(compo, "Inviter", 100, function() ns.Compo.Invite() end)
  invite:SetPoint("LEFT", load, "RIGHT", 8, 0)
  local arrange = button(compo, "Placer les groupes", 150, function() ns.Compo.Arrange() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 8, 0)
  local refresh = button(compo, "Rafraîchir", 100, function() U.RefreshCompo() end)
  refresh:SetPoint("LEFT", arrange, "RIGHT", 8, 0)

  local sf = CreateFrame("ScrollFrame", nil, compo, "UIPanelScrollFrameTemplate")
  sf:SetPoint("TOPLEFT", 14, -166) sf:SetPoint("BOTTOMRIGHT", -32, 14)
  local body = CreateFrame("Frame", nil, sf)
  body:SetSize(470, 10)
  sf:SetScrollChild(body)
  compo.list = body:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  compo.list:SetPoint("TOPLEFT") compo.list:SetWidth(470) compo.list:SetJustifyH("LEFT") compo.list:SetSpacing(3)
  compo.body = body
  compo:SetScript("OnShow", U.RefreshCompo)
end

function U.RefreshCompo()
  if not compo or not compo:IsShown() then return end
  local raid = ns.Compo.Get()
  if not raid then compo.list:SetText("Aucune compo chargée.") return end
  local when = (raid.time and raid.time > 0) and date("%d/%m %H:%M", raid.time) or "date non fixée"
  local rows, group = { GOLD .. raid.name .. "|r  (" .. when .. ")" }, nil
  local ok, total = 0, 0
  for _, s in ipairs(ns.Compo.Status()) do
    local m = s.m
    if m.group ~= group then
      group = m.group
      rows[#rows + 1] = " "
      rows[#rows + 1] = GOLD .. (group > 0 and ("Groupe " .. group) or "Non placés") .. "|r"
    end
    local c = CLASS_COLOR[m.class]
    local name = c and ("|c" .. (c.colorStr or "ffffffff") .. m.name .. "|r") or m.name
    rows[#rows + 1] = string.format("  %s  |cff9aa3b6%s %s|r  %s%s", name, m.role or "", m.spec or "", STATE[s.state] or s.state,
      (s.state ~= "missing" and s.online == false) and " |cffff6b5e(hors ligne)|r" or "")
    if m.group > 0 then total = total + 1 if s.state == "ok" then ok = ok + 1 end end
  end
  rows[2] = "  " .. ok .. "/" .. total .. " persos placés au bon endroit"
  compo.list:SetText(table.concat(rows, "\n"))
  compo.body:SetHeight(compo.list:GetStringHeight() + 10)
end
ns.on("GROUP_ROSTER_UPDATE", function() U.RefreshCompo() end)

function U.ShowCompo()
  if not compo then buildCompo() end
  compo:Show()
end

-- Export
local export
function U.ShowExport()
  if not export then
    export = window("ForeverRosterExport", "Forever Roster : export du perso", 520, 360)
    local hint = export:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    hint:SetPoint("TOPLEFT", 14, -32) hint:SetWidth(490) hint:SetJustifyH("LEFT")
    hint:SetText("Ctrl+C pour copier, puis sur le site : fiche du perso, Importer depuis l'addon. Ouvre d'abord tes fenêtres de métier pour inclure tes patrons.")
    export.text = textArea(export, 14, -62, 470, 250)
    export.text:SetScript("OnTextChanged", function(self, user) if user then self:SetText(export.value or "") self:HighlightText() end end)
    local again = button(export, "Actualiser", 110, function() U.ShowExport() end)
    again:SetPoint("BOTTOMRIGHT", -14, 12)
  end
  local ok, value = pcall(ns.Export.Build)
  if not ok then ns.print("|cffff6060erreur (export)|r " .. tostring(value)) return end
  export.value = value
  export.text:SetText(export.value)
  export:Show()
  export.text:SetFocus()
  export.text:HighlightText()
end

-- Groupe : données du site (raids à venir, patrons suivis), inscriptions en jeu, patrons des sacs
local groupWin
local rows = {}
local function row(i)
  if rows[i] then return rows[i] end
  local r = CreateFrame("Frame", nil, groupWin.body)
  r:SetSize(500, 40)
  r.text = r:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  r.text:SetPoint("TOPLEFT", 0, 0) r.text:SetWidth(500) r.text:SetJustifyH("LEFT")
  r.buttons = {}
  rows[i] = r
  return r
end
local function rowButton(r, k, label, w, onClick)
  local b = r.buttons[k]
  if not b then b = button(r, label, w, nil) r.buttons[k] = b end
  b:SetSize(w, 22) b:SetText(label) b:SetScript("OnClick", onClick)
  b:ClearAllPoints()
  b:SetPoint("TOPLEFT", (k - 1) * (w + 6), -18)
  b:Show()
  return b
end

function U.RefreshGroup()
  if not groupWin or not groupWin:IsShown() then return end
  local G, i, y = ns.Group, 0, 0
  local function add(text, height, fill)
    i = i + 1
    local r = row(i)
    for _, b in pairs(r.buttons) do b:Hide() end
    r:ClearAllPoints() r:SetPoint("TOPLEFT", 0, -y) r:SetHeight(height) r:Show()
    r.text:SetText(text)
    if fill then fill(r) end
    y = y + height
  end
  local groups = G.List()
  if #groups == 0 then
    add("Aucun groupe chargé. Sur le site : ton groupe, onglet Raids, « Données pour l'addon », Copier, puis colle ici.", 40)
  else
    local names = {}
    for _, g in ipairs(groups) do names[#names + 1] = g.name .. " (" .. date("%d/%m %H:%M", g.at) .. ")" end
    add(GOLD .. "Groupes chargés|r : " .. table.concat(names, ", "), 24)
    add(GOLD .. "Raids à venir|r  (inscription de " .. (UnitName("player") or "ce perso") .. ")", 22)
    local raids = G.Raids()
    if #raids == 0 then add("  aucun raid à venir", 20) end
    for _, e in ipairs(raids) do
      local when = e.raid.time > 0 and date("%d/%m %H:%M", e.raid.time) or "date à définir"
      local site = e.onSite and ("  |cff9aa3b6site : " .. (G.LABEL[e.onSite] or e.onSite) .. (e.siteChar and (" (" .. e.siteChar .. ")") or "") .. "|r") or ""
      local game = e.status and ("  |cff4fd35fen jeu : " .. G.LABEL[e.status] .. " (à envoyer)|r") or ""
      add(e.raid.name .. "  |cff9aa3b6" .. when .. "|r" .. site .. game, 46, function(r)
        for k, st in ipairs(G.STATUSES) do
          rowButton(r, k, (e.status == st.key and "> " or "") .. st.label, 92, function()
            G.SignUp(e.group.id, e.raid.id, st.key, e.raid.time)
            U.RefreshGroup()
          end)
        end
      end)
    end
    add(" ", 8)
    add(GOLD .. "Patrons suivis dans tes sacs|r", 22)
    local bag = G.BagPatterns()
    if #bag == 0 then add("  aucun", 20) end
    for _, p in ipairs(bag) do
      local _, link = GetItemInfo and GetItemInfo(p.itemId)
      local wanted = G.joinNames(p.who.wanted)
      add((link or p.who.recipe) .. "  " .. (wanted and ("|cff4fd35frecherché par " .. wanted .. "|r") or "|cff9aa3b6personne ne le recherche|r"), 46, function(r)
        rowButton(r, 1, "Annoncer", 110, function() G.Announce(p.itemId, link) end)
      end)
    end
  end
  for k = i + 1, #rows do rows[k]:Hide() end
  groupWin.body:SetHeight(y + 10)
end

function U.ShowGroup()
  if not groupWin then
    groupWin = window("ForeverRosterGroup", "Forever Roster : groupe", 560, 560)
    local hint = groupWin:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    hint:SetPoint("TOPLEFT", 14, -32) hint:SetWidth(530) hint:SetJustifyH("LEFT")
    hint:SetText("Sur le site : ton groupe, onglet Raids, « Données pour l'addon », Copier, puis colle ici (Ctrl+V).")
    groupWin.input = textArea(groupWin, 14, -52, 510, 50)
    local load = button(groupWin, "Charger", 100, function()
      local ok, err = ns.Group.Load(groupWin.input:GetText())
      if ok then groupWin.input:SetText("") groupWin.input:ClearFocus() U.RefreshGroup() else ns.print(err) end
    end)
    load:SetPoint("TOPLEFT", 14, -112)
    local refresh = button(groupWin, "Rafraîchir", 100, function() U.RefreshGroup() end)
    refresh:SetPoint("LEFT", load, "RIGHT", 8, 0)
    local sf = CreateFrame("ScrollFrame", nil, groupWin, "UIPanelScrollFrameTemplate")
    sf:SetPoint("TOPLEFT", 14, -146) sf:SetPoint("BOTTOMRIGHT", -32, 14)
    groupWin.body = CreateFrame("Frame", nil, sf)
    groupWin.body:SetSize(510, 10)
    sf:SetScrollChild(groupWin.body)
    groupWin:SetScript("OnShow", U.RefreshGroup)
  end
  groupWin:Show()
end
ns.on("BAG_UPDATE_DELAYED", function() U.RefreshGroup() end)

-- Alerte : patron suivi ramassé
local alert
function U.LootAlert(itemId, link, who)
  if not alert then
    alert = window("ForeverRosterLoot", "Forever Roster : patron ramassé", 420, 130)
    alert:ClearAllPoints() alert:SetPoint("TOP", 0, -160)
    alert.text = alert:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    alert.text:SetPoint("TOPLEFT", 14, -32) alert.text:SetWidth(390) alert.text:SetJustifyH("LEFT")
    alert.announce = button(alert, "Annoncer au groupe", 160, nil)
    alert.announce:SetPoint("BOTTOMLEFT", 14, 12)
    local close = button(alert, "Fermer", 100, function() alert:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -14, 12)
  end
  local wanted, known = ns.Group.joinNames(who.wanted), ns.Group.joinNames(who.known, 5)
  alert.text:SetText((link or who.recipe) .. "\n" .. (wanted and ("|cff4fd35fRecherché par " .. wanted .. "|r") or "|cff9aa3b6Personne ne le recherche.|r")
    .. (known and ("\n|cff9aa3b6Déjà connu par " .. known .. "|r") or ""))
  alert.announce:SetScript("OnClick", function() ns.Group.Announce(itemId, link) alert:Hide() end)
  alert:Show()
end
