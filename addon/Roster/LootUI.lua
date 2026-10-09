-- Fenêtres de la distribution du butin (lot R3b, retours du raid de test 0.3) : butin du chef de butin (/roster butin),
-- conseil du butin (réponses et votes), réponse de chaque joueur, objets à remettre. Réponse et conseil : une bande
-- d'objets en haut pour passer d'un objet à l'autre. Le moteur est dans Loot.lua ; boîte à outils : addon/shared/Kit.lua
-- (deux habillages, tailles mémorisées). Les attributions partent toujours d'un clic (annonce et chuchotement).
local _, ns = ...
local U = {}
ns.LootUI = U
local K, F = ns.Kit, ns.Format

local GOLD, GREY, GREEN, RED, ORANGE, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cffff6b5e", "|cfff0b43c", "|cff6fb7ff"
local WHITE = "|cffffffff"
-- Gagnant des jets : l'étoile des marqueurs de raid (le caractère étoile n'existe pas dans la police du jeu) ;
-- réponse donnée, conseil terminé : la coche de l'appel « prêt »
local STAR = "|TInterface\\TargetingFrame\\UI-RaidTargetingIcon_1:0|t "
local CHECK = "|TInterface\\RaidFrame\\ReadyCheck-Ready:14|t"
local RESP_COLOR = { bis = GREEN, upgrade = BLUE, off = GREY, transmo = GREY, pass = GREY }
local RESP_INITIAL = { bis = "B", upgrade = "U", off = "O", transmo = "T", pass = "P" }
U.state = {} -- ce que chaque fenêtre affiche (tests hors jeu)

local function Lo() return ns.Loot end
local function name(full) return F.Display(full) end
local function who(full)
  local m = Lo().Member(full)
  return K.colored(m and m.class, name(full))
end
-- Prénom seul, à la couleur de la classe (bande du conseil)
local function short(full)
  local m = Lo().Member(full)
  return K.colored(m and m.class, (F.Split(full)) or name(full))
end
local function ilvl(e) return e.ilvl and (GREY .. "  niv. " .. e.ilvl .. "|r") or "" end
local function count(v) if type(v) == "table" then return #v end return tonumber(v) or 0 end
-- Temps restant pour l'échange : orange sous 30 min
local function timeLeft(e)
  if not e.expires then return GREY .. "durée d'échange inconnue|r", nil end
  local s = e.expires - time()
  if s <= 0 then return RED .. "délai d'échange passé|r", s end
  return (s < 1800 and ORANGE or GREY) .. F.Duration(s) .. " pour l'échanger|r", s
end
local function refreshMain() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function after(fn) return function() ns.safe("butin", fn) U.Refresh() refreshMain() end end
-- Hauteur d'un texte (bornée : la fenêtre se cale dessus)
local function height(fs, min, max)
  local h = fs.GetStringHeight and fs:GetStringHeight()
  if type(h) ~= "number" then h = min end
  return math.max(min, math.min(max, h))
end

-- Fenêtre à liste (même mise en page que les onglets de la fenêtre principale), redimensionnable, taille mémorisée
local function listWindow(frameName, title, w, h, sizeKey)
  local win = K.window(frameName, title, w, h)
  local p = CreateFrame("Frame", nil, win)
  p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
  win.page = p
  win.hintText = K.hint(p, "")
  K.itemTips(p) -- objet en titre
  win.list = K.list(p, -40)
  K.resizable(win, sizeKey, w, 280, 1000, 1200)
  return win
end

--------------------------------------------------------------------------------------------------------------------
-- Bande d'objets (fenêtres de réponse et du conseil) : un bouton par objet (numéro, icône, état), l'objet affiché en
-- surbrillance, infobulle de l'objet au survol ; flèches quand elle déborde.
-- entries : { key, num, itemId, link, name, icon, text, dim, lines } ; onPick(key) au clic
--------------------------------------------------------------------------------------------------------------------
local GAP, ARROW = 4, 22
local function iconOf(id)
  local get = (C_Item and C_Item.GetItemIconByID) or GetItemIcon
  if not (get and id) then return nil end
  local ok, tex = pcall(get, id)
  if ok and ((type(tex) == "number" and not F.secret(tex)) or F.usable(tex)) then return tex end
  return nil
end
local function textW(fs, fallback)
  local w = fs.GetStringWidth and fs:GetStringWidth()
  return (type(w) == "number" and w > 0) and w or fallback
