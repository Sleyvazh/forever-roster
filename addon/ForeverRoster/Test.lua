-- Raid d'essai (/fr test) : un raid fictif de 10 joueurs pour tout essayer seul, hors groupe. Les 9 autres joueurs sont
-- simulés (versions de l'addon, consommables, jets, réponses et votes du conseil) ; rien ne part au site, au chat du
-- raid ni aux autres joueurs. Le butin de maître et l'échange réels restent à vérifier dans un vrai raid.
local _, ns = ...
local RA = ns.Raid
local K = ns.UI.kit
local T = {}
ns.Test = T

local GREY, ORANGE = "|cff9aa3b6", "|cfff0b43c"
local function me() return UnitName("player") or "?" end
local function refresh()
  if ns.UI.Refresh then ns.UI.Refresh() end
  if RA.RefreshWindows then RA.RefreshWindows() end
  if T.Refresh then T.Refresh() end
end
-- Action différée, abandonnée si l'essai s'est arrêté entre-temps
local function after(sec, fn) C_Timer.After(sec, function() if RA.test then ns.safe("raid d'essai", fn) end end) end
local function say(text) ns.print(GREY .. "(essai) " .. text .. "|r") end

-- Joueurs fictifs : rôle, type de DPS ; old = ancienne version de l'addon (sans conseil ni consommables), noAddon = sans addon
local PLAYERS = {
  { name = "Gorrak", role = "Tank" },
  { name = "Brakka", role = "Tank" },
  { name = "Nyssaël", role = "Heal" },
  { name = "Grumdal", role = "Heal" },
  { name = "Mirelle", role = "Heal", noAddon = true },
  { name = "Vesper", role = "DPS", dps = "melee" },
  { name = "Sylvaë", role = "DPS", dps = "caster" },
  { name = "Ilyra", role = "DPS", dps = "caster" },
  { name = "Thorn", role = "DPS", dps = "ranged", old = "0.9.0" },
}
local CONSUMABLES = {
  { itemId = 13457, name = "Greater Fire Protection Potion", n = 5, target = "all" },
  { itemId = 13445, name = "Elixir of Superior Defense", n = 5, target = "tank" },
  { itemId = 13444, name = "Major Mana Potion", n = 10, target = "heal" },
  { itemId = 13452, name = "Elixir of the Mongoose", n = 5, target = "melee" },
}
-- Sacs des joueurs fictifs (certains manquent de quelque chose)
local BAGS = {
  Gorrak = { [13457] = 5, [13445] = 2 }, Brakka = { [13457] = 6, [13445] = 5 },
  ["Nyssaël"] = { [13457] = 5, [13444] = 12 }, Grumdal = { [13457] = 5, [13444] = 4 },
  Vesper = { [13457] = 3, [13452] = 5 }, ["Sylvaë"] = { [13457] = 5 }, Ilyra = { [13457] = 8 },
}
local SR_ITEMS = {
  { id = 17063, name = "Band of Accuria" },            -- réservé avec bonus SR+ (et par toi)
  { id = 18815, name = "Essence of the Pure Flame" },  -- égalité, puis relance
  { id = 18814, name = "Choker of the Fire Lord" },    -- personne ne l'a réservé : personne en MS, puis jets OS
  { id = 17076, name = "Bonereaver's Edge" },          -- jet libre
}
local COUNCIL_ITEMS = { { id = 16901, name = "Stormrage Legguards" }, { id = 18817, name = "Crown of Destruction" } }
-- Objets portés, montrés au conseil (nom anglais tant que le jeu ne les a pas renvoyés)
local GEAR = {
  { id = 16835, name = "Cenarion Leggings" }, { id = 16847, name = "Giantstalker's Leggings" }, { id = 16822, name = "Nightslayer Pants" },
  { id = 16915, name = "Netherwind Pants" }, { id = 16867, name = "Legplates of Might" },
}
-- Objets reçus sur la saison (comme la ligne N des données du site) : colonne « Reçus » du conseil
local COUNTS = { Gorrak = 3, Brakka = 1, ["Nyssaël"] = 0, Grumdal = 2, Mirelle = 1, Vesper = 4, ["Sylvaë"] = 2, Ilyra = 1, Thorn = 0 }

-- Jets des joueurs fictifs : { nom, jet, dé lancé (s'il diffère du dé demandé : jet ignoré) }
local function rollsFor(item, kind, only)
  if only then -- relance entre ex æquo : des jets différents
    local out = {}
    for i, n in ipairs(only) do if n ~= me() then out[#out + 1] = { n, 20 + i * 27 } end end
    return out
  end
  local id = item.itemId
  if kind == "sr" and id == 17063 then return { { "Gorrak", 41 }, { "Vesper", 58 }, { "Sylvaë", 96 } } end -- Sylvaë n'a rien réservé
  if kind == "sr" and id == 18815 then return { { "Nyssaël", 67 }, { "Ilyra", 67 } } end
  if kind == "ms" and id == 18814 then return {} end
  if kind == "os" and id == 18814 then return { { "Sylvaë", 45 }, { "Ilyra", 81 }, { "Thorn", 72, 100 } } end
  if kind == "free" and id == 17076 then return { { "Vesper", 23 }, { "Gorrak", 88 }, { "Brakka", 54, 99 } } end
  local out, pool = {}, {}
  if kind == "sr" then
    for n in pairs((RA.session and RA.session.eligible) or {}) do if n ~= me() then pool[#pool + 1] = n end end
  else
    pool = { "Vesper", "Gorrak", "Ilyra", "Grumdal", "Sylvaë" }
  end
  for i = 1, math.min(3, #pool) do out[i] = { table.remove(pool, math.random(#pool)), math.random(1, kind == "os" and 99 or 100) } end
  return out
end
function T.Rolls(item, kind, only)
  local s = RA.session
  for i, r in ipairs(rollsFor(item, kind, only)) do
    after(0.7 * i, function() if RA.session == s then RA.OnRoll(r[1], r[2], 1, r[3] or s.max) end end)
  end
  if not s.eligible or s.eligible[me()] ~= nil then say("fais /roll " .. s.max .. " toi aussi : ton vrai jet compte.") end
end
local startRoll = RA.StartRoll
RA.StartRoll = function(item, kind, only)
  local ok = startRoll(item, kind, only)
  if ok and RA.test then T.Rolls(item, kind, only) end
  return ok
end

-- Conseil : réponses (addon ou chuchotées), puis votes de Gorrak et Nyssaël
local RESPONSES = {
  [16901] = { { "Mirelle", "bis", nil, true }, { "Nyssaël", "upgrade", "2e pièce du set" }, { "Ilyra", "upgrade" }, { "Vesper", "transmo" }, { "Grumdal", "off" }, { "Gorrak", "pass" } },
  default = { { "Sylvaë", "bis" }, { "Gorrak", "upgrade", "petit gain" }, { "Thorn", "off", nil, true }, { "Brakka", "pass" } },
}
local VOTES = { [16901] = { { "Gorrak", "Mirelle" }, { "Nyssaël", "Ilyra" } }, default = { { "Gorrak", "Sylvaë" }, { "Nyssaël", "Gorrak" } } }
function T.Council(sid, id)
  local list = RESPONSES[id] or RESPONSES.default
  for i, r in ipairs(list) do
    after(0.8 + i * 0.6, function()
      -- Sans addon (ou ancienne version) : réponse chuchotée au maître du butin, sans objets portés
      local gear = r[4] and "" or tostring(GEAR[i % #GEAR + 1].id)
      RA.Deliver(r[1], "LA;" .. sid .. ";" .. r[2] .. ";" .. gear .. ";" .. (r[4] and "chuchoté" or (r[3] or "")), "WHISPER")
    end)
  end
  for i, v in ipairs(VOTES[id] or VOTES.default) do
    after(1.2 + #list * 0.6 + i * 0.8, function() RA.Deliver(v[1], "LV;" .. sid .. ";" .. v[2], "WHISPER") end)
  end
  after(0.5, function() say("réponds dans la fenêtre « ta réponse », puis vote : Gorrak et Nyssaël votent aussi, à toi de départager et de donner.") end)
end

-- Messages vers le raid : on reçoit les siens (comme en jeu), les addons fictifs répondent
function T.send(msg, dist)
  if dist == "WHISPER" then return true end -- vers un joueur fictif : son addon n'a rien à renvoyer
  local f = ns.Format.split(msg)
  after(0.05, function() RA.Deliver(me(), msg, dist) end)
  if f[1] == "VQ" then
    for i, p in ipairs(PLAYERS) do
      if not p.noAddon then after(0.3 + i * 0.15, function() RA.Deliver(p.name, "VR;" .. (p.old or ns.version)) end) end
    end
    after(6, refresh) -- sans réponse au bout de 5 s : « pas d'addon »
  elseif f[1] == "CQ" then
    for i, p in ipairs(PLAYERS) do
      if not p.noAddon and not p.old then
        after(0.5 + i * 0.3, function()
          local parts = {}
          for id in tostring(f[2] or ""):gmatch("%d+") do parts[#parts + 1] = id .. ":" .. ((BAGS[p.name] or {})[tonumber(id)] or 0) end
          RA.Deliver(p.name, "CR;" .. table.concat(parts, ","), "WHISPER")
        end)
      end
    end
  elseif f[1] == "LO" then
    T.Council(f[2], tonumber(f[3]))
  end
  return true
end
-- Objet donné (butin de maître simulé) ; échange simulé
function T.award(item, winner, method, detail, response)
  local log = RA.test.log.loot
  log[#log + 1] = { who = winner, itemId = item.itemId, method = method, detail = detail, response = response }
  say("objet donné à " .. winner .. " par le butin de maître (simulé).")
end
function T.trade(entry)
  say("échange avec " .. entry.winner .. "...")
  after(1.5, function()
    local list = RA.test.handover
    for i = #list, 1, -1 do if list[i] == entry then table.remove(list, i) end end
    local log = RA.test.log.loot
    log[#log + 1] = { who = entry.winner, itemId = entry.itemId, method = entry.method, detail = entry.detail, response = entry.response }
    ns.print((entry.link or ns.Group.displayLink(entry.itemId, entry.name, entry.quality)) .. " remis à " .. entry.winner .. " (essai).")
    refresh()
  end)
  return true
end

local function reset()
  RA.items, RA.session, RA.councils, RA.asks, RA.call, RA.versions, RA.askedAt = {}, nil, {}, {}, nil, {}, nil
end
function RA.StartTest()
  if IsInGroup and IsInGroup() then ns.print("le raid d'essai se lance hors groupe : quitte le groupe d'abord.") return false end
  reset()
  local m = me()
  local members, roster = { m }, { [m] = { role = "DPS", dps = "melee" } }
  for _, p in ipairs(PLAYERS) do members[#members + 1] = p.name roster[p.name] = { role = p.role, dps = p.dps } end
  local counts = { short = "saison", label = "depuis le début de la saison (essai)", byName = {} }
  for name, n in pairs(COUNTS) do counts.byName[name] = { names = { name }, n = n } end
  counts.byName[m] = { names = { m }, n = 2 }
  local raggy = { name = "Ragnaros", encounterId = 672, npcIds = { 11502 }, rows = {
    { label = "Tank principal", names = { "Gorrak" }, text = "" },
    { label = "Fils de la flamme", names = { "Brakka", m }, text = "" },
    { label = "Soins des tanks", names = { "Nyssaël", "Mirelle" }, text = "" },
    { label = "Placement", names = {}, text = "distance et soigneurs à 30 m derrière le boss" },
  } }
  local domo = { name = "Majordomo Executus", encounterId = 671, npcIds = { 12018 }, rows = {
    { label = "Tanks", names = { "Gorrak", "Brakka" }, text = "" },
    { label = "Moutons", names = { "Sylvaë", "Ilyra" }, text = "" },
    { label = "Interruptions", names = { m }, text = "les soigneurs d'abord" },
  } }
  RA.test = {
    members = members, handover = {}, log = { loot = {} }, sheet = raggy,
    send = T.send, award = T.award, trade = T.trade,
    data = {
      entry = { raid = { id = "essai", name = "Raid d'essai · Molten Core", time = time(), loot = "softres" }, group = { name = "Groupe d'essai" } },
      loot = "softres", consumables = CONSUMABLES, bosses = { raggy, domo }, council = { m, "Gorrak", "Nyssaël" }, roster = roster,
      counts = counts,
      reserves = {
        [17063] = { { name = m, bonus = 0 }, { name = "Gorrak", bonus = 20 }, { name = "Vesper", bonus = 10 } },
        [18815] = { { name = "Nyssaël", bonus = 10 }, { name = "Ilyra", bonus = 10 } },
      },
    },
  }
  -- Objets demandés au jeu dès maintenant : leurs liens seront prêts à l'ouverture du corps
  for _, list in ipairs({ SR_ITEMS, COUNCIL_ITEMS, GEAR }) do
    for _, it in ipairs(list) do ns.Group.names[it.id] = ns.Group.names[it.id] or it.name ns.RequestItem(it.id) end
  end
  ns.print("raid d'essai lancé : 9 joueurs fictifs. Rien ne part au site, au chat du raid ni aux autres joueurs.")
  RA.ShowTest()
  refresh()
  return true
end
function RA.StopTest()
  if not RA.test then return end
  RA.test = nil
  reset()
  if T.panel then T.panel:Hide() end
  if RA.HideSheet then RA.HideSheet() end
  if RA.ShowAsk then RA.ShowAsk() end -- plus de question en attente : la fenêtre se ferme
  ns.print("raid d'essai terminé.")
  refresh()
end
ns.on("GROUP_ROSTER_UPDATE", function()
  if RA.test and IsInGroup and IsInGroup() then ns.print("tu es entré dans un groupe : raid d'essai arrêté.") RA.StopTest() end
end)

-- Corps ouvert (simulé) : les objets d'un mode de butin
function T.OpenCorpse(mode)
  local d = RA.test.data
  d.loot, d.entry.raid.loot = mode, mode
  RA.items, RA.session = {}, nil
  -- Pas de lien gardé : le nom du jeu (dans sa langue) s'affiche dès qu'il est connu, l'anglais en attendant
  for _, it in ipairs(mode == "council" and COUNCIL_ITEMS or SR_ITEMS) do
    RA.items[#RA.items + 1] = { itemId = it.id, name = it.name, quality = 4, test = true }
  end
  RA.ShowLoot()
  refresh()
end
function T.ShowBoss()
  RA.dismissed[RA.test.sheet.name] = nil
  RA.ShowSheet(RA.test.sheet)
end

-- Panneau d'essai : une étape par fonction
function RA.ShowTest()
  if not RA.test then return RA.StartTest() end
  if not T.panel then T.panel = RA.listWindow("ForeverRosterTest", "Raid d'essai", 540) end
  K.front(T.panel)
  T.panel:Show()
  T.Refresh()
end
function T.Refresh()
  local p = T.panel
  if not p or not p:IsShown() or not RA.test then return end
  local L = p.list
  p.hintText:SetText(ORANGE .. "Toi et 9 joueurs fictifs. Rien ne part au site, au chat du raid ni aux autres joueurs.|r")
  L.Reset()
  L.Header("1. Qui a l'addon")
  L.Add("Thorn a une ancienne version, Mirelle n'a pas l'addon." .. GREY .. "\nRésultat dans l'onglet En raid (Mirelle passe en « pas d'addon » au bout de 5 s).|r",
    { { "Demander les versions", 180, function() RA.AskVersions(true) ns.UI.Show("enraid") end } })
  L.Header("2. Consommables")
  L.Add("Chacun répond avec ses sacs ; tes vraies potions comptent." .. GREY .. "\nPrêts, manques et sans réponse dans l'onglet En raid.|r",
    { { "Appel aux consommables", 200, function() RA.CallConsumables() ns.UI.Show("enraid") end } })
  L.Header("3. Fiche du boss")
  L.Add("Hors combat, cible n'importe quel PNJ : la fiche de Ragnaros s'ouvre, comme en ciblant le boss. Attaque-le : elle se ferme." .. GREY .. "\nTu as une tâche sur Ragnaros (Fils de la flamme).|r",
    { { "Afficher la fiche", 140, function() T.ShowBoss() end }, { "Début du combat", 140, function() RA.HideSheet() end } })
  L.Header("4. Butin en soft reserve")
  L.Add("Jets SR avec bonus SR+ (tu as réservé l'anneau : fais /roll), une égalité à relancer, personne en MS puis jets OS, un jet libre.",
    { { "Ouvrir le corps", 140, function() T.OpenCorpse("softres") end } })
  L.Header("5. Butin au conseil")
  L.Add("Chacun répond (BiS, Upgrade...), Mirelle et Thorn chuchotent leur réponse, Gorrak et Nyssaël votent : à toi de départager.",
    { { "Ouvrir le corps", 140, function() T.OpenCorpse("council") end } })
  L.Header("6. Objets à remettre")
  L.Add("« Garder, à remettre » dans la fenêtre du butin, puis « Échanger » dans l'onglet En raid (échange simulé)." .. GREY .. "\nEn attente : " .. #RA.Handover() .. "|r",
    { { "Onglet En raid", 130, function() ns.UI.Show("enraid") end } })
  L.Header("Fin")
  L.Add(GREY .. #RA.test.log.loot .. " objet(s) attribué(s) pendant l'essai. Le vrai butin de maître et l'échange restent à vérifier dans un vrai raid.|r",
    { { "Recommencer", 120, function() RA.StopTest() RA.StartTest() end }, { "Quitter l'essai", 130, function() RA.StopTest() end } })
  L.Done()
end

return T
