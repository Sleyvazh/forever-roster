import { RETAIL_CLASSES, RETAIL_ONLY_CLASS_SLUGS } from "@forever/game-data";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { emojiName, iconFiles, makeLookup, retailSpecOfFile, specEmojiName, syncEmojis } from "../src/emojis";

/** Émojis des classes propres à WoW Retail (icônes officielles dans icons/retail/, voir scripts/fetch-item-icons.sh). */
describe("émojis des classes propres à Retail", () => {
  it("noms d'émojis : fr_<classe>_<spé>, 32 caractères au plus, sans arbre de talents", () => {
    expect(emojiName("Death Knight")).toBe("fr_death_knight");
    expect(emojiName("Demon Hunter")).toBe("fr_demon_hunter");
    expect([emojiName("Evoker"), emojiName("Monk")]).toEqual(["fr_evoker", "fr_monk"]);
    expect(specEmojiName("Death Knight", "Blood")).toBe("fr_death_knight_blood");
    expect(specEmojiName("Demon Hunter", "Devourer")).toBe("fr_demon_hunter_devourer");
    expect(specEmojiName("Evoker", "Augmentation")).toBe("fr_evoker_augmentation");
    expect(specEmojiName("Monk", "Mistweaver")).toBe("fr_monk_mistweaver");
    // Pas d'ancien rangement par arbre pour ces classes ; les classes inconnues restent sans nom
    expect(emojiName("Death Knight", 0)).toBeNull();
    expect([emojiName("Inconnue"), specEmojiName("Inconnue", "Blood")]).toEqual([null, null]);
    // Les classes de Forever gardent leurs noms
    expect([emojiName("Druid"), emojiName("Druid", 1), specEmojiName("Druid", "Feral Bear")]).toEqual(["fr_druid", "fr_druid_2", "fr_druid_feral_bear"]);
    for (const cls of Object.keys(RETAIL_ONLY_CLASS_SLUGS)) for (const s of RETAIL_CLASSES[cls]!.specs) {
      expect(specEmojiName(cls, s.name)).toMatch(/^fr_[a-z0-9_]{1,29}$/);
    }
  });

  it("émoji de la spé, sinon de la classe, sinon rien", () => {
    const e = makeLookup(new Map([["fr_death_knight", "70"], ["fr_death_knight_blood", "71"], ["fr_evoker_preservation", "72"], ["fr_druid", "11"]]));
    expect(e("Death Knight", "Blood")).toBe("<:fr_death_knight_blood:71>");
    expect(e("Death Knight", "Frost")).toBe("<:fr_death_knight:70>"); // spé sans émoji : la classe
    expect(e("Death Knight")).toBe("<:fr_death_knight:70>");
    expect(e("Death Knight", "Holy")).toBe("<:fr_death_knight:70>"); // spé qui n'est pas la sienne : la classe
    expect(e("Evoker", "Preservation")).toBe("<:fr_evoker_preservation:72>");
    expect(e("Evoker", "Devastation")).toBe(""); // ni la spé ni la classe
    expect(e("Monk", "Brewmaster")).toBe("");
    expect(e("Druid", "Guardian")).toBe("<:fr_druid:11>"); // les classes communes n'ont pas changé
  });

  it("reconnaît les fichiers retail/class/<classe>.png et retail/spec/<classe>-<spé>.png", async () => {
    expect(retailSpecOfFile("death-knight-blood")).toEqual({ cls: "Death Knight", spec: "Blood" });
    expect(retailSpecOfFile("demon-hunter-devourer")).toEqual({ cls: "Demon Hunter", spec: "Devourer" });
    expect(retailSpecOfFile("monk-windwalker")).toEqual({ cls: "Monk", spec: "Windwalker" });
    expect([retailSpecOfFile("death-knight-holy"), retailSpecOfFile("druid-balance"), retailSpecOfFile("monk"), retailSpecOfFile("")]).toEqual([null, null, null, null]);

    const dir = await mkdtemp(path.join(tmpdir(), "icons-retail-"));
    await mkdir(path.join(dir, "class"));
    await mkdir(path.join(dir, "retail", "class"), { recursive: true });
    await mkdir(path.join(dir, "retail", "spec"), { recursive: true });
    await writeFile(path.join(dir, "class", "druid.png"), "png");
    for (const f of ["death-knight.png", "evoker.png", "druid.png", "monk.jpg", "notes.txt"]) await writeFile(path.join(dir, "retail", "class", f), "png");
    for (const f of ["death-knight-blood.png", "evoker-augmentation.png", "death-knight-holy.png", "demon-hunter-havoc.png", "druid-feral-bear.png"]) {
      await writeFile(path.join(dir, "retail", "spec", f), "png");
    }
    const files = await iconFiles(dir);
    expect(files.map(f => f.name)).toEqual(["fr_druid", "fr_death_knight", "fr_evoker", "fr_monk", "fr_death_knight_blood", "fr_demon_hunter_havoc", "fr_evoker_augmentation"]);
    expect(files.find(f => f.name === "fr_monk")?.file).toBe(path.join(dir, "retail", "class", "monk.jpg"));
    expect(files.find(f => f.name === "fr_death_knight_blood")?.file).toBe(path.join(dir, "retail", "spec", "death-knight-blood.png"));

    // Envoyés à Discord comme les autres, une seule fois
    const created: string[] = [];
    const api = { list: vi.fn(async () => [{ id: "9", name: "fr_evoker" }]), create: vi.fn(async (name: string) => { created.push(name); return { id: "10", name }; }) };
    const ids = await syncEmojis(dir, api, vi.fn());
    expect(created).toEqual(["fr_druid", "fr_death_knight", "fr_monk", "fr_death_knight_blood", "fr_demon_hunter_havoc", "fr_evoker_augmentation"]);
    expect(ids.get("fr_evoker")).toBe("9");
    expect(makeLookup(ids)("Death Knight", "Blood")).toBe("<:fr_death_knight_blood:10>");
  });
});
