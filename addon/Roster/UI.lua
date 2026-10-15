-- Fenêtre à onglets (Synchro, Raids, En raid, Compo, Butin, Options) et synchro rapide.
-- Synchro et Options sont construits ici ; Raids, En raid, Compo et Butin (historique, lot R4a) par Pages.lua
-- (ns.Pages.Build / Refresh).
-- Deux habillages (Options) : celui du jeu, ou celui du site (sombre, liserés argent-azur). Boîte à outils : addon/shared/Kit.lua.
local ADDON, ns = ...
local L, N = ns.L, ns.N
local U = {}
ns.UI = U
local K = ns.Kit
U.kit, U.site = K, K.site

local ACCENT, GREY, GREEN, RED = K.ACCENT, K.GREY, K.GREEN, "|cffff6b5e"
local site, C, window, textArea, button, hint, list = K.site, K.C, K.window, K.textArea, K.button, K.hint, K.list
local front, headerBar, gapX = K.front, K.headerBar, K.gapX

local main
-- Icônes du jeu présentes sur Retail (anciens fichiers d'icônes, toujours livrés)
-- Noms des onglets en français (clés), traduits à la construction de la fenêtre et à l'affichage du titre
local TABS = {
  { key = "synchro", label = N("Synchro"), icon = "Interface\\Icons\\INV_Letter_15" },
  { key = "raids", label = N("Raids"), icon = "Interface\\Icons\\INV_Misc_Head_Dragon_01" },
  { key = "enraid", label = N("En raid"), icon = "Interface\\Icons\\Ability_Warrior_BattleShout" },
  { key = "compo", label = N("Compo"), icon = "Interface\\Icons\\Ability_Warrior_RallyingCry" },
  { key = "loot", label = N("Butin"), icon = "Interface\\Icons\\INV_Misc_Bag_08" },
  { key = "options", label = N("Options"), icon = "Interface\\Icons\\INV_Misc_Gear_01" },
}
local pages, refreshers = {}, {}
U.pages = pages
-- Onglets remplis par Pages.lua
local EXTERNAL = { raids = true, enraid = true, compo = true, loot = true }

local function db() return ns.db() or {} end
local function data() return ns.Data end
-- Pastille de la minicarte (rien à faire avant ADDON_LOADED : pas encore de sauvegarde)
local function updateMinimap() if ns.Minimap and ns.Minimap.Update and ns.db() then ns.safe(L["minicarte"], ns.Minimap.Update) end end

-- Synchro : coller ce qui vient du site (chargé dès que c'est complet), copier ce qui part vers le site (Ctrl+C = envoyé)

-- Texte collé : chargé par Data.lua ; renvoie ok, message (affiché en vert ou en rouge)
function U.Load(text)
  local D = data()
  if not (D and D.Load) then return false, L["module de données non chargé (fais /console scriptErrors 1 puis /reload)."] end
  local called, ok, message = pcall(D.Load, text)
  if not called then return false, L("erreur de lecture : %s", tostring(ok)) end
  updateMinimap()
  return ok and true or false, tostring(message or (ok and L["chargé."] or L["texte non reconnu."]))
end

-- Export vers le site : texte et nombre de blocs ; all = tout renvoyer, pas seulement ce qui a changé
local function export(all)
  local D = data()
  if not (D and D.ExportText) then return "", 0, L["module de données non chargé."] end
  local ok, text, count = pcall(D.ExportText, all)
  if not ok then return "", 0, tostring(text) end
  return text or "", tonumber(count) or 0
end

-- Ctrl+C dans l'export : copié, donc envoyé (à coller sur le site)
local function markSent()
  local D = data()
  if D and D.MarkSent then ns.safe(L["synchro"], D.MarkSent) end
  updateMinimap()
end

local function complete(text) return text:match("END;%d+%s*$") ~= nil end
-- « 2 blocs » : blocs (bilans) à envoyer au site
local function blocks(n) return ns.Format.Many(n) and L("%d blocs", n) or L("%d bloc", n) end

local function onPaste(self, user)
  if not user then return end
  local text = self:GetText() or ""
  if not complete(text) then return end -- collage pas encore complet
  local p = self.page
  local ok, message = U.Load(text)
  p.loadMessage = (ok and GREEN or RED) .. message .. "|r"
  if ok then self:SetText("") self:ClearFocus() end
  p.loadStatus:SetText(p.loadMessage)
  U.Refresh()
end

local function buildSynchro(p)
  p.hint = hint(p, L["Sur le site : « Copier pour le jeu » (données des groupes) ou « Export pour le jeu » (compo d'un raid), puis colle ici. Après un raid, le bilan apparaît en bas : Ctrl+C ici, Ctrl+V sur le site (officier du groupe)."])
  headerBar(p, -32, L["1 · Du site vers le jeu"])
  p.input = textArea(p, 6, -74, 526, 34)
  p.input.page = p
  p.input:SetScript("OnTextChanged", onPaste)
  p.loadStatus = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.loadStatus:SetPoint("TOPLEFT", 6, -118) p.loadStatus:SetWidth(526) p.loadStatus:SetJustifyH("LEFT")
  p.summary = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.summary:SetPoint("TOPLEFT", 6, -134) p.summary:SetWidth(526) p.summary:SetJustifyH("LEFT")
  -- Origine des données de chaque groupe : collées ou reçues d'un joueur (partage), et quand (3 lignes au plus)
  p.origins = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.origins:SetPoint("TOPLEFT", 6, -148) p.origins:SetWidth(526) p.origins:SetJustifyH("LEFT")
  headerBar(p, -186, L["2 · Du jeu vers le site"])
  p.text = textArea(p, 6, -228, 526, 164)
  p.text:SetScript("OnTextChanged", function(self, user) if user then self:SetText(p.value or "") self:HighlightText() end end)
  p.text:SetScript("OnEscapePressed", function(self) self:ClearFocus() if main then main:Hide() end end)
  p.text:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() and (p.count or 0) > 0 then
      markSent()
      p.sent = true
      C_Timer.After(0, function() U.Refresh() end)
    end
  end)
  p.status = p:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  p.status:SetPoint("TOPLEFT", 6, -402) p.status:SetWidth(526) p.status:SetJustifyH("LEFT")
  p.all = false
  p.toggleAll = button(p, L["Tout renvoyer"], 190, function() p.all = not p.all p.sent = false U.Refresh() end)
  p.toggleAll:SetPoint("TOPLEFT", 4, -430)
  local again = button(p, L["Actualiser"], 120, function() p.sent = false U.Refresh() end)
  again:SetPoint("LEFT", p.toggleAll, "RIGHT", 8, 0)
  p.foot = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.foot:SetPoint("TOPLEFT", 6, -464) p.foot:SetWidth(526) p.foot:SetJustifyH("LEFT")
  p.foot:SetText(GREY .. L["Plus rapide : ta touche (Échap > Options > Raccourcis > AddOns > Roster) ou le clic droit sur le bouton de la minicarte ouvrent la synchro rapide."] .. "|r")
end
refreshers.synchro = function(p)
  local D = data()
  p.loadStatus:SetText(p.loadMessage or (GREY .. L["Colle ici (Ctrl+V) : c'est chargé tout seul dès que le texte est complet."] .. "|r"))
  local ok, summary = pcall(function() return D and D.Summary and D.Summary() end)
  p.summary:SetText(ok and summary and (GREY .. tostring(summary) .. "|r") or "")
  local okO, origins = pcall(function() return D and D.Origins and D.Origins() end)
  local lines = okO and type(origins) == "table" and origins or {}
  if #lines > 3 then lines = { lines[1], lines[2], L("+ %d autres groupes", #lines - 2) } end
  p.origins:SetText(#lines > 0 and (GREY .. table.concat(lines, "\n") .. "|r") or "")
  local value, count, err = export(p.all)
  p.value, p.count = value, count
  p.toggleAll:SetText(p.all and L["Seulement les changements"] or L["Tout renvoyer"])
  if err then
    p.status:SetText(RED .. L("Export impossible : %s", tostring(err)) .. "|r")
  elseif p.sent then
    p.status:SetText(GREEN .. L["Copié. Sur le site, appuie sur Ctrl+V sur n'importe quelle page."] .. "|r")
  elseif count == 0 then
    p.status:SetText(GREY .. (value == "" and L["Rien à envoyer pour l'instant : le bilan d'un raid apparaît ici après le raid."] or L["Rien de nouveau depuis ton dernier envoi."])
      .. (p.all and "" or (" " .. L["« Tout renvoyer » pour tout recopier."])) .. "|r")
  else
    p.status:SetText(L("%s : %s", ACCENT .. L["À envoyer"] .. "|r", blocks(count)) .. GREY .. "   " .. L["Ctrl+C puis Échap."] .. "|r")
  end
  p.text:SetText(value)
  -- Export sélectionné pour Ctrl+C, sauf pendant un collage dans la case du haut (Refresh appelé par les modules de jeu)
  local pasting = p.input.HasFocus and p.input:HasFocus()
  if count > 0 and not p.sent and not pasting then p.text:SetFocus() p.text:HighlightText() end
end

-- Options : touches, habillage, bouton de la minicarte, relevé pendant les raids, passer automatiquement (butin),
-- partage des données du site
local BINDINGS = {
  { action = "ROSTER_SYNC", label = N("Synchro rapide avec le site") },
  { action = "ROSTER_TOGGLE", label = N("Ouvrir ou fermer la fenêtre") },
}
local function keyText(key) return (GetBindingText and GetBindingText(key)) or key end
local function keysOf(action)
  local keys = { GetBindingKey(action) }
  local out = {}
  for _, k in ipairs(keys) do out[#out + 1] = keyText(k) end
  return out, keys
end
local function saveBindings()
  if SaveBindings then SaveBindings((GetCurrentBindingSet and GetCurrentBindingSet()) or 1) end
end
local function inCombat() return InCombatLockdown and InCombatLockdown() end

-- Choix d'une touche : la prochaine touche appuyée (avec Alt, Ctrl, Maj) remplace celle de l'action ; Échap annule
local capture
function U.SetBinding(action, key)
  if inCombat() then ns.print(RED .. L["pas de changement de touche en combat."] .. "|r") return false end
  local _, old = keysOf(action)
  for _, k in ipairs(old) do SetBinding(k, nil) end
  if key then
    local taken = GetBindingAction and GetBindingAction(key)
    if taken and taken ~= "" and taken ~= action then
      ns.print(L("%s servait à « %s » : remplacée.", ACCENT .. keyText(key) .. "|r", (_G["BINDING_NAME_" .. taken]) or taken))
    end
    SetBinding(key, action)
  end
  saveBindings()
  return true
end
local MODIFIERS = { LSHIFT = true, RSHIFT = true, LCTRL = true, RCTRL = true, LALT = true, RALT = true, LMETA = true, RMETA = true, UNKNOWN = true }
function U.StartCapture(action)
  if inCombat() then ns.print(RED .. L["pas de changement de touche en combat."] .. "|r") return end
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
        if U.SetBinding(action, combo) then ns.print(L("touche %s enregistrée.", ACCENT .. keyText(combo) .. "|r")) end
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
  hint(p, L["Réglages de l'addon, gardés pour tous tes persos. Les touches se changent aussi dans Échap > Options > Raccourcis > AddOns."])
  p.list = list(p, -40)
end

local QUALITY = { { 3, N("Rare"), { 0, 0.44, 0.87 } }, { 4, N("Épique"), { 0.64, 0.21, 0.93 } }, { 5, N("Légendaire"), { 1, 0.5, 0 } } }
local YES, NO = { 0.31, 0.83, 0.37 }, { 0.6, 0.64, 0.71 }
local function yesNo(on) return on and (GREEN .. L["oui"] .. "|r") or (GREY .. L["non"] .. "|r") end
refreshers.options = function(p)
  local list, R = p.list, db()
  list.Reset()
  list.Header(L["Touches"])
  local waiting = U.capturing()
  for _, b in ipairs(BINDINGS) do
    local shown = keysOf(b.action)
    if waiting == b.action then
      list.Add(L("%s : %s", L[b.label], GREEN .. L["appuie sur la touche voulue (avec Alt, Ctrl ou Maj si tu veux)... Échap : annuler."] .. "|r"))
    else
      local buttons = { { L["Choisir une touche"], 160, function() U.StartCapture(b.action) end } }
      if #shown > 0 then buttons[2] = { L["Retirer"], 100, function() U.SetBinding(b.action, nil) U.Refresh() end } end
      list.Add(L("%s : %s", L[b.label], #shown > 0 and (ACCENT .. table.concat(shown, ", ") .. "|r") or (GREY .. L["aucune touche"] .. "|r")), buttons)
    end
  end
  list.Header(L["Affichage"])
  local accent = { C.gold[1], C.gold[2], C.gold[3] }
  -- Langue : celle du jeu (nil), français ou anglais ; comme l'habillage, appliquée partout au rechargement de l'interface
  local lang, langPending = ns.LangChoice(), ns.LangPending()
  local function setLang(v) return function() R.lang = v U.Refresh() end end
  local langButtons = {
    { L("Celle du jeu (%s)", ns.LangName(ns.ClientLang())), 170, setLang(nil), { color = accent, selected = lang == nil } },
    { ns.LangName("fr"), 90, setLang("fr"), { color = accent, selected = lang == "fr" } },
    { ns.LangName("en"), 90, setLang("en"), { color = accent, selected = lang == "en" } },
  }
  if langPending then langButtons[4] = { L["Recharger"], 110, function() ns.Reload() end } end
  list.Add(L("Langue : %s", ACCENT .. ns.LangLabel(lang) .. "|r") ..
    (langPending and (GREEN .. "  · " .. L["appliquée après rechargement de l'interface"] .. "|r") or "") ..
    "\n" .. GREY .. L["Fenêtres, messages et annonces de l'addon (les annonces au raid et les chuchotements partent dans cette langue)."] .. "|r", langButtons)
  -- Habillage : appliqué au rechargement de l'interface (les fenêtres sont construites une fois)
  local skin = site() and "site" or "jeu" -- nolocale (valeurs de l'habillage)
  local shown = main and main.skin or skin
  local function setSkin(v) return function() R.skin = v == "site" and "site" or nil U.Refresh() end end -- nolocale
  local skinButtons = {
    { L["Jeu"], 80, setSkin("jeu"), { color = accent, selected = skin == "jeu" } }, -- nolocale
    { L["Site"], 80, setSkin("site"), { color = accent, selected = skin == "site" } }, -- nolocale
  }
  if skin ~= shown then skinButtons[3] = { L["Recharger"], 110, function() ns.Reload() end } end
  list.Add(L("Habillage : %s", ACCENT .. (skin == "site" and L["celui du site"] or L["celui du jeu"]) .. "|r") .. -- nolocale
    (skin ~= shown and (GREEN .. "  · " .. L["appliqué après rechargement de l'interface"] .. "|r") or "") ..
    "\n" .. GREY .. L["Jeu : cadres et onglets de l'interface de WoW. Site : thème sombre, liserés argent-azur et onglets en haut, comme sur le site."] .. "|r", skinButtons)
  local mapOn = not (R.minimap and R.minimap.hidden)
  list.Add(L("Bouton de la minicarte : %s", mapOn and (GREEN .. L["affiché"] .. "|r") or (GREY .. L["masqué"] .. "|r")) ..
    "\n" .. GREY .. L["Clic : fenêtre, clic droit : synchro rapide, pastille : envois en attente. Roster reste aussi dans la liste des addons de la minicarte."] .. "|r",
    { { mapOn and L["Masquer"] or L["Afficher"], 100, function() if ns.Minimap then ns.Minimap.SetShown(not mapOn) end U.Refresh() end } })
  list.Header(L["Présence et butin"])
  local rec = R.record ~= false
  local recording = ns.Recorder and ns.Recorder.IsRecording and ns.Recorder.IsRecording()
  -- nil : relevé activé (par défaut), false : coupé (lu par Recorder.lua)
  local function setRec(on) return function() if on then R.record = nil else R.record = false end updateMinimap() U.Refresh() end end
  list.Add(L("Relever la présence et le butin pendant les raids : %s", yesNo(rec)) ..
    (recording and (ACCENT .. "  · " .. L["relevé en cours"] .. "|r") or "") ..
    "\n" .. GREY .. L["Pendant un raid du site chargé en jeu : qui est dans le raid (chaque minute), le butin et les boss. Le bilan part avec ta synchro ; le site ne retient que celui d'un officier du groupe."] .. "|r",
    { { L["Oui"], 80, setRec(true), { color = YES, selected = rec } },
      { L["Non"], 80, setRec(false), { color = NO, selected = not rec } } })
  local q = tonumber(R.lootQuality) or 4
  local buttons, label = {}, QUALITY[2][2]
  for _, e in ipairs(QUALITY) do
    if e[1] == q then label = e[2] end
    buttons[#buttons + 1] = { L[e[2]], e[1] == 5 and 110 or 90, function() R.lootQuality = e[1] U.Refresh() end, { color = e[3], selected = e[1] == q } }
  end
  list.Add(L("Butin noté à partir de : %s", ACCENT .. L[label]:lower() .. "|r"), buttons)
  -- Distribution par Roster : nil = passer automatiquement (par défaut), false = coupé (lu par Loot.lua)
  list.Header(L["Distribution du butin"])
  local auto = R.autoPass ~= false
  local function setAuto(on) return function() if on then R.autoPass = nil else R.autoPass = false end U.Refresh() end end
  local okOn, on = pcall(function() return ns.Loot and ns.Loot.Enabled and ns.Loot.Enabled() end)
  local okMaster, master = pcall(function() return ns.Loot and ns.Loot.Master and ns.Loot.Master() end)
  local current = ""
  if okOn and on then
    current = ACCENT .. "  · " .. L["distribution par Roster en cours"] ..
      ((okMaster and type(master) == "string" and ns.Format) and L(", chef de butin : %s", ns.Format.Display(master)) or "") .. "|r"
  end
  list.Add(L("Passer automatiquement quand le chef de butin distribue (Distribution par Roster) : %s", yesNo(auto)) .. current ..
    "\n" .. GREY .. L["Si tu coupes, passe toi-même sur chaque objet du butin de groupe : sinon il peut te revenir au lieu d'aller au chef de butin."] .. "|r",
    { { L["Oui"], 80, setAuto(true), { color = YES, selected = auto } },
      { L["Non"], 80, setAuto(false), { color = NO, selected = not auto } } })
  -- Partage des données du site (Groups.lua, addon/shared/Share.lua) : nil = oui (par défaut), false = ni annonce ni envoi
  list.Header(L["Partage entre joueurs"])
  local share = R.share ~= false
  local function setShare(on)
    return function()
      if on then R.share = nil else R.share = false end
      local G = ns.Groups
      if on and G and G.ShareSoon then G.ShareSoon("GUILD", 1, 3) G.ShareSoon("RAID", 1, 3) end
      U.Refresh()
    end
  end
  list.Add(L("Partager les données du site avec la guilde et le raid : %s", yesNo(share)) ..
    "\n" .. GREY .. L["Les données collées (ou reçues) partent aux joueurs de ta guilde et de ton raid qui ont Roster ; chacun ne garde que ses groupes, vérifiés par la signature du site. Coupé : tu reçois toujours celles des autres."] .. "|r",
    { { L["Oui"], 80, setShare(true), { color = YES, selected = share } },
      { L["Non"], 80, setShare(false), { color = NO, selected = not share } } })
  list.Done()
end

local builders = { synchro = buildSynchro, options = buildOptions }

-- Onglets de Pages.lua : construits une fois, rafraîchis à chaque affichage
local function buildExternal(key, p)
  if ns.Pages and ns.Pages.Build then
    ns.safe(L("onglet %s", key), ns.Pages.Build, key, p)
  else
    local fs = p:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    fs:SetPoint("TOPLEFT", 8, -8) fs:SetWidth(520) fs:SetJustifyH("LEFT")
    fs:SetText(RED .. L["Cet onglet n'a pas pu être chargé (module Pages)."] .. "|r " .. L["Fais /console scriptErrors 1 puis /reload pour voir l'erreur."])
  end
end

local function buildMain()
  local sited = site()
  main = window("RosterMain", "Roster", 600, sited and 650 or 620) -- site : 36 px de plus pour la bande des onglets
  main.tabs, main.skin = {}, sited and "site" or "jeu" -- nolocale
  if sited then -- bande des onglets : même fond que le titre, filet en dessous
    local band = main:CreateTexture(nil, "BACKGROUND", nil, -6)
    band:SetPoint("TOPLEFT", 1, -28) band:SetPoint("TOPRIGHT", -1, -28) band:SetHeight(28) K.solid(band, C.bg, 0.6)
    local rule = main:CreateTexture(nil, "BORDER")
    rule:SetPoint("TOPLEFT", 1, -56) rule:SetPoint("TOPRIGHT", -1, -56) rule:SetHeight(1) K.solid(rule, C.line)
  end
  for k, t in ipairs(TABS) do
    local tab = { key = t.key, label = L[t.label], icon = t.icon } -- nom de l'onglet dans la langue de l'interface
    main.tabs[t.key] = sited and K.topTab(main, k, tab, U.Show, 98) or K.sideTab(main, k, tab, U.Show) -- 6 onglets de 98 px
    local p = CreateFrame("Frame", nil, main)
    p:SetPoint("TOPLEFT", 14, sited and -64 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
    p:Hide()
    pages[t.key] = p
    if EXTERNAL[t.key] then buildExternal(t.key, p) else builders[t.key](p) end
  end
  main:SetScript("OnShow", function() U.Refresh() end)
end

local function currentTab()
  local tab = db().tab
  return pages[tab] and tab or "synchro"
end

-- Rafraîchit l'onglet affiché (sans effet si la fenêtre n'a jamais été ouverte ou est fermée) et la pastille de la minicarte
function U.Refresh()
  updateMinimap()
  if not main or not main:IsShown() then return end
  local tab = currentTab()
  if EXTERNAL[tab] then
    if ns.Pages and ns.Pages.Refresh then ns.safe(L("onglet %s", tab), ns.Pages.Refresh, tab) end
  elseif refreshers[tab] then
    ns.safe(L["affichage"], refreshers[tab], pages[tab])
  end
end

-- Ouvre la fenêtre sur un onglet (le dernier utilisé par défaut)
function U.Show(tab)
  if not ns.db() then return end
  if not main then buildMain() end
  tab = pages[tab] and tab or currentTab()
  ns.db().tab = tab
  if tab == "synchro" then pages.synchro.sent = false end
  for _, t in ipairs(TABS) do
    local on = t.key == tab
    if on then
      pages[t.key]:Show()
      main:SetWindowTitle(site() and "Roster" or ("Roster  ·  " .. L[t.label]))
    else
      pages[t.key]:Hide()
    end
    main.tabs[t.key]:SetOn(on)
  end
  front(main)
  if main:IsShown() then U.Refresh() else main:Show() end
end
function U.Toggle()
  if main and main:IsShown() then main:Hide() else U.Show() end
end
function U.IsShown() return main and main:IsShown() or false end

-- Synchro rapide (ta touche, clic droit sur la minicarte) : une seule case. L'export y est déjà sélectionné :
-- Ctrl+C l'envoie (puis la fenêtre se ferme). Ou Ctrl+V colle les données du site : chargées, puis fermeture.
local quick, quickGen = nil, 0
local function closeQuickSoon()
  local gen = quickGen -- rouverte entre-temps : on la laisse ouverte
  C_Timer.After(1.2, function() if quick and quickGen == gen then quick:Hide() end end)
end
local function quickRestore()
  quick.box:SetText(quick.value or "")
  quick.box:HighlightText()
end
local function buildQuick()
  quick = window("RosterQuick", "Roster  ·  " .. L["Synchro rapide"], 460, 196)
  quick:ClearAllPoints() quick:SetPoint("TOP", 0, -140)
  quick.status = quick:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  quick.status:SetPoint("TOPLEFT", gapX(), -32) quick.status:SetWidth(444 - gapX()) quick.status:SetJustifyH("LEFT")
  quick.box = textArea(quick, 18, -86, 424, 56)
  quick.box:SetScript("OnEscapePressed", function() quick:Hide() end)
  quick.box:SetScript("OnTextChanged", function(self, user)
    if not user then return end
    local text = self:GetText() or ""
    if text == quick.value then return end
    -- Collage depuis le site : chargé dès qu'il est complet
    if complete(text) then
      local ok, message = U.Load(text)
      if ok then
        self:SetText("")
        self:ClearFocus()
        quick.status:SetText(GREEN .. L("Chargé : %s", message) .. "|r")
        U.Refresh()
        closeQuickSoon()
      else
        quick.status:SetText(RED .. message .. "|r")
        quickRestore()
      end
      return
    end
    -- Début d'un collage (texte du site : en-tête, puis lignes) : on attend la suite
    if text:find("^%s*%u%u%u;%d+;") then return end
    -- Autre frappe : l'export reste intact et sélectionné
    quickRestore()
  end)
  quick.box:SetScript("OnKeyDown", function(_, key)
    if key == "C" and IsControlKeyDown() and (quick.count or 0) > 0 then
      markSent()
      quick.status:SetText(GREEN .. L["Copié. Sur le site, Ctrl+V sur n'importe quelle page."] .. "|r")
      U.Refresh()
      closeQuickSoon()
    end
  end)
  quick.foot = quick:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  quick.foot:SetPoint("BOTTOMLEFT", 18, 16) quick.foot:SetWidth(250) quick.foot:SetJustifyH("LEFT")
  local more = button(quick, L["Fenêtre complète"], 140, function() quick:Hide() U.Show("synchro") end)
  more:SetPoint("BOTTOMRIGHT", -16, 10)
  quick.allBtn = button(quick, L["Tout renvoyer"], 120, function() U.Quick(true) end)
  quick.allBtn:SetPoint("RIGHT", more, "LEFT", -6, 0)
  U.quick = quick
end

-- all : nil = la touche ouvre ou ferme ; true = tout renvoyer ; false = seulement les changements
function U.Quick(all)
  if not ns.db() then return end
  if not quick then buildQuick() end
  if quick:IsShown() and all == nil then quick:Hide() return end
  quickGen = quickGen + 1
  local value, count, err = export(all == true)
  quick.value, quick.count = value, count
  if err then
    quick.status:SetText(RED .. L("Export impossible : %s", tostring(err)) .. "|r\n" .. L["Ctrl+V ici pour coller ce que tu as copié sur le site."])
  elseif count > 0 then
    quick.status:SetText(L("%s : %s", ACCENT .. L["Vers le site"] .. "|r", blocks(count)) .. "\n" ..
      L["Ctrl+C pour copier, puis Ctrl+V sur le site."] .. "\n" .. GREY .. L["Ou Ctrl+V ici pour coller ce que tu as copié sur le site."] .. "|r")
  else
    quick.status:SetText(GREY .. L["Rien de nouveau à envoyer au site."] .. "|r\n" ..
      L["Ctrl+V ici pour coller ce que tu as copié sur le site (« Copier pour le jeu »)."])
  end
  local D = data()
  local ok, summary = pcall(function() return D and D.Summary and D.Summary() end)
  quick.foot:SetText(ok and summary and (GREY .. tostring(summary) .. "|r") or "")
  quick.box:SetText(value)
  front(quick)
  quick:Show()
  quick.box:SetFocus()
  quick.box:HighlightText()
end
