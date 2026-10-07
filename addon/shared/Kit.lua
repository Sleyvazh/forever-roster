-- Boîte à outils commune aux addons Forever Roster et Roster (dossier addon/shared, copié dans chaque zip) :
-- fenêtres, boutons, listes, tableaux, habillages « jeu » et « site », infobulles d'objets, icônes de rôle.
-- Chaque addon pose avant ce fichier (Core.lua) : ns.db() (sa sauvegarde), ns.LOGO, et au besoin ns.palette.
local ADDON, ns = ...
local K = {}
ns.Kit = K
local GOLD, GREY, GREEN, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cff6fb7ff"
local CLASS_COLOR = RAID_CLASS_COLORS or {}

-- Habillage de l'interface de Forever (relevé sur la fiche de perso) : cadre « PortraitFrameTemplate » aux textures
-- de Forever, fonds de la fiche, barres de titre de section, lignes alternées, onglets à icône sur le côté.
local ART = {
  bg = "UI-Character-Info-General-BG", header = "UI-Character-Info-Title", line = "UI-Character-Info-Line-Bounce2",
  inset = "common-insideframe", tab = "common-sidetab", tabMask = "common-sidetab-mask", tabSelected = "common-sidetab-selected",
  tabHover = "common-sidetab-hover", divider = "UI-Character-Info-ScrollLine",
}

-- Atlas absent du client (sur Retail, SetAtlas d'un atlas inconnu ne lève pas d'erreur et laisse une texture vide) :
-- rien de posé, l'appelant met sa couleur de repli
local function atlas(tex, name)
  if C_Texture and C_Texture.GetAtlasInfo and not C_Texture.GetAtlasInfo(name) then return false end
  if tex.SetAtlas and pcall(tex.SetAtlas, tex, name, false) then return true end
  return false
end

-- Habillage « site » : couleurs du thème sombre du site, titres en Marcellus SC (police livrée avec l'addon, licence OFL)
local function site() local db = ns.db and ns.db() return db and db.skin == "site" end
local C = {
  bg = { 0.027, 0.039, 0.071 }, panel = { 0.055, 0.078, 0.153 }, panel2 = { 0.078, 0.106, 0.2 },
  line = { 0.137, 0.173, 0.278 }, line2 = { 0.204, 0.251, 0.373 }, frame = { 0.427, 0.353, 0.173 },
  gold = { 0.902, 0.749, 0.341 }, ink = { 0.925, 0.906, 0.847 }, ink2 = { 0.663, 0.69, 0.761 },
}
-- Couleurs propres à l'addon (Roster : argent-azur à la place de l'or), posées par son Core.lua avant ce fichier
for k, v in pairs(ns.palette or {}) do C[k] = v end
local TITLE_FONT = "Interface\\AddOns\\" .. (ADDON or "ForeverRoster") .. "\\Fonts\\MarcellusSC.ttf"
local function solid(tex, c, a) tex:SetColorTexture(c[1], c[2], c[3], a or 1) end
-- Contour de 1 px (4 textures) ; renvoie la liste pour le recolorer
local function edges(f, c, layer)
  local list = {}
  for i, e in ipairs({ { "TOPLEFT", "TOPRIGHT", 0, 1 }, { "BOTTOMLEFT", "BOTTOMRIGHT", 0, 1 }, { "TOPLEFT", "BOTTOMLEFT", 1, 0 }, { "TOPRIGHT", "BOTTOMRIGHT", 1, 0 } }) do
    local t = f:CreateTexture(nil, layer or "BORDER")
    t:SetPoint(e[1]) t:SetPoint(e[2])
    if e[3] > 0 then t:SetWidth(e[3]) else t:SetHeight(e[4]) end
    solid(t, c)
    list[i] = t
  end
  return list
end
local function recolor(list, c) for _, t in ipairs(list) do solid(t, c) end end
-- Police des titres du site ; si elle manque (addon incomplet), police du jeu
local function titleFont(fs, size)
  if fs.SetFont then pcall(fs.SetFont, fs, TITLE_FONT, size, "") end
  if not (fs.GetFont and fs:GetFont()) then fs:SetFontObject(GameFontNormalLarge) end
  fs:SetTextColor(C.gold[1], C.gold[2], C.gold[3])
