-- Tests hors jeu des formats de Roster (WoW Retail) : lua5.1 addon/tests/roster_format_test.lua (depuis la racine du dépôt)
-- Écrit addon/tests/sample.rrb, relu par le test du site ; relit sample.rrg et sample.rrr s'ils existent (écrits par le site).
local F = assert(loadfile("addon/Roster/Format.lua"))("Roster", {})
F.realm = "Hyjal" -- royaume du joueur dans ce test
local failures = 0
local function check(cond, msg) if not cond then failures = failures + 1 print("ÉCHEC : " .. msg) end end

-- Noms « Prénom-Royaume » : royaume normalisé comme GetNormalizedRealmName (sans espaces, tirets ni points)
check(F.Normalize("Conseil des Ombres") == "ConseildesOmbres", "royaume : espaces retirés")
check(F.Normalize("Kael'Thas") == "Kael'Thas", "royaume : apostrophe gardée")
check(F.Normalize("Azjol-Nerub") == "AzjolNerub", "royaume : tiret retiré")
check(F.Normalize("Aggra (Português)") == "Aggra(Português)", "royaume : parenthèses gardées")
check(F.FullName("Kaeldra") == "Kaeldra-Hyjal", "nom sans royaume : celui du joueur")
check(F.FullName("Kaeldra", "") == "Kaeldra-Hyjal", "royaume vide : celui du joueur")
check(F.FullName("Brumelune", "Ysondre") == "Brumelune-Ysondre", "nom et royaume")
check(F.FullName("Orvane", "Conseil des Ombres") == "Orvane-ConseildesOmbres", "royaume normalisé")
check(F.FullName("Vex-Kael'Thas") == "Vex-Kael'Thas", "nom complet gardé")
check(F.FullName("  Tharok-Hyjal ") == "Tharok-Hyjal", "espaces autour retirés")
check(F.FullName("|Hplayer:Tharok-Hyjal:12|h[Tharok]|h") == "Tharok-Hyjal", "lien de joueur")
check(F.FullName(nil) == nil and F.FullName("") == nil, "pas de nom")
check(F.SameName("Kaeldra", "Kaeldra-Hyjal"), "même royaume : avec ou sans royaume")
check(F.SameName("kaeldra-hyjal", "Kaeldra-Hyjal"), "casse ignorée")
check(F.SameName("Vex-KaelThas", "Vex-Kael'Thas") and F.SameName("Vex-Kael’Thas", "Vex-Kael'Thas"), "apostrophes ignorées")
check(F.SameName("Brümelune-Ysondre", "Brumelune-Ysondre") and F.SameName("ÉLOÏSE", "eloise-hyjal"), "accents ignorés")
check(F.SameName("Orvane-Conseil des Ombres", "Orvane-ConseildesOmbres"), "royaume avec espaces")
check(not F.SameName("Kaeldra-Ysondre", "Kaeldra-Hyjal"), "autre royaume : autre perso")
check(not F.SameName(nil, nil), "pas de nom : jamais égal")
check(F.Display("Kaeldra-Hyjal") == "Kaeldra" and F.Display("Brumelune-Ysondre") == "Brumelune-Ysondre", "nom affiché")

