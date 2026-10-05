-- Tests hors jeu des formats d'échange : lua5.1 addon/tests/format_test.lua (depuis la racine du dépôt)
local F = assert(loadfile("addon/ForeverRoster/Format.lua"))("ForeverRoster", {})
local failures = 0
local function check(cond, msg) if not cond then failures = failures + 1 print("ÉCHEC : " .. msg) end end

-- FRR : export de compo du site
local raid, members = F.ParseFRR("FRR;1;4a1e;1794513600;Molten Core\r\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nM;Bob;PRIEST;Heal;Holy Heal;0;0;tentative;discord\nEND;2\n")
check(raid and raid.name == "Molten Core" and raid.time == 1794513600, "en-tête FRR")
check(members and #members == 2 and members[1].group == 1 and members[2].source == "discord", "membres FRR")
-- Données des groupes (FRG v1) : un ou plusieurs groupes à la suite
local gs = F.ParseFRG("FRG;1;6f1c2a10-0000-4000-8000-000000000001;1791000000;Les Veilleurs\nR;7a1c2a10-0000-4000-8000-000000000002;1791100000;Molten Core;present;Greta\nR;8a1c2a10-0000-4000-8000-000000000003;0;Onyxia;;\nP;15090;Warbear Woolies;Greta,Sley;Tournicoti\nB;16866;Greta\nEND;4\nFRG;1;g2;1791000000;Autre\nP;15090;Warbear Woolies;Bob;\nEND;1")
local g = gs and gs[1]
check(gs and #gs == 2 and gs[2].name == "Autre", "deux groupes")
check(g and g.name == "Les Veilleurs" and #g.raids == 2, "groupe et raids")
check(g and g.raids[1].status == "present" and g.raids[1].char == "Greta" and g.raids[2].status == nil, "inscription du site")
check(g and g.patterns[15090] and #g.patterns[15090].wanted == 2 and g.patterns[15090].known[1] == "Tournicoti", "patrons suivis")
check(g and g.bis[16866] and g.bis[16866][1] == "Greta", "BiS recherchés")
check(not F.ParseFRG("FRG;1;x;0;G\nR;a;0;b;;\nEND;2"), "FRG tronqué refusé")
check(not F.ParseFRG("FRG;1;x;0;G\nEND;0\nFRG;1;y;0;H\nP;1;r;;\nEND;3"), "second groupe tronqué refusé")
check(not F.ParseFRG("FRR;1;x;0;Raid\nEND;0"), "une compo n'est pas un groupe")
-- Texte venu du site : les codes du jeu (« | » : couleurs, liens, textures) sont retirés
local evil = F.ParseFRG("FRG;1;g;0;|cffff0000Rouge|r |TInterface\\Icons\\X:0|t\nP;1;|Hitem:1|h[Faux]|h;Bob|r,Al;\nEND;1")
check(evil and not evil[1].name:find("|", 1, true) and not evil[1].patterns[1].recipe:find("|", 1, true) and evil[1].patterns[1].wanted[1] == "Bobr", "codes du jeu retirés")
local _, evilM = F.ParseFRR("FRR;1;x;0;Raid\nM;|cffffffffBob;DRUID;Tank;Feral Bear;1;1;present;site\nEND;1")
check(evilM and evilM[1].name == "cffffffffBob", "nom sans code du jeu")
local r3, m3 = F.ParseFRR("FRR;1;x;0;Raid\nM;Greta Coulé;DRUID;DPS;Feral Cat;1;1;present;site\nEND;1")
check(r3 and m3[1].name == "Greta", "nom de famille retiré pour le jeu")
local r2, err = F.ParseFRR("FRR;1;x;0;Raid\nM;A;MAGE;DPS;Frost;1;1;present;site\nEND;2")
check(r2 == nil and err:find("incomplet"), "export tronqué détecté")
local r3, err3 = F.ParseFRR("FRR;2;x;0;Raid\nEND;0")
check(r3 == nil and err3:find("Version"), "version inconnue refusée")
local r4 = F.ParseFRR("M;A;MAGE;DPS;Frost;1;1;present;site")
check(r4 == nil, "texte sans en-tête refusé")
local r5, m5 = F.ParseFRR("FRR;1;x;0;Raid vide\nEND;0")
check(r5 and #m5 == 0, "raid sans membre")

-- FRC : export du perso (sert aussi de jeu d'essai au test du site)
local text = F.BuildFRC(
  { name = "Tournicoti", realm = "Forever EU", class = "DRUID", race = "Tauren", level = 60, faction = "Horde", time = 1790000000, addon = "0.1.0" },
  F.Compact({
    { "G", 1, 16866 }, { "G", 7, 15065 },
    { "P", "Leatherworking", 300, 300 }, { "P", "Skinning", 295, 300 }, { "P", "Cooking", 150, 225 }, { "P", "Unarmed", 300, 300 },
    { "R", "Leatherworking", "s2152" }, { "R", "Leatherworking", "i15065" },
    { "T", 104938, 5, 5, 5620, 2130, 16934, 0, 1089 }, { "T", 104939, 3, 5, 6220, 2130, 24894, 0, 1089 },
    { "T", 104940, 0, 3, 5620, 2730, 16947, 0, 1089 },
    { "G", 13, "piège;|cff" },
  }))
check(text:match("^FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;0%.1%.0\n"), "en-tête FRC")
check(text:find("\nG;1:16866,7:15065,13:piège  cff\n", 1, true), "équipement sur une ligne")
check(text:find("\nR;Leatherworking;i15065,s2152\n", 1, true), "patrons regroupés par métier")
check(text:find("\nT;1089;104938:5,104939:3\n", 1, true), "seulement les talents pris")
check(text:match("\nEND;7$"), "ligne END")
check(text:find("piège  cff", 1, true), "« ; » et « | » retirés des valeurs")
local out = io.open("addon/tests/sample.frc", "w") out:write(text) out:close()

-- Lot G : lignes hors du compte de END (réservations, officiers, consommables, fiches de boss, conseil, inscrits)
local lg = F.ParseFRG("FRG;1;g;1;G\nR;r1;2;Molten Core;;;council\nS;r1;19865;Gorrak:20,Vesper:0\nO;Thalwen,Brunehilde\nC;r1;13457;5;all;Fire Prot\nF;r1;1;672;11502,11503;Ragnaros\nT;r1;1;Tank principal;Grumdal;\nT;r1;1;Fils;;Groupes 3 et 4\nT;r9;1;Orpheline;;\nL;r1;Thalwen\nI;r1;Gorrak;DPS;melee\nEND;1")
local x = lg and lg[1]
check(x and x.raids[1].loot == "council", "mode de butin du raid")
check(x and x.reserves.r1[19865][1].name == "Gorrak" and x.reserves.r1[19865][1].bonus == 20 and x.reserves.r1[19865][2].bonus == 0, "réservations avec bonus")
check(x and x.officers[2] == "Brunehilde" and x.council.r1[1] == "Thalwen", "officiers et conseil du raid")
check(x and x.consumables.r1[1].itemId == 13457 and x.consumables.r1[1].n == 5 and x.consumables.r1[1].target == "all", "consommables")
check(x and x.bosses.r1[1].encounterId == 672 and x.bosses.r1[1].npcIds[2] == 11503 and #x.bosses.r1[1].rows == 2 and x.bosses.r1[1].rows[1].names[1] == "Grumdal", "fiche de boss")
check(x and x.roster.r1.Gorrak.role == "DPS" and F.Concerns("melee", x.roster.r1.Gorrak) and not F.Concerns("tank", x.roster.r1.Gorrak) and F.Concerns("all", nil), "inscrits et consommables concernés")
-- Jets de dés lus d'après le texte du jeu, en français, en anglais ou positionnel
local fr = F.RollParser("%s obtient un %d (%d-%d).")
local n1, r1, lo1, hi1 = fr("Gorrak obtient un 61 (1-100).")
check(n1 == "Gorrak" and r1 == 61 and lo1 == 1 and hi1 == 100, "jet en français")
check(fr("Gorrak dit : obtient un 61 (1-100)") == nil, "un message de chat n'est pas un jet")
local n2, r2, _, hi2 = F.RollParser("%s rolls %d (%d-%d)")("Vesper-Forever EU rolls 78 (1-99)")
check(n2 == "Vesper" and r2 == 78 and hi2 == 99, "jet en anglais, royaume retiré")
local n3, r3b = F.RollParser("%1$s würfelt. Ergebnis: %2$d (%3$d-%4$d)")("Nyx würfelt. Ergebnis: 5 (1-100)")
check(n3 == "Nyx" and r3b == 5, "jet positionnel")

if failures > 0 then os.exit(1) end
print("format_test : tout est bon")
