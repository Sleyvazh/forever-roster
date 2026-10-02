-- Tests hors jeu des formats d'échange : lua5.1 addon/tests/format_test.lua (depuis la racine du dépôt)
local F = assert(loadfile("addon/ForeverRoster/Format.lua"))("ForeverRoster", {})
local failures = 0
local function check(cond, msg) if not cond then failures = failures + 1 print("ÉCHEC : " .. msg) end end

-- FRR : export de compo du site
local raid, members = F.ParseFRR("FRR;1;4a1e;1794513600;Molten Core\r\nM;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site\nM;Bob;PRIEST;Heal;Holy Heal;0;0;tentative;discord\nEND;2\n")
check(raid and raid.name == "Molten Core" and raid.time == 1794513600, "en-tête FRR")
check(members and #members == 2 and members[1].group == 1 and members[2].source == "discord", "membres FRR")
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
  {
    { "G", 1, 16866 }, { "G", 7, 15065 },
    { "P", "Leatherworking", 300, 300 }, { "P", "Skinning", 295, 300 }, { "P", "Cooking", 150, 225 }, { "P", "Unarmed", 300, 300 },
    { "R", "Leatherworking", "s2152" }, { "R", "Leatherworking", "i15065" },
    { "T", 104938, 5, 5, 5620, 2130, 16934, 0, 1089 }, { "T", 104939, 3, 5, 6220, 2130, 24894, 0, 1089 },
    { "G", 13, "piège;|cff" },
  })
check(text:match("^FRC;1;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;0%.1%.0\n"), "en-tête FRC")
check(text:match("\nEND;11$"), "ligne END")
check(text:find("piège  cff", 1, true), "« ; » et « | » retirés des valeurs")
local out = io.open("addon/tests/sample.frc", "w") out:write(text) out:close()

if failures > 0 then os.exit(1) end
print("format_test : tout est bon")
