-- Tests hors jeu du décompresseur de l'addon (addon/ForeverRoster/Inflate.lua) : lua5.1 addon/tests/inflate_test.lua
-- (depuis la racine du dépôt). Il lit ce que LibDeflate compresse (tous les niveaux, les trois stratégies) et ce que
-- zlib compresse (addon/tests/fixtures/deflate_vectors.lua, écrit par make-deflate-vectors.py), s'arrête à la limite
-- de taille, et refuse sans erreur ni boucle les données coupées, abîmées ou fabriquées.
local failures, checks = 0, 0
local function check(cond, msg)
  checks = checks + 1
  if not cond then failures = failures + 1 print("ÉCHEC : " .. msg) end
end

local ns = {}
assert(loadfile("addon/ForeverRoster/LibStub.lua"))("ForeverRoster", ns)
assert(loadfile("addon/ForeverRoster/LibDeflate.lua"))("ForeverRoster", ns)
assert(loadfile("addon/ForeverRoster/Inflate.lua"))("ForeverRoster", ns)
local LD = assert(LibStub("LibDeflate"), "LibDeflate chargée par LibStub")
local inflate = ns.Inflate
local LIMIT = 60000

local function unhex(h) return (h:gsub("%x%x", function(b) return string.char(tonumber(b, 16)) end)) end
local function readFile(path) local f = assert(io.open(path, "rb")) local s = f:read("*a") f:close() return s end

