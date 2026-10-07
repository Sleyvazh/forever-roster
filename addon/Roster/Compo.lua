-- Compo de raid venue du site (RRR) : état de chaque perso dans le groupe, invitations et placement dans les groupes.
-- Hors combat seulement : ConvertToRaid (12.0.5), SetRaidSubgroup et SwapRaidSubgroup (chef du raid ou assistant).
local _, ns = ...
local C = {}
ns.Compo = C
local F = ns.Format

local function db() return ns.db and ns.db() end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function combat() return InCombatLockdown and InCombatLockdown() == true end
local function invite(name) return C_PartyInfo and C_PartyInfo.InviteUnit and pcall(C_PartyInfo.InviteUnit, name) end
local function toRaid() return C_PartyInfo and C_PartyInfo.ConvertToRaid and pcall(C_PartyInfo.ConvertToRaid) end
local INVITABLE = { present = true, late = true, tentative = true, alt = true, [""] = true }

function C.Load(text)
  local raid, members = F.ParseRRR(text)
  if not raid then return false, members end
  local d = db()
  if not d then return false, "Addon pas encore prêt : réessaie dans un instant." end
  d.compo = { raid = raid, members = members, at = time() }
  return true
end

-- Une compo s'efface d'elle-même 12 h après l'heure du raid ; sans date, avec « Effacer la compo »
C.KEEP = 12 * 3600
function C.Get()
  local d = db()
  local c = d and d.compo
  if c and c.raid and (c.raid.time or 0) > 0 and time() > c.raid.time + C.KEEP then
    d.compo = nil
    return nil, {}
  end
  return c and c.raid, c and c.members or {}
end

function C.Clear()
  local d = db()
  if d then d.compo = nil end
  refresh()
end

C.STATE = { ok = "bon groupe", move = "à déplacer", missing = "absent du raid", manual = "inscrit Discord : à inviter à la main", bench = "banc", unplaced = "pas placé" }

