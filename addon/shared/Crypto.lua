-- Cryptographie pour vérifier les données signées par le site (SHA-256, base64, signature RSA) : voir Share.lua.
--   ns.Crypto.sha256(s)        -> empreinte SHA-256 de la chaîne s (32 octets bruts)
--   ns.Crypto.hex(bin)         -> octets en hexadécimal minuscule
--   ns.Crypto.b64decode(s)     -> octets décodés du base64 standard (avec « = »), nil si le texte est invalide
--   ns.Crypto.VerifyRSA(keyId, message, signatureB64) -> true | false, raison
--     signature RSASSA-PKCS1-v1_5 / SHA-256 avec la clé publique ns.SITE_KEYS[keyId] = { n = "<hex>", e = 65537 }.
-- Le jeu fournit la bibliothèque bit (bit.bxor, bit.band…, résultats sur 32 bits, parfois négatifs) ; sans elle
-- (lua5.1 des tests), SHA-256 passe par un calcul purement arithmétique (tables d'octets). Le choix se fait une fois,
-- au chargement. RSA n'utilise que l'arithmétique : grands entiers en tranches de 24 bits (nombres Lua exacts jusqu'à
-- 2^53), multiplication de Montgomery.
-- Aucune variable globale ; au chargement, seulement des définitions (les tables de calcul se construisent au premier
-- usage).
local _, ns = ...
ns.Crypto = ns.Crypto or {}
local Crypto = ns.Crypto

local byte, char, rep, sub, format = string.byte, string.char, string.rep, string.sub, string.format
local concat, type, tonumber = table.concat, type, tonumber
local bitlib = bit -- bibliothèque du jeu, absente en dehors

local W32 = 4294967296 -- 2^32

--------------------------------------------------------------------------------------------------------------------
-- SHA-256 (FIPS 180-4)
--------------------------------------------------------------------------------------------------------------------
local K256 = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}
local H256 = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 }

-- Chemin « bit » (le jeu) : rotations par l'arithmétique (exactes, moins coûteuses qu'un appel), ou / et exclusifs
-- par bit.bxor / bit.band. Leurs résultats peuvent être négatifs (entiers signés sur 32 bits) : ramenés entre 0 et
-- 2^32 - 1 (% 2^32) avant de resservir, sauf quand ils vont seulement dans une somme réduite ensuite modulo 2^32.
-- La bibliothèque ne reçoit donc que des entiers de 0 à 2^32 - 1.
local function compressBit(H, s, off, W)
  local bxor, band = bitlib.bxor, bitlib.band
  for t = 1, 16 do
    local b1, b2, b3, b4 = byte(s, off, off + 3)
    off = off + 4
    W[t] = ((b1 * 256 + b2) * 256 + b3) * 256 + b4
  end
  for t = 17, 64 do
    local x, y = W[t - 15], W[t - 2]
    local x7, x18, x3 = x % 128, x % 262144, x % 8
    local y17, y19, y10 = y % 131072, y % 524288, y % 1024
    -- σ0(x) = rotr7 ^ rotr18 ^ shr3 ; σ1(y) = rotr17 ^ rotr19 ^ shr10
    W[t] = (bxor(bxor((x - x7) / 128 + x7 * 33554432, (x - x18) / 262144 + x18 * 16384) % 4294967296, (x - x3) / 8)
      + bxor(bxor((y - y17) / 131072 + y17 * 32768, (y - y19) / 524288 + y19 * 8192) % 4294967296, (y - y10) / 1024)
      + W[t - 7] + W[t - 16]) % 4294967296
  end
  local a, b, c, d, e, f, g, h = H[1], H[2], H[3], H[4], H[5], H[6], H[7], H[8]
  for t = 1, 64 do
    -- Σ1(e) = rotr6 ^ rotr11 ^ rotr25 ; ch(e, f, g) = g ^ (e & (f ^ g))
    local e6, e11, e25 = e % 64, e % 2048, e % 33554432
    local t1 = h + bxor(bxor((e - e6) / 64 + e6 * 67108864, (e - e11) / 2048 + e11 * 2097152) % 4294967296,
      (e - e25) / 33554432 + e25 * 128) + bxor(g, band(e, bxor(f, g) % 4294967296) % 4294967296) + K256[t] + W[t]
    -- Σ0(a) = rotr2 ^ rotr13 ^ rotr22 ; maj(a, b, c) = (a + b + c - (a ^ b ^ c)) / 2 (additionneur complet, bit à bit)
    local a2, a13, a22 = a % 4, a % 8192, a % 4194304
    local t2 = bxor(bxor((a - a2) / 4 + a2 * 1073741824, (a - a13) / 8192 + a13 * 524288) % 4294967296,
      (a - a22) / 4194304 + a22 * 1024) + (a + b + c - bxor(bxor(a, b) % 4294967296, c) % 4294967296) / 2
    h = g g = f f = e e = (d + t1) % 4294967296 d = c c = b b = a a = (t1 + t2) % 4294967296
  end
  H[1], H[2], H[3], H[4] = (H[1] + a) % W32, (H[2] + b) % W32, (H[3] + c) % W32, (H[4] + d) % W32
  H[5], H[6], H[7], H[8] = (H[5] + e) % W32, (H[6] + f) % W32, (H[7] + g) % W32, (H[8] + h) % W32
