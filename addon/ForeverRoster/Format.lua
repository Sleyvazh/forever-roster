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
      raid = { id = f[3], time = tonumber(f[4]) or 0, name = f[5] or "" }
    elseif f[1] == "M" then
      members[#members + 1] = {
        -- Prénom seul : le jeu ignore le nom de famille de Forever (« Greta Coulé » → Greta)
        name = (f[2] or ""):match("^%S+") or "", class = f[3], role = f[4], spec = f[5],
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
  for n in tostring(field or ""):gmatch("[^,]+") do out[#out + 1] = n end
  return out
end
function F.ParseFRG(text)
  local group, raids, patterns, count, n = nil, {}, {}, nil, 0
  for line in tostring(text or ""):gmatch("[^\r\n]+") do
    line = line:gsub("^%s+", ""):gsub("%s+$", "")
    local f = split(line)
    if f[1] == "FRG" then
      if tonumber(f[2]) ~= 1 then return nil, "Version non gérée (" .. tostring(f[2]) .. ") : mets l'addon à jour." end
      group = { id = f[3], at = tonumber(f[4]) or 0, name = f[5] or "" }
    elseif f[1] == "R" then
      n = n + 1
      raids[#raids + 1] = { id = f[2], time = tonumber(f[3]) or 0, name = f[4] or "", status = f[5] ~= "" and f[5] or nil, char = f[6] ~= "" and f[6] or nil }
    elseif f[1] == "P" then
      n = n + 1
      local id = tonumber(f[2])
      if id then patterns[id] = { recipe = f[3] or "", wanted = names(f[4]), known = names(f[5]) } end
    elseif f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not group then return nil, "Ce ne sont pas les données d'un groupe : sur le site, onglet Raids du groupe, « Données pour l'addon »." end
  if count ~= n then return nil, "Texte incomplet : recopie tout, jusqu'à la ligne END." end
  group.raids, group.patterns = raids, patterns
  return group
end

-- lines : liste de tables de champs ; la ligne END donne le nombre de lignes utiles (détecte un copier-coller tronqué).
function F.BuildFRC(header, lines)
  local out = { table.concat({ "FRC", "1", F.clean(header.name), F.clean(header.realm), header.class or "", header.race or "",
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
