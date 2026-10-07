-- Bouton autour de la minicarte (clic : fenêtre, clic droit : synchro rapide, glisser : déplacer, /roster minicarte :
-- masquer) et entrée de Roster dans la liste des addons de la minicarte (## AddonCompartmentFunc du .toc, Retail 10.1+).
local ADDON, ns = ...
local M = {}
ns.Minimap = M

local button

-- Forme de la minicarte : ronde sur Retail ; des addons de minicarte la rendent carrée et définissent GetMinimapShape.
-- Quart arrondi ou non : { bas droite, bas gauche, haut droite, haut gauche }
local SHAPES = {
  ROUND = { true, true, true, true }, SQUARE = { false, false, false, false },
  ["CORNER-TOPLEFT"] = { false, false, false, true }, ["CORNER-TOPRIGHT"] = { false, false, true, false },
  ["CORNER-BOTTOMLEFT"] = { false, true, false, false }, ["CORNER-BOTTOMRIGHT"] = { true, false, false, false },
  ["SIDE-LEFT"] = { false, true, false, true }, ["SIDE-RIGHT"] = { true, false, true, false },
  ["SIDE-TOP"] = { false, false, true, true }, ["SIDE-BOTTOM"] = { true, true, false, false },
  ["TRICORNER-TOPLEFT"] = { false, true, true, true }, ["TRICORNER-TOPRIGHT"] = { true, false, true, true },
  ["TRICORNER-BOTTOMLEFT"] = { true, true, false, true }, ["TRICORNER-BOTTOMRIGHT"] = { true, true, true, false },
}

local function settings()
  local db = ns.db()
  db.minimap = db.minimap or { angle = 225 }
  return db.minimap
end

local function place()
  local a = math.rad(settings().angle or 225)
  local x, y = math.cos(a), math.sin(a)
  local q = 1
  if x < 0 then q = q + 1 end
  if y > 0 then q = q + 2 end
  local okShape, shape = pcall(function() return GetMinimapShape and GetMinimapShape() end)
  local round = (SHAPES[okShape and shape or "ROUND"] or SHAPES.ROUND)[q]
  -- Le centre du bouton à 5 px du bord de la minicarte
  local w, h = (Minimap:GetWidth() or 140) / 2 + 5, (Minimap:GetHeight() or Minimap:GetWidth() or 140) / 2 + 5
  if round then
    x, y = x * w, y * h
  else -- coin carré : le bouton suit le bord
    local dw, dh = math.sqrt(2 * w * w) - 10, math.sqrt(2 * h * h) - 10
    x = math.max(-w, math.min(x * dw, w))
    y = math.max(-h, math.min(y * dh, h))
  end
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", x, y)
end

local function onDrag()
  local mx, my = Minimap:GetCenter()
  local cx, cy = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale() or 1
  if not (mx and cx) then return end
  settings().angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
  place()
end

-- Infobulle du bouton et de l'entrée dans la liste des addons
local function tooltip(owner, anchor, drag)
  if not GameTooltip then return end
  GameTooltip:SetOwner(owner, anchor or "ANCHOR_LEFT")
  GameTooltip:AddLine("Roster")
  M.Update()
  if M.count > 0 then GameTooltip:AddLine(M.count .. " envoi(s) en attente pour le site", 0.66, 0.78, 0.92) end
  if M.recording then GameTooltip:AddLine("Relevé du raid en cours (présence et butin)", 1, 0.23, 0.19) end
  GameTooltip:AddLine("Clic : ouvrir la fenêtre", 1, 1, 1)
  GameTooltip:AddLine("Clic droit : synchro rapide avec le site", 1, 1, 1)
  if drag then GameTooltip:AddLine("Glisser : déplacer le bouton", 0.6, 0.64, 0.71) end
  GameTooltip:Show()
end

local function click(which)
  if which == "RightButton" then ns.call("UI", "Quick") else ns.call("UI", "Toggle") end
end

function M.Create()
  if button or not Minimap or not ns.db() then return end
  local s = settings()
  button = CreateFrame("Button", "RosterMinimapButton", Minimap)
  button:SetSize(31, 31)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(8)
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")
  button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  -- Dimensions du bouton de minicarte sur Retail : anneau de 50 px en haut à gauche, icône au centre
  local icon = button:CreateTexture(nil, "ARTWORK")
  icon:SetTexture(ns.LOGO)
  icon:SetSize(21, 21)
  icon:SetPoint("CENTER", 0, 0)
  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(50, 50)
  border:SetPoint("TOPLEFT")
  -- Pastille : nombre d'envois en attente pour le site
  button.badge = CreateFrame("Frame", nil, button)
  button.badge:SetSize(16, 16) button.badge:SetPoint("TOPRIGHT", 4, 2)
  local dot = button.badge:CreateTexture(nil, "OVERLAY")
  dot:SetAllPoints()
  if not ns.Kit.hasAtlas(dot, "communities-icon-notification") then dot:SetColorTexture(0.75, 0.12, 0.08, 1) end
  button.badge.text = button.badge:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  button.badge.text:SetPoint("CENTER", 0, 0)
  button.badge:Hide()
  -- « REC » : relevé du raid en cours (présence et butin)
  button.rec = button:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  button.rec:SetPoint("BOTTOM", 0, -6)
  button.rec:SetText("|cffff3b30REC|r")
  button.rec:Hide()
  button:SetScript("OnClick", function(_, which) ns.safe("minicarte", click, which) end)
  button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", onDrag) end)
  button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  button:SetScript("OnEnter", function(self) ns.safe("minicarte", tooltip, self, "ANCHOR_LEFT", true) end)
  button:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  place()
  if s.hidden then button:Hide() else button:Show() end
  M.button = button
  M.Update()
  -- Pastille et « REC » tenus à jour même sans changement visible (début et fin du relevé)
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(20, function() ns.safe("minicarte", M.Update) end) end
end

-- Met à jour la pastille (envois en attente) et « REC » (relevé en cours)
function M.Update()
  local okCount, n = pcall(function() return ns.Data and ns.Data.PendingCount and ns.Data.PendingCount() or 0 end)
  local okRec, rec = pcall(function() return ns.Recorder and ns.Recorder.IsRecording and ns.Recorder.IsRecording() end)
  M.count = okCount and tonumber(n) or 0
  M.recording = okRec and rec and true or false
  if not button then return end
  if M.count > 0 then button.badge.text:SetText(M.count) button.badge:Show() else button.badge:Hide() end
  if M.recording then button.rec:Show() else button.rec:Hide() end
end

-- Afficher ou masquer le bouton (onglet Options, /roster minicarte)
function M.SetShown(show)
  if not button then M.Create() end
  settings().hidden = not show or nil
  if button then if show then button:Show() else button:Hide() end end
end

function M.Toggle()
  local show = ns.db().minimap and ns.db().minimap.hidden and true or false -- masqué : on le remet
  M.SetShown(show)
  if not show then ns.print("bouton de la minicarte masqué (/roster minicarte pour le remettre ; Roster reste dans la liste des addons de la minicarte).") end
end

-- Liste des addons de la minicarte (Retail) : fonctions nommées dans le .toc (## AddonCompartmentFunc…)
function Roster_OnCompartmentClick(_, which) ns.safe("liste des addons", click, which) end
function Roster_OnCompartmentEnter(_, frame) ns.safe("liste des addons", tooltip, frame or UIParent, "ANCHOR_LEFT") end
function Roster_OnCompartmentLeave() if GameTooltip then GameTooltip:Hide() end end

ns.on("PLAYER_LOGIN", function() ns.safe("minicarte", M.Create) end)
