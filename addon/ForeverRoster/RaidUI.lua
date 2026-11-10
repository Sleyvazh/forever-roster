-- Fenêtres du raid (lot G) : butin du maître du butin, conseil du butin (réponse et votes), fiche du boss avant le pull,
-- et l'onglet « En raid » de la fenêtre principale. Les données et les messages sont dans Raid.lua.
local _, ns = ...
local L, N = ns.L, ns.N
local RA = ns.Raid
local U = ns.UI
local K = U.kit

local GOLD, INK, GREEN, RED, ORANGE, BLUE = "|cffe3b54b", "|cffece7d8", "|cff4fd35f", "|cffff6b5e", "|cfff0b43c", "|cff6fb7ff"
-- Gagnant du jet : l'étoile des marqueurs de raid (le caractère étoile n'existe pas dans la police du jeu)
local STAR = "|TInterface\\TargetingFrame\\UI-RaidTargetingIcon_1:0|t "
-- Lien à afficher : le vrai lien de l'objet, sinon celui construit en attendant que le jeu reçoive l'objet
local function linkFor(id, link, name, quality) return link or ns.Group.displayLink(id, name, quality) end
local function itemLink(it) return linkFor(it.itemId, it.link, it.name, it.quality) end
local function names(list, max)
  if #list == 0 then return nil end
  local shown = {}
  for i = 1, math.min(#list, max or 8) do shown[i] = list[i] end
  return table.concat(shown, ", ") .. (#list > #shown and (" +" .. (#list - #shown)) or "")
end
-- Date et heure d'un raid : « 08/10 21:00 » en français, « Wed Oct 8, 21:00 » en anglais
local function when(t)
  if ns.Lang() == "fr" then return date("%d/%m %H:%M", t) end
  return date("%a %b ", t) .. tonumber(date("%d", t)) .. date(", %H:%M", t)
end
local function remaining(at)
  local left = math.max(0, 2 * 3600 - (time() - at))
  return left >= 3600 and string.format("%d h %02d", math.floor(left / 3600), math.floor(left % 3600 / 60)) or string.format("%d min", math.floor(left / 60)), left
end

-- Page à liste dans une fenêtre (même mise en page que les onglets de la fenêtre principale)
local function listWindow(name, title, h)
  local w = K.window(name, title, 600, h)
  local p = CreateFrame("Frame", nil, w)
  p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
  w.hintText = K.hint(p, "")
  K.itemTips(p) -- objet en titre (jets en cours, essai)
  w.list = K.list(p, -40)
  return w
end
RA.listWindow = listWindow

--------------------------------------------------------------------------------------------------------------------
-- Boutons des fenêtres du raid (refonte du 09/11) : l'action principale en doré, les autres neutres et de même largeur,
-- « Annuler » en lien ; « Donner » toujours confirmé
--------------------------------------------------------------------------------------------------------------------
local GOLDC, INKC = K.C.gold, K.C.ink
local BW = 120
local function primary(label, fn, w, filled) return { label, w or BW, fn, { color = GOLDC, selected = filled or false } } end
local function neutral(label, fn, w) return { label, w or BW, fn } end
local function asLink(label, fn) return { label, 80, fn, { link = true } } end
-- Couleurs des réponses au conseil : les mêmes sur les boutons de « Ta réponse » et dans les pastilles du conseil
local RESP_COLOR = { bis = { 0.31, 0.83, 0.37 }, upgrade = { 0.435, 0.718, 1 }, off = { 0.94, 0.706, 0.235 }, transmo = INKC, pass = INKC }
RA.RESPONSE_COLOR = RESP_COLOR
local function respLabel(key) return RA.RESPONSES[key] and L[RA.RESPONSES[key]] or key end

-- Dialogue « Donner X à Y ? » : ce qui va se passer, un avertissement si ce n'est pas le premier du classement ;
-- Entrée = Donner, Échap = Annuler. o = { link, winner, what, warn, yes }
local giveWin
local function keyboard(f, on)
  -- Le jeu interdit de changer la propagation des touches en combat : Entrée y ouvre alors le chat, le clic reste
  if f.SetPropagateKeyboardInput and not (InCombatLockdown and InCombatLockdown()) then pcall(f.SetPropagateKeyboardInput, f, on) end
end
function RA.ConfirmGive(o)
  if not giveWin then
    local w = K.window("ForeverRosterGive", L["Donner l'objet"], 440, 170)
    w:ClearAllPoints() w:SetPoint("TOP", 0, -170)
    K.itemTips(w) -- l'objet de la question
    local x = K.gapX()
    w.ask = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightLarge")
    w.ask:SetPoint("TOPLEFT", x, -40) w.ask:SetWidth(440 - x - 18) w.ask:SetJustifyH("LEFT")
    w.what = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    w.what:SetPoint("TOPLEFT", w.ask, "BOTTOMLEFT", 0, -10) w.what:SetWidth(440 - x - 18) w.what:SetJustifyH("LEFT")
    w.warn = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    w.warn:SetPoint("TOPLEFT", w.what, "BOTTOMLEFT", 0, -8) w.warn:SetWidth(440 - x - 18) w.warn:SetJustifyH("LEFT")
    local function yes() local fn = w.yes w.yes = false w:Hide() if fn then fn() end end
    w.give = K.statusButton(w)
    w.give:SetSize(120, K.tall(24)) w.give:SetPoint("BOTTOMRIGHT", -16, 12)
    w.give:SetScript("OnClick", yes)
    w.cancel = K.button(w, L["Annuler"], 120, function() w:Hide() end)
    w.cancel:SetPoint("RIGHT", w.give, "LEFT", -8, 0)
    if w.EnableKeyboard then w:EnableKeyboard(true) end
    w:SetScript("OnKeyDown", function(self, key)
      if key == "ENTER" or key == "NUMPADENTER" then keyboard(self, false) yes()
      elseif key == "ESCAPE" then keyboard(self, false) self:Hide()
      else keyboard(self, true) end
    end)
    w:SetScript("OnShow", function(self) keyboard(self, true) end)
    w:SetScript("OnHide", function(self) self.yes = false keyboard(self, true) end)
    giveWin = w
  end
  local w = giveWin
  w:SetWindowTitle(L["Donner l'objet"])
  w.cancel:SetText(L["Annuler"])
  K.styleStatus(w.give, L["Donner"], GOLDC, true)
  w.ask:SetText(L("Donner %s à %s ?", o.link, "|cffffffff" .. o.winner .. "|r"))
  w.what:SetText(o.what and (INK .. o.what .. "|r") or "")
  w.warn:SetText(o.warn and (ORANGE .. o.warn .. "|r") or "")
  local function height(fs, on) return on and (((fs.GetStringHeight and fs:GetStringHeight()) or 14) + 10) or 0 end
  w:SetHeight(math.max(150, math.min(320, 100 + height(w.ask, true) + height(w.what, o.what) + height(w.warn, o.warn))))
  w.yes = o.yes
  K.front(w)
  w:Show()
  return w
end
RA.giveWindow = function() return giveWin end

--------------------------------------------------------------------------------------------------------------------
-- Butin (maître du butin)
--------------------------------------------------------------------------------------------------------------------
local lootWin
local KIND = { sr = N("soft reserve"), ms = N("spé principale (MS)"), os = N("spé secondaire (OS)"), free = N("jet libre") }
function RA.ShowLoot()
  if not lootWin then lootWin = listWindow("ForeverRosterMasterLoot", L["Butin · maître du butin"], 470) end
  lootWin:SetWindowTitle(L["Butin · maître du butin"])
  K.front(lootWin)
  lootWin:Show()
  RA.RefreshLoot()
end
RA.lootWindow = function() return lootWin end
function RA.RefreshLoot()
  if not lootWin or not lootWin:IsShown() then return end
  local li, d, s = lootWin.list, RA.Current(), RA.session
  local mode = d and d.loot or "journal"
  lootWin.hintText:SetText(d and (GOLD .. d.entry.raid.name .. "|r · " .. L("butin : %s", mode == "softres" and L["soft reserve"] or mode == "council" and L["conseil du butin"] or L["journal"]))
    or (INK .. L["Pas de raid du site en cours : jets libres ou MS / OS seulement."] .. "|r"))
  li.Reset()
  li.Header(L["Objets"])
  if #RA.items == 0 then li.Add(INK .. (RA.test and L["Aucun objet. Raid d'essai : « Ouvrir le corps » dans le panneau d'essai."] or L["Aucun objet. Ouvre un corps en maître du butin, ou /fr butin puis Maj+clic sur un objet."]) .. "|r") end
  for _, it in ipairs(RA.items) do
    local res, list = RA.ReservesOf(it.itemId)
    local text = itemLink(it) .. ((it.slot or it.test) and "" or (INK .. "  " .. L["(dans les sacs)"] .. "|r"))
    local reserved = mode == "softres" and res
    if reserved then
      local who = {}
      for _, x in ipairs(list) do who[#who + 1] = x.name .. ((x.bonus or 0) > 0 and (INK .. " +" .. x.bonus .. "|r") or "") end
      text = text .. "\n" .. GREEN .. L["SR :"] .. " |r" .. table.concat(who, ", ")
    elseif mode == "softres" then
      text = text .. "\n" .. INK .. L["Personne ne l'a réservé."] .. "|r"
    end
    -- Action principale selon le mode du raid, en doré : Conseil, Jets SR (objet réservé), sinon Jets MS / OS. Les autres
    -- restent proposées, neutres. Pendant des jets ou un conseil, l'action dorée est celle de la session (plus bas).
    local main = mode == "council" and "council" or reserved and "sr" or "ms"
    local acts = {}
    if reserved then acts[#acts + 1] = { "sr", L["Jets SR"], function() RA.StartRoll(it, "sr") end } end
    acts[#acts + 1] = { "council", L["Conseil"], function() RA.StartCouncil(it) end }
    acts[#acts + 1] = { "ms", L["Jets MS / OS"], function() RA.StartRoll(it, "ms") end }
    acts[#acts + 1] = { "free", L["Jet libre"], function() RA.StartRoll(it, "free") end }
    local buttons = {}
    for _, a in ipairs(acts) do buttons[#buttons + 1] = (a[1] == main and not s) and primary(a[2], a[3]) or neutral(a[2], a[3]) end
    li.Add(text, buttons)
  end
  if s and s.kind == "council" then
    li.Header(L["Conseil en cours"])
    li.Add(itemLink(s.item), { neutral(L["Fenêtre du conseil"], function() RA.ShowCouncil(s.sid) end, 170), asLink(L["Annuler"], function() RA.session = nil RA.RefreshWindows() end) })
  elseif s then
    li.Header(L("Jets · %s", KIND[s.kind] and L[KIND[s.kind]] or s.kind))
    local list, tied = RA.Ranking(s)
    li.Add(itemLink(s.item) .. INK .. "  " .. (s.kind == "sr" and L("/roll %d, bonus SR+ ajouté", s.max) or ("/roll " .. s.max)) .. "|r")
    if #list == 0 then li.Add(INK .. L["En attente des jets..."] .. "|r") end
    for i, x in ipairs(list) do
      li.Add((i == 1 and not tied and (STAR .. GOLD) or "") .. x.name .. "|r  " .. x.roll .. (s.kind == "sr" and (INK .. " +" .. x.bonus .. " = |r" .. x.total) or ""))
    end
    for n, r in pairs(s.ignored) do li.Add(INK .. L("%s  %d : pas de réservation, ignoré", n, r) .. "|r") end
    local buttons = {}
    if #list > 0 and not tied then
      local w = list[1].name
      buttons[#buttons + 1] = primary(L("Donner à %s", w), function()
        RA.ConfirmGive({ link = itemLink(s.item), winner = w, what = RA.GiveConsequence(s.item, w), yes = function()
          if not RA.AwardSession(w) then
            ns.print(L["le classement a changé pendant la confirmation : regarde la fenêtre du butin, puis donne de nouveau."])
            RA.RefreshLoot()
          end
        end })
      end, 180, true)
      buttons[#buttons + 1] = neutral(L["Garder, à remettre"], function()
        RA.Keep(s.item, w, s.kind == "sr" and "sr" or "roll", nil, RA.RollDetail(s, list[1]))
      end, 160)
    end
    if tied then buttons[#buttons + 1] = primary(L("Relancer : %s", table.concat(tied, ", ")), function() RA.StartRoll(s.item, s.kind, tied) end, 260, true) end
    if s.kind == "ms" and #list == 0 then buttons[#buttons + 1] = neutral(L["Passer aux jets OS"], function() RA.StartRoll(s.item, "os") end, 160) end
    buttons[#buttons + 1] = asLink(L["Annuler"], function() RA.session = nil RA.RefreshWindows() end)
    li.Add(INK .. L["Égalité : seuls les ex æquo relancent. Corps fermé : l'objet part dans les objets à remettre."] .. "|r", buttons)
  end
  li.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Conseil du butin : « Ta réponse » (refonte du 09/11) : l'objet en grand, ce que tu portes en icônes (détail au
-- survol), compteur 1 / 3, précision facultative, 4 réponses de même largeur aux couleurs du conseil, « Passer » à part
--------------------------------------------------------------------------------------------------------------------
local ask
local answered = 0 -- réponses données depuis que la file était vide (compteur « 1 / 3 »)
local ASK_W = 520
local function iconOf(id)
  local icon = id and select(5, ns.ItemInfoInstant(id))
  return icon or "Interface\\Icons\\INV_Misc_QuestionMark"
end
-- Icône d'objet : infobulle du jeu au survol (avec la comparaison du jeu, Maj enfoncée)
local function itemIcon(parent, size)
  local b = CreateFrame("Button", nil, parent)
  b:SetSize(size, size)
  b.tex = b:CreateTexture(nil, "ARTWORK") b.tex:SetAllPoints() b.tex:SetTexCoord(0.08, 0.92, 0.08, 0.92)
  K.edges(b, K.C.line2)
  b:SetScript("OnEnter", function(self)
    if not GameTooltip or not self.itemId then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT") GameTooltip:SetHyperlink("item:" .. self.itemId) GameTooltip:Show()
  end)
  b:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  return b
end
local function setIcon(b, id) b.itemId = id b.tex:SetTexture(iconOf(id)) end

local function buildAsk()
  ask = K.window("ForeverRosterAsk", L["Conseil du butin · ta réponse"], ASK_W, 226)
  ask:ClearAllPoints() ask:SetPoint("TOP", 0, -140)
  K.itemTips(ask) -- objet proposé (lien)
  local x = K.gapX()
  ask.icon = itemIcon(ask, 40) ask.icon:SetPoint("TOPLEFT", x, -38)
  ask.item = ask:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  ask.item:SetPoint("TOPLEFT", x + 50, -40) ask.item:SetPoint("RIGHT", ask, "RIGHT", -80, 0) ask.item:SetJustifyH("LEFT")
  ask.by = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  ask.by:SetPoint("TOPLEFT", x + 50, -62) ask.by:SetPoint("RIGHT", ask, "RIGHT", -18, 0) ask.by:SetJustifyH("LEFT")
  ask.count = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  ask.count:SetPoint("TOPRIGHT", -18, -42) ask.count:SetJustifyH("RIGHT")
  ask.wears = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  ask.wears:SetPoint("TOPLEFT", x, -96) ask.wears:SetJustifyH("LEFT")
  ask.worn = { itemIcon(ask, 28), itemIcon(ask, 28) }
  ask.noteLabel = ask:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  ask.noteLabel:SetPoint("TOPLEFT", x, -126) ask.noteLabel:SetJustifyH("LEFT")
  ask.note = CreateFrame("EditBox", nil, ask, "InputBoxTemplate")
  ask.note:SetSize(ASK_W - x - 26, 22) ask.note:SetPoint("TOPLEFT", x + 4, -144) ask.note:SetAutoFocus(false) ask.note:SetMaxLetters(80)
  ask.note:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  ask.note:SetScript("OnEnterPressed", function(self) self:ClearFocus() end)
  local function respond(key)
    local cur = RA.asks[1]
    if not cur then return end
    RA.Respond(cur, key, ask.note:GetText())
    answered = answered + 1
    ask.note:SetText("")
    RA.ShowAsk()
  end
  ask.buttons = {}
  for i, key in ipairs({ "bis", "upgrade", "off", "transmo" }) do
    local b = K.statusButton(ask)
    b.key = key
    b:SetSize(88, K.tall(24)) b:SetPoint("TOPLEFT", x + (i - 1) * 94, -182)
    b:SetScript("OnClick", function() respond(key) end)
    ask.buttons[i] = b
  end
  ask.pass = K.button(ask, L["Passer"], 88, function() respond("pass") end)
  ask.pass:SetPoint("TOPRIGHT", -18, -182)
end
function RA.ShowAsk()
  local a = RA.asks[1]
  if not a then answered = 0 if ask then ask:Hide() end return end
  if not ask then buildAsk() end
  -- Textes posés à chaque affichage (langue de l'interface)
  ask:SetWindowTitle(L["Conseil du butin · ta réponse"])
  for _, b in ipairs(ask.buttons) do K.styleStatus(b, respLabel(b.key), RESP_COLOR[b.key], false) end
  ask.pass:SetText(respLabel("pass"))
  setIcon(ask.icon, a.itemId)
  ask.item:SetText(linkFor(a.itemId))
  ask.by:SetText(INK .. L("Proposé par %s", a.ml) .. "|r")
  local total = answered + #RA.asks
  ask.count:SetText(total > 1 and (INK .. (answered + 1) .. " / " .. total .. "|r") or "")
  local gear = RA.Equipped(a.itemId)
  ask.wears:SetText(#gear > 0 and L["Tu portes :"] or (INK .. L["Rien de porté à cet emplacement."] .. "|r"))
  for i, b in ipairs(ask.worn) do
    if gear[i] then
      setIcon(b, gear[i])
      b:ClearAllPoints() b:SetPoint("LEFT", ask.wears, "RIGHT", 8 + (i - 1) * 34, 0)
      b:Show()
    else
      b:Hide()
    end
  end
  ask.noteLabel:SetText(L["Une précision ? (facultatif)"])
  K.front(ask)
  ask:Show()
end
RA.askWindow = function() return ask end

local councilWin
-- Conseil du butin (lot I) : un tableau, une ligne par joueur, fenêtre redimensionnable (taille mémorisée)
-- Intitulés des colonnes : traduits à l'affichage (RA.RefreshCouncil). Réponse en pastille (refonte du 09/11)
local COUNCIL_COLS = {
  { title = N("Joueur"), w = 150 },
  { title = N("Réponse"), w = 96, pill = true },
  { title = N("Porte"), flex = 1.4, min = 150, small = true, lines = 2, tip = true },
  { title = N("Précision"), flex = 1, min = 100, small = true, lines = 2, tip = true },
  { title = N("Reçus"), w = 96, justify = "CENTER", tip = true },
  { title = N("Voix"), flex = 0.8, min = 100, small = true, lines = 2 },
  { title = "", w = 180, buttons = true },
}
local RECV_COL = 5
function RA.ShowCouncil(sid)
  if not councilWin then
    local w = K.window("ForeverRosterCouncil", L["Conseil du butin"], 980, 420)
    local p = CreateFrame("Frame", nil, w)
    p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
    -- En-tête sur deux lignes (refonte du 09/11) : l'objet en grand, le maître du butin dessous, les compteurs à droite
    w.item = p:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    w.item:SetPoint("TOPLEFT", 6, 0) w.item:SetPoint("RIGHT", p, "RIGHT", -300, 0) w.item:SetJustifyH("LEFT")
    if w.item.SetWordWrap then w.item:SetWordWrap(false) end
    w.counts = p:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    w.counts:SetPoint("TOPRIGHT", -10, -2) w.counts:SetJustifyH("RIGHT")
    w.ml = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.ml:SetPoint("TOPLEFT", 6, -22) w.ml:SetPoint("RIGHT", p, "RIGHT", -10, 0) w.ml:SetJustifyH("LEFT")
    K.itemTips(p) -- objet du conseil, en titre
    w.grid = K.grid(p, -46, 44, COUNCIL_COLS)
    w.foot = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.foot:SetPoint("BOTTOMLEFT", 8, 4) w.foot:SetPoint("BOTTOMRIGHT", -26, 4)
    w.foot:SetJustifyH("LEFT")
    K.resizable(w, "council", 720, 280, 1600, 1000, function() if councilWin and councilWin.grid then councilWin.grid.Layout() end end)
    councilWin = w
  end
  councilWin.sid = sid
  councilWin:SetWindowTitle(L["Conseil du butin"])
  K.front(councilWin)
  councilWin:Show()
  RA.RefreshCouncil()
end
RA.councilWindow = function() return councilWin end

-- Objets reçus par un joueur : compte du site sur la période du groupe (ses persos ensemble si le groupe compte par joueur)
-- plus ceux de ce soir pas encore sur le site, avec la même règle (spé principale)
function RA.LootCounts(l)
  if l.method == "council" and (l.response == "off" or l.response == "transmo") then return false end
  if l.method == "roll" then
    local d = ns.text(l.detail)
    if d:match("^OS") or d:match("^jet") then return false end
  end
  return true
end
function RA.Received(name, d)
  local c = d and d.counts
  local e = c and c.byName and c.byName[name]
  local names = e and e.names or { name }
  local log = RA.test and RA.test.log or ns.Recorder.Current()
  local tonight = 0
  for _, l in ipairs(log and log.loot or {}) do
    for _, n in ipairs(names) do if l.who == n and RA.LootCounts(l) then tonight = tonight + 1 end end
  end
  return e and e.n or 0, tonight, c, names
end

-- « Donner » au conseil : confirmé, avec un avertissement si le joueur n'est pas premier du classement du tableau
local function giveCouncil(sid, c, name)
  local first = RA.CouncilRanking(sid)[1]
  local warn
  if first and first.name ~= name then
    warn = L("Attention : %s est premier du classement (%s, %s).", first.name, respLabel(first.x.response), L("%d voix", first.votes))
  end
  local s = RA.session
  RA.ConfirmGive({ link = linkFor(c.itemId, c.link, c.name, c.quality), winner = name, warn = warn,
    what = (s and s.sid == sid) and RA.GiveConsequence(s.item, name) or nil,
    yes = function() RA.AwardCouncil(sid, name) end })
end

function RA.RefreshCouncil()
  if not councilWin or not councilWin:IsShown() then return end
  local sid = councilWin.sid
  local c, G, d = RA.councils[sid], councilWin.grid, RA.Current()
  for i, col in ipairs(COUNCIL_COLS) do if col.title ~= "" then G.SetTitle(i, L[col.title]) end end
  G.Reset()
  if not c then
    councilWin.item:SetText(INK .. L["Ce conseil est terminé."] .. "|r")
    councilWin.ml:SetText("") councilWin.counts:SetText("") councilWin.foot:SetText("")
    G.Done()
    return
  end
  local me = UnitName("player")
  local isML = c.ml == me
  local _, by = RA.Tally(sid)
  local counts = d and d.counts
  G.SetTitle(RECV_COL, counts and L("Reçus · %s", counts.short) or L["Reçus ce soir"])
  local list = RA.CouncilRanking(sid) -- BiS, Upgrade, Off-Spec, Transmo, puis « Passer » en bas
  local voters = {}
  for voter, cand in pairs(c.votes) do voters[cand] = voters[cand] or {} table.insert(voters[cand], voter) end
  local waiting = {}
  for _, n in ipairs(RA.Members()) do if not c.cands[n] then waiting[#waiting + 1] = n end end
  local council, mlIn = RA.CouncilNames(), false
  for _, n in ipairs(council) do if n == c.ml then mlIn = true end end
  local nCouncil = #council + (mlIn and 0 or 1)
  councilWin.item:SetText(linkFor(c.itemId, c.link, c.name, c.quality))
  councilWin.ml:SetText(INK .. L("Maître du butin : %s", c.ml) .. (isML and (" " .. L["(toi)"]) or "") .. "|r")
  councilWin.counts:SetText(L("Réponses %d/%d", #list, #list + #waiting) .. INK .. "  ·  |r" .. L("Voix %d/%d", #by, math.max(nCouncil, #by)))
  for _, e in ipairs(list) do
    local whispered = e.x.note == "chuchoté" -- nolocale (marque interne de Raid.lua)
    local gear = {}
    for _, id in ipairs(e.x.gear) do gear[#gear + 1] = linkFor(id) end
    local who = d and d.roster and d.roster[e.name]
    local resp = e.x.response
    local color = RESP_COLOR[resp] or INKC
    local site, tonight = RA.Received(e.name, d)
    local vs = voters[e.name] or {}
    table.sort(vs)
    local mine = c.votes[me] == e.name
    local buttons = {}
    if resp ~= "pass" then
      -- Voter / Donner de même largeur ; « Voté » en état choisi (un second clic retire la voix)
      buttons[#buttons + 1] = { mine and L["Voté"] or L["Voter"], 86, function() RA.Vote(sid, e.name) end, { color = INKC, selected = mine } }
      if isML then buttons[#buttons + 1] = { L["Donner"], 86, function() giveCouncil(sid, c, e.name) end } end
    end
    G.Row({
      (who and who.role and (K.roleIcon(who.role) .. " ") or "") .. GOLD .. e.name .. "|r",
      K.hex(color) .. respLabel(resp) .. "|r",
      whispered and (INK .. L["réponse chuchotée"] .. "|r") or (#gear > 0 and table.concat(gear, "\n") or (INK .. L["rien à cet emplacement"] .. "|r")),
      (not whispered and e.x.note ~= "") and ("|cffc9cfdb" .. L("« %s »", e.x.note) .. "|r") or "",
      tostring(site + tonight) .. (tonight > 0 and (INK .. " (+" .. tonight .. ")|r") or ""),
      #vs > 0 and ("|cffffffff" .. #vs .. "|r " .. INK .. table.concat(vs, ", ") .. "|r") or (INK .. "0|r"),
    }, {
      buttons = buttons, dim = resp == "pass", height = 36, pills = { [2] = color },
      tip = function(col, owner)
        if not GameTooltip then return end
        GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
        if col == 3 and e.x.gear[1] then
          GameTooltip:SetHyperlink("item:" .. e.x.gear[1])
          for k = 2, #e.x.gear do GameTooltip:AddLine(L("et %s", linkFor(e.x.gear[k]))) end
        elseif col == 4 and e.x.note ~= "" and not whispered then
          GameTooltip:SetText(e.name) GameTooltip:AddLine(e.x.note, 1, 1, 1, true)
        elseif col == RECV_COL then
          GameTooltip:SetText(L("%s : objets reçus", e.name))
          if counts then GameTooltip:AddLine(L("%d sur le site, %s", site, counts.label), 1, 1, 1, true)
          else GameTooltip:AddLine(L["Données du site non chargées : colle-les dans l'onglet Synchro."], 1, 1, 1, true) end
          GameTooltip:AddLine(L("%d ce soir (pas encore sur le site)", tonight), 1, 1, 1, true)
          GameTooltip:AddLine(L["Spé principale : soft reserve, jets MS, conseil BiS / Upgrade."], 0.6, 0.64, 0.71, true)
        else
          return
        end
        GameTooltip:Show()
      end,
    })
  end
  if #list == 0 then G.Row({ INK .. L["En attente..."] .. "|r", "", INK .. L["Les réponses arrivent ici au fil de l'eau."] .. "|r" }, { height = 36 }) end
  G.Done()
  councilWin.foot:SetText((#waiting > 0 and (INK .. L["Pas encore répondu :"] .. " |r" .. table.concat(waiting, ", ")) or (INK .. L["Tout le monde a répondu."] .. "|r"))
    .. "\n" .. INK .. L["Survol : objet porté, précision, détail des objets reçus."] .. (isML and (" " .. L["« Donner » demande confirmation."]) or "") .. "|r")
  -- Hauteur selon le nombre de réponses, tant que la fenêtre n'a pas été redimensionnée à la main
  if not (ForeverRosterDB.sizes and ForeverRosterDB.sizes.council) then
    councilWin:SetHeight(math.max(300, math.min(660, 160 + 36 * math.max(#list, 3))))
  end
end

--------------------------------------------------------------------------------------------------------------------
-- Fiche du boss (refonte du 09/11) : en ciblant le boss avant le pull, un bandeau compact « Ta tâche » (rien pour un
-- membre sans tâche) ; « Voir la fiche » ou /fr boss : la fiche entière. « Annoncer en /raid » pour le chef de raid.
--------------------------------------------------------------------------------------------------------------------
local sheetWin
local function buildSheet()
  local w = K.window("ForeverRosterBoss", "Boss", 400, 120)
  w:ClearAllPoints() w:SetPoint("TOP", 0, -110)
  local x = K.gapX()
  w.mine = w:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  w.mine:SetPoint("TOPLEFT", x, -38) w.mine:SetJustifyH("LEFT")
  w.text = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  w.text:SetPoint("TOPLEFT", w.mine, "BOTTOMLEFT", 0, -10) w.text:SetJustifyH("LEFT")
  w.more = K.button(w, L["Voir la fiche"], 130, function() if w.sheet then RA.ShowSheet(w.sheet, true) end end)
  w.announce = K.button(w, L["Annoncer en /raid"], 160, nil)
  -- Fermée par le joueur : plus proposée pendant 5 min ; fermée au pull (RA.HideSheet) : de nouveau au prochain ciblage
  w.auto = false
  w:SetScript("OnHide", function(self) if self.sheet and not self.auto then RA.dismissed[self.sheet.name] = time() end self.auto = false end)
  return w
end
function RA.ShowSheet(sheet, full)
  local mine = RA.MyTasks(sheet)
  local leader = RA.isLeader()
  if not full then
    if #mine == 0 and not leader then return false end
    -- Fiche entière déjà ouverte sur ce boss : elle reste
    if sheetWin and sheetWin:IsShown() and sheetWin.full and sheetWin.sheet == sheet then return true end
  end
  if not sheetWin then sheetWin = buildSheet() end
  local w, x = sheetWin, K.gapX()
  local width = full and 460 or 400
  w:SetWidth(width)
  w.mine:SetWidth(width - x - 18) w.text:SetWidth(width - x - 18)
  w.sheet, w.full = sheet, full and true or false
  w:SetWindowTitle(full and L("%s · fiche du boss", sheet.name) or L("%s · ta tâche", sheet.name))
  w.more:SetText(L["Voir la fiche"]) w.announce:SetText(L["Annoncer en /raid"])
  w.mine:SetText(#mine > 0 and ("|cffffffff" .. table.concat(mine, " · ") .. "|r") or (INK .. L["Pas de tâche pour toi"] .. "|r"))
  w.announce:ClearAllPoints()
  if full then
    local lines = {}
    for _, l in ipairs(RA.SheetLines(sheet)) do lines[#lines + 1] = (l.label ~= "" and (INK .. L("%s :", l.label) .. " |r") or "") .. l.value end
    w.text:SetText(table.concat(lines, "\n") .. "\n" .. INK .. L["Se ferme au début du combat · /fr boss pour la revoir"] .. "|r")
    w.text:Show() w.more:Hide()
    w.announce:SetPoint("BOTTOMLEFT", x, 12)
  else
    w.text:SetText("") w.text:Hide()
    w.more:ClearAllPoints() w.more:SetPoint("BOTTOMLEFT", x, 12) w.more:Show()
    w.announce:SetPoint("LEFT", w.more, "RIGHT", 8, 0)
  end
  w.announce:SetScript("OnClick", function() RA.AnnounceSheet(sheet) end)
  if leader then w.announce:Show() else w.announce:Hide() end
  local mineH = (w.mine.GetStringHeight and w.mine:GetStringHeight()) or 20
  local textH = full and (((w.text.GetStringHeight and w.text:GetStringHeight()) or 60) + 10) or 0
  local buttonsH = (full and not leader) and 16 or 56
  w:SetHeight(math.max(full and 150 or 100, math.min(460, 38 + mineH + textH + buttonsH)))
  K.front(w)
  w:Show()
  return true
end
function RA.HideSheet() if sheetWin and sheetWin:IsShown() then sheetWin.auto = true sheetWin:Hide() end end
-- /fr boss : la fiche entière du boss ciblé, sinon la première du raid
function RA.ShowSheetCommand()
  local s = RA.SheetFor("target") or RA.Sheets()[1]
  if not s then ns.print(L["aucune fiche de boss pour ce raid (sur le site : page du raid, onglet Préparation, puis synchro)."]) return end
  RA.dismissed[s.name] = nil
  RA.ShowSheet(s, true)
end
RA.sheetWindow = function() return sheetWin end

--------------------------------------------------------------------------------------------------------------------
-- Onglet « En raid »
--------------------------------------------------------------------------------------------------------------------
function RA.FillTab(li)
  local d = RA.Current()
  if RA.test then
    li.Header(L["Raid d'essai"])
    li.Add(ORANGE .. L["Joueurs fictifs : rien ne part au site, au chat du raid ni aux autres joueurs."] .. "|r",
      { { L["Panneau d'essai"], 140, function() RA.ShowTest() end }, { L["Quitter l'essai"], 130, function() RA.StopTest() end } })
  end
  li.Header("Raid")
  if d then
    local e = d.entry
    li.Add(GOLD .. e.raid.name .. "|r  " .. (e.raid.time > 0 and when(e.raid.time) or "") .. INK .. "  · " .. e.group.name
      .. (ns.Recorder.Current() and ("  · " .. L["relevé en cours"]) or "") .. (RA.IsMasterLooter() and ("  · " .. L["tu es maître du butin"]) or "") .. "|r",
      { { L["Fenêtre du butin"], 150, function() RA.ShowLoot() end } })
  else
    li.Add(INK .. L["Pas de raid du site dans les 2 h : charge les données du site (onglet Synchro) avant le raid."] .. "|r", { { L["Fenêtre du butin"], 150, function() RA.ShowLoot() end } })
  end
  if not RA.test and not (IsInGroup and IsInGroup()) then
    li.Add(INK .. L["Pour tout essayer seul (butin, conseil, fiches, consommables) : un raid fictif de 10 joueurs."] .. "|r", { { L["Raid d'essai"], 120, function() RA.StartTest() end } })
  end

  if (IsInGroup and IsInGroup()) or RA.test then
    local rows = RA.VersionRows()
    local ok, old, none, wait = {}, {}, {}, {}
    for _, r in ipairs(rows) do
      if r.state == "ok" then ok[#ok + 1] = r.name elseif r.state == "old" then old[#old + 1] = r.name .. " (" .. r.v .. ")" elseif r.state == "none" then none[#none + 1] = r.name else wait[#wait + 1] = r.name end
    end
    li.Header(L("Addon dans le raid · %d/%d", #ok + #old, #rows))
    if #ok > 0 then li.Add(GREEN .. L["À jour :"] .. " |r" .. names(ok, 10)) end
    if #old > 0 then li.Add(ORANGE .. L["À mettre à jour :"] .. " |r" .. table.concat(old, ", ") .. INK .. "\n" .. L["Ancienne version : ni conseil du butin ni appel aux consommables."] .. "|r") end
    if #none > 0 then li.Add(RED .. L["Pas d'addon :"] .. " |r" .. table.concat(none, ", ") .. INK .. "\n" .. L["Ils peuvent toujours /roll, ou chuchoter leur réponse au conseil."] .. "|r") end
    if #wait > 0 then li.Add(INK .. L("En attente de réponse : %s", names(wait, 10)) .. "|r") end
    li.Add(INK .. L["La question part à l'arrivée dans un raid."] .. "|r", { { L["Redemander"], 120, function() RA.AskVersions(true) C_Timer.After(5, function() ns.UI.Refresh() end) ns.UI.Refresh() end } })
  end

  local list = d and d.consumables or {}
  li.Header(L["Consommables"])
  if #list == 0 then
    li.Add(INK .. L["Aucun consommable demandé pour ce raid (site : page du raid, onglet Préparation)."] .. "|r")
  else
    local want = {}
    for _, c in ipairs(list) do want[#want + 1] = L("%s ×%d", c.name ~= "" and c.name or L("objet %d", c.itemId), c.n) end
    li.Add(INK .. L["Demandé :"] .. " |r" .. table.concat(want, ", "))
    local s = RA.CallSummary()
    if s then
      li.Add(L("Appel de %s%s|r par %s : %s%d prêt(s)|r · %s%d incomplet(s)|r · %s%d sans réponse|r%s", GOLD, date("%H:%M", RA.call.at), RA.call.by,
        GREEN, #s.ready, ORANGE, #s.missing, RED, #s.silent, RA.call.open and (INK .. " " .. L["(réponses en cours)"] .. "|r") or ""))
      for _, m in ipairs(s.missing) do
        local who = d.roster[m.name]
        li.Add((who and who.role and (K.roleIcon(who.role) .. " ") or "") .. m.name .. "  " .. INK .. table.concat(m.lacks, ", ") .. "|r")
      end
      if #s.silent > 0 then li.Add(RED .. L["Sans réponse :"] .. " |r" .. names(s.silent, 12)) end
    end
    local buttons = {}
    if RA.isLeader() then buttons[#buttons + 1] = { L["Appel aux consommables"], 200, function() RA.CallConsumables() end } end
    if s and RA.isLeader() then buttons[#buttons + 1] = { L["Annoncer les manques"], 180, function() RA.AnnounceMissing() end } end
    li.Add(INK .. L["Chaque addon répond avec ce qu'il a dans ses sacs ; le résultat part au site avec ta synchro."] .. "|r", buttons)
  end

  local hand = RA.Handover()
  li.Header(L("Objets à remettre · %d", #hand))
  if #hand == 0 then li.Add(INK .. L["Aucun. « Garder, à remettre » dans la fenêtre du butin les ajoute ici."] .. "|r") end
  for _, h in ipairs(hand) do
    local left, secs = remaining(h.at)
    li.Add(L("%s pour %s", linkFor(h.itemId, h.link, h.name, h.quality), GOLD .. h.winner .. "|r") .. "  " .. (secs < 1800 and ORANGE or INK) .. L("%s pour l'échanger", left) .. "|r",
      { { L["Échanger"], 110, function() RA.Trade(h) end }, { L["Retirer"], 90, function()
        local all = RA.Handover()
        for i = #all, 1, -1 do if all[i] == h then table.remove(all, i) end end
        ns.UI.Refresh()
      end } })
  end

  local sheets = RA.Sheets()
  li.Header(L("Fiches de boss · %d", #sheets))
  if #sheets == 0 then li.Add(INK .. L["Aucune fiche pour ce raid (site : onglet Préparation du raid)."] .. "|r")
  else
    local mine = {}
    for _, s in ipairs(sheets) do local t = RA.MyTasks(s) if #t > 0 then mine[#mine + 1] = L("%s :", s.name) .. " " .. table.concat(t, ", ") end end
    li.Add((#mine > 0 and L("Tes tâches : %s", table.concat(mine, " · ")) or INK .. L["Pas de tâche pour toi."] .. "|r") .. "\n" .. INK .. L["En ciblant le boss avant le pull : ta tâche en bandeau, la fiche entière d'un clic."] .. "|r",
      { { L["Voir une fiche"], 140, function() RA.ShowSheetCommand() end } })
  end
end

-- Un objet arrive du serveur (premier affichage) : les fenêtres reprennent son vrai nom
local itemsDue = false
local function itemArrived()
  if itemsDue then return end
  itemsDue = true
  C_Timer.After(0.3, function()
    itemsDue = false
    RA.RefreshWindows()
    if ask and ask:IsShown() then RA.ShowAsk() end
    if ns.UI.Refresh then ns.UI.Refresh() end
  end)
end
ns.on("GET_ITEM_INFO_RECEIVED", itemArrived)
ns.on("ITEM_DATA_LOAD_RESULT", itemArrived) -- clients récents (C_Item.RequestLoadItemDataByID)

function RA.RefreshWindows()
  ns.safe(L["butin"], RA.RefreshLoot)
  ns.safe(L["conseil"], RA.RefreshCouncil)
  if ns.Test then ns.safe(L["essai"], ns.Test.Refresh) end
end