end
-- Losange doré (ornement des cadres du site)
local function diamond(parent, size, c)
  local t = parent:CreateTexture(nil, "OVERLAY")
  t:SetSize(size, size)
  solid(t, c or C.frame)
  if t.SetRotation then t:SetRotation(math.rad(45)) end
  return t
end
-- Décalage du contenu des petites fenêtres : place du portrait (habillage Forever) ou non
local function gapX() return site() and 18 or 66 end

-- Premier plan : plusieurs fenêtres de l'addon peuvent se chevaucher (fenêtre principale, butin, conseil, fiche du boss).
-- Même strate pour toutes : sans niveau propre, les lignes de l'une passeraient au-dessus du fond de l'autre.
-- La fenêtre ouverte ou cliquée en dernier prend un niveau au-dessus des autres (ses cadres enfants suivent).
local frontLevel = 10
local function front(f)
  if not f or not f.SetFrameLevel then return end
  frontLevel = frontLevel + 40
  if frontLevel > 8000 then frontLevel = 50 end
  f:SetFrameLevel(frontLevel)
  if f.Raise then f:Raise() end
end
local function stackable(f)
  if f.SetToplevel then f:SetToplevel(true) end
  if f.HookScript then f:HookScript("OnMouseDown", function(self) front(self) end) end
  front(f)
end

local function siteWindow(name, title, w, h, icon)
  local f = CreateFrame("Frame", name, UIParent)
  f:SetSize(w, h)
  f:SetPoint("CENTER")
  f:SetMovable(true) f:EnableMouse(true) f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving) f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:SetFrameStrata("DIALOG")
  stackable(f)
  f:SetClampedToScreen(true)
  local bg = f:CreateTexture(nil, "BACKGROUND", nil, -7)
  bg:SetAllPoints() solid(bg, C.panel, 0.97)
  edges(f, C.frame)
  -- Bandeau du titre : fond plus sombre, filet doré dessous, losanges aux coins comme les cadres du site
  local bar = f:CreateTexture(nil, "BACKGROUND", nil, -6)
  bar:SetPoint("TOPLEFT", 1, -1) bar:SetPoint("TOPRIGHT", -1, -1) bar:SetHeight(26) solid(bar, C.bg, 0.95)
  local rule = f:CreateTexture(nil, "BORDER")
  rule:SetPoint("TOPLEFT", 1, -27) rule:SetPoint("TOPRIGHT", -1, -27) rule:SetHeight(1) solid(rule, C.frame)
  diamond(f, 8):SetPoint("CENTER", f, "TOPLEFT", 14, 0)
  diamond(f, 8):SetPoint("CENTER", f, "TOPRIGHT", -14, 0)
  f.icon = f:CreateTexture(nil, "ARTWORK")
  f.icon:SetSize(18, 18) f.icon:SetPoint("TOPLEFT", 8, -5) f.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  f.titleText = f:CreateFontString(nil, "OVERLAY")
  titleFont(f.titleText, 15)
  f.titleText:SetPoint("LEFT", f.icon, "RIGHT", 8, 0)
  local close = CreateFrame("Button", nil, f)
  close:SetSize(22, 22) close:SetPoint("TOPRIGHT", -4, -3)
  local x = close:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
  x:SetPoint("CENTER") x:SetText("×") x:SetTextColor(C.ink2[1], C.ink2[2], C.ink2[3])
  close:SetScript("OnEnter", function() x:SetTextColor(C.gold[1], C.gold[2], C.gold[3]) end)
  close:SetScript("OnLeave", function() x:SetTextColor(C.ink2[1], C.ink2[2], C.ink2[3]) end)
  close:SetScript("OnClick", function() f:Hide() end)
  function f:SetWindowTitle(text) self.titleText:SetText(text) end
  function f:SetIcon(tex)
    self.icon:SetTexture(tex)
    -- Icônes du jeu : bord rogné ; logo de l'addon : en entier
    if tex == ns.LOGO then self.icon:SetTexCoord(0, 1, 0, 1) else self.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92) end
  end
  f:SetWindowTitle(title)
  f:SetIcon(icon or ns.LOGO)
  tinsert(UISpecialFrames, name) -- Échap ferme la fenêtre
  f:Hide()
  return f
end

