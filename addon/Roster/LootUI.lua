-- Fenêtres de la distribution du butin (lot R3b) : butin du chef de butin (/roster butin), conseil du butin (réponses
-- et votes), réponse de chaque joueur, objets à remettre. Le moteur est dans Loot.lua ; boîte à outils : addon/shared/Kit.lua
-- (deux habillages, tailles mémorisées). Les attributions partent toujours d'un clic (annonce et chuchotement).
local _, ns = ...
local U = {}
ns.LootUI = U
local K, F = ns.Kit, ns.Format

local GOLD, GREY, GREEN, RED, ORANGE, BLUE = "|cffe3b54b", "|cff9aa3b6", "|cff4fd35f", "|cffff6b5e", "|cfff0b43c", "|cff6fb7ff"
-- Gagnant des jets : l'étoile des marqueurs de raid (le caractère étoile n'existe pas dans la police du jeu)
local STAR = "|TInterface\\TargetingFrame\\UI-RaidTargetingIcon_1:0|t "
local RESP_COLOR = { bis = GREEN, upgrade = BLUE, off = GREY, transmo = GREY, pass = GREY }
U.state = {} -- ce que chaque fenêtre affiche (tests hors jeu)

local function Lo() return ns.Loot end
local function name(full) return F.Display(full) end
local function who(full)
  local m = Lo().Member(full)
  return K.colored(m and m.class, name(full))
end
local function ilvl(e) return e.ilvl and (GREY .. "  niv. " .. e.ilvl .. "|r") or "" end
-- Temps restant pour l'échange : orange sous 30 min
local function timeLeft(e)
  if not e.expires then return GREY .. "durée d'échange inconnue|r", nil end
  local s = e.expires - time()
  if s <= 0 then return RED .. "délai d'échange passé|r", s end
  return (s < 1800 and ORANGE or GREY) .. F.Duration(s) .. " pour l'échanger|r", s