-- RRG v1 : deux groupes à la suite (le second sans raid), lignes futures hors du compte de END ignorées
local RRG = table.concat({
  "RRG;1;6f1c2a10-0000-4000-8000-000000000001;1791000000;Les Veilleurs d'Ysondre",
  "R;7a1c2a10-0000-4000-8000-000000000002;1791100000;Faille de Sporefall;heroic;25;present;Kaeldra-Hyjal;council",
  "R;8a1c2a10-0000-4000-8000-000000000003;0;Kith'ix;mythic;20;;;journal",
  "X;7a1c2a10-0000-4000-8000-000000000002;ligne d'une version plus récente",
  "END;2",
  "RRG;1;g2;1791000000;Pasta",
  "END;0",
}, "\r\n")
local gs, err = F.ParseRRG(RRG)
check(gs and #gs == 2, "deux groupes RRG : " .. tostring(err))
local g = gs and gs[1]
check(g and g.name == "Les Veilleurs d'Ysondre" and g.at == 1791000000 and #g.raids == 2, "groupe et raids")
local r1 = g and g.raids[1]
check(r1 and r1.difficulty == "heroic" and r1.size == 25 and r1.status == "present" and r1.char == "Kaeldra-Hyjal" and r1.loot == "council", "raid : difficulté, effectif, inscription, butin")
check(g and g.raids[2].time == 0 and g.raids[2].status == nil and g.raids[2].char == nil and g.raids[2].difficulty == "mythic", "raid sans date ni inscription")
check(gs and #gs[2].raids == 0, "groupe sans raid")
local bad, berr = F.ParseRRG("RRG;1;x;0;G\nR;a;0;b;normal;20;;;\nEND;2")
check(bad == nil and berr:find("incomplet"), "RRG tronqué refusé")
bad, berr = F.ParseRRG("RRG;1;x;0;G\nEND;0\nRRG;1;y;0;H\nR;a;0;b;normal;20;;;")
check(bad == nil and berr:find("incomplet"), "second groupe tronqué refusé")
bad, berr = F.ParseRRG("RRG;2;x;0;G\nEND;0")
check(bad == nil and berr:find("mets l'addon à jour"), "version plus récente refusée")
local evil = F.ParseRRG("RRG;1;g;0;|cffff0000Rouge|r\nR;r;0;|Hitem:1|h[Faux]|h;normal;20;;;\nEND;1")
check(evil and not evil[1].name:find("|", 1, true) and not evil[1].raids[1].name:find("|", 1, true), "codes du jeu retirés")
check(F.ParseRRG("RRG;1;g;0;G\nR;r;0;Raid;facile;abc;;;\nEND;1")[1].raids[1].difficulty == "", "difficulté inconnue : vide")

-- RRG, lot R3b : conseil par défaut (O), conseil d'un raid (L), objets reçus (N), hors du compte de END
local RRG3B = table.concat({
  "RRG;1;g1;1791000000;Les Veilleurs",
  "R;r1;1791100000;Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "R;r2;0;Kith'ix;mythic;20;;;journal",
  "O;Kaeldra-Hyjal,Tharok-Hyjal,Brumelune-Ysondre",
  "L;r1;Kaeldra-Hyjal,Vex-Kael'Thas",
  "N;saison;depuis le 05/11/2026;Tharok-Hyjal+Grumbar-Hyjal:3,Vex-Kael'Thas:0,Brumelune-Ysondre:2",
  "END;2",
  "RRG;1;g2;1791000000;Pasta",
  "END;0",
  "O;Orvane-Hyjal", -- après END : rattachée au groupe en cours
}, "\n")
local g3 = F.ParseRRG(RRG3B)
check(g3 and #g3 == 2 and #g3[1].raids == 2, "RRG avec O, L et N : complet (hors du compte de END)")
local v = g3 and g3[1]
check(v and #v.officers == 3 and v.officers[2] == "Tharok-Hyjal", "ligne O : officiers")
check(v and v.council and #v.council.r1 == 2 and v.council.r1[2] == "Vex-Kael'Thas" and v.council.r2 == nil, "ligne L : conseil du raid")
check(v and v.counts and v.counts.short == "saison" and v.counts.label == "depuis le 05/11/2026" and #v.counts.entries == 3, "ligne N : période et entrées")
local grum = v and F.CountFor(v.counts, "Grumbar")
check(grum and grum.n == 3 and #grum.names == 2 and grum.names[1] == "Tharok-Hyjal", "ligne N : persos d'un même joueur ensemble")
check(v and F.CountFor(v.counts, "vex-kaelthas").n == 0 and F.CountFor(v.counts, "Inconnu-Hyjal") == nil and F.CountFor(nil, "Vex") == nil, "ligne N : recherche par nom")
check(g3 and #g3[2].officers == 1, "ligne O après END")
check(F.ParseRRG("RRG;1;g;0;G\nN;30 j;sur 30 jours;A-B:x,C-D:2,:4\nEND;0")[1].counts.entries[1].names[1] == "C-D", "ligne N abîmée : entrées illisibles ignorées")

-- RRG, addon 0.3 : détail des objets reçus (D) après N, rattaché aux entrées de N par le premier nom
local RRGD = table.concat({
  "RRG;1;g1;1791000000;Les Veilleurs",
  "R;r1;1791100000;Faille de Sporefall;heroic;20;present;Kaeldra-Hyjal;council",
  "N;saison;depuis le 05/11/2026;Tharok-Hyjal+Grumbar-Hyjal:5,Vex-Kael'Thas:2,Brumelune-Ysondre:0",
  "D;tharok-hyjal+Grumbar-Hyjal:2:1:1,Mordak-Ysondre:1:0:2,Abîmé:1:2,:1:1:1",
  "END;1",
}, "\n")
local gd = F.ParseRRG(RRGD)
local cd = gd and gd[1].counts
local th = cd and F.CountFor(cd, "Grumbar-Hyjal")
check(th and th.n == 5 and th.bis == 2 and th.up == 1 and th.ms == 1, "ligne D : BiS, Upgrade, MS de l'entrée N (même premier nom)")
local vx = cd and F.CountFor(cd, "Vex-Kael'Thas")
check(vx and vx.n == 2 and vx.bis == 0 and vx.up == 0 and vx.ms == 0, "entrée N sans D : 0")
local mo = cd and F.CountFor(cd, "Mordak-Ysondre")
check(mo and mo.n == 3 and mo.bis == 1 and mo.ms == 2 and #cd.entries == 4, "ligne D sans entrée N : entrée créée, total = somme ; entrées abîmées ignorées")
local before = F.ParseRRG("RRG;1;g;0;G\nD;A-Hyjal:1:2:3\nN;saison;depuis;A-Hyjal:9\nEND;0")
check(before and F.CountFor(before[1].counts, "A-Hyjal").n == 9 and F.CountFor(before[1].counts, "A-Hyjal").up == 2, "ligne D avant N : rattachée quand même")
local onlyD = F.ParseRRG("RRG;1;g;0;G\nEND;0\nD;A-Hyjal:1:0:0")
check(onlyD and F.CountFor(onlyD[1].counts, "A-Hyjal").n == 1, "ligne D seule, après END")
local plain = { entries = { { names = { "A-Hyjal" }, n = 2 } } }
check(F.CountFor(plain, "A-Hyjal").bis == 0 and F.CountFor(plain, "A-Hyjal").ms == 0, "CountFor : 0 si absents (raid d'essai)")

-- RRR v1 : compo d'un raid
local RRR = table.concat({
  "RRR;1;4a1e43ea-54e8-4b49-888f-5e19b5754f61;1794513600;Faille de Sporefall;heroic;20",
  "M;Tharok-Hyjal;WARRIOR;Tank;Protection;1;1;present;site",
  "M;Brumelune-Ysondre;DRUID;Heal;Restoration;1;2;late;site",
  "M;Vex-Kael'Thas;DEMONHUNTER;DPS;Devourer;2;1;present;site",
  "M;Orvane-Hyjal;EVOKER;DPS;Augmentation;0;0;bench;site",
  "M;Petit Pois;;;;0;0;tentative;discord",
  "END;5",
}, "\n")
local raid, members = F.ParseRRR(RRR)
check(raid and raid.name == "Faille de Sporefall" and raid.time == 1794513600 and raid.difficulty == "heroic" and raid.size == 20, "en-tête RRR")
check(members and #members == 5 and members[1].name == "Tharok-Hyjal" and members[1].class == "WARRIOR" and members[1].group == 1, "membres RRR")
check(members and members[3].class == "DEMONHUNTER" and members[3].spec == "Devourer" and members[3].name == "Vex-Kael'Thas", "classe et spé de Retail")
check(members and members[4].status == "bench" and members[4].group == 0 and members[5].source == "discord" and members[5].name == "Petit Pois", "banc et inscrit Discord")
local r2, e2 = F.ParseRRR("RRR;1;x;0;Raid;normal;20\nM;A-Hyjal;MAGE;DPS;Frost;1;1;present;site\nEND;2")
check(r2 == nil and e2:find("incomplet"), "compo tronquée détectée")
local r3, e3 = F.ParseRRR("RRR;2;x;0;Raid;normal;20\nEND;0")
check(r3 == nil and e3:find("mets l'addon à jour"), "version de compo plus récente refusée")
check(F.ParseRRR("M;A;MAGE;DPS;Frost;1;1;present;site\nEND;1") == nil, "compo sans en-tête refusée")

-- Reconnaissance des textes : Roster, et Forever Roster (refusé par l'addon Roster)
check(F.Kind(RRG) == "RRG" and F.Kind(RRR) == "RRR" and F.Kind("  \nRRB;1;x") == "RRB", "textes de Roster reconnus")
check(F.IsForever("FRG;1;g;0;G\nEND;0") and F.IsForever("FRR;1;x;0;Raid\nEND;0") and F.IsForever("FRC;2;A;B\nEND;0") and F.IsForever("FRB;2;x\nEND;0"), "textes de Forever reconnus")
check(not F.IsForever(RRG) and F.Kind("bonjour") == nil, "autres textes")

-- Butin vu dans le chat : textes du jeu en français et en anglais, lien d'objet de Retail (|cnIQ4:)
local fr = F.LootParser({ LOOT_ITEM = "%s reçoit le butin : %s.", LOOT_ITEM_MULTIPLE = "%s reçoit le butin : %sx%d.",
  LOOT_ITEM_SELF = "Vous recevez le butin : %s.", LOOT_ITEM_SELF_MULTIPLE = "Vous recevez le butin : %sx%d." })
local who, id, q = fr("Tharok-Hyjal reçoit le butin : |cnIQ4:|Hitem:242394::::::::90:::::|h[Lame de Sporefall]|h|r.")
check(who == "Tharok-Hyjal" and id == 242394 and q == 4, "butin d'un autre (français)")
local w2, id2, q2, m2 = fr("Vous recevez le butin : |cffa335ee|Hitem:242395::::::::90:::::|h[Anneau]|h|rx2.")
check(w2 == nil and id2 == 242395 and q2 == 4 and m2, "mon butin (plusieurs exemplaires)")
check(select(4, fr("Tharok a choisi Besoin pour : |cnIQ4:|Hitem:1|h[X]|h|r")) == false, "jet de butin : pas un objet reçu")
local en = F.LootParser({})
check(en("Brumelune-Ysondre receives loot: |cnIQ3|Hitem:5|h[Bleu]|h|r.") == "Brumelune-Ysondre", "butin en anglais (textes par défaut)")
check(select(3, en("Brumelune-Ysondre receives loot: |cnIQ3|Hitem:5|h[Bleu]|h|r.")) == 3, "qualité d'un lien |cnIQ3")

-- Distribution du butin (R3b) : jets lus dans le chat, minuteur d'échange de l'infobulle, liens d'objets, objets portés
local frRoll = F.RollParser("%s obtient un %d (%d-%d).")
local rn, rr, rlo, rhi = frRoll("Tharok obtient un 87 (1-100).")
check(rn == "Tharok-Hyjal" and rr == 87 and rlo == 1 and rhi == 100, "jet en français (royaume du joueur ajouté)")
check(frRoll("Vex-Kael'Thas obtient un 12 (1-99).") == "Vex-Kael'Thas" and select(4, frRoll("Vex-Kael'Thas obtient un 12 (1-99).")) == 99, "jet d'un autre royaume, dé 99")
check(frRoll("Tharok obtient un 87 (1-100)") == nil and frRoll("Vous recevez le butin : [X].") == nil and frRoll(nil) == nil, "autres messages : pas un jet")
local enRoll = F.RollParser(nil)
check(enRoll("Brumelune-Ysondre rolls 54 (1-100)") == "Brumelune-Ysondre", "jet en anglais (texte par défaut)")
check(F.RollParser("%1$s würfelt. Ergebnis: %2$d (%3$d-%4$d)")("Nyx würfelt. Ergebnis: 5 (1-100)") == "Nyx-Hyjal", "texte du jeu à positions")
local frTrade = F.TradeTimeParser("Vous pouvez échanger cet objet avec les joueurs qui pouvaient aussi le ramasser pendant encore %s.")
check(frTrade("Vous pouvez échanger cet objet avec les joueurs qui pouvaient aussi le ramasser pendant encore 1 h 58 min.") == 7080, "délai d'échange (français)")
check(frTrade("|cff00ccffVous pouvez échanger cet objet avec les joueurs qui pouvaient aussi le ramasser pendant encore 45 min.|r") == 2700, "délai d'échange coloré")
check(frTrade("Lié quand ramassé") == nil and frTrade(nil) == nil, "autre ligne de l'infobulle")
local enTrade = F.TradeTimeParser(nil)
check(enTrade("You may trade this item with players that were also eligible to loot this item for the next 1 hr 12 min.") == 4320, "délai d'échange (anglais)")
check(F.ParseDuration("2 Std. 3 Min.") == 7380 and F.ParseDuration("30 sec") == 30 and F.ParseDuration("bientôt") == nil, "durées du jeu")
check(F.Duration(7080) == "1 h 58 min" and F.Duration(2700) == "45 min" and F.Duration(30) == "moins d'une minute", "durée affichée")
local lame = "|cnIQ4:|Hitem:242394::::::::90:::::1:6652|h[Lame de Sporefall]|h|r"
check(F.ItemString(lame) == "item:242394::::::::90:::::1:6652" and F.ItemId(lame) == 242394 and F.ItemName(lame) == "Lame de Sporefall", "lien d'objet de Retail")
check(F.ItemString("item:5::::") == "item:5::::" and F.ItemString("[Faux]") == nil and F.ItemId(nil) == nil, "chaîne d'objet")
local gear = F.Gear("242394:639,242111:636,1:2")
check(#gear == 2 and gear[1].id == 242394 and gear[1].ilvl == 639 and gear[2].id == 242111, "objets portés (deux au plus)")
check(F.GearText(gear) == "242394:639,242111:636" and F.GearText({}) == "" and #F.Gear("") == 0, "objets portés : texte")
check(F.cut("Brumélune", 5) == "Brum" and F.cut("Brumélune", 6) == "Brumé" and F.cut("abc", 10) == "abc", "texte coupé sans casser un accent")

-- RRB v1 : bilan d'un raid (contenu fixe, relu par le test du site). R3b : un objet donné au conseil, un aux jets MS,
-- un du butin de groupe sans méthode
local rrb = F.BuildRRB({
  raidId = "4a1e43ea-54e8-4b49-888f-5e19b5754f61", start = 1794513000, stop = 1794524400, recorder = "Kaeldra-Hyjal",
  name = "Faille de Sporefall", instance = "Faille de Sporefall", lead = true, difficulty = "heroic",
  people = {
    ["Kaeldra-Hyjal"] = { first = 1794513000, last = 1794524400, n = 191 },
    ["Tharok-Hyjal"] = { first = 1794513000, last = 1794524400, n = 191 },
    ["Brumelune-Ysondre"] = { first = 1794515400, last = 1794524400, n = 151 },
    ["Vex-Kael'Thas"] = { first = 1794513000, last = 1794519600, n = 111 },
  },
  loot = {
    { id = 242394, who = "Tharok-Hyjal", at = 1794516000, boss = "Gardienne des spores", method = "council", response = "bis", detail = "3 votes",
      name = "Jambières de l'Étreinte toxique", awarded = true },
    { id = 242395, who = "Vex-Kael'Thas", at = 1794519000, boss = "", method = "roll", response = "", detail = "MS 87", name = "Anneau des spores", awarded = true },
    { id = 242396, who = "Brumelune-Ysondre", at = 1794520000, boss = "Kith'ix" },
  },
  encounters = {
    { id = 3176, name = "Gardienne des spores", at = 1794515900, success = true },
    { id = 3177, name = "Kith'ix", at = 1794522000, success = false },
  },
})
local expected = table.concat({
  "RRB;1;4a1e43ea-54e8-4b49-888f-5e19b5754f61;1794513000;1794524400;Kaeldra-Hyjal;Faille de Sporefall;Faille de Sporefall;1;heroic",
  "A;Brumelune-Ysondre;1794515400;1794524400;151",
  "A;Kaeldra-Hyjal;1794513000;1794524400;191",
  "A;Tharok-Hyjal;1794513000;1794524400;191",
  "A;Vex-Kael'Thas;1794513000;1794519600;111",
  "L;242394;Tharok-Hyjal;1794516000;Gardienne des spores;council;bis;3 votes;Jambières de l'Étreinte toxique",
  "L;242395;Vex-Kael'Thas;1794519000;;roll;;MS 87;Anneau des spores",
  "L;242396;Brumelune-Ysondre;1794520000;Kith'ix;;;;",
  "E;3176;Gardienne des spores;1794515900;1",
  "E;3177;Kith'ix;1794522000;0",
  "END;9",
}, "\n")
check(rrb == expected, "bilan RRB :\n" .. rrb)
check(F.BuildRRB({ raidId = "x;|y", name = "a\nb", people = {}, loot = {}, encounters = {} }):match("^RRB;1;x  y;0;0;;a b;;0;\nEND;0$"), "« ; », « | » et retours à la ligne retirés")
local out = io.open("addon/tests/sample.rrb", "w") out:write(rrb) out:close()

-- Textes écrits par le test du site (même spécification), s'ils sont là
local function read(path) local f = io.open(path) if not f then return nil end local t = f:read("*a") f:close() return t end
local siteRRG = read("addon/tests/sample.rrg")
if siteRRG then
  local list, e = F.ParseRRG(siteRRG)
  check(list and #list >= 1, "sample.rrg du site lu : " .. tostring(e))
  for _, grp in ipairs(list or {}) do
    for _, r in ipairs(grp.raids) do check(r.id ~= "" and r.name ~= "", "raid du site complet") end
    -- Lot R3b : conseil (O, L) et objets reçus (N) en noms « Prénom-Royaume »
    local function full(n) return n:find("^[^%-]+%-.+$") ~= nil end
    for _, n in ipairs(grp.officers or {}) do check(full(n), "officier Prénom-Royaume : " .. n) end
    for raidId, l in pairs(grp.council or {}) do for _, n in ipairs(l) do check(full(n), "conseil du raid " .. raidId .. " : " .. n) end end
    -- (addon 0.3 : les entrées de la ligne D sans entrée N sont ajoutées à la liste, mêmes noms « Prénom-Royaume »)
    for _, e in ipairs(grp.counts and grp.counts.entries or {}) do
      for _, n in ipairs(e.names) do check(full(n), "objets reçus : " .. n) end
      check(type(e.bis) == "number" and type(e.up) == "number" and type(e.ms) == "number", "détail des objets reçus : " .. e.names[1])
    end
    -- Ligne D du site : rattachée à l'entrée N du même joueur (persos joints par « + »)
    local k = F.CountFor(grp.counts, "Vex-Kael'Thas")
    if k then check(k.n >= k.bis + k.up + k.ms and k.bis + k.up + k.ms > 0, "ligne D de sample.rrg rattachée au joueur (Kaeldra + Vex)") end
  end
end
local siteRRR = read("addon/tests/sample.rrr")
if siteRRR then
  local rr, mm = F.ParseRRR(siteRRR)
  check(rr ~= nil, "sample.rrr du site lu : " .. tostring(mm))
  for _, m in ipairs(rr and mm or {}) do check(m.source == "discord" or m.name:find("^[^%-]+%-.+$"), "nom Prénom-Royaume : " .. m.name) end
end

if failures > 0 then os.exit(1) end
print("roster_format_test : tout est bon" .. ((siteRRG or siteRRR) and " (textes du site relus)" or ""))
