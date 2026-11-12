-- Fenêtre principale (1.7, refonte du 09/11) : navigation « comme le site » dans une barre latérale (Accueil, Raids, Sorties,
-- Synchro, Patrons, puis Options à part), avec une pastille sur Raids (raids sans réponse) et un point sur Synchro (persos à
-- envoyer) ; pied « Données du site · il y a 3 min ». En raid et Compo selon le moment et le rôle : En raid sous Raids quand
-- on est dans un groupe de raid (la fenêtre s'ouvre dessus), Compo pour le chef de raid, ses assistants et les officiers.
-- Fenêtre redimensionnable : 760 × 560 par défaut, de 640 × 480 à 1200 × 900, taille gardée. Un seul habillage, celui du
-- site. Aussi : synchro rapide, rappel de raid, alerte au butin et diagnostic du partage (/fr partage).
-- Fenêtres, listes : boîte à outils commune avec l'addon Roster (addon/shared/Kit.lua).
local ADDON, ns = ...
local L, N = ns.L, ns.N
local U = {}
ns.UI = U
local K = ns.Kit
U.kit, U.site, U.front, U.styleStatus, U.itemTips, U.roleIcon = K, K.site, K.front, K.styleStatus, K.itemTips, K.roleIcon

local GOLD, INK, GREEN, BLUE = K.GOLD, K.INK, K.GREEN, K.BLUE
-- État de chaque membre de la compo : couleur, texte (traduit à l'affichage)
local STATE = {
  ok = { "|cff4fd35f", N("bon groupe") }, move = { "|cfff0b43c", N("à déplacer") }, missing = { "|cffff6b5e", N("absent du raid") },
  manual = { "|cffece7d8", N("inscrit Discord : à inviter à la main") }, bench = { "|cffece7d8", N("banc") },
}
local function stateText(state)
  local s = STATE[state]
  return s and (s[1] .. L[s[2]] .. "|r") or state
end
local site, C, ART, atlas, solid, titleFont, diamond, gapX = K.site, K.C, K.ART, K.atlas, K.solid, K.titleFont, K.diamond, K.gapX
local front, window, textArea, button, statusButton, styleStatus = K.front, K.window, K.textArea, K.button, K.statusButton, K.styleStatus
local hint, list, colored, roleIcon = K.hint, K.list, K.colored, K.roleIcon
-- Habillages (valeurs gardées dans la sauvegarde et main.skin, pas des textes)
local SKIN_SITE = "site" -- nolocale


-- Fenêtre principale : une page par entrée de la barre latérale
local main
-- Entrées de la barre latérale, traduites à l'affichage (L[t.label]) ; sub : sous Raids, affichée selon le moment et le rôle ;
-- bottom : en bas, à part (Options)
local TABS = {
  { key = "accueil", label = N("Accueil"), icon = "Interface\\Icons\\INV_Misc_Book_09" },
  { key = "raids", label = N("Raids"), icon = "Interface\\Icons\\INV_Misc_Head_Dragon_01" },
  { key = "enraid", label = N("En raid"), icon = "Interface\\Icons\\INV_Misc_Bag_10_Blue", sub = true },
  { key = "compo", label = N("Compo"), icon = "Interface\\Icons\\Ability_Warrior_RallyingCry", sub = true },
  { key = "sorties", label = N("Sorties"), icon = "Interface\\Icons\\INV_Torch_Lit" },
  { key = "synchro", label = N("Synchro"), icon = "Interface\\Icons\\INV_Letter_15" },
  { key = "patrons", label = N("Patrons"), icon = "Interface\\Icons\\INV_Scroll_03" },
  { key = "options", label = N("Options"), icon = "Interface\\Icons\\INV_Misc_Gear_01", bottom = true },
}
-- Largeur de la barre latérale ; taille de la fenêtre (refonte du 09/11)
local NAV_W, WIN_W, WIN_H, MIN_W, MIN_H, MAX_W, MAX_H = 150, 760, 560, 640, 480, 1200, 900
-- Consigne en haut d'une page, à la largeur de la page (fenêtre redimensionnable)
local function pageHint(p, text)
  local h = hint(p, text)
  h:ClearAllPoints() h:SetPoint("TOPLEFT", 6, -2) h:SetPoint("TOPRIGHT", -6, -2)
  return h
end
local pages, refreshers = {}, {}
U.pages = pages

-- Réponses à un raid, 3 + Autre (refonte du 09/11, comme sur le site) : Présent, Peut-être, Absent de même largeur, puis
-- « Autre... » qui ouvre En retard, Reroll, Banc (le bouton prend le nom et la couleur de la réponse choisie parmi elles).
-- current : réponse choisie (en jeu, sinon sur le site) ; pick(clé) l'enregistre.
local function otherMenu(anchor, current, pick)
  local items = {}
  for _, st in ipairs(ns.Group.OTHER) do
    items[#items + 1] = { label = L[st.label], color = st.color, selected = current == st.key, onClick = function() pick(st.key) end }
  end
  return K.choices(anchor, items)
end
local function otherOf(current)
  for _, st in ipairs(ns.Group.OTHER) do if st.key == current then return st end end
end
function U.AnswerButtons(current, pick, width)
  width = width or 100
  local out = {}
  for _, st in ipairs(ns.Group.STATUSES) do
    out[#out + 1] = { L[st.label], width, function() pick(st.key) end, { color = st.color, selected = current == st.key } }
  end
  local other = otherOf(current)
  out[#out + 1] = { other and L[other.label] or L["Autre..."], width, function(self) return otherMenu(self, current, pick) end,
    { color = other and other.color or C.ink, selected = other ~= nil } }
  return out
end

local function buildRaids(p)
  pageHint(p, L("Inscris %s aux raids de tes groupes. Les données du site se collent dans l'onglet %sSynchro|r.", UnitName("player") or L["ce perso"], GOLD))
  p.list = list(p, -40)
end
refreshers.raids = function(p)
  local G, rows = ns.Group, p.list
  rows.Reset()
  local groups = G.List()
  if #groups == 0 then
    rows.Header(L["Groupes"])
    rows.Add(INK .. L["Aucun groupe chargé : sur le site, bouton Synchro, « Copier pour le jeu », puis colle dans l'onglet Synchro."] .. "|r")
  else
    local names = {}
    for _, g in ipairs(groups) do names[#names + 1] = g.name .. INK .. " (" .. date("%d/%m %H:%M", g.at) .. ")|r" end
    rows.Header(L["Raids à venir"])
    local companion = ns.Companion and ns.Companion.Active()
    local who = UnitName("player") or L["ce perso"]
    -- Sans l'appli (1.6.3) : mes inscriptions faites en jeu sont confiées à un officier qui l'a (Relay.lua)
    local confide = ns.Relay and ns.Relay.CanConfide()
    -- Une ligne courte ; comment l'inscription part au site : au survol (refonte du 09/11)
    rows.Add(INK .. L["Groupes :"] .. " |r" .. table.concat(names, ", "), nil,
      companion and L("Inscription de %s : elle part au site au prochain /reload (« Envoyer maintenant ») ou à la déconnexion.", who)
        or confide and L("Inscription de %s : sans Roster Companion, elle est confiée à un officier qui a l'appli (ou part avec ton export).", who)
        or L("Inscription de %s, envoyée au site avec l'export.", who))
    local raids = G.Raids()
    if #raids == 0 then rows.Add(INK .. L["Aucun raid à venir."] .. "|r") end
    for _, e in ipairs(raids) do
      local when = e.raid.time > 0 and date("%d/%m %H:%M", e.raid.time) or L["date à définir"]
      local site = e.onSite and (INK .. "  " .. L("site : %s", G.StatusLabel(e.onSite)) .. (e.siteChar and (" (" .. e.siteChar .. ")") or "") .. "|r") or ""
      -- Raid arrivé avec les données d'un autre joueur (partage) : mon inscription sur le site n'y est pas
      if e.unknown and not e.onSite then site = INK .. "  " .. L("site : %s", L["inscription inconnue (données reçues d'un autre joueur)"]) .. "|r"
      -- La liste des inscrits du site (1.6.3) est là et aucun de mes persos n'y est : pas inscrit (ce n'est pas « inconnu »)
      elseif e.siteState == "none" and not e.onSite then site = INK .. "  " .. L("site : %s", L["pas d'inscription"]) .. "|r" end
      -- Inscription faite en jeu, en attendant que le site l'enregistre (elle est alors oubliée : 1.5.4)
      -- État de l'inscription faite en jeu, en pastille courte ; le détail au survol (refonte du 09/11)
      local game, tip = "", nil
      if e.status then
        local label = G.StatusLabel(e.status)
        if e.state == "sent" then game = GREEN .. "  " .. L("en jeu : %s, reçu par le site", label) .. "|r"
        elseif e.state == "outbox" then game = GOLD .. "  " .. L("en jeu : %s, envoi en cours", label) .. "|r"
        elseif e.state == "confided" then
          game = GOLD .. "  " .. L("en jeu : %s, confiée à %s", label, e.by or "?") .. "|r"
          tip = L("en jeu : %s, confiée à %s : part au site à son prochain /reload", label, e.by or "?")
        elseif e.state == "waiting" then
          game = GOLD .. "  " .. L("en jeu : %s, en attente d'un officier", label) .. "|r"
          tip = L("en jeu : %s, aucun officier avec l'appli en ligne : elle partira dès qu'il y en aura un, ou avec ton export", label)
        elseif companion then game = GOLD .. "  " .. L("en jeu : %s, pas encore envoyé", label) .. "|r"
        else game = GOLD .. "  " .. L("en jeu : %s, part avec ton prochain export", label) .. "|r" end
      end
      -- Choisi : l'inscription faite en jeu, sinon celle du site
      local buttons = U.AnswerButtons(e.status or e.onSite, function(key) G.SignUp(e.group.id, e.raid.id, key, e.raid.time) U.Refresh() end)
      rows.Add(GOLD .. e.raid.name .. "|r  " .. when .. site .. game, buttons, tip)
      if e.state == "todo" and companion then
        rows.Add(INK .. L["Pour l'envoyer tout de suite : l'interface se recharge (quelques secondes), puis Roster Companion le transmet au site."] .. "|r",
          { { L["Envoyer maintenant"], 160, function() ns.Companion.Reload() end } })
      end
    end
  end
  rows.Done()
end

-- Onglet Sorties (1.6.1) : sorties donjon du jour et de demain (Outings.lua) ; l'inscription se fait sur le site ou Discord
local function buildSorties(p)
  pageHint(p, L["Sorties donjon du jour et de demain de tes groupes. Pour t'inscrire ou te retirer : sur le site ou sur Discord."])
  p.list = list(p, -40)
end
refreshers.sorties = function(p)
  p.list.Reset()
  if ns.Outings and ns.Outings.FillTab then ns.Outings.FillTab(p.list) end
  p.list.Done()
end

local function buildCompo(p)
  pageHint(p, L("Sur le site : page du raid, « Export pour le jeu », Copier, puis colle dans l'onglet %sSynchro|r.", GOLD))
  local invite = button(p, L["Inviter"], 120, function() ns.Compo.Invite() end)
  invite:SetPoint("TOPLEFT", 4, -40)
  local arrange = button(p, L["Placer les groupes"], 170, function() ns.Compo.Arrange() end)
  arrange:SetPoint("LEFT", invite, "RIGHT", 8, 0)
  p.clear = button(p, L["Effacer la compo"], 150, function() ns.Compo.Clear() U.Refresh() end)
  p.clear:SetPoint("LEFT", arrange, "RIGHT", 8, 0)
  p.list = list(p, -72)
end
refreshers.compo = function(p)
  local rows = p.list
  rows.Reset()
  local raid = ns.Compo.Get()
  if p.clear then if raid then p.clear:Show() else p.clear:Hide() end end
  if not raid then
    rows.Header(L["Compo"])
    rows.Add(INK .. L["Aucune compo chargée. Elle s'efface d'elle-même 12 h après l'heure du raid."] .. "|r")
  else
    local when = (raid.time and raid.time > 0) and date("%d/%m %H:%M", raid.time) or L["date non fixée"]
    local status, ok, total = ns.Compo.Status(), 0, 0
    for _, s in ipairs(status) do if s.m.group > 0 then total = total + 1 if s.state == "ok" then ok = ok + 1 end end end
    rows.Header(raid.name .. "  ·  " .. when)
    rows.Add(L("%d/%d persos placés au bon endroit", ok, total))
    local group
    for _, s in ipairs(status) do
      local m = s.m
      if m.group ~= group then
        group = m.group
        rows.Header(group > 0 and L("Groupe %d", group) or L["Non placés"])
      end
      rows.Add(string.format("%s  %s%s %s|r  %s%s", colored(m.class, m.name), INK, roleIcon(m.role), m.spec or "", stateText(s.state),
        (s.state ~= "missing" and s.online == false) and (" |cffff6b5e" .. L["(hors ligne)"] .. "|r") or ""))
    end
  end
  rows.Done()
end

local function buildPatrons(p)
  pageHint(p, L("Patron vu ailleurs (hôtel des ventes, chat) : tape %s/fr cherche|r, Maj+clic sur l'objet pour mettre son lien, puis Entrée.", GOLD))
  p.list = list(p, -40)
end
refreshers.patrons = function(p)
  local G, rows = ns.Group, p.list
  rows.Reset()
  local tracked, others = G.BagPatterns()
  rows.Header(L["Suivis par ton groupe"])
  if #tracked == 0 then rows.Add(INK .. L["Aucun dans tes sacs (charge les données du site dans l'onglet Raids)."] .. "|r") end
  for _, e in ipairs(tracked) do
    local link = G.linkFor(e.itemId, e.who and e.who.recipe)
    local parts = {}
    if e.who then parts[#parts + 1] = G.joinNames(e.who.wanted) and (GREEN .. L("recherché par %s", G.joinNames(e.who.wanted)) .. "|r") or (INK .. L["personne ne le recherche"] .. "|r") end
    if e.bis then parts[#parts + 1] = BLUE .. L("BiS de %s", G.joinNames(e.bis)) .. "|r" end
    rows.Add(link .. "  " .. table.concat(parts, "  "), { { L["Annoncer"], 120, function() G.Announce(e.itemId) end } })
  end
  rows.Header(L["Autres patrons de tes sacs"])
  if #others == 0 then rows.Add(INK .. L["Aucun."] .. "|r") end
  for _, e in ipairs(others) do
    local on = G.IsWantedHere(e.itemId)
    rows.Add(G.linkFor(e.itemId), { { on and L["Retirer"] or L["Je le recherche"], 150, function() G.ToggleWanted(e.itemId, G.linkFor(e.itemId)) U.Refresh() end } })
  end
  local marks = ns.charDB().wanted or {}
  local any = false
  for itemId, on in pairs(marks) do
    if not any then rows.Header(L["Marqués en jeu (envoyés avec l'export)"]) any = true end
    rows.Add(G.linkFor(itemId) .. "  " .. (on and (GREEN .. L["recherché"] .. "|r") or (INK .. L["retiré"] .. "|r")), { { L["Annuler"], 100, function() marks[itemId] = nil U.Refresh() end } })
  end
  rows.Done()
end

-- Barre de titre de section fixe (comme « General » sur la fiche de perso)
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
  if not atlas(bg, ART.header) then bg:SetColorTexture(0.25, 0.18, 0.08, 0.8) end
  local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
  fs:SetPoint("CENTER", bg, "CENTER", 0, 1)
  fs:SetText(text)
  return fs
end

-- Synchro : coller ce qui vient du site (chargé tout seul), copier ce qui part vers le site (Ctrl+C = envoyé)
-- Texte collé venant du site : données des groupes (FRG) ou compo d'un raid (FRR). Renvoie ok, message.
-- Le chargement est noté sans texte (ForeverRosterDB.lastLoad : nombres, nom de la compo), mis en mots à l'affichage.
function U.LoadFromSite(text)
  local ok, err
  if text:find("FRG;", 1, true) then
    ok, err = ns.Group.Load(text)
    if ok then
      local raids, patterns = 0, 0
      for _, g in ipairs(ok) do raids = raids + #g.raids for _ in pairs(g.patterns) do patterns = patterns + 1 end end
      ForeverRosterDB.lastLoad = { at = time(), groups = #ok, raids = raids, patterns = patterns }
      -- Données neuves : partagées avec la guilde et le raid (seulement les blocs signés par le site, Group.lua)
      ns.Group.ShareNew()
    end
  elseif text:find("FRR;", 1, true) then
    ok, err = ns.Compo.Load(text)
    if ok then
      local raid = ns.Compo.Get()
      ForeverRosterDB.lastLoad = { at = time(), compo = raid and raid.name or "?" }
    end
  else
    err = L["Texte non reconnu : sur le site, « Copier pour le jeu » ou « Export pour le jeu » d'un raid."]
  end
  if ok then return true, ns.Companion.LoadText(ForeverRosterDB.lastLoad) end
  return false, tostring(err)
end

local function onPaste(self, user)
  if not user then return end
  local text = self:GetText() or ""
  if not text:match("END;%d+%s*$") then return end -- collage pas encore complet
  local ok, msg = U.LoadFromSite(text)
  if ok then self:SetText("") self:ClearFocus() U.Refresh() else self.page.loadStatus:SetText("|cffff6b5e" .. msg .. "|r") end
end

local SYNC_HINT = N("Plus rapide : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou le clic droit sur le bouton de la minicarte ouvrent la synchro rapide.")
-- Synchro (1.7, refonte du 09/11) : deux vues de même largeur, « Échanger avec le site » (coller, copier) et « Persos de
-- l'export » (venue des Options) ; tout se place à la largeur de la fenêtre, l'export prend la hauteur qui reste.
local function syncSeg(p)
  p.seg = {}
  for i, v in ipairs({ { "ex", N("Échanger avec le site") }, { "ch", N("Persos de l'export") } }) do
    local b = statusButton(p)
    b:SetSize(200, 28)
    b:SetPoint("TOPLEFT", 4 + (i - 1) * 204, -30)
    b:SetScript("OnClick", function() p.view = v[1] U.Refresh() end)
    b.key, b.label0 = v[1], v[2]
    p.seg[i] = b
  end
end
local function buildSynchro(p)
  p.hint = pageHint(p, L[SYNC_HINT])
  p.view = "ex"
  syncSeg(p)
  -- Vue « Échanger avec le site »
  local ex = CreateFrame("Frame", nil, p)
  ex:SetPoint("TOPLEFT", 0, -66) ex:SetPoint("BOTTOMRIGHT", 0, 0)
  p.ex = ex
  headerBar(ex, 0, L["1 · Du site vers le jeu"])
  p.input = textArea(ex, 6, -40, -6, 34)
  p.input.page = p
  p.input:SetScript("OnTextChanged", onPaste)
  p.loadStatus = ex:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.loadStatus:SetPoint("TOPLEFT", 6, -84) p.loadStatus:SetPoint("TOPRIGHT", -196, -84) p.loadStatus:SetJustifyH("LEFT")
  -- Roster Companion (1.4) : nouveautés déposées par l'appli, sans /reload
  p.pull = button(ex, L["Charger les nouveautés"], 180, function() ns.Companion.RefreshCommand() end)
  p.pull:SetPoint("TOPRIGHT", ex, "TOPRIGHT", -4, -80)
  p.pull:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L["Charger les nouveautés de Roster Companion"])
    GameTooltip:AddLine(L("Sans /reload. Aussi tout seul à l'ouverture de cette fenêtre, avant un raid, à l'appel et en entrant en raid. Encore %d cette session.", ns.Companion.SlotsLeft()), 1, 1, 1, true)
    GameTooltip:Show()
  end)
  p.pull:SetScript("OnLeave", function() GameTooltip:Hide() end)
  p.pull:Hide()
  -- Origine des données de chaque groupe : collées, Roster Companion ou reçues d'un joueur (partage), et quand (3 lignes au plus)
  p.origins = ex:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.origins:SetPoint("TOPLEFT", 6, -114) p.origins:SetPoint("TOPRIGHT", -6, -114) p.origins:SetJustifyH("LEFT")
  headerBar(ex, -150, L["2 · Du jeu vers le site"])
  local box
  p.text, p.textSf, box = textArea(ex, 6, -190, -6, 120)
  p.textBox = box
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
  p.status = ex:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  p.status:SetPoint("TOPLEFT", box or p.textSf, "BOTTOMLEFT", 0, -10) p.status:SetPoint("RIGHT", ex, "RIGHT", -6, 0) p.status:SetJustifyH("LEFT")
  p.all = false
  p.toggleAll = button(ex, L["Tout renvoyer"], 170, function() p.all = not p.all p.sent = false U.Refresh() end)
  p.toggleAll:SetPoint("TOPLEFT", p.status, "BOTTOMLEFT", -2, -8)
  local again = button(ex, L["Actualiser"], 120, function() p.sent = false U.Refresh() end)
  again:SetPoint("LEFT", p.toggleAll, "RIGHT", 8, 0)
  -- Roster Companion (1.5) : les deux sens d'un coup, en rechargeant l'interface
  p.reload = button(ex, L["Synchroniser"], 130, function() ns.Companion.Reload() end)
  p.reload:SetPoint("LEFT", again, "RIGHT", 8, 0)
  p.reload:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_TOP")
    GameTooltip:AddLine(L["Synchroniser avec Roster Companion"])
    GameTooltip:AddLine(L["Recharge l'interface (quelques secondes) : tes persos et inscriptions partent au site, et les nouveautés du site arrivent."], 1, 1, 1, true)
    GameTooltip:Show()
  end)
  p.reload:SetScript("OnLeave", function() GameTooltip:Hide() end)
  p.reload:Hide()
  p.chars = ex:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.chars:SetPoint("TOPLEFT", p.toggleAll, "BOTTOMLEFT", 2, -10) p.chars:SetPoint("RIGHT", ex, "RIGHT", -6, 0) p.chars:SetJustifyH("LEFT")
  -- Relais (1.6.3) : inscriptions confiées par la guilde, envoyées au site au prochain /reload (Relay.lua) ; seulement
  -- s'il y en a
  p.relay = ex:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  p.relay:SetPoint("TOPLEFT", p.chars, "BOTTOMLEFT", 0, -10) p.relay:SetPoint("RIGHT", ex, "RIGHT", -180, 0) p.relay:SetJustifyH("LEFT")
  p.relaySend = button(ex, L["Envoyer maintenant"], 160, function() ns.Companion.Reload() end)
  p.relaySend:SetPoint("LEFT", p.relay, "RIGHT", 8, 0)
  p.relaySend:Hide()
  -- Vue « Persos de l'export » (retirer un perso supprimé)
  local ch = CreateFrame("Frame", nil, p)
  ch:SetPoint("TOPLEFT", 0, -66) ch:SetPoint("BOTTOMRIGHT", 0, 0)
  p.ch = ch
  p.list = list(ch, 0)
  ch:Hide()
end
-- Hauteur de l'export : ce qui reste sous les deux bandeaux (fenêtre redimensionnable), entre 60 et 260
local function fitExport(p)
  local h = p.ex.GetHeight and p.ex:GetHeight()
  if type(h) ~= "number" or h <= 0 then return end
  local rest = math.max(60, math.min(260, h - 190 - 120))
  if p.textSf and p.textSf.SetHeight then p.textSf:SetHeight(rest) end
  if p.textBox and p.textBox.SetHeight then p.textBox:SetHeight(rest) end
end
-- Persos de l'export (venue des Options, refonte du 09/11) : envoyé quand, et « Retirer de l'export » pour un perso supprimé
local function exportChars(p)
  local rows = p.list
  rows.Reset()
  rows.Header(L["Persos de l'export"])
  local chars = ns.Export.Characters()
  if #chars == 0 then rows.Add(INK .. L["Aucun perso relevé pour l'instant."] .. "|r") end
  for _, e in ipairs(chars) do
    local h = e.snap.header or {}
    local sent = e.char.sentAt and L("envoyé au site le %s", date("%d/%m %H:%M", e.char.sentAt)) or L["jamais envoyé"]
    local text = colored(h.class, h.name or e.key) .. INK .. "  " .. L("%s · niveau %s · relevé le %s · %s", h.realm or "", tostring(h.level or "?"), date("%d/%m %H:%M", e.snap.at or 0), sent) .. "|r"
    if e.current then
      rows.Add(text .. "\n" .. INK .. L["Perso connecté : il est relevé tout seul, il ne peut pas être retiré."] .. "|r")
    elseif p.confirm == e.key then
      rows.Add(text .. "\n" .. GOLD .. L["Le retirer de l'export ? Il reviendra si tu te connectes avec lui."] .. "|r", {
        { L["Oui, retirer"], 120, function() ns.Export.Forget(e.key) p.confirm = nil if ns.Minimap.Update then ns.Minimap.Update() end U.Refresh() end },
        { L["Annuler"], 100, function() p.confirm = nil U.Refresh() end },
      })
    else
      rows.Add(text, { { L["Retirer de l'export"], 160, function() p.confirm = e.key U.Refresh() end } })
    end
  end
  rows.Done()
end
refreshers.synchro = function(p)
  local GOLDC = { C.gold[1], C.gold[2], C.gold[3] }
  local n = #ns.Export.Characters()
  for _, b in ipairs(p.seg) do
    styleStatus(b, b.key == "ch" and L("%s · %d", L[b.label0], n) or L[b.label0], GOLDC, p.view == b.key)
  end
  if p.view == "ch" then p.ex:Hide() p.ch:Show() exportChars(p) return end
  p.ch:Hide() p.ex:Show()
  fitExport(p)
  -- Roster Companion (lot K1) : l'appli fait la synchro ; le copier-coller reste possible pour forcer un envoi
  local companion = ns.Companion.Active()
  p.hint:SetText(companion and ns.Companion.StatusText(GREEN) or L[SYNC_HINT])
  local pull = companion and ns.Companion.SlotsLeft() > 0
  if pull then p.pull:Show() else p.pull:Hide() end
  if companion then p.reload:Show() else p.reload:Hide() end
  local last = ForeverRosterDB.lastLoad
  p.loadStatus:SetText(last and (GREEN .. L("Chargé le %s : %s", date("%d/%m %H:%M", last.at), ns.Companion.LoadText(last)) .. "|r")
    or (INK .. L["Sur le site, bouton Synchro, « Copier pour le jeu », puis colle ici : c'est chargé tout seul."] .. "|r"))
  -- Partage entre joueurs : d'où viennent les données de chaque groupe (Group.lua)
  local okO, origins = pcall(ns.Group.Origins)
  local lines = okO and type(origins) == "table" and origins or {}
  if #lines > 3 then lines = { lines[1], lines[2], L("+ %d autres groupes", #lines - 2) } end
  p.origins:SetText(#lines > 0 and (INK .. table.concat(lines, "\n") .. "|r") or "")
  local ok, value, included = pcall(ns.Export.Build, { all = p.all })
  if not ok then ns.print("|cffff6060" .. L("erreur (%s)", "export") .. "|r " .. tostring(value)) return end
  p.value, p.included = value, included
  p.toggleAll:SetText(p.all and L["Seulement les changements"] or L["Tout renvoyer"])
  local names = ns.Export.Names(included, colored)
  if p.sent then
    p.status:SetText(GREEN .. L["Copié · Ctrl+V sur le site, sur n'importe quelle page."] .. "|r")
  elseif #names == 0 then
    local lastSent = 0
    for _, e in ipairs(ns.Export.Characters()) do lastSent = math.max(lastSent, e.char.sentAt or 0) end
    p.status:SetText(INK .. (lastSent > 0 and L("Rien de nouveau depuis ton dernier envoi (%s). « Tout renvoyer » pour tout recopier.", date("%d/%m %H:%M", lastSent))
      or L["Rien de nouveau depuis ton dernier envoi. « Tout renvoyer » pour tout recopier."]) .. "|r")
  else
    p.status:SetText(L("%sÀ envoyer|r : %s%s   Ctrl+C puis Échap.|r", GOLD, table.concat(names, ", "), INK))
  end
  p.text:SetText(value)
  local all = {}
  for _, e in ipairs(ns.Export.Characters()) do
    local h = e.snap.header or {}
    all[#all + 1] = colored(h.class, h.name or e.key) .. INK .. " (" .. (e.char.sentAt and L("envoyé le %s", date("%d/%m", e.char.sentAt)) or L["jamais envoyé"]) .. ")|r"
  end
  p.chars:SetText(L("%sPersos relevés : |r%s%s. Pour retirer un perso supprimé : « Persos de l'export » en haut.|r", INK, table.concat(all, ", "), INK))
  local relayed = companion and ns.Relay and ns.Relay.Count() or 0
  if relayed > 0 then
    p.relay:SetText(GOLD .. (relayed > 1 and L("Relais : %d inscriptions confiées par la guilde, envoyées au site au prochain /reload.", relayed)
      or L("Relais : %d inscription confiée par la guilde, envoyée au site au prochain /reload.", relayed)) .. "|r")
    p.relaySend:Show()
  else
    p.relay:SetText("")
    p.relaySend:Hide()
  end
  if #names > 0 and not p.sent then p.text:SetFocus() p.text:HighlightText() end
end

-- Options : touches, langue, bouton de la minicarte, rappels, relevé, partage des données du site (1.7, refonte du 09/11 :
-- vrais interrupteurs pour le binaire, segments de même largeur ; les persos de l'export sont passés dans Synchro)
local BINDINGS = {
  { action = "FOREVERROSTER_SYNC", label = N("Synchro rapide avec le site") },
  { action = "FOREVERROSTER_TOGGLE", label = N("Ouvrir ou fermer la fenêtre") },
  { action = "FOREVERROSTER_REFRESH", label = N("Charger les nouveautés (Roster Companion)") },
  { action = "FOREVERROSTER_RELOAD", label = N("Synchroniser (Roster Companion, recharge l'interface)") },
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
  if InCombatLockdown and InCombatLockdown() then ns.print("|cffff6b5e" .. L["pas de changement de touche en combat."] .. "|r") return false end
  local _, old = keysOf(action)
  for _, k in ipairs(old) do SetBinding(k, nil) end
  if key then
    local taken = GetBindingAction and GetBindingAction(key)
    if taken and taken ~= "" and taken ~= action then
      ns.print(L("%s servait à « %s » : remplacée.", GOLD .. keyText(key) .. "|r", (_G["BINDING_NAME_" .. taken]) or taken))
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
        if U.SetBinding(action, combo) then ns.print(L("touche %s enregistrée.", GOLD .. keyText(combo) .. "|r")) end
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
  pageHint(p, L["Réglages de l'addon, gardés pour tous tes persos. Les touches se changent aussi dans Échap > Options > Raccourcis > AddOns."])
  p.list = list(p, -40)
end
-- Interrupteur : le bouton dit l'état (« Activé » vert plein, « Coupé ») et le change d'un clic
local SWITCH_ON, SWITCH_OFF = { 0.31, 0.83, 0.37 }, { C.ink[1], C.ink[2], C.ink[3] }
local function switch(on, fn) return { on and L["Activé"] or L["Coupé"], 110, fn, { color = on and SWITCH_ON or SWITCH_OFF, selected = on } } end
U.switch = switch
-- Langue : celle du jeu (nil), "fr" ou "en" ; appliquée au rechargement de l'interface (les fenêtres sont construites une fois)
function U.SetLang(v)
  ForeverRosterDB.lang = (v == "fr" or v == "en") and v or nil
  U.Refresh()
end
refreshers.options = function(p)
  local rows = p.list
  rows.Reset()
  rows.Header(L["Touches"])
  local waiting = U.capturing()
  for _, b in ipairs(BINDINGS) do
    local shown = keysOf(b.action)
    local current = #shown > 0 and (GOLD .. table.concat(shown, ", ") .. "|r") or (INK .. L["aucune touche"] .. "|r")
    if waiting == b.action then
      rows.Add(L("%s : %sappuie sur la touche voulue (avec Alt, Ctrl ou Maj si tu veux)... Échap : annuler.|r", L[b.label], GREEN))
    else
      local buttons = { { L["Choisir une touche"], 160, function() U.StartCapture(b.action) end } }
      if #shown > 0 then buttons[2] = { L["Retirer"], 100, function() U.SetBinding(b.action, nil) U.Refresh() end } end
      rows.Add(L("%s : %s", L[b.label], current), buttons)
    end
  end
  rows.Header(L["Affichage et rappels"])
  -- Langue : comparée à celle de l'interface depuis son chargement (ns.langAtLoad) pour proposer de recharger ; trois segments
  -- de même largeur
  local GOLDC = { C.gold[1], C.gold[2], C.gold[3] }
  local chosen, client = ForeverRosterDB.lang, ns.LangName(ns.ClientLang())
  local langChanged = ns.langAtLoad ~= nil and ns.Lang() ~= ns.langAtLoad
  local langButtons = {
    { L("Celle du jeu (%s)", client), 150, function() U.SetLang(nil) end, { color = GOLDC, selected = chosen == nil } },
    { ns.LangName("fr"), 150, function() U.SetLang("fr") end, { color = GOLDC, selected = chosen == "fr" } },
    { ns.LangName("en"), 150, function() U.SetLang("en") end, { color = GOLDC, selected = chosen == "en" } },
  }
  if langChanged then langButtons[4] = { L["Recharger"], 110, function() ReloadUI() end } end
  rows.Add(L["Langue"] .. (langChanged and (GREEN .. "  · " .. L["appliquée après rechargement de l'interface"] .. "|r") or "") ..
    "\n" .. INK .. L["Celle du jeu : français si le jeu est en français, anglais sinon."] .. "|r", langButtons)
  local mapOn = not (ForeverRosterDB.minimap and ForeverRosterDB.minimap.hidden)
  rows.Add(L["Bouton de la minicarte"] .. "\n" .. INK .. L["(clic : fenêtre, clic droit : synchro rapide, pastille : persos à envoyer)"] .. "|r",
    { switch(mapOn, function() ns.Minimap.SetShown(not mapOn) U.Refresh() end) })
  local remind = not ForeverRosterDB.noReminder
  rows.Add(L["Rappel de raid à la connexion"] .. "\n" .. INK .. L["(raid des prochaines 24 h sans réponse : « Tu viens ? »)"] .. "|r",
    { switch(remind, function() ForeverRosterDB.noReminder = remind or nil U.Refresh() end) })
  local nudge = not ForeverRosterDB.noSyncNudge
  rows.Add(L["Rappel de synchro dans le chat"] .. "\n" .. INK .. L["(une fois par session, après un changement d'équipement)"] .. "|r",
    { switch(nudge, function() ForeverRosterDB.noSyncNudge = nudge or nil U.Refresh() end) })
  rows.Header(L["Présence et butin"])
  local rec, cur = ns.Recorder.Enabled(), ns.Recorder.Current()
  rows.Add(L["Relevé pendant les raids du site"] .. (cur and (GOLD .. "  · " .. L("en cours : %s", cur.name or "raid") .. "|r") or "") ..
    "\n" .. INK .. L["Qui est dans le raid (chaque minute) et le butin. Le bilan part avec ta synchro ; le site ne retient que celui d'un officier."] .. "|r",
    { switch(rec, function() ForeverRosterDB.noRecord = rec or nil if rec then ns.Recorder.Sample() end U.Refresh() end) })
  local q = ns.Recorder.MinQuality()
  local function setQ(v) return function() ForeverRosterDB.lootQuality = v U.Refresh() end end
  local QC = { [3] = { 0, 0.44, 0.87 }, [4] = { 0.64, 0.21, 0.93 }, [5] = { 1, 0.5, 0 } }
  rows.Add(L["Butin noté à partir de"], {
    { L["Rare"], 120, setQ(3), { color = QC[3], selected = q == 3 } }, { L["Épique"], 120, setQ(4), { color = QC[4], selected = q == 4 } },
    { L["Légendaire"], 120, setQ(5), { color = QC[5], selected = q == 5 } } })
  -- Partage des données du site (Group.lua, addon/shared/Share.lua) : nil = oui (par défaut), false = ni annonce ni envoi
  rows.Header(L["Partage entre joueurs"])
  local share = ForeverRosterDB.share ~= false
  rows.Add(L["Partager les données du site avec la guilde et le raid"] ..
    "\n" .. INK .. L["Les données collées (ou reçues) partent aux joueurs de ta guilde et de ton raid qui ont Forever Roster ; chacun ne garde que ses groupes, vérifiés par la signature du site. Coupé : tu reçois toujours celles des autres."] .. "|r",
    { switch(share, function()
      if share then ForeverRosterDB.share = false else ForeverRosterDB.share = nil ns.Group.ShareNew() end
      U.Refresh()
    end) })
  -- Relais des inscriptions faites en jeu (Relay.lua, 1.6.3) : nil = oui (par défaut), false = coupé
  local confide, relaying = ForeverRosterDB.confide ~= false, ForeverRosterDB.relaying ~= false
  rows.Add(L["Confier mes inscriptions faites en jeu à un officier qui a Roster Companion"] ..
    "\n" .. INK .. L["Seulement sans l'appli. Coupé : elles partent avec ton export."] .. "|r",
    { switch(confide, function() if confide then ForeverRosterDB.confide = false else ForeverRosterDB.confide = nil end U.Refresh() end) })
  rows.Add(L["Transmettre au site les inscriptions de la guilde"] ..
    "\n" .. INK .. L["Officiers avec Roster Companion."] .. "|r",
    { switch(relaying, function() if relaying then ForeverRosterDB.relaying = false else ForeverRosterDB.relaying = nil end U.Refresh() end) })
  rows.Done()
end

-- Onglet « En raid » (lot G) : qui a l'addon, appel aux consommables, objets à remettre, fiches de boss, butin
local function buildEnRaid(p)
  pageHint(p, L("Pendant le raid. Le butin s'ouvre seul quand tu es maître du butin (%s/fr butin|r pour la fenêtre, ou avec un lien d'objet).", GOLD))
  p.list = list(p, -40)
end
refreshers.enraid = function(p)
  p.list.Reset()
  if ns.Raid and ns.Raid.FillTab then ns.Raid.FillTab(p.list) end
  p.list.Done()
end

-- Accueil (1.7, refonte du 09/11) : ce soir (raid des 24 h avec la réponse en un clic, sorties du jour) et à faire (synchro,
-- raids sans réponse plus tard, demandes de retrait à préparer), cinq éléments au plus
local function first(name) return ((ns.text(name):gsub("^%s+", "")):match("^[^%-%s]+") or ""):lower() end
local function amOfficer()
  local me = first(UnitName and UnitName("player"))
  for _, g in ipairs(ns.Group.List()) do
    for _, n in ipairs(g.officers or {}) do if first(n) == me then return true end end
  end
  return false
end
-- Demandes de retrait en cours dans les groupes où ce perso est officier ou banquier (BankRequests.lua)
local function bankRequests()
  local me, n = first(UnitName and UnitName("player")), 0
  for _, g in ipairs(ns.Group.List()) do
    local mine = false
    for _, list in ipairs({ g.officers or {}, g.bankers or {} }) do for _, x in ipairs(list) do if first(x) == me then mine = true end end end
    if mine then n = n + #(g.requests or {}) end
  end
  return n
end
-- Raids sans réponse (ni en jeu ni sur le site) : pastille de Raids
function U.Unanswered()
  local n, now = 0, time()
  for _, e in ipairs(ns.Group.Raids()) do
    if not (e.status or e.onSite) and (e.raid.time == 0 or e.raid.time > now) then n = n + 1 end
  end
  return n
end
local function pendingChars()
  local ok, pending = pcall(ns.Export.Pending)
  return ok and type(pending) == "table" and #pending or 0
end
local MAX_HOME = 5
local function buildAccueil(p)
  pageHint(p, L["Ce soir, puis ce qui t'attend. Tout le reste est dans la barre de gauche."])
  p.list = list(p, -40)
end
refreshers.accueil = function(p)
  local G, rows, shown = ns.Group, p.list, 0
  rows.Reset()
  local ask, known = U.SoonRaids()
  local soon = {}
  for _, e in ipairs(ask) do soon[#soon + 1] = e end
  for _, e in ipairs(known) do soon[#soon + 1] = e end
  table.sort(soon, function(a, b) return a.raid.time < b.raid.time end)
  local outs = {}
  if ns.Outings and ns.Outings.List then for _, x in ipairs(ns.Outings.List()) do if x.day == 0 then outs[#outs + 1] = x end end end
  rows.Header(L["Ce soir"])
  if #soon == 0 and #outs == 0 then rows.Add(INK .. L["Rien de prévu dans les 24 h."] .. "|r") end
  for _, e in ipairs(soon) do
    if shown >= MAX_HOME then break end
    shown = shown + 1
    local cur = e.status or e.onSite
    rows.Add(GOLD .. e.raid.name .. "|r  " .. U.whenText(e.raid.time) .. INK .. "  ·  " .. (e.group.name or "") .. "|r",
      U.AnswerButtons(cur, function(key) G.SignUp(e.group.id, e.raid.id, key, e.raid.time) if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end U.Refresh() end))
  end
  for _, x in ipairs(outs) do
    if shown >= MAX_HOME then break end
    shown = shown + 1
    local filled, total = ns.Outings.Count(x.o)
    rows.Add(GOLD .. (x.o.title or "") .. "|r  " .. (x.o.time > 0 and date("%H:%M", x.o.time) or L["dès que complet"]) .. INK .. "  ·  " .. L("%d/%d", filled, total) .. "|r",
      { { L["Voir la sortie"], 140, function() U.Show("sorties") end } })
  end
  rows.Header(L["À faire"])
  local todo = 0
  local pend = pendingChars()
  if pend > 0 and shown < MAX_HOME then
    shown, todo = shown + 1, todo + 1
    rows.Add(L["Synchro"] .. INK .. "  ·  " .. (pend > 1 and L("%d persos à envoyer au site", pend) or L("%d perso à envoyer au site", pend)) .. "|r",
      { { L["Synchro rapide"], 140, function() U.Quick(false) end } })
  end
  local later = U.Unanswered() - #ask
  if later > 0 and shown < MAX_HOME then
    shown, todo = shown + 1, todo + 1
    rows.Add(L["Raids"] .. INK .. "  ·  " .. (later > 1 and L("%d raids sans réponse", later) or L("%d raid sans réponse", later)) .. "|r",
      { { L["Répondre"], 120, function() U.Show("raids") end } })
  end
  local bank = bankRequests()
  if bank > 0 and shown < MAX_HOME then
    shown, todo = shown + 1, todo + 1
    rows.Add(L["Banque"] .. INK .. "  ·  " .. (bank > 1 and L("%d demandes de retrait à préparer à la banque", bank) or L("%d demande de retrait à préparer à la banque", bank)) .. "|r")
  end
  if #G.List() == 0 and shown < MAX_HOME then
    todo = todo + 1
    rows.Add(L["Données du site"] .. INK .. "  ·  " .. L["aucun groupe chargé"] .. "|r", { { L["Synchro"], 120, function() U.Show("synchro") end } })
  end
  if todo == 0 then rows.Add(INK .. L["Rien à faire pour l'instant."] .. "|r") end
  rows.Done()
end

local builders = { accueil = buildAccueil, synchro = buildSynchro, raids = buildRaids, sorties = buildSorties, enraid = buildEnRaid, compo = buildCompo,
  patrons = buildPatrons, options = buildOptions }

-- En raid et Compo selon le moment et le rôle : En raid dans un groupe de raid ; Compo pour le chef, ses assistants, les
-- officiers d'un groupe, ou quand une compo est chargée
local function visible(t)
  if t.key == "enraid" then return IsInRaid and IsInRaid() or false end
  if t.key == "compo" then
    local lead = (IsInGroup and IsInGroup()) and ((UnitIsGroupLeader and UnitIsGroupLeader("player")) or (UnitIsGroupAssistant and UnitIsGroupAssistant("player")))
    return lead or amOfficer() or (ns.Compo and ns.Compo.Get() ~= nil) or false
  end
  return true
end
U.NavVisible = function(key) for _, t in ipairs(TABS) do if t.key == key then return visible(t) end end return false end

-- Entrée de la barre latérale : icône et nom ; choisie : filet doré à gauche, fond, texte doré ; pastille (nombre) ou point
local function navItem(parent, t)
  local b = CreateFrame("Button", nil, parent)
  b:SetHeight(32)
  b.bg = b:CreateTexture(nil, "BACKGROUND") b.bg:SetAllPoints() solid(b.bg, C.panel2, 0.9) b.bg:Hide()
  b.bar = b:CreateTexture(nil, "BORDER") b.bar:SetPoint("TOPLEFT") b.bar:SetPoint("BOTTOMLEFT") b.bar:SetWidth(3) solid(b.bar, C.gold) b.bar:Hide()
  local icon = b:CreateTexture(nil, "ARTWORK")
  icon:SetSize(16, 16) icon:SetTexCoord(0.08, 0.92, 0.08, 0.92) icon:SetTexture(t.icon)
  icon:SetPoint("LEFT", t.sub and 26 or 12, 0)
  local label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  label:SetPoint("LEFT", icon, "RIGHT", 8, 0) label:SetPoint("RIGHT", -30, 0) label:SetJustifyH("LEFT")
  label:SetText(L[t.label])
  b.badge = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  b.badge:SetPoint("RIGHT", -10, 0)
  -- Point doré (Synchro : persos à envoyer), dessiné : les polices du jeu n'ont pas toutes le caractère « • »
  b.dot = b:CreateTexture(nil, "OVERLAY") b.dot:SetSize(8, 8) b.dot:SetPoint("RIGHT", -12, 0) solid(b.dot, C.gold) b.dot:Hide()
  local hl = b:CreateTexture(nil, "HIGHLIGHT") hl:SetAllPoints() solid(hl, C.panel2, 0.6)
  b.label, b.icon = label, icon
  function b:SetOn(on)
    if on then self.bg:Show() self.bar:Show() label:SetTextColor(C.gold[1], C.gold[2], C.gold[3]) icon:SetDesaturated(false)
    else self.bg:Hide() self.bar:Hide() label:SetTextColor(C.ink[1], C.ink[2], C.ink[3]) icon:SetDesaturated(false) end
  end
  function b:SetBadge(text) self.badge:SetText(text or "") end
  function b:SetDot(on) if on then self.dot:Show() else self.dot:Hide() end end
  b:SetOn(false)
  b:SetScript("OnClick", function() U.Show(t.key) end)
  return b
end

-- Place les entrées visibles de la barre (Options en bas, à part) et met à jour pastilles et pied
local function layoutNav()
  if not main then return end
  local y = -36
  for _, t in ipairs(TABS) do
    local b = main.tabs[t.key]
    b:ClearAllPoints()
    if t.bottom then
      b:SetPoint("BOTTOMLEFT", main, "BOTTOMLEFT", 1, 40) b:SetWidth(NAV_W - 2) b:Show()
    elseif visible(t) then
      b:SetPoint("TOPLEFT", main, "TOPLEFT", 1, y) b:SetWidth(NAV_W - 2) b:Show()
      y = y - 34
    else
      b:Hide()
    end
  end
  local n = U.Unanswered()
  main.tabs.raids:SetBadge(n > 0 and (GOLD .. n .. "|r") or "")
  main.tabs.synchro:SetDot(pendingChars() > 0)
  local last = ForeverRosterDB.lastLoad
  local ago
  if last and last.at then
    local m = math.max(0, math.floor((time() - last.at) / 60))
    ago = m < 1 and L["à l'instant"] or m < 60 and L("il y a %d min", m) or m < 1440 and L("il y a %d h", math.floor(m / 60)) or L("le %s", date("%d/%m", last.at))
  end
  main.foot:SetText(INK .. (ago and L("Données du site · %s", ago) or L["Données du site : jamais chargées"]) .. "|r")
end
U.LayoutNav = layoutNav

local function buildMain()
  main = window("ForeverRosterMain", "Forever Roster", WIN_W, WIN_H)
  main.tabs, main.skin = {}, SKIN_SITE
  -- Barre latérale : fond plus sombre, filet à droite ; le pied dit l'âge des données du site
  local side = main:CreateTexture(nil, "BACKGROUND", nil, -5)
  side:SetPoint("TOPLEFT", 1, -28) side:SetPoint("BOTTOMLEFT", 1, 1) side:SetWidth(NAV_W) solid(side, C.bg, 0.7)
  local rule = main:CreateTexture(nil, "BORDER")
  rule:SetPoint("TOPLEFT", NAV_W + 1, -28) rule:SetPoint("BOTTOMLEFT", NAV_W + 1, 1) rule:SetWidth(1) solid(rule, C.line)
  main.foot = main:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  main.foot:SetPoint("BOTTOMLEFT", 12, 12) main.foot:SetWidth(NAV_W - 20) main.foot:SetJustifyH("LEFT")
  for _, t in ipairs(TABS) do
    main.tabs[t.key] = navItem(main, t)
    local p = CreateFrame("Frame", nil, main)
    p:SetPoint("TOPLEFT", NAV_W + 14, -36) p:SetPoint("BOTTOMRIGHT", -12, 22)
    p:Hide()
    builders[t.key](p)
    pages[t.key] = p
  end
  -- Redimensionnable, taille gardée (Kit.resizable) ; les pages se remettent en page à la nouvelle taille
  K.resizable(main, "main", MIN_W, MIN_H, MAX_W, MAX_H, function() U.Refresh() end)
  main:SetScript("OnShow", function() ns.safe("Roster Companion", ns.Companion.AutoRefresh, "window") U.Refresh() end)
  layoutNav()
end

function U.Refresh()
  if not main or not main:IsShown() then return end
  local tab = pages[ForeverRosterDB.tab] and ForeverRosterDB.tab or "accueil"
  ns.safe(N("affichage"), layoutNav)
  local fn = refreshers[tab]
  if fn then ns.safe(N("affichage"), fn, pages[tab]) end
end

-- Ouvre la fenêtre sur une page : celle demandée (barre latérale, /fr enraid…), sinon En raid dans un groupe de raid, sinon la
-- dernière utilisée ; celle-ci, cachée depuis (En raid hors raid, Compo sans rôle), laisse la place à Raids.
function U.Show(tab)
  if not main then buildMain() end
  local asked = pages[tab] ~= nil
  if not tab and IsInRaid and IsInRaid() then tab, asked = "enraid", true end
  tab = pages[tab] and tab or (pages[ForeverRosterDB.tab] and ForeverRosterDB.tab) or "accueil"
  if not asked and not U.NavVisible(tab) then tab = "raids" end
  ForeverRosterDB.tab = tab
  if tab == "synchro" then pages.synchro.sent = false end
  for _, t in ipairs(TABS) do
    local on = t.key == tab
    if on then pages[t.key]:Show() main:SetWindowTitle("Forever Roster  ·  " .. L[t.label]) else pages[t.key]:Hide() end
    main.tabs[t.key]:SetOn(on or (t.key == "raids" and (tab == "enraid" or tab == "compo")))
  end
  front(main)
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

-- Groupe changé : En raid et Compo paraissent ou disparaissent de la barre ; la page en cours se remet à jour
ns.on("GROUP_ROSTER_UPDATE", function()
  if not (main and main:IsShown()) then return end
  local tab = ForeverRosterDB and ForeverRosterDB.tab
  if (tab == "enraid" or tab == "compo") and not U.NavVisible(tab) then U.Show("raids") return end
  U.Refresh()
end)
ns.on("BAG_UPDATE_DELAYED", function() if ForeverRosterDB and ForeverRosterDB.tab == "patrons" then U.Refresh() end end)

-- Alerte : patron suivi ou BiS ramassé (portrait : l'icône de l'objet)
local alert
function U.LootAlert(itemId, link)
  if not alert then
    alert = window("ForeverRosterLoot", L["Objet suivi ramassé"], 440, 150)
    alert:ClearAllPoints() alert:SetPoint("TOP", 0, -160)
    alert.text = alert:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    alert.text:SetPoint("TOPLEFT", 66, -34) alert.text:SetWidth(360) alert.text:SetJustifyH("LEFT")
    if site() then -- pas de portrait : l'icône de l'objet en grand à gauche
      alert.big = alert:CreateTexture(nil, "ARTWORK")
      alert.big:SetSize(40, 40) alert.big:SetPoint("TOPLEFT", 16, -38) alert.big:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    end
    alert.announce = button(alert, L["Annoncer au groupe"], 170, nil)
    alert.announce:SetPoint("BOTTOMLEFT", 16, 14)
    local close = button(alert, L["Fermer"], 110, function() alert:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -16, 14)
  end
  local G = ns.Group
  local who, bis = G.Who(itemId), G.Bis(itemId)
  local icon = (C_Item and C_Item.GetItemIconByID and C_Item.GetItemIconByID(itemId)) or (GetItemIcon and GetItemIcon(itemId))
  if icon then alert:SetIcon(icon) if alert.big then alert.big:SetTexture(icon) end end
  local lines = { link or G.linkFor(itemId, who and who.recipe) }
  if who then lines[#lines + 1] = G.joinNames(who.wanted) and (GREEN .. L("Patron recherché par %s", G.joinNames(who.wanted)) .. "|r") or (INK .. L["Patron que personne ne recherche."] .. "|r") end
  if who and G.joinNames(who.known, 5) then lines[#lines + 1] = INK .. L("Déjà connu par %s", G.joinNames(who.known, 5)) .. "|r" end
  if bis then lines[#lines + 1] = BLUE .. L("BiS de %s", G.joinNames(bis)) .. "|r" end
  alert.text:SetText(table.concat(lines, "\n"))
  alert.announce:SetScript("OnClick", function() G.Announce(itemId, link) alert:Hide() end)
  front(alert)
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
  quick = window("ForeverRosterQuick", "Forever Roster  ·  " .. L["Synchro rapide"], 460, 196)
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
    if text:find("FR[GR];") then
      if not text:match("END;%d+%s*$") then return end
      local ok, msg = U.LoadFromSite(text)
      self:SetText("")
      self:ClearFocus()
      if ok then
        quick.status:SetText(GREEN .. L("Chargé : %s.", msg) .. "|r")
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
      quick.status:SetText(GREEN .. L["Copié · Ctrl+V sur le site, sur n'importe quelle page."] .. "|r")
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

function U.Quick(all)
  if not quick then buildQuick() end
  if quick:IsShown() and all == nil then quick:Hide() return end
  quickGen = quickGen + 1
  local ok, value, included = pcall(ns.Export.Build, { all = all == true })
  if not ok then ns.print("|cffff6060" .. L("erreur (%s)", "export") .. "|r " .. tostring(value)) return end
  quick.value, quick.included = value, included
  local names = ns.Export.Names(included, colored)
  if #names > 0 then
    quick.status:SetText(L("%sVers le site|r : %s", GOLD, table.concat(names, ", ")) .. "\n" ..
      L["Ctrl+C pour copier, puis Ctrl+V sur le site."] .. "\n" .. INK .. L["Ou Ctrl+V ici pour coller ce que tu as copié sur le site."] .. "|r")
  else
    quick.status:SetText(INK .. L["Rien de nouveau à envoyer au site."] .. "|r\n" ..
      L["Ctrl+V ici pour coller ce que tu as copié sur le site (« Copier pour le jeu »)."])
  end
  local last = ForeverRosterDB.lastLoad
  quick.foot:SetText(INK .. (last and L("Données du site : %s", date("%d/%m %H:%M", last.at)) or L["Données du site : jamais chargées"]) .. "|r")
  quick.box:SetText(value)
  front(quick)
  quick:Show()
  quick.box:SetFocus()
  quick.box:HighlightText()
end


-- Rappel de raid à la connexion : un raid de tes groupes dans les 24 h, sans réponse (ni en jeu ni sur le site) →
-- petite fenêtre « Tu viens ? ». Un raid déjà répondu : une ligne dans le chat. /fr rappels coupe ou remet les rappels.
local function whenText(t)
  local d, now = date("*t", t), date("*t", time())
  local hm = date("%H:%M", t)
  if d.year == now.year and d.yday == now.yday then return d.hour >= 17 and L("ce soir %s", hm) or L("aujourd'hui %s", hm) end
  local tomorrow = date("*t", time() + 86400)
  if d.year == tomorrow.year and d.yday == tomorrow.yday then return L("demain %s", hm) end
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

-- Roster Companion : les 20 actualisations sans /reload sont utilisées, proposer de recharger l'interface (le jeu ne
-- l'autorise qu'après un clic). Fenêtre de l'addon plutôt que StaticPopup, qui toucherait l'interface de Blizzard.
-- goLabel : texte du bouton qui recharge (« Recharger » par défaut ; relais : « Envoyer au site », 1.6.3) ; « Plus tard »
-- ferme. La fenêtre s'agrandit avec le texte.
local reloadAsk
function U.AskReload(text, goLabel)
  if not reloadAsk then
    reloadAsk = window("ForeverRosterReload", "Forever Roster  ·  Roster Companion", 420, 150, ns.LOGO)
    reloadAsk.text = reloadAsk:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    reloadAsk.text:SetPoint("TOPLEFT", gapX(), -36) reloadAsk.text:SetWidth(402 - gapX()) reloadAsk.text:SetJustifyH("LEFT")
    local later = button(reloadAsk, L["Plus tard"], 110, function() reloadAsk:Hide() end)
    later:SetPoint("BOTTOMRIGHT", -16, 12)
    reloadAsk.go = button(reloadAsk, L["Recharger"], 120, function() reloadAsk:Hide() ns.Companion.Reload() end)
    reloadAsk.go:SetPoint("RIGHT", later, "LEFT", -8, 0)
  end
  reloadAsk.go:SetText(goLabel or L["Recharger"])
  reloadAsk.go:SetWidth(goLabel and 150 or 120)
  reloadAsk.text:SetText(text)
  reloadAsk:SetHeight(math.max(150, 90 + (reloadAsk.text.GetStringHeight and reloadAsk.text:GetStringHeight() or 0)))
  front(reloadAsk)
  reloadAsk:Show()
  return reloadAsk
end

-- Diagnostic du partage (/fr partage, 1.6.3) : ce que l'addon a reçu, partagé, confié ou relayé pendant la session, en texte
-- brut à copier. Une ligne par groupe chargé (Group.ShareLines), une ligne de réglages (partage, confier, relais et pourquoi
-- pas), les messages du raid de la session (1.7.3 : partis, renvoyés après un refus du jeu, abandonnés, en attente),
-- les morceaux compressés du partage (1.7.4),
-- puis le journal de la session (Share.Journal : « hh:mm:ss  texte », le plus ancien d'abord).
function U.ShareDiagText()
  local G, R, lines = ns.Group, ns.Relay, {}
  local function onOff(on) return on and L["activé"] or L["coupé"] end
  local groups = G.ShareLines()
  if #groups == 0 then lines[1] = L["Aucun groupe chargé."] else for _, line in ipairs(groups) do lines[#lines + 1] = line end end
  lines[#lines + 1] = ""
  local app = ns.Companion ~= nil and ns.Companion.Active()
  local settings = { L("Partage : %s", onOff(G.ShareOn())) }
  if R then
    settings[2] = L("Confier mes inscriptions : %s", onOff(R.ConfideOn()) .. " (" .. (app and L["appli active ici"] or L["pas d'appli ici"]) .. ")")
    local why = R.WhyNot()
    for i, reason in ipairs(why) do why[i] = L[reason] end
    settings[3] = L("Relais : %s", #why == 0 and L["oui"] or (L["non"] .. " (" .. table.concat(why, ", ") .. ")"))
  end
  lines[#lines + 1] = table.concat(settings, " · ")
  -- Messages du raid (conseil, jets, consommables, versions) : ce que la file a envoyé, renvoyé ou abandonné
  local RA = ns.Raid
  if RA and RA.stats then
    local s, waiting = RA.stats, RA.queue and #RA.queue or 0
    local text = L("Messages du raid : %d partis, %d renvoyés après un refus du jeu, %d abandonnés", s.sent, s.retried, s.dropped)
    if waiting > 0 then text = text .. L(", %d en attente", waiting) end
    lines[#lines + 1] = text
    -- Partage compressé (1.7.4) : morceaux partis sur les préfixes réservés, et bibliothèque de compression présente ou non
    if RA.bulkStats then
      local lib = LibStub and LibStub("LibDeflate", true)
      local z = lib and L("Partage compressé : %d morceau(x) parti(s)", RA.bulkStats.sent) or L["Partage compressé : impossible (LibDeflate absente), partage en clair"]
      local held = RA.bulkQueue and #RA.bulkQueue or 0
      if held > 0 then z = z .. L(", %d en attente", held) end
      lines[#lines + 1] = z
    end
  end
  -- Heure du serveur (GetServerTime, qui date les clics d'inscription) : son décalage avec l'horloge du PC, ou absente
  local okT, server = false, nil
  if GetServerTime then okT, server = pcall(GetServerTime) end
  if okT and type(server) == "number" then
    lines[#lines + 1] = L("Heure du serveur : décalage de %d s avec l'horloge du PC", math.floor(server - time() + 0.5))
  else
    lines[#lines + 1] = L["Heure du serveur : absente (horloge du PC utilisée)"]
  end
  lines[#lines + 1] = ""
  local journal = ns.Share and ns.Share.Journal and ns.Share.Journal() or {}
  if #journal == 0 then lines[#lines + 1] = L["Rien dans le journal de cette session."] end
  for _, e in ipairs(journal) do lines[#lines + 1] = date("%H:%M:%S", e.t) .. "  " .. e.text end
  return table.concat(lines, "\n")
end

-- Fenêtre du diagnostic : une zone de texte qu'on peut sélectionner, mais pas modifier (comme « Copier le relevé » de
-- /fr guilde). « Copier » sélectionne tout et donne le focus : Ctrl+C, puis on colle le texte à qui aide.
local shareWin
function U.ShowShareDiag()
  if not shareWin or shareWin.skin ~= site() then
    if shareWin then shareWin:Hide() end
    shareWin = window("ForeverRosterShare", "Forever Roster  ·  " .. L["Diagnostic du partage"], 600, 410)
    shareWin.skin = site()
    local win = shareWin
    win.hintText = win:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    win.hintText:SetPoint("TOPLEFT", gapX(), -34) win.hintText:SetWidth(580 - gapX()) win.hintText:SetJustifyH("LEFT")
    win.hintText:SetText(L["« Copier » sélectionne tout : Ctrl+C, puis colle le texte à qui t'aide. Le journal ne couvre que cette session."])
    win.box = textArea(win, 18, -72, 564, 270)
    win.box:SetScript("OnTextChanged", function(self, user) if user then self:SetText(win.value or "") self:HighlightText() end end)
    win.box:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
    win.box:SetScript("OnEscapePressed", function() win:Hide() end)
    local close = button(win, L["Fermer"], 110, function() win:Hide() end)
    close:SetPoint("BOTTOMRIGHT", -16, 12)
    local copy = button(win, L["Copier"], 110, function() win.box:SetFocus() win.box:HighlightText() end)
    copy:SetPoint("RIGHT", close, "LEFT", -8, 0)
  end
  shareWin.value = U.ShareDiagText()
  shareWin.box:SetText(shareWin.value)
  front(shareWin)
  shareWin:Show()
  shareWin.box:SetFocus()
  shareWin.box:HighlightText()
  return shareWin
end
-- La fenêtre du diagnostic (tests hors jeu)
function U.ShareWindow() return shareWin end

local reminder
local function buildReminder()
  reminder = window("ForeverRosterReminder", "Forever Roster  ·  Raid", 420, 168, "Interface\\Icons\\INV_Misc_Head_Dragon_01")
  reminder:ClearAllPoints() reminder:SetPoint("TOP", 0, -140)
  reminder.text = reminder:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  reminder.text:SetPoint("TOPLEFT", gapX(), -32) reminder.text:SetWidth(402 - gapX()) reminder.text:SetJustifyH("LEFT")
  -- 3 + Autre (refonte du 09/11) : Présent, Peut-être, Absent, puis « Autre... » (En retard, Reroll, Banc)
  local function answer(key)
    local e = reminder.entry
    if not e then return end
    ns.Group.SignUp(e.group.id, e.raid.id, key, e.raid.time)
    if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
    U.Refresh()
    U.Reminder(true, key, e)
  end
  reminder.answer = answer
  reminder.buttons = {}
  for i, spec in ipairs(U.AnswerButtons(nil, answer, 92)) do
    local b = statusButton(reminder)
    b:SetSize(92, 28)
    styleStatus(b, spec[1], spec[4].color, false)
    b:SetScript("OnClick", spec[3])
    b:SetPoint("BOTTOMLEFT", 16 + (i - 1) * 98, 48)
    reminder.buttons[i] = b
  end
  reminder.foot = reminder:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  reminder.foot:SetPoint("BOTTOMLEFT", 18, 18) reminder.foot:SetWidth(260) reminder.foot:SetJustifyH("LEFT")
  reminder.foot:SetText(INK .. L["Plus tard : ferme, je te le redemande à la prochaine connexion."] .. "|r")
  reminder.sync = button(reminder, L["Synchro rapide"], 120, function()
    reminder:Hide()
    if reminder.send then ns.Companion.Reload() else U.Quick(false) end
  end)
  reminder.sync:SetPoint("BOTTOMRIGHT", -16, 12)
  U.reminder = reminder
end

-- Retour après une réponse (refonte du 09/11) : coche + réponse à sa couleur, « noté pour … » ; la fenêtre se ferme seule
-- (pas tant que la souris est dessus). La coche est une texture du jeu : sa police n'a pas le caractère ✓.
local READY = "|TInterface\\RaidFrame\\ReadyCheck-Ready:0|t "
local function statusOf(key)
  for _, st in ipairs(ns.Group.STATUSES) do if st.key == key then return st end end
  for _, st in ipairs(ns.Group.OTHER) do if st.key == key then return st end end
end
local function closeSoon(delay)
  local token = {}
  reminder.token = token
  C_Timer.After(delay, function()
    if reminder.token ~= token or not reminder:IsShown() then return end
    if reminder.IsMouseOver and reminder:IsMouseOver() then closeSoon(2) return end
    reminder:Hide()
  end)
end
U.REMINDER_CLOSE = 10

-- after : appelé après une réponse (key, au raid done) : le retour, puis le raid suivant sans réponse (1,5 s après),
-- sinon l'invitation à envoyer au site, et la fenêtre se ferme seule
function U.Reminder(after, key, done)
  local ask = U.SoonRaids()
  if not reminder then buildReminder() end
  local e = ask[1]
  if after then
    if not reminder:IsShown() then return false end
    local st = statusOf(key)
    local fb = READY .. (st and (K.hex(st.color) .. L[st.label] .. "|r") or "") .. (done and (INK .. "  ·  " .. L("noté pour %s", done.raid.name) .. "|r") or "")
    reminder.entry = false
    for _, b in ipairs(reminder.buttons) do b:Hide() end
    if e then
      reminder.text:SetText(fb)
      reminder.foot:SetText("")
      local token = {}
      reminder.token = token
      C_Timer.After(1.5, function() if reminder.token == token and reminder:IsShown() then U.Reminder() end end)
      return false
    end
    -- Avec Roster Companion : l'inscription part au prochain rechargement de l'interface (le clic l'autorise)
    reminder.send = ns.Companion and ns.Companion.Active() or false
    if reminder.send then
      reminder.text:SetText(fb .. "\n" .. L["Pour que le site le sache tout de suite :\n« Envoyer maintenant » recharge l'interface, Roster Companion fait le reste."])
      reminder.sync:SetText(L["Envoyer maintenant"]) reminder.sync:SetWidth(160)
    else
      reminder.text:SetText(fb .. "\n" .. L["Pour que le site le sache :\nta touche de synchro (ou « Synchro rapide »), Ctrl+C, puis Ctrl+V sur le site."])
    end
    reminder.foot:SetText(INK .. L["Se ferme toute seule dans quelques secondes."] .. "|r")
    closeSoon(U.REMINDER_CLOSE)
    return false
  end
  if not e then return false end
  reminder.token = nil
  reminder.send = false
  reminder.sync:SetText(L["Synchro rapide"]) reminder.sync:SetWidth(120)
  reminder.entry = e
  local who = UnitName("player") or L["ce perso"]
  local more = #ask - 1
  reminder.text:SetText(GOLD .. e.raid.name .. "|r " .. whenText(e.raid.time) .. INK .. "  ·  " .. (e.group.name or "") .. "|r\n" ..
    L("Tu viens avec %s ?", who) .. (more > 0 and (INK .. "  " .. (more > 1 and L("(%d autres raids ensuite)", more) or L("(%d autre raid ensuite)", more)) .. "|r") or ""))
  for _, b in ipairs(reminder.buttons) do b:Show() end
  reminder.foot:SetText(INK .. L["Plus tard : ferme, je te le redemande à la prochaine connexion."] .. "|r")
  front(reminder)
  reminder:Show()
  return true
end

local function remindAtLogin()
  if ForeverRosterDB.noReminder then return end
  local _, known = U.SoonRaids()
  for _, e in ipairs(known) do
    local st = e.status or e.onSite
    ns.print(L("%s : %s.", GOLD .. e.raid.name .. "|r " .. whenText(e.raid.time), ns.Group.StatusLabel(st)))
  end
  U.Reminder()
end
ns.on("PLAYER_LOGIN", function() C_Timer.After(6, function() ns.safe(N("rappel de raid"), remindAtLogin) end) end)

-- Rappel de synchro dans le chat (1.6.6, refonte du 09/11) : une ligne, jamais une fenêtre qui s'ouvre seule. Une fois par
-- session, hors combat, 5 s après un changement d'équipement, si le perso connecté a déjà été envoyé au site et a changé
-- depuis (comme la pastille orange du site). Coupé dans les Options (ForeverRosterDB.noSyncNudge) ; rien avec Roster
-- Companion, qui envoie tout seul. Lien cliquable [Synchroniser] (synchro rapide) si le jeu connaît les liens d'addon
-- (LinkTypes.addon et l'événement « SetItemRef » d'EventRegistry, lus sans rien remplacer), sinon le geste en clair.
local NUDGE_LINK = "addon:ForeverRoster:sync" -- nolocale
local nudged, nudgeGen, nudgeAfterCombat, linkReady = false, 0, false, false
local function canLink()
  return type(LinkTypes) == "table" and LinkTypes.addon ~= nil and type(EventRegistry) == "table" and type(EventRegistry.RegisterCallback) == "function"
end
local function onLink(...)
  for i = 1, select("#", ...) do
    if select(i, ...) == NUDGE_LINK then ns.safe(N("synchro rapide"), U.Quick, false) return end
  end
end
function U.SyncNudge()
  if nudged or ForeverRosterDB.noSyncNudge then return false end
  if InCombatLockdown and InCombatLockdown() then nudgeAfterCombat = true return false end
  if ns.Companion and ns.Companion.Active() then return false end
  local c = ns.charDB()
  if not (c and c.sentAt and c.snapshot) or ns.Export.IsSent(c) then return false end
  nudged = true
  local how
  if canLink() then
    if not linkReady then linkReady = pcall(EventRegistry.RegisterCallback, EventRegistry, "SetItemRef", onLink, U) end
  end
  if linkReady then
    how = GOLD .. "|H" .. NUDGE_LINK .. "|h[" .. L["Synchro rapide"] .. "]|h|r"
  else
    local key = ns.Export.SyncKey()
    how = key and L("ta touche %s", GOLD .. key .. "|r") or L["clic droit sur le bouton FR de la minicarte"]
  end
  ns.print(L("équipement changé depuis ta dernière synchro : %s, Ctrl+C, puis Ctrl+V sur le site.", how))
  return true
end
ns.on("PLAYER_EQUIPMENT_CHANGED", function()
  if nudged then return end
  nudgeGen = nudgeGen + 1
  local gen = nudgeGen
  C_Timer.After(5, function() if gen == nudgeGen then ns.safe(N("rappel de synchro"), U.SyncNudge) end end)
end)
ns.on("PLAYER_REGEN_ENABLED", function()
  if not nudgeAfterCombat then return end
  nudgeAfterCombat = false
  C_Timer.After(2, function() ns.safe(N("rappel de synchro"), U.SyncNudge) end)
end)
-- Tests hors jeu : nouvelle session
function U.ResetNudge() nudged, nudgeAfterCombat = false, false end
