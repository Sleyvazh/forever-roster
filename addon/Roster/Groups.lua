-- Données du site collées en jeu : groupes et raids à venir (RRG), compo d'un raid (RRR, Compo.lua).
-- ns.Groups : groupes chargés (RosterDB.groups), raids à venir, raid en cours pour le relevé ; partage des groupes
-- signés par le site avec la guilde et le raid (addon/shared/Share.lua, en bas de ce fichier).
-- ns.Data : ce que la synchro (onglet Synchro, synchro rapide, bouton de la minicarte) charge et exporte.
local _, ns = ...
local L, N = ns.L, ns.N
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

-- Statuts d'inscription et difficultés : clés en français, traduites à l'affichage (G.Label, G.Difficulty)
G.LABEL = { present = N("Présent"), late = N("En retard"), tentative = N("Peut-être"), absent = N("Absent"), bench = N("Banc"), alt = N("Reroll") }
G.COLOR = { present = "|cff4fd35f", late = "|cfff0b43c", tentative = "|cff9aa3b6", absent = "|cffff6b5e", bench = "|cff9aa3b6", alt = "|cff9aa3b6" }
G.DIFFICULTY = { normal = N("Normal"), heroic = N("Héroïque"), mythic = N("Mythique") }
function G.Label(status) local l = G.LABEL[status] return l and L[l] or status end
function G.Difficulty(key) local l = G.DIFFICULTY[key] return l and L[l] or key end
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

-- Lot R3b : raid du site pour le butin (celui du relevé en cours, sinon le raid en cours), son conseil et ses objets reçus
function G.LootRaid(now)
  local log = ns.Recorder and ns.Recorder.Current and ns.Recorder.Current()
  return (log and G.Find(log.raidId)) or G.Current(now)
end
-- Conseil du butin : choisi pour ce raid sur le site (ligne L), sinon les officiers et le propriétaire du groupe (ligne O)
function G.Council(e)
  if not e then return {} end
  local chosen = e.group.council and e.group.council[e.raid.id]
  if chosen and #chosen > 0 then return chosen end
  return e.group.officers or {}
end
-- Objets reçus sur la période du groupe (ligne N) : { short, label, entries } ou nil
function G.Counts(e) return e and e.group.counts or nil end
-- Objets reçus du site pour le butin (lot R4a, colonne « Reçus » : site + historique de l'addon après la date des données
-- du site) : ceux du groupe du raid en cours (relevé ou raid du site), sinon ceux du seul groupe chargé qui en a (raid
-- monté ailleurs, Raid-Helper…) ; plusieurs groupes sans raid du site : aucun (l'historique de l'addon seul).
-- Renvoie le bloc N (ou nil) et la date de génération des données du site (en-tête RRG).
function G.LootCounts(now)
  local e = G.LootRaid(now)
  if e then return e.group.counts, tonumber(e.group.at) end
  local found
  for _, g in pairs(groups()) do
    if g.counts then
      if found then return nil end
      found = g
    end
  end
  if found then return found.counts, tonumber(found.at) end
  return nil
end

--------------------------------------------------------------------------------------------------------------------
-- Synchro : chargement des textes du site, export des bilans
--------------------------------------------------------------------------------------------------------------------
-- « 2 groupes » / « 1 groupe » (clés N au singulier et au pluriel) : texte traduit, et le même en français pour la
-- sauvegarde (jamais traduite)
local function count(n, one, many) return L(F.Many(n) and many or one, n), string.format(n > 1 and many or one, n) end

