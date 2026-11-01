import { describe, expect, it } from "vitest";
import { groupAddonExport, type GroupExportBank, type GroupExportBankRequest, type GroupExportOuting, type GroupExportRaid } from "./addon";
import { canonicalGroupBlock, groupBlockSignature, splitGroupBlocks, type GroupBlockSigner } from "./share";
import { TEST_KEY_ID, testSigner, verifyWithTestKey } from "./test-signer";

/**
 * Lignes Q (demandes de retrait en cours) et H (banquiers) du FRG, addon 1.6.4 : signées, hors du compte de END, les mêmes
 * pour tous les membres. Noms fictifs.
 */

const G = { id: "4f1e2d3c-b4a5-4697-8a7b-6c5d4e3f2a1b", name: "Les Lanternes" };
const R1 = "6b3a4f5e-d6c7-48b9-ac9d-8e7f6a5b4c3d";
const AT = 1_794_000_000;
const REQ = (n: number): GroupExportBankRequest => ({
  id: `0b5a1c2d-0000-4000-8000-${String(n).padStart(12, "0")}`, who: "Nessa Flotsombre", itemId: 2_000 + n, quantity: n, status: "pending", by: "",
});
const OUTING: GroupExportOuting = {
  id: "0f6c1d2e-0000-4000-8000-000000000001", at: AT + 3600, dungeon: "gnomeregan", title: "Gnomeregan", min: 29, max: 38, creator: "Pikou",
  places: { tank: 1, heal: 1, dps: 3 }, tanks: [{ name: "Bramm" }], heals: [], dps: [], waiting: [], note: "",
};

/** FRG d'un joueur : son inscription au raid (champs personnels des lignes R) change, le reste non. */
const frg = (bank: GroupExportBank | undefined, me: GroupExportRaid["status"] = null, outings: GroupExportOuting[] = [], sign?: GroupBlockSigner) =>
  groupAddonExport(G, AT, [{ id: R1, name: "Molten Core", at: AT + 86400, status: me, character: me ? "Greta Coulé" : null, signups: [{ name: "Greta Coulé", status: "present", at: AT - 60 }] }],
    [], [], ["Offa"], undefined, { members: ["Offa", "Gorrak", "Nessa"], sign }, outings, bank);
const lines = (text: string, type: string) => text.split("\n").filter(l => l.startsWith(`${type};`));

describe("lignes Q : demandes de retrait en cours", () => {
  it("Q;<demande>;<prénom du demandeur>;<objet>;<quantité>;<étape>;<préparée par>, dans l'ordre reçu (la plus ancienne d'abord)", () => {
    const text = frg({
      bankers: [],
      requests: [
        { ...REQ(1), who: "Nessa Flotsombre", itemId: 2589, quantity: 10 },
        { ...REQ(2), who: "Vex", itemId: 2592, quantity: 5, status: "prepared", by: "Kaeldra" },
      ],
    });
    expect(lines(text, "Q")).toEqual([
      "Q;0b5a1c2d-0000-4000-8000-000000000001;Nessa;2589;10;pending;",
      "Q;0b5a1c2d-0000-4000-8000-000000000002;Vex;2592;5;prepared;Kaeldra",
    ]);
  });

  it("hors du compte de END, après les sorties X et avant les inscrits Y et la ligne M : un ancien addon les ignore", () => {
    const text = frg({ requests: [REQ(1), REQ(2)], bankers: ["Gorrak"] }, "present", [OUTING]);
    const rows = text.split("\n");
    const types = rows.map(l => l.split(";")[0]);
    expect(types).toEqual(["FRG", "R", "O", "X", "Q", "Q", "H", "Y", "M", "END"]);
    // END ne compte que R, P et B : Q et H n'y changent rien
    expect(rows.at(-1)).toBe("END;1");
    expect(rows.filter(l => /^[RPB];/.test(l))).toHaveLength(1);
    expect(frg({ requests: [REQ(1)], bankers: ["Gorrak"] }).split("\n").at(-1)).toBe(frg(undefined).split("\n").at(-1));
  });

  it("40 au plus : les 40 premières (les plus anciennes) restent", () => {
    const requests = Array.from({ length: 45 }, (_, i) => REQ(i + 1));
    const q = lines(frg({ requests, bankers: [] }), "Q");
    expect(q).toHaveLength(40);
    expect(q[0]).toContain(";2001;1;pending;");
    expect(q[39]).toContain(";2040;40;pending;");
  });

  it("prénom seul (nom de famille retiré), champs sans « ; », « | » ni retour à la ligne ; étape « en attente » : personne n'a préparé", () => {
    const q = lines(frg({
      bankers: [],
      requests: [
        { ...REQ(1), who: "Gre;ta| Coulé", by: "Brakka" },
        { ...REQ(2), who: "Vex Ombrelame", status: "prepared", by: "Kael|dra\nBrisevent" },
      ],
    }), "Q");
    // « Gre;ta| » → « Gre ta  » : le premier mot, sans les séparateurs ; en attente : le champ « préparée par » reste vide
    expect(q[0]).toBe(`Q;${REQ(1).id};Gre;2001;1;pending;`);
    expect(q[1]).toBe(`Q;${REQ(2).id};Vex;2002;2;prepared;Kael`);
    for (const l of q) expect(l.split(";")).toHaveLength(7);
  });

  it("une demande close, sans objet, sans quantité ou sans nom n'est pas écrite", () => {
    const bad = [
      { ...REQ(1), status: "done" }, { ...REQ(2), status: "cancelled" }, { ...REQ(3), itemId: 0 }, { ...REQ(4), quantity: 0 }, { ...REQ(5), who: " ; " }, REQ(6),
    ] as unknown as GroupExportBankRequest[];
    expect(lines(frg({ requests: bad, bankers: [] }), "Q")).toEqual([`Q;${REQ(6).id};Nessa;2006;6;pending;`]);
  });

  it("aucune demande, ou pas de banque : aucune ligne Q ; le texte est celui d'avant", () => {
    expect(lines(frg({ requests: [], bankers: [] }), "Q")).toEqual([]);
    expect(frg({ requests: [], bankers: [] })).toBe(frg(undefined));
  });
});

