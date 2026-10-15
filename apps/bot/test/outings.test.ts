import { describe, expect, it, vi } from "vitest";
import type { OutingChoices, OutingNotice, OutingView } from "../src/api";
import { outingTimeChoices, parseOutingTime } from "../src/dates";
import { makeLookup } from "../src/emojis";
import { decodeId, decodeOutingId, encodeOutingId } from "../src/ids";
import { createOutingSync, onOutingClass, onOutingRole, outingConfirmation, outingTitle, renderNotice, renderOuting, waitChooser } from "../src/outings";

const ID = "0f6c1d2e-0000-4000-8000-000000000001";
const TZ = "Europe/Paris";
// Jeudi 19 novembre 2026, 18:12 à Paris
const NOW = new Date("2026-11-19T17:12:00Z");
const view = (over: Partial<OutingView> = {}): OutingView => ({
  id: ID, group: { id: "g", name: "Les Lanternes" }, channelId: "300000000000000002", messageId: null, changedAt: "2026-11-19T17:12:00.000Z",
  today: "2026-11-19", url: "https://x.test/groups/g/sorties", dungeon: "gnomeregan", title: "Gnomeregan", levels: "29-38",
  day: "2026-11-19", at: "2026-11-19T20:00:00.000Z", note: "Toutes les quêtes : prenez-les avant d'entrer.", creator: "Pikou",
  places: { tank: 1, heal: 1, dps: 3 },
  signups: [
    { role: "DPS", name: "Pikou", cls: "Mage", spec: "Frost", guest: false },
    { role: "Tank", name: "Bramm", cls: "Warrior", spec: "Protection", guest: true },
    { role: "DPS", name: "Tiblou", cls: "Warlock", spec: "Affliction", guest: false },
  ],
  waiting: [],
  ...over,
});
type Btn = { custom_id?: string; label?: string; disabled?: boolean; style?: number; url?: string };

