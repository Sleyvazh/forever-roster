import { describe, expect, it } from "vitest";
import { ADDON_ERROR_TEXTS, matchAddonError } from "./addon-errors";
import { parseCharacterExports } from "./charexport";
import { parseGuildExports } from "./guild";
import { parseRaidLogs } from "./raidlog";
import { foreignAddonErrors, parseRRB } from "./roster-addon";
import { sealText } from "./seal";

const ID = "8a6f0c1e-1b2c-4d3e-8f90-123456789abc";
const errorOf = (r: { ok: true } | { ok: false; error: string }) => (r.ok ? "" : r.error);

describe("erreurs de lecture d'un texte de l'addon : chaque message a son motif", () => {
  it("les messages produits par les lecteurs sont reconnus", () => {
    const messages = [
      errorOf(parseCharacterExports("FRL;1;x")),
      errorOf(parseCharacterExports("FRC;9;Kaeldra;Forever EU;MAGE;Gnome;60;Alliance;1;1.7.1\nEND;0")),
      errorOf(parseCharacterExports("FRC;2;Kaeldra;Forever EU;MAGE;Gnome;60;Alliance;1;1.7.1\nEND;5")),
      errorOf(parseCharacterExports("FRC;2;Kaeldra;Forever EU;MAGE;Gnome;60;Alliance;1;1.7.1\nEND;0")),
      ...parseGuildExports("FRL;7;Les Lanternes\nEND;0").errors,
      ...parseGuildExports(sealText("FRL;1;Les Lanternes;Horde;1;Morwen;1;Officier;3;Forever EU;1.6.2\nEND;9")).errors,
      ...parseRaidLogs(sealText("FRB;9;x;1;2;X;Y\nEND;0")).errors,
      ...parseRaidLogs(sealText("FRB;1;pas-un-id;1;2;X;Y\nEND;0")).errors,
      ...parseRaidLogs(sealText(`FRB;1;${ID};9;2;X;Y\nEND;0`)).errors,
      ...parseRaidLogs(sealText(`FRB;1;${ID};1;2;X;Y\nA;;;\nEND;1`)).errors,
      ...parseRRB("RRB;3;x\nEND;0").errors,
      ...foreignAddonErrors("FRC;2;x", "retail", "forever.example"),
      ...foreignAddonErrors("FRB;1;x", "retail", "forever.example"),
      ...foreignAddonErrors("RRB;1;x", "forever", "roster.example"),
    ];
    expect(messages.filter(m => !m).length).toBe(0);
    for (const m of messages) expect(matchAddonError(m), m).not.toBeNull();
  });

  it("partie variable et prénom d'un bloc", () => {
    expect(matchAddonError("Version d'export non gérée (9) : mets le site ou l'addon à jour.")).toEqual({ key: ADDON_ERROR_TEXTS[1], v: "9" });
    expect(matchAddonError("Kaeldra : Export incomplet : recopie tout le texte, jusqu'à la ligne END."))
      .toEqual({ key: "Export incomplet : recopie tout le texte, jusqu'à la ligne END.", v: "", name: "Kaeldra" });
    expect(matchAddonError("Un autre message")).toBeNull();
  });
});
