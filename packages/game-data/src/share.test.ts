import { describe, expect, it } from "vitest";
import { groupAddonExport, type GroupExportRaid } from "./addon";
import { buildRRG, type RosterGroupRaid } from "./roster-addon";
import { canonicalGroupBlock, groupBlockSignature, sealGroupBlock, splitGroupBlocks, type GroupBlockSigner } from "./share";
import { TEST_KEY_ID, testSigner, verifyWithTestKey } from "./test-signer";

/**
 * Partage entre joueurs (signature du site) : lignes M et Z des blocs RRG et FRG, forme canonique signée.
 * Noms fictifs. L'exemple FRG signé (addon/tests/sample.frg) est écrit ici pour les tests Lua de l'addon.
 */

type Fs = { writeFileSync(p: URL, s: string): void };
const fs = () => import(/* @vite-ignore */ ["node", "fs"].join(":")) as Promise<Fs>;
const sample = (name: string) => new URL(`../../../addon/tests/${name}`, import.meta.url);

const G1 = { id: "4f1e2d3c-b4a5-4697-8a7b-6c5d4e3f2a1b", name: "Les Veilleurs" };
const G2 = { id: "5a2f3e4d-c5b6-47a8-9b8c-7d6e5f4a3b2c", name: "Les Retardataires" };
const R1 = "6b3a4f5e-d6c7-48b9-ac9d-8e7f6a5b4c3d", R2 = "7c4b5a6f-e7d8-49ca-bdae-9f8a7b6c5d4e";
const AT = 1_794_000_000;

/** FRG d'un joueur : `me` donne son inscription (statut, perso) à chaque raid. */
const frg = (me: [GroupExportRaid["status"], string | null][], sign?: GroupBlockSigner) =>
  groupAddonExport(G1, AT, [
    { id: R1, name: "Molten Core", at: AT + 86400, status: me[0]![0], character: me[0]![1], lootMode: "softres",
      reserves: [{ itemId: 18814, by: [{ name: "Greta Coulé", bonus: 10 }, { name: "Thalwen", bonus: 0 }] }] },
    { id: R2, name: "Onyxia", at: 0, status: me[1]![0], character: me[1]![1], lootMode: "council", council: ["Thalwen", "Brindille"] },
  ],
  [{ itemId: 15090, recipe: "Warbear Woolies", wanted: ["Greta Coulé"], known: ["Tournicoti"] }],
  [{ itemId: 16866, characters: ["Thalwen"] }],
  ["Thalwen"],
  { short: "saison", label: "depuis le 05/10/2026", entries: [{ names: ["Greta Coulé", "Brindille"], n: 2 }, { names: ["Thalwen"], n: 1 }] },
  { members: ["Thalwen", "Greta Coulé", "Brindille", "Tournicoti", "Greta Coulé"], sign });

const rrgRaid = (status: RosterGroupRaid["status"], character: RosterGroupRaid["character"]): RosterGroupRaid =>
  ({ id: R1, name: "Flèche du Vide", at: AT + 86400, difficulty: "heroic", size: 20, status, character, lootMode: "council" });
const rrg = (raid: RosterGroupRaid, sign?: GroupBlockSigner) => buildRRG(G1, AT, [raid], {
  council: [{ name: "Kaeldra", realm: "Hyjal" }],
  members: [{ name: "Tharok", realm: "Conseil des Ombres" }, { name: "Kaeldra", realm: "Hyjal" }, { name: "kaëldra", realm: "hyjal" }, { name: "Vex", realm: "Kael'Thas" }],
}, sign);

