-- Bouton autour de la minicarte : clic pour ouvrir la fenêtre, glisser pour le déplacer, /fr minicarte pour le masquer.
local _, ns = ...
local M = {}
ns.Minimap = M

local button

local function place()
  local angle = math.rad(ForeverRosterDB.minimap and ForeverRosterDB.minimap.angle or 210)
  local r = (Minimap:GetWidth() / 2) + 10
  button:ClearAllPoints()
  button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * r, math.sin(angle) * r)
end

local function onDrag()
  local mx, my = Minimap:GetCenter()
  local cx, cy = GetCursorPosition()
  local scale = Minimap:GetEffectiveScale()
  ForeverRosterDB.minimap.angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx))
  place()
end

function M.Create()
  if button or not Minimap then return end
  ForeverRosterDB.minimap = ForeverRosterDB.minimap or { angle = 210, hidden = false }
  button = CreateFrame("Button", "ForeverRosterMinimapButton", Minimap)
  button:SetSize(31, 31)
  button:SetFrameStrata("MEDIUM")
  button:SetFrameLevel(8)
  button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
  button:RegisterForDrag("LeftButton")
  button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")
  local icon = button:CreateTexture(nil, "BACKGROUND")
  icon:SetTexture("Interface\\Icons\\INV_Misc_Book_09")
  icon:SetSize(20, 20)
  icon:SetPoint("CENTER", 0, 1)
  local border = button:CreateTexture(nil, "OVERLAY")
  border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
  border:SetSize(53, 53)
  border:SetPoint("TOPLEFT")
  -- Pastille : nombre de persos à envoyer au site
  button.badge = CreateFrame("Frame", nil, button)
  button.badge:SetSize(16, 16) button.badge:SetPoint("TOPRIGHT", 4, 2)
  local dot = button.badge:CreateTexture(nil, "OVERLAY")
  dot:SetAllPoints()
  if not (dot.SetAtlas and pcall(dot.SetAtlas, dot, "communities-icon-notification", false)) then dot:SetColorTexture(0.75, 0.12, 0.08, 1) end
  button.badge.text = button.badge:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  button.badge.text:SetPoint("CENTER", 0, 0)
  button.badge:Hide()
  button:SetScript("OnClick", function(_, which)
    if which == "RightButton" then ns.UI.Quick() else ns.UI.Toggle() end
  end)
  button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", onDrag) end)
  button:SetScript("OnDragStop", function(self) self:SetScript("OnUpdate", nil) end)
  button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Forever Roster")
    local n = M.count or 0
    if n > 0 then GameTooltip:AddLine(n .. " perso(s) à envoyer au site", 1, 0.82, 0) end
    GameTooltip:AddLine("Clic : ouvrir la fenêtre", 1, 1, 1)
    GameTooltip:AddLine("Clic droit : synchro rapide avec le site", 1, 1, 1)
    GameTooltip:AddLine("Glisser : déplacer le bouton", 0.6, 0.64, 0.71)
    GameTooltip:Show()
  end)
  button:SetScript("OnLeave", function() GameTooltip:Hide() end)
  place()
  if ForeverRosterDB.minimap.hidden then button:Hide() end
  M.Update()
end

-- Met à jour la pastille (persos changés depuis leur dernier envoi)
function M.Update()
  local ok, pending = pcall(ns.Export.Pending)
  M.count = ok and #pending or 0
  if not button then return end
  if M.count > 0 then button.badge.text:SetText(M.count) button.badge:Show() else button.badge:Hide() end
end

-- Afficher ou masquer le bouton (onglet Options, /fr minicarte)
function M.SetShown(show)
  if not button then M.Create() end
  ForeverRosterDB.minimap = ForeverRosterDB.minimap or { angle = 210 }
  ForeverRosterDB.minimap.hidden = not show or nil
  if button then if show then button:Show() else button:Hide() end end
end

function M.Toggle()
  if not button then M.Create() end
  if not button then return end
  ForeverRosterDB.minimap.hidden = not ForeverRosterDB.minimap.hidden
  if ForeverRosterDB.minimap.hidden then button:Hide() ns.print("bouton de la minicarte masqué (/fr minicarte pour le remettre).")
  else button:Show() end
end

ns.on("PLAYER_LOGIN", function() ns.safe("minicarte", M.Create) end)
