-- Partage des données du site entre joueurs (guilde et raid), vérifiées par la signature du site.
-- Commun aux deux addons (addon/shared, copié dans chaque zip) : ce fichier ne connaît ni Roster ni Forever Roster.
-- Un seul joueur colle « Copier pour le jeu » ; son addon annonce les groupes qu'il détient, et ceux qui ont une version
-- plus ancienne (ou rien) la demandent. Chaque bloc de groupe (RRG pour Roster, FRG pour Forever Roster) est signé par
-- le site (RSA-2048, PKCS#1 v1.5, SHA-256 : ns.Crypto.VerifyRSA, clés publiques dans ns.SITE_KEYS, SiteKey.lua).
-- Reçu, vérifié, plus récent que le mien et avec un de mes persos dans la ligne M : appliqué, de n'importe qui.
-- Tout le reste est ignoré. Un bloc sans signature (ancien site, pas de clé) n'est jamais partagé.
--
-- BRANCHEMENT (chaque addon, une fois, au chargement de ses fichiers ; rien n'est envoyé avant)
--   ns.Share.Setup{
--     kind    = "RRG" | "FRG",                      -- en-tête des blocs de groupe de l'addon
--     send    = function(msg, dist, target) end,     -- envoie un message d'addon (≤ 255 octets) avec le préfixe et la
--                                                    --   file de l'addon ; dist : "GUILD", "RAID" ou "WHISPER" (target)
--     blocks  = function() return { [groupe] = { at = n, text = texte } } end,
--                                                    --   groupes détenus : at = « généré le » du site (en-tête) ;
--                                                    --   text = le bloc tel que collé ou reçu (avec M et Z), nil s'il
--                                                    --   n'a pas de signature (seuls les blocs signés sont annoncés)
--     apply   = function(sharedText, sender, dist) return true end,
--                                                    --   remplace les données de ce groupe par le bloc reçu (vérifié) en
--                                                    --   gardant MES champs personnels (statut et perso par raid) ; garde
--                                                    --   sharedText comme texte signé du groupe (relayé ensuite) ; une
--                                                    --   erreur ou false : refusé
--     mine    = function(names) return bool end,     -- un de mes persos est-il dans cette liste (ligne M) ?
--     notify  = function(text, info) end,            -- message au joueur, déjà traduit, une fois par bloc appliqué ;
--                                                    --   info = { group, name, sender, at, dist }
--     -- facultatifs :
--     enabled = function() return bool end,          -- option « Partager les données du site… » : coupée, ni annonce
--                                                    --   (SHV) ni envoi de données (SHD) ; la réception continue
--     display = function(name) return text end,      -- nom d'un joueur dans le message (par défaut : tel quel)
--     stamp   = function(at) return text end,        -- date affichée (par défaut : « 12/10 21:04 »)
--   }
--   ns.Share.OnMessage(sender, msg, dist)  -- chaque message SHV, SHQ ou SHD reçu d'un AUTRE joueur (pas l'écho des
--                                          --   miens), avec son canal ("GUILD", "RAID", "WHISPER")
--   ns.Share.Announce(dist, later)         -- annonce mes blocs signés sur "GUILD" ou "RAID" ; à appeler : ~20-40 s
--                                          --   après la connexion (GUILD, si en guilde), juste après un collage ou des
--                                          --   données reçues (GUILD et RAID), à l'arrivée dans un raid et quand il
--                                          --   s'agrandit (RAID, later = true : un groupe déjà annoncé sur ce canal
--                                          --   il y a moins de 60 s, par moi ou un autre, est réannoncé à la fin de
--                                          --   ce délai). Renvoie le nombre de groupes annoncés.
--   Autres : ns.Share.Jitter(a, b) (délai au hasard), ns.Share.Parse / Canonical / Verify / Status (lecture d'un
--   bloc), ns.Share.Chunks (découpage), ns.Share.State / Reset (tests).
--
-- MESSAGES (préfixe et file de chaque addon : Roster « RosterRT », Forever Roster « FRoster » ; ≤ 255 octets)
--   SHV;<kind>;<groupe>;<at>;<octets>     « je détiens ce groupe, généré le <at> » (canal GUILD ou RAID ; un bloc
--                                         signé seulement ; pas réannoncé sur un canal où la même version, ou une plus
--                                         récente, l'a été depuis moins de 60 s). Celui qui entend une version plus
--                                         ancienne que la sienne répond par sa propre annonce (1 à 5 s au hasard,
--                                         sauf si quelqu'un l'a fait entre-temps).
--   SHQ;<groupe>;<at>;<canal>             chuchoté à celui qui annonce : « envoie, j'ai <at> (0 : rien) », canal de
--                                         l'annonce entendue (GUILD ou RAID ; sans ce champ : celui de ma dernière
--                                         annonce). Seulement si l'annonce est plus récente que mes données ; sans
--                                         données, une fois par groupe et par session (de nouveau si rien n'est
--                                         arrivé en 120 s ; jamais pour un groupe dont je ne suis pas dans M) ; pas
--                                         pour une version déjà en route ni pour une version signée que l'addon n'a
--                                         pas su appliquer ; pas pour une date à plus d'un jour dans le futur.
--   SHD;<groupe>;<at>;<i>;<n>;<morceau>   morceau i sur n du texte partagé (lignes canoniques, Z, END), diffusé une
--                                         fois sur le canal de l'annonce, 0,5 à 3 s au hasard après la demande ;
--                                         annulé si quelqu'un d'autre diffuse la même version (ou une plus récente)
--                                         sur ce canal ; une version au plus une fois par canal et par 60 s.
--   Réception : morceaux remis dans l'ordre (doublons ignorés ; 2 textes en cours par expéditeur), abandonnés 120 s
--   après le dernier reçu ; puis : plus récent que le mien, un de mes persos dans M, clé connue et signature valide sur
--   le texte canonique, sinon ignoré. Un refus n'est retenu que pour un texte à la signature valide : un texte forgé
--   ne fait pas ignorer la vraie version (même groupe, même date) arrivée ensuite.
--
-- TEXTE CANONIQUE (ce que le site signe ; docs/addon-format.md) : lignes du bloc, de l'en-tête à END, sans la ligne Z
-- ni END ; \r retirés, espaces et tabulations retirés au début et à la fin, lignes vides omises ; champs personnels
-- vidés (lignes R : champs 7 et 8 en RRG, 5 et 6 en FRG, le champ 1 étant « R » ; séparateurs gardés) ; lignes jointes
-- par \n, sans \n final. Le texte partagé = texte canonique, ligne Z, ligne END : rien d'autre n'arrive à apply.
local _, ns = ...
local Sh = ns.Share or {}
ns.Share = Sh

