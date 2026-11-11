import { describe, expect, it } from "vitest";
import type { BankNotice, OutingNotice, OutingView, RaidView } from "../src/api";
import { renderBankNotice } from "../src/bank";
import { COMMANDS } from "../src/commands";
import { outingTimeChoices, parseOutingTime, parseRaidDate } from "../src/dates";
import { panelMessage, writeModal } from "../src/feedback-core";
import { confirmation } from "../src/flow";
import { langOf, localeLang, recall, remember, trn } from "../src/i18n";
import { outingConfirmation, renderNotice, renderOuting, waitChooser } from "../src/outings";
import { renderAnnouncement, renderReminder } from "../src/render";

/**
 * Version anglaise, lot E6 : le bot parle la langue de la guilde (réglage du site) dans ses annonces, ses MP et ses
 * réponses ; sans guilde connue, celle du Discord du joueur. Les commandes ont leur description dans les deux langues.
 */
const RAID = "0b6f6f3e-3d0a-4a1e-9a55-2f1f1d2c3b4a";
const ID = "0f6c1d2e-0000-4000-8000-000000000001";
const TZ = "Europe/Paris";
const NOW = new Date("2026-11-19T17:12:00Z");
const EN = { id: "g", name: "The Testers", lang: "en" as const };
type Btn = { label?: string };

