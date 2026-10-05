import { ComponentType } from "discord.js";
import { describe, expect, it } from "vitest";
import type { Ask, Nudge, RaidView } from "../src/api";
import { decodeId, encodeId } from "../src/ids";
import { renderAsk, renderAskAnswered, renderNudge, renderNudgeReport } from "../src/reach";
import { renderEmbed } from "../src/render";

const RAID = "0b6f6f3e-3d0a-4a1e-9a55-2f1f1d2c3b4a";
const ASK = "7a1e0c2d-2222-4a1e-9a55-2f1f1d2c3b4a";
const view: RaidView = {
  raid: { id: RAID, name: "Molten Core", description: "", scheduledAt: "2026-11-12T20:00:00.000Z", url: "https://x.test/r", changedAt: "2026-10-01T10:00:00.000Z", size: 20 },
  group: { id: "g", name: "Les Lanternes" }, channelId: "123456789012345678", messageId: null,
  signups: [{ displayName: "Aldric", characterName: "Tour", cls: "Druid", spec: "Feral Bear", role: "Tank", status: "present", note: "", guest: false, group: 1 }],
  roster: null,
};
type Btn = { custom_id?: string; label?: string; url?: string };
const buttons = (p: { components: { components: unknown[] }[] }) => p.components.flatMap(r => r.components as Btn[]);

describe("relance des sans-réponse", () => {
  it("MP : question, boutons Présent / Peut-être / Absent et lien", () => {
    const p = renderNudge(view);
    expect(p.embeds[0]!.title).toBe("Molten Core : tu viens ?");
    expect(p.embeds[0]!.description).toContain("Déjà 1 inscrit pour 20 places");
    expect(p.embeds[0]!.description).toContain("<t:");
    const b = buttons(p);
    expect(b.map(x => x.label)).toEqual(["Présent", "Peut-être", "Absent", "Voir sur le site"]);
    expect(decodeId(b[0]!.custom_id!)).toEqual({ a: "st", raidId: RAID, status: "present" });
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("liste aux officiers : relancés, MP fermés, sans Discord, MP coupés", () => {
    const n: Nudge = { view, auto: true, recipients: [], officers: ["1"], unreachable: [{ name: "Kae*lys", why: "no-discord" }, { name: "Bob", why: "dm-off" }] };
    const e = renderNudgeReport(n, ["Ana", "Cid"], ["Dan"]).embeds[0]!;
    expect(e.title).toBe("Molten Core : 5 sans réponse");
    expect(e.fields!.map(f => `${f.name}|${f.value}`)).toEqual([
      "Relancés par MP — 2|Ana, Cid", "MP fermés — 1|Dan", "Sans Discord lié — 1|Kae\\*lys", "Messages du bot désactivés — 1|Bob",
    ]);
  });
});

describe("« Demander à X »", () => {
  const ask: Ask = {
    id: ASK, discordUserId: "2", character: { name: "Pansou", cls: "Druid" }, spec: "Restoration", role: "Heal", askedBy: "Tonnerre",
    current: { status: "present", characterName: "Givra" }, raid: { id: RAID, name: "BWL", scheduledAt: "2026-11-12T20:00:00.000Z", url: "https://x.test/r" },
    group: { id: "g", name: "Les Lanternes" },
  };

  it("identifiants Oui / Non : aller-retour, refus des formes forgées", () => {
    for (const yes of [true, false]) expect(decodeId(encodeId({ a: "ask", askId: ASK, yes }))).toEqual({ a: "ask", askId: ASK, yes });
    expect(decodeId(`fr|ay|${ASK}|present`)).toBeNull();
    expect(decodeId("fr|ay|pas-un-uuid")).toBeNull();
  });

  it("MP : qui demande, quel perso et quelle spé, ce qui change ; puis la réponse retire les boutons", () => {
    const p = renderAsk(ask);
    const d = p.embeds[0]!.description!;
    expect(d).toContain("**Tonnerre** (Les Lanternes) te demande si tu peux venir avec **Pansou** en **Restoration** : il manque un Heal.");
    expect(d).toContain("Tu es inscrit avec **Givra** (Présent) : répondre Oui t'inscrit avec Pansou à la place.");
    const b = buttons(p);
    expect(b.map(x => x.label)).toEqual(["Oui, avec Pansou", "Non, pas cette fois", "Voir sur le site"]);
    expect(decodeId(b[0]!.custom_id!)).toEqual({ a: "ask", askId: ASK, yes: true });
    // Pas encore répondu : pas de ligne « inscrit avec »
    expect(renderAsk({ ...ask, current: null }).embeds[0]!.description).not.toContain("inscrit avec");

    const done = renderAskAnswered(p.embeds[0] as { title?: string; description?: string }, { answer: "yes", character: "Pansou", spec: "Restoration", url: "https://x.test/r", view: null, already: false });
    expect(done.embeds[0]!.description).toContain("tu viens avec **Pansou** (Restoration)");
    expect(done.components[0]!.components).toHaveLength(1);
    expect((done.components[0]!.components[0] as { type: number }).type).toBe(ComponentType.Button);
    expect(buttons(done)[0]!.url).toBe("https://x.test/r");
  });
});

describe("annonce : compo validée au format du raid", () => {
  it("affiche /20 pour un raid à 20", () => {
    const e = renderEmbed({ ...view, roster: { groups: [{ group: 1, members: [{ name: "Tour", cls: "Druid", spec: "Feral Bear", role: "Tank" }] }] } });
    expect(e.fields![0]!.name).toBe("✅ Compo validée — 1/20");
  });
});