end
local function band(parent, width, onPick)
  -- Couleurs : celles du site (fond bleu nuit, liseré, accent argent-azur), ou sombre et bronze dans l'habillage du jeu
  local C = K.C
  local col = K.site() and { bg = C.panel2, alpha = 0.85, line = C.line2, lit = C.gold }
    or { bg = { 0, 0, 0 }, alpha = 0.45, line = { 0.45, 0.38, 0.24 }, lit = { 1, 0.82, 0 } }
  local B = CreateFrame("Frame", nil, parent)
  B:SetHeight(28)
  B.chips, B.entries, B.first, B.shown = {}, {}, 1, {}
  local selKey, follow = nil, false -- objet choisi ; le garder visible au prochain placement
  local function paint(b)
    K.recolor(b.edges, (b.selected or b.hover) and col.lit or col.line)
    if b.selected then b.bg:SetColorTexture(col.lit[1], col.lit[2], col.lit[3], 0.2)
    else b.bg:SetColorTexture(col.bg[1], col.bg[2], col.bg[3], b.hover and math.min(1, col.alpha + 0.25) or col.alpha) end
  end
  local function tip(b)
    local e = b.entry
    if not (GameTooltip and e) then return end
    GameTooltip:SetOwner(b, "ANCHOR_BOTTOM")
    local s = F.ItemString(e.link) or (e.itemId and ("item:" .. e.itemId))
    if not (s and pcall(GameTooltip.SetHyperlink, GameTooltip, s)) then GameTooltip:SetText(e.name or "?") end
    for _, line in ipairs(e.lines or {}) do GameTooltip:AddLine(line, 1, 1, 1, true) end
    GameTooltip:Show()
  end
  local function chip(i)
    if B.chips[i] then return B.chips[i] end
    local b = CreateFrame("Button", nil, B)
    b:SetHeight(26)
    b.hover, b.selected = false, false
    b.bg = b:CreateTexture(nil, "BACKGROUND")
    b.bg:SetAllPoints()
    b.edges = K.edges(b, col.line)
    b.num = b:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    b.num:SetPoint("LEFT", 6, 0)
    b.icon = b:CreateTexture(nil, "ARTWORK")
    b.icon:SetSize(20, 20) b.icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
    b.icon:SetPoint("LEFT", b.num, "RIGHT", 4, 0)
    b.label = b:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    if b.label.SetWordWrap then b.label:SetWordWrap(false) end
    b:SetScript("OnClick", function(self) if self.entry then onPick(self.entry.key) end end)
    b:SetScript("OnEnter", function(self) self.hover = true paint(self) tip(self) end)
    b:SetScript("OnLeave", function(self) self.hover = false paint(self) if GameTooltip then GameTooltip:Hide() end end)
    B.chips[i] = b
    return b
  end
  local function arrow(text, step, point)
    local a = CreateFrame("Button", nil, B)
    a:SetSize(ARROW - 2, 26) a:SetPoint(point, B, point, 0, 0)
    local fs = a:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    fs:SetPoint("CENTER") fs:SetText(text)
    a:SetScript("OnClick", function() B.first = B.first + step B.Layout() end)
    a:Hide()
    return a
  end
  B.prev, B.next = arrow("<", -1, "LEFT"), arrow(">", 1, "RIGHT")
  function B.Layout()
    local n, widths, total = #B.entries, {}, 0
    for i, e in ipairs(B.entries) do
      local b = chip(i)
      b.entry, b.selected = e, e.key == selKey
      b.num:SetText(K.ACCENT .. tostring(e.num or i) .. "|r")
      b.label:ClearAllPoints()
      if e.icon then
        b.icon:SetTexture(e.icon) b.icon:Show()
        if b.icon.SetDesaturated then b.icon:SetDesaturated(e.dim and true or false) end
        b.label:SetPoint("LEFT", b.icon, "RIGHT", 5, 0)
      else
        b.icon:Hide()
        b.label:SetPoint("LEFT", b.num, "RIGHT", 5, 0)
      end
      b.label:SetText(e.text or "")
      paint(b)
      local lw = (e.text or "") ~= "" and (5 + textW(b.label, 40)) or 0
      widths[i] = math.floor(6 + textW(b.num, 8) + (e.icon and 24 or 0) + lw + 8 + 0.5)
      b:SetWidth(widths[i])
      total = total + widths[i] + (i > 1 and GAP or 0)
    end
    local avail = B:GetWidth()
    if type(avail) ~= "number" or avail < 60 then avail = width end
    local first, last, over = 1, n, total > avail
    if over then
      avail = avail - 2 * ARROW
      local function span(a, z) local s = 0 for k = a, z do s = s + widths[k] + (k > a and GAP or 0) end return s end
      local sel
      for i, e in ipairs(B.entries) do if e.key == selKey then sel = i end end
      first = math.max(1, math.min(B.first, n))
      -- L'objet choisi reste visible
      if follow and sel then
        if sel < first then first = sel end
        while first < sel and span(first, sel) > avail do first = first + 1 end
      end
      last = first
      while last < n and span(first, last + 1) <= avail do last = last + 1 end
      while first > 1 and span(first - 1, last) <= avail do first = first - 1 end
    end
    B.first, follow, B.shown = first, false, {}
    local x = over and ARROW or 0
    for i, b in ipairs(B.chips) do
      if i <= n and i >= first and i <= last then
        b:ClearAllPoints() b:SetPoint("LEFT", B, "LEFT", x, 0) b:Show()
        x = x + widths[i] + GAP
        B.shown[#B.shown + 1] = b
      else
        b:Hide()
      end
    end
    if over and first > 1 then B.prev:Show() else B.prev:Hide() end
    if over and last < n then B.next:Show() else B.next:Hide() end
  end
  function B.Set(entries, sel)
    B.entries = entries
    if sel ~= selKey then selKey, follow = sel, true end
    B.Layout()
  end
  if B.HookScript then B:HookScript("OnSizeChanged", function() follow = true B.Layout() end) end
  return B
end

--------------------------------------------------------------------------------------------------------------------
-- Butin du chef de butin
--------------------------------------------------------------------------------------------------------------------
local lootWin
local KIND = { msos = "MS / OS", free = "jet libre" }
local ROLL_KIND = { ms = "MS", os = "OS", free = "libre" }

function U.ShowLoot()
  if not ns.db() then return end
  if not lootWin then lootWin = listWindow("RosterLoot", "Butin · chef de butin", 600, 500, "loot") end
  K.front(lootWin)
  lootWin:Show()
  U.RefreshLoot()
end

-- Tous les objets à distribuer au conseil d'un coup (une annonce numérotée) ; moteur sans L.StartAllCouncils : un
-- conseil par objet. La fenêtre du conseil s'ouvre sur le premier.
function U.AllToCouncil()
  local Lx = Lo()
  if Lx.StartAllCouncils then
    local n, sessions = Lx.StartAllCouncils()
    if type(sessions) == "table" and sessions[1] ~= nil then U.ShowCouncil(sessions[1]) end
    return n, sessions
  end
  local sessions, fresh = {}, {}
  for _, e in ipairs(Lx.Items()) do if e.status == "new" then fresh[#fresh + 1] = e end end
  for _, e in ipairs(fresh) do
    local ok, sid = Lx.StartCouncil(e.key)
    if not ok then break end
    sid = (type(ok) == "string" and ok) or sid or e.session
    if sid ~= nil then sessions[#sessions + 1] = sid end
  end
  if sessions[1] ~= nil then U.ShowCouncil(sessions[1]) end
  return #sessions, sessions
end

local function rollLines(L, e, st)
  local r = Lo().Rolls(e.key)
  if not r then return end
  st.rolls = r
  for i, rows in ipairs(r.previous or {}) do
    local parts = {}
    for _, x in ipairs(rows) do parts[#parts + 1] = name(x.name) .. " " .. x.roll end
    L.Add(GREY .. (i == 1 and "1er tour" or (i .. "e tour")) .. " : " .. table.concat(parts, ", ") .. "|r")
  end
  if r.hidden then L.Add(ORANGE .. "Le jeu cache les messages du chat en ce moment : jets illisibles. Relance après le combat.|r") end
  if #r.rows == 0 then L.Add(GREY .. (r.open and "En attente des jets..." or "Aucun jet.") .. "|r") end
  for i, x in ipairs(r.rows) do
    local win = not r.tie and i == 1
    L.Add((win and (STAR .. GOLD) or "") .. name(x.name) .. "|r  " .. x.roll .. GREY .. "  (" .. (ROLL_KIND[x.kind] or x.kind) .. ")|r"
      .. ((r.tie and x.kind == r.best.kind and x.roll == r.best.roll) and (ORANGE .. "  ex æquo|r") or ""))
  end
  local buttons = {}
  if r.best and not r.tie then
    buttons[#buttons + 1] = { "Donner à " .. name(r.winners[1]), 190, after(function() Lo().AwardRoll(e.key) end) }
  end
  if r.tie then
    local tied = {}
    for _, n in ipairs(r.winners) do tied[#tied + 1] = name(n) end
    buttons[#buttons + 1] = { "Relancer : " .. table.concat(tied, ", "), 250, after(function() Lo().Reroll(e.key) end) }
  end
  buttons[#buttons + 1] = { "Annuler", 90, after(function() Lo().Cancel(e.key) end) }
  L.Add(GREY .. (r.kind == "free" and "/roll 100 pour tous" or "MS : /roll 100, OS : /roll 99 ; la spé principale passe d'abord")
    .. ". Seul le premier jet compte ; égalité : seuls les ex æquo relancent.|r", buttons)
end

function U.RefreshLoot()
  if not lootWin or not lootWin:IsShown() then return end
  local Lx, L = Lo(), lootWin.list
  local st = { items = 0, handover = 0, notPassed = 0, fresh = 0, master = Lx.IsMaster() }
  U.state.loot = st
  local master = Lx.Master()
  local held = ns.Comm.Held()
  lootWin.hintText:SetText((Lx.test and (ORANGE .. "Raid d'essai · |r") or "") .. "Chef de butin : " .. (master and who(master) or "?")
    .. (st.master and (GREEN .. " (toi)|r") or "") .. GREY .. "  · distribution par Roster " .. (Lx.Enabled() and "activée" or "coupée")
    .. (held > 0 and ("  · " .. F.plural(held, "message") .. " en attente de la fin du combat") or "") .. "|r")
  L.Reset()
  local todo, hand, done = {}, {}, {}
  for _, e in ipairs(Lx.Items()) do
    if e.status == "awarded" then hand[#hand + 1] = e
    elseif e.status == "kept" or e.status == "traded" then done[#done + 1] = e
    else
      todo[#todo + 1] = e
      if e.status == "new" then st.fresh = st.fresh + 1 end
    end
  end
  L.Header("À distribuer · " .. #todo)
  if not st.master then L.Add(GREY .. "Tu n'es pas chef de butin : " .. (master and name(master) or "le chef de raid") .. " distribue le butin.|r") end
  if #todo == 0 then
    L.Add(GREY .. (Lx.test and "Aucun objet. Raid d'essai : ajoute un objet depuis le panneau d'essai."
      or "Aucun objet. Distribution activée, les objets que tu reçois au butin de groupe arrivent ici.") .. "|r")
  end
  -- Tout au conseil : une annonce numérotée, chacun répond à chaque objet (bande d'objets)
  if st.master and st.fresh >= 2 then
    L.Add(GREY .. "Propose d'un coup les " .. st.fresh .. " objets pas encore distribués : une seule annonce, objets numérotés ; "
      .. "chacun répond à chaque objet.|r", { { "Tout au conseil (" .. st.fresh .. ")", 170, after(function() U.AllToCouncil() end) } })
  end
  for _, e in ipairs(todo) do
    st.items = st.items + 1
    local status = ""
    if e.status == "council" then
      local c = e.session and Lx.Council(e.session)
      status = GREEN .. "  · conseil " .. ((c and c.num) and (c.num .. " ") or "") .. "en cours"
        .. (c and (" (" .. F.plural(#c.cands, "réponse") .. ")") or "") .. "|r"
    elseif e.status == "roll" then
      local r = Lx.Rolls(e.key)
      status = GREEN .. "  · jets " .. (r and KIND[r.kind] or "") .. " en cours|r"
    end
    local text = e.link .. ilvl(e) .. status .. "\n" .. (timeLeft(e))
    local buttons = {}
    if st.master then
      if e.status == "council" then
        buttons = { { "Fenêtre du conseil", 160, function() U.ShowCouncil(e.session) end }, { "Annuler", 90, after(function() Lx.Cancel(e.key) end) } }
      elseif e.status ~= "roll" then
        buttons = {
          { "Conseil", 84, after(function() Lx.StartCouncil(e.key) end) },
          { "Jets MS / OS", 112, after(function() Lx.StartRoll(e.key, "msos") end) },
          { "Jet libre", 84, after(function() Lx.StartRoll(e.key, "free") end) },
          { "Garder", 78, after(function() Lx.Keep(e.key) end) },
          { "Retirer", 78, after(function() Lx.Remove(e.key) end) },
        }
      end
    end
    L.Add(text, buttons)
    if e.status == "roll" then rollLines(L, e, st) end
  end
  L.Header("Objets à remettre · " .. #hand)
  st.handover = #hand
  if #hand == 0 then L.Add(GREY .. "Aucun. Chaque objet attribué arrive ici jusqu'à l'échange.|r") end
  for _, e in ipairs(hand) do
    L.Add(e.link .. GREY .. " pour |r" .. who(e.winner) .. "  " .. (timeLeft(e)),
      { { "Échanger", 100, after(function() Lx.Trade(e.key) end) }, { "Remis", 80, after(function() Lx.MarkTraded(e.key) end) } })
  end
  local np = Lx.NotPassed()
  if #np > 0 then
    L.Header("N'ont pas passé · " .. #np)
    st.notPassed = #np
    for _, n in ipairs(np) do
      L.Add(who(n.name) .. GREY .. " a gagné |r" .. n.link .. GREY .. " au butin de groupe" .. (n.whispered and (" · chuchoté à " .. date("%H:%M", n.whispered)) or "") .. "|r",
        (st.master and not n.whispered) and { { "Chuchoter", 110, after(function() Lx.WhisperNotPassed(n.name) end) } } or nil)
    end
    L.Add(GREY .. "Sans l'addon (ou passer automatique coupé), ils ont gardé leur chance au butin de groupe : demande-leur de garder l'objet pour l'échange.|r")
  end
  if #done > 0 then
    L.Header("Gardés et remis · " .. #done)
    for _, e in ipairs(done) do
      L.Add(GREY .. (e.status == "kept" and "Gardé : " or "Remis à " .. name(e.winner) .. " : ") .. "|r" .. e.link)
    end
  end
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Conseil du butin : bande des conseils (moins de 2 h) ; pour le conseil choisi, un tableau (une ligne par joueur,
-- votes) ; « Donner » pour le chef de butin, puis le conseil ouvert suivant
--------------------------------------------------------------------------------------------------------------------
local councilWin, councilSession, byReceived
local COUNCIL_COLS = {
  { title = "Joueur", w = 150, lines = 2 },
  { title = "Réponse", w = 80 },
  { title = "Porte", flex = 1.4, min = 150, small = true, lines = 2, tip = true },
  { title = "Note", flex = 1, min = 100, small = true, lines = 2, tip = true },
  { title = "Reçus", w = 124, justify = "CENTER", small = true, lines = 2, tip = true },
  { title = "Votes", flex = 0.8, min = 100, small = true, lines = 2 },
  { title = "", w = 168, buttons = true },
}
local RECV_COL = 5

-- Conseils de moins de 2 h, dans l'ordre de proposition ; moteur sans L.Councils : le conseil affiché seulement
local function councilList()
  local f = Lo().Councils
  if type(f) == "function" then
    local list = f()
    if type(list) == "table" then return list end
  end
  local c = councilSession and Lo().Council(councilSession)
  if not c then return {} end
  return { { session = c.session, num = c.num or 1, link = c.link, name = c.name, itemId = c.itemId, master = c.master, closed = c.closed,
    winner = c.winner, answers = #c.cands, waiting = #c.waiting, myVote = c.myVote } }
end
-- Conseil ouvert suivant (dans l'ordre de la bande, en revenant au début)
local function nextOpenCouncil(after)
  local list, start = councilList(), 0
  for i, x in ipairs(list) do if x.session == after then start = i end end
  for k = 1, #list do
    local x = list[(start + k - 1) % #list + 1]
    if not x.closed and x.session ~= after then return x.session end
  end
  return nil
end

function U.ShowCouncil(session)
  if not ns.db() then return end
  if not councilWin then
    local w = K.window("RosterLootCouncil", "Conseil du butin", 980, 454)
    local p = CreateFrame("Frame", nil, w)
    p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
    local hx = K.site() and 6 or 52 -- à droite du portrait (habillage du jeu)
    w.band = band(p, 980 - 26 - hx - 10, function(s) councilSession = s U.RefreshCouncil() end)
    w.band:SetPoint("TOPLEFT", hx, -2) w.band:SetPoint("TOPRIGHT", -10, -2)
    w.hintText = K.hint(p, "")
    w.hintText:ClearAllPoints() w.hintText:SetPoint("TOPLEFT", hx, -36) w.hintText:SetPoint("RIGHT", p, "RIGHT", -10, 0)
    K.itemTips(p) -- objet du conseil, en titre
    w.grid = K.grid(p, -74, 44, COUNCIL_COLS)
    -- En-tête « Reçus » cliquable : tri par objets reçus (le moins servi d'abord), ou retour au tri par réponse et votes
    local sort = CreateFrame("Button", nil, p)
    local head = w.grid.head[RECV_COL]
    sort:SetPoint("TOPLEFT", head, "TOPLEFT", -4, 6) sort:SetPoint("BOTTOMRIGHT", head, "BOTTOMRIGHT", 4, -6)
    sort:SetScript("OnClick", function() byReceived = not byReceived U.RefreshCouncil() end)
    sort:SetScript("OnEnter", function(self)
      if not GameTooltip then return end
      GameTooltip:SetOwner(self, "ANCHOR_TOP")
      GameTooltip:SetText("Objets reçus")
      GameTooltip:AddLine(byReceived and "Clic : retour au tri par réponse, puis votes." or "Clic : trier par objets reçus, le moins servi d'abord.", 1, 1, 1, true)
      GameTooltip:Show()
    end)
    sort:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    w.sort = sort
    w.foot = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.foot:SetPoint("BOTTOMLEFT", 8, 4) w.foot:SetPoint("BOTTOMRIGHT", -26, 4)
    w.foot:SetJustifyH("LEFT")
    w.sized = K.resizable(w, "council", 720, 320, 1600, 1000, function() if councilWin and councilWin.grid then councilWin.grid.Layout() end end)
    councilWin = w
  end
  if session ~= nil then councilSession = tostring(session) end
  K.front(councilWin)
  councilWin:Show()
  U.RefreshCouncil()
end

-- « Donner » : objet attribué, puis le conseil ouvert suivant
function U.Give(session, winner)
  ns.safe("butin", function() Lo().AwardCouncil(session, winner) end)
  local c = Lo().Council(session)
  if c and c.closed then
    local nxt = nextOpenCouncil(session)
    if nxt then councilSession = nxt end
  end
  U.Refresh()
  refreshMain()
end

local function gearText(c)
  if c.whispered then return GREY .. "réponse chuchotée|r" end
  if #c.gear == 0 then return GREY .. "rien à cet emplacement|r" end
  local out = {}
  for _, g in ipairs(c.gear) do out[#out + 1] = (g.link or ("objet " .. g.id)) .. (g.ilvl and (GREY .. " " .. g.ilvl .. "|r") or "") end
  return table.concat(out, "\n")
end

-- Détail des objets reçus (choix de Flo : BiS · Upgrade · Jets MS) ; long : libellés de l'infobulle
local function recvParts(x, long)
  local parts = {}
  local function add(n, label, labels)
    n = tonumber(n)
    if n and n > 0 then parts[#parts + 1] = n .. " " .. ((long and n > 1 and labels) or label) end
  end
  add(x.receivedBis, "BiS")
  add(x.receivedUp, long and "Upgrade" or "Up")
  add(x.receivedMs, long and "jet MS" or "MS", long and "jets MS")
  return table.concat(parts, " · ")
end
local function recvText(x)
  local tonight = tonumber(x.receivedTonight) or 0
  local d = recvParts(x)
  return WHITE .. tostring(x.received or 0) .. "|r" .. (tonight > 0 and (GREY .. " (+" .. tonight .. ")|r") or "")
    .. (d ~= "" and ("\n" .. GREY .. d .. "|r") or "")
end

function U.RefreshCouncil()
  if not councilWin or not councilWin:IsShown() then return end
  local Lx, G = Lo(), councilWin.grid
  local list = councilList()
  if councilSession == nil or not Lx.Council(councilSession) then
    councilSession = nextOpenCouncil(nil) or (list[#list] and list[#list].session) or councilSession
    list = councilList()
  end
  local c = councilSession and Lx.Council(councilSession)
  local st = { session = councilSession, rows = 0, band = {}, order = {}, byReceived = byReceived and true or false }
  U.state.council = st
  -- Bande : numéro, icône, réponses sur joueurs ; coche et gagnant une fois donné
  local entries, num = {}, nil
  for i, x in ipairs(list) do
    local n = x.num or i
    local answers, waiting = count(x.answers), count(x.waiting)
    local text = (waiting == 0 and GREEN or WHITE) .. answers .. "/" .. (answers + waiting) .. "|r"
    local lines = { "Objet " .. n .. (x.master and (" · chef de butin : " .. name(x.master)) or "") }
    if x.closed then
      text = x.winner and (CHECK .. " " .. short(x.winner)) or (GREY .. "annulé|r")
      lines[#lines + 1] = x.winner and (GREEN .. "Terminé : " .. name(x.winner) .. " reçoit l'objet.|r") or (GREY .. "Conseil annulé.|r")
    else
      lines[#lines + 1] = F.plural(answers, "réponse") .. " sur " .. (answers + waiting) .. " joueurs"
      if x.myVote then lines[#lines + 1] = "Ton vote : " .. name(x.myVote) end
    end
    local icon = iconOf(x.itemId or F.ItemId(x.link))
    if not icon then text = F.cut(x.name or F.ItemName(x.link) or "?", 14) .. " " .. text end
    entries[i] = { key = x.session, num = n, itemId = x.itemId, link = x.link, name = x.name, icon = icon, text = text, lines = lines }
    st.band[i] = { session = x.session, num = n, text = text, closed = x.closed and true or false }
    if x.session == councilSession then num = n end
  end
  councilWin.band.Set(entries, councilSession)
  G.Reset()
  if not c then
    councilWin.hintText:SetText(GREY .. "Pas de conseil en cours.|r")
    councilWin.foot:SetText("")
    G.Done()
    return
  end
  num = num or c.num
  st.closed, st.master, st.num = c.closed, c.isMaster, num
  local isCouncil = Lx.IsCouncil(c.master)
  local nVotes = 0
  for _, x in ipairs(c.cands) do nVotes = nVotes + x.votes end
  G.SetTitle(RECV_COL, (byReceived and K.ACCENT or "") .. (c.counts and ("Reçus · " .. c.counts.short) or "Reçus ce soir")
    .. (byReceived and " (tri)|r" or ""))
  local head = (num and (K.ACCENT .. num .. "|r  ") or "") .. c.link .. (c.ilvl and (GREY .. "  niv. " .. c.ilvl .. "|r") or "")
    .. GREY .. "  · chef de butin : " .. name(c.master) .. (c.isMaster and " (toi)" or "") .. "|r"
  if c.closed then
    head = head .. "\n" .. (c.winner and (GREEN .. "Conseil terminé : " .. name(c.winner) .. " reçoit l'objet.|r") or (GREY .. "Conseil annulé.|r"))
  else
    head = head .. "\n" .. GOLD .. F.plural(#c.cands, "réponse") .. "|r" .. GREY .. (#c.waiting > 0 and (", " .. #c.waiting .. " en attente") or "")
      .. "  · " .. F.plural(nVotes, "vote") .. " (conseil : " .. #c.council .. ")|r"
  end
  councilWin.hintText:SetText(head)
  -- Tri du moteur (réponse, puis votes) ; ou par objets reçus, le moins servi d'abord (ceux qui passent restent en bas)
  local cands = {}
  for i, x in ipairs(c.cands) do cands[i] = x end
  if byReceived then
    local pos = {}
    for i, x in ipairs(cands) do pos[x] = i end
    table.sort(cands, function(a, b)
      local pa, pb = a.response == "pass", b.response == "pass"
      if pa ~= pb then return pb end
      local ra, rb = tonumber(a.received) or 0, tonumber(b.received) or 0
      if ra ~= rb then return ra < rb end
      return pos[a] < pos[b]
    end)
  end
  for _, x in ipairs(cands) do
    st.rows = st.rows + 1
    st.order[st.rows] = x.name
    local voters = {}
    for _, v in ipairs(x.voters) do voters[#voters + 1] = name(v) end
    local buttons = {}
    if not c.closed and x.response ~= "pass" then
      if isCouncil then
        buttons[#buttons + 1] = { (c.myVote and F.SameName(c.myVote, x.name)) and "Voté" or "Voter", 74, function() Lx.Vote(c.session, x.name) U.Refresh() end }
      end
      if c.isMaster then buttons[#buttons + 1] = { "Donner", 86, function() U.Give(c.session, x.name) end } end
    end
    local resp = x.response
    -- Ne peut pas porter cette armure : réponse grisée et mention sous le nom
    local cant = x.canUse == false
    G.Row({
      who(x.name) .. (cant and ("\n" .. ORANGE .. "ne peut pas le porter|r") or ""),
      ((not cant and RESP_COLOR[resp]) or GREY) .. (Lx.RESPONSES[resp] or resp) .. "|r",
      gearText(x),
      (x.note ~= "") and ("|cffc9cfdb« " .. x.note .. " »|r") or "",
      recvText(x),
      #voters > 0 and (WHITE .. x.votes .. "|r " .. GREY .. table.concat(voters, ", ") .. "|r") or (GREY .. "0|r"),
    }, {
      buttons = buttons, dim = resp == "pass",
      tip = function(col, owner)
        if not GameTooltip then return end
        GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
        if col == 3 and x.gear[1] and not x.whispered then
          GameTooltip:SetHyperlink("item:" .. x.gear[1].id)
          for k = 2, #x.gear do GameTooltip:AddLine("et " .. (x.gear[k].link or ("objet " .. x.gear[k].id))) end
        elseif col == 4 and x.note ~= "" then
          GameTooltip:SetText(name(x.name)) GameTooltip:AddLine(x.note, 1, 1, 1, true)
        elseif col == RECV_COL then
          local total = tonumber(x.received) or 0
          local d = recvParts(x, true)
          GameTooltip:SetText(name(x.name) .. " : objets reçus")
          GameTooltip:AddLine(F.plural(total, "objet") .. " au total" .. (d ~= "" and (" : " .. d) or ""), 1, 1, 1, true)
          if x.receivedBis ~= nil then
            local rest = total - (tonumber(x.receivedBis) or 0) - (tonumber(x.receivedUp) or 0) - (tonumber(x.receivedMs) or 0)
            if rest > 0 then GameTooltip:AddLine("dont " .. rest .. " autre" .. (rest > 1 and "s" or "") .. " (donné directement, noté sans catégorie)", 1, 1, 1, true) end
          end
          if c.counts then GameTooltip:AddLine((x.receivedSite or 0) .. " sur le site, " .. c.counts.label, 1, 1, 1, true)
          else GameTooltip:AddLine("Données du site non chargées : colle-les dans l'onglet Synchro.", 1, 1, 1, true) end
          GameTooltip:AddLine((x.receivedTonight or 0) .. " ce soir (pas encore sur le site)", 1, 1, 1, true)
          GameTooltip:AddLine("Ne comptent pas : Off-spec, Transmo, jets OS et libres, objets gardés.", 0.6, 0.64, 0.71, true)
        else
          return
        end
        GameTooltip:Show()
      end,
    })
  end
  if #c.cands == 0 then G.Row({ GREY .. "En attente...|r", "", GREY .. "Les réponses arrivent ici au fil de l'eau.|r" }) end
  G.Done()
  local waiting = {}
  for i = 1, math.min(#c.waiting, 12) do waiting[i] = name(c.waiting[i]) end
  councilWin.foot:SetText((#c.waiting > 0 and (GREY .. "Pas encore répondu : |r" .. table.concat(waiting, ", ") .. (#c.waiting > 12 and (" +" .. (#c.waiting - 12)) or ""))
    or (GREY .. "Tout le monde a répondu.|r")) .. "\n" .. GREY .. "Bande du haut : un objet par conseil. Survol : objet porté, note, détail des reçus ; "
    .. "clic sur « Reçus » : trier. Votes visibles du conseil seulement."
    .. (c.isMaster and " « Donner » attribue l'objet (annonce au raid et au gagnant), puis passe au conseil suivant." or "") .. "|r")
  -- Hauteur selon le nombre de réponses, tant que la fenêtre n'a pas été redimensionnée à la main
  local d = ns.db()
  if not (d and d.sizes and d.sizes.council) then councilWin:SetHeight(math.max(330, math.min(680, 194 + 30 * math.max(#c.cands, 3)))) end
end

--------------------------------------------------------------------------------------------------------------------
-- Réponse du joueur : une bande d'objets (offres ouvertes) ; pour l'objet choisi, BiS, Upgrade, Off-spec, Transmo ou
-- Passer, avec une note (seulement Transmo et Passer pour un objet qu'on ne peut pas porter). Après une réponse, l'objet
-- suivant sans réponse ; tout répondu : la fenêtre reste ouverte (réponses modifiables tant que le conseil est ouvert).
-- Un seul objet proposé : la fenêtre se ferme dès la réponse, comme en 0.2.
--------------------------------------------------------------------------------------------------------------------
local offerWin, offerSel, offerErr -- offerErr : réponse refusée par le moteur (affichée en rouge)
local notes, drafts = {}, {} -- note envoyée et note en cours de chaque objet (rendues quand on revient dessus)
local seen = {} -- objet affiché la dernière fois avec (true) ou sans (false) réponse : une réponse vient d'arriver
local OFFER_W = 560

local function openOffers()
  local out = {}
  for _, o in ipairs(Lo().Offers() or {}) do if not o.closed then out[#out + 1] = o end end
  return out
end
local function findOffer(list, session)
  if session == nil then return nil end
  for i, o in ipairs(list) do if o.session == session then return o, i end end
  return nil
end
-- Prochain objet sans réponse après « after » (dans l'ordre de la bande, en revenant au début)
local function nextUnanswered(list, after)
  local _, start = findOffer(list, after)
  start = start or 0
  for k = 1, #list do
    local o = list[(start + k - 1) % #list + 1]
    if not o.answered and o.session ~= after then return o end
  end
  return nil
end
-- Objet portable : donné par l'offre, sinon demandé au moteur (nil : inconnu, tout est permis)
local function canUse(o)
  if o.usable ~= nil then return o.usable, o.reason end
  local f = Lo().CanUse
  if type(f) ~= "function" then return nil end
  local ok, usable, reason = pcall(f, o.itemString or o.link)
  if ok then return usable, reason end
  return nil
end
local function selectOffer(session)
  if offerWin and offerSel ~= nil and offerSel ~= session then drafts[offerSel] = offerWin.note:GetText() end
  offerSel = session
  if offerWin then
    offerWin.note:SetText(drafts[session] or notes[session] or "")
    offerErr = nil
  end
end

local function buildOffer()
  local w = K.window("RosterLootOffer", "Butin · ta réponse", OFFER_W, 300)
  w:ClearAllPoints() w:SetPoint("TOP", 0, -140)
  K.itemTips(w) -- objet proposé et objets portés
  local x = K.gapX()
  w.x, w.top = x, K.site() and -34 or -30
  w.band = band(w, OFFER_W - x - 14, function(s) selectOffer(s) U.RefreshOffer() end)
  w.band:SetPoint("TOPLEFT", x, w.top) w.band:SetPoint("TOPRIGHT", -14, w.top)
  w.text = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  w.text:SetWidth(OFFER_W - x - 18) w.text:SetJustifyH("LEFT")
  w.warn = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  w.warn:SetWidth(OFFER_W - x - 18) w.warn:SetJustifyH("LEFT")
  w.noteLabel = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  w.noteLabel:SetText(GREY .. "Note pour le conseil (facultatif) :|r")
  w.note = CreateFrame("EditBox", nil, w, "InputBoxTemplate")
  w.note:SetSize(OFFER_W - x - 30, 22) w.note:SetAutoFocus(false) w.note:SetMaxLetters(60)
  w.note:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  w.buttons = {}
  for _, key in ipairs(Lo().ORDER) do
    local b = K.button(w, Lo().RESPONSES[key], 86, nil)
    b:SetScript("OnClick", function() ns.safe("réponse au conseil", U.Answer, key) end)
    w.buttons[key] = b
  end
  w.done = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  w.done:SetWidth(OFFER_W - x - 124) w.done:SetJustifyH("LEFT")
  w.close = K.button(w, "Fermer", 90, function() w:Hide() end)
  w.foot = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  w.foot:SetWidth(OFFER_W - x - 18) w.foot:SetJustifyH("LEFT")
  return w
end

local function hideOffer()
  if offerWin then offerWin:Hide() end
  U.state.offer = { left = 0, band = {}, buttons = {} }
end

-- session : l'objet à afficher, sauf si une réponse est en cours (objet affiché encore sans réponse) : un nouvel objet
-- s'ajoute alors à la bande sans prendre la main. Sans session : l'objet affiché, sinon le premier sans réponse.
function U.ShowOffer(session)
  if not ns.db() then return end
  if session ~= nil then session = tostring(session) end
  local list = openOffers()
  local shown = offerWin and offerWin:IsShown()
  local cur = shown and findOffer(list, offerSel) or nil
  -- Seul objet proposé, auquel tu viens de répondre : fenêtre fermée
  if session == nil and cur and cur.answered and #list == 1 and seen[cur.session] == false then return hideOffer() end
  local pick
  if session and findOffer(list, session) and not (cur and not cur.answered) then pick = session
  elseif cur then pick = cur.session
  else
    local o = nextUnanswered(list) or (shown and list[1]) or nil
    pick = o and o.session
  end
  if not pick then return hideOffer() end
  if not offerWin then offerWin = buildOffer() end
  if pick ~= offerSel then selectOffer(pick) end
  K.front(offerWin)
  offerWin:Show()
  U.RefreshOffer()
end

-- Clic sur une réponse : envoyée au chef de butin et au conseil, puis l'objet suivant sans réponse
function U.Answer(key)
  if not offerWin then return end
  local o = findOffer(openOffers(), offerSel)
  if not o then return end
  local note = offerWin.note:GetText() or ""
  local ok, err = Lo().Answer(o.session, key, note)
  if ok == false then
    offerErr = err or "Réponse refusée."
  else
    offerErr = nil
    notes[o.session], drafts[o.session] = note, nil
    if offerWin.note.ClearFocus then offerWin.note:ClearFocus() end
    local list = openOffers()
    if #list <= 1 then hideOffer() refreshMain() return end -- seul objet proposé : fenêtre fermée après la réponse
    local nxt = nextUnanswered(list, o.session)
    if nxt then selectOffer(nxt.session) end
  end
  U.RefreshOffer()
  refreshMain()
end

function U.RefreshOffer()
  local w = offerWin
  if not (w and w:IsShown()) then return end
  local Lx = Lo()
  local list = openOffers()
  local o, idx = findOffer(list, offerSel)
  if not o then
    local n = nextUnanswered(list) or list[1]
    if not n then return hideOffer() end
    selectOffer(n.session)
    o, idx = findOffer(list, n.session)
  end
  local st = { session = o.session, left = 0, band = {}, buttons = {} }
  U.state.offer = st
  -- Bande : numéro et icône ; coche et initiale de la réponse une fois répondu ; icône grisée si pas portable
  local entries, mine = {}, {}
  for i, x in ipairs(list) do
    local num = x.num or i
    local usable, reason = canUse(x)
    local label = Lx.RESPONSES[x.response or ""]
    local lines = { "Objet " .. num .. (x.from and (" · proposé par " .. name(x.from)) or "") }
    lines[#lines + 1] = x.answered and ("Ta réponse : " .. (RESP_COLOR[x.response] or GREY) .. (label or "?") .. "|r") or "Pas encore de réponse."
    if usable == false then lines[#lines + 1] = ORANGE .. "Tu ne peux pas le porter" .. ((reason and reason ~= "") and (" : " .. reason) or "") .. "|r" end
    local icon = iconOf(x.itemId or F.ItemId(x.link))
    local text = x.answered and (CHECK .. (RESP_COLOR[x.response] or GREY) .. (RESP_INITIAL[x.response] or "?") .. "|r") or ""
    if not icon then text = F.cut(x.name or F.ItemName(x.link) or "?", 14) .. (text ~= "" and (" " .. text) or "") end
    entries[i] = { key = x.session, num = num, itemId = x.itemId, link = x.link, name = x.name, icon = icon, text = text, dim = usable == false, lines = lines }
    st.band[i] = { session = x.session, num = num, text = text, answered = x.answered and true or false, response = x.answered and x.response or nil }
    seen[x.session] = st.band[i].answered
    if x.answered then mine[#mine + 1] = num .. " " .. (RESP_COLOR[x.response] or GREY) .. (label or "?") .. "|r"
    elseif x ~= o then st.left = st.left + 1 end
  end
  w.band.Set(entries, o.session)
  -- Objet choisi : lien, niveau, proposé par, ce que tu portes, ta réponse
  local num = o.num or idx
  local usable, reason = canUse(o)
  st.num, st.usable, st.reason = num, usable, reason
  local gear = {}
  for _, g in ipairs(Lx.Equipped(o.itemString) or {}) do gear[#gear + 1] = g.link .. (g.ilvl and (GREY .. " (" .. g.ilvl .. ")|r") or "") end
  local lvl = Lx.ilvlOf(o.itemString)
  local text = o.link .. (lvl and (GREY .. "  niv. " .. lvl .. "|r") or "") .. GREY .. "  proposé par " .. name(o.from) .. "|r\n"
    .. (#gear > 0 and ("Tu portes : " .. table.concat(gear, ", ")) or (GREY .. "Rien de porté à cet emplacement.|r"))
  if o.answered then
    text = text .. "\nTa réponse : " .. (RESP_COLOR[o.response] or GREY) .. (Lx.RESPONSES[o.response or ""] or "?") .. "|r"
      .. GREY .. " (modifiable tant que le conseil est ouvert)|r"
  end
  w.text:SetText(text)
  local warn = {}
  if usable == false then
    warn[#warn + 1] = ORANGE .. "Tu ne peux pas porter cet objet" .. ((reason and reason ~= "") and (" : " .. reason) or ".") .. "|r"
  end
  if offerErr then warn[#warn + 1] = RED .. tostring(offerErr) .. "|r" end
  w.warn:SetText(table.concat(warn, "\n"))
  -- Réponses permises : seulement Transmo et Passer pour un objet qu'on ne peut pas porter
  local keys = usable == false and { "transmo", "pass" } or Lx.ORDER
  for _, b in pairs(w.buttons) do b:Hide() end
  local allDone = o.answered and st.left == 0
  st.done = allDone and true or false
  w.done:SetText(allDone and (GREEN .. "Tout est répondu.|r " .. GREY .. "Tes réponses : |r" .. table.concat(mine, GREY .. " · |r")
    .. GREY .. ". Clique un objet de la bande pour changer ta réponse.|r") or "")
  w.foot:SetText(GREY .. "Ta réponse part au chef de butin et au conseil, qui votent. Sans l'addon : chuchote au chef de butin bis, up, os "
    .. "ou transmo, suivi du numéro de l'objet (« bis " .. num .. " »).|r")
  -- Mise en page de haut en bas ; la fenêtre se cale sur son contenu
  local x, y = w.x, w.top - 34
  w.text:ClearAllPoints() w.text:SetPoint("TOPLEFT", x, y)
  y = y - height(w.text, 28, 60) - 8
  if #warn > 0 then
    w.warn:ClearAllPoints() w.warn:SetPoint("TOPLEFT", x, y) w.warn:Show()
    y = y - height(w.warn, 14, 32) - 8
  else
    w.warn:Hide()
  end
  w.noteLabel:ClearAllPoints() w.noteLabel:SetPoint("TOPLEFT", x, y)
  y = y - 14
  w.note:ClearAllPoints() w.note:SetPoint("TOPLEFT", x + 4, y)
  y = y - 30
  for i, key in ipairs(keys) do
    local b = w.buttons[key]
    local label = Lx.RESPONSES[key]
    b:SetText((o.answered and o.response == key) and (CHECK .. " " .. label) or label)
    b:ClearAllPoints() b:SetPoint("TOPLEFT", x + (i - 1) * 90, y) b:Show()
    st.buttons[i] = key
  end
  y = y - 34
  if allDone then
    w.done:ClearAllPoints() w.done:SetPoint("TOPLEFT", x, y) w.done:Show()
    w.close:ClearAllPoints() w.close:SetPoint("TOPRIGHT", w, "TOPRIGHT", -16, y + 2) w.close:Show()
    y = y - math.max(28, height(w.done, 14, 42)) - 6
  else
    w.done:Hide() w.close:Hide()
  end
  w.foot:ClearAllPoints() w.foot:SetPoint("TOPLEFT", x, y)
  y = y - height(w.foot, 24, 40) - 14
  w:SetHeight(-y)
end

--------------------------------------------------------------------------------------------------------------------
-- Objets à remettre (chef de butin) : échange au gagnant, objets posés tout seuls dans la fenêtre d'échange
--------------------------------------------------------------------------------------------------------------------
local handWin
function U.ShowHandover()
  if not ns.db() then return end
  if not handWin then handWin = listWindow("RosterLootHandover", "Butin · objets à remettre", 600, 380, "handover") end
  K.front(handWin)
  handWin:Show()
  U.RefreshHandover()
end

function U.RefreshHandover()
  if not handWin or not handWin:IsShown() then return end
  local Lx, L = Lo(), handWin.list
  local st = { items = 0 }
  U.state.handover = st
  handWin.hintText:SetText(GREY .. "« Échanger » demande l'échange au gagnant (à quelques mètres de toi). Dès que la fenêtre d'échange s'ouvre "
    .. "avec lui (même s'il l'ouvre lui-même), ses objets y sont posés tout seuls ; valide ensuite dans le jeu. Hors combat.|r")
  L.Reset()
  local hand = {}
  for _, e in ipairs(Lx.Items()) do if e.status == "awarded" then hand[#hand + 1] = e end end
  L.Header("Objets à remettre · " .. #hand)
  if #hand == 0 then L.Add(GREY .. "Aucun objet à remettre.|r") end
  for _, e in ipairs(hand) do
    st.items = st.items + 1
    local m = Lx.Member(e.winner)
    L.Add(e.link .. ilvl(e) .. GREY .. " pour |r" .. who(e.winner) .. (m and "" or (RED .. " (plus dans le groupe)|r")) .. "\n" .. (timeLeft(e)),
      { { "Échanger", 100, after(function() Lx.Trade(e.key) end) }, { "Remis", 80, after(function() Lx.MarkTraded(e.key) end) },
        { "Retirer", 80, after(function() Lx.Remove(e.key) end) } })
  end
  L.Add(GREY .. "« Remis » : échange fait à la main. Le jeu ne permet l'échange qu'aux joueurs présents au butin, pendant 2 h.|r")
  L.Done()
end

--------------------------------------------------------------------------------------------------------------------
-- Rafraîchir les fenêtres ouvertes ; tout fermer (fin du raid d'essai)
--------------------------------------------------------------------------------------------------------------------
function U.Refresh()
  ns.safe("butin", U.RefreshLoot)
  ns.safe("conseil du butin", U.RefreshCouncil)
  ns.safe("objets à remettre", U.RefreshHandover)
  ns.safe("réponse au conseil", U.RefreshOffer)
end

function U.Close()
  for _, w in ipairs({ lootWin, councilWin, offerWin, handWin }) do if w then w:Hide() end end
  offerSel, councilSession, notes, drafts, seen = nil, nil, {}, {}, {}
end

-- Fenêtres (pour les tests) et rafraîchissement quand le jeu reçoit un objet (nom et infobulle arrivent après)
function U.Windows() return { loot = lootWin, council = councilWin, offer = offerWin, handover = handWin } end
local due = false
local function itemArrived()
  if due or not (C_Timer and C_Timer.After) then return end
  due = true
  C_Timer.After(0.3, function() due = false U.Refresh() end)
end
ns.on("GET_ITEM_INFO_RECEIVED", itemArrived)
ns.on("ITEM_DATA_LOAD_RESULT", itemArrived)

return U
