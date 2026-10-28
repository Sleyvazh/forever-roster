-- Formats d'échange avec le site (une information par ligne, champs séparés par « ; ») :
--   FRR v1 : compo d'un raid, du site vers le jeu (docs/addon-format.md)
--   FRC v2 : un perso, du jeu vers le site (1.6.2 : GUID et nom complet en fin d'en-tête)
--   FRG v1 : données d'un groupe (raids à venir, patrons recherchés), du site vers le jeu ; signé par le site (M, Z)
--   FRL v1 : relève de la guilde (liste, journal, banque, niveaux et XP), du jeu vers le site (lue par le site depuis 1.6.2)
-- Ce fichier n'utilise aucune fonction du jeu : il est testé hors jeu (addon/tests).
local _, ns = ...
ns = ns or {}
-- Textes des erreurs : traduits par ns.L dans le jeu ; hors du jeu (addon/tests/format_test.lua), en français tels quels
local L = ns.L or setmetatable({}, {
  __index = function(_, key) return key end,
  __call = function(_, key, ...) if select("#", ...) == 0 then return key end return string.format(key, ...) end,
})
-- Texte d'une valeur, "" si absente ou secrète (ns.text, Core.lua) ; hors du jeu, simple tostring
local plain = ns.text or function(v) return tostring(v or "") end
local F = {}
ns.Format = F

local function split(line)
  local out = {}
  for field in (line .. ";"):gmatch("([^;]*);") do out[#out + 1] = field end
  return out
end
F.split = split

-- Texte venu du site, affiché ou annoncé en jeu : sans « | » (codes du jeu : couleurs, liens, textures), longueur bornée.
local function txt(s, max)
  s = plain(s):gsub("|", "")
  return s:sub(1, max or 80)
end
F.txt = txt

-- Retire ce qui casserait une ligne : « ; », « | » (échappement du chat) et retours à la ligne.
function F.clean(s)
  return (plain(s):gsub("[;|\r\n]", " "))
end

function F.ParseFRR(text)
  local raid, members, count = nil, {}, nil
  for line in plain(text):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    local f = split(line)
    if f[1] == "FRR" then
      if tonumber(f[2]) ~= 1 then return nil, L("Version d'export non gérée (%s) : mets l'addon à jour.", tostring(f[2])) end
      raid = { id = txt(f[3], 40), time = tonumber(f[4]) or 0, name = txt(f[5], 60) }
    elseif f[1] == "M" then
      members[#members + 1] = {
        -- Prénom seul : le jeu ignore le nom de famille de Forever (« Greta Coulé » → Greta)
        name = txt(f[2], 40):match("^%S+") or "", class = txt(f[3], 12), role = txt(f[4], 8), spec = txt(f[5], 30),
        group = tonumber(f[6]) or 0, pos = tonumber(f[7]) or 0, status = f[8] or "", source = f[9] or "site", -- nolocale (valeur)
      }
    elseif f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not raid then return nil, L["Ce n'est pas un export de compo : copie le texte de « Export pour le jeu » sur la page du raid."] end
  if count ~= #members then return nil, L["Export incomplet : recopie tout le texte, jusqu'à la ligne END."] end
  return raid, members
end

-- Données d'un groupe (FRG v1) : raids à venir (R) et patrons recherchés / connus (P), indexés par l'objet patron.
local function names(field, max)
  local out = {}
  for n in plain(field):gmatch("[^,]+") do if #out < (max or 40) then out[#out + 1] = txt(n, 40) end end
  return out
end
-- Un ou plusieurs groupes à la suite (la page Addon du site donne tous les groupes du joueur d'un coup).
-- Lignes : R raid à venir, P patron suivi (recherché par, connu par), B objet BiS recherché (par qui).
-- Hors du compte de END (un addon plus ancien les ignore) : S réservations (soft reserve, avec bonus SR+),
-- O persos des officiers ; lot G : C consommable demandé, F fiche de boss, T tâche de la fiche, L conseil du raid,
-- I inscrit (rôle et type de DPS, pour les consommables) ; lot I : N objets reçus sur la période (« Nom+Alt:3,Autre:0 ») ;
-- 1.6.1 : X sortie donjon du jour ou de demain (outings, plus haut) ; 1.6.3 : Y liste des inscrits d'un raid (signups).
-- Partage entre joueurs (1.6) : M (persos du groupe : members) et Z (signature du site : sig = { key }) juste avant END ;
-- un bloc signé garde son texte (text : lignes de l'en-tête à END), relayé tel quel aux autres joueurs (Share.lua). Un
-- bloc sans Z (ancien site, pas de clé, soft reserve cachée) n'a pas de texte : il ne se partage pas.
local function per(t, raidId) t[raidId] = t[raidId] or {} return t[raidId] end
local function ids(field)
  local out = {}
  for id in plain(field):gmatch("%d+") do if #out < 8 then out[#out + 1] = tonumber(id) end end
  return out
end

-- Sorties donjon (1.6.1) : ligne X, hors du compte de END (un addon plus ancien l'ignore), une par sortie du jour ou de
-- demain (docs/addon-format.md) :
--   X;<id>;<heure>;<donjon>;<titre>;<niv min>;<niv max>;<créateur>;<places T/H/D>;<tanks>;<heals>;<dps>;<attente>;<note>
-- heure 0 : « dès que complet ». Inscrits : prénoms séparés par « , » ; « @pseudo » : inscrit Discord sans compte (à
-- inviter à la main). Attente dans l'ordre : « rôle:prénom ». Aucun champ personnel : l'addon reconnaît mes persos.
-- Texte borné en octets sans couper un caractère UTF-8 (notes et titres accentués), sans « | » (codes du jeu)
local function utf8txt(s, max)
  s = plain(s):gsub("|", ""):gsub("^%s+", ""):gsub("%s+$", "")
  if #s > max then s = s:sub(1, max):gsub("[\192-\255][\128-\191]*$", "") end
  return s
end
local ROLE = { tank = "Tank", heal = "Heal", healer = "Heal", dps = "DPS" }
local function people(field, max)
  local out = {}
  for name in plain(field):gmatch("[^,]+") do
    name = utf8txt(name, 40)
    if name ~= "" and #out < max then out[#out + 1] = name end
  end
  return out
end
local function outing(f)
  local id = txt(f[2], 40)
  if id == "" then return nil end
  local t, h, d = plain(f[9]):match("^%s*(%d+)%s*/%s*(%d+)%s*/%s*(%d+)%s*$")
  local places = t and { math.min(tonumber(t), 5), math.min(tonumber(h), 5), math.min(tonumber(d), 5) } or { 1, 1, 3 }
  local wait = {}
  for part in plain(f[13]):gmatch("[^,]+") do
    local role, name = part:match("^%s*([^:]-)%s*:(.+)$")
    name = name and utf8txt(name, 40) or ""
    if name ~= "" and #wait < 20 then wait[#wait + 1] = { role = ROLE[(role or ""):lower()] or "", name = name } end
  end
  return {
    id = id, time = tonumber(f[3]) or 0, dungeon = txt(f[4], 40), title = utf8txt(f[5], 120),
    min = tonumber(f[6]), max = tonumber(f[7]), creator = utf8txt(f[8], 40), places = places,
    tanks = people(f[10], 5), heals = people(f[11], 5), dps = people(f[12], 5), wait = wait,
    note = utf8txt(f[14], 240),
  }
end
-- Liste des inscrits d'un raid (ligne Y, 1.6.3), hors du compte de END, une par ligne R, même vide (« Y;<raid>; » : liste
-- connue, personne d'inscrit) :
--   Y;<raid>;<prénom>[?]:<statut>:<statut depuis>,…
-- Prénom d'un inscrit avec un compte du site ; « ? » : prénom porté par deux joueurs de la guilde (dup : jamais le mien) ;
-- statut du site (les six) ; heure Unix du dernier changement de statut sur le site. Aucun champ personnel : l'addon
-- reconnaît mes persos (Group.lua, G.SiteSignup). Statut inconnu ou prénom vide : sauté ; 60 inscrits au plus par raid.
local SITE_STATUS = { present = true, late = true, tentative = true, alt = true, bench = true, absent = true }
local function signupList(field)
  local out = {}
  for part in plain(field):gmatch("[^,]+") do
    if #out >= 60 then break end
    local name, status, at = part:match("^([^:]*):([^:]*):([^:]*)$")
    if name then
      name = name:gsub("^%s+", ""):gsub("%s+$", "")
      local dup = name:sub(-1) == "?"
      if dup then name = name:sub(1, -2) end
      name = txt(name, 40)
      status = status:gsub("^%s+", ""):gsub("%s+$", "")
      if name ~= "" and SITE_STATUS[status] then out[#out + 1] = { name = name, status = status, at = tonumber(at), dup = dup } end
    end
  end
  return out
end
function F.ParseFRG(text)
  local groups, cur, count, n, lines = {}, nil, nil, 0, nil
  local function close()
    if not cur then return true end
    if count ~= n then return false end
    if cur.sig then cur.text = table.concat(lines, "\n") end
    groups[#groups + 1] = cur
    return true
  end
  for line in plain(text):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    local f = split(line)
    if lines and count == nil and line ~= "" then lines[#lines + 1] = line end
    if f[1] == "FRG" then
      if not close() then return nil, L["Texte incomplet : recopie tout, jusqu'à la dernière ligne END."] end
      if tonumber(f[2]) ~= 1 then return nil, L("Version non gérée (%s) : mets l'addon à jour.", tostring(f[2])) end
      cur, count, n, lines = { id = txt(f[3], 40), at = tonumber(f[4]) or 0, name = txt(f[5], 60), raids = {}, patterns = {}, bis = {},
        reserves = {}, officers = {}, consumables = {}, bosses = {}, council = {}, roster = {}, counts = nil, outings = {}, signups = {} }, nil, 0, { line }
    elseif cur and f[1] == "M" and count == nil then
      cur.members = names(f[2], 1000)
    elseif cur and f[1] == "Z" and count == nil then
      cur.sig = { key = txt(f[2], 16) }
    elseif cur and f[1] == "R" then
      n = n + 1
      cur.raids[#cur.raids + 1] = { id = txt(f[2], 40), time = tonumber(f[3]) or 0, name = txt(f[4], 60), status = (f[5] or "") ~= "" and txt(f[5], 12) or nil,
        char = (f[6] or "") ~= "" and txt(f[6], 40) or nil, loot = (f[7] or "") ~= "" and txt(f[7], 12) or nil }
    elseif cur and f[1] == "S" then
      -- Réservations : Nom:bonus,Nom:bonus
      local id = tonumber(f[3])
      if id then
        local list = {}
        for name, bonus in plain(f[4]):gmatch("([^,:]+):(%d+)") do if #list < 40 then list[#list + 1] = { name = txt(name, 40), bonus = tonumber(bonus) or 0 } end end
        per(cur.reserves, txt(f[2], 40))[id] = list
      end
    elseif cur and f[1] == "O" then
      cur.officers = names(f[2])
    elseif cur and f[1] == "C" then
      local id, qty = tonumber(f[3]), tonumber(f[4])
      if id and qty then local l = per(cur.consumables, txt(f[2], 40)) if #l < 30 then l[#l + 1] = { itemId = id, n = qty, target = txt(f[5], 8), name = txt(f[6], 80) } end end
    elseif cur and f[1] == "F" then
      local idx = tonumber(f[3])
      if idx and idx <= 30 then per(cur.bosses, txt(f[2], 40))[idx] = { encounterId = tonumber(f[4]), npcIds = ids(f[5]), name = txt(f[6], 60), rows = {} } end
    elseif cur and f[1] == "T" then
      local sheet = cur.bosses[txt(f[2], 40)] and cur.bosses[txt(f[2], 40)][tonumber(f[3]) or 0]
      if sheet and #sheet.rows < 12 then sheet.rows[#sheet.rows + 1] = { label = txt(f[4], 40), names = names(f[5]), text = txt(f[6], 120) } end
    elseif cur and f[1] == "L" then
      cur.council[txt(f[2], 40)] = names(f[3])
    elseif cur and f[1] == "I" then
      local r = per(cur.roster, txt(f[2], 40))
      local name = txt(f[3], 40)
      if name ~= "" then r[name] = { role = txt(f[4], 8), dps = txt(f[5], 8) } end
    elseif cur and f[1] == "N" then
      -- Objets reçus : les persos d'un même joueur (séparés par « + ») partagent le compte
      local c, entries = { short = txt(f[2], 20), label = txt(f[3], 60), byName = {} }, 0
      for part in plain(f[4]):gmatch("[^,]+") do
        local list, n = part:match("^(.-):(%-?%d+)$")
        if list and entries < 200 then
          entries = entries + 1
          local e = { names = {}, n = tonumber(n) or 0 }
          for name in list:gmatch("[^+]+") do
            name = txt(name, 40)
            if name ~= "" and #e.names < 12 then e.names[#e.names + 1] = name c.byName[name] = e end
          end
        end
      end
      cur.counts = c
    elseif cur and f[1] == "X" and count == nil then
      -- Sortie donjon (1.6.1), hors du compte de END ; 30 par groupe sur le site
      local o = #cur.outings < 40 and outing(f)
      if o then cur.outings[#cur.outings + 1] = o end
    elseif cur and f[1] == "Y" and count == nil then
      -- Inscrits d'un raid (1.6.3), hors du compte de END : une liste (même vide) = « liste connue »
      local raidId = txt(f[2], 40)
      if raidId ~= "" then cur.signups[raidId] = signupList(f[3]) end
    elseif cur and f[1] == "P" then
      n = n + 1
      local id = tonumber(f[2])
      if id then cur.patterns[id] = { recipe = txt(f[3], 80), wanted = names(f[4]), known = names(f[5]) } end
    elseif cur and f[1] == "B" then
      n = n + 1
      local id = tonumber(f[2])
      if id then cur.bis[id] = names(f[3]) end
    elseif cur and f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not cur then return nil, L["Ce ne sont pas les données du site : page Addon du site (ou onglet Raids du groupe), « Copier », puis colle ici."] end
  if not close() then return nil, L["Texte incomplet : recopie tout, jusqu'à la dernière ligne END."] end
  return groups
end

-- Jets de dés : motif tiré du texte du jeu (RANDOM_ROLL_RESULT, « %s obtient un %d (%d-%d). » en français),
-- pour lire les jets quelle que soit la langue du client. Renvoie une fonction : message → nom, jet, min, max.
function F.RollParser(fmt)
  fmt = fmt or "%s rolls %d (%d-%d)"
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
        local c = fmt:sub(i, i)
        parts[#parts + 1] = c:find("^[%(%)%.%[%]%*%+%-%?%^%$%%]$") and ("%" .. c) or c
        i = i + 1
      end
    end
  end
  local pattern = "^" .. table.concat(parts) .. "$"
  return function(msg)
    local caps = { plain(msg):match(pattern) }
    if #caps < 4 then return nil end
    local v = {}
    for j, p in ipairs(order) do v[p] = caps[j] end
    -- Prénom seul : sans royaume ni nom de famille de Forever (« John Poutre obtient un 54 » → John)
    return (tostring(v[1]):match("^[^%-%s]+")), tonumber(v[2]), tonumber(v[3]), tonumber(v[4])
  end
end

-- Un consommable concerne-t-il ce joueur (rôle et type de DPS de son inscription) ? Sans inscription : seulement « all ».
function F.Concerns(target, who)
  if target == "all" or target == "" then return true end
  if not who then return false end
  if target == "tank" then return who.role == "Tank" end
  if target == "heal" then return who.role == "Heal" end
  return who.role == "DPS" and who.dps == target
end

-- Format court (FRC v2) : équipement sur une ligne, patrons regroupés par métier, seulement les talents pris.
-- lines : lignes « longues » (G;emplacement;objet, R;métier;clé, T;nœud;rang;max;x;y;sort;sous-arbre;arbre, …).
function F.Compact(lines)
  local out, gear, recipes, profs, trees, treeOrder = {}, {}, {}, {}, {}, {}
  for _, l in ipairs(lines) do
    local kind = l[1]
    if kind == "G" then gear[#gear + 1] = F.clean(l[2]) .. ":" .. F.clean(l[3])
    elseif kind == "R" then
      local prof = F.clean(l[2])
      if not recipes[prof] then recipes[prof] = {} profs[#profs + 1] = prof end
      local list = recipes[prof]
      list[#list + 1] = F.clean(l[3])
    elseif kind == "T" then
      if (tonumber(l[3]) or 0) > 0 then
        local tree = tostring(l[9] or 0)
        if not trees[tree] then trees[tree] = {} treeOrder[#treeOrder + 1] = tree end
        local list = trees[tree]
        list[#list + 1] = l[2] .. ":" .. l[3]
      end
    else out[#out + 1] = l end
  end
  local compact = {}
  if #gear > 0 then compact[#compact + 1] = { "G", table.concat(gear, ",") } end
  for _, l in ipairs(out) do compact[#compact + 1] = l end
  table.sort(profs)
  for _, p in ipairs(profs) do table.sort(recipes[p]) compact[#compact + 1] = { "R", p, table.concat(recipes[p], ",") } end
  for _, t in ipairs(treeOrder) do compact[#compact + 1] = { "T", t, table.concat(trees[t], ",") } end
  return compact
end

-- Relève de la guilde (FRL v1, 1.6.0 ; envoyée au site depuis 1.6.2) : liste de guilde, journal, banque, niveau et XP
-- des persos du compte, du jeu vers le site (docs/addon-format.md). d = { name, faction, realm, addon, roster, events,
-- bank, chars } (Guild.lua, G.Data) ; chaque partie est facultative (absente : pas de lignes). Chaque champ passe par
-- F.clean (sans « ; », « | » ni retour à la ligne) ; END compte toutes les lignes entre l'en-tête et END. Lignes P et U
-- (1.6.2) : GUID du perso en dernier champ (vide s'il n'est pas encore connu).
-- stable : forme sans ce qui bouge tout seul (heures de relève, qui a relevé, version de l'addon, en ligne, « il y a »
-- des journaux ; dernière connexion au jour près, XP au dixième de niveau près) : son empreinte (F.Hash) décide d'un
-- nouvel envoi (Guild.lua, G.Pending).
local function dayOf(at, hours) return math.floor(((at or 0) - hours * 3600) / 86400) end
function F.BuildFRL(d, stable)
  local c = F.clean
  local function moving(v) if stable then return "" end return v end
  local function join(f)
    local parts = {}
    for i = 1, f.n do parts[i] = c(f[i]) end
    return table.concat(parts, ";")
  end
  local lines = {}
  local function add(...) lines[#lines + 1] = { n = select("#", ...), ... } end
  local r = d.roster
  local head = { n = 11, "FRL", 1, d.name, d.faction, moving(r and r.at or 0), moving(r and r.by), r and r.officer and 1 or 0, moving(r and r.rank),
    r and r.total or 0, d.realm, moving(d.addon) }
  for _, m in ipairs(r and r.members or {}) do
    -- Dernière connexion : heures écoulées au moment de la relève (vide si le jeu ne l'a pas dite)
    local last = m.hours and (stable and dayOf(r.at, m.hours) or m.hours) or ""
    add("M", m.name, m.class, m.level, m.rank, m.rankIndex, moving(m.online and 1 or 0), last, m.note, r.officer and m.onote or "", m.guid)
  end
  local ev = d.events
  if ev then
    add("J", moving(ev.at or 0), moving(ev.by))
    for _, e in ipairs(ev.list or {}) do add("E", e.type, e.p1, e.p2, e.rank, moving(e.hours)) end
  end
  local b = d.bank
  if b then
    add("B", moving(b.at or 0), moving(b.by), b.money, b.ntabs or 0)
    for tab = 1, b.ntabs or 0 do
      local t = b.tabs and b.tabs[tab]
      if t then add("T", tab, t.name, t.visible and 1 or 0, t.read and 1 or 0) end
    end
    for _, it in ipairs(b.items or {}) do add("I", it.tab, it.slot, it.id, it.n) end
    for _, x in ipairs(b.log or {}) do add("X", x.tab, x.type, x.who, x.id, x.n, x.tab1, x.tab2, moving(x.hours)) end
    for _, x in ipairs(b.moneyLog or {}) do add("O", x.type, x.who, x.amount, moving(x.hours)) end
  end
  for _, ch in ipairs(d.chars or {}) do
    local x = ch.xp
    if x and stable then
      add("P", ch.name, x.level, (x.max or 0) > 0 and math.floor((x.xp or 0) * 10 / x.max) or "", "", "", ch.guid)
    elseif x then
      add("P", ch.name, x.level, x.xp, x.max, x.at or 0, ch.guid)
    end
    local levels = {}
    for lvl in pairs(ch.levels or {}) do levels[#levels + 1] = lvl end
    table.sort(levels)
    for _, lvl in ipairs(levels) do add("U", ch.name, lvl, ch.levels[lvl], ch.guid) end
  end
  local out = { join(head) }
  for _, f in ipairs(lines) do out[#out + 1] = join(f) end
  out[#out + 1] = "END;" .. #lines
  return table.concat(out, "\n")
end

-- Empreinte d'un texte (djb2 et longueur) : savoir si un perso ou un relevé a changé depuis son dernier envoi
function F.Hash(str)
  local h = 5381
  for i = 1, #str do h = (h * 33 + str:byte(i)) % 4294967296 end
  return string.format("%08x", h) .. "-" .. #str
end

-- lines : liste de tables de champs ; la ligne END donne le nombre de lignes utiles (détecte un copier-coller tronqué).
-- En fin d'en-tête (1.6.2, un site plus ancien les ignore) : GUID du perso (UnitGUID) et nom complet (« Prénom Nom »),
-- vides s'ils ne sont pas connus.
function F.BuildFRC(header, lines)
  local out = { table.concat({ "FRC", "2", F.clean(header.name), F.clean(header.realm), header.class or "", header.race or "",
    tostring(header.level or 0), header.faction or "", tostring(header.time or 0), F.clean(header.addon or ""),
    F.clean(header.guid), F.clean(header.fullName) }, ";") }
  for _, fields in ipairs(lines) do
    local parts = {}
    for i, v in ipairs(fields) do parts[i] = F.clean(v) end
    out[#out + 1] = table.concat(parts, ";")
  end
  out[#out + 1] = "END;" .. #lines
  return table.concat(out, "\n")
end
return F
