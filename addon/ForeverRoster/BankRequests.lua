-- Demandes de retrait à la banque (1.6.4) : le site met dans le bloc FRG les demandes de retrait en cours (lignes Q) et les
-- banquiers de la guilde (ligne H) ; les mêmes pour tous les membres (Format.lua, docs/addon-format.md). Quand la banque de
-- guilde s'ouvre et que l'un de mes persos est officier (ligne O) ou banquier (ligne H) d'un groupe qui a des demandes en cours
-- (la ligne H ne porte que le perso main du banquier : il ouvre la banque avec n'importe quel perso du compte, comme le relais
-- des inscriptions, Relay.lua), une petite fenêtre « Demandes de retrait (N) » s'ouvre à côté de la banque : qui, objet (lien : infobulle au survol, Maj+clic
-- dans le chat), quantité, onglet où l'objet se trouve d'après le relevé de la banque en cours (Guild.lua, G.BankTabsOf ;
-- « … » tant que le relevé n'est pas fini, « — » si l'objet n'y est pas), étape (« En attente », « Préparée par X »).
-- Lecture seule : on marque « Préparée » ou « Remise » sur le site. Rien n'est envoyé, ni au site ni aux autres joueurs.
-- Jamais en combat ni pendant une rencontre (elle revient à la fin) ; fermée avec la banque, ou par le joueur (elle ne
-- rouvre alors qu'à la prochaine ouverture de la banque). Guild.lua prévient de l'ouverture, de la fermeture et de chaque
-- étape du relevé ; Group.lua, de chaque chargement des données du site.
local _, ns = ...
local L, N = ns.L, ns.N
local K = ns.Kit
local B = {}
ns.BankRequests = B

local LABEL = N("demandes de retrait")
B.Label = LABEL
local GOLD, INK, GREEN = K.GOLD, K.INK, K.GREEN
local WIDTH = 560        -- largeur de la fenêtre : une petite fenêtre, qui tient à côté de la banque (770 px) sur un écran de 1366
local ROW = 28           -- hauteur d'une ligne (deux lignes de petit texte)
local MAX_ROWS = 8       -- lignes visibles sans défiler (la fenêtre grandit jusque-là)
local NONE, LATER = "—", "…"
-- Intitulés traduits à l'affichage (Check)
-- Les textes longs (objet, onglets, « Préparée par X ») passent à la ligne ou sont coupés plutôt que d'élargir la fenêtre
local COLS = {
  { title = N("Qui"), w = 68 },
  { title = N("Objet"), flex = 1, min = 140, small = true, lines = 2 },
  { title = N("Qté"), w = 38, justify = "RIGHT" },
  { title = N("Onglet"), flex = 0.8, min = 100, small = true, lines = 2 },
  { title = N("Étape"), w = 120, small = true, lines = 2 },
}

--------------------------------------------------------------------------------------------------------------------
-- Outils
--------------------------------------------------------------------------------------------------------------------
-- Fonction du jeu qui peut manquer ou lever une erreur : ses valeurs, sinon rien
local function back(ok, ...) if ok then return ... end end
local function call(fn, ...)
  if type(fn) ~= "function" then return end
  return back(pcall(fn, ...))
end
-- Un de mes persos est dans cette liste de prénoms (mine : Group.MyChars, prénoms seuls en minuscules ; Group.First compare
-- sans royaume, sans nom de famille de Forever ni casse : « Gorrak Fendroc », « Gorrak-Forever EU » → gorrak)
local function has(list, mine)
  for _, name in ipairs(list or {}) do if mine[ns.Group.First(name)] then return true end end
  return false
end
-- Combat ou rencontre en cours (Guild.lua suit ENCOUNTER_START / ENCOUNTER_END) : pas de fenêtre
local function busy()
  if ns.Guild and ns.Guild.Busy then return ns.Guild.Busy() end
  local r = call(InCombatLockdown)
  return not ns.secret(r) and (r == true or r == 1)
end

local state = { open = false, dismissed = false } -- banque ouverte ; fenêtre fermée par le joueur (jusqu'à la prochaine ouverture)
local win
local wanted = {} -- objets des lignes affichées (pour reprendre leur vrai nom quand le jeu les envoie)
local linked = setmetatable({}, { __mode = "k" }) -- lignes du tableau dont le lien d'objet est déjà branché

--------------------------------------------------------------------------------------------------------------------
-- Quel groupe, quelles lignes
--------------------------------------------------------------------------------------------------------------------
-- Groupe dont j'affiche les demandes : un groupe où l'un de mes persos (celui connecté, ceux du compte déjà vus par l'addon,
-- Group.MyChars) est officier (ligne O) ou banquier (ligne H) et qui a des demandes en cours. Plusieurs : celui qui porte le
-- nom de ma guilde du jeu, sinon le premier par nom.
local function pick()
  local mine = ns.Group.MyChars()
  local guild = ns.str((call(GetGuildInfo, "player")))
  local found
  for _, g in ipairs(ns.Group.List()) do
    if #(g.requests or {}) > 0 and (has(g.officers, mine) or has(g.bankers, mine)) then
      if guild and g.name == guild then return g end
      found = found or g
    end
  end
  return found
end

-- Onglets où se trouve l'objet d'après le relevé de la banque en cours
local function tabsOf(itemId)
  local list, complete = ns.Guild.BankTabsOf(itemId)
  if not list then return INK .. NONE .. "|r" end
  if not complete then return INK .. LATER .. "|r" end
  if #list == 0 then return INK .. NONE .. "|r" end
  local names = {}
  for _, t in ipairs(list) do names[#names + 1] = t.name ~= "" and t.name or L("Onglet %d", t.tab) end
  return table.concat(names, ", ")
end

local function stepOf(q)
  if q.status ~= "prepared" then return GOLD .. L["En attente"] .. "|r" end
  return GREEN .. (q.by ~= "" and L("Préparée par %s", q.by) or L["Préparée"]) .. "|r"
end

--------------------------------------------------------------------------------------------------------------------
-- Fenêtre (boîte à outils : habillage Forever ou site)
--------------------------------------------------------------------------------------------------------------------
-- Cachée par le code (banque fermée, combat, plus de demande) : elle reviendra ; cachée par le joueur : plus avant la prochaine ouverture
local function hide(auto)
  if win and win:IsShown() then win.auto = auto win:Hide() end
end

local function build()
  win = K.window("ForeverRosterBankRequests", L("Demandes de retrait (%d)", 0), WIDTH, 280)
  win.skin, win.auto, win.beside, win.moved = K.site(), false, false, false
  local p = CreateFrame("Frame", nil, win)
  p:SetPoint("TOPLEFT", 14, K.site() and -36 or -28) p:SetPoint("BOTTOMRIGHT", -12, 10)
  win.sub = K.hint(p, "")
  win.sub:SetWidth(WIDTH - 14 - 12 - (K.site() and 6 or 52) - 6)
  if win.sub.SetMaxLines then win.sub:SetMaxLines(1) end
  win.grid = K.grid(p, -22, 44, COLS)
  win.foot = p:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  win.foot:SetPoint("BOTTOMLEFT", 8, 10) win.foot:SetWidth(WIDTH - 14 - 12 - 110) win.foot:SetJustifyH("LEFT")
  win.close = K.button(p, L["Fermer"], 90, function() win:Hide() end)
  win.close:SetPoint("BOTTOMRIGHT", -4, 8)
  win:SetScript("OnHide", function(self)
    if not self.auto then state.dismissed = true end
    self.auto = false
  end)
  -- Déplacée par le joueur : elle reste où il l'a mise
  if win.HookScript then win:HookScript("OnDragStop", function(self) self.moved = true end) end
end

-- À côté de la banque de guilde (à sa droite) ; sans elle (le cadre de la banque n'est pas encore créé à l'ouverture), en haut
-- de l'écran, puis à côté dès que le cadre existe (aux remises à jour suivantes), tant que le joueur ne l'a pas déplacée
local function place()
  win:ClearAllPoints()
  local bank = GuildBankFrame
  win.beside = type(bank) == "table" and bank.GetObjectType ~= nil and pcall(win.SetPoint, win, "TOPLEFT", bank, "TOPRIGHT", 6, 0)
  if win.beside then return end
  win:ClearAllPoints()
  win:SetPoint("TOP", 0, -140)
end

local function render(g)
  if not win or win.skin ~= K.site() then
    hide(true)
    build()
  end
  local again = win:IsShown() -- remise à jour : elle reste où le joueur l'a mise
  local n = #g.requests
  win.heading = L("Demandes de retrait (%d)", n)
  win:SetWindowTitle(win.heading)
  local G = win.grid
  for i, col in ipairs(COLS) do G.SetTitle(i, L[col.title]) end
  local at = tonumber(g.at) or 0
  win.sub:SetText(INK .. (at > 0 and L("%s · données du site reçues le %s à %s", g.name or "", date("%d/%m", at), date("%H:%M", at)) or (g.name or "")) .. "|r")
  win.foot:SetText(INK .. L["Lecture seule : on marque « Préparée » ou « Remise » sur le site."] .. "|r")
  win.close:SetText(L["Fermer"])
  wanted = {}
  G.Reset()
  for _, q in ipairs(g.requests) do
    wanted[q.itemId] = true
    G.Row({ "|cffffffff" .. q.who .. "|r", ns.Group.displayLink(q.itemId), "|cffffffff" .. L("×%d", q.n) .. "|r", tabsOf(q.itemId), stepOf(q) }, { height = ROW })
    -- Le lien de l'objet : infobulle au survol, Maj+clic dans le chat (une fois par ligne, les lignes sont réutilisées)
    local row = G.rows[G.n]
    if not linked[row] then linked[row] = true K.itemTips(row) end
  end
  G.Done()
  win:SetHeight(140 + ROW * math.min(math.max(n, 2), MAX_ROWS))
  if again then
    if not (win.beside or win.moved) and GuildBankFrame then place() end
    return
  end
  win.moved = false
  place()
  K.front(win)
  win:Show()
end

--------------------------------------------------------------------------------------------------------------------
-- Ouverture, fermeture, remise à jour
--------------------------------------------------------------------------------------------------------------------
-- La fenêtre due maintenant, ou rien : à l'ouverture de la banque, à chaque étape du relevé, à chaque chargement des
-- données du site, à la fin d'un combat ou d'une rencontre. Vrai si elle est (ou reste) ouverte.
function B.Check()
  if not ForeverRosterDB then return false end
  if not state.open or busy() then hide(true) return false end
  local g = pick()
  if not g then hide(true) return false end
  if state.dismissed then return false end
  render(g)
  return true
end

-- La banque de guilde s'ouvre (G.BankOpened) : la fenêtre est de nouveau permise, même fermée la fois d'avant
function B.Opened()
  if not state.open then state.open, state.dismissed = true, false end
  return B.Check()
end

function B.Closed()
  state.open, state.dismissed = false, false
  hide(true)
end

function B.Window() return win end

-- Combat ou rencontre : fenêtre cachée (elle revient après)
ns.on("PLAYER_REGEN_DISABLED", function() hide(true) end)
ns.on("ENCOUNTER_START", function() hide(true) end)
ns.on("PLAYER_REGEN_ENABLED", function() ns.safe(LABEL, B.Check) end)
ns.on("ENCOUNTER_END", function() ns.safe(LABEL, B.Check) end)

-- Un objet arrive du serveur (premier affichage) : la fenêtre reprend son vrai nom
local itemsDue = false
local function itemArrived(id)
  if itemsDue or not (win and win:IsShown()) then return end
  if type(id) == "number" and not wanted[id] then return end
  itemsDue = true
  C_Timer.After(0.3, function()
    itemsDue = false
    ns.safe(LABEL, B.Check)
  end)
end
ns.on("GET_ITEM_INFO_RECEIVED", itemArrived)
ns.on("ITEM_DATA_LOAD_RESULT", itemArrived) -- clients récents (C_Item.RequestLoadItemDataByID)
