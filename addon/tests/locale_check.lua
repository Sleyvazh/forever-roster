-- Vérification des textes des deux addons (anglais / français), sans le jeu :
--   lua5.1 addon/tests/locale_check.lua            (depuis la racine du dépôt)
-- Pour chaque addon, lit les fichiers de son .toc (dossier de l'addon, sinon addon/shared) et vérifie :
--   1. chaque texte L["…"], L("…") ou N("…") a sa traduction anglaise (fichiers Locale_en*.lua) ;
--   2. la traduction garde les mêmes %s / %d, dans le même ordre ;
--   3. aucune traduction ne sert à rien, et une même clé n'a pas deux traductions différentes ;
--   4. aucune chaîne française n'est restée hors de L / N : accents, guillemets « », mots courants (le, la, des,
--      pour…). Une chaîne qui doit rester telle quelle (données pour le site, message entre addons, motif de lecture)
--      porte « -- nolocale » en fin de ligne.
-- Code de sortie 1 au moindre problème.
local ADDONS = { "ForeverRoster", "Roster" }
local problems, notes = 0, {}
local function problem(fmt, ...) problems = problems + 1 notes[#notes + 1] = string.format(fmt, ...) end

local function readFile(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local s = f:read("*a")
  f:close()
  return s
end

local function tocFiles(addon)
  local files = {}
  for line in io.lines("addon/" .. addon .. "/" .. addon .. ".toc") do
    line = line:gsub("\r", "")
    if line:match("%.lua$") and not line:match("^#") then
      local own = "addon/" .. addon .. "/" .. line
      files[#files + 1] = readFile(own) and own or ("addon/shared/" .. line)
    end
  end
  return files
end

-- Découpe un fichier Lua en jetons utiles : chaînes (valeur, ligne) et identifiants / symboles, sans les commentaires.
local function lex(src)
  local toks, i, n, line = {}, 1, #src, 1
  local function longBracket(at)
    local eq = src:match("^%[(=*)%[", at)
    if not eq then return nil end
    local close = "]" .. eq .. "]"
    local s, e = src:find(close, at + #eq + 2, true)
    assert(s, "crochet long non fermé")
    return src:sub(at + #eq + 2, s - 1), e
  end
  while i <= n do
    local c = src:sub(i, i)
    if c == "\n" then line = line + 1 i = i + 1
    elseif c:match("%s") then i = i + 1
    elseif src:sub(i, i + 1) == "--" then
      local body, e = longBracket(i + 2)
      if body then
        for _ in body:gmatch("\n") do line = line + 1 end
        i = e + 1
      else
        local e2 = src:find("\n", i, true) or n + 1
        i = e2
      end
    elseif c == '"' or c == "'" then
      local j = i + 1
      while true do
        local d = src:sub(j, j)
        if d == "\\" then j = j + 2
        elseif d == c then break
        elseif d == "" or d == "\n" then error("chaîne non fermée ligne " .. line)
        else j = j + 1 end
      end
      local literal = src:sub(i, j)
      local value = assert(loadstring("return " .. literal))()
      toks[#toks + 1] = { kind = "str", value = value, line = line }
      i = j + 1
    elseif c == "[" and src:match("^%[=*%[", i) then
      local body, e = longBracket(i)
      toks[#toks + 1] = { kind = "str", value = body, line = line, long = true }
      for _ in body:gmatch("\n") do line = line + 1 end
      i = e + 1
    elseif c:match("[%a_]") then
      local word = src:match("^[%w_]+", i)
      toks[#toks + 1] = { kind = "id", value = word, line = line }
      i = i + #word
    else
      toks[#toks + 1] = { kind = "sym", value = c, line = line }
      i = i + 1
    end
  end
  return toks
end

-- Marques du français dans une chaîne affichée
local STOP = { "le", "la", "les", "des", "du", "une", "un", "pour", "avec", "dans", "sur", "pas", "est", "aux", "ton", "ta",
  "tes", "ou", "et", "au", "ce", "cette", "il", "elle", "qui", "que", "ne", "sans", "chef", "objet", "objets",
  "joueur", "joueurs", "butin", "fiche", "groupe", "jeu", "site", "envoi", "envoyer", "relevé" }
local STOPSET = {}
for _, w in ipairs(STOP) do STOPSET[w] = true end
local function french(s)
  -- Hexadécimal (clé du site dans SiteKey.lua, empreintes) : « ce », « a »… y apparaissent par hasard
  if #s >= 16 and s:find("^%x+$") then return false end
  if s:find("\195[\128-\191]") or s:find("\197[\146\147]") or s:find("\194[\171\187]") then return true end
  for w in s:lower():gmatch("%a+") do
    if STOPSET[w] then return true end
  end
  return false
end

local function specs(s)
  local out = {}
  for spec in s:gsub("%%%%", ""):gmatch("%%[%-%+ #0]*%d*%.?%d*[%a]") do out[#out + 1] = spec end
  return table.concat(out, " ")
end

for _, addon in ipairs(ADDONS) do
  local files = tocFiles(addon)
  -- Traductions : fichiers Locale*.lua chargés dans un espace à part
  local ns = {}
  local en, origin = {}, {}
  for _, path in ipairs(files) do
    if path:match("/Locale[^/]*%.lua$") then
      local chunk = assert(loadfile(path))
      if path:match("/Locale%.lua$") then
        chunk(addon, ns)
      else
        -- Chaque fichier de traduction : T[clé] = valeur ; on repère les doublons d'un fichier à l'autre
        local real = ns.Strings
        ns.Strings = function(lang)
          local t = real(lang)
          if lang ~= "en" then return t end
          return setmetatable({}, { __newindex = function(_, k, v)
            if rawget(en, k) ~= nil and en[k] ~= v then
              problem("%s : « %s » traduit deux fois (%s et %s)", addon, k, origin[k], path)
            end
            en[k] = v origin[k] = path
            t[k] = v
          end, __index = t })
        end
        chunk(addon, ns)
        ns.Strings = real
      end
    end
  end
  local used = {}
  local keys = 0
  for _, path in ipairs(files) do
    if not path:match("/Locale[^/]*%.lua$") then
      local src = assert(readFile(path))
      local lines = {}
      for l in (src .. "\n"):gmatch("([^\n]*)\n") do lines[#lines + 1] = l end
      local toks = lex(src)
      for k, t in ipairs(toks) do
        if t.kind == "str" then
          local p1, p2 = toks[k - 1], toks[k - 2]
          local marked = p1 and p2 and p2.kind == "id" and (
            (p1.value == "[" and p2.value == "L") or (p1.value == "(" and (p2.value == "L" or p2.value == "N")))
          -- Une clé doit être la chaîne entière : L["a" .. b] est refusé
          local nextTok = toks[k + 1]
          if marked and nextTok and nextTok.value == "." then
            problem("%s:%d : texte à traduire coupé par « .. » (mettre %%s et L(\"…\", valeur))", path, t.line)
          end
          if marked then
            keys = keys + 1
            used[t.value] = true
            local tr = en[t.value]
            if tr == nil then
              problem("%s:%d : pas de traduction anglaise pour « %s »", path, t.line, t.value)
            elseif specs(tr) ~= specs(t.value) then
              problem("%s:%d : « %s » et sa traduction « %s » n'ont pas les mêmes %% (%s / %s)", path, t.line, t.value, tr, specs(t.value), specs(tr))
            end
          elseif french(t.value) and not (lines[t.line] or ""):find("nolocale", 1, true) then
            problem("%s:%d : texte en français hors de L / N : « %s »", path, t.line, t.value:sub(1, 90))
          end
        end
      end
    end
  end
  for k in pairs(en) do
    if not used[k] then problem("%s : traduction inutile (%s) : « %s »", addon, origin[k], k) end
  end
  print(string.format("%s : %d textes à traduire, %d traductions", addon, keys, (function() local c = 0 for _ in pairs(en) do c = c + 1 end return c end)()))
end

for _, n in ipairs(notes) do print("  " .. n) end
if problems > 0 then
  print(problems .. " problème(s)")
  os.exit(1)
end
print("Textes des addons : tout est bon")