end

-- Chemin arithmétique (sans bit) : chaque mot de 32 bits est découpé en 4 octets. Un octet « étalé » (SP) place
-- chacun de ses bits dans un chiffre en base 4 : additionner jusqu'à 3 valeurs étalées compte les 1 de chaque position
-- sans retenue, et PAR (65 536 entrées) ramène chaque chiffre à sa parité, soit le ou exclusif. Σ0, Σ1, σ0, σ1 sont
-- linéaires : une table par octet d'entrée donne, déjà étalée (moitiés basse et haute du mot), sa part du résultat.
-- ch et maj s'écrivent avec des ou exclusifs et des sommes :
--   ch(e, f, g) = (f + g - (e ^ f) + (e ^ g)) / 2 ; maj(a, b, c) = (a + b + c - (a ^ b ^ c)) / 2.
local arith -- tables, construites au premier usage

-- Tables d'une fonction linéaire : rotations à droite r1, r2 et r3 (ou, si shift, décalage à droite de r3). Les parts
-- s'additionnent : celle d'un octet v est celle de v sans son bit de poids fort, plus celle de ce bit.
local function linearTables(r1, r2, r3, shift)
  local function put(o, l, h) -- un 1 au bit de sortie o (chiffre o en base 4)
    if o < 16 then return l + 4 ^ o, h end
    return l, h + 4 ^ (o - 16)
  end
  local T = {}
  for j = 0, 3 do -- octet d'entrée (0 = poids faible)
    local bitLo, bitHi = {}, {}
    for b = 0, 7 do
      local k = 8 * j + b
      local l, h = put((k - r1) % 32, 0, 0)
      l, h = put((k - r2) % 32, l, h)
      if not shift then l, h = put((k - r3) % 32, l, h)
      elseif k >= r3 then l, h = put(k - r3, l, h) end
      bitLo[b], bitHi[b] = l, h
    end
    local lo, hi = { [0] = 0 }, { [0] = 0 }
    local top, b = 1, 0 -- bit de poids fort de v : top = 2^b
    for v = 1, 255 do
      if v == top * 2 then top, b = v, b + 1 end
      lo[v], hi[v] = lo[v - top] + bitLo[b], hi[v - top] + bitHi[b]
    end
    T[j + 1], T[j + 5] = lo, hi
  end
  return T
end

local function arithTables()
  if arith then return arith end
  local SP, PAR = {}, {}
  for v = 0, 255 do
    local x, p, s = v, 1, 0
    while x > 0 do
      local r = x % 2
      s = s + r * p
      x, p = (x - r) / 2, p * 4
    end
    SP[v] = s
  end
  PAR[0] = 0
  for v = 1, 65535 do
    local d = v % 4
    PAR[v] = d % 2 + 2 * PAR[(v - d) / 4]
  end
  arith = {
    SP = SP, PAR = PAR,
    S0 = linearTables(2, 13, 22), S1 = linearTables(6, 11, 25),
    s0 = linearTables(7, 18, 3, true), s1 = linearTables(17, 19, 10, true),
    X0 = {}, X1 = {}, -- σ0 et σ1 de chaque mot du message (zones de travail)
  }
  return arith
