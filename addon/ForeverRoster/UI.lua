-- Fenêtre unique à onglets (Synchro, Raids, Compo, Patrons), synchro rapide, rappel de raid et alerte au butin, à l'habillage de l'interface de Forever.
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
  { key = "synchro", label = "Synchro", icon = "Interface\\Icons\\INV_Letter_15" },
  { key = "raids", label = "Raids", icon = "Interface\\Icons\\INV_Misc_Head_Dragon_01" },
  { key = "compo", label = "Compo", icon = "Interface\\Icons\\Ability_Warrior_RallyingCry" },
  { key = "patrons", label = "Patrons", icon = "Interface\\Icons\\INV_Scroll_03" },
  { key = "options", label = "Options", icon = "Interface\\Icons\\INV_Misc_Gear_01" },
}
local pages, refreshers = {}, {}
U.pages = pages

local function buildRaids(p)
  hint(p, "Inscris " .. (UnitName("player") or "ce perso") .. " aux raids de tes groupes. Les données du site se collent dans l'onglet " .. GOLD .. "Synchro|r.")
  p.list = list(p, -40)
end
refreshers.raids = function(p)
  local G, L = ns.Group, p.list
  L.Reset()
  local groups = G.List()
  if #groups == 0 then
    L.Header("Groupes")
    L.Add(GREY .. "Aucun groupe chargé : sur le site, « Copier pour le jeu » (en haut de chaque page), puis colle dans l'onglet Synchro.|r")
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
  hint(p, "Sur le site : page du raid, « Export pour le jeu », Copier, puis colle dans l'onglet " .. GOLD .. "Synchro|r.")
  local invite = button(p, "Inviter", 120, function() ns.Compo.Invite() end)
  invite:SetPoint("TOPLEFT", 4, -40)
  local arrange = button(p, "Placer les groupes", 170, function() ns.Compo.Arrange() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 8, 0)
  p.list = list(p, -72)
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

-- Barre de titre de section fixe (comme « General » sur la fiche de perso)
local function headerBar(parent, y, text)
  local bg = parent:CreateTexture(nil, "BACKGROUND")
  bg:SetPoint("TOP", 0, y) bg:SetSize(340, 34)
  if not atlas(bg, ART.header) then bg:SetColorTexture(0.25, 0.18, 0.08, 0.8) end
  local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  fs:SetPoint("CENTER", bg, "CENTER", 0, 1)
  fs:SetText(text)
  return fs
end

