-- Tests hors jeu de la cryptographie commune (addon/shared/Crypto.lua) : lua5.1 addon/tests/crypto_test.lua
-- (depuis la racine du dépôt). Tout passe deux fois : sans bibliothèque bit (calcul arithmétique, celui de lua5.1) et
-- avec une bibliothèque bit simulée comme celle du jeu (résultats signés sur 32 bits) ; une troisième fois avec la
-- vraie bibliothèque C si elle est installée (paquet lua-bitop). Tous les chemins doivent donner les mêmes résultats.
-- Vecteurs : addon/tests/fixtures/crypto_vectors.lua, écrit par node addon/tests/fixtures/make-crypto-vectors.mjs.
local failures = 0
local function check(cond, msg) if not cond then failures = failures + 1 print("ÉCHEC : " .. msg) end end

local V = assert(loadfile("addon/tests/fixtures/crypto_vectors.lua"))()

--------------------------------------------------------------------------------------------------------------------
-- Bibliothèque bit simulée : comme celle du jeu, opérations sur 32 bits dont le résultat peut être négatif (au-delà
-- de 2^31). Plus stricte que le jeu : Crypto.lua doit lui passer des entiers de 0 à 2^32 - 1 (résultats ramenés par
-- % 2^32), et deux arguments exactement (rien ne doit dépendre d'une version à arguments multiples). Calcul octet par
-- octet avec des tables de 65 536 entrées.
--------------------------------------------------------------------------------------------------------------------
local fakeCalls = 0
local function u32(x)
  if type(x) ~= "number" or x % 1 ~= 0 or x < 0 or x >= 2 ^ 32 then error("bit simulé : entrée hors de 0..2^32-1 : " .. tostring(x), 3) end
  return x
end
local function signed(x) if x >= 2147483648 then return x - 4294967296 end return x end
local function byteOp(f)
  local T = {}
  for x = 0, 255 do
    for y = 0, 255 do
      local r, p, a, b = 0, 1, x, y
      for _ = 1, 8 do
        r = r + f(a % 2, b % 2) * p
        a, b, p = (a - a % 2) / 2, (b - b % 2) / 2, p * 2
      end
      T[x * 256 + y] = r
    end
  end
  return function(a, b, extra)
    if extra ~= nil or b == nil then error("bit simulé : deux arguments", 2) end
    a, b = u32(a), u32(b)
    fakeCalls = fakeCalls + 1
    local x, y = a % 256, b % 256
    local r = T[x * 256 + y]
    a, b = (a - x) / 256, (b - y) / 256
    x, y = a % 256, b % 256
    r = r + T[x * 256 + y] * 256
    a, b = (a - x) / 256, (b - y) / 256
    x, y = a % 256, b % 256
    r = r + T[x * 256 + y] * 65536
    a, b = (a - x) / 256, (b - y) / 256
    return signed(r + T[a * 256 + b] * 16777216)
  end
end
local FAKE_BIT = {
  band = byteOp(function(x, y) return x * y end),
  bor = byteOp(function(x, y) return (x + y > 0) and 1 or 0 end),
  bxor = byteOp(function(x, y) return (x + y) % 2 end),
  bnot = function(a) fakeCalls = fakeCalls + 1 return signed(2 ^ 32 - 1 - u32(a)) end,
  lshift = function(a, n) fakeCalls = fakeCalls + 1 return signed(u32(a) * 2 ^ n % 2 ^ 32) end,
  rshift = function(a, n) fakeCalls = fakeCalls + 1 local x = u32(a) return signed((x - x % 2 ^ n) / 2 ^ n) end,
}
-- La simulation elle-même
check(FAKE_BIT.bxor(0xffffffff, 0) == -1 and FAKE_BIT.bxor(0xffffffff, 0xffffffff) == 0, "bit simulé : bxor signé")
check(FAKE_BIT.band(0xffffffff, 0x80000000) == -2 ^ 31 and FAKE_BIT.band(0x12345678, 0xff00ff00) == 0x12005600, "bit simulé : band")
check(FAKE_BIT.bor(0x0f0f0f0f, 0xf0f0f0f0) == -1 and FAKE_BIT.bnot(0) == -1 and FAKE_BIT.bnot(0xffffffff) == 0, "bit simulé : bor, bnot")
check(FAKE_BIT.lshift(1, 31) == -2 ^ 31 and FAKE_BIT.rshift(0xffffffff, 28) == 15, "bit simulé : décalages")
check(FAKE_BIT.bxor(0x89abcdef, 0x12345678) == signed(0x9b9f9b97), "bit simulé : bxor")
check(not pcall(FAKE_BIT.bxor, 1, 2, 3) and not pcall(FAKE_BIT.bxor, 1) and not pcall(FAKE_BIT.bxor, 0.5, 1)
  and not pcall(FAKE_BIT.bxor, 2 ^ 32, 1) and not pcall(FAKE_BIT.bxor, -1, 1), "bit simulé : entrées refusées")

-- Vraie bibliothèque C (LuaBitOp, résultats signés), si elle est installée : jamais en CI, utile en local
local realBit
do
  local had = rawget(_G, "bit")
  local ok, lib = pcall(require, "bit")
  if ok and type(lib) == "table" and lib.bxor then realBit = lib end
  rawset(_G, "bit", had) -- require le déclare aussi en variable globale
end

--------------------------------------------------------------------------------------------------------------------
-- Chargement : aucune variable globale créée, aucune lue à part bit
--------------------------------------------------------------------------------------------------------------------
local strict = {
  __newindex = function(_, k) error("variable globale créée : " .. tostring(k), 2) end,
  __index = function(_, k) if k ~= "bit" then error("variable globale inconnue : " .. tostring(k), 2) end end,
}
local function loadCrypto(bitlib)
  local ns = {}
  rawset(_G, "bit", bitlib)
  local chunk = assert(loadfile("addon/shared/Crypto.lua"))
  setmetatable(_G, strict)
  -- Instructions exécutées au chargement, par milliers : quelques tables de constantes, aucun calcul
  local thousands = 0
  debug.sethook(function() thousands = thousands + 1 end, "", 1000)
  chunk("ForeverRoster", ns)
  debug.sethook()
  setmetatable(_G, nil)
  rawset(_G, "bit", nil)
  local fields = 0
  for _ in pairs(ns) do fields = fields + 1 end
  check(fields == 1 and type(ns.Crypto) == "table", "chargement : seulement ns.Crypto")
  check(thousands < 2, "chargement : rien de calculé (" .. thousands .. " milliers d'instructions)")
  assert(loadfile("addon/tests/fixtures/SiteKeyTest.lua"))("ForeverRoster", ns)
  return ns
end

-- Utilitaires du test
local function fromHex(h) return (h:gsub("%x%x", function(x) return string.char(tonumber(x, 16)) end)) end
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64encode(s)
  local out = {}
  for i = 1, #s, 3 do
    local a, b, c = s:byte(i, i + 2)
    local v = a * 65536 + (b or 0) * 256 + (c or 0)
    local d = {}
    for j = 4, 1, -1 do d[j] = v % 64 + 1 v = (v - v % 64) / 64 end
    out[#out + 1] = B64:sub(d[1], d[1]) .. B64:sub(d[2], d[2]) .. (b and B64:sub(d[3], d[3]) or "=") .. (c and B64:sub(d[4], d[4]) or "=")
  end
  return table.concat(out)
end
-- Message de 30 Ko, fait comme dans make-crypto-vectors.mjs
local function longMessage()
  local lines = {}
  for i = 1, V.long.count do lines[i] = string.format("R;%d;Raid %d;heroic;25;;;council", i, (i * 7919) % 1000) end
  return table.concat(lines, "\n")
end
local LONG = longMessage()
check(#LONG == V.long.len and #LONG >= 30 * 1024, "message long : même longueur que Node, au moins 30 Ko")
local function changeByte(s, i) return s:sub(1, i - 1) .. string.char((s:byte(i) + 1) % 256) .. s:sub(i + 1) end
-- Positions modifiées : les 8 premières, les 8 dernières et une sur « step » entre les deux ; sans step, la première,
-- celle du milieu et la dernière (chaque vérification RSA coûte une exponentiation : toutes les positions de toutes
-- les signatures rendraient le test long)
local function positions(len, step)
  if not step then return { 1, math.floor(len / 2), len } end
  local out = {}
  for i = 1, len do
    if i <= 8 or i > len - 8 or i % step == 0 then out[#out + 1] = i end
  end
  return out
end

local results = {} -- résultats de chaque chemin (empreintes, vérifications), comparés à la fin

-- full : tous les tests (chemin arithmétique) ; sinon, ceux qui touchent à SHA-256 et un échantillon du reste
-- (RSA ne dépend pas de la bibliothèque bit)
local function run(label, bitlib, full)
  local function fail(msg) return "[" .. label .. "] " .. msg end
  local ns = loadCrypto(bitlib)
  local C = ns.Crypto
  fakeCalls = 0
  local out = {}
  results[#results + 1] = { label = label, out = out }

  -- SHA-256 : vecteurs du NIST (FIPS 180-4), puis ceux de Node (longueurs autour des blocs de 64 octets, texte
  -- français en UTF-8, les 256 octets)
  local nist = {
    { "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    { "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
    { "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1" },
    { "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1" },
  }
  for _, v in ipairs(nist) do check(C.hex(C.sha256(v[1])) == v[2], fail("SHA-256 NIST : " .. v[1]:sub(1, 20))) end
  for i, v in ipairs(V.sha) do
    local h = C.hex(C.sha256(v.msg))
    out["sha " .. i] = h
    check(h == v.hex, fail("SHA-256 de " .. #v.msg .. " octets"))
  end
  check(#C.sha256("abc") == 32, fail("SHA-256 : 32 octets"))
  check(not pcall(C.sha256, nil) and not pcall(C.sha256, {}), fail("SHA-256 : chaîne attendue"))
  local t0 = os.clock()
  local longHash = C.hex(C.sha256(LONG))
  local shaTime = os.clock() - t0
  out["sha long"] = longHash
  check(longHash == V.long.hex, fail("SHA-256 du message de " .. #LONG .. " octets"))
  if full then
    t0 = os.clock()
    check(C.hex(C.sha256(string.rep("a", 1000000))) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", fail("SHA-256 : un million de « a »"))
    print(string.format("  [%s] SHA-256 d'un million de « a » : %.0f ms", label, (os.clock() - t0) * 1000))
  end
  -- Identifiant de la clé de test : 8 premiers caractères hexadécimaux du SHA-256 du module
  check(C.hex(C.sha256(fromHex(ns.SITE_KEYS.a3de5db8.n))):sub(1, 8) == "a3de5db8", fail("identifiant de la clé de test"))

  -- hex
  check(C.hex("") == "" and C.hex("\0\1\127\128\255") == "00017f80ff" and C.hex("AZ") == "415a", fail("hex"))

  -- base64 : RFC 4648, vecteurs de Node, textes refusés
  local rfc = { [""] = "", ["Zg=="] = "f", ["Zm8="] = "fo", Zm9v = "foo", ["Zm9vYg=="] = "foob", ["Zm9vYmE="] = "fooba", Zm9vYmFy = "foobar" }
  for text, plain in pairs(rfc) do check(C.b64decode(text) == plain, fail("base64 : " .. text)) end
  for _, v in ipairs(V.b64) do
    check(C.b64decode(v.text) == v.msg, fail("base64 de Node : " .. #v.msg .. " octets"))
    check(b64encode(v.msg) == v.text, "encodeur base64 du test : " .. #v.msg .. " octets")
  end
  for _, bad in ipairs({ "Zg", "Zg=", "Zm9vY", "Z===", "====", "Zm9v====", "Zg==Zg==", "Zm=v", "Zm9v=", "=m9v", "Zh==", "Zm9=",
    "Zm9v\n", " Zm9v", "Zm9v ", "Zm9-", "Zm9_", "Zm\0v", "Zm9\128", "Zg==\n" }) do
    check(C.b64decode(bad) == nil, fail("base64 refusé : " .. bad:gsub("%c", "?")))
  end
  check(C.b64decode(nil) == nil and C.b64decode(42) == nil and C.b64decode({}) == nil, fail("base64 : pas une chaîne"))

  -- RSA : vecteurs de Node (signatures du site, fausses, aux limites, autres tailles de clé)
  for id, k in pairs(V.keys) do
    if id ~= "a3de5db8" then ns.SITE_KEYS[id] = { n = k.n, e = k.e }
    else check(ns.SITE_KEYS[id].n == k.n and ns.SITE_KEYS[id].e == k.e, fail("clé de test : même module que le .pem")) end
  end
  for _, v in ipairs(V.rsa) do
    if full or not v.long then
      local ok, reason = C.VerifyRSA(v.key, v.long and LONG or v.msg, v.sig)
      out["rsa " .. v.note] = tostring(ok) .. " " .. tostring(reason)
      check(ok == v.ok and (v.reason == nil or reason == v.reason), fail("RSA, " .. v.note .. " : " .. tostring(ok) .. " " .. tostring(reason)))
      if not v.ok then check(ok == false and type(reason) == "string", fail("RSA, refus avec raison : " .. v.note)) end
    end
  end

  -- Toute modification d'un octet du message ou de la signature : refusée
  local abc, french, long = V.rsa[2], V.rsa[3], V.rsa[5]
  assert(abc.msg == "abc" and abc.ok and french.ok and long.long and long.ok, "vecteurs RSA dans l'ordre attendu")
  local sig = C.b64decode(abc.sig)
  check(sig and #sig == 256 and b64encode(sig) == abc.sig, fail("signature décodée"))
  for _, i in ipairs(positions(#sig, full and 16)) do
    local ok = C.VerifyRSA("a3de5db8", "abc", b64encode(changeByte(sig, i)))
    if ok ~= false then check(false, fail("signature modifiée à l'octet " .. i .. " acceptée")) end
  end
  for i = 1, 3 do check(C.VerifyRSA("a3de5db8", changeByte("abc", i), abc.sig) == false, fail("message modifié à l'octet " .. i)) end
  check(C.VerifyRSA("a3de5db8", "abc ", abc.sig) == false and C.VerifyRSA("a3de5db8", "ab", abc.sig) == false
    and C.VerifyRSA("a3de5db8", "", abc.sig) == false, fail("message allongé ou raccourci"))
  for _, i in ipairs(positions(#french.msg, full and 8)) do
    check(C.VerifyRSA("a3de5db8", changeByte(french.msg, i), french.sig) == false, fail("message français modifié à l'octet " .. i))
  end
  if full then
    for _, i in ipairs({ 1, 64, 65, 15000, #LONG }) do
      check(C.VerifyRSA("a3de5db8", changeByte(LONG, i), long.sig) == false, fail("message de 30 Ko modifié à l'octet " .. i))
    end
    check(C.VerifyRSA("a3de5db8", LONG .. "\n", long.sig) == false and C.VerifyRSA("a3de5db8", LONG:sub(1, -2), long.sig) == false,
      fail("message de 30 Ko allongé ou raccourci"))
  end
  check(C.VerifyRSA("a3de5db8", "abc", french.sig) == false, fail("signature d'un autre message"))

  -- Longueurs, base64, clés
  local function reasonOf(...) local ok, r = C.VerifyRSA(...) return ok == false and r end
  check(reasonOf("a3de5db8", "abc", b64encode("\0" .. sig)) == "bad length", fail("zéro en tête : longueur"))
  check(reasonOf("a3de5db8", "abc", b64encode(sig:sub(2))) == "bad length", fail("un octet de moins : longueur"))
  check(reasonOf("a3de5db8", "abc", b64encode(sig .. sig)) == "bad length", fail("deux signatures : longueur"))
  for _, bad in ipairs({ "!!!!", abc.sig:sub(2), abc.sig .. "\n", " " .. abc.sig, abc.sig .. "=", abc.sig:sub(1, 100) .. "=" .. abc.sig:sub(102),
    (abc.sig:gsub("[/+]", "_")) }) do
    if bad ~= abc.sig then check(reasonOf("a3de5db8", "abc", bad) == "bad base64", fail("base64 abîmé : " .. bad:sub(1, 12))) end
  end
  check(reasonOf("a3de5db8", "abc", nil) == "bad base64" and reasonOf("a3de5db8", "abc", 12) == "bad base64", fail("signature absente"))
  for _, id in ipairs({ "deadbeef", "A3DE5DB8", "", "a3de5db", "a3de5db80" }) do
    check(reasonOf(id, "abc", abc.sig) == "unknown key", fail("clé inconnue : " .. id))
  end
  check(reasonOf(nil, "abc", abc.sig) == "unknown key" and reasonOf(12, "abc", abc.sig) == "unknown key", fail("identifiant absent"))
  check(reasonOf("a3de5db8", nil, abc.sig) == "bad message" and reasonOf("a3de5db8", 12, abc.sig) == "bad message", fail("message absent"))
  local n = ns.SITE_KEYS.a3de5db8.n
  local badKeys = {
    notHex = { n = "zz" .. n, e = 65537 }, empty = { n = "", e = 65537 }, zero = { n = "000", e = 65537 },
    even = { n = n:sub(1, -2) .. "4", e = 65537 }, small = { n = n:sub(1, 120) .. "1", e = 65537 },
    e1 = { n = n, e = 1 }, eEven = { n = n, e = 65536 }, eFrac = { n = n, e = 65537.5 }, eHuge = { n = n, e = 2 ^ 53 + 1 },
    eText = { n = n, e = "65537" }, noE = { n = n }, noN = { e = 65537 }, notTable = "clé",
  }
  for id, key in pairs(badKeys) do
    ns.SITE_KEYS[id] = key
    check(reasonOf(id, "abc", abc.sig) == "bad key", fail("clé invalide : " .. id))
    ns.SITE_KEYS[id] = nil
  end
  -- Zéros en tête et majuscules dans le module : même clé
  ns.SITE_KEYS.upper = { n = "0000" .. n:upper(), e = 65537 }
  check(C.VerifyRSA("upper", "abc", abc.sig) == true, fail("module avec zéros en tête et majuscules"))
  ns.SITE_KEYS.upper = nil
  -- Même module, autre exposant : refusée (pas de mélange dans les calculs gardés)
  ns.SITE_KEYS.e3 = { n = n, e = 3 }
  check(reasonOf("e3", "abc", abc.sig) == "bad signature" and C.VerifyRSA("a3de5db8", "abc", abc.sig) == true, fail("autre exposant"))
  ns.SITE_KEYS.e3 = nil
  -- La clé du site n'est pas modifiée (calculs gardés à part) ; sans ns.SITE_KEYS, rien n'est accepté
  local fields = 0
  for _ in pairs(ns.SITE_KEYS.a3de5db8) do fields = fields + 1 end
  check(fields == 2, fail("ns.SITE_KEYS non modifié"))
  local keys = ns.SITE_KEYS
  ns.SITE_KEYS = nil
  check(reasonOf("a3de5db8", "abc", abc.sig) == "unknown key", fail("sans ns.SITE_KEYS"))
  ns.SITE_KEYS = keys

  if bitlib == FAKE_BIT then check(fakeCalls > 0, fail("la bibliothèque bit sert bien")) end

  -- Temps : SHA-256 de 30 Ko + une vérification, avec une clé neuve (premier usage : préparation de la clé comprise),
  -- puis la même vérification une seconde fois
  local fresh = loadCrypto(bitlib).Crypto
  t0 = os.clock()
  check(fresh.VerifyRSA("a3de5db8", LONG, long.sig) == true, fail("vérification du message de 30 Ko, clé neuve"))
  local firstTime = os.clock() - t0
  t0 = os.clock()
  check(fresh.VerifyRSA("a3de5db8", LONG, long.sig) == true, fail("vérification du message de 30 Ko"))
  local verifyTime = os.clock() - t0
  print(string.format("  [%s] SHA-256 de %d octets : %.1f ms ; SHA-256 + vérification RSA : %.1f ms (%.1f ms au premier usage de la clé)%s",
    label, #LONG, shaTime * 1000, verifyTime * 1000, firstTime * 1000,
    bitlib == FAKE_BIT and " — bibliothèque simulée en Lua, bien plus lente que celle du jeu" or ""))
  if bitlib ~= FAKE_BIT then
    if firstTime > 0.1 then print("  [" .. label .. "] attention : plus de 100 ms") end
    check(firstTime < 1, fail("vérification beaucoup trop lente"))
  end
end

run("arithmétique", nil, true)
run("bit simulé", FAKE_BIT, false)
if realBit then run("bit (C)", realBit, false) end

-- Tous les chemins donnent les mêmes résultats (le chemin complet, le premier, en a davantage)
local ref = results[1]
for k = 2, #results do
  local other, count = results[k], 0
  for key, value in pairs(other.out) do
    count = count + 1
    check(ref.out[key] == value, "même résultat pour « " .. key .. " » : " .. ref.label .. " et " .. other.label)
  end
  check(count > #V.sha, "résultats comparés : " .. other.label)
end

if failures > 0 then
  print(failures .. " échec(s)")
  os.exit(1)
end
print("Cryptographie (SHA-256, base64, RSA) : tout est bon")