end

-- Message étendu : W[1..64], avec σ0 (X0) et σ1 (X1) des mots qui en ont besoin, calculés une fois depuis leurs octets
local function expandArith(T, s, off, W)
  local P, X0, X1 = T.PAR, T.X0, T.X1
  local A, B = T.s0, T.s1
  local p0, p1, p2, p3, p4, p5, p6, p7 = A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8]
  local q0, q1, q2, q3, q4, q5, q6, q7 = B[1], B[2], B[3], B[4], B[5], B[6], B[7], B[8]
  for t = 1, 62 do
    local w0, w1, w2, w3
    if t <= 16 then
      w3, w2, w1, w0 = byte(s, off, off + 3)
      off = off + 4
      W[t] = ((w3 * 256 + w2) * 256 + w1) * 256 + w0
    else
      local w = (X1[t - 2] + W[t - 7] + X0[t - 15] + W[t - 16]) % 4294967296
      W[t] = w
      w0 = w % 256
      w = (w - w0) / 256
      w1 = w % 256
      w = (w - w1) / 256
      w2 = w % 256
      w3 = (w - w2) / 256
    end
    local lo, hi, x, y
    if t <= 49 then -- σ0 sert jusqu'à W[49] (pour W[64])
      lo = p0[w0] + p1[w1] + p2[w2] + p3[w3]
      hi = p4[w0] + p5[w1] + p6[w2] + p7[w3]
      x = lo % 65536
      y = hi % 65536
      X0[t] = P[x] + P[(lo - x) / 65536] * 256 + (P[y] + P[(hi - y) / 65536] * 256) * 65536
    end
    lo = q0[w0] + q1[w1] + q2[w2] + q3[w3]
    hi = q4[w0] + q5[w1] + q6[w2] + q7[w3]
    x = lo % 65536
    y = hi % 65536
    X1[t] = P[x] + P[(lo - x) / 65536] * 256 + (P[y] + P[(hi - y) / 65536] * 256) * 65536
  end
  for t = 63, 64 do W[t] = (X1[t - 2] + W[t - 7] + X0[t - 15] + W[t - 16]) % 4294967296 end
end