-- État de chaque perso de la compo : ok (bon groupe ; en groupe hors raid : présent), move (pas le bon groupe),
-- missing (pas dans le groupe), manual (inscrit Discord : pseudo, à inviter à la main), bench (banc), unplaced (pas placé)
function C.Status()
  local _, members = C.Get()
  local _, byKey = ns.Comm.Roster()
  local raid = ns.Comm.InRaid()
  local list = {}
  for _, m in ipairs(members) do
    local key = F.Key(m.name)
    local r = key and byKey[key]
    local state
    if m.status == "bench" then state = "bench"
    elseif r then state = (m.group == 0 or not raid or r.subgroup == m.group) and "ok" or "move"
    elseif m.group == 0 then state = "unplaced"
    elseif m.source == "discord" then state = "manual"
    else state = "missing" end
    list[#list + 1] = { m = m, state = state, online = r and r.online, inGroup = r ~= nil }
  end
  return list
end

--------------------------------------------------------------------------------------------------------------------
-- Invitations : persos placés pas encore dans le groupe (sauf banc et inscrits Discord). Un groupe hors raid ne dépasse
-- pas 5 : on invite d'abord de quoi le remplir, on passe en raid dès que quelqu'un a rejoint, puis on invite la suite.
--------------------------------------------------------------------------------------------------------------------
C.pending = {}
function C.Invite()
  if combat() then ns.print("impossible en combat : réessaie juste après.") return false end
  local inGroup = ns.Comm.InGroup()
  if inGroup and not ns.Comm.IsLead() then ns.print("seul le chef du groupe ou un assistant peut inviter.") return false end
  local _, members = C.Get()
  if #members == 0 then ns.print("aucune compo chargée : sur Roster, page du raid, onglet Compo, « Export pour le jeu », puis colle-la dans l'onglet Synchro.") return false end
  local _, byKey = ns.Comm.Roster()
  local me = F.Key(ns.Comm.Me())
  local manual = {}
  local pending = {}
  for _, m in ipairs(members) do
    local key = F.Key(m.name)
    if key and m.group > 0 and key ~= me and not byKey[key] and INVITABLE[m.status or ""] then
      if m.source == "discord" then manual[#manual + 1] = m.name else pending[#pending + 1] = F.FullName(m.name) end
    end
  end
  C.pending = pending
  local raid = ns.Comm.InRaid()
  local size = GetNumGroupMembers and GetNumGroupMembers() or 0
  if F.secret(size) then size = 0 end
  local room = raid and #pending or math.max(0, 5 - math.max(1, size))
  local sent = 0
  for _ = 1, math.min(room, #pending) do
    if invite(table.remove(pending, 1)) then sent = sent + 1 end
  end
  -- Déjà en groupe (2 ou plus) et encore du monde à inviter : passage en raid tout de suite
  if #pending > 0 and not raid and size > 1 and ns.Comm.IsLeader() then toRaid() end
  ns.print(F.plural(sent, "invitation envoyée", "invitations envoyées") .. (#pending > 0 and (", " .. #pending .. " en attente du passage en raid") or "") .. ".")
  if #manual > 0 then ns.print("à inviter à la main (inscrits Discord, le pseudo n'est pas forcément le nom en jeu) : " .. table.concat(manual, ", ")) end
  return true
end

local function inviteRest()
  if #C.pending == 0 or combat() then return end
  if not ns.Comm.InRaid() then
    local size = GetNumGroupMembers and GetNumGroupMembers() or 0
    if not F.secret(size) and size > 1 and ns.Comm.IsLeader() then toRaid() end
    return
  end
  local n = 0
  while #C.pending > 0 do if invite(table.remove(C.pending, 1)) then n = n + 1 end end
  ns.print("raid formé : " .. F.plural(n, "invitation", "invitations") .. " de plus.")
end
ns.on("GROUP_ROSTER_UPDATE", function() ns.safe("invitations", inviteRest) end)
ns.on("PLAYER_REGEN_ENABLED", function() ns.safe("invitations", inviteRest) end)

--------------------------------------------------------------------------------------------------------------------
-- Placement : un déplacement à la fois (le jeu met à jour le raid après coup), au rythme de GROUP_ROSTER_UPDATE
--------------------------------------------------------------------------------------------------------------------
C.arranging = false
local steps, stepId = 0, 0
local function step()
  local list, byKey, counts = ns.Comm.Roster()
  local _, members = C.Get()
  local want, order = {}, {}
  for _, m in ipairs(members) do
    local key = F.Key(m.name)
    if key and m.group > 0 and m.status ~= "bench" and m.source ~= "discord" then want[key] = m.group order[#order + 1] = key end
  end
  for _, key in ipairs(order) do
    local r, g = byKey[key], want[key]
    if r and r.subgroup and r.subgroup ~= g then
      if (counts[g] or 0) < 5 then
        if not pcall(SetRaidSubgroup, r.index, g) then return false end
        return true
      end
      -- Groupe plein : échange avec quelqu'un qui n'a rien à faire dans ce groupe
      for _, o in ipairs(list) do
        if o.subgroup == g and (not o.key or want[o.key] ~= g) then
          if not pcall(SwapRaidSubgroup, r.index, o.index) then return false end
          return true
        end
      end
    end
  end
  return false
end

local function stop(msg)
  C.arranging = false
  if msg then ns.print(msg) end
  refresh()
end
-- Le jeu n'a pas répondu (déplacement refusé) : placement interrompu
local function watch()
  stepId = stepId + 1
  local id = stepId
  if C_Timer and C_Timer.After then
    C_Timer.After(4, function() if C.arranging and stepId == id then stop("placement interrompu : le jeu n'a pas répondu.") end end)
  end
end

function C.Arrange()
  if not ns.Comm.InRaid() then ns.print("il faut être en raid pour placer les groupes.") return false end
  if not ns.Comm.IsLead() then ns.print("il faut être chef du raid ou assistant pour placer les groupes.") return false end
  if combat() then ns.print("impossible en combat : réessaie juste après.") return false end
  local raid = C.Get()
  if not raid then ns.print("aucune compo chargée.") return false end
  C.arranging, steps = true, 0
  if step() then watch() else stop("les groupes sont déjà bons.") end
  return true
end

local scheduled = false
ns.on("GROUP_ROSTER_UPDATE", function()
  if not C.arranging or scheduled then return end
  steps = steps + 1
  if combat() then stop("placement interrompu : combat.") return end
  if steps > 80 then stop("placement interrompu : trop de déplacements.") return end
  -- Petit délai : laisse le jeu terminer le déplacement précédent (plusieurs mises à jour pour un seul déplacement)
  local function go()
    scheduled = false
    if not C.arranging then return end
    if combat() then stop("placement interrompu : combat.") return end
    if step() then watch() else stop("groupes placés.") end
  end
  if C_Timer and C_Timer.After then
    scheduled = true
    C_Timer.After(0.2, function() ns.safe("placement", go) end)
  else go() end
end)

return C
