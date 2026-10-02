-- Formats d'échange avec le site (une information par ligne, champs séparés par « ; ») :
--   FRR v1 : compo d'un raid, du site vers le jeu (docs/addon-format.md)
--   FRC v1 : un perso, du jeu vers le site
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