describe("ligne H : banquiers", () => {
  it("H;<prénoms des banquiers, séparés par des virgules> : triés, sans doublon, prénom seul, sans « , » ni « ; »", () => {
    const h = lines(frg({ requests: [], bankers: ["Kaeldra Brisevent", "Gorrak", "Gorrak", "Ar,thur", "Vex; Ombrelame"] }), "H");
    expect(h).toEqual(["H;Arthur,Gorrak,Kaeldra,Vex"]);
  });

  it("omise quand il n'y a pas de banquier (même avec des demandes)", () => {
    expect(lines(frg({ requests: [REQ(1)], bankers: [] }), "H")).toEqual([]);
    expect(lines(frg({ requests: [REQ(1)], bankers: ["", " ; "] }), "H")).toEqual([]);
  });

  it("écrite sans demande en cours : l'addon sait qui est banquier même quand il n'y a rien à montrer", () => {
    const text = frg({ requests: [], bankers: ["Gorrak"] });
    expect(lines(text, "H")).toEqual(["H;Gorrak"]);
    expect(lines(text, "Q")).toEqual([]);
  });
});

describe("signature : les mêmes lignes pour tous les membres", () => {
  const bank: GroupExportBank = { requests: [REQ(1), { ...REQ(2), status: "prepared", by: "Gorrak" }], bankers: ["Gorrak"] };

  it("deux joueurs aux inscriptions différentes : mêmes lignes Q et H, même forme canonique, même signature, valide", async () => {
    const { sign } = await testSigner();
    const a = frg(bank, "present", [OUTING], sign), b = frg(bank, "late", [OUTING], sign), c = frg(bank, null, [OUTING], sign);
    expect(a).not.toBe(b);
    for (const t of [a, b, c]) {
      expect(lines(t, "Q")).toEqual(lines(a, "Q"));
      expect(lines(t, "H")).toEqual(["H;Gorrak"]);
      expect(canonicalGroupBlock(t, "FRG")).toBe(canonicalGroupBlock(a, "FRG"));
    }
    expect(canonicalGroupBlock(a, "FRG")).toContain(`\nQ;${REQ(1).id};Nessa;2001;1;pending;\nQ;${REQ(2).id};Nessa;2002;2;prepared;Gorrak\nH;Gorrak\n`);
    const sig = groupBlockSignature(a);
    expect(sig?.keyId).toBe(TEST_KEY_ID);
    expect(groupBlockSignature(b)).toEqual(sig);
    expect(await verifyWithTestKey(canonicalGroupBlock(b, "FRG"), sig!.signature)).toBe(true);
  });

  it("une demande ou un banquier changé en route : la signature ne vaut plus", async () => {
    const { sign } = await testSigner();
    const text = frg(bank, "present", [], sign);
    const sig = groupBlockSignature(text)!;
    expect(await verifyWithTestKey(canonicalGroupBlock(text, "FRG"), sig.signature)).toBe(true);
    for (const forged of [text.replace(";2001;1;pending;", ";2001;99;pending;"), text.replace(";prepared;Gorrak", ";prepared;Intrus"), text.replace("H;Gorrak", "H;Gorrak,Intrus"), text.replace("\nH;Gorrak", "")]) {
      expect(forged).not.toBe(text);
      expect(await verifyWithTestKey(canonicalGroupBlock(forged, "FRG"), sig.signature)).toBe(false);
    }
  });

  it("le bloc se redécoupe comme avant (Q et H avant la ligne Z)", async () => {
    const { sign } = await testSigner();
    const text = frg(bank, "present", [], sign);
    expect(splitGroupBlocks(`${text}\n`, "FRG")).toEqual([text]);
    expect(text.split("\n").map(l => l.split(";")[0])).toEqual(["FRG", "R", "O", "Q", "Q", "H", "Y", "M", "Z", "END"]);
  });
});