describe("annonce compacte d'une sortie", () => {
  it("titre, une ligne par rôle (places libres), note, créateur ; boutons des rôles grisés quand pleins", () => {
    const p = renderOuting(view(), undefined, NOW);
    const e = p.embeds[0]!;
    expect(e.title).toBe("Gnomeregan · 29-38 · ce soir 21:00");
    expect(e.url).toBe("https://x.test/groups/g/sorties");
    expect(e.description).toBe("🛡️ **Bramm** ✱\n✚ *libre*\n⚔️ **Pikou**, **Tiblou**, *libre*\n\n« Toutes les quêtes : prenez\\-les avant d'entrer. »");
    expect(e.footer!.text).toBe("Proposée par Pikou · 3/5");
    const b = p.components[0]!.components as Btn[];
    expect(b.map(x => `${x.label}${x.disabled ? " (grisé)" : ""}`)).toEqual(["🛡️ Tank (grisé)", "✚ Soigneur", "⚔️ DPS", "Me retirer"]);
    expect(decodeOutingId(b[1]!.custom_id!)).toEqual({ a: "join", outingId: ID, role: "Heal", wait: false });
    expect(decodeOutingId(b[3]!.custom_id!)).toEqual({ a: "leave", outingId: ID });
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("complète : « · complète », tous les rôles grisés, « Me mettre en attente » ; icônes de classe ; « dès que complet »", () => {
    const full = view({
      signups: [...view().signups, { role: "Heal", name: "Kaelys", cls: "Priest", spec: "Holy", guest: false }, { role: "DPS", name: "Mirka", cls: "Shaman", spec: "Elemental", guest: false }],
      waiting: [{ role: "Heal", name: "Brindille", cls: "Druid", spec: "Restoration", guest: false }],
    });
    const p = renderOuting(full, makeLookup(new Map([["fr_mage", "1"], ["fr_role_tank", "2"]])), NOW);
    expect(p.embeds[0]!.title).toBe("Gnomeregan · 29-38 · ce soir 21:00 · complète");
    expect(p.embeds[0]!.description).toContain("<:fr_role_tank:2> **Bramm** ✱");
    expect(p.embeds[0]!.description).toContain("⚔️ <:fr_mage:1> **Pikou**, **Tiblou**, **Mirka**");
    expect(p.embeds[0]!.footer!.text).toBe("Proposée par Pikou · 5/5 · 1 en attente");
    const b = p.components[0]!.components as Btn[];
    expect(b.map(x => `${x.label}${x.disabled ? " (grisé)" : ""}`)).toEqual(["🛡️ Tank (grisé)", "✚ Soigneur (grisé)", "⚔️ DPS (grisé)", "⏳ Me mettre en attente", "Me retirer"]);
    expect(decodeOutingId(b[3]!.custom_id!)).toEqual({ a: "wait", outingId: ID });
    // « Autre » sans fourchette, dès que complet, demain ; places 0/1/4 : pas de bouton Tank
    const other = renderOuting(view({ title: "Élite de la Vallée", levels: "", at: null, day: "2026-11-20", note: "", places: { tank: 0, heal: 1, dps: 4 }, signups: [] }), undefined, NOW);
    expect(other.embeds[0]!.title).toBe("Élite de la Vallée · demain, dès que complet");
    expect(other.embeds[0]!.description).toBe("✚ *libre*\n⚔️ *libre*, *libre*, *libre*, *libre*");
    expect((other.components[0]!.components as Btn[]).map(x => x.label)).toEqual(["✚ Soigneur", "⚔️ DPS", "Me retirer"]);
    // Après minuit, la même sortie de demain devient « ce soir »
    expect(outingTitle(view({ day: "2026-11-20", at: "2026-11-20T17:00:00.000Z" }), new Date("2026-11-20T08:00:00Z"))).toBe("Gnomeregan · 29-38 · ce soir 18:00");
  });

  it("identifiants : aller-retour, pas de confusion avec les autres boutons, formes forgées refusées", () => {
    for (const a of [
      { a: "join", outingId: ID, role: "Tank", wait: false }, { a: "join", outingId: ID, role: "DPS", wait: true }, { a: "wait", outingId: ID },
      { a: "leave", outingId: ID }, { a: "char", outingId: ID, role: "Heal", wait: false }, { a: "cls", outingId: ID, role: "Tank", wait: true },
      { a: "spec", outingId: ID, role: "DPS", wait: false },
    ] as const) {
      const id = encodeOutingId(a);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(decodeOutingId(id)).toEqual(a);
      expect(decodeId(id)).toBeNull();
    }
    expect(decodeOutingId(`fr|off|${ID}`)).toBeNull();
    expect(decodeOutingId(`fr|ot|${ID}`)).toBeNull();
    expect(decodeOutingId(`fr|oj|${ID}|X`)).toBeNull();
    expect(decodeOutingId(`fr|oj|pas-un-uuid|T`)).toBeNull();
    expect(decodeOutingId(`fr|och|${ID}|T|2`)).toBeNull();
    expect(decodeOutingId(`fr|oo|${ID}|T`)).toBeNull();
  });
});

describe("parcours d'inscription", () => {
  const member = (characters: { id: string; name: string; cls: string; level: number; spec: string }[], over: Partial<Extract<OutingChoices, { mode: "member" }>> = {}): OutingChoices =>
    ({ mode: "member", linked: true, current: null, creator: false, levels: "29-38", anyAtLevel: characters.length > 0, characters, ...over });
  const kaelys = { id: "5f0e8a2c-1111-4a1e-9a55-2f1f1d2c3b4a", name: "Kaelys", cls: "Priest", level: 31, spec: "Holy" };
  const brindille = { id: "5f0e8a2c-2222-4a1e-9a55-2f1f1d2c3b4a", name: "Brindille", cls: "Druid", level: 35, spec: "Restoration" };

  it("membre lié : son seul perso au niveau s'inscrit d'un clic ; plusieurs : un menu ; aucun : pourquoi", () => {
    expect(onOutingRole(ID, "Heal", false, member([kaelys]))).toEqual({ kind: "signup", body: { role: "Heal", characterId: kaelys.id, spec: "Holy", wait: false } });
    const menu = onOutingRole(ID, "Heal", true, member([kaelys, brindille]));
    expect(menu.kind).toBe("reply");
    const sel = (menu as { components: { components: { custom_id: string; options: { label: string; description: string }[] }[] }[] }).components[0]!.components[0]!;
    expect(decodeOutingId(sel.custom_id)).toEqual({ a: "char", outingId: ID, role: "Heal", wait: true });
    expect(sel.options.map(o => `${o.label} / ${o.description}`)).toEqual(["Kaelys — niveau 31 / Priest · Holy", "Brindille — niveau 35 / Druid · Restoration"]);
    // Déjà inscrit dans ce rôle avec l'un d'eux : on le garde
    expect(onOutingRole(ID, "Heal", false, member([kaelys, brindille], { current: { role: "Heal", waiting: false, characterId: brindille.id, cls: "Druid", spec: "Restoration" } })))
      .toMatchObject({ kind: "signup", body: { characterId: brindille.id } });
    expect(onOutingRole(ID, "Tank", false, member([], { anyAtLevel: false }))).toMatchObject({ kind: "reply", content: expect.stringContaining("n'a le niveau de cette sortie (29-38)") });
    expect(onOutingRole(ID, "Tank", false, member([], { anyAtLevel: true }))).toMatchObject({ kind: "reply", content: "Aucun de tes persos qui ont le niveau ne joue tank." });
  });

  it("sans compte : classe parmi celles du rôle, puis spé du rôle (directe s'il n'y en a qu'une)", () => {
    const guest: OutingChoices = { mode: "guest", linked: false, current: null, levels: "29-38" };
    const step = onOutingRole(ID, "Tank", false, guest) as { kind: "reply"; content: string; components: { components: { custom_id: string; options: { value: string }[] }[] }[] };
    expect(step.content).toContain("Inscription libre, sans compte.");
    expect(step.components[0]!.components[0]!.options.map(o => o.value)).toEqual(["Druid", "Paladin", "Shaman", "Warrior"]);
    expect(onOutingClass(ID, "Tank", false, "Warrior")).toEqual({ kind: "signup", body: { role: "Tank", cls: "Warrior", spec: "Protection", wait: false } });
    const dps = onOutingClass(ID, "DPS", true, "Warrior") as { kind: "reply"; components: { components: { custom_id: string; options: { value: string }[] }[] }[] };
    expect(dps.components[0]!.components[0]!.options.map(o => o.value)).toEqual(["Warrior:Arms", "Warrior:Fury", "Warrior:Gladiator"]);
    expect(decodeOutingId(dps.components[0]!.components[0]!.custom_id)).toEqual({ a: "spec", outingId: ID, role: "DPS", wait: true });
    expect(onOutingClass(ID, "Heal", false, "Mage")).toMatchObject({ kind: "reply", content: "Cette classe ne joue pas soigneur." });
    // Déjà inscrit avec une spé de ce rôle : un clic suffit
    expect(onOutingRole(ID, "Heal", false, { ...guest, current: { role: "Heal", waiting: true, characterId: null, cls: "Priest", spec: "Holy" } }))
      .toEqual({ kind: "signup", body: { role: "Heal", cls: "Priest", spec: "Holy", wait: false } });
  });

  it("messages : inscrit, en attente, choix du rôle de l'attente", () => {
    expect(outingConfirmation({ state: "in", role: "Heal", name: "Kaelys", position: null }, { guest: false, leveled: true }))
      .toBe("✚ Inscrit en **soigneur** avec **Kaelys**, ton perso qui a le niveau.");
    expect(outingConfirmation({ state: "in", role: "Tank", name: "mirka", position: null }, { guest: true, leveled: true })).toBe("🛡️ Inscrit en **tank**.");
    expect(outingConfirmation({ state: "waiting", role: "DPS", name: "Quillon", position: 1 }, { guest: false, leveled: false }))
      .toBe("⏳ En attente en **DPS** avec **Quillon** (1er). Tu prendras la première place libérée, un MP te préviendra.");
    const w = waitChooser(ID);
    expect((w.components[0]!.components as Btn[]).map(b => decodeOutingId(b.custom_id!))).toEqual(
      (["Tank", "Heal", "DPS"] as const).map(role => ({ a: "join", outingId: ID, role, wait: true })));
  });
});

describe("MP", () => {
  const base: OutingNotice["payload"] = { outingId: ID, groupName: "Les Lanternes", title: "Gnomeregan", levels: "29-38", day: "2026-11-19", at: "2026-11-19T20:00:00.000Z", url: "https://x.test/groups/g/sorties", creator: "Pikou" };
  const n = (kind: OutingNotice["kind"], p: Partial<OutingNotice["payload"]> = {}): OutingNotice => ({ id: 1, discordUserId: "1", kind, payload: { ...base, ...p } });
  it("complète, 15 min avant, heure changée, annulée, place libérée", () => {
    expect(renderNotice(n("full", { count: 5, isCreator: true }), NOW).content).toBe("**Gnomeregan** de 21:00 est complète (5/5). En jeu, ton addon proposera « Inviter les 4 » à l'heure.");
    const at = new Date("2026-11-19T19:45:00Z");
    expect(renderNotice(n("soon", { count: 5 }), at).content).toBe("**Gnomeregan** dans 15 min. Pikou t'invite en jeu ; sinon, chuchote-le.");
    expect(renderNotice(n("soon", { count: 5, isCreator: true }), at).content).toBe("**Gnomeregan** dans 15 min. En jeu, ton addon proposera « Inviter les 4 » à l'heure.");
    expect(renderNotice(n("moved", { at: "2026-11-19T20:30:00.000Z", oldAt: base.at, oldDay: base.day, role: "Tank" }), NOW).content)
      .toBe("**Gnomeregan** change d'heure : ~~ce soir 21:00~~ → ce soir 21:30. Tu restes inscrit en tank.");
    const cancelled = renderNotice(n("cancelled"), NOW);
    expect(cancelled).toEqual({ content: "La sortie **Gnomeregan** (ce soir 21:00) est annulée.", components: [] });
    const promoted = renderNotice(n("promoted", { role: "DPS", character: "Quillon" }), NOW);
    expect(promoted.content).toBe("Une place s'est libérée : tu es inscrit à **Gnomeregan** (ce soir 21:00) en DPS avec **Quillon**.");
    expect((promoted.components[0]!.components as Btn[])[0]).toMatchObject({ label: "Voir sur le site", url: base.url });
  });
});

describe("/sortie : heure", () => {
  it("aujourd'hui sauf « demain » ; dès que complet ; pas d'heure passée", () => {
    expect(parseOutingTime("21:00", NOW, TZ)).toEqual({ ok: true, day: "2026-11-19", at: new Date("2026-11-19T20:00:00Z") });
    expect(parseOutingTime("Ce soir 21h30", NOW, TZ)).toEqual({ ok: true, day: "2026-11-19", at: new Date("2026-11-19T20:30:00Z") });
    expect(parseOutingTime("demain 20h", NOW, TZ)).toEqual({ ok: true, day: "2026-11-20", at: new Date("2026-11-20T19:00:00Z") });
    expect(parseOutingTime("Dès que complet", NOW, TZ)).toEqual({ ok: true, day: "2026-11-19", at: null });
    expect(parseOutingTime("Demain, dès que complet", NOW, TZ)).toEqual({ ok: true, day: "2026-11-20", at: null });
    expect(parseOutingTime("21", NOW, TZ)).toMatchObject({ ok: true, day: "2026-11-19" });
    expect(parseOutingTime("14:00", NOW, TZ)).toEqual({ ok: false, error: "14:00 est déjà passé : écris « demain 14:00 », ou une heure à venir." });
    expect(parseOutingTime("25:00", NOW, TZ).ok).toBe(false);
    expect(parseOutingTime("tout à l'heure", NOW, TZ).ok).toBe(false);
  });
  it("complétion : dès que complet, les prochaines demi-heures, demain", () => {
    const all = outingTimeChoices("", NOW, TZ);
    expect(all.slice(0, 4)).toEqual(["Dès que complet", "Ce soir 18:30", "Ce soir 19:00", "Ce soir 19:30"]);
    expect(all).toContain("Demain 21:00");
    expect(outingTimeChoices("demain", NOW, TZ)).toEqual(["Demain, dès que complet", "Demain 18:00", "Demain 20:00", "Demain 21:00"]);
    expect(outingTimeChoices("21h45", NOW, TZ)).toEqual(["21h45"]);
  });
});

describe("relève des annonces", () => {
  it("publie, confirme la version et le jour du rendu, puis modifie le même message", async () => {
    const api = { outingsOutbox: vi.fn(async () => ({ outings: [view()] })), outingPublished: vi.fn(async () => ({ ok: true as const })) };
    const upsert = vi.fn(async (_v: OutingView, messageId: string | null) => ({ channelId: "300000000000000002", messageId: messageId ?? "300000000000000009" }));
    const sync = createOutingSync(api, { upsert }, { info() {}, warn() {} });
    await sync.tick();
    expect(api.outingPublished).toHaveBeenCalledWith(ID, { channelId: "300000000000000002", messageId: "300000000000000009", changedAt: view().changedAt, renderedOn: "2026-11-19" });
    await sync.publish(view());
    expect(upsert.mock.calls[1]![1]).toBe("300000000000000009");
  });
});
