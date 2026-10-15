-- Historique durable du butin (lot R4a, addon 0.4.0 ; étude « Roster autonome », §5.2, §5.4, §5.7) : tout ce que Roster
-- distribue est gardé dans RosterDB.hist, sans raid du site et sans limite de durée (survit au /reload et aux 12 h des
-- objets du chef de butin). Une entrée par objet attribué, gardé, ou gagné au butin de groupe par un joueur qui n'a pas
-- passé ; une soirée (présence, boss) par instance de raid où la distribution par Roster est active.
--
-- Modèle (prêt pour la synchro entre officiers, R4g) :
--   RosterDB.hist = { schema = 1, node = "k3f9q", seq = 1287, entries = { [id] = entrée }, nights = { [id] = soirée },
--                     opts = { alts = "person" } }
--   - node : 5 caractères base 36 tirés au premier lancement (cette installation, commune aux persos du compte) ;
--   - seq : horloge locale, +1 à chaque changement fait ici ou reçu, recopiée dans l'entrée ou la soirée changée
--     (synchro incrémentale : « ce qui a changé ici depuis ») ;
--   - entrée : id (<node du chef de butin>-<heure base 36>-<n>), v (version : heure du serveur), by (auteur de la
--     version), seq, at (heure de l'attribution), item (chaîne de l'objet sans couleurs), itemId, ilvl, name, slot,
--     winner, class, method, response, detail, votes, note, cat (bis | up | ms | other ; nil : ne compte pas), boss,
--     encounter, instance, mapID, difficulty, night, ml (chef de butin), src (« roster »), excluded, del (tombe) ;
--   - soirée : id (<node>-<début base 36>), start, stop, instance, mapID, difficulty, ml, v, by, seq,
--     bosses = { { encounter, name, at, kill } }, people = { ["Prénom-Royaume"] = { first, last, n } }.
--   La version la plus récente gagne (v, puis by, puis une somme du contenu) : une même entrée reçue deux fois ne change
--   rien, et une attribution refaite (nouveau gagnant) remplace l'ancienne partout.
-- Identifiants : le chef de butin crée l'entrée et l'envoie au raid avec son identifiant et sa version (LW, Loot.lua) :
-- chaque addon qui le reçoit crée la même entrée. Un LW d'un addon 0.3 (sans identifiant) prend « lw-<somme du chef de
-- butin et de la clé de l'objet> », le même chez tous, et le même que celui du chef de butin quand il passe en 0.4.
-- Butin des alts (choix de Flo, 15/10) : compté pour la personne. H.Person rattache un perso à sa personne ; R4c y
-- branchera les liens main / alts (pour l'instant, chaque perso est sa propre personne, et les persos d'une même entrée
-- N du site comptent ensemble). Option gardée dans opts.alts (« person » par défaut).
-- Nouvelle saison = effacement (choix de Flo, R4d) : tout l'historique est dans RosterDB.hist ; H.Backup en garde une
-- copie complète juste avant (RosterDB.histBackups, 3 au plus), H.Restore la remet.
-- Raid d'essai : H.test (en mémoire, même API), jamais écrit dans la sauvegarde ; effacé à la fin de l'essai.
-- WoW 12.x : aucune valeur secrète du jeu (noms, instance, rencontre) n'est gardée ni comparée.
local _, ns = ...
local L = ns.L
local H = {}
ns.Hist = H
local F, Cm = ns.Format, ns.Comm

local secret, usable = F.secret, F.usable
H.SCHEMA = 1
H.NIGHT_GAP = 4 * 3600   -- secondes sans relevé : au-delà, nouvelle soirée (comme RCLootLedger)
H.BOSS_WINDOW = 15 * 60  -- butin noté avec le dernier boss vaincu dans les 15 min
H.BACKUPS = 3
H.SAMPLE = 60            -- secondes entre deux relevés de la présence
H.test = nil             -- historique du raid d'essai
H.current = nil          -- soirée en cours (identifiant)
H.boss = nil             -- dernier boss vaincu { name, encounter, at }
H.GROUP_LOOT = "butin de groupe" -- nolocale (détail gardé : objet gagné au butin de groupe sans passer ; affiché : L[…])

