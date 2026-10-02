-- Compo de raid venue du site : invitations et placement dans les groupes.
local _, ns = ...
local C = {}
ns.Compo = C

local InviteUnit = (C_PartyInfo and C_PartyInfo.InviteUnit) or InviteUnit
local ConvertToRaid = (C_PartyInfo and C_PartyInfo.ConvertToRaid) or ConvertToRaid
local INVITABLE = { present = true, late = true, tentative = true, alt = true, [""] = true }

local function short(name) return name and (Ambiguate and Ambiguate(name, "none") or name:gsub("%-.*$", "")) end
local function lower(s) return s and s:lower() end

function C.Load(text)
  local raid, members = ns.Format.ParseFRR(text)
  if not raid then return false, members end
  ForeverRosterDB.compo = { raid = raid, members = members, text = text }
  return true
end

function C.Get()
  local c = ForeverRosterDB and ForeverRosterDB.compo
  return c and c.raid, c and c.members or {}
end

-- Groupe actuel : nom en minuscules → { index, subgroup, online }
function C.Roster()
  local roster, counts = {}, { 0, 0, 0, 0, 0, 0, 0, 0 }
  if IsInRaid() then
    for i = 1, GetNumGroupMembers() do
      local name, _, subgroup, _, _, _, _, online = GetRaidRosterInfo(i)
      if name then
        roster[lower(short(name))] = { index = i, subgroup = subgroup, online = online }
        counts[subgroup] = (counts[subgroup] or 0) + 1
      end
    end
  else
    roster[lower(UnitName("player"))] = { index = 0, subgroup = 1, online = true }
    for i = 1, GetNumSubgroupMembers() do
      local name = UnitName("party" .. i)
      if name then roster[lower(name)] = { index = 0, subgroup = 1, online = UnitIsConnected("party" .. i) } end
    end
  end
  return roster, counts
end

-- État de chaque membre de la compo : "ok" (bon groupe), "move" (pas le bon groupe), "missing", "bench" (non placé), "manual" (inscrit Discord)
function C.Status()
  local _, members = C.Get()
  local roster = C.Roster()
  local list = {}
  for _, m in ipairs(members) do
    local r = roster[lower(m.name)]
    local state
    if m.group == 0 then state = "bench"
    elseif r then state = (not IsInRaid() or r.subgroup == m.group) and "ok" or "move"
    elseif m.source == "discord" then state = "manual"
    else state = "missing" end
    list[#list + 1] = { m = m, state = state, online = r and r.online }
  end
  return list
end

-- Invitations : persos placés, pas encore dans le groupe ; passage en raid dès que le groupe est formé.
local pending = {}
function C.Invite()
  if IsInGroup() and not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then
    ns.print("seul le chef du groupe ou un assistant peut inviter.")
    return
  end
  local roster = C.Roster()
  local _, members = C.Get()
  local me, sent, manual = lower(UnitName("player")), 0, {}
  wipe(pending)
  for _, m in ipairs(members) do
    local key = lower(m.name)
    if m.group > 0 and key ~= me and not roster[key] and INVITABLE[m.status or ""] then
      if m.source == "discord" then manual[#manual + 1] = m.name else pending[#pending + 1] = m.name end
    end
  end
  -- Hors raid, un groupe ne dépasse pas 5 : on invite 4 joueurs, la suite part après le passage en raid
  local room = IsInRaid() and #pending or math.max(0, 5 - math.max(1, GetNumGroupMembers()))
  for _ = 1, math.min(room, #pending) do
    InviteUnit(table.remove(pending, 1)); sent = sent + 1
  end
  ns.print(sent .. " invitation(s) envoyée(s)" .. (#pending > 0 and (", " .. #pending .. " en attente du passage en raid") or "") .. ".")
  if #manual > 0 then ns.print("à inviter à la main (inscrits Discord) : " .. table.concat(manual, ", ")) end
end

ns.on("GROUP_ROSTER_UPDATE", function()
  if #pending == 0 or not UnitIsGroupLeader("player") then return end
  if not IsInRaid() and GetNumGroupMembers() > 1 then ConvertToRaid() return end
  if IsInRaid() then
    local n = #pending
    while #pending > 0 do InviteUnit(table.remove(pending, 1)) end
    ns.print("raid formé : " .. n .. " invitation(s) de plus.")
  end
end)

-- Placement : un déplacement à la fois (le jeu met à jour le raid de façon asynchrone).
local arranging, steps = false, 0
local function step()
  local roster, counts = C.Roster()
  local _, members = C.Get()
  local want = {}
  for _, m in ipairs(members) do if m.group > 0 then want[lower(m.name)] = m.group end end
  for name, g in pairs(want) do
    local r = roster[name]
    if r and r.subgroup ~= g then
      if (counts[g] or 0) < 5 then SetRaidSubgroup(r.index, g) return true end
      -- groupe plein : échange avec quelqu'un qui n'a rien à faire dans ce groupe
      for other, o in pairs(roster) do
        if o.subgroup == g and want[other] ~= g then SwapRaidSubgroup(r.index, o.index) return true end
      end
    end
  end
  return false
end

function C.Arrange()
  if not IsInRaid() then ns.print("il faut être en raid pour placer les groupes.") return end
  if not (UnitIsGroupLeader("player") or UnitIsGroupAssistant("player")) then ns.print("il faut être chef du raid ou assistant.") return end
  if InCombatLockdown() then ns.print("impossible en combat.") return end
  arranging, steps = true, 0
  if not step() then arranging = false ns.print("les groupes sont déjà bons.") end
end

ns.on("GROUP_ROSTER_UPDATE", function()
  if not arranging then return end
  steps = steps + 1
  if InCombatLockdown() or steps > 80 then arranging = false ns.print("placement interrompu.") return end
  -- petit délai : laisse le jeu terminer le déplacement précédent
  C_Timer.After(0.2, function()
    if arranging and not step() then arranging = false ns.print("groupes placés.") end
    if ns.UI and ns.UI.RefreshCompo then ns.UI.RefreshCompo() end
  end)
end)
