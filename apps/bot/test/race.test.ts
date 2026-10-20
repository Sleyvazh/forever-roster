import { describe, expect, it, vi } from "vitest";
import type { LevelAnnounce } from "../src/api";
import { createLevelAnnouncer, renderLevelAnnounce } from "../src/race";

/** Course au 60 : annonces des montées de niveau dans le salon de la guilde (noms inventés). */

const sixty: LevelAnnounce = {
  id: "g:Player-4620-0A1B2C3D:60", channelId: "300000000000000002", group: { id: "g", name: "Les Lanternes" }, url: "https://x.test/groups/g/membres/course",
  name: "Kaeldra Brisevent", cls: "Warrior", level: 60, rank: 1, at: "2026-11-14T15:52:00.000Z", exact: true, when: "samedi 14/11 à 16:52",
};

describe("annonce d'une montée de niveau", () => {
  it("le 60 en grand : nom complet, rang, jours après la sortie, guilde et date", () => {
    const p = renderLevelAnnounce(sixty);
    expect(p.content).toBeUndefined();
    const e = p.embeds[0]!;
    expect(e.title).toBe("🏆 Kaeldra Brisevent atteint le niveau 60");
    expect(e.description).toBe("1re de la guilde, 9 jours après la sortie.");
    expect(e.footer!.text).toBe("Course au 60 · Les Lanternes · samedi 14/11 à 16:52");
    expect(e.url).toBe(sixty.url);
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("les autres paliers : une ligne courte ; le nom est échappé", () => {
    const p = renderLevelAnnounce({ ...sixty, name: "Morwen_Cendre", level: 50, rank: 4, exact: false, when: "vers le 13/11" });
    expect(p.embeds).toEqual([]);
    expect(p.content).toBe("⬆️ **Morwen\\_Cendre** atteint le niveau 50 · 4e de la guilde.");
  });

  it("chaque annonce remise par le site est publiée une fois ; un salon inaccessible n'arrête pas les autres", async () => {
    const claims = [[sixty, { ...sixty, id: "x", channelId: "300000000000000009", name: "Vex Ombrelame", rank: 2 }], []];
    const api = { claimLevelAnnounces: vi.fn(async () => ({ announces: claims.shift() ?? [] })) };
    const sent: string[] = [];
    const warn = vi.fn();
    const send = vi.fn(async (channelId: string, payload: { embeds: { title?: string }[] }) => {
      if (channelId === "300000000000000009") throw new Error("Salon inaccessible");
      sent.push(`${channelId} ${payload.embeds[0]?.title}`);
    });
    const a = createLevelAnnouncer(api, send, { info: vi.fn(), warn });
    await a.tick();
    await a.tick();
    expect(sent).toEqual(["300000000000000002 🏆 Kaeldra Brisevent atteint le niveau 60"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("Annonce de niveau non publiée (Les Lanternes)", "Salon inaccessible");
  });
});