const raid = (over: Partial<RaidView> = {}): RaidView => ({
  raid: { id: RAID, name: "Molten Core", description: "", scheduledAt: "2026-11-26T20:00:00.000Z", url: "https://x.test/groups/g/raids/r", changedAt: "2026-10-01T10:00:00.000Z" },
  group: EN, channelId: "123456789012345678", messageId: null,
  signups: [
    { displayName: "Aldric", characterName: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank", status: "present", note: "", guest: false, group: null },
    { displayName: "Bob", characterName: null, cls: "Priest", spec: "Holy Heal", role: "Heal", status: "late", note: "", guest: true, group: null },
  ],
  roster: null,
  ...over,
});
const outing = (over: Partial<OutingView> = {}): OutingView => ({
  id: ID, group: EN, channelId: "300000000000000002", messageId: null, changedAt: "2026-11-19T17:12:00.000Z",
  today: "2026-11-19", url: "https://x.test/groups/g/sorties", dungeon: "gnomeregan", title: "Gnomeregan", levels: "29-38",
  day: "2026-11-19", at: "2026-11-19T20:00:00.000Z", note: "", creator: "Pikou", places: { tank: 1, heal: 1, dps: 3 },
  signups: [{ role: "DPS", name: "Pikou", cls: "Mage", spec: "Frost", guest: false }], waiting: [],
  ...over,
});

describe("langue du bot", () => {
  it("langue de la guilde, sinon du Discord du joueur ; mémorisée par raid, sortie ou salon", () => {
    expect(langOf(EN)).toBe("en");
    expect(langOf({ lang: null })).toBe("fr");
    expect(langOf(undefined, "en")).toBe("en");
    expect(localeLang("fr")).toBe("fr");
    expect(localeLang("en-GB")).toBe("en");
    expect(localeLang("de")).toBe("en");
    remember("en", "raid-1", "salon-1");
    expect(recall("inconnu", "salon-1")).toBe("en");
    expect(recall("inconnu")).toBeNull();
    remember("xx", "raid-2");
    expect(recall("raid-2")).toBeNull();
    expect(trn("en", 1, "{n} inscrit", "{n} inscrits")).toBe("1 signed up");
    expect(trn("fr", 0, "{n} inscrit", "{n} inscrits")).toBe("0 inscrit");
    expect(trn("en", 0, "… et {n} autre", "… et {n} autres")).toBe("… and 0 more");
  });
});

describe("annonces et MP en anglais", () => {
  it("annonce d'un raid : statuts, boutons", () => {
    const p = renderAnnouncement(raid());
    const all = JSON.stringify(p);
    expect(all).toContain("Present");
    expect(p.components.flatMap(r => r.components as Btn[]).map(b => b.label)).toEqual(expect.arrayContaining(["Present", "Late", "Maybe", "Bench", "Absent"]));
    expect(all).not.toMatch(/Présent|Peut-être|inscrits?\b|Banc\b/);
  });

  it("rappel par MP", () => {
    const r = renderReminder(raid(), { discordUserId: "1", status: "present", name: "Tournicoti", cls: "Druid", spec: "Feral Bear", guest: false, group: null });
    expect(r.embeds[0]!.title).toBe("Reminder: Molten Core");
    expect(r.embeds[0]!.description).toContain("You're signed up: **Present** with");
    expect(JSON.stringify(r)).not.toMatch(/Tu es|Rappel|Présent/);
  });

  it("confirmation d'inscription", () => {
    const c = confirmation(RAID, "late", "Tournicoti (Feral Bear)", "https://x.test/r", "en");
    expect(JSON.stringify(c)).toContain("Got it: **Late** with");
  });

  it("sortie : annonce, choix de la liste d'attente, confirmation, MP", () => {
    const p = renderOuting(outing(), undefined, NOW);
    expect(p.embeds[0]!.title).toBe("Gnomeregan · 29-38 · tonight 21:00");
    expect(p.embeds[0]!.footer!.text).toBe("Proposed by Pikou · 1/5");
    expect((p.components[0]!.components as Btn[]).map(b => b.label)).toEqual(["🛡️ Tank", "✚ Healer", "⚔️ DPS", "Remove me"]);
    expect(p.embeds[0]!.description).toContain("*open*");
    expect(JSON.stringify(waitChooser(ID, "en"))).toContain("The run is full.");
    expect(outingConfirmation({ state: "in", role: "Heal", name: "Kaelys", position: null }, { guest: false, leveled: true }, "en"))
      .toBe("✚ Signed up as **healer** with **Kaelys**, your character at the right level.");
    expect(outingConfirmation({ state: "waiting", role: "DPS", name: "Quillon", position: 2 }, { guest: true, leveled: false }, "en"))
      .toBe("⏳ Waiting as **DPS** (2nd). You'll take the first spot freed up, a DM will let you know.");
    const base: OutingNotice["payload"] = { outingId: ID, groupName: "The Testers", title: "Gnomeregan", levels: "29-38", day: "2026-11-19", at: "2026-11-19T20:00:00.000Z", url: "https://x.test/s", creator: "Pikou", lang: "en" };
    const n = (kind: OutingNotice["kind"], x: Partial<OutingNotice["payload"]> = {}): OutingNotice => ({ id: 1, discordUserId: "1", kind, payload: { ...base, ...x } });
    expect(renderNotice(n("full", { count: 5, isCreator: true }), NOW).content).toBe("**Gnomeregan** at 21:00 is full (5/5). In game, your addon will offer “Invite all 4” at the start time.");
    expect(renderNotice(n("cancelled"), NOW).content).toBe("The run **Gnomeregan** (tonight 21:00) is cancelled.");
    expect(renderNotice(n("promoted", { role: "DPS", character: "Quillon" }), NOW).content).toBe("A spot opened up: you're signed up for **Gnomeregan** (tonight 21:00) as DPS with **Quillon**.");
  });

  it("banque : MP du demandeur", () => {
    const b: BankNotice = { id: 1, discordUserId: "3", kind: "prepared", item: "Major Healing Potion", quantity: 20, by: "Offa", reason: "", groupName: "The Testers", url: "https://x.test/b", lang: "en" };
    const p = renderBankNotice(b);
    expect(p.content).toBe("Your request for 20 × Major Healing Potion is ready: collect it from Offa.");
    expect(JSON.stringify(p.components)).toContain("See the bank");
    expect(renderBankNotice({ ...b, kind: "refused", reason: "Out of stock." }).content).toBe("Your request for 20 × Major Healing Potion was declined: Out of stock.");
  });

  it("avis : bouton public et fenêtre d'écriture", () => {
    expect(JSON.stringify(panelMessage(true, "en"))).toContain("Give my feedback");
    expect(writeModal("1", "My server", "en").title).toBe("Your feedback for My server");
  });
});

describe("heures et dates tapées en anglais", () => {
  it("/sortie : tomorrow, as soon as full ; erreurs en anglais", () => {
    expect(parseOutingTime("as soon as full", NOW, TZ, "en")).toEqual({ ok: true, day: "2026-11-19", at: null });
    expect(parseOutingTime("tomorrow 20:30", NOW, TZ, "en")).toEqual({ ok: true, day: "2026-11-20", at: new Date("2026-11-20T19:30:00Z") });
    expect(parseOutingTime("10:00", NOW, TZ, "en")).toEqual({ ok: false, error: "10:00 has already passed: write “tomorrow 10:00”, or a time to come." });
    expect(parseOutingTime("soon", NOW, TZ, "en")).toMatchObject({ ok: false, error: expect.stringMatching(/^Unreadable time/) });
    const c = outingTimeChoices("", NOW, TZ, "en");
    expect(c[0]).toBe("As soon as full");
    expect(c).toContain("Tomorrow, as soon as full");
    expect(c.join("|")).not.toMatch(/ce soir|demain|complet/i);
  });

  it("/raid : erreurs en anglais", () => {
    expect(parseRaidDate("next friday", NOW, TZ, "en")).toEqual({ ok: false, error: "Unreadable date. Example: 12/11/2026 21:00 (Paris time)." });
  });
});

describe("commandes slash", () => {
  it("description en anglais, et en français pour Discord en français ; 100 caractères au plus", () => {
    type Opt = { description: string; description_localizations?: Record<string, string>; options?: Opt[] };
    const all: Opt[] = [];
    const walk = (o: Opt) => { all.push(o); o.options?.forEach(walk); };
    (COMMANDS as Opt[]).forEach(walk);
    expect(all.length).toBeGreaterThan(15);
    for (const o of all) {
      expect(o.description.length).toBeLessThanOrEqual(100);
      expect(o.description_localizations?.fr?.length).toBeGreaterThan(0);
      expect(o.description_localizations!.fr!.length).toBeLessThanOrEqual(100);
      expect(o.description).not.toBe(o.description_localizations!.fr);
    }
    expect(COMMANDS.find(c => c.name === "sortie")!.description).toMatch(/^Proposes a dungeon run/);
  });
});
