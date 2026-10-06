import { describe, expect, it } from "vitest";
import { addonKeyOf, normalizeUserCode } from "./sync";

describe("code d'appairage", () => {
  it("accepte les espaces, tirets et minuscules", () => {
    expect(normalizeUserCode("kptz rqmv")).toBe("KPTZ-RQMV");
    expect(normalizeUserCode(" KPTZ-RQMV ")).toBe("KPTZ-RQMV");
  });
  it("refuse les voyelles, chiffres et longueurs fausses", () => {
    expect(normalizeUserCode("KPTZ-RQMA")).toBeNull();
    expect(normalizeUserCode("KPTZ-RQM")).toBeNull();
    expect(normalizeUserCode("KPTZ-RQMV1")).toBe("KPTZ-RQMV"); // les chiffres sont ignorés
    expect(normalizeUserCode("")).toBeNull();
  });
});

it("clé d'un perso du jeu", () => {
  expect(addonKeyOf({ name: "Tournicoti", realm: "Forever EU" })).toBe("Tournicoti-Forever EU");
});