local function window(name, title, w, h, icon)
  if site() then return siteWindow(name, title, w, h, icon) end
  local ok, f = pcall(CreateFrame, "Frame", name, UIParent, "PortraitFrameTemplate")
  if not ok or not f then f = CreateFrame("Frame", name, UIParent, "BasicFrameTemplateWithInset") end
  f:SetSize(w, h)
  f:SetPoint("CENTER")
  f:SetMovable(true) f:EnableMouse(true) f:RegisterForDrag("LeftButton")
  f:SetScript("OnDragStart", f.StartMoving) f:SetScript("OnDragStop", f.StopMovingOrSizing)
  f:SetFrameStrata("DIALOG")
  stackable(f)
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
  f:SetIcon(icon or ns.LOGO)
  tinsert(UISpecialFrames, name) -- Échap ferme la fenêtre
  f:Hide()
  return f
end

-- Cadre intérieur de Forever autour d'une zone (champ à coller, texte d'export)
local function inset(parent, region)
  if site() then
    local holder = CreateFrame("Frame", nil, parent)
    holder:SetPoint("TOPLEFT", region, "TOPLEFT", -5, 5) holder:SetPoint("BOTTOMRIGHT", region, "BOTTOMRIGHT", 5, -5)
    local back = holder:CreateTexture(nil, "BACKGROUND")
    back:SetAllPoints() solid(back, C.bg, 0.9)
    edges(holder, C.line2)
    return
  end
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

-- Bouton plat du site : fond sombre, contour, texte clair ; contour doré au survol
local function flatButton(parent)
  local b = CreateFrame("Button", nil, parent)
  b.bg = b:CreateTexture(nil, "BACKGROUND")
  b.bg:SetAllPoints() solid(b.bg, C.panel2)
  b.edges = edges(b, C.line2)
  local fs = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  fs:SetPoint("CENTER", 0, 0)
  fs:SetTextColor(C.ink[1], C.ink[2], C.ink[3])
  if b.SetFontString then b:SetFontString(fs) end
  b:SetScript("OnEnter", function(self) recolor(self.edges, C.frame) end)
  b:SetScript("OnLeave", function(self) recolor(self.edges, C.line2) end)
  return b
end

local function button(parent, label, w, onClick)
  local b = site() and flatButton(parent) or CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetSize(w, 24)
  b:SetText(label)
  b:SetScript("OnClick", onClick)
  return b
end

-- Bouton plat à la couleur d'un statut, comme sur le site : contour et texte colorés, fond plein quand il est choisi
local function statusButton(parent)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(100, 22)
  b.bg = b:CreateTexture(nil, "BACKGROUND")
  b.bg:SetAllPoints()
  b.edges = {}
  for i, e in ipairs({ { "TOPLEFT", "TOPRIGHT", 0, 1 }, { "BOTTOMLEFT", "BOTTOMRIGHT", 0, 1 }, { "TOPLEFT", "BOTTOMLEFT", 1, 0 }, { "TOPRIGHT", "BOTTOMRIGHT", 1, 0 } }) do
    local t = b:CreateTexture(nil, "BORDER")
    t:SetPoint(e[1]) t:SetPoint(e[2])
    if e[3] > 0 then t:SetWidth(e[3]) else t:SetHeight(e[4]) end
    b.edges[i] = t
  end
  b.label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  b.label:SetPoint("CENTER", 0, 0)
  b:SetScript("OnEnter", function(self) if not self.selected then self.bg:SetColorTexture(self.r, self.g, self.b, 0.18) end end)
  b:SetScript("OnLeave", function(self) if not self.selected then self.bg:SetColorTexture(0.04, 0.05, 0.09, 0.85) end end)
  return b
end
local function styleStatus(b, label, color, selected)
  b.r, b.g, b.b, b.selected = color[1], color[2], color[3], selected
  b.label:SetText(label)
  for _, t in ipairs(b.edges) do t:SetColorTexture(b.r, b.g, b.b, 1) end
  if selected then
    b.bg:SetColorTexture(b.r, b.g, b.b, 1)
    b.label:SetTextColor(0.05, 0.08, 0.15)
  else
    b.bg:SetColorTexture(0.04, 0.05, 0.09, 0.85)
    b.label:SetTextColor(b.r, b.g, b.b)
  end
end