-- Synchro : coller ce qui vient du site (chargé tout seul), copier ce qui part vers le site (Ctrl+C = envoyé)
-- Texte collé venant du site : données des groupes (FRG) ou compo d'un raid (FRR). Renvoie ok, message.
function U.LoadFromSite(text)
  local ok, err
  if text:find("FRG;", 1, true) then
    ok, err = ns.Group.Load(text)
    if ok then
      local raids, patterns = 0, 0
      for _, g in ipairs(ok) do raids = raids + #g.raids for _ in pairs(g.patterns) do patterns = patterns + 1 end end
      ForeverRosterDB.lastLoad = { at = time(), text = string.format("%d groupe(s), %d raid(s), %d patron(s) suivis", #ok, raids, patterns) }
    end
  elseif text:find("FRR;", 1, true) then
    ok, err = ns.Compo.Load(text)
    if ok then
      local raid = ns.Compo.Get()
      ForeverRosterDB.lastLoad = { at = time(), text = "compo « " .. (raid and raid.name or "?") .. " » (onglet Compo)" }
    end
  else
    err = "Texte non reconnu : sur le site, « Copier pour le jeu » ou « Export pour le jeu » d'un raid."
  end
  if ok then return true, ForeverRosterDB.lastLoad.text end
  return false, tostring(err)
end

local function onPaste(self, user)
  if not user then return end
  local text = self:GetText() or ""
  if not text:match("END;%d+%s*$") then return end -- collage pas encore complet
  local ok, msg = U.LoadFromSite(text)
  if ok then self:SetText("") self:ClearFocus() U.Refresh() else self.page.loadStatus:SetText("|cffff6b5e" .. msg .. "|r") end
end

local function buildSynchro(p)
  hint(p, "Plus rapide : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou le clic droit sur le bouton de la minicarte ouvrent la synchro rapide.")
  headerBar(p, -32, "1 · Du site vers le jeu")
  p.input = textArea(p, 6, -74, 526, 34)
  p.input.page = p
  p.input:SetScript("OnTextChanged", onPaste)
  p.loadStatus = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.loadStatus:SetPoint("TOPLEFT", 6, -118) p.loadStatus:SetWidth(526) p.loadStatus:SetJustifyH("LEFT")
  headerBar(p, -140, "2 · Du jeu vers le site")
  p.text = textArea(p, 6, -182, 526, 180)
  p.text:SetScript("OnTextChanged", function(self, user) if user then self:SetText(p.value or "") self:HighlightText() end end)
  p.text:SetScript("OnEscapePressed", function(self) self:ClearFocus() if main then main:Hide() end end)
  -- Ctrl+C dans l'export : copié, donc envoyé (à coller sur le site)
  p.text:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() and ns.Export.Size(p.included) > 0 then
      ns.Export.MarkSent(p.included)
      p.sent = true
      C_Timer.After(0, function() U.Refresh() end)
    end
  end)
  p.status = p:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  p.status:SetPoint("TOPLEFT", 6, -372) p.status:SetWidth(526) p.status:SetJustifyH("LEFT")
  p.all = false
  p.toggleAll = button(p, "Tout renvoyer", 150, function() p.all = not p.all p.sent = false U.Refresh() end)
  p.toggleAll:SetPoint("TOPLEFT", 4, -400)
  local again = button(p, "Actualiser", 120, function() p.sent = false U.Refresh() end)
  again:SetPoint("LEFT", p.toggleAll, "RIGHT", 8, 0)
  p.chars = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.chars:SetPoint("TOPLEFT", 6, -434) p.chars:SetWidth(526) p.chars:SetJustifyH("LEFT")
end
refreshers.synchro = function(p)
  local last = ForeverRosterDB.lastLoad
  p.loadStatus:SetText(last and (GREEN .. "Chargé le " .. date("%d/%m %H:%M", last.at) .. " : " .. last.text .. "|r")
    or (GREY .. "Sur le site, « Copier pour le jeu » (en haut de chaque page), puis colle ici : c'est chargé tout seul.|r"))
  local ok, value, included = pcall(ns.Export.Build, { all = p.all })
  if not ok then ns.print("|cffff6060erreur (export)|r " .. tostring(value)) return end
  p.value, p.included = value, included
  p.toggleAll:SetText(p.all and "Seulement les changements" or "Tout renvoyer")
  local names = ns.Export.Names(included, colored)
  if p.sent then
    p.status:SetText(GREEN .. "Copié. Sur le site, appuie sur Ctrl+V sur n'importe quelle page.|r")
  elseif #names == 0 then
    local lastSent = 0
    for _, e in ipairs(ns.Export.Characters()) do lastSent = math.max(lastSent, e.char.sentAt or 0) end
    p.status:SetText(GREY .. "Rien de nouveau depuis ton dernier envoi" .. (lastSent > 0 and (" (" .. date("%d/%m %H:%M", lastSent) .. ")") or "") .. ". « Tout renvoyer » pour tout recopier.|r")
  else
    p.status:SetText(GOLD .. "À envoyer|r : " .. table.concat(names, ", ") .. GREY .. "   Ctrl+C puis Échap.|r")
  end
  p.text:SetText(value)
  local all = {}
  for _, e in ipairs(ns.Export.Characters()) do
    local h = e.snap.header or {}
    all[#all + 1] = colored(h.class, h.name or e.key) .. GREY .. " (" .. (e.char.sentAt and ("envoyé le " .. date("%d/%m", e.char.sentAt)) or "jamais envoyé") .. ")|r"
  end
  p.chars:SetText(GREY .. "Persos relevés : |r" .. table.concat(all, ", ") .. GREY .. ". Pour retirer un perso supprimé : /fr oublier Nom-Royaume.|r")
  if #names > 0 and not p.sent then p.text:SetFocus() p.text:HighlightText() end
end

-- Options : touches, bouton de la minicarte, rappels de raid, persos de l'export
local BINDINGS = {
  { action = "FOREVERROSTER_SYNC", label = "Synchro rapide avec le site" },
  { action = "FOREVERROSTER_TOGGLE", label = "Ouvrir ou fermer la fenêtre" },
}
local function keyText(key)
  return (GetBindingText and GetBindingText(key)) or key
end
local function keysOf(action)
  local keys = { GetBindingKey(action) }
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = keyText(k) end
  return out, keys
end
local function saveBindings()
  if SaveBindings then SaveBindings((GetCurrentBindingSet and GetCurrentBindingSet()) or 1) end
end

-- Choix d'une touche : la prochaine touche appuyée (avec Alt, Ctrl, Maj) remplace celle de l'action ; Échap annule
local capture
function U.SetBinding(action, key)
  if InCombatLockdown and InCombatLockdown() then ns.print("|cffff6b5epas de changement de touche en combat.|r") return false end
  local _, old = keysOf(action)
  for _, k in ipairs(old) do SetBinding(k, nil) end
  if key then
    local taken = GetBindingAction and GetBindingAction(key)
    if taken and taken ~= "" and taken ~= action then
      ns.print(GOLD .. keyText(key) .. "|r servait à « " .. ((_G["BINDING_NAME_" .. taken]) or taken) .. " » : remplacée.")
    end
    SetBinding(key, action)
  end
  saveBindings()
  return true
end
local MODIFIERS = { LSHIFT = true, RSHIFT = true, LCTRL = true, RCTRL = true, LALT = true, RALT = true, LMETA = true, RMETA = true, UNKNOWN = true }
function U.StartCapture(action)
  if not capture then
    capture = CreateFrame("Frame", nil, UIParent)
    capture:SetAllPoints(UIParent)
    capture:SetFrameStrata("FULLSCREEN_DIALOG")
    capture:EnableKeyboard(true)
    if capture.SetPropagateKeyboardInput then capture:SetPropagateKeyboardInput(false) end
    capture:SetScript("OnKeyDown", function(self, key)
      if MODIFIERS[key] then return end
      local action = self.action
      self.action = nil
      self:Hide()
      if key ~= "ESCAPE" then
        local combo = (IsAltKeyDown() and "ALT-" or "") .. (IsControlKeyDown() and "CTRL-" or "") .. (IsShiftKeyDown() and "SHIFT-" or "") .. key
        if U.SetBinding(action, combo) then ns.print("touche " .. GOLD .. keyText(combo) .. "|r enregistrée.") end
      end
      U.Refresh()
    end)
    capture:Hide()
    U.captureFrame = capture
  end
  capture.action = action
  capture:Show()
  U.Refresh()
end
U.capturing = function() return capture and capture:IsShown() and capture.action or nil end

local function buildOptions(p)
  hint(p, "Réglages de l'addon, gardés pour tous tes persos. Les touches se changent aussi dans Échap > Options > Raccourcis > AddOns.")
  p.list = list(p, -40)
end
refreshers.options = function(p)
  local L = p.list
  L.Reset()
  L.Header("Touches")
  local waiting = U.capturing()
  for _, b in ipairs(BINDINGS) do
    local shown = keysOf(b.action)
    local current = #shown > 0 and (GOLD .. table.concat(shown, ", ") .. "|r") or (GREY .. "aucune touche|r")
    if waiting == b.action then
      L.Add(b.label .. " : " .. GREEN .. "appuie sur la touche voulue (avec Alt, Ctrl ou Maj si tu veux)… Échap : annuler.|r")
    else
      local buttons = { { "Choisir une touche", 160, function() U.StartCapture(b.action) end } }
      if #shown > 0 then buttons[2] = { "Retirer", 100, function() U.SetBinding(b.action, nil) U.Refresh() end } end
      L.Add(b.label .. " : " .. current, buttons)
    end
  end
  L.Header("Affichage et rappels")
  local mapOn = not (ForeverRosterDB.minimap and ForeverRosterDB.minimap.hidden)
  L.Add("Bouton de la minicarte : " .. (mapOn and (GREEN .. "affiché|r") or (GREY .. "masqué|r")) .. GREY .. "  (clic : fenêtre, clic droit : synchro rapide, pastille : persos à envoyer)|r",
    { { mapOn and "Masquer" or "Afficher", 100, function() ns.Minimap.SetShown(not mapOn) U.Refresh() end } })
  local remind = not ForeverRosterDB.noReminder
  L.Add("Rappel de raid à la connexion : " .. (remind and (GREEN .. "activé|r") or (GREY .. "coupé|r")) .. GREY .. "  (raid des prochaines 24 h sans réponse : « Tu viens ? »)|r",
    { { remind and "Couper" or "Activer", 100, function() ForeverRosterDB.noReminder = remind or nil U.Refresh() end } })
  L.Header("Présence et butin")
  local rec, cur = ns.Recorder.Enabled(), ns.Recorder.Current()
  L.Add("Relevé pendant les raids du site : " .. (rec and (GREEN .. "activé|r") or (GREY .. "coupé|r")) .. (cur and (GOLD .. "  · en cours : " .. (cur.name or "raid") .. "|r") or "") ..
    "\n" .. GREY .. "Qui est dans le raid (chaque minute) et le butin. Le bilan part avec ta synchro ; le site ne retient que celui d'un officier.|r",
    { { rec and "Couper" or "Activer", 100, function() ForeverRosterDB.noRecord = rec or nil if rec then ns.Recorder.Sample() end U.Refresh() end } })
  local q = ns.Recorder.MinQuality()
  local function setQ(v) return function() ForeverRosterDB.lootQuality = v U.Refresh() end end
  L.Add("Butin noté à partir de : " .. GOLD .. ns.Recorder.QUALITY_LABEL[q] .. "|r", { { "Rare", 90, setQ(3) }, { "Épique", 90, setQ(4) }, { "Légendaire", 110, setQ(5) } })
  L.Header("Persos de l'export")
  local chars = ns.Export.Characters()
  if #chars == 0 then L.Add(GREY .. "Aucun perso relevé pour l'instant.|r") end
  for _, e in ipairs(chars) do
    local h = e.snap.header or {}
    local sent = e.char.sentAt and ("envoyé au site le " .. date("%d/%m %H:%M", e.char.sentAt)) or "jamais envoyé"
    local text = colored(h.class, h.name or e.key) .. GREY .. "  " .. (h.realm or "") .. " · niveau " .. (h.level or "?") .. " · relevé le " .. date("%d/%m %H:%M", e.snap.at or 0) .. " · " .. sent .. "|r"
    if e.current then
      L.Add(text .. "\n" .. GREY .. "Perso connecté : il est relevé tout seul, il ne peut pas être retiré.|r")
    elseif p.confirm == e.key then
      L.Add(text .. "\n" .. GOLD .. "Le retirer de l'export ? Il reviendra si tu te connectes avec lui.|r", {
        { "Oui, retirer", 120, function() ns.Export.Forget(e.key) p.confirm = nil if ns.Minimap.Update then ns.Minimap.Update() end U.Refresh() end },
        { "Annuler", 100, function() p.confirm = nil U.Refresh() end },
      })
    else
      L.Add(text, { { "Retirer de l'export", 160, function() p.confirm = e.key U.Refresh() end } })
    end
  end
  L.Done()
end

local builders = { synchro = buildSynchro, raids = buildRaids, compo = buildCompo, patrons = buildPatrons, options = buildOptions }

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
  main = window("ForeverRosterMain", "Forever Roster", 600, 620)
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
  local tab = pages[ForeverRosterDB.tab] and ForeverRosterDB.tab or "synchro"
  local fn = refreshers[tab]
  if fn then ns.safe("affichage", fn, pages[tab]) end
end

-- Ouvre la fenêtre sur un onglet (le dernier utilisé par défaut)
function U.Show(tab)
  if not main then buildMain() end
  tab = pages[tab] and tab or (pages[ForeverRosterDB.tab] and ForeverRosterDB.tab) or "synchro"
  ForeverRosterDB.tab = tab
  if tab == "synchro" then pages.synchro.sent = false end
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
function U.ShowExport() U.Show("synchro") end
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

-- Synchro rapide (ta touche, clic droit sur la minicarte) : une seule case. L'export y est déjà sélectionné :
-- Ctrl+C l'envoie (puis la fenêtre se ferme). Ou Ctrl+V colle les données du site : chargées, puis fermeture.
local quick, quickGen = nil, 0
local function closeQuickSoon()
  local gen = quickGen -- rouverte entre-temps : on la laisse ouverte
  C_Timer.After(1.2, function() if quick and quickGen == gen then quick:Hide() end end)
end
local function buildQuick()
  quick = window("ForeverRosterQuick", "Forever Roster  ·  Synchro rapide", 460, 196)
  quick:ClearAllPoints() quick:SetPoint("TOP", 0, -140)
  quick.status = quick:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  quick.status:SetPoint("TOPLEFT", 66, -32) quick.status:SetWidth(378) quick.status:SetJustifyH("LEFT")
  quick.box = textArea(quick, 18, -86, 424, 56)
  quick.box:SetScript("OnEscapePressed", function() quick:Hide() end)
  quick.box:SetScript("OnTextChanged", function(self, user)
    if not user then return end
    local text = self:GetText() or ""
    if text == quick.value then return end
    -- Collage depuis le site : chargé dès qu'il est complet
    if text:find("FR[GR];") then
      if not text:match("END;%d+%s*$") then return end
      local ok, msg = U.LoadFromSite(text)
      self:SetText("")
      self:ClearFocus()
      if ok then
        quick.status:SetText(GREEN .. "Chargé : " .. msg .. ".|r")
        U.Refresh()
        closeQuickSoon()
      else
        quick.status:SetText("|cffff6b5e" .. msg .. "|r")
      end
      return
    end
    -- Autre frappe : l'export reste intact et sélectionné
    self:SetText(quick.value or "")
    self:HighlightText()
  end)
  quick.box:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() and ns.Export.Size(quick.included) > 0 then
      ns.Export.MarkSent(quick.included)
      quick.status:SetText(GREEN .. "Copié. Sur le site, Ctrl+V sur n'importe quelle page.|r")
      U.Refresh()
      closeQuickSoon()
    end
  end)
  quick.foot = quick:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  quick.foot:SetPoint("BOTTOMLEFT", 18, 16) quick.foot:SetWidth(250) quick.foot:SetJustifyH("LEFT")
  local more = button(quick, "Fenêtre complète", 140, function() quick:Hide() U.Show("synchro") end)
  more:SetPoint("BOTTOMRIGHT", -16, 10)
  quick.allBtn = button(quick, "Tout renvoyer", 120, function() U.Quick(true) end)
  quick.allBtn:SetPoint("RIGHT", more, "LEFT", -6, 0)
  U.quick = quick
end

function U.Quick(all)
  if not quick then buildQuick() end
  if quick:IsShown() and all == nil then quick:Hide() return end
  quickGen = quickGen + 1
  local ok, value, included = pcall(ns.Export.Build, { all = all == true })
  if not ok then ns.print("|cffff6060erreur (export)|r " .. tostring(value)) return end
  quick.value, quick.included = value, included
  local names = ns.Export.Names(included, colored)
  if #names > 0 then
    quick.status:SetText(GOLD .. "Vers le site|r : " .. table.concat(names, ", ") .. "\n" ..
      "Ctrl+C pour copier, puis Ctrl+V sur le site.\n" .. GREY .. "Ou Ctrl+V ici pour coller ce que tu as copié sur le site.|r")
  else
    quick.status:SetText(GREY .. "Rien de nouveau à envoyer au site.|r\n" ..
      "Ctrl+V ici pour coller ce que tu as copié sur le site (« Copier pour le jeu »).")
  end
  local last = ForeverRosterDB.lastLoad
  quick.foot:SetText(last and (GREY .. "Données du site : " .. date("%d/%m %H:%M", last.at) .. "|r") or (GREY .. "Données du site : jamais chargées|r"))
  quick.box:SetText(value)
  quick:Show()
  quick.box:SetFocus()
  quick.box:HighlightText()
end


-- Rappel de raid à la connexion : un raid de tes groupes dans les 24 h, sans réponse (ni en jeu ni sur le site) →
-- petite fenêtre « Tu viens ? ». Un raid déjà répondu : une ligne dans le chat. /fr rappels coupe ou remet les rappels.
local function whenText(t)
  local d, now = date("*t", t), date("*t", time())
  local hm = date("%H:%M", t)
  if d.year == now.year and d.yday == now.yday then return (d.hour >= 17 and "ce soir " or "aujourd'hui ") .. hm end
  local tomorrow = date("*t", time() + 86400)
  if d.year == tomorrow.year and d.yday == tomorrow.yday then return "demain " .. hm end
  return date("%d/%m ", t) .. hm
end
U.whenText = whenText

function U.SoonRaids()
  local now, ask, known = time(), {}, {}
  for _, e in ipairs(ns.Group.Raids()) do
    if e.raid.time > now and e.raid.time <= now + 86400 then
      if e.status or e.onSite then known[#known + 1] = e else ask[#ask + 1] = e end
    end
  end
  return ask, known
end

local reminder
local function buildReminder()
  reminder = window("ForeverRosterReminder", "Forever Roster  ·  Raid", 420, 168, "Interface\\Icons\\INV_Misc_Head_Dragon_01")
  reminder:ClearAllPoints() reminder:SetPoint("TOP", 0, -140)
  reminder.text = reminder:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  reminder.text:SetPoint("TOPLEFT", 66, -32) reminder.text:SetWidth(336) reminder.text:SetJustifyH("LEFT")
  reminder.buttons = {}
  for i, st in ipairs(ns.Group.STATUSES) do
    local b = button(reminder, st.label, 92, function()
      local e = reminder.entry
      if not e then return end
      ns.Group.SignUp(e.group.id, e.raid.id, st.key, e.raid.time)
      if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
      U.Refresh()
      U.Reminder(true)
    end)
    b:SetPoint("BOTTOMLEFT", 16 + (i - 1) * 98, 44)
    reminder.buttons[i] = b
  end
  reminder.foot = reminder:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  reminder.foot:SetPoint("BOTTOMLEFT", 18, 18) reminder.foot:SetWidth(260) reminder.foot:SetJustifyH("LEFT")
  reminder.foot:SetText(GREY .. "Plus tard : ferme, je te le redemande à la prochaine connexion.|r")
  reminder.sync = button(reminder, "Synchro rapide", 120, function() reminder:Hide() U.Quick(false) end)
  reminder.sync:SetPoint("BOTTOMRIGHT", -16, 12)
  U.reminder = reminder
end

-- after : appelé après une réponse (raid suivant sans réponse, sinon invitation à envoyer au site)
function U.Reminder(after)
  local ask = U.SoonRaids()
  if not reminder then buildReminder() end
  local e = ask[1]
  if not e then
    if after and reminder:IsShown() then
      reminder.entry = false
      reminder.text:SetText(GREEN .. "Noté.|r Pour que le site le sache :\nta touche de synchro (ou « Synchro rapide »), Ctrl+C, puis Ctrl+V sur le site.")
      for _, b in ipairs(reminder.buttons) do b:Hide() end
      reminder.foot:SetText("")
    end
    return false
  end
  reminder.entry = e
  local who = UnitName("player") or "ce perso"
  reminder.text:SetText(GOLD .. e.raid.name .. "|r " .. whenText(e.raid.time) .. GREY .. "  ·  " .. (e.group.name or "") .. "|r\n" ..
    "Tu viens avec " .. who .. " ?" .. (#ask > 1 and (GREY .. "  (" .. (#ask - 1) .. " autre" .. (#ask > 2 and "s" or "") .. " raid" .. (#ask > 2 and "s" or "") .. " ensuite)|r") or ""))
  for _, b in ipairs(reminder.buttons) do b:Show() end
  reminder.foot:SetText(GREY .. "Plus tard : ferme, je te le redemande à la prochaine connexion.|r")
  reminder:Show()
  return true
end

local function remindAtLogin()
  if ForeverRosterDB.noReminder then return end
  local _, known = U.SoonRaids()
  for _, e in ipairs(known) do
    local st = e.status or e.onSite
    ns.print(GOLD .. e.raid.name .. "|r " .. whenText(e.raid.time) .. " : " .. (ns.Group.LABEL[st] or st) .. ".")
  end
  U.Reminder()
end
ns.on("PLAYER_LOGIN", function() C_Timer.After(6, function() ns.safe("rappel de raid", remindAtLogin) end) end)
