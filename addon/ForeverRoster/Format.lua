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
      cur, count, n = { id = txt(f[3], 40), at = tonumber(f[4]) or 0, name = txt(f[5], 60), raids = {}, patterns = {}, bis = {} }, nil, 0
    elseif cur and f[1] == "R" then
      n = n + 1
      cur.raids[#cur.raids + 1] = { id = txt(f[2], 40), time = tonumber(f[3]) or 0, name = txt(f[4], 60), status = (f[5] or "") ~= "" and txt(f[5], 12) or nil, char = (f[6] or "") ~= "" and txt(f[6], 40) or nil }
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
