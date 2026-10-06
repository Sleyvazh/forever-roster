-- Formats d'échange avec le site (une information par ligne, champs séparés par « ; ») :
--   FRR v1 : compo d'un raid, du site vers le jeu (docs/addon-format.md)
--   FRC v1 : un perso, du jeu vers le site
--   FRG v1 : données d'un groupe (raids à venir, patrons recherchés), du site vers le jeu
-- Ce fichier n'utilise aucune fonction du jeu : il est testé hors jeu (addon/tests).
local _, ns = ...
ns = ns or {}
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
  s = tostring(s or ""):gsub("|", "")
  return s:sub(1, max or 80)
end
F.txt = txt

-- Retire ce qui casserait une ligne : « ; », « | » (échappement du chat) et retours à la ligne.
function F.clean(s)
  return (tostring(s or ""):gsub("[;|\r\n]", " "))
end

function F.ParseFRR(text)
  local raid, members, count = nil, {}, nil
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    local f = split(line)
    if f[1] == "FRR" then
      if tonumber(f[2]) ~= 1 then return nil, "Version d'export non gérée (" .. tostring(f[2]) .. ") : mets l'addon à jour." end
      raid = { id = txt(f[3], 40), time = tonumber(f[4]) or 0, name = txt(f[5], 60) }
    elseif f[1] == "M" then
      members[#members + 1] = {
        -- Prénom seul : le jeu ignore le nom de famille de Forever (« Greta Coulé » → Greta)
        name = txt(f[2], 40):match("^%S+") or "", class = txt(f[3], 12), role = txt(f[4], 8), spec = txt(f[5], 30),
        group = tonumber(f[6]) or 0, pos = tonumber(f[7]) or 0, status = f[8] or "", source = f[9] or "site",
      }
    elseif f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not raid then return nil, "Ce n'est pas un export de compo : copie le texte de « Export pour le jeu » sur la page du raid." end
  if count ~= #members then return nil, "Export incomplet : recopie tout le texte, jusqu'à la ligne END." end
  return raid, members
end

-- Données d'un groupe (FRG v1) : raids à venir (R) et patrons recherchés / connus (P), indexés par l'objet patron.
local function names(field)
  local out = {}
  for n in tostring(field or ""):gmatch("[^,]+") do if #out < 40 then out[#out + 1] = txt(n, 40) end end
  return out
end
-- Un ou plusieurs groupes à la suite (la page Addon du site donne tous les groupes du joueur d'un coup).
-- Lignes : R raid à venir, P patron suivi (recherché par, connu par), B objet BiS recherché (par qui).
-- Hors du compte de END (un addon plus ancien les ignore) : S réservations (soft reserve, avec bonus SR+),
-- O persos des officiers ; lot G : C consommable demandé, F fiche de boss, T tâche de la fiche, L conseil du raid,
-- I inscrit (rôle et type de DPS, pour les consommables) ; lot I : N objets reçus sur la période (« Nom+Alt:3,Autre:0 »).
local function per(t, raidId) t[raidId] = t[raidId] or {} return t[raidId] end
local function ids(field)
  local out = {}
  for id in tostring(field or ""):gmatch("%d+") do if #out < 8 then out[#out + 1] = tonumber(id) end end
  return out
end
function F.ParseFRG(text)
  local groups, cur, count, n = {}, nil, nil, 0
  local function close()
    if not cur then return true end
    if count ~= n then return false end
    groups[#groups + 1] = cur
    return true
  end
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    local f = split(line)
    if f[1] == "FRG" then
      if not close() then return nil, "Texte incomplet : recopie tout, jusqu'à la dernière ligne END." end
      if tonumber(f[2]) ~= 1 then return nil, "Version non gérée (" .. tostring(f[2]) .. ") : mets l'addon à jour." end
      cur, count, n = { id = txt(f[3], 40), at = tonumber(f[4]) or 0, name = txt(f[5], 60), raids = {}, patterns = {}, bis = {},
        reserves = {}, officers = {}, consumables = {}, bosses = {}, council = {}, roster = {}, counts = nil }, nil, 0
    elseif cur and f[1] == "R" then
      n = n + 1
      cur.raids[#cur.raids + 1] = { id = txt(f[2], 40), time = tonumber(f[3]) or 0, name = txt(f[4], 60), status = (f[5] or "") ~= "" and txt(f[5], 12) or nil,
        char = (f[6] or "") ~= "" and txt(f[6], 40) or nil, loot = (f[7] or "") ~= "" and txt(f[7], 12) or nil }
    elseif cur and f[1] == "S" then
      -- Réservations : Nom:bonus,Nom:bonus
      local id = tonumber(f[3])
      if id then
        local list = {}
        for name, bonus in tostring(f[4] or ""):gmatch("([^,:]+):(%d+)") do if #list < 40 then list[#list + 1] = { name = txt(name, 40), bonus = tonumber(bonus) or 0 } end end
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
      for part in tostring(f[4] or ""):gmatch("[^,]+") do
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
  if not cur then return nil, "Ce ne sont pas les données du site : page Addon du site (ou onglet Raids du groupe), « Copier », puis colle ici." end
  if not close() then return nil, "Texte incomplet : recopie tout, jusqu'à la dernière ligne END." end
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
    local caps = { tostring(msg or ""):match(pattern) }
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

-- lines : liste de tables de champs ; la ligne END donne le nombre de lignes utiles (détecte un copier-coller tronqué).
function F.BuildFRC(header, lines)
  local out = { table.concat({ "FRC", "2", F.clean(header.name), F.clean(header.realm), header.class or "", header.race or "",
    tostring(header.level or 0), header.faction or "", tostring(header.time or 0), F.clean(header.addon or "") }, ";") }
  for _, fields in ipairs(lines) do
    local parts = {}
    for i, v in ipairs(fields) do parts[i] = F.clean(v) end
    out[#out + 1] = table.concat(parts, ";")
  end
  out[#out + 1] = "END;" .. #lines
  return table.concat(out, "\n")
end
return F