Sh.QUIET = 60        -- s : une version déjà annoncée ou diffusée sur un canal ne l'est plus pendant ce temps
Sh.TIMEOUT = 120     -- s sans nouveau morceau : texte incomplet abandonné ; demande sans réponse renouvelable
Sh.MAX_MSG = 255     -- octets au plus d'un message d'addon
Sh.MAX_LEN = 60000   -- octets au plus d'un texte partagé
Sh.MAX_PARTS = 400   -- morceaux au plus d'un texte partagé
Sh.MAX_BUFFERS = 16  -- textes en cours de réception au plus (2 par expéditeur)
Sh.FUTURE = 86400    -- s : une version datée de plus d'un jour dans le futur est ignorée

local CHANNELS = { GUILD = true, RAID = true }
-- Champs personnels vidés dans le texte canonique (lignes R ; champ 1 = « R »)
local PERSONAL = { RRG = { 7, 8 }, FRG = { 5, 6 } }

local cfg -- adaptateur de l'addon (Setup)

--------------------------------------------------------------------------------------------------------------------
-- Outils
--------------------------------------------------------------------------------------------------------------------
local function now() return (GetTime and GetTime()) or (time and time()) or os.time() end
local function wall() return (time and time()) or os.time() end -- heure Unix (dates du site)
local function after(sec, fn)
  if C_Timer and C_Timer.After then C_Timer.After(math.max(0, sec), fn) else fn() end
