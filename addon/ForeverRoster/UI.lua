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