-- Hasard reproductible (le même à chaque lancement)
local seed = 20261112
local function rnd(n) seed = (seed * 16807) % 2147483647 return seed % n end
local function randomBytes(len, alphabet)
  local t = {}
  for i = 1, len do t[i] = string.char(alphabet and alphabet:byte(rnd(#alphabet) + 1) or rnd(256)) end
  return table.concat(t)
end

--------------------------------------------------------------------------------------------------------------------
-- 1. Flux de zlib (autre compresseur que LibDeflate)
--------------------------------------------------------------------------------------------------------------------
local vectors = assert(loadfile("addon/tests/fixtures/deflate_vectors.lua"))()
for _, v in ipairs(vectors) do
  local want = unhex(v[2])
  for _, z in ipairs(v[3]) do
    local got, why = inflate(unhex(z[2]), LIMIT)
    check(got == want, ("zlib « %s », variante %s : %s"):format(v[1], z[1], tostring(why)))
  end
end
check(inflate("\3\0", LIMIT) == "", "flux vide valide (un bloc fixe sans rien)")

--------------------------------------------------------------------------------------------------------------------
-- 2. Ce que LibDeflate compresse : tous les niveaux, les trois stratégies, comparé à son propre décompresseur
--------------------------------------------------------------------------------------------------------------------
local frg = readFile("addon/tests/sample.frg")
local inputs = {
  { "vide", "" },
  { "un octet", "x" },
  { "bloc du site", frg },
  { "bloc du site, 12 fois", frg:rep(12) },
  { "octets au hasard", randomBytes(3000) },
  { "texte au hasard", randomBytes(9000, "abcdefgh;;;\n0123456789 éàç") },
  { "une seule lettre", ("z"):rep(40000) },
  { "tous les octets", (function() local t = {} for i = 0, 255 do t[#t + 1] = string.char(i) end return table.concat(t):rep(9) end)() },
  { "juste sous la limite", randomBytes(LIMIT, "FRG;R;P;B;0123456789abcdef-\n") },
}
local configs = {}
for level = 0, 9 do configs[#configs + 1] = { level = level } end
for _, strategy in ipairs({ "fixed", "huffman_only", "dynamic" }) do configs[#configs + 1] = { strategy = strategy } end
local roundTrips = 0
for _, input in ipairs(inputs) do
  for _, cfg in ipairs(configs) do
    local z = LD:CompressDeflate(input[2], cfg)
    local got, why = inflate(z, LIMIT)
    local label = ("LibDeflate « %s », %s"):format(input[1], cfg.level and ("niveau " .. cfg.level) or cfg.strategy)
    check(got == input[2], label .. " : " .. tostring(why))
    check(LD:DecompressDeflate(z) == input[2], label .. " : relu par LibDeflate")
    roundTrips = roundTrips + 1
  end
end
-- Comme dans le jeu : compressé, encodé pour le canal des addons (sans octet nul), décodé, décompressé
do
  local z = LD:CompressDeflate(frg, { level = 9 })
  local wire = LD:EncodeForWoWAddonChannel(z)
  check(not wire:find("%z"), "encodage pour le canal des addons : aucun octet nul")
  check(inflate(LD:DecodeForWoWAddonChannel(wire), LIMIT) == frg, "aller-retour complet du bloc du site")
  check(#wire < #frg * 0.7, ("le bloc du site est bien compressé : %d octets au lieu de %d"):format(#wire, #frg))
end

--------------------------------------------------------------------------------------------------------------------
-- 3. Limite de taille : une « bombe » (30 Ko qui en deviendraient 30 Mo) est refusée tout de suite
--------------------------------------------------------------------------------------------------------------------
do
  local zeros = ("\0"):rep(1024 * 1024)
  local bomb = LD:CompressDeflate(zeros:rep(8), { level = 9 })
  check(#bomb < 20000, "8 Mo de zéros tiennent en moins de 20 Ko compressés : " .. #bomb)
  local t = os.clock()
  local got, why = inflate(bomb, LIMIT)
  local took = os.clock() - t
  check(got == nil and why == "big", "bombe refusée : " .. tostring(why))
  check(took < 0.5, ("bombe refusée vite : %.2f s"):format(took))
  -- Juste à la limite, et un octet au-delà
  local exact = ("ab"):rep(LIMIT / 2)
  check(inflate(LD:CompressDeflate(exact, { level = 9 }), LIMIT) == exact, "exactement la limite : accepté")
  local over, whyOver = inflate(LD:CompressDeflate(exact .. "c", { level = 9 }), LIMIT)
  check(over == nil and whyOver == "big", "un octet au-delà de la limite : refusé")
  local stored, whyStored = inflate(LD:CompressDeflate(randomBytes(LIMIT + 1), { level = 0 }), LIMIT)
  check(stored == nil and whyStored == "big", "bloc recopié au-delà de la limite : refusé")
  check(inflate(LD:CompressDeflate("abc", { level = 9 }), 2) == nil and inflate(LD:CompressDeflate("abc", { level = 9 }), 3) == "abc", "limite respectée à l'octet près")
end

--------------------------------------------------------------------------------------------------------------------
-- 4. Données coupées, abîmées ou fabriquées : refusées (nil), jamais d'erreur ni de boucle, jamais au-delà de la limite
--------------------------------------------------------------------------------------------------------------------
do
  check(select(2, inflate("", LIMIT)) == "data", "rien : refusé")
  check(inflate(nil, LIMIT) == nil and inflate("abc", nil) == nil and inflate("abc", -1) == nil, "arguments invalides : refusés")
  check(select(2, inflate("\7", LIMIT)) == "data", "type de bloc 3 : refusé")
  check(select(2, inflate("\1\5\0\0\0", LIMIT)) == "data", "bloc recopié dont la longueur ne correspond pas à son complément : refusé")
  check(select(2, inflate("\1\5\0\250\255ab", LIMIT)) == "data", "bloc recopié plus long que les données : refusé")
  local z = LD:CompressDeflate(frg, { level = 9 })
  -- Coupé à chaque longueur : jamais le texte entier
  local cut = 0
  for len = 0, #z - 1 do
    local got = inflate(z:sub(1, len), LIMIT)
    if got == frg then cut = cut + 1 end
  end
  check(cut == 0, "flux coupé : jamais accepté comme complet (" .. cut .. ")")
  -- Octets changés au hasard (3 000 essais sur trois flux) : nil ou un texte dans la limite, sans erreur
  local sources = { z, (LD:CompressDeflate(frg, { strategy = "fixed" })), (LD:CompressDeflate(randomBytes(2000, "abc\n;"), { level = 5 })) }
  local errors, tooBig, same = 0, 0, 0
  local t = os.clock()
  for i = 1, 3000 do
    local src = sources[i % #sources + 1]
    local p = rnd(#src) + 1
    local mutated = src:sub(1, p - 1) .. string.char(rnd(256)) .. src:sub(p + 1)
    if rnd(4) == 0 then local q = rnd(#mutated) + 1 mutated = mutated:sub(1, q - 1) .. string.char(rnd(256)) .. mutated:sub(q + 1) end
    local ok, got = pcall(inflate, mutated, LIMIT)
    if not ok then errors = errors + 1
    elseif got and #got > LIMIT then tooBig = tooBig + 1
    elseif mutated == src then same = same + 1 end
  end
  check(errors == 0, "données abîmées : aucune erreur Lua (" .. errors .. ")")
  check(tooBig == 0, "données abîmées : jamais au-delà de la limite")
  check(os.clock() - t < 20, ("3 000 flux abîmés lus en %.1f s"):format(os.clock() - t))
  -- Octets au hasard purs
  errors = 0
  for len = 1, 400 do
    local ok, got = pcall(inflate, randomBytes(len), 5000)
    if not ok or (got and #got > 5000) then errors = errors + 1 end
  end
  check(errors == 0, "octets au hasard : jamais d'erreur ni de dépassement")
end

--------------------------------------------------------------------------------------------------------------------
-- 5. Durée : le plus gros texte permis se lit en bien moins d'une seconde
--------------------------------------------------------------------------------------------------------------------
do
  local big = frg:rep(math.floor(LIMIT / #frg))
  local z = LD:CompressDeflate(big, { level = 9 })
  local t = os.clock()
  local got = inflate(z, LIMIT)
  local took = os.clock() - t
  check(got == big, "gros texte relu")
  check(took < 1, ("gros texte (%d octets) relu en %.3f s"):format(#big, took))
  local hard = randomBytes(LIMIT, "FRG;R;P;B;0123456789abcdef-\n")
  z = LD:CompressDeflate(hard, { level = 9 })
  t = os.clock()
  check(inflate(z, LIMIT) == hard, "texte peu compressible relu")
  print(("inflate : %d octets peu compressibles relus en %.3f s"):format(#hard, os.clock() - t))
end

if failures > 0 then
  print(("inflate_test : %d échec(s) sur %d vérifications"):format(failures, checks))
  os.exit(1)
end
print(("inflate_test : tout est bon (%d vérifications, %d allers-retours avec LibDeflate, %d flux de zlib)"):format(checks, roundTrips, #vectors * 5))
