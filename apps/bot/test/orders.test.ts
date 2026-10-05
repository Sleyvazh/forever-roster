import { describe, expect, it, vi } from "vitest";
import type { OrderView } from "../src/api";
import { decodeId, encodeId } from "../src/ids";
import { createOrderSync, renderOrder } from "../src/orders";

const ID = "1b2c3d4e-5555-4a1e-9a55-2f1f1d2c3b4a";
const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: ID, group: { id: "g", name: "Les Lanternes" }, channelId: "300000000000000002", messageId: null, changedAt: "2026-10-06T10:00:00.000Z",
  url: "https://x.test/groups/g/artisans", item: { id: 1, name: "Flarecore Leggings", quality: 4 }, recipeName: "Flarecore Leggings", quantity: 2,
  requester: "Greta", character: "Porteur", crafters: ["Maëlle", "Aiguille"], status: "open", taker: null,
  reagents: [{ name: "Mooncloth", n: 8, provided: true }, { name: "Core Leather", n: 4, provided: false }], note: "Pas pressé", ...over,
});
type Btn = { custom_id?: string; label?: string; url?: string };

describe("commandes d'artisanat sur Discord", () => {
  it("message : objet, demandeur, artisans, composants, bouton tant qu'elle est ouverte", () => {
    const p = renderOrder(order());
    const e = p.embeds[0]!;
    expect(e.title).toBe("Commande : Flarecore Leggings ×2");
    expect(e.fields!.map(f => f.name)).toEqual(["Demandé par", "Statut", "Peuvent le faire — 2", "Composants — 1/2 fournis", "Détails"]);
    expect(e.fields![0]!.value).toBe("Greta (pour Porteur)");
    expect(e.fields![3]!.value).toContain("✅ 8 × Mooncloth");
    const b = p.components[0]!.components as Btn[];
    expect(b.map(x => x.label)).toEqual(["Je m'en charge", "Voir sur le site"]);
    expect(decodeId(b[0]!.custom_id!)).toEqual({ a: "otake", orderId: ID });
    // Prise puis faite : plus de bouton « Je m'en charge »
    expect((renderOrder(order({ status: "taken", taker: "Aiguille" })).components[0]!.components as Btn[]).map(x => x.label)).toEqual(["Voir sur le site"]);
    expect(renderOrder(order({ status: "done", taker: "Aiguille" })).embeds[0]!.title).toBe("✅ Commande : Flarecore Leggings ×2");
    expect(renderOrder(order({ crafters: [] })).embeds[0]!.fields![2]!.value).toContain("personne");
  });

  it("identifiant du bouton : aller-retour et refus des formes forgées", () => {
    expect(decodeId(encodeId({ a: "otake", orderId: ID }))).toEqual({ a: "otake", orderId: ID });
    expect(decodeId(`fr|ot|${ID}|present`)).toBeNull();
    expect(decodeId("fr|ot|pas-un-uuid")).toBeNull();
  });

  it("relève : publie, confirme la version, puis modifie le même message", async () => {
    const api = { ordersOutbox: vi.fn(async () => ({ orders: [order()] })), orderPublished: vi.fn(async () => ({ ok: true as const })) };
    const upsert = vi.fn(async (_o: OrderView, messageId: string | null) => ({ channelId: "300000000000000002", messageId: messageId ?? "300000000000000009" }));
    const s = createOrderSync(api, { upsert }, { info: () => {}, warn: () => {} });
    await s.tick();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), null);
    expect(api.orderPublished).toHaveBeenCalledWith(ID, { channelId: "300000000000000002", messageId: "300000000000000009", changedAt: "2026-10-06T10:00:00.000Z" });
    await s.publish(order({ status: "taken", taker: "Aiguille" }));
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ status: "taken" }), "300000000000000009");
  });
});