end
local function refreshMain() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function after(fn) return function() ns.safe("butin", fn) U.Refresh() refreshMain() end end

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
  local st = { items = 0, handover = 0, notPassed = 0, master = Lx.IsMaster() }
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
    else todo[#todo + 1] = e end
  end
  L.Header("À distribuer · " .. #todo)
  if not st.master then L.Add(GREY .. "Tu n'es pas chef de butin : " .. (master and name(master) or "le chef de raid") .. " distribue le butin.|r") end
  if #todo == 0 then
    L.Add(GREY .. (Lx.test and "Aucun objet. Raid d'essai : ajoute un objet depuis le panneau d'essai."
      or "Aucun objet. Distribution activée, les objets que tu reçois au butin de groupe arrivent ici.") .. "|r")
  end
  for _, e in ipairs(todo) do
    st.items = st.items + 1
    local status = ""
    if e.status == "council" then
      local c = e.session and Lx.Council(e.session)
      status = GREEN .. "  · conseil en cours" .. (c and (" (" .. F.plural(#c.cands, "réponse") .. ")") or "") .. "|r"
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
-- Conseil du butin : un tableau, une ligne par joueur, votes ; « Donner » pour le chef de butin
--------------------------------------------------------------------------------------------------------------------
local councilWin, councilSession
local COUNCIL_COLS = {
  { title = "Joueur", w = 150 },
  { title = "Réponse", w = 80 },
  { title = "Porte", flex = 1.4, min = 150, small = true, lines = 2, tip = true },
  { title = "Note", flex = 1, min = 100, small = true, lines = 2, tip = true },
  { title = "Reçus", w = 90, justify = "CENTER", tip = true },
  { title = "Votes", flex = 0.8, min = 100, small = true, lines = 2 },
  { title = "", w = 168, buttons = true },
}
local RECV_COL = 5

function U.ShowCouncil(session)
  if not ns.db() then return end
  if not councilWin then
    local w = K.window("RosterLootCouncil", "Conseil du butin", 980, 420)
    local p = CreateFrame("Frame", nil, w)
    p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
    w.hintText = K.hint(p, "")
    w.hintText:SetPoint("RIGHT", p, "RIGHT", -10, 0)
    K.itemTips(p) -- objet du conseil, en titre
    w.grid = K.grid(p, -40, 44, COUNCIL_COLS)
    w.foot = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.foot:SetPoint("BOTTOMLEFT", 8, 4) w.foot:SetPoint("BOTTOMRIGHT", -26, 4)
    w.foot:SetJustifyH("LEFT")
    w.sized = K.resizable(w, "council", 720, 280, 1600, 1000, function() if councilWin and councilWin.grid then councilWin.grid.Layout() end end)
    councilWin = w
  end
  councilSession = session or councilSession
  K.front(councilWin)
  councilWin:Show()
  U.RefreshCouncil()
end

local function gearText(c)
  if c.whispered then return GREY .. "réponse chuchotée|r" end
  if #c.gear == 0 then return GREY .. "rien à cet emplacement|r" end
  local out = {}
  for _, g in ipairs(c.gear) do out[#out + 1] = (g.link or ("objet " .. g.id)) .. (g.ilvl and (GREY .. " " .. g.ilvl .. "|r") or "") end
  return table.concat(out, "\n")
end

function U.RefreshCouncil()
  if not councilWin or not councilWin:IsShown() then return end
  local Lx, G = Lo(), councilWin.grid
  local c = councilSession and Lx.Council(councilSession)
  local st = { session = councilSession, rows = 0 }
  U.state.council = st
  G.Reset()
  if not c then
    councilWin.hintText:SetText(GREY .. "Pas de conseil en cours.|r")
    councilWin.foot:SetText("")
    G.Done()
    return
  end
  st.closed, st.master = c.closed, c.isMaster
  local isCouncil = Lx.IsCouncil(c.master)
  local nVotes = 0
  for _, x in ipairs(c.cands) do nVotes = nVotes + x.votes end
  G.SetTitle(RECV_COL, c.counts and ("Reçus · " .. c.counts.short) or "Reçus ce soir")
  local head = c.link .. (c.ilvl and (GREY .. "  niv. " .. c.ilvl .. "|r") or "") .. GREY .. "  · chef de butin : " .. name(c.master) .. (c.isMaster and " (toi)" or "") .. "|r"
  if c.closed then
    head = head .. "\n" .. (c.winner and (GREEN .. "Conseil terminé : " .. name(c.winner) .. " reçoit l'objet.|r") or (GREY .. "Conseil annulé.|r"))
  else
    head = head .. "\n" .. GOLD .. F.plural(#c.cands, "réponse") .. "|r" .. GREY .. (#c.waiting > 0 and (", " .. #c.waiting .. " en attente") or "")
      .. "  · " .. F.plural(nVotes, "vote") .. " (conseil : " .. #c.council .. ")|r"
  end
  councilWin.hintText:SetText(head)
  for _, x in ipairs(c.cands) do
    st.rows = st.rows + 1
    local voters = {}
    for _, v in ipairs(x.voters) do voters[#voters + 1] = name(v) end
    local buttons = {}
    if not c.closed and x.response ~= "pass" then
      if isCouncil then
        buttons[#buttons + 1] = { (c.myVote and F.SameName(c.myVote, x.name)) and "Voté" or "Voter", 74, function() Lx.Vote(c.session, x.name) U.Refresh() end }
      end
      if c.isMaster then buttons[#buttons + 1] = { "Donner", 86, after(function() Lx.AwardCouncil(c.session, x.name) end) } end
    end
    local resp = x.response
    G.Row({
      who(x.name),
      (RESP_COLOR[resp] or GREY) .. (Lx.RESPONSES[resp] or resp) .. "|r",
      gearText(x),
      (x.note ~= "") and ("|cffc9cfdb« " .. x.note .. " »|r") or "",
      tostring(x.received) .. (x.receivedTonight > 0 and (GREY .. " (+" .. x.receivedTonight .. ")|r") or ""),
      #voters > 0 and ("|cffffffff" .. x.votes .. "|r " .. GREY .. table.concat(voters, ", ") .. "|r") or (GREY .. "0|r"),
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
          GameTooltip:SetText(name(x.name) .. " : objets reçus")
          if c.counts then GameTooltip:AddLine(x.receivedSite .. " sur le site, " .. c.counts.label, 1, 1, 1, true)
          else GameTooltip:AddLine("Données du site non chargées : colle-les dans l'onglet Synchro.", 1, 1, 1, true) end
          GameTooltip:AddLine(x.receivedTonight .. " ce soir (pas encore sur le site)", 1, 1, 1, true)
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
    or (GREY .. "Tout le monde a répondu.|r")) .. "\n" .. GREY .. "Survol : objet porté, note, détail des objets reçus. Votes visibles du conseil seulement."
    .. (c.isMaster and " « Donner » attribue l'objet (annonce dans le raid et au gagnant)." or "") .. "|r")
  -- Hauteur selon le nombre de réponses, tant que la fenêtre n'a pas été redimensionnée à la main
  local d = ns.db()
  if not (d and d.sizes and d.sizes.council) then councilWin:SetHeight(math.max(300, math.min(640, 160 + 30 * math.max(#c.cands, 3)))) end
end

--------------------------------------------------------------------------------------------------------------------
-- Réponse du joueur : BiS, Upgrade, Off-spec, Transmo ou Passer, avec une note
--------------------------------------------------------------------------------------------------------------------
local offerWin, offerSession
local function currentOffer(session)
  local list = Lo().Offers()
  if session then for _, o in ipairs(list) do if o.session == session and not o.answered then return o, list end end end
  for _, o in ipairs(list) do if not o.answered then return o, list end end
  return nil, list
end

function U.ShowOffer(session)
  if not ns.db() then return end
  -- Une réponse en cours reste affichée ; un nouvel objet proposé attend son tour
  local o, all = currentOffer((offerWin and offerWin:IsShown() and offerSession) or session)
  U.state.offer = { session = o and o.session, left = 0 }
  if not o then if offerWin then offerWin:Hide() end return end
  if not offerWin then
    local w = K.window("RosterLootOffer", "Butin · ta réponse", 540, 250)
    w:ClearAllPoints() w:SetPoint("TOP", 0, -140)
    K.itemTips(w) -- objet proposé et objets portés
    local x = K.gapX()
    w.text = w:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    w.text:SetPoint("TOPLEFT", x, -36) w.text:SetWidth(540 - x - 18) w.text:SetJustifyH("LEFT")
    w.noteLabel = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.noteLabel:SetPoint("TOPLEFT", x, -110) w.noteLabel:SetText(GREY .. "Note pour le conseil (facultatif) :|r")
    w.note = CreateFrame("EditBox", nil, w, "InputBoxTemplate")
    w.note:SetSize(540 - x - 30, 22) w.note:SetPoint("TOPLEFT", x + 4, -124) w.note:SetAutoFocus(false) w.note:SetMaxLetters(60)
    w.note:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
    w.buttons = {}
    for i, key in ipairs(Lo().ORDER) do
      local b = K.button(w, Lo().RESPONSES[key], 86, nil)
      b:SetPoint("TOPLEFT", x + (i - 1) * 90, -156)
      b:SetScript("OnClick", function()
        local cur = offerSession
        if cur then Lo().Answer(cur, key, offerWin.note:GetText()) offerWin.note:SetText("") end
        offerSession = nil
        U.ShowOffer()
        refreshMain()
      end)
      w.buttons[key] = b
    end
    w.foot = w:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    w.foot:SetPoint("TOPLEFT", x, -188) w.foot:SetWidth(540 - x - 18) w.foot:SetJustifyH("LEFT")
    offerWin = w
  end
  offerSession = o.session
  local gear = {}
  for _, g in ipairs(Lo().Equipped(o.itemString)) do gear[#gear + 1] = g.link .. (g.ilvl and (GREY .. " (" .. g.ilvl .. ")|r") or "") end
  local lvl = Lo().ilvlOf(o.itemString)
  local others = 0
  for _, x in ipairs(all) do if not x.answered and x ~= o then others = others + 1 end end
  U.state.offer.left = others
  offerWin.text:SetText(o.link .. (lvl and (GREY .. "  niv. " .. lvl .. "|r") or "") .. GREY .. "  proposé par " .. name(o.from) .. "|r\n"
    .. (#gear > 0 and ("Tu portes : " .. table.concat(gear, ", ")) or (GREY .. "Rien de porté à cet emplacement.|r"))
    .. (others > 0 and (GREY .. "\n" .. F.plural(others, "autre objet", "autres objets") .. " ensuite.|r") or ""))
  offerWin.foot:SetText(GREY .. "Ta réponse part au chef de butin et au conseil, qui votent. Sans l'addon, on peut chuchoter bis, up, os ou transmo au chef de butin.|r")
  K.front(offerWin)
  offerWin:Show()
end

--------------------------------------------------------------------------------------------------------------------
-- Objets à remettre (chef de butin) : échange au gagnant, objet posé tout seul dans la fenêtre d'échange
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
  handWin.hintText:SetText(GREY .. "« Échanger » demande l'échange au gagnant (à quelques mètres de toi) et y pose l'objet ; valide ensuite dans la fenêtre d'échange du jeu. Hors combat.|r")
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
  if offerWin and offerWin:IsShown() then
    local o = offerSession and currentOffer(offerSession)
    if not o or o.session ~= offerSession then ns.safe("réponse au conseil", U.ShowOffer) end
  end
end

function U.Close()
  for _, w in ipairs({ lootWin, councilWin, offerWin, handWin }) do if w then w:Hide() end end
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
