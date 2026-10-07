-- Données du site collées en jeu : groupes et raids à venir (RRG), compo d'un raid (RRR, Compo.lua).
-- ns.Groups : groupes chargés (RosterDB.groups), raids à venir, raid en cours pour le relevé.
-- ns.Data : ce que la synchro (onglet Synchro, synchro rapide, bouton de la minicarte) charge et exporte.
local _, ns = ...
local G, D = {}, {}
ns.Groups, ns.Data = G, D
local F = ns.Format

local function db() return ns.db and ns.db() end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function groups()
  local d = db()
  if not d then return {} end
  d.groups = d.groups or {}
  return d.groups
end

G.LABEL = { present = "Présent", late = "En retard", tentative = "Peut-être", absent = "Absent", bench = "Banc", alt = "Reroll" }
G.COLOR = { present = "|cff4fd35f", late = "|cfff0b43c", tentative = "|cff9aa3b6", absent = "|cffff6b5e", bench = "|cff9aa3b6", alt = "|cff9aa3b6" }
G.DIFFICULTY = { normal = "Normal", heroic = "Héroïque", mythic = "Mythique" }
-- Fenêtre du relevé : de 2 h avant l'heure prévue à 3 h après
G.BEFORE, G.AFTER = 2 * 3600, 3 * 3600

-- Plusieurs groupes : ils remplacent ceux déjà chargés ; un seul : il est ajouté ou mis à jour
function G.Load(list)
  local d = db()
  if not d then return false end
  if #list > 1 then d.groups = {} end
  local all = groups()
  for _, g in ipairs(list) do all[g.id] = g end
  d.groupsAt = time()
  return true
end

function G.List()
  local out = {}
  for _, g in pairs(groups()) do out[#out + 1] = g end
  table.sort(out, function(a, b) return (a.name or "") < (b.name or "") end)
  return out
end

-- Raids à venir (ou commencés depuis moins de 3 h ; sans date à la fin) : { group, raid }
function G.Raids(now)
  now = now or time()
  local out = {}
  for _, g in pairs(groups()) do
    for _, r in ipairs(g.raids or {}) do
      if (r.time or 0) == 0 or r.time > now - G.AFTER then out[#out + 1] = { group = g, raid = r } end
    end
  end
  table.sort(out, function(a, b)
    local ta, tb = a.raid.time == 0 and math.huge or a.raid.time, b.raid.time == 0 and math.huge or b.raid.time
    if ta ~= tb then return ta < tb end
    return (a.raid.name or "") < (b.raid.name or "")
  end)
  return out
end

-- Raid du site en cours : heure prévue passée depuis moins de 3 h, ou dans moins de 2 h (le plus proche)
function G.Current(now)
  now = now or time()
  local best, gap
  for _, e in ipairs(G.Raids(now)) do
    local t = e.raid.time or 0
    if t > 0 and now >= t - G.BEFORE and now <= t + G.AFTER then
      local d = math.abs(now - t)
      if not gap or d < gap then best, gap = e, d end
    end
  end
  return best
end

-- Raid chargé d'après son identifiant
function G.Find(raidId)
  for _, g in pairs(groups()) do
    for _, r in ipairs(g.raids or {}) do if r.id == raidId then return { group = g, raid = r } end end
  end
  return nil
end

--------------------------------------------------------------------------------------------------------------------
-- Synchro : chargement des textes du site, export des bilans
--------------------------------------------------------------------------------------------------------------------
local plural = F.plural

-- Texte collé : un ou plusieurs blocs RRG (groupes) ou une compo RRR. Renvoie ok, message.
function D.Load(text)
  if not F.usable(text) then return false, "Texte illisible." end
  local d = db()
  if not d then return false, "Addon pas encore prêt : réessaie dans un instant." end
  local kind = F.Kind(text)
  if F.IsForever(text) then return false, F.FOREVER end
  local msg
  if kind == "RRG" then
    local list, err = F.ParseRRG(text)
    if not list then return false, err end
    G.Load(list)
    local raids = 0
    for _, g in ipairs(list) do raids = raids + #g.raids end
    msg = plural(#list, "groupe") .. " (" .. plural(raids, "raid") .. ")"
  elseif kind == "RRR" then
    local ok, err = ns.Compo.Load(text)
    if not ok then return false, err end
    local raid, members = ns.Compo.Get()
    msg = "compo « " .. (raid and raid.name or "?") .. " » : " .. plural(#members, "perso") .. " (onglet Compo)"
  elseif kind == "RRB" then
    return false, "Ce texte est un bilan de raid : colle-le sur le site (Ctrl+V sur n'importe quelle page)."
  else
    return false, "Texte non reconnu : sur Roster, « Copier pour le jeu » (barre du haut) ou « Export pour le jeu » d'un raid (onglet Compo)."
  end
  d.lastLoad = { at = time(), text = msg }
  refresh()
  return true, "Chargé : " .. msg .. "."
end

-- Bilans à envoyer (RRB) : ceux pas encore envoyés (ou changés depuis) ; all : tous ceux des 3 derniers jours
local lastExport = nil
function D.ExportText(all)
  local logs = all and ns.Recorder.Recent(3) or ns.Recorder.Pending()
  local blocks = {}
  lastExport = {}
  for _, log in ipairs(logs) do
    blocks[#blocks + 1] = ns.Recorder.Block(log)
    lastExport[#lastExport + 1] = { log = log, updated = log.updated or 0 }
  end
  return table.concat(blocks, "\n"), #logs
end

-- Le texte exporté a été copié : ces bilans sont envoyés (un relevé fait depuis l'export repart à la prochaine synchro)
function D.MarkSent()
  local list = lastExport
  if not list then
    list = {}
    for _, log in ipairs(ns.Recorder.Pending()) do list[#list + 1] = { log = log, updated = log.updated or 0 } end
  end
  for _, e in ipairs(list) do e.log.sentAt = math.max(e.log.sentAt or 0, e.updated) end
  lastExport = nil
  if ns.Minimap and ns.Minimap.Update then ns.safe("minicarte", ns.Minimap.Update) end
  refresh()
end

function D.PendingCount() return #ns.Recorder.Pending() end

-- Une ligne : groupes chargés et quand, compo chargée
function D.Summary()
  local d = db() or {}
  local list = G.List()
  local parts = {}
  if #list > 0 then
    parts[#parts + 1] = plural(#list, "groupe chargé", "groupes chargés") .. (d.groupsAt and (" le " .. date("%d/%m à %H:%M", d.groupsAt)) or "")
  end
  local raid = ns.Compo and ns.Compo.Get()
  if raid then parts[#parts + 1] = "compo « " .. raid.name .. " » chargée" end
  if #parts == 0 then return "Aucune donnée du site : sur Roster, « Copier pour le jeu », puis colle ici." end
  return "Données du site : " .. table.concat(parts, " · ") .. "."
end

return G
