-- Formats d'échange de Roster (WoW Retail) avec roster.sleyvazh.fr (docs/addon-format.md, section Roster, lot R3) :
--   RRG v1 : données des groupes (site → jeu ; lignes O, L, N, et D depuis l'addon 0.3) ; RRR v1 : compo d'un raid
--   (site → jeu) ; RRB v1 : bilan d'un raid (jeu → site).
-- Noms en jeu « Prénom-Royaume », royaume normalisé comme le jeu (GetNormalizedRealmName). Pour comparer : casse, accents
-- et apostrophes ignorés. Ce fichier n'utilise du jeu que le royaume du joueur : il est testé hors jeu (roster_format_test.lua).
local _, ns = ...
ns = ns or {}
local F = {}
ns.Format = F

-- Valeur secrète du jeu (12.x) : ni comparaison, ni clé de table, ni calcul
local function secret(v) return issecretvalue ~= nil and issecretvalue(v) == true end
F.secret = secret
local function usable(v) return type(v) == "string" and not secret(v) end
F.usable = usable

local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
F.trim = trim

local function split(line)
  local out = {}
  for field in (line .. ";"):gmatch("([^;]*);") do out[#out + 1] = field end
  return out
end
F.split = split

-- Texte venu du site, affiché en jeu : sans « | » (codes du jeu : couleurs, liens, textures), longueur bornée
local function txt(s, max)
  s = tostring(s or ""):gsub("|", "")
  return trim(s:sub(1, max or 80))
end
F.txt = txt

-- Retire ce qui casserait une ligne : « ; », « | » (échappement du chat) et retours à la ligne
function F.clean(s)
  return (tostring(s or ""):gsub("[;|\r\n]", " "))
end

-- Coupe un texte à n octets sans couper un caractère UTF-8 en deux (é, œ…)
function F.cut(s, n)
  s = tostring(s or "")
  if #s <= n then return s end
  s = s:sub(1, n)
  local i = #s
  while i > 0 and s:byte(i) >= 128 and s:byte(i) < 192 do i = i - 1 end
  if i > 0 and s:byte(i) >= 192 then
    local lead = s:byte(i)
    local need = lead >= 240 and 4 or (lead >= 224 and 3 or 2)
    if #s - i + 1 < need then s = s:sub(1, i - 1) end
  end
  return s
end

local function plural(n, word, words) return n .. " " .. (n > 1 and (words or (word .. "s")) or word) end
F.plural = plural

--------------------------------------------------------------------------------------------------------------------
-- Noms « Prénom-Royaume »
--------------------------------------------------------------------------------------------------------------------
-- Royaume normalisé comme GetNormalizedRealmName : sans espaces, tirets ni points (apostrophes et parenthèses gardées)
function F.Normalize(realm)
  if not usable(realm) then return "" end
  return (realm:gsub("\194\160", ""):gsub("[%s%-%.]", ""))
end

-- Royaume du joueur (F.realm : forcé par les tests)
function F.MyRealm()
  if F.realm then return F.realm end
  if GetNormalizedRealmName then
    local ok, r = pcall(GetNormalizedRealmName)
    if ok and usable(r) and r ~= "" then return r end
  end
  if GetRealmName then
    local ok, r = pcall(GetRealmName)
    if ok and usable(r) and r ~= "" then return F.Normalize(r) end
  end
  return ""
end

-- « Prénom-Royaume » ; royaume absent ou vide : celui du joueur. Le nom peut déjà contenir son royaume.
function F.FullName(name, realm)
  if not usable(name) then return nil end
  name = trim(name)
  -- Lien de joueur (chat) : « |Hplayer:Prénom-Royaume|h[Prénom]|h »
  name = name:match("|Hplayer:([^|:]+)") or name
  if name == "" then return nil end
  local base, own = name:match("^([^%-]+)%-(.+)$")
  if base then name = base end
  local r = usable(realm) and F.Normalize(realm) or ""
  if r == "" and own then r = F.Normalize(own) end
  if r == "" then r = F.MyRealm() end
  if r == "" then return name end
  return name .. "-" .. r
end

-- Prénom et royaume d'un nom complet
function F.Split(full)
  if not usable(full) then return nil, nil end
  local name, realm = full:match("^([^%-]+)%-(.+)$")
  if name then return name, realm end
  return full, nil
end

-- Accents (UTF-8 sur deux octets) ramenés à la lettre de base, pour comparer « Brumelune » et « Brümelune »
local FOLD = { ["æ"] = "ae", ["Æ"] = "ae", ["œ"] = "oe", ["Œ"] = "oe", ["ß"] = "ss", ["ð"] = "d", ["Ð"] = "d", ["þ"] = "th", ["Þ"] = "th" }
for base, chars in pairs({ a = "àáâãäåÀÁÂÃÄÅ", c = "çÇ", e = "èéêëÈÉÊË", i = "ìíîïÌÍÎÏ", n = "ñÑ", o = "òóôõöøÒÓÔÕÖØ", u = "ùúûüÙÚÛÜ", y = "ýÿÝ" }) do
  for ch in chars:gmatch("[\192-\223][\128-\191]") do FOLD[ch] = base end
end
function F.Fold(s)
  s = tostring(s or ""):gsub("[\192-\223][\128-\191]", FOLD)
  s = s:gsub("\226\128[\152\153]", ""):gsub("\194\180", ""):gsub("['`]", "")
  return s:lower()
end

-- Clé de comparaison d'un nom (table de noms, égalité) : nom complet sans casse, accents ni apostrophes
function F.Key(name, realm)
  local full = F.FullName(name, realm)
  return full and F.Fold(full) or nil
end
function F.SameName(a, b)
  local ka = F.Key(a)
  return ka ~= nil and ka == F.Key(b)
end

-- Nom à afficher : le prénom seul pour un perso du royaume du joueur, sinon « Prénom-Royaume »
function F.Display(full)
  local name, realm = F.Split(full)
  if not name then return "?" end
  if not realm or F.Fold(realm) == F.Fold(F.MyRealm()) then return name end
  return name .. "-" .. realm
end

--------------------------------------------------------------------------------------------------------------------
-- Textes collés : reconnaissance
--------------------------------------------------------------------------------------------------------------------
-- Premier en-tête reconnu : RRG, RRR, RRB (Roster) ou FRG, FRR, FRC, FRB (Forever Roster)
function F.Kind(text)
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    local h = line:match("^%s*(%u%u%u);")
    if h and (h == "RRG" or h == "RRR" or h == "RRB" or h == "FRG" or h == "FRR" or h == "FRC" or h == "FRB") then return h end
  end
  return nil
end
function F.IsForever(text)
  local k = F.Kind(text)
  return k ~= nil and k:sub(1, 2) == "FR"
end

F.INCOMPLETE = "Texte incomplet : recopie tout, jusqu'à la dernière ligne END."
F.FOREVER = "Ce texte vient de Forever Roster (WoW Forever) : colle-le dans l'addon Forever Roster."
local function newer(v) return "Version non gérée (" .. txt(v, 8) .. ") : mets l'addon à jour." end
local DIFFICULTIES = { normal = true, heroic = true, mythic = true }
local function difficulty(s) s = txt(s, 10):lower() return DIFFICULTIES[s] and s or "" end
local function opt(s, max) s = txt(s, max) return s ~= "" and s or nil end

-- Liste de persos « Prénom-Royaume » séparés par des virgules (lignes O et L du RRG)
local function names(field, max)
  local out = {}
  for name in tostring(field or ""):gmatch("[^,]+") do
    name = txt(name, 60)
    if name ~= "" and #out < (max or 40) then out[#out + 1] = name end
  end
  return out
end
F.names = names

-- Persos d'une entrée « Perso+Perso » (12 au plus)
local function entryNames(list)
  local out = {}
  for name in list:gmatch("[^+]+") do
    name = txt(name, 60)
    if name ~= "" and #out < 12 then out[#out + 1] = name end
  end
  return out
end
-- Objets reçus (ligne N) : « Perso+Perso:3,Autre:0 » ; les persos d'un même joueur partagent le compte
local function counts(f)
  local c = { short = txt(f[2], 20), label = txt(f[3], 60), entries = {} }
  for part in tostring(f[4] or ""):gmatch("[^,]+") do
    local list, n = part:match("^(.-):(%-?%d+)%s*$")
    if list and #c.entries < 200 then
      local e = { names = entryNames(list), n = tonumber(n) or 0, bis = 0, up = 0, ms = 0 }
      if #e.names > 0 then c.entries[#c.entries + 1] = e end
    end
  end
  return c
end
-- Détail des objets reçus (ligne D, addon 0.3) : « Perso+Perso:BiS:Upgrade:MS,… » → { { names, bis, up, ms } }
local function details(field)
  local out = {}
  for part in tostring(field or ""):gmatch("[^,]+") do
    local list, b, u, m = part:match("^(.-):(%-?%d+):(%-?%d+):(%-?%d+)%s*$")
    if list and #out < 200 then
      local d = { names = entryNames(list), bis = tonumber(b) or 0, up = tonumber(u) or 0, ms = tonumber(m) or 0 }
      if #d.names > 0 then out[#out + 1] = d end
    end
  end
  return out
end
-- Ligne D rattachée aux entrées de N (même premier nom) ; sans entrée N, une entrée est créée (total = la somme)
local function mergeDetails(g, list)
  if not list then return end
  g.counts = g.counts or { short = "", label = "", entries = {} }
  local entries = g.counts.entries
  for _, d in ipairs(list) do
    local e
    for _, x in ipairs(entries) do if F.SameName(x.names[1], d.names[1]) then e = x break end end
    if not e and #entries < 200 then
      e = { names = d.names, n = d.bis + d.up + d.ms }
      entries[#entries + 1] = e
    end
    if e then e.bis, e.up, e.ms = d.bis, d.up, d.ms end
  end
end
-- Entrée d'un perso dans les objets reçus (N) : { names, n, bis, up, ms } (0 si absents) ou nil
function F.CountFor(c, name)
  if not (c and c.entries) then return nil end
  for _, e in ipairs(c.entries) do
    for _, n in ipairs(e.names or {}) do
      if F.SameName(n, name) then
        e.bis, e.up, e.ms = tonumber(e.bis) or 0, tonumber(e.up) or 0, tonumber(e.ms) or 0
        return e
      end
    end
  end
  return nil
end

-- RRG v1 : un ou plusieurs groupes à la suite. Les lignes ajoutées plus tard (après les R) sont hors du compte de END.
-- Lot R3b : O (conseil par défaut : officiers et propriétaire), L (conseil choisi pour un raid), N (objets reçus).
-- Addon 0.3 : D (détail des objets reçus : BiS, Upgrade, jets MS), rattaché aux entrées de N.
function F.ParseRRG(text)
  local groups, cur, count, n, detail = {}, nil, nil, 0, nil
  local function close()
    if not cur then return true end
    if count ~= n then return false end
    mergeDetails(cur, detail)
    groups[#groups + 1] = cur
    return true
  end
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    local f = split(trim(line))
    if f[1] == "RRG" then
      if not close() then return nil, F.INCOMPLETE end
      if tonumber(f[2]) ~= 1 then return nil, newer(f[2]) end
      cur, count, n, detail = { id = txt(f[3], 40), at = tonumber(f[4]) or 0, name = txt(f[5], 60), raids = {} }, nil, 0, nil
    elseif cur and f[1] == "R" and count == nil then
      n = n + 1
      if #cur.raids < 30 then
        cur.raids[#cur.raids + 1] = {
          id = txt(f[2], 40), time = tonumber(f[3]) or 0, name = txt(f[4], 60), difficulty = difficulty(f[5]),
          size = tonumber(f[6]) or 0, status = opt(f[7], 12), char = opt(f[8], 60), loot = opt(f[9], 12),
        }
      end
    elseif cur and f[1] == "O" then
      cur.officers = names(f[2])
    elseif cur and f[1] == "L" then
      local raidId = txt(f[2], 40)
      if raidId ~= "" then
        cur.council = cur.council or {}
        cur.council[raidId] = names(f[3])
      end
    elseif cur and f[1] == "N" then
      cur.counts = counts(f)
    elseif cur and f[1] == "D" then
      detail = details(f[2])
    elseif cur and f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not cur then return nil, "Ce ne sont pas les données du site : sur Roster, « Copier pour le jeu » (barre du haut), puis colle ici." end
  if not close() then return nil, F.INCOMPLETE end
  return groups
end

-- RRR v1 : compo d'un raid. Pour un inscrit Discord (source discord), le nom est son pseudo Discord.
function F.ParseRRR(text)
  local raid, members, count = nil, {}, nil
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    local f = split(trim(line))
    if f[1] == "RRR" then
      if tonumber(f[2]) ~= 1 then return nil, newer(f[2]) end
      raid = { id = txt(f[3], 40), time = tonumber(f[4]) or 0, name = txt(f[5], 60), difficulty = difficulty(f[6]), size = tonumber(f[7]) or 0 }
    elseif raid and f[1] == "M" then
      local source = txt(f[9], 10)
      members[#members + 1] = {
        name = txt(f[2], 60), class = txt(f[3], 16):upper(), role = txt(f[4], 8), spec = txt(f[5], 30),
        group = tonumber(f[6]) or 0, pos = tonumber(f[7]) or 0, status = txt(f[8], 12), source = source ~= "" and source or "site",
      }
    elseif raid and f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not raid then return nil, "Ce n'est pas un export de compo : sur Roster, page du raid, onglet Compo, « Export pour le jeu »." end
  if count ~= #members then return nil, "Export incomplet : recopie tout le texte, jusqu'à la ligne END." end
  return raid, members
end

-- RRB v1 : bilan d'un raid. log : raidId, start, stop, recorder, name, instance, lead, difficulty,
-- people[nom] = { first, last, n }, loot = { { id, who, at, boss, method, response, detail, name } }, encounters = { { id, name, at, success } }
-- Nom de l'objet en fin de ligne L : le site n'a pas la base des objets de Retail
function F.BuildRRB(log)
  local c = F.clean
  local lines = { table.concat({ "RRB", "1", c(log.raidId), tostring(log.start or 0), tostring(log.stop or log.start or 0), c(log.recorder),
    c(log.name), c(log.instance), log.lead and "1" or "0", c(log.difficulty) }, ";") }
  local names = {}
  for name in pairs(log.people or {}) do if type(name) == "string" then names[#names + 1] = name end end
  table.sort(names)
  for _, name in ipairs(names) do
    local p = log.people[name]
    lines[#lines + 1] = table.concat({ "A", c(name), tostring(p.first or 0), tostring(p.last or 0), tostring(p.n or 0) }, ";")
  end
  for _, l in ipairs(log.loot or {}) do
    lines[#lines + 1] = table.concat({ "L", tostring(l.id or 0), c(l.who), tostring(l.at or 0), c(l.boss), c(l.method), c(l.response), c(l.detail), c(l.name) }, ";")
  end
  for _, e in ipairs(log.encounters or {}) do
    lines[#lines + 1] = table.concat({ "E", tostring(e.id or 0), c(e.name), tostring(e.at or 0), e.success and "1" or "0" }, ";")
  end
  lines[#lines + 1] = "END;" .. (#lines - 1)
  return table.concat(lines, "\n")
end

--------------------------------------------------------------------------------------------------------------------
-- Butin vu dans le chat (CHAT_MSG_LOOT)
--------------------------------------------------------------------------------------------------------------------
-- Motif Lua d'un texte du jeu (« %s reçoit le butin : %s. », positions « %1$s » comprises) ; renvoie une fonction
-- message → valeurs dans l'ordre des arguments du texte du jeu
function F.FormatMatcher(fmt)
  local parts, order, k, i = {}, {}, 0, 1
  while i <= #fmt do
    local pos, t = fmt:match("^%%(%d)%$([sd])", i)
    if pos then
      order[#order + 1] = tonumber(pos) parts[#parts + 1] = t == "s" and "(.+)" or "(%d+)" i = i + 4
    else
      t = fmt:match("^%%([sd])", i)
      if t then
        k = k + 1 order[#order + 1] = k parts[#parts + 1] = t == "s" and "(.+)" or "(%d+)" i = i + 2
      else
        local ch = fmt:sub(i, i)
        parts[#parts + 1] = ch:find("^[%(%)%.%[%]%*%+%-%?%^%$%%]$") and ("%" .. ch) or ch
        i = i + 1
      end
    end
  end
  local pattern = "^" .. table.concat(parts) .. "$"
  return function(msg)
    local caps = { tostring(msg or ""):match(pattern) }
    if #caps == 0 then return nil end
    local v = {}
    for j, p in ipairs(order) do v[p] = caps[j] end
    return v
  end
end

-- Lecteur des messages de butin : textes du jeu (globalstrings, langue du client), sinon l'anglais.
-- Renvoie une fonction message → qui (nil : le joueur lui-même), identifiant de l'objet, qualité (ou nil)
local QUALITY = { ff8000 = 5, a335ee = 4, ["0070dd"] = 3, ["1eff00"] = 2, ffffff = 1, ["9d9d9d"] = 0, e6cc80 = 6, ["00ccff"] = 7 }
function F.QualityOf(link)
  link = tostring(link or "")
  local q = link:match("|cnIQ(%d)")
  if q then return tonumber(q) end
  local hex = link:match("|c%x%x(%x%x%x%x%x%x)")
  return hex and QUALITY[hex:lower()] or nil
end
function F.LootParser(strings)
  strings = strings or {}
  local list = {
    { strings.LOOT_ITEM_SELF_MULTIPLE or "You receive loot: %sx%d.", true },
    { strings.LOOT_ITEM_SELF or "You receive loot: %s.", true },
    { strings.LOOT_ITEM_MULTIPLE or "%s receives loot: %sx%d.", false },
    { strings.LOOT_ITEM or "%s receives loot: %s.", false },
  }
  local matchers = {}
  for _, e in ipairs(list) do if type(e[1]) == "string" then matchers[#matchers + 1] = { F.FormatMatcher(e[1]), e[2] } end end
  return function(msg)
    if not usable(msg) then return nil end
    local id = tonumber(msg:match("|Hitem:(%d+)"))
    if not id then return nil end
    for _, m in ipairs(matchers) do
      local v = m[1](msg)
      if v then
        local item = m[2] and v[1] or v[2]
        local quality = F.QualityOf(item or msg)
        if m[2] then return nil, id, quality, true end
        return v[1], id, quality, true
      end
    end
    return nil, nil, nil, false
  end
end

--------------------------------------------------------------------------------------------------------------------
-- Distribution du butin (lot R3b)
--------------------------------------------------------------------------------------------------------------------
-- Jets de dés lus dans le chat (RANDOM_ROLL_RESULT, langue du client : « %s obtient un %d (%d-%d). » en français,
-- « %s rolls %d (%d-%d) » en anglais). Renvoie une fonction message → nom complet, jet, min, max.
function F.RollParser(fmt)
  local match = F.FormatMatcher(type(fmt) == "string" and fmt or "%s rolls %d (%d-%d)")
  return function(msg)
    if not usable(msg) then return nil end
    local v = match(msg)
    if not v or not v[1] then return nil end
    local roll, lo, hi = tonumber(v[2]), tonumber(v[3]), tonumber(v[4])
    if not (roll and lo and hi) then return nil end
    return F.FullName(v[1]), roll, lo, hi
  end
end

-- Durée lue dans un texte du jeu (« 1 h 58 min », « 1 hr 58 min », « 45 min », « 2 Std. 3 Min. ») → secondes
function F.ParseDuration(s)
  if not usable(s) then return nil end
  local total, found = 0, false
  for num, unit in s:gmatch("(%d+)%s*([^%d%s]*)") do
    local u, n = unit:lower(), tonumber(num)
    found = true
    if u:find("^h") or u:find("^st") or u:find("^ч") then total = total + n * 3600
    elseif u:find("^m") then total = total + n * 60
    elseif u:find("^s") then total = total + n
    else total = total + n * 60 end
  end
  return found and total or nil
end

-- Temps restant pour échanger un objet lié (BIND_TRADE_TIME_REMAINING, ligne de l'infobulle de l'objet) :
-- renvoie une fonction ligne → secondes (nil si la ligne n'est pas celle-là)
function F.TradeTimeParser(fmt)
  local match = F.FormatMatcher(type(fmt) == "string" and fmt or "You may trade this item with players that were also eligible to loot this item for the next %s.")
  return function(line)
    if not usable(line) then return nil end
    line = line:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
    local v = match(trim(line))
    return v and v[1] and F.ParseDuration(v[1]) or nil
  end
end

-- « 1 h 58 min », « 45 min », « moins d'une minute »
function F.Duration(sec)
  sec = math.max(0, math.floor(tonumber(sec) or 0))
  if sec >= 3600 then return string.format("%d h %02d min", math.floor(sec / 3600), math.floor(sec % 3600 / 60)) end
  if sec >= 60 then return math.floor(sec / 60) .. " min" end
  return "moins d'une minute"
end

-- Lien d'objet → chaîne de l'objet sans couleurs (« item:242394::::::::90:::::… », bonus compris), identifiant, nom
function F.ItemString(link)
  if not usable(link) then return nil end
  if link:find("^item:[%d:%-]+$") then return link end
  return link:match("|H(item:[%d:%-]+)|h")
end
function F.ItemId(link)
  if not usable(link) then return nil end
  return tonumber(link:match("item:(%d+)"))
end
function F.ItemName(link)
  if not usable(link) then return nil end
  return link:match("|h%[(.-)%]|h")
end

-- Objets portés d'une réponse au conseil (LA) : « objet:niveau,objet:niveau » ↔ { { id, ilvl } }
function F.Gear(field)
  local out = {}
  for id, lvl in tostring(field or ""):gmatch("(%d+):?(%d*)") do
    if #out < 2 then out[#out + 1] = { id = tonumber(id), ilvl = tonumber(lvl) } end
  end
  return out
end
function F.GearText(list)
  local parts = {}
  for _, g in ipairs(list or {}) do
    if g.id and #parts < 2 then parts[#parts + 1] = g.id .. (g.ilvl and (":" .. g.ilvl) or "") end
  end
  return table.concat(parts, ",")
end

return F
