-- Export des persos vers le site (format FRC v1, un bloc par perso, voir docs/addon-format.md).
-- Chaque perso est relevé automatiquement quand il change ; l'export les contient tous.
local _, ns = ...
local L, N = ns.L, ns.N
local E = {}
ns.Export = E

-- Emplacements d'équipement du jeu (sans chemise ni tabard)
local SLOTS = { 1, 2, 3, 15, 5, 9, 10, 6, 7, 8, 11, 12, 13, 14, 16, 17, 18 }

-- Patrons connus : relevés à chaque ouverture d'une fenêtre de métier (le jeu ne les donne pas autrement)
local function idFrom(link, kind)
  return link and tonumber(link:match(kind .. ":(%d+)"))
end
local function scan(numFn, infoFn, recipeLinkFn, itemLinkFn, nameFn)
  if not numFn then return end
  local prof = nameFn and nameFn()
  if not prof or prof == "" or prof == "UNKNOWN" then return end
  local db = ns.charDB()
  db.recipes[prof] = db.recipes[prof] or {}
  local list, n = db.recipes[prof], 0
  for i = 1, numFn() or 0 do
    local name, kind = infoFn(i)
    if name and kind ~= "header" and kind ~= "subheader" then
      local spell = recipeLinkFn and idFrom(recipeLinkFn(i), "enchant")
      local item = itemLinkFn and idFrom(itemLinkFn(i), "item")
      local enchant = (not spell and itemLinkFn) and idFrom(itemLinkFn(i), "enchant")
      local key = spell and ("s" .. spell) or enchant and ("s" .. enchant) or item and ("i" .. item)
      if key and not list[key] then list[key] = true n = n + 1 end
    end
  end
  if n > 0 then ns.print(L("%d patron(s) de %s ajouté(s) à l'export.", n, prof)) end
end

-- Compétence du métier ouvert, gardée pour l'export (repli si le jeu ne liste pas les compétences)
local function remember(prof, rank, maxRank)
  if not prof or prof == "" or not tonumber(rank) then return end
  local db = ns.charDB()
  db.skills = db.skills or {}
  db.skills[prof] = { tonumber(rank), tonumber(maxRank) or 0 }
end

local function scanTradeSkill()
  if GetTradeSkillLine then remember(GetTradeSkillLine()) end
  scan(GetNumTradeSkills, function(i) local name, kind = GetTradeSkillInfo(i) return name, kind end,
    GetTradeSkillRecipeLink, GetTradeSkillItemLink, function() return (GetTradeSkillLine()) end)
end
local function scanCraft()
  scan(GetNumCrafts, function(i) local name, _, kind = GetCraftInfo(i) return name, kind end,
    GetCraftRecipeLink, GetCraftItemLink, function() return (GetCraftDisplaySkillLine and GetCraftDisplaySkillLine()) or (GetCraftSkillLine and GetCraftSkillLine(1)) end)
end
-- API moderne des métiers (C_TradeSkillUI) : la recette est directement l'identifiant du sort
local function scanModern()
  local T = C_TradeSkillUI
  if not (T and T.GetAllRecipeIDs) then return end
  local line = T.GetBaseProfessionInfo and T.GetBaseProfessionInfo() or (T.GetTradeSkillLine and { professionName = (T.GetTradeSkillLine()) })
  local prof = type(line) == "table" and (line.professionName or line.parentProfessionName) or nil
  if not prof or prof == "" then return end
  remember(prof, line.skillLevel, line.maxSkillLevel)
  local db = ns.charDB()
  db.recipes[prof] = db.recipes[prof] or {}
  local n = 0
  for _, id in ipairs(T.GetAllRecipeIDs() or {}) do
    local info = T.GetRecipeInfo and T.GetRecipeInfo(id)
    if (not info or info.learned) and not db.recipes[prof]["s" .. id] then db.recipes[prof]["s" .. id] = true n = n + 1 end
  end
  if n > 0 then ns.print(L("%d patron(s) de %s ajouté(s) à l'export.", n, prof)) end