describe("ligne M : persos du groupe", () => {
  it("FRG : prénoms en jeu comme la ligne O (sans doublon, triés), après toutes les lignes, hors du compte de END", () => {
    const lines = frg([["present", "Greta Coulé"], [null, null]]).split("\n");
    expect(lines.slice(-2)).toEqual(["M;Brindille,Greta,Thalwen,Tournicoti", "END;4"]);
    // Ancien addon : END compte les lignes R, P et B seulement
    expect(lines.filter(l => /^[RPB];/.test(l)).length).toBe(4);
    expect(lines.indexOf("M;Brindille,Greta,Thalwen,Tournicoti")).toBe(lines.length - 2);
  });

  it("RRG : Prénom-Royaume comme la ligne O, après D, hors du compte de END", () => {
    const lines = rrg(rrgRaid("present", { name: "Kaeldra", realm: "Hyjal" })).split("\n");
    expect(lines.slice(1)).toEqual([
      `R;${R1};${AT + 86400};Flèche du Vide;heroic;20;present;Kaeldra-Hyjal;council`,
      "O;Kaeldra-Hyjal",
      "M;Kaeldra-Hyjal,Tharok-ConseildesOmbres,Vex-Kael'Thas",
      "END;1",
    ]);
  });

  it("toujours là, même vide et même sans signature", () => {
    expect(groupAddonExport(G2, 1, [], []).split("\n")).toEqual([`FRG;1;${G2.id};1;Les Retardataires`, "M;", "END;0"]);
    expect(buildRRG(G2, 1, []).split("\n")).toEqual([`RRG;1;${G2.id};1;Les Retardataires`, "M;", "END;0"]);
  });
});

describe("forme canonique (ce que le site signe)", () => {
  it("FRG : champs 5 et 6 des lignes R vidés (séparateurs gardés), sans Z ni END", async () => {
    const { sign } = await testSigner();
    const text = frg([["present", "Greta Coulé"], ["tentative", "Brindille"]], sign);
    const lines = text.split("\n");
    expect(lines.at(-2)).toMatch(/^Z;a3de5db8;[A-Za-z0-9+/]{342}==$/);
    const canonical = canonicalGroupBlock(text, "FRG");
    expect(canonical.split("\n")).toEqual(lines.slice(0, -2).map(l => l
      .replace(`;Molten Core;present;Greta;`, ";Molten Core;;;")
      .replace(";Onyxia;tentative;Brindille;", ";Onyxia;;;")));
    expect(canonical).toContain(`R;${R1};${AT + 86400};Molten Core;;;softres`);
    expect(canonical).not.toMatch(/\n(Z|END);|\n$/);
    // Déjà canonique : sa propre forme canonique
    expect(canonicalGroupBlock(canonical, "FRG")).toBe(canonical);
  });

  it("RRG : champs 7 et 8 des lignes R vidés", () => {
    const canonical = canonicalGroupBlock(rrg(rrgRaid("late", { name: "Tharok", realm: "Conseil des Ombres" })), "RRG");
    expect(canonical.split("\n")[1]).toBe(`R;${R1};${AT + 86400};Flèche du Vide;heroic;20;;;council`);
  });

  it("lignes nettoyées : « \\r », espaces et tabulations au bord, lignes vides ; le reste du texte ignoré", () => {
    const block = "RRG;1;g;5;G\nR;r;0;Raid;heroic;20;present;Kaeldra-Hyjal;journal\nO;Kaeldra-Hyjal\nM;Kaeldra-Hyjal\nZ;a3de5db8;QUJD\nEND;1";
    const messy = `bla\r\n  ${block.split("\n").join(" \t\r\n\r\n\t")}\r\nFRR;1;x;0;Raid\nEND;0`;
    expect(canonicalGroupBlock(messy, "RRG")).toBe("RRG;1;g;5;G\nR;r;0;Raid;heroic;20;;;journal\nO;Kaeldra-Hyjal\nM;Kaeldra-Hyjal");
    expect(canonicalGroupBlock(messy, "FRG")).toBe("");
    // Ligne R incomplète : seuls les champs présents sont vidés (le site écrit toujours tous les champs)
    expect(canonicalGroupBlock("FRG;1;g;5;G\nR;r;0;Raid;present\nEND;1", "FRG")).toBe("FRG;1;g;5;G\nR;r;0;Raid;");
  });

  it("deux joueurs aux inscriptions différentes : même forme canonique, même signature, vérifiée par Node", async () => {
    const { sign, keyId } = await testSigner();
    expect(keyId).toBe(TEST_KEY_ID);
    const a = frg([["present", "Greta Coulé"], [null, null]], sign), b = frg([["absent", "Thalwen"], ["late", "Thalwen"]], sign);
    expect(a).not.toBe(b);
    expect(canonicalGroupBlock(a, "FRG")).toBe(canonicalGroupBlock(b, "FRG"));
    const sa = groupBlockSignature(a), sb = groupBlockSignature(b);
    expect(sa).toEqual(sb);
    expect(sa!.keyId).toBe("a3de5db8");
    expect(await verifyWithTestKey(canonicalGroupBlock(a, "FRG"), sa!.signature)).toBe(true);
    // Une donnée du groupe changée (hors champs personnels) : la signature ne vaut plus
    expect(await verifyWithTestKey(canonicalGroupBlock(a.replace("Molten Core", "Molten Kore"), "FRG"), sa!.signature)).toBe(false);
    expect(await verifyWithTestKey(canonicalGroupBlock(a.replace("M;Brindille,", "M;Intrus,Brindille,"), "FRG"), sa!.signature)).toBe(false);

    const r1 = rrg(rrgRaid("present", { name: "Kaeldra", realm: "Hyjal" }), sign), r2 = rrg(rrgRaid(null, null), sign);
    expect(groupBlockSignature(r1)).toEqual(groupBlockSignature(r2));
    expect(await verifyWithTestKey(canonicalGroupBlock(r2, "RRG"), groupBlockSignature(r1)!.signature)).toBe(true);
  });

  it("Z en dernier avant END ; sans signataire (ou signataire sans clé) : pas de Z ; signature mal formée refusée", async () => {
    const { sign } = await testSigner();
    const lines = rrg(rrgRaid(null, null), sign).split("\n");
    expect(lines.map(l => l.split(";")[0])).toEqual(["RRG", "R", "O", "M", "Z", "END"]);
    expect(lines.at(-1)).toBe("END;1");
    expect(rrg(rrgRaid(null, null), () => null)).toBe(rrg(rrgRaid(null, null)));
    expect(rrg(rrgRaid(null, null))).not.toMatch(/\nZ;/);
    expect(() => sealGroupBlock("FRG", ["FRG;1;g;1;G"], 0, () => ({ keyId: "a3de5db8", signature: "AB;C" }))).toThrow();
    expect(() => sealGroupBlock("FRG", ["FRG;1;g;1;G"], 0, () => ({ keyId: "A3DE5DB8", signature: "QUJD" }))).toThrow();
  });
});