-- Liens d'objets dans les textes d'un cadre : infobulle du jeu au survol, clic comme dans le chat
-- (Maj+clic : le lien dans la saisie du chat ; clic : fiche de l'objet). Sans effet si le client ne le permet pas.
local function itemTips(f)
  if not f or not f.SetHyperlinksEnabled then return f end
  f:SetHyperlinksEnabled(true)
  if f.EnableMouse and not (f.IsMouseEnabled and f:IsMouseEnabled()) then f:EnableMouse(true) end
  f:SetScript("OnHyperlinkEnter", function(self, link)
    if not GameTooltip or type(link) ~= "string" or not link:find("^item:") then return end
    GameTooltip:SetOwner(self, "ANCHOR_CURSOR")
    GameTooltip:SetHyperlink(link)
    GameTooltip:Show()
  end)
  f:SetScript("OnHyperlinkLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  f:SetScript("OnHyperlinkClick", function(self, link, text, button)
    if SetItemRef and type(link) == "string" then pcall(SetItemRef, link, text, button, self) end
  end)
  return f
end

-- Consigne de l'onglet, en haut à droite du portrait
local function hint(parent, text)
  local h = parent:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  h:SetPoint("TOPLEFT", site() and 6 or 52, -2) h:SetWidth(site() and 526 or 480) h:SetJustifyH("LEFT")
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
    r.buttons, r.sbuttons = {}, {}
    itemTips(r) -- objets des listes (butin, jets, objets à remettre…) : infobulle au survol
    rows[k] = r
    return r
  end
  function L.Reset() y, i, odd = 0, 0, false end
  -- Barre de titre de section (comme « General » sur la fiche de perso)
  function L.Header(text)
    i = i + 1
    local r = row(i)
    for _, b in pairs(r.buttons) do b:Hide() end
    for _, b in pairs(r.sbuttons) do b:Hide() end
    if site() then
      -- Titre de section du site : texte doré à gauche, filet dessous
      r.bg:ClearAllPoints() r.bg:SetPoint("BOTTOMLEFT", 10, 6) r.bg:SetPoint("BOTTOMRIGHT", -10, 6) r.bg:SetHeight(1)
      solid(r.bg, C.line) r.bg:Show()
      titleFont(r.text, 15)
      r.text:ClearAllPoints() r.text:SetPoint("BOTTOMLEFT", 10, 10) r.text:SetWidth(width - 20) r.text:SetJustifyH("LEFT")
    else
    r.bg:ClearAllPoints() r.bg:SetPoint("CENTER", 0, 0) r.bg:SetSize(math.min(width, 320), 36)
    if not atlas(r.bg, ART.header) then r.bg:SetColorTexture(0.25, 0.18, 0.08, 0.8) end
    r.bg:Show()
    r.text:SetFontObject(GameFontHighlight)
    r.text:ClearAllPoints() r.text:SetPoint("CENTER", 0, 1) r.text:SetWidth(width - 20) r.text:SetJustifyH("CENTER")
    end
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
    -- La ligne a pu servir de titre (police du site posée par SetFont) : police du jeu remise explicitement
    if site() and GameFontHighlight and GameFontHighlight.GetFont then pcall(r.text.SetFont, r.text, GameFontHighlight:GetFont()) end
    r.text:SetTextColor(1, 1, 1)
    r.text:ClearAllPoints() r.text:SetPoint("TOPLEFT", 10, -5) r.text:SetWidth(width - 20) r.text:SetJustifyH("LEFT")
    r.text:SetText(text)
    local h = math.max(14, (r.text.GetStringHeight and r.text:GetStringHeight() or 14))
    local x = 10
    for _, b in pairs(r.sbuttons) do b:Hide() end
    for k, spec in ipairs(buttons or {}) do
      local b
      -- spec[4] = { color = { r, g, b }, selected = bool } : bouton plat à la couleur du site (statuts, qualité)
      if spec[4] then
        b = r.sbuttons[k] or statusButton(r)
        r.sbuttons[k] = b
        styleStatus(b, spec[1], spec[4].color, spec[4].selected)
      else
        b = r.buttons[k] or button(r, spec[1], spec[2], nil)
        r.buttons[k] = b
        b:SetText(spec[1])
      end
      b:SetSize(spec[2], 22) b:SetScript("OnClick", spec[3])
      b:ClearAllPoints() b:SetPoint("TOPLEFT", x, -(h + 9)) b:Show()
      x = x + spec[2] + 6
    end
    local height = h + 10 + ((buttons and #buttons > 0) and 28 or 0)
    -- Une ligne sur deux sur fond clair, comme les statistiques de la fiche
    odd = not odd
    r.bg:ClearAllPoints() r.bg:SetAllPoints()
    if site() then
      if odd then solid(r.bg, C.panel2, 0.7) r.bg:Show() else r.bg:Hide() end
    elseif odd and atlas(r.bg, ART.line) then r.bg:Show() else r.bg:Hide() end
    r:ClearAllPoints() r:SetPoint("TOPLEFT", 0, -y) r:SetHeight(height) r:Show()
    y = y + height
  end
  function L.Done()
    for k = i + 1, #rows do rows[k]:Hide() end
    body:SetHeight(y + 10)
  end
  return L
end

-- Tableau défilant (lot I, conseil du butin) : en-têtes de colonnes, une ligne par entrée, boutons dans la dernière colonne.
-- cols : { title, w = largeur fixe } ou { title, flex = poids, min = largeur mini } ; small = petite police, lines = lignes max,
-- tip = infobulle au survol de la cellule (opts.tip(colonne, cadre) à la création de la ligne).
local PAD = 8
local function grid(parent, top, bottom, cols)
  local sf, bar = scrollFrame(parent)
  sf:SetPoint("TOPLEFT", 4, top - 24) sf:SetPoint("BOTTOMRIGHT", -bar, bottom)
  local body = CreateFrame("Frame", nil, sf)
  body:SetSize(400, 10)
  sf:SetScrollChild(body)
  local head = CreateFrame("Frame", nil, parent)
  head:SetPoint("TOPLEFT", 4, top) head:SetPoint("TOPRIGHT", -bar, top) head:SetHeight(22)
  local rule = head:CreateTexture(nil, "BORDER")
  rule:SetPoint("BOTTOMLEFT") rule:SetPoint("BOTTOMRIGHT") rule:SetHeight(1)
  if site() then solid(rule, C.line) else rule:SetColorTexture(0.6, 0.5, 0.3, 0.5) end
  local G = { body = body, rows = {}, n = 0, x = {}, w = {}, head = {} }
  for i, c in ipairs(cols) do
    local fs = head:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    fs:SetJustifyH(c.justify or "LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    fs:SetText(c.title or "")
    G.head[i] = fs
  end
  function G.SetTitle(i, text) G.head[i]:SetText(text) end
  local function place(r)
    for i = 1, #cols do
      local cell = r.cells[i]
      if cell then cell:ClearAllPoints() cell:SetPoint("LEFT", r, "LEFT", G.x[i], 0) cell:SetWidth(G.w[i]) end
      local hov = r.hover[i]
      if hov then hov:ClearAllPoints() hov:SetPoint("TOPLEFT", r, "TOPLEFT", G.x[i], 0) hov:SetSize(G.w[i], r:GetHeight() or 30) end
    end
    local bx = (G.x[#cols] or 0) + (G.w[#cols] or 0)
    for k = #r.buttons, 1, -1 do
      local b = r.buttons[k]
      if b:IsShown() then b:ClearAllPoints() b:SetPoint("RIGHT", r, "LEFT", bx, 0) bx = bx - (b:GetWidth() or 80) - 6 end
    end
  end
  -- Largeurs : colonnes fixes, puis la place restante partagée entre les colonnes souples
  function G.Layout()
    local width = sf:GetWidth()
    if not width or width < 100 then width = 900 end
    body:SetWidth(width)
    local fixed, weight = PAD * (#cols + 1), 0
    for _, c in ipairs(cols) do if c.flex then weight = weight + c.flex fixed = fixed + (c.min or 40) else fixed = fixed + c.w end end
    local free = math.max(0, width - fixed)
    local x = PAD
    for i, c in ipairs(cols) do
      local w = c.flex and ((c.min or 40) + math.floor(free * c.flex / weight)) or c.w
      G.x[i], G.w[i] = x, w
      x = x + w + PAD
    end
    for i, fs in ipairs(G.head) do fs:ClearAllPoints() fs:SetPoint("LEFT", head, "LEFT", G.x[i], 0) fs:SetWidth(G.w[i]) end
    for k = 1, G.n do place(G.rows[k]) end
  end
  local y, odd = 0, false
  function G.Reset() y, odd, G.n = 0, false, 0 end
  -- values : texte de chaque colonne ; opts : { buttons = { { libellé, largeur, action }, … }, dim = ligne estompée, tip = function(i, cadre) }
  function G.Row(values, opts)
    opts = opts or {}
    G.n = G.n + 1
    local r = G.rows[G.n]
    if not r then
      r = CreateFrame("Frame", nil, body)
      r.bg = r:CreateTexture(nil, "BACKGROUND")
      r.bg:SetAllPoints()
      r.cells, r.hover, r.buttons = {}, {}, {}
      for i, c in ipairs(cols) do
        if not c.buttons then
          local fs = r:CreateFontString(nil, "OVERLAY", c.small and "GameFontHighlightSmall" or "GameFontHighlight")
          fs:SetJustifyH(c.justify or "LEFT")
          if c.lines and c.lines > 1 then if fs.SetMaxLines then fs:SetMaxLines(c.lines) end elseif fs.SetWordWrap then fs:SetWordWrap(false) end
          r.cells[i] = fs
          if c.tip then
            local hov = CreateFrame("Frame", nil, r)
            hov:EnableMouse(true)
            hov:SetScript("OnEnter", function(self) if r.tip then r.tip(i, self) end end)
            hov:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
            r.hover[i] = hov
          end
        end
      end
      G.rows[G.n] = r
    end
    r.tip = opts.tip
    for i in ipairs(cols) do if r.cells[i] then r.cells[i]:SetText(values[i] or "") end end
    for _, b in ipairs(r.buttons) do b:Hide() end
    for k, spec in ipairs(opts.buttons or {}) do
      local b = r.buttons[k] or button(r, spec[1], spec[2], nil)
      r.buttons[k] = b
      b:SetText(spec[1]) b:SetSize(spec[2], 22) b:SetScript("OnClick", spec[3]) b:Show()
    end
    local h = opts.height or 30
    odd = not odd
    r.bg:ClearAllPoints() r.bg:SetAllPoints()
    if site() then
      if odd then solid(r.bg, C.panel2, 0.7) r.bg:Show() else r.bg:Hide() end
    elseif odd and atlas(r.bg, ART.line) then r.bg:Show() else r.bg:Hide() end
    if r.SetAlpha then r:SetAlpha(opts.dim and 0.55 or 1) end
    r:ClearAllPoints() r:SetPoint("TOPLEFT", 0, -y) r:SetPoint("RIGHT", body, "RIGHT", 0, 0) r:SetHeight(h) r:Show()
    y = y + h
    if G.x[1] then place(r) end
  end
  function G.Done()
    for k = G.n + 1, #G.rows do G.rows[k]:Hide() end
    body:SetHeight(y + 6)
    G.Layout()
  end
  function G.Height() return y end
  -- Largeur connue seulement une fois la fenêtre placée (et à chaque redimensionnement)
  if sf.HookScript then sf:HookScript("OnSizeChanged", function() G.Layout() end) end
  return G
end

-- Fenêtre redimensionnable par le coin en bas à droite, taille mémorisée (sauvegarde de l'addon, sizes[clé])
local function resizable(f, key, minW, minH, maxW, maxH, onSize)
  if f.SetResizable then f:SetResizable(true) end
  if f.SetResizeBounds then pcall(f.SetResizeBounds, f, minW, minH, maxW, maxH)
  else
    if f.SetMinResize then pcall(f.SetMinResize, f, minW, minH) end
    if f.SetMaxResize then pcall(f.SetMaxResize, f, maxW, maxH) end
  end
  local grip = CreateFrame("Button", nil, f)
  grip:SetSize(16, 16) grip:SetPoint("BOTTOMRIGHT", -4, 4)
  if grip.SetFrameLevel and f.GetFrameLevel and f:GetFrameLevel() then grip:SetFrameLevel(f:GetFrameLevel() + 20) end
  grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
  grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
  grip:SetPushedTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Down")
  grip:SetScript("OnMouseDown", function() if f.StartSizing then f:StartSizing("BOTTOMRIGHT") end end)
  grip:SetScript("OnMouseUp", function()
    f:StopMovingOrSizing()
    local db = ns.db()
    db.sizes = db.sizes or {}
    db.sizes[key] = { math.floor((f:GetWidth() or minW) + 0.5), math.floor((f:GetHeight() or minH) + 0.5) }
    if onSize then onSize() end
  end)
  if f.HookScript then f:HookScript("OnSizeChanged", function() if onSize then onSize() end end) end
  local db = ns.db and ns.db()
  local saved = db and db.sizes and db.sizes[key]
  if saved then f:SetSize(math.max(minW, math.min(maxW, saved[1])), math.max(minH, math.min(maxH, saved[2]))) end
  return saved ~= nil
end

local function colored(cls, name)
  local c = CLASS_COLOR[cls]
  return c and ("|c" .. (c.colorStr or "ffffffff") .. name .. "|r") or name
end

-- Icône de rôle du jeu (atlas de la recherche de groupe) dans un texte, sinon le rôle en toutes lettres
local ROLE_KEY = { Tank = "TANK", Heal = "HEALER", DPS = "DAMAGER" }
local ROLE_ATLAS = { Tank = "UI-LFG-RoleIcon-Tank", Heal = "UI-LFG-RoleIcon-Healer", DPS = "UI-LFG-RoleIcon-DPS" }
local function roleIcon(role, size)
  if not ROLE_KEY[role or ""] then return role or "" end
  local atlas = ROLE_ATLAS[role]
  if GetIconForRole then
    local ok, a = pcall(GetIconForRole, ROLE_KEY[role])
    if ok and type(a) == "string" then atlas = a end
  end
  if not (C_Texture and C_Texture.GetAtlasInfo and C_Texture.GetAtlasInfo(atlas)) then return role end
  size = size or 14
  return CreateAtlasMarkup and CreateAtlasMarkup(atlas, size, size) or ("|A:" .. atlas .. ":" .. size .. ":" .. size .. "|a")
end

-- Outils partagés avec les fenêtres du raid (Raid.lua : butin, conseil, fiche du boss)

-- Outils exposés aux fichiers de chaque addon (fenêtre principale, butin, conseil, fiches…)
K.window, K.button, K.list, K.grid, K.resizable, K.hint, K.colored, K.site = window, button, list, grid, resizable, hint, colored, site
K.textArea, K.front, K.roleIcon, K.itemTips, K.styleStatus, K.statusButton = textArea, front, roleIcon, itemTips, styleStatus, statusButton
K.solid, K.edges, K.recolor, K.titleFont, K.diamond, K.gapX, K.atlas, K.inset, K.scrollFrame = solid, edges, recolor, titleFont, diamond, gapX, atlas, inset, scrollFrame
K.C, K.ART, K.CLASS_COLOR = C, ART, CLASS_COLOR
K.GOLD, K.GREY, K.GREEN, K.BLUE = GOLD, GREY, GREEN, BLUE

-- Ajouts du lot R3a (addon Roster) : fenêtre à onglets. Forever Roster garde ses propres copies (UI.lua).

-- Atlas vraiment présent dans ce client (atlas le vérifie désormais lui-même)
local hasAtlas = atlas

-- Code couleur du chat (|cffrrggbb) d'une couleur { r, g, b } ; K.ACCENT : la couleur d'accent de l'addon (or ou argent-azur)
local function hex(c)
  local function byte(v) return math.max(0, math.min(255, math.floor(v * 255 + 0.5))) end
  return string.format("|cff%02x%02x%02x", byte(c[1]), byte(c[2]), byte(c[3]))
end

-- Barre de titre de section fixe (comme « General » sur la fiche de perso) ; habillage du site : titre et filet
local function headerBar(parent, y, text)
  if site() then
    local fs = parent:CreateFontString(nil, "ARTWORK")
    titleFont(fs, 15)
    fs:SetPoint("TOPLEFT", 8, y - 6)
    fs:SetText(text)
    local rule = parent:CreateTexture(nil, "BORDER")
    rule:SetPoint("TOPLEFT", 8, y - 26) rule:SetPoint("TOPRIGHT", -8, y - 26) rule:SetHeight(1) solid(rule, C.line)
    return fs
  end
  local bg = parent:CreateTexture(nil, "BACKGROUND")
  bg:SetPoint("TOP", 0, y) bg:SetSize(340, 34)
  if not hasAtlas(bg, ART.header) then solid(bg, C.panel2, 0.85) end
  local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  fs:SetPoint("CENTER", bg, "CENTER", 0, 1)
  fs:SetText(text)
  return fs
end

-- Onglet à icône sur le côté droit de la fenêtre (habillage du jeu) : textures de Forever si le client les a,
-- sinon cadre sombre et liseré à la couleur d'accent. t = { key, label, icon } ; b:SetOn(choisi)
local function sideTab(parent, index, t, onClick)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(54, 54)
  b:SetPoint("TOPLEFT", parent, "TOPRIGHT", -4, -44 - (index - 1) * 58)
  b:SetFrameLevel((parent:GetFrameLevel() or 1) + 5)
  local bg = b:CreateTexture(nil, "BACKGROUND")
  bg:SetSize(54, 60) bg:SetPoint("CENTER")
  local drawn = not hasAtlas(bg, ART.tab)
  b.edges = false
  if drawn then
    bg:ClearAllPoints() bg:SetAllPoints() solid(bg, C.panel, 0.95)
    b.edges = edges(b, C.line2)
  end
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(drawn and 40 or 46, drawn and 40 or 46) icon:SetPoint("CENTER", drawn and 0 or -3, 0)
  icon:SetTexture(t.icon)
  local okMask, mask = pcall(b.CreateMaskTexture, b)
  if not drawn and okMask and mask and hasAtlas(mask, ART.tabMask) then
    mask:SetSize(54, 60) mask:SetPoint("CENTER")
    icon:AddMaskTexture(mask)
  else
    icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  end
  b.selected = b:CreateTexture(nil, "OVERLAY")
  b.selected:SetSize(54, 60) b.selected:SetPoint("CENTER")
  if drawn or not hasAtlas(b.selected, ART.tabSelected) then b.selected:SetAllPoints() solid(b.selected, C.gold, 0.22) end
  b.selected:Hide()
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetSize(54, 60) hl:SetPoint("CENTER")
  if drawn or not hasAtlas(hl, ART.tabHover) then hl:SetAllPoints() hl:SetColorTexture(1, 1, 1, 0.12) end
  function b:SetOn(on)
    if on then self.selected:Show() else self.selected:Hide() end
    if self.edges then recolor(self.edges, on and C.gold or C.line2) end
  end
  b:SetScript("OnClick", function() if onClick then onClick(t.key) end end)
  b:SetScript("OnEnter", function(self)
    if not GameTooltip then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    GameTooltip:AddLine(t.label)
    GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  return b
end

-- Onglet du site : texte sur la bande sous le titre, souligné à la couleur d'accent avec un losange quand il est choisi
local function topTab(parent, index, t, onClick, width)
  width = width or 98
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(width, 28)
  b:SetPoint("TOPLEFT", parent, "TOPLEFT", 1 + (index - 1) * width, -28)
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(16, 16) icon:SetTexCoord(0.08, 0.92, 0.08, 0.92) icon:SetTexture(t.icon)
  local label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  label:SetText(t.label)
  local w = 20 + (label.GetStringWidth and label:GetStringWidth() or 50)
  icon:SetPoint("LEFT", b, "CENTER", -w / 2, 0)
  label:SetPoint("LEFT", icon, "RIGHT", 4, 0)
  b.label, b.icon = label, icon
  b.selected = b:CreateTexture(nil, "OVERLAY")
  b.selected:SetPoint("BOTTOMLEFT", 10, 0) b.selected:SetPoint("BOTTOMRIGHT", -10, 0) b.selected:SetHeight(2) solid(b.selected, C.gold)
  b.mark = diamond(b, 6, C.gold)
  b.mark:SetPoint("CENTER", b, "BOTTOM", 0, 1)
  local hl = b:CreateTexture(nil, "HIGHLIGHT")
  hl:SetAllPoints() solid(hl, C.panel2, 0.8)
  function b:SetOn(on)
    if on then self.selected:Show() self.mark:Show() label:SetTextColor(C.gold[1], C.gold[2], C.gold[3]) icon:SetDesaturated(false)
    else self.selected:Hide() self.mark:Hide() label:SetTextColor(C.ink2[1], C.ink2[2], C.ink2[3]) icon:SetDesaturated(true) end
  end
  b:SetOn(false)
  b:SetScript("OnClick", function() if onClick then onClick(t.key) end end)
  return b
end

K.hasAtlas, K.hex, K.headerBar, K.sideTab, K.topTab = hasAtlas, hex, headerBar, sideTab, topTab
K.ACCENT = hex(C.gold)