end

-- Hasard propre (générateur de Park-Miller) : n'use pas math.random, partagé avec le reste du jeu
local seed
local function lcg()
  if not seed then seed = math.floor((now() * 1000 + ((time and time()) or 0)) % 2147483646) + 1 end
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
end
Sh.random = lcg -- remplaçable par les tests (renvoie un nombre dans [0, 1[)
--- Délai au hasard entre a et b secondes
function Sh.Jitter(a, b) return a + (b - a) * Sh.random() end

local function trim(s) return (s:gsub("\r", ""):gsub("^[ \t]+", ""):gsub("[ \t]+$", "")) end
local function fields(line)
  local out = {}
  for f in (line .. ";"):gmatch("([^;]*);") do out[#out + 1] = f end
  return out
end

--------------------------------------------------------------------------------------------------------------------
-- Lecture d'un bloc : texte canonique, membres (M), signature (Z)
--------------------------------------------------------------------------------------------------------------------
--- Premier bloc <kind> du texte. Renvoie nil (pas de bloc complet) ou { kind, group, at, name, members (liste ou nil),
--- keyId, sig, canonical, endLine, shared (texte partagé : canonique, Z, END ; nil sans Z) }.
function Sh.Parse(text, kind)
  if type(text) ~= "string" or not PERSONAL[kind] then return nil end
  local personal = PERSONAL[kind]
  local lines, info, z = {}, nil, nil
  for raw in (text .. "\n"):gmatch("([^\n]*)\n") do
    local line = trim(raw)
    local head = line:match("^([^;]*)")
    if not info then
      if head == kind then
        local f = fields(line)
        if f[3] == nil or f[3] == "" then return nil end
        info = { kind = kind, version = f[2], group = f[3], at = tonumber(f[4]), name = f[5] or "" }
        if not info.at then return nil end
        lines[1] = line
      end
    elseif head == "END" then
      info.endLine = line
      break
    elseif head == kind then
      return nil -- en-tête suivant avant END : bloc incomplet
    elseif head == "Z" then
      if z then return nil end -- deux signatures
      z = line
    elseif line ~= "" then
      if head == "R" then
        local f = fields(line)
        for _, i in ipairs(personal) do if f[i] ~= nil then f[i] = "" end end
        line = table.concat(f, ";")
      elseif head == "M" then
        local names = {}
        for name in (line:sub(3)):gmatch("[^,]+") do
          name = trim(name)
          if name ~= "" then names[#names + 1] = name end
        end
        info.members = names
      end
      lines[#lines + 1] = line
    end
  end
  if not (info and info.endLine) then return nil end
  info.canonical = table.concat(lines, "\n")
  if z then
    local f = fields(z)
    info.keyId, info.sig = f[2], f[3]
    if info.keyId and info.keyId ~= "" and info.sig and info.sig ~= "" then
      info.zLine = z
      info.shared = info.canonical .. "\n" .. z .. "\n" .. info.endLine
    else
      info.keyId, info.sig = nil, nil
    end
  end
  return info
end

--- Texte canonique du premier bloc <kind> (ce que le site signe), ou nil
function Sh.Canonical(text, kind)
  local info = Sh.Parse(text, kind)
  return info and info.canonical or nil
end

-- Vérifications déjà faites : [signature \n texte canonique] = true / false (la clé lie la signature au texte)
local checked, checkedN = {}, 0
local function verify(info)
  if not (info and info.sig) then return false, "unsigned" end
  if not (ns.SITE_KEYS and ns.SITE_KEYS[info.keyId]) then return false, "key" end
  local C = ns.Crypto
  if not (C and C.VerifyRSA) then return false, "crypto" end
  local k = info.keyId .. ";" .. info.sig .. "\n" .. info.canonical
  local r = checked[k]
  if r == nil then
    local ok, res = pcall(C.VerifyRSA, info.keyId, info.canonical, info.sig)
    r = ok and res == true
    checkedN = checkedN + 1
    if checkedN > 64 then checked, checkedN = {}, 1 end
    checked[k] = r
  end
  if not r then return false, "signature" end
  return true
end

--- Le texte (premier bloc de l'addon) est-il signé par le site, avec une signature valide ? true, ou false et la
--- raison : "invalid" (pas de bloc complet), "unsigned" (pas de ligne Z), "key" (clé inconnue de l'addon),
--- "crypto" (vérification impossible), "signature" (signature fausse)
function Sh.Verify(text, kind)
  local info = Sh.Parse(text, kind or (cfg and cfg.kind))
  if not info then return false, "invalid" end
  return verify(info)
end

--- Comme Verify, sans le calcul RSA (pour l'affichage) : "ok" (signé, clé connue), "unsigned", "key" ou "invalid"
function Sh.Status(text, kind)
  local info = Sh.Parse(text, kind or (cfg and cfg.kind))
  if not info then return "invalid" end
  if not info.sig then return "unsigned" end
  if not (ns.SITE_KEYS and ns.SITE_KEYS[info.keyId]) then return "key" end
  return "ok"
end

--------------------------------------------------------------------------------------------------------------------
-- Découpage en messages ≤ 255 octets
--------------------------------------------------------------------------------------------------------------------
-- Morceaux de room octets au plus, sans couper un caractère UTF-8
local function pieces(text, room)
  local out, pos, len = {}, 1, #text
  while pos <= len do
    local stop = math.min(pos + room - 1, len)
    while stop < len and stop > pos do
      local b = text:byte(stop + 1)
      if b < 128 or b >= 192 then break end
      stop = stop - 1
    end
    out[#out + 1] = text:sub(pos, stop)
    pos = stop + 1
  end
  return out
end

--- Messages SHD d'un texte partagé (liste), ou nil s'il ne tient pas
function Sh.Chunks(group, at, text)
  local base = "SHD;" .. group .. ";" .. at .. ";"
  local n = 1
  for _ = 1, 4 do
    local room = Sh.MAX_MSG - #base - 2 * #tostring(n) - 2 -- « i;n; » avec i ≤ n
    if room < 32 then return nil end
    local list = pieces(text, room)
    if #list <= n then
      if #list > Sh.MAX_PARTS then return nil end
      local out = {}
      for i, p in ipairs(list) do out[i] = base .. i .. ";" .. #list .. ";" .. p end
      return out
    end
    n = #list
  end
  return nil
end

--------------------------------------------------------------------------------------------------------------------
-- État de la session
--------------------------------------------------------------------------------------------------------------------
local rx, heard, seen, pending, counter, lastDist, asked, askedEmpty, refused, outsider, retrying, parsed, parsedN
function Sh.Reset()
  rx = {}                             -- textes en cours : [expéditeur \1 groupe \1 at] = { parts, n, got, size, first, last, … }
  heard = { GUILD = {}, RAID = {} }   -- [groupe] = { at, t } : annonce (SHV) la plus récente entendue ou faite sur ce canal
  seen = { GUILD = {}, RAID = {} }    -- [groupe] = { at, t } : diffusion (SHD) la plus récente vue ou faite sur ce canal
  pending = { GUILD = {}, RAID = {} } -- [groupe] = { at, id } : ma diffusion programmée
  counter = { GUILD = {}, RAID = {} } -- [groupe] = t : ma dernière réponse à une annonce plus ancienne
  lastDist = {}                       -- [groupe] = canal de ma dernière annonce
  asked = {}                          -- [groupe] = { at, t } : ma dernière demande (SHQ)
  askedEmpty = {}                     -- [groupe] = { t, done } : demande faite sans données
  refused = {}                        -- [groupe] = { [at] = raison } : versions signées refusées par l'addon (apply)
  outsider = {}                       -- [groupe] = true : je ne suis pas dans sa ligne M (plus de demande sans données)
  retrying = {}                       -- [canal] = true : annonce refaite à la fin du délai
  parsed, parsedN = {}, 0             -- [texte détenu] = { info, why } : lecture et vérification de mes blocs
end
Sh.Reset()
--- État interne (tests)
function Sh.State()
  return { rx = rx, heard = heard, seen = seen, pending = pending, asked = asked, askedEmpty = askedEmpty, refused = refused, outsider = outsider }
end

function Sh.Setup(adapter)
  assert(type(adapter) == "table" and PERSONAL[adapter.kind], "Share.Setup : kind RRG ou FRG") -- nolocale
  cfg = adapter
end

local function enabled()
  if not cfg then return false end
  if not cfg.enabled then return true end
  local ok, on = pcall(cfg.enabled)
  return ok and on ~= false
end

local function held()
  local ok, b = pcall(cfg.blocks)
  return ok and type(b) == "table" and b or {}
end
local function myAt(group)
  local b = held()[group]
  return b and (tonumber(b.at) or 0) or nil
end

local function send(msg, dist, target)
  if #msg > Sh.MAX_MSG then return false end
  local ok, res = pcall(cfg.send, msg, dist, target)
  return ok and res ~= false
end

-- Mon bloc signé (et vérifié) d'un groupe : info de Parse, ou nil
local function mineSigned(group, b)
  b = b or held()[group]
  local text = b and b.text
  if type(text) ~= "string" then return nil end
  local c = parsed[text]
  if not c then
    local info = Sh.Parse(text, cfg.kind)
    local why
    if not info or info.group ~= group then why = "invalid"
    elseif not info.shared then why = "unsigned"
    else local ok, w = verify(info) if not ok then why = w end end
    c = { info = not why and info or nil, why = why }
    parsedN = parsedN + 1
    if parsedN > 32 then parsed, parsedN = {}, 1 end
    parsed[text] = c
  end
  return c.info
end

--------------------------------------------------------------------------------------------------------------------
-- Annonces (SHV)
--------------------------------------------------------------------------------------------------------------------
local function announce(group, info, dist)
  if not send(table.concat({ "SHV", cfg.kind, group, info.at, #info.shared }, ";"), dist) then return false end
  heard[dist][group] = { at = info.at, t = now() }
  lastDist[group] = dist
  return true
end

function Sh.Announce(dist, later)
  if not (enabled() and CHANNELS[dist]) then return 0 end
  local t, n, waitUntil = now(), 0, nil
  for group, b in pairs(held()) do
    local info = mineSigned(group, b)
    if info then
      local h = heard[dist][group]
      if h and h.at >= info.at and t - h.t < Sh.QUIET then
        waitUntil = math.max(waitUntil or 0, h.t + Sh.QUIET) -- annoncée il y a peu (par moi ou un autre)
      elseif announce(group, info, dist) then
        n = n + 1
      end
    end
  end
  -- Arrivée de nouveaux joueurs (raid qui s'agrandit) : l'annonce retenue est refaite à la fin du délai
  if later and waitUntil and not retrying[dist] then
    retrying[dist] = true
    after(waitUntil - t + Sh.Jitter(1, 5), function() retrying[dist] = nil Sh.Announce(dist) end)
  end
  return n
end

-- Quelqu'un annonce une version plus ancienne que la mienne : je lui réponds par mon annonce (une seule réponse sur le
-- canal : celle qui part la première fait taire les autres)
local function answerOlder(group, dist, t)
  if not enabled() then return end
  local last = counter[dist][group]
  if last and t - last < 30 then return end
  counter[dist][group] = t
  after(Sh.Jitter(1, 5), function()
    if not enabled() then return end
    local info = mineSigned(group)
    if not info then return end
    local h = heard[dist][group]
    if h and h.at >= info.at and h.t >= t then return end -- annoncée entre-temps
    announce(group, info, dist)
  end)
end

--------------------------------------------------------------------------------------------------------------------
-- Demandes (SHQ) et diffusion (SHD)
--------------------------------------------------------------------------------------------------------------------
local function request(sender, group, at, mine, dist)
  local t = now()
  if refused[group] and refused[group][at] then return end -- version déjà refusée
  for _, r in pairs(rx) do if r.group == group and r.at >= at then return end end -- déjà en route
  if mine then
    local a = asked[group]
    if a and a.at >= at and t - a.t < Sh.TIMEOUT then return end -- déjà demandée
  else
    if outsider[group] then return end -- pas membre de ce groupe
    local e = askedEmpty[group]
    if e and (e.done or t - e.t < Sh.TIMEOUT) then return end -- une fois par session (sauf demande restée sans réponse)
  end
  if send("SHQ;" .. group .. ";" .. (mine or 0) .. ";" .. dist, "WHISPER", sender) then
    asked[group] = { at = at, t = t }
    if not mine then askedEmpty[group] = { t = t } end
  end
end

local function broadcast(group, info, dist)
  local p = pending[dist][group]
  if p and p.at >= info.at then return end -- déjà programmée
  local s = seen[dist][group]
  if s and s.at >= info.at and now() - s.t < Sh.QUIET then return end -- diffusée il y a moins de 60 s
  local id = {}
  pending[dist][group] = { at = info.at, id = id }
  after(Sh.Jitter(0.5, 3), function()
    local q = pending[dist][group]
    if not (q and q.id == id) then return end -- annulée : quelqu'un d'autre diffuse
    pending[dist][group] = nil
    if not enabled() then return end
    local cur = mineSigned(group)
    if not cur or cur.at < info.at then return end
    local s2 = seen[dist][group]
    if s2 and s2.at >= cur.at and now() - s2.t < Sh.QUIET then return end
    local list = Sh.Chunks(group, cur.at, cur.shared)
    if not list then return end
    seen[dist][group] = { at = cur.at, t = now() }
    for _, msg in ipairs(list) do send(msg, dist) end
  end)
end

--------------------------------------------------------------------------------------------------------------------
-- Réception
--------------------------------------------------------------------------------------------------------------------
local function stamp(at)
  if cfg.stamp then
    local ok, s = pcall(cfg.stamp, at)
    if ok and type(s) == "string" then return s end
  end
  return ((date or os.date)("%d/%m %H:%M", at))
end
local function shown(name)
  if cfg.display then
    local ok, s = pcall(cfg.display, name)
    if ok and type(s) == "string" then return s end
  end
  return name
end

-- Texte complet reçu : vérifié, puis appliqué par l'addon. Renvoie true (appliqué) ou false et la raison.
-- Un refus n'est retenu (version plus jamais demandée ni lue) que pour un texte dont la signature est valide : un
-- texte forgé ne doit pas pouvoir faire ignorer la vraie version du même groupe et de la même date.
local function receive(r, text)
  local group, at, sender = r.group, r.at, r.sender
  local function result(why, keep)
    if keep then
      refused[group] = refused[group] or {}
      refused[group][at] = why
    end
    Sh.last = { group = group, at = at, sender = sender, result = why }
    return why == "applied", why
  end
  local info = Sh.Parse(text, cfg.kind)
  if not (info and info.shared) or info.group ~= group or info.at ~= at then return result("invalid") end
  local mine = myAt(group)
  if mine and at <= mine then return result("older") end
  if not info.members then return result("members") end
  local okM, member = pcall(cfg.mine, info.members)
  local e = askedEmpty[group]
  if not (okM and member) then
    -- Pas membre (même un texte forgé ne fait qu'arrêter mes demandes sans données ; la réception continue)
    outsider[group] = true
    if e then e.done = true end
    return result("member")
  end
  local ok, why = verify(info)
  if not ok then return result(why) end
  if e then e.done = true end
  local okA, res = pcall(cfg.apply, info.shared, sender, r.dist)
  if not okA or res == false then return result("apply", true) end
  result("applied")
  local name = (info.name:gsub("|", ""))
  local L = ns.L
  local msg = L and L("Données de %s reçues de %s (site : %s).", name, shown(sender), stamp(at))
  if msg and cfg.notify then pcall(cfg.notify, msg, { group = group, name = name, sender = sender, at = at, dist = r.dist }) end
  return true
end

local function sweep(t)
  for k, r in pairs(rx) do
    if t - r.last > Sh.TIMEOUT or t - r.first > 8 * Sh.TIMEOUT then rx[k] = nil end
  end
end

local function onAnnounce(sender, msg, dist)
  if not CHANNELS[dist] then return end
  local kind, group, at, len = msg:match("^SHV;([^;]*);([^;]+);(%d+);(%d+)")
  at, len = tonumber(at), tonumber(len)
  if kind ~= cfg.kind or not (at and len) or at > wall() + Sh.FUTURE then return end
  local t = now()
  local h = heard[dist][group]
  if not h or at >= h.at then heard[dist][group] = { at = at, t = t } end
  local mine = myAt(group)
  if mine and at < mine then
    if mineSigned(group) then answerOlder(group, dist, t) end
    return
  end
  if mine and at == mine then return end
  if len > Sh.MAX_LEN then return end
  request(sender, group, at, mine, dist)
end

local function onRequest(sender, msg, dist)
  if dist ~= "WHISPER" or not enabled() then return end
  local group, theirs, chan = msg:match("^SHQ;([^;]+);(%d+);?(%u*)")
  theirs = tonumber(theirs)
  if not theirs then return end
  local info = mineSigned(group)
  if not info or info.at <= theirs then return end
  chan = CHANNELS[chan] and chan or lastDist[group]
  if chan then broadcast(group, info, chan) end
end

local function onData(sender, msg, dist)
  if not CHANNELS[dist] then return end
  local group, at, i, n, payload = msg:match("^SHD;([^;]+);(%d+);(%d+);(%d+);(.*)$")
  at, i, n = tonumber(at), tonumber(i), tonumber(n)
  if not (at and i and n) or n < 1 or n > Sh.MAX_PARTS or i < 1 or i > n or at > wall() + Sh.FUTURE then return end
  local t = now()
  -- Quelqu'un diffuse cette version (ou une plus récente) sur ce canal : ma diffusion programmée est annulée
  local p = pending[dist][group]
  if p and at >= p.at then pending[dist][group] = nil end
  local s = seen[dist][group]
  if not s or at >= s.at then seen[dist][group] = { at = at, t = t } end
  local mine = myAt(group)
  if (mine and at <= mine) or (refused[group] and refused[group][at]) then return end
  local key = sender .. "\1" .. group .. "\1" .. at
  local r = rx[key]
  if not r then
    local count, from = 0, 0
    for _, x in pairs(rx) do
      count = count + 1
      if x.sender == sender then from = from + 1 end
    end
    if count >= Sh.MAX_BUFFERS or from >= 2 then return end
    r = { parts = {}, n = n, got = 0, size = 0, first = t, last = t, group = group, at = at, sender = sender, dist = dist }
    rx[key] = r
  end
  if r.n ~= n then rx[key] = nil return end
  if r.parts[i] then return end -- doublon
  r.parts[i], r.got, r.size, r.last = payload, r.got + 1, r.size + #payload, t
  if r.size > Sh.MAX_LEN then rx[key] = nil return end
  if r.got < r.n then return end
  rx[key] = nil
  receive(r, table.concat(r.parts, "", 1, r.n))
end

function Sh.OnMessage(sender, msg, dist)
  if not cfg or type(sender) ~= "string" or type(msg) ~= "string" then return end
  sweep(now())
  local code = msg:sub(1, 4)
  if code == "SHV;" then onAnnounce(sender, msg, dist)
  elseif code == "SHQ;" then onRequest(sender, msg, dist)
  elseif code == "SHD;" then onData(sender, msg, dist) end
end

return Sh
