-- Décompression « deflate » (RFC 1951) avec une taille maximale de sortie (1.7.4).
-- Le partage entre joueurs compresse les données du site avec LibDeflate (Share.lua). Pour les lire, on n'utilise pas
-- le décompresseur de LibDeflate : il n'a pas de limite, et 30 Ko envoyés par un joueur malveillant y deviennent 30 Mo
-- (jeu figé plus d'une seconde, 120 Mo de mémoire). Celui-ci s'arrête dès que la sortie dépasse la limite donnée.
-- Une erreur ici ne peut pas faire passer de fausses données : le texte décompressé est ensuite vérifié par la
-- signature du site (Share.lua), et l'addon redemande l'ancien format s'il n'a rien pu lire.
--   ns.Inflate(données, limite) → texte, ou nil et la raison ("big" : sortie au-delà de la limite ; "data" : données
--   incomplètes ou invalides). Les octets en trop après le dernier bloc sont ignorés.
-- Algorithme : celui de « puff » (zlib/contrib/puff, Mark Adler), décodage bit à bit des codes de Huffman canoniques.
local _, ns = ...

local MAXBITS = 15
-- Longueurs (symboles 257 à 285) et distances (symboles 0 à 29) : base et bits supplémentaires
local LBASE = { 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 }
local LEXT = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 }
local DBASE = { 1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577 }
local DEXT = { 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 }
-- Ordre des longueurs de code dans l'en-tête d'un bloc dynamique
local ORDER = { 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 }
local POW = {}
for i = 0, 16 do POW[i] = 2 ^ i end

-- Table de Huffman d'après les longueurs des codes (lengths[1..n] : longueur du symbole i - 1). Renvoie la table et ce
-- qui reste de l'espace des codes : 0 (complet), > 0 (incomplet), < 0 (trop de codes : invalide)
local function build(lengths, n)
  local count, symbol, offs = {}, {}, {}
  for len = 0, MAXBITS do count[len] = 0 end
  for i = 1, n do count[lengths[i]] = count[lengths[i]] + 1 end
  local left = 1
  for len = 1, MAXBITS do
    left = left * 2 - count[len]
    if left < 0 then return nil, left end
  end
  offs[1] = 0
  for len = 1, MAXBITS - 1 do offs[len + 1] = offs[len] + count[len] end
  for i = 1, n do
    local len = lengths[i]
    if len ~= 0 then
      symbol[offs[len]] = i - 1
      offs[len] = offs[len] + 1
    end
  end
  return { count = count, symbol = symbol }, left
end

local FIXED_LEN, FIXED_DIST
local function fixedTables()
  if not FIXED_LEN then
    local l = {}
    for i = 1, 144 do l[i] = 8 end
    for i = 145, 256 do l[i] = 9 end
    for i = 257, 280 do l[i] = 7 end
    for i = 281, 288 do l[i] = 8 end
    FIXED_LEN = build(l, 288)
    local d = {}
    for i = 1, 30 do d[i] = 5 end
    FIXED_DIST = build(d, 30)
  end
  return FIXED_LEN, FIXED_DIST
end