local function compressArith(H, s, off, W)
  local T = arith or arithTables()
  expandArith(T, s, off, W)
  local P, SP, K = T.PAR, T.SP, K256
  local A, E = T.S0, T.S1
  local a0L, a1L, a2L, a3L, a0H, a1H, a2H, a3H = A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8]
  local e0L, e1L, e2L, e3L, e0H, e1H, e2H, e3H = E[1], E[2], E[3], E[4], E[5], E[6], E[7], E[8]
  local a, b, c, d, e, f, g, h = H[1], H[2], H[3], H[4], H[5], H[6], H[7], H[8]
  local x, y, lo, hi
  -- Octets de a et e, octets étalés de a, b, c, e, f, g
  local a0 = a % 256 x = (a - a0) / 256 local a1 = x % 256 x = (x - a1) / 256 local a2 = x % 256 local a3 = (x - a2) / 256
  local sa0, sa1, sa2, sa3 = SP[a0], SP[a1], SP[a2], SP[a3]
  local e0 = e % 256 x = (e - e0) / 256 local e1 = x % 256 x = (x - e1) / 256 local e2 = x % 256 local e3 = (x - e2) / 256
  local se0, se1, se2, se3 = SP[e0], SP[e1], SP[e2], SP[e3]
  local v0 = b % 256 x = (b - v0) / 256 local v1 = x % 256 x = (x - v1) / 256 local v2 = x % 256 local v3 = (x - v2) / 256
  local sb0, sb1, sb2, sb3 = SP[v0], SP[v1], SP[v2], SP[v3]
  v0 = c % 256 x = (c - v0) / 256 v1 = x % 256 x = (x - v1) / 256 v2 = x % 256 v3 = (x - v2) / 256
  local sc0, sc1, sc2, sc3 = SP[v0], SP[v1], SP[v2], SP[v3]
  v0 = f % 256 x = (f - v0) / 256 v1 = x % 256 x = (x - v1) / 256 v2 = x % 256 v3 = (x - v2) / 256
  local sf0, sf1, sf2, sf3 = SP[v0], SP[v1], SP[v2], SP[v3]
  v0 = g % 256 x = (g - v0) / 256 v1 = x % 256 x = (x - v1) / 256 v2 = x % 256 v3 = (x - v2) / 256
  local sg0, sg1, sg2, sg3 = SP[v0], SP[v1], SP[v2], SP[v3]
  for t = 1, 64 do
    -- t1 = h + Σ1(e) + ch(e, f, g) + K[t] + W[t]
    lo = e0L[e0] + e1L[e1] + e2L[e2] + e3L[e3]
    hi = e0H[e0] + e1H[e1] + e2H[e2] + e3H[e3]
    x = lo % 65536
    y = hi % 65536
    local t1 = h + P[x] + P[(lo - x) / 65536] * 256 + (P[y] + P[(hi - y) / 65536] * 256) * 65536
      + (f + g + P[se0 + sg0] - P[se0 + sf0] + (P[se1 + sg1] - P[se1 + sf1]) * 256
        + (P[se2 + sg2] - P[se2 + sf2]) * 65536 + (P[se3 + sg3] - P[se3 + sf3]) * 16777216) / 2
      + K[t] + W[t]
    -- t2 = Σ0(a) + maj(a, b, c)
    lo = a0L[a0] + a1L[a1] + a2L[a2] + a3L[a3]
    hi = a0H[a0] + a1H[a1] + a2H[a2] + a3H[a3]
    x = lo % 65536
    y = hi % 65536
    local t2 = P[x] + P[(lo - x) / 65536] * 256 + (P[y] + P[(hi - y) / 65536] * 256) * 65536
      + (a + b + c - P[sa0 + sb0 + sc0] - P[sa1 + sb1 + sc1] * 256 - P[sa2 + sb2 + sc2] * 65536
        - P[sa3 + sb3 + sc3] * 16777216) / 2
    -- Décalage des variables (affectations une à une : moins d'instructions qu'une affectation multiple)
    h = g g = f f = e e = (d + t1) % 4294967296 d = c c = b b = a a = (t1 + t2) % 4294967296
    sg0 = sf0 sg1 = sf1 sg2 = sf2 sg3 = sf3 sf0 = se0 sf1 = se1 sf2 = se2 sf3 = se3
    sc0 = sb0 sc1 = sb1 sc2 = sb2 sc3 = sb3 sb0 = sa0 sb1 = sa1 sb2 = sa2 sb3 = sa3
    e0 = e % 256 x = (e - e0) / 256 e1 = x % 256 x = (x - e1) / 256 e2 = x % 256 e3 = (x - e2) / 256
    se0 = SP[e0] se1 = SP[e1] se2 = SP[e2] se3 = SP[e3]
    a0 = a % 256 x = (a - a0) / 256 a1 = x % 256 x = (x - a1) / 256 a2 = x % 256 a3 = (x - a2) / 256
    sa0 = SP[a0] sa1 = SP[a1] sa2 = SP[a2] sa3 = SP[a3]
  end
  H[1], H[2], H[3], H[4] = (H[1] + a) % W32, (H[2] + b) % W32, (H[3] + c) % W32, (H[4] + d) % W32
  H[5], H[6], H[7], H[8] = (H[5] + e) % W32, (H[6] + f) % W32, (H[7] + g) % W32, (H[8] + h) % W32
end

local compress = (type(bitlib) == "table" and type(bitlib.bxor) == "function" and type(bitlib.band) == "function")
  and compressBit or compressArith

