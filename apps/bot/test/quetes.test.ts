import { describe, expect, it } from "vitest";
import type { QuestNotice, QuestView } from "../src/api";
import { actionDone, decodeQuestId, encodeQuestId, isQuestId, rejectModal, renderQuest, renderQuestNotice } from "../src/quests-core";

const Q = "0f6c1d2e-0000-4000-8000-000000000011";
const T = "0f6c1d2e-0000-4000-8000-000000000012";
type Btn = { custom_id?: string; label?: string; disabled?: boolean; url?: string };
const buttons = (p: { components: { components: unknown[] }[] }) => p.components.flatMap(r => r.components as Btn[]);

const quest = (over: Partial<QuestView> = {}): QuestView => ({
  id: Q, type: "collect", title: "Du cuir pour mes sacoches", description: "Je monte le Travail du cuir.", state: "open",
  objective: { item: { id: 4304, name: "Thick Leather", quality: 1, icon: null, qty: 20 }, text: "" },
  reward: { copper: 30000, items: [], text: "", label: "3 po" }, places: 4, free: 2, minLevel: 30, profession: "", dueAt: null,
  creator: "Kaeldra", takers: [], group: { id: "g", name: "Amis Forever", lang: "fr" },
  channelId: "300000000000000002", messageId: null, changedAt: "2026-11-27T20:00:00.000Z", url: `https://x.test/groups/g/membres/quetes?quete=${Q}`, ...over,
});
const notice = (kind: QuestNotice["kind"], over: Partial<QuestNotice["payload"]> = {}): QuestNotice => ({
  id: 1, discordUserId: "1", kind,
  payload: { questId: Q, takerId: T, title: "Du cuir pour mes sacoches", groupName: "Amis Forever", lang: "fr", other: "Pikou", reward: "3 po", url: "https://x.test/q", ...over },
});

describe("identifiants des boutons", () => {
  it("aller-retour, et formes forgées refusées", () => {
    for (const a of [{ a: "take", questId: Q }, { a: "validate", questId: Q, takerId: T }, { a: "reject", questId: Q, takerId: T }, { a: "paid", questId: Q, takerId: T },
      { a: "received", questId: Q, ok: true }, { a: "received", questId: Q, ok: false }, { a: "rejectModal", questId: Q, takerId: T }] as const) {
      const id = encodeQuestId(a);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(isQuestId(id)).toBe(true);
      expect(decodeQuestId(id)).toEqual(a);
    }
    expect(decodeQuestId(`qu|t|${Q}|x`)).toBeNull();
    expect(decodeQuestId(`qu|v|${Q}`)).toBeNull();
    expect(decodeQuestId("qu|t|pas-un-uuid")).toBeNull();
    expect(decodeQuestId(`pl|t|${Q}`)).toBeNull();
  });
});

describe("annonce", () => {
  it("objectif, récompense, places et bouton Prendre", () => {
    const p = renderQuest(quest());
    const e = p.embeds[0]!;
    expect(e.title).toBe("❗ Du cuir pour mes sacoches");
    expect(e.description).toContain("**Objectif** : 20 × Thick Leather");
    expect(e.description).toContain("**Récompense** : 3 po");
    expect(e.footer!.text).toBe("Donnée par Kaeldra · Collecte · Niv. 30+ · 2/4 places prises");
    expect(buttons(p)[0]).toMatchObject({ label: "Prendre", disabled: false, custom_id: `qu|t|${Q}` });
    expect(buttons(p)[1]!.url).toContain("quete=");
  });

  it("complète : bouton grisé ; en anglais", () => {
    const p = renderQuest(quest({ state: "running", free: 0, places: 1, group: { id: "g", name: "x", lang: "en" }, objective: { item: null, text: "Defeat Mor'Ladim" } }));
    expect(p.embeds[0]!.title).toBe("❗ Du cuir pour mes sacoches · full");
    expect(p.embeds[0]!.description).toContain("**Objective**: Defeat Mor'Ladim");
    expect(buttons(p)[0]).toMatchObject({ label: "Full", disabled: true });
  });
});

describe("MP", () => {
  it("rendue : Valider / Pas encore, avec le mot", () => {
    const m = renderQuestNotice(notice("turned_in", { note: "Envoyé par courrier" }));
    expect(m.content).toContain("**Pikou** a rendu ta quête « **Du cuir pour mes sacoches** »");
    expect(m.content).toContain("> Envoyé par courrier");
    expect(buttons(m).map(b => b.custom_id ?? b.url)).toEqual([`qu|v|${Q}|${T}`, `qu|r|${Q}|${T}`, "https://x.test/q"]);
  });
  it("remise : Reçu / Pas reçu ; rappel au donneur : C'est remis", () => {
    expect(buttons(renderQuestNotice(notice("paid"))).map(b => b.label)).toEqual(["Reçu", "Pas reçu", "Voir sur le site"]);
    expect(buttons(renderQuestNotice(notice("remind_pay")))[0]).toMatchObject({ label: "C'est remis", custom_id: `qu|p|${Q}|${T}` });
    expect(buttons(renderQuestNotice(notice("cancelled")))).toEqual([]);
  });
  it("après le clic, et la fenêtre « Pas encore »", () => {
    expect(actionDone({ a: "received", questId: Q, ok: true }, quest())).toBe("✅ Merci ! Récompense de « **Du cuir pour mes sacoches** » reçue.");
    expect(rejectModal(Q, T, "fr").custom_id).toBe(`qu|rm|${Q}|${T}`);
  });
});