local function inflate(data, limit)
  local pos, size = 1, #data
  local bitbuf, bitcnt = 0, 0
  local out, n = {}, 0
  local byte, char = string.byte, string.char

  -- n bits de l'entrée (n ≤ 16), poids faible d'abord
  local function bits(need)
    while bitcnt < need do
      if pos > size then error("data", 0) end
      bitbuf = bitbuf + byte(data, pos) * POW[bitcnt]
      pos = pos + 1
      bitcnt = bitcnt + 8
    end
    local v = bitbuf % POW[need]
    bitbuf = (bitbuf - v) / POW[need]
    bitcnt = bitcnt - need
    return v
  end
  -- Un symbole d'après la table de Huffman h
  local function decode(h)
    local code, first, index = 0, 0, 0
    local count, symbol = h.count, h.symbol
    for len = 1, MAXBITS do
      code = code + bits(1)
      local c = count[len]
      if code - c < first then return symbol[index + (code - first)] end
      index = index + c
      first = (first + c) * 2
      code = code * 2
    end
    error("data", 0)
  end
  -- Les symboles d'un bloc compressé, jusqu'à la fin du bloc (256)
  local function codes(lencode, distcode)
    while true do
      local sym = decode(lencode)
      if sym == nil then error("data", 0) end
      if sym < 256 then
        n = n + 1
        if n > limit then error("big", 0) end
        out[n] = char(sym)
      elseif sym == 256 then return
      else
        sym = sym - 256
        if sym > 29 then error("data", 0) end
        local len = LBASE[sym] + bits(LEXT[sym])
        local ds = decode(distcode)
        if ds == nil or ds > 29 then error("data", 0) end
        local dist = DBASE[ds + 1] + bits(DEXT[ds + 1])
        if dist > n then error("data", 0) end
        if n + len > limit then error("big", 0) end
        for _ = 1, len do
          n = n + 1
          out[n] = out[n - dist]
        end
      end
    end
  end

  local last
  repeat
    last = bits(1)
    local kind = bits(2)
    if kind == 0 then
      -- Bloc recopié : on revient à la limite d'un octet, puis LEN, son complément, et LEN octets
      bitbuf, bitcnt = 0, 0
      if pos + 3 > size then error("data", 0) end
      local len = byte(data, pos) + byte(data, pos + 1) * 256
      local nlen = byte(data, pos + 2) + byte(data, pos + 3) * 256
      pos = pos + 4
      if len + nlen ~= 65535 or pos + len - 1 > size then error("data", 0) end
      if n + len > limit then error("big", 0) end
      for i = pos, pos + len - 1 do
        n = n + 1
        out[n] = char(byte(data, i))
      end
      pos = pos + len
    elseif kind == 1 then
      codes(fixedTables())
    elseif kind == 2 then
      local nlen, ndist, ncode = bits(5) + 257, bits(5) + 1, bits(4) + 4
      if nlen > 286 or ndist > 30 then error("data", 0) end
      local lengths = {}
      for i = 1, 19 do lengths[i] = 0 end
      for i = 1, ncode do lengths[ORDER[i] + 1] = bits(3) end
      local lencode, left = build(lengths, 19)
      if not lencode or left ~= 0 then error("data", 0) end -- le code des longueurs doit être complet
      local index = 0
      lengths = {}
      while index < nlen + ndist do
        local sym = decode(lencode)
        if sym == nil then error("data", 0) end
        if sym < 16 then
          index = index + 1
          lengths[index] = sym
        else
          local value, rep = 0, 0
          if sym == 16 then
            if index == 0 then error("data", 0) end
            value = lengths[index]
            rep = 3 + bits(2)
          elseif sym == 17 then rep = 3 + bits(3)
          else rep = 11 + bits(7) end
          if index + rep > nlen + ndist then error("data", 0) end
          for _ = 1, rep do
            index = index + 1
            lengths[index] = value
          end
        end
      end
      if lengths[257] == 0 then error("data", 0) end -- pas de symbole de fin de bloc
      local dl = {}
      for i = 1, ndist do dl[i] = lengths[nlen + i] end
      local lc, lleft = build(lengths, nlen)
      -- Un code incomplet n'est admis que s'il n'a qu'un seul symbole (un seul code de longueur 1)
      if not lc or (lleft > 0 and nlen ~= lc.count[0] + lc.count[1]) then error("data", 0) end
      local dc, dleft = build(dl, ndist)
      if not dc or (dleft > 0 and ndist ~= dc.count[0] + dc.count[1]) then error("data", 0) end
      codes(lc, dc)
    else
      error("data", 0)
    end
  until last == 1
  return table.concat(out, "", 1, n)
end

--- Décompresse des données « deflate » brutes. Renvoie le texte, ou nil et "big" (plus de `limit` octets) ou "data"
--- (données incomplètes ou invalides).
function ns.Inflate(data, limit)
  if type(data) ~= "string" or type(limit) ~= "number" or limit < 0 then return nil, "data" end
  local ok, res = pcall(inflate, data, limit)
  if ok then return res end
  return nil, (res == "big") and "big" or "data"
end
