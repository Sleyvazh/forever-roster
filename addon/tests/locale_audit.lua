-- Contrôle des textes pendant le jeu simulé (wow_sim.lua, roster_sim.lua, roster_ui_test.lua), en français :
--   LOCALE_AUDIT = dofile("addon/tests/locale_audit.lua")
--   LOCALE_AUDIT.install(ns)          -- avant de charger les fichiers du .toc
--   LOCALE_AUDIT.show(texte)          -- chaque texte affiché (SetText, AddLine, print, chat)
--   LOCALE_AUDIT.check("Roster", { "Libération", … })  -- à la fin : données des tests autorisées
-- Vérifie que : (1) aucun texte n'est traduit pendant le chargement des fichiers (la langue choisie dans les options
-- ne serait pas encore connue) ; (2) chaque texte passé par L a sa traduction anglaise ; (3) aucun texte affiché ne
-- garde du français venu d'ailleurs que de L (accents, « », mots courants).
-- LOCALE_AUDIT=report (variable d'environnement) : affiche les problèmes sans faire échouer le test.
local LA = { shown = {} }

local STOP = { "le", "la", "les", "des", "du", "une", "un", "pour", "avec", "dans", "sur", "pas", "est", "aux", "ton", "ta",
  "tes", "ou", "et", "au", "ce", "cette", "il", "elle", "qui", "que", "ne", "sans", "chef", "objet", "objets",
  "joueur", "joueurs", "butin", "fiche", "groupe", "jeu", "site", "envoi", "envoyer", "relevé" }
local STOPSET = {}
for _, w in ipairs(STOP) do STOPSET[w] = true end
local function french(s)
  if s:find("\195[\128-\191]") or s:find("\197[\146\147]") or s:find("\194[\171\187]") then return true end
  for w in s:lower():gmatch("%a+") do
    if STOPSET[w] then return true end
  end
  return false
end
LA.french = french

function LA.install(ns)
  LA.ns = ns
  ns.Laudit = { seen = {}, load = {}, out = {} }
end

function LA.show(s)
  if type(s) == "string" and s ~= "" then LA.shown[s] = true end
end

-- Codes du jeu retirés avant l'analyse : couleurs, textures, liens (le nom de l'objet vient du jeu)
local function clean(s)
  return (s:gsub("|H.-|h.-|h", " "):gsub("|T.-|t", " "):gsub("|A.-|a", " "):gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""))
end

local function plainRemove(s, part)
  local out, from = {}, 1
  while true do
    local i, j = s:find(part, from, true)
    if not i then break end
    out[#out + 1] = s:sub(from, i - 1)
    from = j + 1
  end
  out[#out + 1] = s:sub(from)
  return table.concat(out, " ")
end

function LA.check(addon, allow)
  local ns, problems = LA.ns, {}
  local a = assert(ns and ns.Laudit, "LOCALE_AUDIT.install(ns) pas appelé")
  for k in pairs(a.load) do problems[#problems + 1] = "traduit pendant le chargement (à faire à l'affichage) : « " .. k .. " »" end
  local en = ns.Strings and ns.Strings("en") or {}
  for k in pairs(a.seen) do
    if en[k] == nil then problems[#problems + 1] = "pas de traduction anglaise : « " .. k .. " »" end
  end
  -- Textes rendus par L (et données autorisées), du plus long au plus court
  local parts = {}
  for s in pairs(a.out) do if #s >= 2 then parts[#parts + 1] = clean(s) end end
  for _, s in ipairs(allow or {}) do parts[#parts + 1] = s end
  table.sort(parts, function(x, y) return #x > #y end)
  for s in pairs(LA.shown) do
    local rest = clean(s)
    if french(rest) then
      for _, p in ipairs(parts) do
        if #p <= #rest and p ~= "" then rest = plainRemove(rest, p) end
      end
      if french(rest) then problems[#problems + 1] = "affiché sans passer par L : « " .. clean(s):gsub("\n", " / "):sub(1, 160) .. " »" end
    end
  end
  table.sort(problems)
  if #problems == 0 then
    io.write(addon .. " : textes de l'interface vérifiés (" .. (function() local c = 0 for _ in pairs(a.seen) do c = c + 1 end return c end)() .. " textes traduits vus)\n")
    return
  end
  local report = os.getenv("LOCALE_AUDIT") == "report"
  io.stderr:write(addon .. " : " .. #problems .. " problème(s) de textes\n")
  for _, p in ipairs(problems) do io.stderr:write("  " .. p .. "\n") end
  if not report then error(addon .. " : textes à traduire (détail ci-dessus ; LOCALE_AUDIT=report pour continuer)", 0) end
end

return LA