end
local function onTradeSkill()
  C_Timer.After(0.3, function()
    ns.safe(N("patrons"), function()
      if GetNumTradeSkills then scanTradeSkill() else scanModern() end
      if E.autoSnapshot then E.autoSnapshot() end
    end)
  end)
end
ns.on("TRADE_SKILL_SHOW", onTradeSkill)
ns.on("TRADE_SKILL_UPDATE", onTradeSkill)
ns.on("TRADE_SKILL_LIST_UPDATE", onTradeSkill)
if GetNumCrafts then
  local onCraft = function() C_Timer.After(0.3, function() ns.safe(N("patrons"), scanCraft) end) end
  ns.on("CRAFT_SHOW", onCraft)
  ns.on("CRAFT_UPDATE", onCraft)
end

-- Lignes du perso connecté : équipement (G), métiers (P), patrons (R), talents (T).
-- quiet : relevé automatique, sans message dans le chat.
local function captureLines(quiet)
  local lines = {}
  ns.safe(N("équipement"), function()
    for _, slot in ipairs(SLOTS) do
      local id = GetInventoryItemID("player", slot)
      if id then lines[#lines + 1] = { "G", slot, id } end
    end
  end)
  -- Métiers et compétences (noms tels qu'affichés par le jeu ; le site reconnaît l'anglais et le français).
  -- Trois sources, selon l'API du client : liste des compétences (Classic), GetProfessions (moderne),
  -- puis la dernière compétence vue dans chaque fenêtre de métier.
  local seen, profs = {}, 0
  local function add(name, rank, maxRank)
    if not name or name == "" or seen[name] then return end
    seen[name] = true
    lines[#lines + 1] = { "P", name, tonumber(rank) or 0, tonumber(maxRank) or 0 }
    profs = profs + 1
  end
  ns.safe(N("métiers"), function()
    if not (GetNumSkillLines and GetSkillLineInfo) then return end
    for i = 1, GetNumSkillLines() or 0 do
      local name, isHeader, _, rank, _, _, maxRank = GetSkillLineInfo(i)
      if not isHeader then add(name, rank, maxRank) end
    end
  end)
  ns.safe(N("métiers"), function()
    if not (GetProfessions and GetProfessionInfo) then return end
    local idx = { GetProfessions() }
    for i = 1, 6 do
      if idx[i] then
        local name, _, rank, maxRank = GetProfessionInfo(idx[i])
        add(name, rank, maxRank)
      end
    end
  end)
  local db = ns.charDB()
  for prof, v in pairs(db.skills or {}) do add(prof, v[1], v[2]) end
  if profs == 0 and not quiet then ns.print(L["aucun métier lu : ouvre une fois chaque fenêtre de métier, puis actualise l'export."]) end
  for prof, list in pairs(db.recipes or {}) do
    for key in pairs(list) do lines[#lines + 1] = { "R", prof, key } end
  end
  -- Chaque partie est protégée : une erreur (API du jeu différente) n'empêche pas d'exporter le reste
  local okT, talents, why = pcall(ns.Talents.Capture)
  if not quiet then
    if not okT then ns.print(L("talents non exportés : %s", tostring(talents)))
    elseif not talents then ns.print(L("talents non exportés : %s", tostring(why))) end
  end
  if okT and talents then
    for _, n in ipairs(talents.nodes) do
      if n.visible then lines[#lines + 1] = { "T", n.id, n.rank, n.max, n.x, n.y, n.spell, n.sub, n.tree } end
    end
  end
  return lines
end

-- Identité du perso pour le site (1.6.2, fin de l'en-tête FRC) : GUID et nom complet de Forever (« Prénom Nom »).
-- Fonctions du jeu cherchées à l'appel (elles peuvent manquer sur ce client) et appelées sous pcall ; valeur secrète,
-- absente ou d'une autre forme : ignorée (ns.str).
local function gameValue(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  return ok and ns.str(v) or nil
end
-- GUID du perso connecté (Player-<serveur>-<hex>), sinon nil
local function playerGuid()
  local v = gameValue(UnitGUID, "player")
  if v and #v <= 80 and v:match("^Player%-%d+%-%x+$") then return v end
end
-- « Prénom » ou « Prénom Nom » (exact = true : il faut un nom de famille) ; « Prénom-Royaume », un titre ou autre chose : non
local function fullNameOf(full, first, exact)
  if type(full) ~= "string" or type(first) ~= "string" or first == "" or #full > 80 or full:find("[|\r\n;]") then return false end
  if full == first then return not exact end
  return full:sub(1, #first + 1) == first .. " " and full:find("%S", #first + 2) ~= nil
end
-- Nom complet donné par le jeu, s'il en donne un (le client de Retail n'a pas de nom de famille : UnitFullName et
-- GetUnitName ne donnent en général que le prénom, gardés seulement s'ils ont le nom de famille)
local function gameFullName(first)
  for _, v in ipairs({ gameValue(UnitFullName, "player") or false, gameValue(GetUnitName, "player", true) or false }) do
    if v and fullNameOf(v, first, true) then return v end
  end
end
-- Nom complet d'un perso : celui de la liste de guilde relevée pour son GUID (Guild.lua), sinon celui du jeu, sinon ""
local function fullName(snap)
  local h = snap.header or {}
  local guid, first = h.guid, h.name
  if guid then
    for _, g in pairs(ForeverRosterDB.guilds or {}) do
      for _, m in ipairs(g.roster and g.roster.members or {}) do
        if m.guid == guid and fullNameOf(m.name, first, false) then return m.name end
      end
    end
  end
  return fullNameOf(h.gameName, first, true) and h.gameName or ""
end

-- Relevé du perso connecté, gardé dans la sauvegarde (commune au compte) : l'export contient ainsi tous les persos.
function E.Snapshot(quiet)
  local _, raceFile = UnitRace("player")
  local c = ns.charDB()
  local name = UnitName("player")
  c.snapshot = {
    header = { name = name, realm = GetRealmName(), class = select(2, UnitClass("player")), race = raceFile,
      level = UnitLevel("player"), faction = (UnitFactionGroup("player")), guid = playerGuid(), gameName = gameFullName(name) },
    lines = captureLines(quiet), at = time(),
  }
  return c.snapshot
end

-- Relevé automatique quand quelque chose change (au plus un par seconde)
local pending = false
local function autoSnapshot()
  if pending or not ForeverRosterDB then return end
  pending = true
  C_Timer.After(1, function()
    pending = false
    ns.safe(N("relevé du perso"), E.Snapshot, true)
    if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
  end)
end
E.autoSnapshot = autoSnapshot
for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_LEVEL_UP", "TRAIT_CONFIG_UPDATED",
  "SKILL_LINES_CHANGED", "PLAYER_LOGOUT" }) do
  ns.on(event, event == "PLAYER_LOGOUT" and function() ns.safe(N("relevé du perso"), E.Snapshot, true) end or autoSnapshot)
end

-- Persos relevés sur ce compte (le perso connecté en premier)
function E.Characters()
  local current, out = ns.charKey(), {}
  for key, c in pairs(ForeverRosterDB.chars or {}) do
    if c.snapshot then out[#out + 1] = { key = key, current = key == current, snap = c.snapshot, char = c } end
  end
  table.sort(out, function(a, b)
    if a.current ~= b.current then return a.current end
    return a.key < b.key
  end)
  return out
end

function E.Forget(key)
  local c = ForeverRosterDB.chars and ForeverRosterDB.chars[key]
  if c then c.snapshot = nil end
end

-- Lignes d'un perso pour l'export : relevé + inscriptions + patrons marqués en jeu.
-- Inscriptions confiées par la guilde (lignes V, Relay.lua, 1.6.3) : seulement dans le bloc du perso connecté (elles
-- comptent dans son empreinte : le bloc repart) ; relayed : ces lignes-là à la place (empreinte d'un bloc déjà écrit,
-- ou {} : sans elles)
local function linesOf(c, snap, relayed)
  local lines = {}
  for _, l in ipairs(snap.lines or {}) do lines[#lines + 1] = l end
  ns.safe(N("inscriptions"), function() for _, l in ipairs(ns.Group.SignupLines(c)) do lines[#lines + 1] = l end end)
  if relayed then for _, l in ipairs(relayed) do lines[#lines + 1] = l end
  elseif ns.Relay and c == ns.charDB() then ns.safe(N("relais"), function() for _, l in ipairs((ns.Relay.Lines())) do lines[#lines + 1] = l end end) end
  ns.safe(N("recherchés"), function() for _, l in ipairs(ns.Group.WantedLines(c)) do lines[#lines + 1] = l end end)
  ns.safe(N("consommables"), function() for _, l in ipairs(ns.Group.ConsumableLines(c)) do lines[#lines + 1] = l end end)
  return ns.Format.Compact(lines)
end

local function block(c, snap)
  local h = {}
  for k, v in pairs(snap.header or {}) do h[k] = v end
  h.time, h.addon, h.fullName = snap.at or 0, ns.version, fullName(snap)
  return ns.Format.BuildFRC(h, linesOf(c, snap))
end

-- Empreinte du contenu d'un perso (sans la date du relevé) : sert à savoir s'il a changé depuis le dernier envoi
local function hash(str) return ns.Format.Hash(str) end
local function signature(c, snap, relayed)
  local parts = { tostring(snap.header and snap.header.level) }
  for _, l in ipairs(linesOf(c, snap, relayed)) do
    local f = {}
    for i, v in ipairs(l) do f[i] = tostring(v) end
    parts[#parts + 1] = table.concat(f, ";")
  end
  -- Heure des clics d'inscription en jeu (1.5.4) : un nouveau clic fait repartir le perso, même statut compris
  local ok, stamp = pcall(ns.Group.SignupStamp, c)
  if ok and stamp ~= "" then parts[#parts + 1] = stamp end
  -- GUID et nom complet (1.6.2) : le perso repart une fois quand ils sont connus (le site rapproche les persos par GUID) ;
  -- un relevé plus ancien, sans GUID, garde son empreinte
  local guid = snap.header and snap.header.guid
  if guid then parts[#parts + 1] = "guid;" .. guid .. ";" .. fullName(snap) end
  return hash(table.concat(parts, "\n"))
end

-- Le perso n'a rien de nouveau à envoyer
function E.IsSent(c)
  return c.snapshot ~= nil and c.sentSig ~= nil and c.sentSig == signature(c, c.snapshot)
end

-- Retire ce que le site a déjà (inscriptions enregistrées) sans faire repartir le perso pour autant.
-- relayed (accusé lu sur un autre perso que celui-ci, 1.6.3) : les lignes V écrites dans son bloc ; elles ne comptent
-- plus dans son empreinte (elles suivent le perso connecté), il est aussi à jour si son empreinte avec elles est la sienne
function E.Quietly(c, change, relayed)
  local was = E.IsSent(c) or (relayed ~= nil and c.snapshot ~= nil and c.sentSig ~= nil and c.sentSig == signature(c, c.snapshot, relayed))
  change()
  if was then c.sentSig = signature(c, c.snapshot) end
end

-- Persos qui ont changé depuis leur dernier envoi
function E.Pending()
  local out = {}
  for _, e in ipairs(E.Characters()) do
    if e.char.sentSig ~= signature(e.char, e.snap) then out[#out + 1] = e end
  end
  return out
end

-- Export : un bloc FRC par perso. Par défaut, seulement les persos qui ont changé depuis le dernier envoi ;
-- opts.all : tous les persos relevés ; opts.onlyCurrent : le perso connecté seul. Renvoie le texte et les persos inclus.
-- Après les persos et les bilans de raid (1.6.2) : le relevé de chaque guilde (FRL) qui a changé depuis son dernier envoi
-- (tous avec opts.all). En dernier : un site d'avant 1.6.2 ne reconnaît un collage que s'il commence par FRC ou FRB.
function E.Build(opts)
  opts = type(opts) == "table" and opts or { onlyCurrent = opts == true, all = true }
  E.Snapshot(false)
  local blocks, included = {}, {}
  for _, e in ipairs(E.Characters()) do
    local wanted = (opts.onlyCurrent and e.current) or (not opts.onlyCurrent and (opts.all or e.char.sentSig ~= signature(e.char, e.snap)))
    if wanted then
      blocks[#blocks + 1] = block(e.char, e.snap)
      included[#included + 1] = e
      -- Inscriptions confiées par la guilde mises dans ce bloc (Relay.lua) : clés et clics, oubliées au Ctrl+C
      if e.current and ns.Relay then
        local ok, _, sent = pcall(ns.Relay.Lines)
        if ok then included.relayed = sent end
      end
    end
  end
  -- Bilans de raid relevés (présence et butin) : ceux pas encore envoyés, ou ceux des 3 derniers jours avec opts.all
  local logs = {}
  if not opts.onlyCurrent and ns.Recorder then
    for _, log in ipairs(opts.all and ns.Recorder.Recent(3) or ns.Recorder.Pending()) do
      blocks[#blocks + 1] = ns.Recorder.Block(log)
      logs[#logs + 1] = log
    end
  end
  included.logs = logs
  local guilds = {}
  if not opts.onlyCurrent and ns.Guild then
    for _, g in ipairs(ns.Guild.Pending(opts.all)) do
      blocks[#blocks + 1] = g.text
      guilds[#guilds + 1] = g
    end
  end
  included.guilds = guilds
  return table.concat(blocks, "\n"), included
end

-- Contenu d'un export : nombre d'éléments, et leurs noms à afficher (persos, « bilan de … », puis relevés de guilde)
function E.Size(included)
  included = included or {}
  return #included + #(included.guilds or {}) + #(included.logs or {})
end
function E.Names(included, color)
  local names = {}
  for _, e in ipairs(included or {}) do
    local h = e.snap.header or {}
    names[#names + 1] = color and color(h.class, h.name or e.key) or (h.name or e.key)
  end
  for _, log in ipairs((included or {}).logs or {}) do names[#names + 1] = L("bilan de %s", log.name or "raid") end
  for _, g in ipairs((included or {}).guilds or {}) do names[#names + 1] = L("relevé de la guilde %s", g.name) end
  return names
end

-- Roster Companion (lot K1) : blocs à envoyer (persos changés depuis leur dernier envoi), avec leur empreinte.
-- Le site renvoie l'empreinte des blocs reçus (accusés, ForeverRoster_Data) : le perso est alors marqué envoyé.
function E.Outbox()
  local out = {}
  for _, e in ipairs(E.Pending()) do
    local sig = signature(e.char, e.snap)
    out[#out + 1] = { kind = "frc", key = e.key, sig = sig, text = block(e.char, e.snap) }
    ns.safe(N("inscriptions"), ns.Group.MarkOut, e.char, sig)
    -- Inscriptions confiées par la guilde (lignes V du perso connecté) : écrites dans ce bloc (Relay.lua)
    if e.current and ns.Relay then ns.safe(N("relais"), ns.Relay.MarkOut, e.key, sig) end
  end
  return out
end

-- L'export a été copié (Ctrl+C) : ces persos sont à jour sur le site jusqu'au prochain changement.
-- Inscriptions confiées par la guilde copiées avec le perso connecté (Relay.lua) : oubliées (si leur clic n'a pas changé
-- depuis) ; son empreinte est notée sans lignes V : celles arrivées ou changées entre-temps restent à envoyer.
local NO_RELAYED = {}
function E.MarkSent(included)
  if included and included.relayed and ns.Relay then ns.safe(N("relais"), ns.Relay.Forget, included.relayed) end
  for _, e in ipairs(included or {}) do
    e.char.sentSig = signature(e.char, e.snap, e.current and NO_RELAYED or nil)
    e.char.sentAt = time()
    ns.safe(N("inscriptions"), ns.Group.MarkReceived, e.char, nil)
  end
  if ns.Guild then ns.Guild.MarkSent((included or {}).guilds) end
  if ns.Recorder then ns.Recorder.MarkSent((included or {}).logs) end
  if ns.Minimap and ns.Minimap.Update then ns.Minimap.Update() end
end