-- Texte collé : un ou plusieurs blocs RRG (groupes) ou une compo RRR. Renvoie ok, message.
function D.Load(text)
  if not F.usable(text) then return false, L["Texte illisible."] end
  local d = db()
  if not d then return false, L["Addon pas encore prêt : réessaie dans un instant."] end
  local kind = F.Kind(text)
  if F.IsForever(text) then return false, L[F.FOREVER] end
  local msg, saved
  if kind == "RRG" then
    local list, err = F.ParseRRG(text)
    if not list then return false, err end
    for _, g in ipairs(list) do g.origin = { at = time() } end -- collées
    G.Load(list)
    -- Données neuves : annoncées à la guilde et au raid (seulement les blocs signés par le site)
    G.ShareSoon("GUILD", 1, 3)
    G.ShareSoon("RAID", 1, 3)
    local raids = 0
    for _, g in ipairs(list) do raids = raids + #g.raids end
    local groupsText, groupsFr = count(#list, N("%d groupe"), N("%d groupes"))
    local raidsText, raidsFr = count(raids, N("%d raid"), N("%d raids"))
    msg, saved = groupsText .. " (" .. raidsText .. ")", groupsFr .. " (" .. raidsFr .. ")"
  elseif kind == "RRR" then
    local ok, err = ns.Compo.Load(text)
    if not ok then return false, err end
    local raid, members = ns.Compo.Get()
    local name = raid and raid.name or "?"
    local who, whoFr = count(#members, N("%d perso"), N("%d persos"))
    msg = L("compo « %s » : %s (onglet Compo)", name, who)
    saved = string.format(N("compo « %s » : %s (onglet Compo)"), name, whoFr)
  elseif kind == "RRB" then
    return false, L["Ce texte est un bilan de raid : colle-le sur le site (Ctrl+V sur n'importe quelle page)."]
  else
    return false, L["Texte non reconnu : sur Roster, « Copier pour le jeu » (barre du haut) ou « Export pour le jeu » d'un raid (onglet Compo)."]
  end
  d.lastLoad = { at = time(), text = saved }
  refresh()
  return true, L("Chargé : %s.", msg)
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
  if ns.Minimap and ns.Minimap.Update then ns.safe(L["minicarte"], ns.Minimap.Update) end
  refresh()
end

function D.PendingCount() return #ns.Recorder.Pending() end

-- Une ligne : groupes chargés et quand, compo chargée
function D.Summary()
  local d = db() or {}
  local list = G.List()
  local parts = {}
  if #list > 0 then
    parts[#parts + 1] = (F.Many(#list) and L("%d groupes chargés", #list) or L("%d groupe chargé", #list)) .. (d.groupsAt and (" " .. L("le %s", F.Stamp(d.groupsAt))) or "")
  end
  local raid = ns.Compo and ns.Compo.Get()
  if raid then parts[#parts + 1] = L("compo « %s » chargée", raid.name) end
  if #parts == 0 then return L["Aucune donnée du site : sur Roster, « Copier pour le jeu », puis colle ici."] end
  return L("Données du site : %s.", table.concat(parts, " · "))
end

-- Origine des données de chaque groupe (onglet Synchro) : collées ou reçues d'un joueur, quand ; pourquoi elles ne se
-- partagent pas (texte sans signature du site, clé du site pas encore dans l'addon)
local NOT_SHARED = { unsigned = N("pas signées par le site"), invalid = N("pas signées par le site"), key = N("clé du site inconnue") }
function D.Origins()
  local out, d = {}, db() or {}
  for _, g in ipairs(G.List()) do
    local o = type(g.origin) == "table" and g.origin or {}
    local at = o.at or d.groupsAt
    local how
    if o.from then
      how = at and L("reçues de %s le %s", F.Display(o.from), F.Stamp(at)) or L("reçues de %s", F.Display(o.from))
    else
      how = at and L("collées le %s", F.Stamp(at)) or L["collées"]
    end
    local status = (g.text and ns.Share and ns.Share.Status) and ns.Share.Status(g.text, "RRG") or "unsigned"
    local why = G.ShareOn() and NOT_SHARED[status]
    out[#out + 1] = L("%s : %s", g.name or "?", how) .. (why and (" · " .. L("non partagées : %s", L[why])) or "")
  end
  return out
end

--------------------------------------------------------------------------------------------------------------------
-- Partage entre joueurs (addon/shared/Share.lua) : un joueur colle les données du site, son addon les annonce à la
-- guilde et au raid ; les addons qui ont une version plus ancienne (ou rien) la demandent, la vérifient (signature du
-- site, ligne M : un de mes persos est membre du groupe) et l'appliquent. Option : RosterDB.share (nil : oui, par
-- défaut ; false : ni annonce ni envoi, la réception continue). Messages SHV, SHQ, SHD : docs/addon-format.md.
--------------------------------------------------------------------------------------------------------------------
local Sh = ns.Share or {} -- Share.lua absent ou cassé : pas de partage, le reste de l'addon marche
local function isTrue(v) return not F.secret(v) and v and true or false end
local function inGuild()
  local ok, r = pcall(function() return IsInGuild and IsInGuild() end)
  return ok and isTrue(r)
end
local function inRaid() return ns.Comm ~= nil and ns.Comm.InRaid() end

function G.ShareOn()
  local d = db()
  return not (d and d.share == false)
end

-- Mes persos (clés F.Key) : celui-ci, ceux du compte déjà vus par l'addon (RosterDB.chars, notés à la connexion), et
-- ceux de mes inscriptions dans les données du site
function G.MyChars()
  local out = {}
  local function add(name) local k = F.Key(name) if k then out[k] = true end end
  if ns.Comm then add(ns.Comm.Me()) end
  local d = db()
  for _, name in pairs(d and type(d.chars) == "table" and d.chars or {}) do add(name) end
  for _, g in pairs(groups()) do
    for _, r in ipairs(g.raids or {}) do if r.char then add(r.char) end end
  end
  return out
end

-- Annonce sur la guilde ou le raid dans min à max secondes (une annonce déjà prévue plus tôt suffit)
local soonAt = {}
function G.ShareSoon(dist, min, max)
  if not (Sh.Announce and Sh.Jitter) then return false end
  local delay = Sh.Jitter(min or 1, max or 3)
  local at = time() + delay
  if soonAt[dist] and soonAt[dist] <= at then return false end
  soonAt[dist] = at
  local function go()
    if soonAt[dist] == at then soonAt[dist] = nil end
    if not G.ShareOn() then return end
    if dist == "GUILD" and not inGuild() then return end
    if dist == "RAID" and not inRaid() then return end
    Sh.Announce(dist, dist == "RAID")
  end
  if C_Timer and C_Timer.After then C_Timer.After(delay, go) else go() end
  return true
end

-- Bloc reçu d'un autre joueur (déjà vérifié par Share.lua) : il remplace mes données de ce groupe, en gardant mon
-- inscription (statut et perso) pour chaque raid que j'avais déjà ; un raid nouveau pour moi : inscription inconnue
-- (r.unknown). Puis relais sur l'autre canal (guilde → raid, raid → guilde).
local function applyShared(text, sender, dist)
  local list = F.ParseRRG(text)
  local g = list and #list == 1 and list[1]
  if not (g and g.text) then return false end
  local old = groups()[g.id]
  local before = {}
  for _, r in ipairs(old and old.raids or {}) do before[r.id] = r end
  for _, r in ipairs(g.raids) do
    local o = before[r.id]
    if o then r.status, r.char, r.unknown = o.status, o.char, o.unknown
    else r.status, r.char, r.unknown = nil, nil, true end
  end
  g.origin = { from = F.FullName(sender), at = time() }
  if not G.Load({ g }) then return false end
  refresh()
  if ns.Minimap and ns.Minimap.Update then ns.safe(L["minicarte"], ns.Minimap.Update) end
  G.ShareSoon(dist == "RAID" and "GUILD" or "RAID", 2, 6)
  return true
end

if Sh.Setup then Sh.Setup({
  kind = "RRG",
  -- File des messages de Comm.lua (combat de boss, limite du jeu), après les messages du butin
  send = function(msg, dist, target) return ns.Comm.Send(msg, dist, target, nil, true) end,
  blocks = function()
    local out = {}
    for id, g in pairs(groups()) do out[id] = { at = tonumber(g.at) or 0, text = g.text } end
    return out
  end,
  apply = applyShared,
  mine = function(list)
    local own = G.MyChars()
    for _, name in ipairs(list) do
      local k = F.Key(name)
      if k and own[k] then return true end
    end
    return false
  end,
  notify = function(text) ns.print(text) end,
  enabled = G.ShareOn,
  display = function(name) return F.Display(name) end,
  stamp = function(at) return F.Stamp(at) end,
}) end

for _, code in ipairs({ "SHV", "SHQ", "SHD" }) do
  ns.Comm.On(code, function(sender, _, dist, msg)
    if F.SameName(sender, ns.Comm.Me()) or not Sh.OnMessage then return end -- écho de mes propres messages
    Sh.OnMessage(sender, msg, dist)
  end)
end

-- Connexion : ce perso est noté parmi ceux du compte ; annonce à la guilde 20 à 40 s après (le temps que tout charge)
ns.on("PLAYER_LOGIN", function()
  local d = db()
  local me = ns.Comm.Me()
  if d and me ~= "?" then
    d.chars = type(d.chars) == "table" and d.chars or {}
    d.chars[F.Fold(me)] = me
  end
  G.ShareSoon("GUILD", 20, 40)
end)

-- Arrivée dans un raid, ou raid qui s'agrandit : annonce au raid (pour ceux qui ne sont pas de la guilde)
local wasRaid, lastCount = false, 0
ns.on("GROUP_ROSTER_UPDATE", function()
  local raid = inRaid()
  local n = 0
  if raid and GetNumGroupMembers then
    local ok, c = pcall(GetNumGroupMembers)
    if ok and not F.secret(c) and type(c) == "number" then n = c end
  end
  if raid and (not wasRaid or n > lastCount) then G.ShareSoon("RAID", 3, 8) end
  wasRaid, lastCount = raid, n
end)

return G