local function sha256(s)
  if type(s) ~= "string" then error("sha256: string expected", 2) end
  local H, W = { H256[1], H256[2], H256[3], H256[4], H256[5], H256[6], H256[7], H256[8] }, {}
  local len = #s
  local full = len - len % 64
  for off = 1, full, 64 do compress(H, s, off, W) end
  -- Dernier(s) bloc(s) : reste, octet 0x80, zéros, longueur en bits sur 8 octets (gros-boutiste)
  local size, bits = {}, len * 8
  for i = 8, 1, -1 do
    local v = bits % 256
    size[i] = v
    bits = (bits - v) / 256
  end
  local tail = sub(s, full + 1) .. "\128" .. rep("\0", (55 - (len - full)) % 64) .. char(size[1], size[2], size[3],
    size[4], size[5], size[6], size[7], size[8])
  for off = 1, #tail, 64 do compress(H, tail, off, W) end
  local out = {}
  for i = 1, 8 do
    local w = H[i]
    local b4 = w % 256 w = (w - b4) / 256
    local b3 = w % 256 w = (w - b3) / 256
    local b2 = w % 256
    out[i] = char((w - b2) / 256, b2, b3, b4)
  end
  return concat(out)
end
Crypto.sha256 = sha256

function Crypto.hex(bin)
  local out = {}
  for i = 1, #bin do out[i] = format("%02x", byte(bin, i)) end
  return concat(out)
end

--------------------------------------------------------------------------------------------------------------------
-- Base64 standard (A–Z a–z 0–9 + /), avec « = » : tout autre caractère, longueur non multiple de 4, « = » mal placé
-- ou bits de remplissage non nuls -> nil
--------------------------------------------------------------------------------------------------------------------
local B64 -- code de caractère -> valeur (0..63), construit au premier usage