describe("plusieurs blocs à la suite", () => {
  it("splitGroupBlocks : un bloc par groupe, de l'en-tête à END ; signature de chacun", async () => {
    const { sign } = await testSigner();
    const one = frg([["present", "Greta Coulé"], [null, null]], sign), two = groupAddonExport(G2, AT, [], [], [], [], undefined, { members: ["Brindille"], sign });
    const blocks = splitGroupBlocks(`${one}\r\n\r\n${two}\n`, "FRG");
    expect(blocks).toEqual([one, two]);
    expect(splitGroupBlocks(`${one}\n${two}`, "RRG")).toEqual([]);
    for (const b of blocks) expect(await verifyWithTestKey(canonicalGroupBlock(b, "FRG"), groupBlockSignature(b)!.signature)).toBe(true);
    expect(groupBlockSignature(groupAddonExport(G2, AT, [], []))).toBeNull();
  });
});

describe("exemple partagé avec les tests Lua de l'addon", () => {
  it("écrit addon/tests/sample.frg : deux groupes signés avec la clé de test du site (déterministe)", async () => {
    const { sign } = await testSigner();
    const two = groupAddonExport(G2, AT, [{ id: R2, name: "Onyxia", at: 0, status: null, character: null, lootMode: "journal" }], [], [], [], undefined, { members: ["Brindille", "Tournicoti"], sign });
    const text = `${frg([["present", "Greta Coulé"], ["late", "Thalwen"]], sign)}\n${two}\n`;
    (await fs()).writeFileSync(sample("sample.frg"), text);
    expect(splitGroupBlocks(text, "FRG").length).toBe(2);
  });
});