local function db() return ns.db and ns.db() end
local function testing() local x = ns.Loot return x ~= nil and x.test ~= nil end
local function me() return Cm.Me() end
local function refresh() if ns.UI and ns.UI.Refresh then ns.UI.Refresh() end end
local function num(v) return type(v) == "number" and not secret(v) and v or nil end
local function opt(s) if s == nil or s == "" then return nil end return s end

-- Heure du serveur (commune à tous les joueurs du royaume), sinon celle de l'ordinateur
function H.Now()
  if GetServerTime then
    local ok, t = pcall(GetServerTime)
    if ok and num(t) then return t end
  end
  return time()
end

local DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"
local function base36(n)
  n = math.floor(math.max(0, tonumber(n) or 0))
  if n == 0 then return "0" end
  local out = ""
  while n > 0 do
    local r = n % 36
    out = DIGITS:sub(r + 1, r + 1) .. out
    n = math.floor(n / 36)
  end
  return out
end
H.base36 = base36
-- Somme djb2 d'un texte (modulo 2^32)
local function djb2(s)
  local h = 5381
  for i = 1, #s do h = (h * 33 + s:byte(i)) % 4294967296 end
  return h
end

-- Identifiant de cette installation : 5 caractères base 36 au hasard (mêlé à l'heure, sans toucher à la graine du jeu)
local function newNode()
  local t = H.Now() * 7 + math.floor(((GetTime and GetTime()) or 0) * 1000)
  local r = (math.random(0, 60466175) + t) % 60466176
  local s = base36(r)
  return string.rep("0", 5 - #s) .. s
end

--------------------------------------------------------------------------------------------------------------------
-- Sauvegarde : RosterDB.hist (raid d'essai : H.test)
--------------------------------------------------------------------------------------------------------------------
local function fresh(node) return { schema = H.SCHEMA, node = node, seq = 0, entries = {}, nights = {} } end
local early = nil -- avant ADDON_LOADED : historique sans sauvegarde (rien n'est distribué si tôt)
local function store()
  if testing() then
    H.test = H.test or fresh("essai") -- nolocale (identifiant)
    return H.test
  end
  local d = db()
  if not d then
    early = early or fresh("?")
    return early
  end
  local h = d.hist
  if type(h) ~= "table" then
    h = fresh(newNode())
    d.hist = h
  end
  if type(h.node) ~= "string" or h.node == "" then h.node = newNode() end
  h.seq = tonumber(h.seq) or 0
  if type(h.entries) ~= "table" then h.entries = {} end
  if type(h.nights) ~= "table" then h.nights = {} end
  h.schema = h.schema or H.SCHEMA
  return h
end
H.Store = store
local function bump(h, t)
  h.seq = h.seq + 1
  t.seq = h.seq
end

function H.Node() return store().node end
--- Nouvel identifiant d'entrée : <node>-<heure base 36>-<n>
function H.NewId(at)
  local h = store()
  return h.node .. "-" .. base36(at or H.Now()) .. "-" .. base36(h.seq + 1)
end
--- Identifiant d'une attribution annoncée sans identifiant (LW d'un addon 0.3, objet attribué avant la 0.4)
function H.LegacyId(master, key)
  return "lw-" .. base36(djb2((F.Key(master) or "?") .. ";" .. tostring(key or "")))
end

-- Option « butin des alts » : « person » (pour la personne, par défaut), « main » (main seulement), « char » (chaque perso)
function H.AltMode()
  local o = store().opts
  return type(o) == "table" and o.alts or "person"
end
--- Personne d'un perso (clé de comparaison) : le perso lui-même pour l'instant ; R4c : son main selon les liens
function H.Person(name) return F.Key(name) end
--- Main d'un perso s'il est l'alt de quelqu'un (R4c), sinon nil
function H.MainOf() return nil end

--------------------------------------------------------------------------------------------------------------------
-- Versions : la plus récente gagne
--------------------------------------------------------------------------------------------------------------------
local function serialize(v, out)
  if type(v) ~= "table" then
    out[#out + 1] = tostring(v)
    return
  end
  local keys = {}
  for k in pairs(v) do if k ~= "seq" then keys[#keys + 1] = { s = tostring(k), k = k } end end
  table.sort(keys, function(a, b) return a.s < b.s end)
  out[#out + 1] = "{"
  for _, x in ipairs(keys) do
    out[#out + 1] = x.s .. "="
    serialize(v[x.k], out)
    out[#out + 1] = ","
  end
  out[#out + 1] = "}"
end
--- Somme du contenu (sans seq, propre à chaque installation) : départage de deux versions de même heure et même auteur
function H.Sum(e)
  local out = {}
  serialize(e, out)
  return djb2(table.concat(out))
end
--- a est-elle plus récente que b ?
function H.Newer(a, b)
  if not b then return true end
  local va, vb = tonumber(a.v) or 0, tonumber(b.v) or 0
  if va ~= vb then return va > vb end
  local ba, bb = tostring(a.by or ""), tostring(b.by or "")
  if ba ~= bb then return ba > bb end
  return H.Sum(a) > H.Sum(b)
end

--- Ajoute ou remplace une entrée si elle est plus récente que celle gardée ; renvoie l'entrée gardée et si elle a changé
function H.Put(e)
  if type(e) ~= "table" or type(e.id) ~= "string" or e.id == "" then return nil, false end
  local h = store()
  local old = h.entries[e.id]
  if old and not H.Newer(e, old) then return old, false end
  bump(h, e)
  h.entries[e.id] = e
  return e, true
end
function H.Get(id) return id and store().entries[id] or nil end

--------------------------------------------------------------------------------------------------------------------
-- Ce qui compte (règle du site, lootSkipReason) : bis (conseil BiS), up (conseil Upgrade), ms (jet MS), other (donné
-- par le chef de butin, conseil sans réponse, butin de groupe sans passer : dans le total seulement) ; ne comptent pas :
-- Off-spec, Transmo, jet OS, jet libre, gardé, exclu par un officier, et ce qui n'est pas de l'équipement (composants…)
--------------------------------------------------------------------------------------------------------------------
function H.Category(l)
  local Lo = ns.Loot
  if type(l) ~= "table" or l.excluded or not Lo then return nil end
  local R = ns.Recorder
  if l.itemId and R and R.IsGear and R.IsGear(l.itemId) == false then return nil end
  local x = { method = l.method or "", response = l.response, detail = l.detail or "" }
  local cat = Lo.Category(x)
  if cat then return cat end
  return Lo.Counts(x) and "other" or nil
end

-- Compte par personne (pour chaque date de départ demandée), recalculé quand l'historique change (seq) :
-- { n, bis, up, ms, other, skipped }
local cache = { by = {} }
local function cacheFor(h)
  if cache.h ~= h or cache.seq ~= h.seq then cache.h, cache.seq, cache.by, cache.list = h, h.seq, {}, nil end
end
local function tallies(since)
  local h = store()
  cacheFor(h)
  local key = since or 0
  if cache.by[key] then return cache.by[key] end
  local by = {}
  for _, e in pairs(h.entries) do
    if not e.del and (not since or (tonumber(e.at) or 0) > since) then
      local k = H.Person(e.winner)
      if k then
        local t = by[k]
        if not t then t = { n = 0, bis = 0, up = 0, ms = 0, other = 0, skipped = 0 } by[k] = t end
        local cat = not e.excluded and e.cat
        if cat and t[cat] then t.n, t[cat] = t.n + 1, t[cat] + 1 else t.skipped = t.skipped + 1 end
      end
    end
  end
  cache.by[key] = by
  return by
end
--- Objets reçus par ces persos (ceux d'une même personne : comptés une fois), après « since » (heure, facultatif)
function H.Count(names, since)
  local by = tallies(since)
  local out, seen = { n = 0, bis = 0, up = 0, ms = 0, other = 0, skipped = 0 }, {}
  for _, name in ipairs(names or {}) do
    local k = H.Person(name)
    if k and not seen[k] then
      seen[k] = true
      local t = by[k]
      if t then for f, v in pairs(t) do out[f] = out[f] + v end end
    end
  end
  return out
end
--- L'historique a-t-il au moins une entrée ?
function H.HasData()
  for _, e in pairs(store().entries) do if not e.del then return true end end
  return false
end

--- Entrées (sans les tombes), la plus récente d'abord ; liste gardée tant que l'historique ne change pas (à ne pas modifier)
function H.Entries()
  local h = store()
  cacheFor(h)
  if cache.list then return cache.list end
  local out = {}
  for _, e in pairs(h.entries) do if not e.del then out[#out + 1] = e end end
  table.sort(out, function(a, b)
    local ta, tb = tonumber(a.at) or 0, tonumber(b.at) or 0
    if ta ~= tb then return ta > tb end
    return a.id > b.id
  end)
  cache.list = out
  return out
end

--------------------------------------------------------------------------------------------------------------------
-- Soirées : relevées dans une instance de raid, en groupe de raid, distribution par Roster active (sans le site)
--------------------------------------------------------------------------------------------------------------------
local DIFFICULTY = { [14] = "normal", [15] = "heroic", [16] = "mythic" }
-- Instance de raid où l'on est : { name, difficulty, mapID }, sinon nil
local function raidInstance()
  if not GetInstanceInfo then return nil end
  local ok, name, kind, diff, _, _, _, _, mapID = pcall(GetInstanceInfo)
  if not ok or secret(kind) or kind ~= "raid" then return nil end
  return { name = (usable(name) and name ~= "") and F.txt(name, 60) or nil, difficulty = (num(diff) and DIFFICULTY[diff]) or nil, mapID = num(mapID) }
end

function H.ShouldRecord()
  local Lo = ns.Loot
  if testing() or not (Lo and Lo.Enabled and Cm.InRaid()) then return false end
  return Lo.Enabled() and raidInstance() ~= nil
end

function H.Night(id) return id and store().nights[id] or nil end
function H.CurrentNight()
  if testing() then return nil end
  return H.Night(H.current)
end
--- Soirées, la plus récente d'abord
function H.Nights()
  local out = {}
  for _, n in pairs(store().nights) do out[#out + 1] = n end
  table.sort(out, function(a, b) return (tonumber(a.start) or 0) > (tonumber(b.start) or 0) end)
  return out
end
--- Soirée qui couvre ce moment : celle en cours, sinon la dernière commencée avant (1 h de marge) et pas finie depuis plus de 4 h
function H.NightAt(at)
  at = tonumber(at) or H.Now()
  local cur = H.CurrentNight()
  if cur and at >= (cur.start or 0) - 3600 then return cur end
  local best
  for _, n in pairs(store().nights) do
    local start, stop = tonumber(n.start) or 0, tonumber(n.stop or n.start) or 0
    if at >= start - 3600 and at <= stop + H.NIGHT_GAP and (not best or start > (tonumber(best.start) or 0)) then best = n end
  end
  return best
end

-- Soirée de ce moment (on y est) : la soirée en cours, reprise (même instance, moins de 4 h sans relevé) ou nouvelle
local function openNight(now)
  if not H.ShouldRecord() then return nil end
  local inst = raidInstance()
  local h = store()
  local function fits(n)
    return n and n.mapID == inst.mapID and n.difficulty == inst.difficulty and now - (tonumber(n.stop or n.start) or 0) <= H.NIGHT_GAP
  end
  local n = H.current and h.nights[H.current]
  if not fits(n) then
    n = nil
    for _, x in pairs(h.nights) do
      if fits(x) and (not n or (tonumber(x.start) or 0) > (tonumber(n.start) or 0)) then n = x end
    end
    local G = ns.Groups
    local diff = inst.difficulty and G and G.Difficulty and G.Difficulty(inst.difficulty)
    local where = (inst.name or L["instance de raid"]) .. (diff and (" (" .. diff .. ")") or "")
    if n then
      ns.print(L("soirée reprise : %s. Présence, boss et butin vont dans l'historique de Roster (onglet Butin).", where))
    else
      n = { id = h.node .. "-" .. base36(now), start = now, stop = now, instance = inst.name, mapID = inst.mapID, difficulty = inst.difficulty,
        bosses = {}, people = {}, v = now, by = me() }
      h.nights[n.id] = n
      bump(h, n)
      ns.print(L("soirée relevée : %s. Présence, boss et butin vont dans l'historique de Roster (onglet Butin), sans le site.", where))
    end
  end
  H.current = n.id
  if inst.name and n.instance ~= inst.name then n.instance = inst.name end
  return n
end

-- Relevé de la minute : qui est dans le groupe de raid
function H.Sample()
  if not db() or testing() then return end
  if not H.ShouldRecord() then
    if H.current then H.current = nil refresh() end
    return
  end
  local now = H.Now()
  local n = openNight(now)
  if not n then return end
  n.people = n.people or {}
  for _, m in ipairs((Cm.Roster())) do
    if usable(m.name) then
      local p = n.people[m.name]
      if not p then p = { first = now, last = now, n = 0 } n.people[m.name] = p end
      p.last, p.n = now, p.n + 1
    end
  end
  local master = ns.Loot and ns.Loot.Master and ns.Loot.Master()
  n.stop, n.v, n.by = now, now, me()
  if usable(master) then n.ml = master end
  bump(store(), n)
end

-- Fin de rencontre : boss de la soirée (vaincu ou non) ; le dernier boss vaincu est noté avec le butin des 15 min suivantes
function H.OnEncounterEnd(encounterID, name, _, _, success)
  if secret(encounterID) or secret(success) then return end
  local won = success == 1 or success == true
  local boss = usable(name) and F.txt(name, 60) or ""
  local id, now = tonumber(encounterID), H.Now()
  if won then H.boss = { name = boss, encounter = id, at = now } end
  if testing() then return end
  local n = openNight(now)
  if not n then return end
  n.bosses = n.bosses or {}
  n.bosses[#n.bosses + 1] = { encounter = id, name = boss, at = now, kill = won }
  n.stop, n.v, n.by = now, now, me()
  bump(store(), n)
  refresh()
end

-- Soirée du raid d'essai (en mémoire) : les joueurs fictifs
local function testNight(at)
  local h = store()
  local n = h.nights.essai
  if n then return n end
  n = { id = "essai", start = at, stop = at, test = true, bosses = {}, people = {}, v = at, by = me() } -- nolocale (identifiant)
  for _, m in ipairs(ns.Loot.Members() or {}) do n.people[m.name] = { first = at, last = at, n = 1 } end
  h.nights.essai = n
  bump(h, n)
  return n
end

--------------------------------------------------------------------------------------------------------------------
-- Entrées : attribution du chef de butin (Lo.Award, Lo.Keep), LW reçu, butin de groupe gagné sans passer
--------------------------------------------------------------------------------------------------------------------
local function classOf(name)
  local Lo = ns.Loot
  local m = Lo and Lo.Member and Lo.Member(name)
  if m and usable(m.class) then return m.class end
  if F.SameName(name, me()) and Lo and Lo.MyClass then return Lo.MyClass() end
  return nil
end
local function slotOf(id)
  local info = (C_Item and C_Item.GetItemInfoInstant) or GetItemInfoInstant
  if not (info and id) then return nil end
  local ok, _, _, _, loc = pcall(info, id)
  return (ok and usable(loc) and loc ~= "") and loc or nil
end

-- Entrée d'après ce qu'on sait de l'objet et du moment. x : itemId, item, name, ilvl, winner, method, response, detail,
-- note, ml, at ; context : instance, boss et soirée de ce moment (false : attribution d'avant, sans contexte)
local function build(x, context)
  local at = tonumber(x.at) or H.Now()
  local e = { at = at, itemId = x.itemId, item = x.item or (x.itemId and ("item:" .. x.itemId)), name = opt(x.name), ilvl = num(x.ilvl),
    slot = slotOf(x.itemId), winner = x.winner, class = classOf(x.winner), method = opt(x.method), response = opt(x.response),
    detail = opt(x.detail), note = opt(x.note), ml = x.ml, src = "roster" }
  if e.method == "council" then e.votes = tonumber(tostring(e.detail or ""):match("^(%d+)")) end
  if context ~= false then
    local n
    if testing() then n = testNight(at) else n = openNight(H.Now()) or H.NightAt(at) end
    local inst = not testing() and raidInstance() or nil
    e.night = n and n.id or nil
    e.instance = (n and n.instance) or (inst and inst.name) or nil
    e.mapID = (n and n.mapID) or (inst and inst.mapID) or nil
    e.difficulty = (n and n.difficulty) or (inst and inst.difficulty) or nil
    local b = H.boss
    if b and H.Now() - b.at < H.BOSS_WINDOW then e.boss, e.encounter = opt(b.name), b.encounter end
  else
    local n = H.NightAt(at)
    if n then e.night, e.instance, e.mapID, e.difficulty = n.id, n.instance, n.mapID, n.difficulty end
  end
  e.cat = H.Category(e)
  return e
end

--- Attribution du chef de butin (moi) : l'objet o de Loot.lua (o.histId : entrée d'une attribution précédente, remplacée
--- par une version plus récente). extra : { note } (note du gagnant au conseil). Renvoie l'entrée.
function H.Award(o, winner, method, response, detail, extra)
  if not (o and o.itemId and usable(winner)) then return nil end
  local old = H.Get(o.histId)
  local v = math.max(H.Now(), old and (tonumber(old.v) or 0) + 1 or 0)
  local e = build({ itemId = o.itemId, item = F.ItemString(o.link), name = o.name, ilvl = o.ilvl, winner = winner, method = method,
    response = response, detail = detail, note = extra and extra.note, ml = me(), at = v })
  e.id = old and old.id or H.NewId(v)
  e.v, e.by = v, me()
  local kept = H.Put(e)
  o.histId = kept and kept.id or o.histId
  refresh()
  return kept
end

--- Attribution annoncée par le chef de butin (LW) : la même entrée que chez lui. id et v absents (addon 0.3) :
--- identifiant tiré du chef de butin et de la clé de l'objet, version = maintenant (le dernier LW reçu gagne).
function H.FromLW(master, key, itemId, winner, method, response, detail, id, v, ilvl)
  itemId = tonumber(itemId)
  if not (itemId and usable(winner) and usable(master)) then return nil end
  v = tonumber(v)
  if not (id and v) then
    id = H.LegacyId(master, key)
    local old = H.Get(id)
    v = math.max(H.Now(), old and (tonumber(old.v) or 0) + 1 or 0)
  end
  -- Ce que le conseil a vu de l'objet (chaîne avec ses bonus, nom, note du gagnant) : conseil de ce chef de butin
  local Lo, c = ns.Loot, nil
  for _, x in pairs(Lo and Lo.councils or {}) do
    if x.itemId == itemId and F.SameName(x.master, master) and (not x.winner or F.SameName(x.winner, winner))
      and (not c or (x.at or 0) > (c.at or 0)) then c = x end
  end
  local cand = c and c.cands and c.cands[F.Key(winner) or ""]
  local e = build({ itemId = itemId, item = c and c.itemString, name = c and c.name, ilvl = tonumber(ilvl) or (c and c.ilvl), winner = winner,
    method = method, response = response, detail = detail, note = cand and not cand.whispered and cand.note or nil, ml = master, at = v })
  e.id, e.v, e.by = id, v, master
  local kept, changed = H.Put(e)
  if changed then refresh() end
  return kept
end

--- Objet gagné au butin de groupe par un joueur qui n'a pas passé (chef de butin) : noté, compte comme le site
--- (« objet seulement noté »), sans LW
function H.Noted(winner, link, itemId)
  itemId = tonumber(itemId)
  if not (itemId and usable(winner)) then return nil end
  local now = H.Now()
  local Lo = ns.Loot
  local e = build({ itemId = itemId, item = F.ItemString(link), name = F.ItemName(link), ilvl = Lo and Lo.ilvlOf and Lo.ilvlOf(link), winner = winner,
    detail = H.GROUP_LOOT, ml = me(), at = now })
  e.id, e.v, e.by = H.NewId(now), now, me()
  local kept = H.Put(e)
  refresh()
  return kept
end

-- Objets attribués par le chef de butin avant la 0.4 (encore dans ses objets des 12 dernières heures) : gardés dans
-- l'historique au premier lancement, avec l'identifiant que leur ont donné les addons 0.4 qui ont reçu le LW
function H.Migrate()
  local d = db()
  local items = d and type(d.loot) == "table" and type(d.loot.items) == "table" and d.loot.items or {}
  local done = 0
  for _, o in ipairs(items) do
    if o.winner and not o.histId and (o.status == "awarded" or o.status == "traded" or o.status == "kept") then
      local at = tonumber(o.awardedAt) or tonumber(o.at) or H.Now()
      local e = build({ itemId = o.itemId, item = F.ItemString(o.link), name = o.name, ilvl = o.ilvl, winner = o.winner, method = o.method,
        response = o.response, detail = o.detail, ml = me(), at = at }, false)
      e.id, e.v, e.by = H.LegacyId(me(), o.key), at, me()
      local kept = H.Put(e)
      if kept then o.histId, done = kept.id, done + 1 end
    end
  end
  return done
end

--------------------------------------------------------------------------------------------------------------------
-- Sauvegarde complète avant effacement (nouvelle saison, R4d), restauration
--------------------------------------------------------------------------------------------------------------------
local function copy(v)
  if type(v) ~= "table" then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = copy(x) end
  return out
end
--- Copie complète de l'historique gardée dans RosterDB.histBackups (la plus récente d'abord, 3 au plus) ; reason : texte
--- court (« nouvelle saison »). Renvoie la sauvegarde { at, by, reason, n, hist }.
function H.Backup(reason)
  local d = db()
  if not d or testing() then return nil end
  local h = store()
  local n = 0
  for _, e in pairs(h.entries) do if not e.del then n = n + 1 end end
  d.histBackups = type(d.histBackups) == "table" and d.histBackups or {}
  table.insert(d.histBackups, 1, { at = H.Now(), by = me(), reason = opt(reason), n = n, hist = copy(h) })
  while #d.histBackups > H.BACKUPS do table.remove(d.histBackups) end
  return d.histBackups[1]
end
function H.Backups()
  local d = db()
  return d and type(d.histBackups) == "table" and d.histBackups or {}
end
--- Remet la sauvegarde i (1 : la plus récente). Le node et l'horloge (seq) de l'installation sont gardés : l'horloge ne
--- recule jamais (synchro). R4d : rajeunir les versions pour que la restauration gagne sur les tombes déjà envoyées.
function H.Restore(i)
  local d = db()
  local b = H.Backups()[i or 1]
  if not (d and b and type(b.hist) == "table") or testing() then return false end
  local cur = store()
  local h = copy(b.hist)
  h.node, h.seq = cur.node, math.max(tonumber(cur.seq) or 0, tonumber(h.seq) or 0) + 1
  d.hist, H.current = h, nil
  refresh()
  return true
end

--------------------------------------------------------------------------------------------------------------------
-- Raid d'essai, événements
--------------------------------------------------------------------------------------------------------------------
function H.StopTest() H.test = nil end

local lastRoster = 0
local function sample() ns.safe(L["historique du butin"], H.Sample) end
ns.on("PLAYER_LOGIN", function()
  ns.safe(L["historique du butin"], H.Migrate)
  if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(H.SAMPLE, sample) end
end)
ns.on("PLAYER_ENTERING_WORLD", function() if C_Timer and C_Timer.After then C_Timer.After(3, sample) end end)
ns.on("GROUP_ROSTER_UPDATE", function()
  if time() - lastRoster < 10 then return end
  lastRoster = time()
  sample()
end)
ns.on("ENCOUNTER_END", function(...) ns.safe(L["historique du butin"], H.OnEncounterEnd, ...) end)

return H
