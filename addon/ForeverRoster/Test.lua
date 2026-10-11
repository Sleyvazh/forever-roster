-- Raid d'essai (/fr test) : un raid fictif de 10 joueurs pour tout essayer seul, hors groupe. Les 9 autres joueurs sont
-- simulés (versions de l'addon, consommables, jets, réponses et votes du conseil) ; rien ne part au site, au chat du
-- raid ni aux autres joueurs. Le butin de maître et l'échange réels restent à vérifier dans un vrai raid.
local _, ns = ...
local L, N = ns.L, ns.N
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
local function after(sec, fn) C_Timer.After(sec, function() if RA.test then ns.safe(L["raid d'essai"], fn) end end) end
local function say(text) ns.print(GREY .. L("(essai) %s", text) .. "|r") end

-- Joueurs fictifs : rôle, type de DPS ; old = ancienne version de l'addon (sans conseil ni consommables), noAddon = sans addon
local PLAYERS = {
  { name = "Gorrak", role = "Tank" },
  { name = "Brakka", role = "Tank" },
  { name = "Nyssaël", role = "Heal" }, -- nolocale (nom de joueur)
  { name = "Grumdal", role = "Heal" },
  { name = "Mirelle", role = "Heal", noAddon = true },
  { name = "Vesper", role = "DPS", dps = "melee" },
  { name = "Sylvaë", role = "DPS", dps = "caster" }, -- nolocale (nom de joueur)
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
  ["Nyssaël"] = { [13457] = 5, [13444] = 12 }, Grumdal = { [13457] = 5, [13444] = 4 }, -- nolocale (noms de joueurs)
  Vesper = { [13457] = 3, [13452] = 5 }, ["Sylvaë"] = { [13457] = 5 }, Ilyra = { [13457] = 8 }, -- nolocale
}
-- Objets du corps : ceux que tu portes, connus du serveur de Forever (leurs infobulles s'affichent) ; à défaut,
-- des objets de Molten Core (nom anglais affiché si le serveur ne les connaît pas). Chaque objet a son scénario.
local SR_ROLES = { "ring", "tie", "nobody", "free" }   -- bonus SR+ (et ta réservation), égalité, personne en MS, jet libre
local COUNCIL_ROLES = { "set", "other" }               -- réponses et votes écrits pour le premier, au hasard pour l'autre
local FALLBACK = {
  ring = { id = 17063, name = "Band of Accuria" }, tie = { id = 18815, name = "Essence of the Pure Flame" },
  nobody = { id = 18814, name = "Choker of the Fire Lord" }, free = { id = 17076, name = "Bonereaver's Edge" },
  set = { id = 16901, name = "Stormrage Legguards" }, other = { id = 18817, name = "Crown of Destruction" },
}
-- Objets portés par les joueurs fictifs, montrés au conseil : les tiens aussi, sinon ceux-ci
local GEAR_FALLBACK = {
  { id = 16835, name = "Cenarion Leggings" }, { id = 16847, name = "Giantstalker's Leggings" }, { id = 16822, name = "Nightslayer Pants" },
  { id = 16915, name = "Netherwind Pants" }, { id = 16867, name = "Legplates of Might" },
}
local ITEM, ROLE, GEAR = {}, {}, GEAR_FALLBACK
local function pickItems()
  local worn, seen = {}, {}
  for slot = 1, 18 do
    local id = slot ~= 4 and GetInventoryItemID and GetInventoryItemID("player", slot) -- 4 : chemise
    if id and not seen[id] then
      seen[id] = true
      local name, _, quality = ns.ItemInfo(id)
      worn[#worn + 1] = { id = id, name = name or ns.Group.names[id] or L("objet %d", id), quality = quality }
    end
  end
  ITEM, ROLE = {}, {}
  for i, role in ipairs({ "ring", "tie", "nobody", "free", "set", "other" }) do
    local it = worn[i] or FALLBACK[role]
    ITEM[role], ROLE[it.id] = it, role
  end
  GEAR = #worn > 0 and worn or GEAR_FALLBACK
  return #worn
end
-- Objets reçus sur la saison (comme la ligne N des données du site) : colonne « Reçus » du conseil
local COUNTS = { Gorrak = 3, Brakka = 1, ["Nyssaël"] = 0, Grumdal = 2, Mirelle = 1, Vesper = 4, ["Sylvaë"] = 2, Ilyra = 1, Thorn = 0 } -- nolocale

-- Jets des joueurs fictifs : { nom, jet, dé lancé (s'il diffère du dé demandé : jet ignoré) }
local function rollsFor(item, kind, only)
  if only then -- relance entre ex æquo : des jets différents
    local out = {}
    for i, n in ipairs(only) do if n ~= me() then out[#out + 1] = { n, 20 + i * 27 } end end
    return out
  end
  local role = ROLE[item.itemId]
  if kind == "sr" and role == "ring" then return { { "Gorrak", 41 }, { "Vesper", 58 }, { "Sylvaë", 96 } } end -- nolocale (Sylvaë n'a rien réservé)
  if kind == "sr" and role == "tie" then return { { "Nyssaël", 67 }, { "Ilyra", 67 } } end -- nolocale
  if kind == "ms" and role == "nobody" then return {} end
  if kind == "os" and role == "nobody" then return { { "Sylvaë", 45 }, { "Ilyra", 81 }, { "Thorn", 72, 100 } } end -- nolocale
  if kind == "free" and role == "free" then return { { "Vesper", 23 }, { "Gorrak", 88 }, { "Brakka", 54, 99 } } end
  local out, pool = {}, {}
  if kind == "sr" then
    for n in pairs((RA.session and RA.session.eligible) or {}) do if n ~= me() then pool[#pool + 1] = n end end
  else
    pool = { "Vesper", "Gorrak", "Ilyra", "Grumdal", "Sylvaë" } -- nolocale
  end
  for i = 1, math.min(3, #pool) do out[i] = { table.remove(pool, math.random(#pool)), math.random(1, kind == "os" and 99 or 100) } end
  return out
end
function T.Rolls(item, kind, only)
  local s = RA.session
  for i, r in ipairs(rollsFor(item, kind, only)) do
    after(0.7 * i, function() if RA.session == s then RA.OnRoll(r[1], r[2], 1, r[3] or s.max) end end)
  end
  if not s.eligible or s.eligible[me()] ~= nil then say(L("fais /roll %d toi aussi : ton vrai jet compte.", s.max)) end
end
local startRoll = RA.StartRoll
RA.StartRoll = function(item, kind, only)
  local ok = startRoll(item, kind, only)
  if ok and RA.test then T.Rolls(item, kind, only) end
  return ok
end

-- Conseil : réponses (addon ou chuchotées), puis votes de Gorrak et Nyssaël ; précisions traduites à l'envoi
local RESPONSES = {
  set = { { "Mirelle", "bis", nil, true }, { "Nyssaël", "upgrade", N("2e pièce du set") }, { "Ilyra", "upgrade" }, { "Vesper", "transmo" }, { "Grumdal", "off" }, { "Gorrak", "pass" } }, -- nolocale
  default = { { "Sylvaë", "bis" }, { "Gorrak", "upgrade", N("petit gain") }, { "Thorn", "off", nil, true }, { "Brakka", "pass" } }, -- nolocale
}
local VOTES = { set = { { "Gorrak", "Mirelle" }, { "Nyssaël", "Ilyra" } }, default = { { "Gorrak", "Sylvaë" }, { "Nyssaël", "Gorrak" } } } -- nolocale
function T.Council(sid, id)
  local list = RESPONSES[ROLE[id]] or RESPONSES.default
  for i, r in ipairs(list) do
    after(0.8 + i * 0.6, function()
      -- Sans addon (ou ancienne version) : réponse chuchotée au maître du butin, sans objets portés
      local gear = r[4] and "" or tostring(GEAR[i % #GEAR + 1].id)
      RA.Deliver(r[1], "LA;" .. sid .. ";" .. r[2] .. ";" .. gear .. ";" .. (r[4] and "chuchoté" or (r[3] and L[r[3]] or "")), "WHISPER") -- nolocale (marque interne)
    end)
  end
  for i, v in ipairs(VOTES[ROLE[id]] or VOTES.default) do
    after(1.2 + #list * 0.6 + i * 0.8, function() RA.Deliver(v[1], "LV;" .. sid .. ";" .. v[2], "WHISPER") end)
  end
  after(0.5, function() say(L["réponds dans la fenêtre « ta réponse », puis vote : Gorrak et Nyssaël votent aussi, à toi de départager et de donner."]) end)
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
  say(L("objet donné à %s par le butin de maître (simulé).", winner))
end
function T.trade(entry)
  say(L("échange avec %s...", entry.winner))
  after(1.5, function()
    local list = RA.test.handover
    for i = #list, 1, -1 do if list[i] == entry then table.remove(list, i) end end
    local log = RA.test.log.loot
    log[#log + 1] = { who = entry.winner, itemId = entry.itemId, method = entry.method, detail = entry.detail, response = entry.response }
    ns.print(L("%s remis à %s (essai).", entry.link or ns.Group.displayLink(entry.itemId, entry.name, entry.quality), entry.winner))
    refresh()
  end)
  return true
end

local function reset()
  RA.items, RA.session, RA.councils, RA.asks, RA.call, RA.versions, RA.askedAt = {}, nil, {}, {}, nil, {}, nil
end
function RA.StartTest()
  if IsInGroup and IsInGroup() then ns.print(L["le raid d'essai se lance hors groupe : quitte le groupe d'abord."]) return false end
  reset()
  local worn = pickItems()
  local m = me()
  local members, roster = { m }, { [m] = { role = "DPS", dps = "melee" } }
  for _, p in ipairs(PLAYERS) do members[#members + 1] = p.name roster[p.name] = { role = p.role, dps = p.dps } end
  -- Textes du raid d'essai (d'ordinaire écrits sur le site) : dans la langue de l'interface au lancement
  local counts = { short = L["saison"], label = L["depuis le début de la saison (essai)"], byName = {} }
  for name, n in pairs(COUNTS) do counts.byName[name] = { names = { name }, n = n } end
  counts.byName[m] = { names = { m }, n = 2 }
  local raggy = { name = "Ragnaros", encounterId = 672, npcIds = { 11502 }, rows = {
    { label = L["Tank principal"], names = { "Gorrak" }, text = "" },
    { label = L["Fils de la flamme"], names = { "Brakka", m }, text = "" },
    { label = L["Soins des tanks"], names = { "Nyssaël", "Mirelle" }, text = "" }, -- nolocale
    { label = L["Placement"], names = {}, text = L["distance et soigneurs à 30 m derrière le boss"] },
  } }
  local domo = { name = "Majordomo Executus", encounterId = 671, npcIds = { 12018 }, rows = {
    { label = "Tanks", names = { "Gorrak", "Brakka" }, text = "" },
    { label = L["Moutons"], names = { "Sylvaë", "Ilyra" }, text = "" }, -- nolocale
    { label = L["Interruptions"], names = { m }, text = L["les soigneurs d'abord"] },
  } }
  RA.test = {
    members = members, handover = {}, log = { loot = {} }, sheet = raggy,
    send = T.send, award = T.award, trade = T.trade,
    data = {
      entry = { raid = { id = "essai", name = L["Raid d'essai"] .. " · Molten Core", time = time(), loot = "softres" }, group = { name = L["Groupe d'essai"] } },
      loot = "softres", consumables = CONSUMABLES, bosses = { raggy, domo }, council = { m, "Gorrak", "Nyssaël" }, roster = roster, -- nolocale
      counts = counts,
      reserves = {
        [ITEM.ring.id] = { { name = m, bonus = 0 }, { name = "Gorrak", bonus = 20 }, { name = "Vesper", bonus = 10 } },
        [ITEM.tie.id] = { { name = "Nyssaël", bonus = 10 }, { name = "Ilyra", bonus = 10 } }, -- nolocale
      },
    },
  }
  -- Objets demandés au jeu dès maintenant : leurs liens seront prêts à l'ouverture du corps
  for _, it in pairs(ITEM) do ns.Group.names[it.id] = ns.Group.names[it.id] or it.name ns.RequestItem(it.id) end
  for _, it in ipairs(GEAR) do ns.Group.names[it.id] = ns.Group.names[it.id] or it.name ns.RequestItem(it.id) end
  ns.print(L["raid d'essai lancé : 9 joueurs fictifs. Rien ne part au site, au chat du raid ni aux autres joueurs."])
  if worn < 6 then say(L["le corps d'essai montre les objets que tu portes ; il en manque, il est complété par des objets de Molten Core (infobulle absente si le serveur ne les connaît pas)."]) end
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
  ns.print(L["raid d'essai terminé."])
  refresh()
end
ns.on("GROUP_ROSTER_UPDATE", function()
  if RA.test and IsInGroup and IsInGroup() then ns.print(L["tu es entré dans un groupe : raid d'essai arrêté."]) RA.StopTest() end
end)

-- Corps ouvert (simulé) : les objets d'un mode de butin
function T.OpenCorpse(mode)
  local d = RA.test.data
  d.loot, d.entry.raid.loot = mode, mode
  RA.items, RA.session = {}, nil
  -- Pas de lien gardé : le nom du jeu (dans sa langue) s'affiche dès qu'il est connu, l'anglais en attendant
  for _, role in ipairs(mode == "council" and COUNCIL_ROLES or SR_ROLES) do
    local it = ITEM[role]
    RA.items[#RA.items + 1] = { itemId = it.id, name = it.name, quality = it.quality or 4, test = true }
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
  if not T.panel then T.panel = RA.listWindow("ForeverRosterTest", L["Raid d'essai"], 540) end
  T.panel:SetWindowTitle(L["Raid d'essai"])
  K.front(T.panel)
  T.panel:Show()
  T.Refresh()
end
function T.Refresh()
  local p = T.panel
  if not p or not p:IsShown() or not RA.test then return end
  local li = p.list
  p.hintText:SetText(ORANGE .. L["Toi et 9 joueurs fictifs. Rien ne part au site, au chat du raid ni aux autres joueurs."] .. "|r")
  li.Reset()
  li.Header(L["1. Qui a l'addon"])
  li.Add(L["Thorn a une ancienne version, Mirelle n'a pas l'addon."] .. GREY .. "\n" .. L["Résultat dans l'onglet En raid (Mirelle passe en « pas d'addon » au bout de 5 s)."] .. "|r",
    { { L["Demander les versions"], 180, function() RA.AskVersions(true) ns.UI.Show("enraid") end } })
  li.Header(L["2. Consommables"])
  li.Add(L["Chacun répond avec ses sacs ; tes vraies potions comptent."] .. GREY .. "\n" .. L["Prêts, manques et sans réponse dans l'onglet En raid."] .. "|r",
    { { L["Appel aux consommables"], 200, function() RA.CallConsumables() ns.UI.Show("enraid") end } })
  li.Header(L["3. Fiche du boss"])
  li.Add(L["Hors combat, cible n'importe quel PNJ : la fiche de Ragnaros s'ouvre, comme en ciblant le boss. Attaque-le : elle se ferme."] .. GREY .. "\n" .. L["Tu as une tâche sur Ragnaros (Fils de la flamme)."] .. "|r",
    { { L["Afficher la fiche"], 140, function() T.ShowBoss() end }, { L["Début du combat"], 140, function() RA.HideSheet() end } })
  li.Header(L["4. Butin en soft reserve"])
  li.Add(L["Les objets du corps sont ceux que tu portes. Jets SR avec bonus SR+ (tu as réservé le premier : fais /roll), une égalité à relancer, personne en MS puis jets OS, un jet libre."],
    { { L["Ouvrir le corps"], 140, function() T.OpenCorpse("softres") end } })
  li.Header(L["5. Butin au conseil"])
  li.Add(L["Chacun répond (BiS, Upgrade...), Mirelle et Thorn chuchotent leur réponse, Gorrak et Nyssaël votent : à toi de départager."],
    { { L["Ouvrir le corps"], 140, function() T.OpenCorpse("council") end } })
  li.Header(L["6. Objets à remettre"])
  li.Add(L["« Garder, à remettre » dans la fenêtre du butin, puis « Échanger » dans l'onglet En raid (échange simulé)."] .. GREY .. "\n" .. L("En attente : %d", #RA.Handover()) .. "|r",
    { { L["Onglet En raid"], 130, function() ns.UI.Show("enraid") end } })
  li.Header(L["Fin"])
  li.Add(GREY .. L("%d objet(s) attribué(s) pendant l'essai. Le vrai butin de maître et l'échange restent à vérifier dans un vrai raid.", #RA.test.log.loot) .. "|r",
    { { L["Recommencer"], 120, function() RA.StopTest() RA.StartTest() end }, { L["Quitter l'essai"], 130, function() RA.StopTest() end } })
  li.Done()
end

return T
