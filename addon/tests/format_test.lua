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
-- Partage entre joueurs : lignes M (persos du groupe, prénoms) et Z (signature du site) avant END, hors du compte ; un
-- bloc signé garde son texte (lignes de l'en-tête à END) pour être relayé ; un bloc sans Z (soft reserve cachée, ancien
-- site) n'en garde pas : il ne se partage pas
local SIGNED = table.concat({
  "FRG;1;g1;1791000000;Les Veilleurs",
  "R;r1;1791100000;Molten Core;present;Greta;softres",
  "B;16866;Thalwen",
  "S;r1;18814;Greta:10",
  "M;Brindille,Greta, Thalwen",
  "Z;a3de5db8;c2lnbmF0dXJl",
  "END;2",
  "après END : ignoré",
  "FRG;1;g2;1791000000;Soft reserve cachée",
  "R;r2;0;Onyxia;;;softres",
  "M;Greta",
  "END;1",
}, "\r\n")
local sg = F.ParseFRG(SIGNED)
check(sg and #sg == 2 and #sg[1].raids == 1 and sg[1].raids[1].status == "present" and sg[1].raids[1].char == "Greta", "bloc signé lu (M et Z hors du compte de END)")
check(sg and #sg[1].members == 3 and sg[1].members[1] == "Brindille" and sg[1].sig and sg[1].sig.key == "a3de5db8", "lignes M et Z")
check(sg and sg[1].text == table.concat({ "FRG;1;g1;1791000000;Les Veilleurs", "R;r1;1791100000;Molten Core;present;Greta;softres", "B;16866;Thalwen",
  "S;r1;18814;Greta:10", "M;Brindille,Greta, Thalwen", "Z;a3de5db8;c2lnbmF0dXJl", "END;2" }, "\n"), "texte du bloc signé gardé, sans ce qui suit END")
check(sg and sg[2].text == nil and sg[2].sig == nil and #sg[2].members == 1, "bloc sans signature : pas de texte gardé")
local many = {}
for i = 1, 120 do many[i] = "Perso" .. i end
local big = F.ParseFRG("FRG;1;g;1;G\nM;" .. table.concat(many, ",") .. "\nEND;0")
check(big and #big[1].members == 120, "ligne M : plus de 40 persos")

-- sample.frg écrit par le test du site (packages/game-data/src/share.test.ts), signé avec la clé de test : signature
-- valide sur le texte canonique calculé par Share.lua (même règle que le site), fausse si le texte change, et les champs
-- personnels (5 et 6 des lignes R) hors de la signature
local function read(path) local f = io.open(path) if not f then return nil end local t = f:read("*a") f:close() return t end
local SNS = {}
for _, path in ipairs({ "addon/shared/Crypto.lua", "addon/shared/SiteKey.lua", "addon/tests/fixtures/SiteKeyTest.lua", "addon/shared/Share.lua" }) do
  assert(loadfile(path))("ForeverRoster", SNS)
end
local verified = 0
local siteFRG = read("addon/tests/sample.frg")
if siteFRG then
  local list, e = F.ParseFRG(siteFRG)
  check(list and #list >= 1, "sample.frg du site lu : " .. tostring(e))
  for _, grp in ipairs(list or {}) do
    check(grp.members and #grp.members >= 1, "persos du groupe (M) : " .. grp.id)
    for _, n in ipairs(grp.members or {}) do check(not n:find("[%-%s]"), "prénoms seuls dans M : " .. n) end
    if grp.text and SNS.Crypto and SNS.Crypto.VerifyRSA then
      local ok, why = SNS.Share.Verify(grp.text, "FRG")
      check(ok, "signature du site de sample.frg (" .. grp.id .. ") : " .. tostring(why))
      check(not SNS.Share.Verify(grp.text:gsub("\nR;", "\nR;x", 1), "FRG"), "sample.frg modifié : signature refusée")
      local mine = grp.text:gsub("(\nR;[^;\n]*;[^;\n]*;[^;\n]*;)[^;\n]*;[^;\n]*;", "%1absent;Autre;")
      check(mine ~= grp.text and SNS.Share.Verify(mine, "FRG"), "sample.frg : champs personnels hors de la signature")
      verified = verified + 1
    end
  end
end

-- FRL v1 (relève de la guilde, 1.6.0, en essai) : chaque partie, échappement, notes d'officier, forme stable, parties absentes
local function frlData()
  return {
    name = "Les;Veilleurs|", faction = "Horde", realm = "Forever EU", addon = "1.6.0",
    roster = { at = 1790000000, by = "Tournicoti", officer = true, rank = "Officier", rankIndex = 1, total = 3, members = {
      { name = "Greta Coulé", key = "greta", class = "DRUID", level = 60, rank = "Officier", rankIndex = 1, online = true, hours = 0,
        note = "Main;|cffff0000rouge\nligne", onote = "fiable", guid = "Player-1-0A" },
      { name = "Bob", key = "bob", class = "MAGE", level = 12, rank = "Recrue", rankIndex = 4, hours = 50, note = "", onote = "", guid = "Player-1-0B" },
      { name = "Zed", key = "zed", class = "ROGUE", level = 30, rank = "Membre", rankIndex = 3, note = "", onote = "" }, -- dernière connexion et guid inconnus
    } },
    events = { at = 1790000000, by = "Tournicoti", total = 2, list = { { type = "promote", p1 = "Tournicoti", p2 = "Greta Coulé", rank = 1, hours = 3 },
      { type = "join", p1 = "Bob", p2 = "", hours = 30 } } },
    bank = { at = 1790000100, by = "Tournicoti", money = 1234567, ntabs = 3,
      tabs = { { name = "Conso", visible = true, read = true }, { name = "Compos;", visible = true, read = true }, { name = "Officiers" } },
      items = { { tab = 1, slot = 1, id = 13457, n = 5 }, { tab = 2, slot = 5, id = 7078, n = 20 } },
      log = { { tab = 1, type = "deposit", who = "Bob", id = 13457, n = 5, hours = 2 }, { tab = 2, type = "move", who = "Greta Coulé", id = 7078, n = 20, tab1 = 1, tab2 = 2, hours = 4 } },
      moneyLog = { { type = "deposit", who = "Tournicoti", amount = 500000, hours = 1 } } },
    chars = { { name = "Tournicoti", xp = { level = 41, xp = 1234, max = 8000, at = 1790000050 }, levels = { [41] = 1789990000, [40] = 1789900000 } } },
  }
end
local frl = F.BuildFRL(frlData())
check(frl:match("^FRL;1;Les Veilleurs ;Horde;1790000000;Tournicoti;1;Officier;3;Forever EU;1%.6%.0\n"), "en-tête FRL : « ; » et « | » retirés")
check(frl:find("\nM;Greta Coulé;DRUID;60;Officier;1;1;0;Main  cffff0000rouge ligne;fiable;Player-1-0A\n", 1, true), "membre : note échappée, note d'officier")
check(frl:find("\nM;Bob;MAGE;12;Recrue;4;0;50;;;Player-1-0B\n", 1, true) and frl:find("\nM;Zed;ROGUE;30;Membre;3;0;;;;\n", 1, true), "membres : hors ligne, champs inconnus vides")
check(frl:find("\nJ;1790000000;Tournicoti\nE;promote;Tournicoti;Greta Coulé;1;3\nE;join;Bob;;;30\n", 1, true), "journal de guilde")
check(frl:find("\nB;1790000100;Tournicoti;1234567;3\nT;1;Conso;1;1\nT;2;Compos ;1;1\nT;3;Officiers;0;0\nI;1;1;13457;5\nI;2;5;7078;20\n", 1, true), "banque : onglets lus et non visible, objets")
check(frl:find("\nX;1;deposit;Bob;13457;5;;;2\nX;2;move;Greta Coulé;7078;20;1;2;4\nO;deposit;Tournicoti;500000;1\n", 1, true), "journaux de la banque")
check(frl:find("\nP;Tournicoti;41;1234;8000;1790000050\nU;Tournicoti;40;1789900000\nU;Tournicoti;41;1789990000\nEND;18$"), "XP, niveaux (dans l'ordre) et END qui compte les lignes")
check(not frl:find("|", 1, true) and select(2, frl:gsub("\n", "")) == 19, "aucun « | », une ligne par information")
-- Notes d'officier : jamais sans le droit de les voir, même présentes dans les données
local hidden = frlData()
hidden.roster.officer = false
check(F.BuildFRL(hidden):find("\nM;Greta Coulé;DRUID;60;Officier;1;1;0;Main  cffff0000rouge ligne;;Player-1-0A\n", 1, true)
  and F.BuildFRL(hidden):match("^FRL;1;[^\n]*;Tournicoti;0;"), "notes d'officier non visibles : vides")
-- Forme stable : relue 30 min plus tard par un autre, Greta déconnectée depuis, XP dans le même dixième, addon mis à jour :
-- même empreinte ; un vrai changement (niveau, objet de la banque) en donne une autre
local later = frlData()
later.addon, later.roster.at, later.roster.by, later.roster.rank = "1.6.1", 1790001800, "Greta", "Maître"
later.roster.members[1].online, later.roster.members[2].hours = nil, 50
later.events.at, later.events.list[1].hours, later.bank.at, later.bank.by = 1790001800, 4, 1790001900, "Greta"
later.bank.log[1].hours, later.chars[1].xp = 3, { level = 41, xp = 1500, max = 8000, at = 1790001850 }
local s1, s2 = F.BuildFRL(frlData(), true), F.BuildFRL(later, true)
check(s1 == s2 and F.BuildFRL(later) ~= frl, "forme stable : même empreinte quand seul le temps a passé")
check(s1:match("^FRL;1;Les Veilleurs ;Horde;;;1;;3;Forever EU;\n") and s1:find("\nP;Tournicoti;41;1;;\n", 1, true) and s1:find("\nE;promote;Tournicoti;Greta Coulé;1;\n", 1, true), "forme stable : valeurs mouvantes vides")
later.roster.members[2].level = 13
check(F.BuildFRL(later, true) ~= s1, "forme stable : un niveau change l'empreinte")
later.roster.members[2].level = 12
later.bank.items[1].n = 4
check(F.BuildFRL(later, true) ~= s1, "forme stable : la banque change l'empreinte")
-- Parties absentes : pas de lignes, END;0 ; liste seule : ni journal, ni banque, ni XP
check(F.BuildFRL({ name = "Solo" }) == "FRL;1;Solo;;0;;0;;0;;\nEND;0", "relevé vide")
local only = frlData()
only.events, only.bank, only.chars = nil, nil, nil
local onlyText = F.BuildFRL(only)
check(not onlyText:find("\n[JEBTIXOPU];") and onlyText:match("\nEND;3$"), "liste seule")

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
print("format_test : tout est bon" .. (verified > 0 and (" ; signature du site vérifiée (" .. verified .. " groupes de sample.frg)") or ""))
