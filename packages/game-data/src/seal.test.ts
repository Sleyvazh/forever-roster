import { describe, expect, it } from "vitest";
import { parseCharacterExports } from "./charexport";
import { parseGuildExports } from "./guild";
import { parseRaidLogs } from "./raidlog";
import { hmacSha256Hex, SEAL_KEY, sealOf, sealState, sealText, sha256 } from "./seal";

/** Sceau des textes de l'addon ForeverRoster (1.6.5). Noms inventés. */

/** node:crypto (référence), chargé comme dans test-signer.ts : le paquet se vérifie sans les types de Node. */
interface Digest { update(s: string): Digest; digest(enc: "hex"): string }
interface NodeCrypto { createHash(alg: string): Digest; createHmac(alg: string, key: string): Digest }
const nodeCrypto = () => import(/* @vite-ignore */ ["node", "crypto"].join(":")) as Promise<NodeCrypto>;
const toHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

const RAID = "4a1e43ea-54e8-4b49-888f-5e19b5754f61";
const FRL = ["FRL;1;Les Veilleurs;Horde;1790000000;Tournicoti;0;Officier;1;Forever EU;1.6.5", "M;Zélie Ombrelune;DRUID;38;Officier;1;1;0;;;Player-4321-00000001", "END;1"];
const FRC = ["FRC;2;Tournicoti;Forever EU;DRUID;Tauren;12;Horde;1790000000;1.6.5;;", "END;0"];

describe("SHA-256 et HMAC", () => {
  it("comme node:crypto, UTF-8 et longueurs aux bords des blocs compris", async () => {
    const { createHash, createHmac } = await nodeCrypto();
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "é€😀".repeat(100), "x".repeat(300_000)]) {
      expect(toHex(sha256(new TextEncoder().encode(s)))).toBe(createHash("sha256").update(s).digest("hex"));
      expect(hmacSha256Hex(SEAL_KEY, s)).toBe(createHmac("sha256", SEAL_KEY).update(s).digest("hex"));
    }
    const longKey = "k".repeat(100);
    expect(hmacSha256Hex(longKey, "abc")).toBe(createHmac("sha256", longKey).update("abc").digest("hex"));
  });
});

describe("sceau d'un bloc", () => {
  it("vecteurs partagés avec le test Lua de l'addon (addon/tests/format_test.lua)", () => {
    expect(sealOf(FRL)).toBe("9eb5ddd1965a4476");
    expect(sealOf(FRC)).toBe("1aab5ef540298168");
  });

  it("scellé : accepté ; sans sceau : addon trop ancien ; retouché : refusé", () => {
    const sealed = sealText(FRL.join("\n")).split("\n");
    expect(sealed.at(-1)).toBe("END;1;9eb5ddd1965a4476");
    expect(sealState(sealed)).toBe("ok");
    expect(sealState(FRL)).toBe("missing");
    expect(sealState(sealed.map(l => l.replace(";38;", ";60;")))).toBe("bad");
    expect(sealState([...sealed.slice(0, -1), "END;1;0000000000000000"])).toBe("bad");
    expect(sealState([...sealed.slice(0, -1), `${sealed.at(-1)};x`])).toBe("bad");
    expect(sealState(sealed.slice(0, -1))).toBe("bad"); // sans END
  });

  it("retours Windows, blancs autour des lignes et lignes vides n'y changent rien ; l'espace insécable, si", () => {
    const sealed = sealText(FRL.join("\n")).split("\n");
    expect(sealState(sealed.map(l => `  ${l}\r`))).toBe("ok");
    expect(sealState([sealed[0]!, "", sealed[1]!, "   ", sealed[2]!])).toBe("ok");
    expect(sealState(sealed.map((l, i) => (i === 1 ? `${l} ` : l)))).toBe("bad");
  });

  it("sealText ne touche qu'aux blocs FRC, FRL et FRB", () => {
    const text = ["Bonjour", ...FRC, "RRB;1;x;1;2;X-Y;Raid;;0;", "END;0", ...FRL].join("\n");
    const out = sealText(text).split("\n");
    expect(out[0]).toBe("Bonjour");
    expect(out[2]).toBe("END;0;1aab5ef540298168");
    expect(out[4]).toBe("END;0");
    expect(out.at(-1)).toBe("END;1;9eb5ddd1965a4476");
  });
});

describe("blocs refusés par le site", () => {
  it("persos (FRC) : sans sceau ou retouché", () => {
    const r = parseCharacterExports(`${FRC.join("\n")}\n${sealText(FRC.join("\n")).replace("Tournicoti", "Brindille").replace(";12;", ";60;")}`);
    expect(r.ok).toBe(false);
    const both = parseCharacterExports(`${FRC.join("\n").replace("Tournicoti", "Ancien")}\n${sealText(FRC.join("\n"))}\n${sealText(FRC.join("\n").replace("Tournicoti", "Brindille")).replace(";12;", ";60;")}`);
    expect(both.ok && both.data.map(d => d.name)).toEqual(["Tournicoti"]);
    expect(both.ok && both.errors).toEqual([
      "Ancien : Texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le.",
      "Brindille : Texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu.",
    ]);
  });

  it("relevé de guilde (FRL) : un niveau retouché refuse tout le relevé", () => {
    expect(parseGuildExports(sealText(FRL.join("\n"))).data[0]!.roster!.members[0]!.level).toBe(38);
    const forged = parseGuildExports(sealText(FRL.join("\n")).replace(";38;", ";60;"));
    expect(forged.data).toEqual([]);
    expect(forged.errors).toEqual(["texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu"]);
    expect(parseGuildExports(FRL.join("\n")).errors[0]).toMatch(/^texte d'un addon ForeverRoster trop ancien/);
  });

  it("bilan (FRB) : retouché, sans sceau ; ce qui suit END n'en fait pas partie", () => {
    const log = `FRB;2;${RAID};1000;8200;Thalion;Molten Core;Molten Core;1\nA;Thalwen;1000;8200;121\nL;16828;Thalwen;3000;Lucifron\nEND;2`;
    expect(parseRaidLogs(sealText(log)).data).toHaveLength(1);
    expect(parseRaidLogs(sealText(log).replace("16828;Thalwen", "16828;Grumdal")).errors[0]).toMatch(/^texte modifié depuis l'addon/);
    expect(parseRaidLogs(log).errors[0]).toMatch(/^texte d'un addon ForeverRoster trop ancien/);
    const tail = parseRaidLogs(`${sealText(log)}\nL;19000;Grumdal;4000;Garr`);
    expect(tail.errors).toEqual([]);
    expect(tail.data[0]!.loot.map(l => l.itemId)).toEqual([16828]);
  });
});
