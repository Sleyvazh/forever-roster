import { describe, expect, it } from "vitest";
import { freePlaces, questStateOf, reliability, rewardText } from "./quests";

const now = new Date("2026-11-27T20:00:00Z");
const q = (o: Partial<Parameters<typeof questStateOf>[0]> = {}) => ({ places: 1, dueAt: null, closedAt: null, cancelledAt: null, ...o });

describe("quêtes de guilde", () => {
  it("état d'une quête", () => {
    expect(questStateOf(q(), [], now)).toBe("open");
    expect(questStateOf(q(), [{ state: "taken" }], now)).toBe("running");
    expect(questStateOf(q({ places: 3 }), [{ state: "taken" }, { state: "abandoned" }], now)).toBe("open");
    expect(questStateOf(q(), [{ state: "received" }], now)).toBe("done");
    expect(questStateOf(q({ places: 2, dueAt: new Date("2026-11-27T19:00:00Z") }), [], now)).toBe("closed");
    expect(questStateOf(q({ places: 2, dueAt: new Date("2026-11-27T19:00:00Z") }), [{ state: "turned_in" }], now)).toBe("running");
    expect(questStateOf(q({ closedAt: now }), [{ state: "received" }, { state: "removed" }], now)).toBe("done");
    expect(questStateOf(q({ cancelledAt: now }), [{ state: "taken" }], now)).toBe("cancelled");
    expect(freePlaces(4, [{ state: "taken" }, { state: "received" }, { state: "abandoned" }])).toBe(2);
  });

  it("fiabilité : une récompense validée il y a moins de 48 h ne compte pas encore", () => {
    const h = (n: number) => new Date(now.getTime() - n * 3600e3);
    const r = reliability(
      [{ state: "received" }, { state: "validated" }, { state: "taken" }],
      [{ state: "received", validatedAt: h(100) }, { state: "validated", validatedAt: h(47) }, { state: "validated", validatedAt: h(49) }, { state: "paid", validatedAt: h(2) }],
      3, now,
    );
    expect(r).toEqual({ done: 2, given: 3, paid: 1, owed: 3 });
  });

  it("récompense lisible", () => {
    expect(rewardText(32000, [{ name: "Potion de soins majeure", qty: 5 }], "un enchantement")).toBe("3 po 20 pa · 5 × Potion de soins majeure · un enchantement");
    expect(rewardText(5, [], "", "en")).toBe("5c");
    expect(rewardText(0, [{ name: "Cape", qty: 1 }], "")).toBe("Cape");
  });
});