local function b64decode(s)
  if type(s) ~= "string" then return nil end
  local len = #s
  if len % 4 ~= 0 then return nil end
  if not B64 then
    B64 = {}
    local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    for i = 1, 64 do B64[byte(alphabet, i)] = i - 1 end
  end
  local map, out = B64, {}
  for i = 1, len, 4 do
    local c1, c2, c3, c4 = byte(s, i, i + 3)
    local v1, v2, v3, v4 = map[c1], map[c2], map[c3], map[c4]
    if not (v1 and v2) then return nil end
    if v3 and v4 then
      local v = ((v1 * 64 + v2) * 64 + v3) * 64 + v4
      local b3 = v % 256 v = (v - b3) / 256
      local b2 = v % 256
      out[#out + 1] = char((v - b2) / 256, b2, b3)
    elseif i + 3 ~= len then
      return nil
    elseif v3 and c4 == 61 then -- « xyz= » : 2 octets, les 2 derniers bits doivent être nuls
      if v3 % 4 ~= 0 then return nil end
      local v = (v1 * 64 + v2) * 16 + v3 / 4
      local b2 = v % 256
      out[#out + 1] = char((v - b2) / 256, b2)
    elseif c3 == 61 and c4 == 61 then -- « xy== » : 1 octet, les 4 derniers bits doivent être nuls
      if v2 % 16 ~= 0 then return nil end
      out[#out + 1] = char(v1 * 4 + v2 / 16)
    else
      return nil
    end
  end
  return concat(out)
end
Crypto.b64decode = b64decode

--------------------------------------------------------------------------------------------------------------------
-- RSA : grands entiers en tableaux de tranches de 24 bits, poids faible d'abord (x[1]). Les produits de deux tranches
-- restent sous 2^48 et chaque somme du calcul sous 2^53 : tout est exact en nombres Lua.
--------------------------------------------------------------------------------------------------------------------
local LIMB = 16777216 -- 2^24

-- Comparaison de deux entiers de k tranches : -1, 0 ou 1
local function cmp(a, b, k)
  for i = k, 1, -1 do
    local x, y = a[i], b[i]
    if x ~= y then return x < y and -1 or 1 end
  end
  return 0
end

-- a <- a - b sur k tranches (la retenue finale est abandonnée : elle compense un dépassement déjà connu)
local function subInPlace(a, b, k)
  local borrow = 0
  for i = 1, k do
    local v = a[i] - b[i] - borrow
    if v < 0 then a[i], borrow = v + LIMB, 1 else a[i], borrow = v, 0 end
  end
end

-- Produit de Montgomery a * b / R mod n (R = 2^(24k)), méthode CIOS : multiplication et réduction dans la même
-- boucle, retenue propagée à chaque tranche. Pour a, b < n, le résultat avant soustraction finale est < 2n.
local function montMul(a, b, n, np, k)
  local t = {}
  for j = 1, k + 1 do t[j] = 0 end
  local a1, n1 = a[1], n[1]
  for i = 1, k do
    local bi = b[i]
    local u = t[1] + a1 * bi
    local m = (u % LIMB) * np % LIMB -- choisi pour que u + m * n[1] soit un multiple de 2^24
    local carry = (u + m * n1) / LIMB
    for j = 2, k do
      u = t[j] + a[j] * bi + m * n[j] + carry -- < 2^24 + 2^48 + 2^48 + 2^26 < 2^53
      local r = u % LIMB
      t[j - 1] = r
      carry = (u - r) / LIMB
    end
    u = t[k + 1] + carry
    local r = u % LIMB
    t[k] = r
    t[k + 1] = (u - r) / LIMB
  end
  if t[k + 1] ~= 0 or cmp(t, n, k) >= 0 then subInPlace(t, n, k) end
  t[k + 1] = nil
  return t
end

-- x^e (forme de Montgomery) par carrés et multiplications, bits de e du poids fort au poids faible
local function montPow(x, e, n, np, k)
  local bits, v = {}, e
  while v > 0 do
    local r = v % 2
    bits[#bits + 1] = r
    v = (v - r) / 2
  end
  local acc = x
  for i = #bits - 1, 1, -1 do
    acc = montMul(acc, acc, n, np, k)
    if bits[i] == 1 then acc = montMul(acc, x, n, np, k) end
  end
  return acc
end

-- Octets gros-boutistes -> k tranches (la chaîne fait au plus 3k octets)
local function fromBytes(s, k)
  local x, last = {}, #s
  for i = 1, k do
    local first = last - 2
    if last < 1 then x[i] = 0
    else
      if first < 1 then first = 1 end
      local v = 0
      for p = first, last do v = v * 256 + byte(s, p) end
      x[i] = v
    end
    last = last - 3
  end
  return x
end

-- k tranches -> len octets gros-boutistes (la valeur tient dans len octets)
local function toBytes(x, k, len)
  local out = {}
  for i = 1, k do
    local v = x[i]
    local b3 = v % 256 v = (v - b3) / 256
    local b2 = v % 256
    out[k - i + 1] = char((v - b2) / 256, b2, b3)
  end
  local s = concat(out)
  return sub(s, #s - len + 1)
end

-- DigestInfo DER de SHA-256 (RFC 8017, 9.2) : précède l'empreinte dans le message encodé
local DIGEST_INFO = { 0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05,
  0x00, 0x04, 0x20 }

-- Clés préparées, par module hexadécimal : tranches de n, n' = -n^-1 mod 2^24, R^2 mod n, début attendu du message
-- encodé. Gardées ici (jamais dans ns.SITE_KEYS).
local prepared = {}

local function prepareKey(key)
  if type(key) ~= "table" then return nil end
  local nhex, e = key.n, key.e
  if type(nhex) ~= "string" or type(e) ~= "number" then return nil end
  local P = prepared[nhex]
  if P and P.e == e then return P end
  -- e : entier impair, au moins 3 ; n : impair, au moins 62 octets (19 de DigestInfo, 32 d'empreinte, 11 de cadre)
  if e < 3 or e >= 2 ^ 53 or e % 1 ~= 0 or e % 2 ~= 1 then return nil end
  local hex = nhex:match("^0*(%x+)$")
  if not hex then return nil end
  local topDigit = tonumber(sub(hex, 1, 1), 16)
  if topDigit == 0 or tonumber(sub(hex, -1), 16) % 2 == 0 then return nil end
  local nbits = 4 * (#hex - 1)
  while topDigit > 0 do nbits, topDigit = nbits + 1, (topDigit - topDigit % 2) / 2 end
  local len = (nbits - nbits % 8) / 8 + (nbits % 8 > 0 and 1 or 0)
  if len < 62 then return nil end
  local k = (nbits - nbits % 24) / 24 + (nbits % 24 > 0 and 1 or 0)
  local n = {}
  for i = 1, k do
    local last = #hex - 6 * (i - 1)
    n[i] = last >= 1 and tonumber(sub(hex, last - 5 > 0 and last - 5 or 1, last), 16) or 0
  end
  -- Inverse de n[1] modulo 2^24 par Newton (chaque tour double les bits justes : 3, 6, 12, 24, 48)
  local n1, inv = n[1], n[1]
  for _ = 1, 4 do inv = inv * ((2 - (n1 * inv) % LIMB) % LIMB) % LIMB end
  if (n1 * inv) % LIMB ~= 1 then return nil end
  local np = (LIMB - inv) % LIMB
  -- R^2 mod n, avec 24k = j·2^s (s ≤ 4) : 2^(nbits-1) < n, doublé (avec réduction) jusqu'à 2^(24k+j) mod n, soit
  -- 2^j·R (forme de Montgomery de 2^j), puis s carrés de Montgomery : 2^(j·2^s)·R = R·R. Un doublement coûte k
  -- opérations, un produit k² : ce partage en demande le moins.
  local j, s = 24 * k, 0
  while s < 4 and j % 2 == 0 do j, s = j / 2, s + 1 end
  local x = {}
  for i = 1, k do x[i] = 0 end
  x[(nbits - 1 - (nbits - 1) % 24) / 24 + 1] = 2 ^ ((nbits - 1) % 24)
  for _ = 1, 24 * k + j - (nbits - 1) do
    local carry = 0
    for i = 1, k do
      local v = x[i] * 2 + carry
      if v >= LIMB then x[i], carry = v - LIMB, 1 else x[i], carry = v, 0 end
    end
    if carry == 1 or cmp(x, n, k) >= 0 then subInPlace(x, n, k) end
  end
  for _ = 1, s do x = montMul(x, x, n, np, k) end
  local one = { 1 }
  for i = 2, k do one[i] = 0 end
  local digestInfo = {}
  for i = 1, #DIGEST_INFO do digestInfo[i] = char(DIGEST_INFO[i]) end
  P = {
    e = e, n = n, np = np, k = k, len = len, one = one,
    r2 = x,
    -- 00 01 FF…FF 00 DigestInfo, puis l'empreinte : len octets en tout
    prefix = "\0\1" .. rep("\255", len - 3 - #DIGEST_INFO - 32) .. "\0" .. concat(digestInfo),
  }
  prepared[nhex] = P
  return P
end

-- Raison du refus en second résultat (pour le débogage, jamais affichée telle quelle)
function Crypto.VerifyRSA(keyId, message, signatureB64)
  if type(message) ~= "string" then return false, "bad message" end
  local keys = ns.SITE_KEYS
  local key = type(keyId) == "string" and type(keys) == "table" and keys[keyId]
  if not key then return false, "unknown key" end
  local P = prepareKey(key)
  if not P then return false, "bad key" end
  local sig = b64decode(signatureB64)
  if not sig then return false, "bad base64" end
  if #sig ~= P.len then return false, "bad length" end
  local n, np, k = P.n, P.np, P.k
  local s = fromBytes(sig, k)
  if cmp(s, n, k) >= 0 then return false, "out of range" end
  -- m = s^e mod n : passage en forme de Montgomery (s·R), puissance, retour (· 1/R)
  local m = montMul(montPow(montMul(s, P.r2, n, np, k), P.e, n, np, k), P.one, n, np, k)
  if toBytes(m, k, P.len) ~= P.prefix .. sha256(message) then return false, "bad signature" end
  return true
end
