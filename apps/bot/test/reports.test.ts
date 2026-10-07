import { describe, expect, it, vi } from "vitest";
import type { ReportView } from "../src/api";
import { createReportSync, renderReport } from "../src/reports";

const ID = "7c2c3d4e-5555-4a1e-9a55-2f1f1d2c3b4a";
const report = (over: Partial<ReportView> = {}): ReportView => ({
  id: ID, channelId: "300000000000000002", messageId: null, changedAt: "2026-10-07T10:00:00.000Z", createdAt: "2026-10-07T09:59:00.000Z",
  url: "https://x.test/admin/signalements?id=" + ID, kind: "bug", area: "addon", title: "La fenêtre du conseil se ferme", body: "Quand je clique sur *Passer*…",
  author: "Greta", site: "Forever Roster", page: "/groups/g/raids/r", browser: "Firefox 131 · Windows", addonVersion: "1.5.4",
  hasImage: true, status: "new", reply: "", repliedBy: null, ...over,
});

describe("signalements dans le salon des admins", () => {
  it("message : type, titre, auteur, contexte, capture et lien vers la page admin", () => {
    const e = renderReport(report()).embeds[0]!;
    expect(e.title).toBe("🐞 Bug · La fenêtre du conseil se ferme");
    expect(e.description).toBe("Quand je clique sur \\*Passer\\*…");
    expect(e.fields!.map(f => f.name)).toEqual(["De", "Concerne", "Statut", "Page", "Navigateur", "Addon"]);
    expect(e.fields![1]!.value).toBe("Addon · Forever Roster");
    expect(e.fields![2]!.value).toBe("🆕 Nouveau");
    expect(e.image).toEqual({ url: "attachment://capture.webp" });
    expect(e.timestamp).toBe("2026-10-07T09:59:00.000Z");
    const b = renderReport(report()).components[0]!.components as { label?: string; url?: string }[];
    expect(b).toEqual([expect.objectContaining({ label: "Voir sur le site", url: report().url })]);
  });

  it("réponse et statut ; sans capture lisible, pas d'image", () => {
    const p = renderReport(report({ kind: "idea", status: "done", reply: "Ajouté dans la 1.5.5", repliedBy: "Flo", addonVersion: null, page: "", browser: "" }), false);
    const e = p.embeds[0]!;
    expect(e.title!.startsWith("💡 Idée")).toBe(true);
    expect(e.fields!.map(f => f.name)).toEqual(["De", "Concerne", "Statut", "Réponse de Flo"]);
    expect(e.fields![2]!.value).toBe("✅ Fait");
    expect(e.image).toBeUndefined();
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("relève : publie puis confirme la version ; un échec est retenté plus tard", async () => {
    const api = { reportsOutbox: vi.fn(async () => ({ reports: [report()] })), reportPublished: vi.fn(async () => ({ ok: true as const })) };
    const upsert = vi.fn(async () => ({ channelId: "300000000000000002", messageId: "300000000000000009" }));
    await createReportSync(api, { upsert }, { info: () => {}, warn: () => {} }).tick();
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: ID }), null);
    expect(api.reportPublished).toHaveBeenCalledWith(ID, { channelId: "300000000000000002", messageId: "300000000000000009", changedAt: "2026-10-07T10:00:00.000Z" });

    const failing = vi.fn(async () => { throw new Error("Salon inaccessible"); });
    const s = createReportSync(api, { upsert: failing }, { info: () => {}, warn: () => {} });
    await s.tick();
    await s.tick();
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
