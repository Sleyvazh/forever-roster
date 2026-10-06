import { describe, expect, it, vi } from "vitest";
import type { Choices, RaidView } from "../src/api";
import { ApiError, InternalApi } from "../src/api";
import { zonedTime } from "@forever/game-data";
import { parseRaidDate } from "../src/dates";
import { confirmation, guestLabel, onCharPicked, onClassPicked, onStatus } from "../src/flow";
import { decodeId, encodeId, splitValue } from "../src/ids";
import { escapeMd, fitLines, renderAnnouncement, renderReminder } from "../src/render";
import { emojiName, iconFiles, makeLookup, specEmojiName, syncEmojis } from "../src/emojis";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSync } from "../src/sync";

const RAID = "0b6f6f3e-3d0a-4a1e-9a55-2f1f1d2c3b4a";
const CHAR = "5f0e8a2c-1111-4a1e-9a55-2f1f1d2c3b4a";
const TZ = "Europe/Paris";

const view = (over: Partial<RaidView> = {}): RaidView => ({
  raid: { id: RAID, name: "Molten Core", description: "RDV à Blackrock", scheduledAt: "2026-11-12T20:00:00.000Z", url: "https://x.test/groups/g/raids/r", changedAt: "2026-10-01T10:00:00.000Z" },
  group: { id: "g", name: "Les Testeurs" },
  channelId: "123456789012345678",
  messageId: null,
  signups: [
    { displayName: "Aldric", characterName: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank", status: "present", note: "", guest: false, group: null },
    { displayName: "Bob", characterName: null, cls: "Priest", spec: "Holy Heal", role: "Heal", status: "late", note: "", guest: true, group: null },
    { displayName: "Zed_*", characterName: null, cls: "", spec: "", role: null, status: "absent", note: "", guest: true, group: null },
    { displayName: "Ann", characterName: "Annie", cls: "Mage", spec: "Frost", role: "DPS", status: "tentative", note: "", guest: false, group: null },
  ],
  roster: null,
  ...over,
});

describe("identifiants de boutons", () => {
  it("aller-retour et refus des identifiants forgés", () => {
    for (const a of [{ a: "st", raidId: RAID, status: "present" }, { a: "off", raidId: RAID }, { a: "pick", raidId: RAID, status: "bench" }] as const) {
      expect(decodeId(encodeId(a))).toEqual(a);
    }
    expect(decodeId(`fr|st|${RAID}|admin`)).toBeNull();
    expect(decodeId(`fr|st|pas-un-uuid|present`)).toBeNull();
    expect(decodeId(`fr|zz|${RAID}|present`)).toBeNull();
    expect(decodeId(`fr|st|${RAID}|present|x`)).toBeNull();
    expect(decodeId(`autre|st|${RAID}|present`)).toBeNull();
    expect(encodeId({ a: "gspec", raidId: RAID, status: "tentative" }).length).toBeLessThanOrEqual(100);
    expect(splitValue(`${CHAR}:Feral Bear`)).toEqual([CHAR, "Feral Bear"]);
    expect(splitValue("sansdeuxpoints")).toBeNull();
  });
});

describe("dates de /raid", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("lit l'heure de Paris, heure d'été comme d'hiver", () => {
    expect(parseRaidDate("12/11/2026 21:00", now, TZ)).toEqual({ ok: true, date: new Date("2026-11-12T20:00:00Z") });
    expect(parseRaidDate("02/10 21h", now, TZ)).toEqual({ ok: true, date: new Date("2026-10-02T19:00:00Z") });
    expect(parseRaidDate("2026-10-02 20:45", now, TZ)).toEqual({ ok: true, date: new Date("2026-10-02T18:45:00Z") });
    expect(parseRaidDate("5/11/26 20h30", now, TZ)).toEqual({ ok: true, date: new Date("2026-11-05T19:30:00Z") });
  });
  it("sans année, prend la prochaine occurrence", () => {
    const r = parseRaidDate("15/01 21:00", now, TZ);
    expect(r.ok && r.date.toISOString()).toBe("2027-01-15T20:00:00.000Z");
  });
  it("refuse les dates impossibles, passées ou trop lointaines", () => {
    expect(parseRaidDate("31/02/2027 21:00", now, TZ).ok).toBe(false);
    expect(parseRaidDate("demain soir", now, TZ).ok).toBe(false);
    expect(parseRaidDate("01/09/2026 21:00", now, TZ).ok).toBe(false);
    expect(parseRaidDate("01/09/2030 21:00", now, TZ).ok).toBe(false);
    expect(parseRaidDate("12/11/2026 25:00", now, TZ).ok).toBe(false);
  });
  it("changement d'heure", () => {
    expect(zonedTime(2026, 10, 25, 1, 30, TZ)?.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(zonedTime(2026, 10, 25, 4, 0, TZ)?.toISOString()).toBe("2026-10-25T03:00:00.000Z");
  });
});

describe("annonce", () => {
  it("rôles, statuts, date Discord et boutons", () => {
    const p = renderAnnouncement(view());
    const e = p.embeds[0]!;
    expect(e.title).toBe("Molten Core");
    expect(e.description).toContain("<t:1794513600:F>");
    expect(e.fields?.[0]).toMatchObject({ name: "🛡️ Tank — 1", value: "**Tournicoti** · Feral Bear" });
    expect(e.fields?.[1]?.value).toBe("**Bob** · Holy Heal ⏰ ✱");
    expect(e.fields?.find(f => f.name.startsWith("Absent"))?.value).toBe("Zed\\_\\*");
    expect(e.fields?.find(f => f.name.startsWith("Peut-être"))?.value).toContain("Annie");
    expect(e.footer?.text).toBe("Les Testeurs · 2 inscrits · 2/9 classes · ✱ inscrit sans compte");
    expect(p.allowedMentions).toEqual({ parse: [] });
    const ids = p.components.flatMap(r => r.components).map(c => ("custom_id" in c ? c.custom_id : "url" in c ? c.url : ""));
    expect(ids).toContain(`fr|st|${RAID}|present`);
    expect(ids).toContain(`fr|off|${RAID}`);
    expect(ids).toContain("https://x.test/groups/g/raids/r");
    expect(p.components.every(r => r.components.length <= 5)).toBe(true);
  });
  it("neutralise mentions et mise en forme, et tronque les longues listes", () => {
    expect(escapeMd("@everyone")).toBe("@​everyone");
    const lines = Array.from({ length: 200 }, (_, i) => `**Joueur numéro ${i}** · Frost`);
    const out = fitLines(lines);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out).toMatch(/… et \d+ autres$/);
  });
});

describe("parcours d'inscription", () => {
  const specs = [{ name: "Balance", role: "DPS" }, { name: "Feral Cat", role: "DPS" }, { name: "Feral Bear", role: "Tank" }, { name: "Restoration", role: "Heal" }] as const;
  const member = (current: Choices["current"], n = 1): Choices => ({
    mode: "member", linked: true, current,
    characters: Array.from({ length: n }, (_, k) => ({ id: k ? `${CHAR.slice(0, -1)}${k}` : CHAR, name: `Perso${k}`, cls: "Druid", spec1: "Feral Cat", spec2: "Feral Bear", specs: [...specs] })),
  });

  it("déjà inscrit avec un perso : un clic change juste le statut", () => {
    const s = onStatus(RAID, "late", member({ status: "present", characterId: CHAR, cls: "Druid", spec: "Feral Bear" }));
    expect(s).toEqual({ kind: "signup", body: { status: "late", characterId: CHAR, spec: "Feral Bear" }, label: "Perso0 (Feral Bear)" });
  });
  it("première inscription : menu unique perso + spé, ou en deux temps s'il y a trop de choix", () => {
    const s = onStatus(RAID, "present", member(null));
    expect(s.kind).toBe("reply");
    const opts = s.kind === "reply" ? (s.components[0]!.components[0] as { options: { value: string }[] }).options : [];
    expect(opts.map(o => o.value)).toContain(`${CHAR}:Feral Bear`);
    const many = onStatus(RAID, "present", member(null, 7));
    expect(many.kind === "reply" && (many.components[0]!.components[0] as { custom_id: string }).custom_id).toBe(`fr|char|${RAID}|present`);
    const spec = onCharPicked(RAID, "present", member(null, 7), CHAR);
    expect(spec.kind === "reply" && (spec.components[0]!.components[0] as { custom_id: string }).custom_id).toBe(`fr|pick|${RAID}|present`);
  });
  it("absent sans perso, et « changer de perso » force le menu", () => {
    expect(onStatus(RAID, "absent", member(null))).toMatchObject({ kind: "signup", body: { status: "absent", characterId: null } });
    expect(onStatus(RAID, "present", member({ status: "present", characterId: CHAR, cls: "Druid", spec: "Feral Bear" }), true).kind).toBe("reply");
  });
  it("aucun perso sur le site", () => {
    const s = onStatus(RAID, "present", { mode: "member", linked: true, current: null, characters: [] });
    expect(s.kind === "reply" && s.content).toContain("Mes persos");
  });
  it("inscription libre : classe puis spé, puis simple changement de statut", () => {
    const s = onStatus(RAID, "present", { mode: "guest", linked: false, current: null });
    expect(s.kind === "reply" && s.content).toContain("sans compte");
    const sp = onClassPicked(RAID, "present", "Priest");
    const opts = sp.kind === "reply" ? (sp.components[0]!.components[0] as { options: { value: string }[] }).options : [];
    expect(opts[0]?.value).toBe("Priest:Discipline Heal");
    expect(onStatus(RAID, "bench", { mode: "guest", linked: true, current: { status: "present", characterId: null, cls: "Priest", spec: "Shadow" } }))
      .toEqual({ kind: "signup", body: { status: "bench", cls: "Priest", spec: "Shadow" }, label: "Shadow Priest" });
    expect(onClassPicked(RAID, "present", "Chevalier de la mort").kind).toBe("reply");
  });
  it("aucune option présélectionnée : la spé ou le perso actuel reste choisissable", () => {
    const cur = { status: "present" as const, characterId: CHAR, cls: "Druid", spec: "Feral Bear" };
    const steps = [
      onStatus(RAID, "present", member(cur), true), onStatus(RAID, "present", member(cur, 7), true),
      onCharPicked(RAID, "present", member(cur, 7), CHAR),
      onStatus(RAID, "present", { mode: "guest", linked: false, current: cur }, true),
    ];
    for (const s of steps) {
      const opts = s.kind === "reply" ? (s.components[0]!.components[0] as { options: { default?: boolean; description?: string; value: string }[] }).options : [];
      expect(opts.length).toBeGreaterThan(0);
      expect(opts.some(o => o.default)).toBe(false);
    }
    const spec = onCharPicked(RAID, "present", member(cur, 7), CHAR);
    const opts = spec.kind === "reply" ? (spec.components[0]!.components[0] as { options: { description?: string; value: string }[] }).options : [];
    expect(opts.find(o => o.value === `${CHAR}:Feral Bear`)?.description).toBe("Tank · off-spec · actuelle");
    expect(opts.find(o => o.value === `${CHAR}:Feral Cat`)?.description).toBe("DPS · spé principale");
  });
  it("confirmation", () => {
    const c = confirmation(RAID, "present", "Perso0 (Feral Bear)", "https://x.test");
    expect(c.content).toBe("✅ C'est noté : **Présent** avec Perso0 (Feral Bear).");
    expect(confirmation(RAID, "absent", "", "https://x.test").components[0]!.components).toHaveLength(1);
  });
});

describe("Roster (WoW Retail)", () => {
  const opts = (s: ReturnType<typeof onStatus>) => (s.kind === "reply" ? (s.components[0]!.components[0] as { options: { label: string; value: string }[] }).options : []);
  it("inscription libre : classes et spés de Retail, dans la langue du Discord du joueur", () => {
    const cls = opts(onStatus(RAID, "present", { mode: "guest", linked: false, current: null, game: "retail" }, false, "fr"));
    expect(cls).toHaveLength(13);
    expect(cls).toContainEqual(expect.objectContaining({ label: "Moine", value: "Monk" }));
    expect(opts(onClassPicked(RAID, "present", "Monk", "retail", "fr"))).toContainEqual(expect.objectContaining({ label: "Tisse-brume", value: "Monk:Mistweaver" }));
    expect(opts(onClassPicked(RAID, "present", "Monk", "retail", "en"))).toContainEqual(expect.objectContaining({ label: "Mistweaver", value: "Monk:Mistweaver" }));
    expect(onClassPicked(RAID, "present", "Monk").kind === "reply" && onClassPicked(RAID, "present", "Monk")).toMatchObject({ content: "Classe inconnue." });
    expect(guestLabel("retail", "fr", "Evoker", "Preservation")).toBe("Préservation Évocateur");
    expect(guestLabel("forever", "fr", "Priest", "Shadow")).toBe("Shadow Priest");
  });
  it("persos : spés traduites, valeur en anglais", () => {
    const c: Choices = { mode: "member", linked: true, current: null, game: "retail",
      characters: [{ id: CHAR, name: "Brumelune", cls: "Monk", spec1: "Mistweaver", spec2: "", specs: [{ name: "Mistweaver", role: "Heal" }, { name: "Windwalker", role: "DPS" }] }] };
    expect(opts(onStatus(RAID, "present", c, false, "fr"))).toContainEqual(expect.objectContaining({ label: "Brumelune — Tisse-brume", value: `${CHAR}:Mistweaver` }));
  });
  it("annonce : difficulté, noms en français, 13 classes", () => {
    const v = view({
      raid: { ...view().raid, name: "Flèche du Vide", difficulty: "heroic", size: 20 },
      group: { id: "g", name: "Pasta e Basta", game: "retail" },
      signups: [{ displayName: "Lia", characterName: "Brumelune", cls: "Monk", spec: "Mistweaver", role: "Heal", status: "present", note: "", guest: false, group: null }],
    });
    const e = renderAnnouncement(v).embeds[0]!;
    expect(e.title).toBe("Flèche du Vide · Héroïque");
    expect(JSON.stringify(e.fields)).toContain("Tisse-brume");
    expect(e.footer?.text).toContain("1/13 classes");
  });
});

describe("synchronisation", () => {
  const setup = () => {
    const api = { outbox: vi.fn(), published: vi.fn(async () => ({ ok: true as const })), deletionDone: vi.fn(async () => ({ ok: true as const })) };
    const pub = { upsert: vi.fn(async (_v: RaidView, m: string | null) => ({ channelId: "123456789012345678", messageId: m ?? "999999999999999999" })), remove: vi.fn(async () => {}) };
    const log = { info: vi.fn(), warn: vi.fn() };
    let t = 0;
    const sync = createSync(api, pub, log, () => t);
    return { api, pub, sync, advance: (ms: number) => { t += ms; } };
  };

  it("publie, confirme la version, et ne double pas un message pas encore enregistré", async () => {
    const { api, pub, sync } = setup();
    await Promise.all([sync.publish(view()), sync.publish(view())]);
    expect(pub.upsert).toHaveBeenNthCalledWith(1, expect.anything(), null);
    expect(pub.upsert).toHaveBeenNthCalledWith(2, expect.anything(), "999999999999999999");
    expect(api.published).toHaveBeenCalledWith(RAID, { channelId: "123456789012345678", messageId: "999999999999999999", changedAt: "2026-10-01T10:00:00.000Z" });
  });

  it("supprime les messages en file et réessaie plus tard en cas d'échec", async () => {
    const { api, pub, sync, advance } = setup();
    api.outbox.mockResolvedValue({ raids: [view()], deletions: [{ id: 7, channelId: "1", messageId: "2" }] });
    pub.upsert.mockRejectedValueOnce(new Error("Missing Access"));
    await sync.tick();
    expect(pub.remove).toHaveBeenCalledWith("1", "2");
    expect(api.deletionDone).toHaveBeenCalledWith(7);
    expect(api.published).not.toHaveBeenCalled();
    await sync.tick(); // encore en attente
    expect(pub.upsert).toHaveBeenCalledTimes(1);
    advance(16e3);
    await sync.tick();
    expect(pub.upsert).toHaveBeenCalledTimes(2);
    expect(api.published).toHaveBeenCalledTimes(1);
  });
});

describe("client de l'API interne", () => {
  it("envoie le secret et relaie les messages d'erreur du site", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "Réservé aux officiers du groupe." }), { status: 403 }));
    const api = new InternalApi("http://api:3001", "s".repeat(40), f as unknown as typeof fetch);
    await expect(api.view(RAID)).rejects.toEqual(new ApiError(403, "Réservé aux officiers du groupe."));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://api:3001/internal/discord/raids/${RAID}/view`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(40)}`);
    const down = new InternalApi("http://api:3001", "x", (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    await expect(down.outbox()).rejects.toMatchObject({ status: 503 });
  });
});

describe("compo publiée, rappels et émojis", () => {
  const emoji = makeLookup(new Map([["fr_druid", "11"], ["fr_druid_2", "22"], ["fr_mage", "33"], ["fr_druid_feral_cat", "44"]]));

  it("émoji de la spé, sinon de la classe", () => {
    expect(emojiName("Druid", 1)).toBe("fr_druid_2");
    expect(emoji("Druid", "Feral Bear")).toBe("<:fr_druid_2:22>"); // repli sur l'ancien émoji d'arbre
    expect(emoji("Druid", "Feral Cat")).toBe("<:fr_druid_feral_cat:44>");
    expect(specEmojiName("Shaman", "Enhancement Tank")).toBe("fr_shaman_enhancement_tank");
    expect(emoji("Druid", "Balance")).toBe("<:fr_druid:11>");
    expect(emoji("Mage", "Frost")).toBe("<:fr_mage:33>");
    expect(emoji("Priest", "Shadow")).toBe("");
  });

  it("l'annonce montre les groupes de la compo validée et les inscrits non placés", () => {
    const base = view();
    const v = view({
      signups: base.signups.map(s => (s.characterName === "Tournicoti" ? { ...s, group: 2 } : s)),
      roster: { groups: [{ group: 2, members: [{ name: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank" }] }] },
    });
    const f = renderAnnouncement(v, emoji).embeds[0]!.fields!;
    expect(f[0]).toMatchObject({ name: "✅ Compo validée — 1/40", value: "🛡️ 1 Tank · ✚ 0 Heal · ⚔️ 0 DPS" });
    expect(f[1]).toEqual({ name: "Groupe 2", value: "<:fr_druid_2:22> **Tournicoti** · Feral Bear", inline: true });
    expect(f[2]).toMatchObject({ name: "Inscrits non placés — 1", value: "**Bob** · Holy Heal ⏰ ✱" });
    expect(f.some(x => x.name.startsWith("🛡️ Tank"))).toBe(false);
  });

  it("rappel en message privé", () => {
    const r = renderReminder(view({ roster: { groups: [] } }), { discordUserId: "1", status: "present", name: "Tournicoti", cls: "Druid", spec: "Feral Bear", guest: false, group: 3 }, emoji);
    const d = r.embeds[0]!.description!;
    expect(r.embeds[0]!.title).toBe("Rappel : Molten Core");
    expect(d).toContain("Tu es inscrit : **Présent** avec <:fr_druid_2:22> **Tournicoti** (Feral Bear).");
    expect(d).toContain("groupe 3");
    expect(r.components.flatMap(c => c.components)).toHaveLength(8);
    const g = renderReminder(view(), { discordUserId: "2", status: "late", name: "Bob", cls: "Priest", spec: "Shadow", guest: true, group: null });
    expect(g.embeds[0]!.footer!.text).toContain("Me désinscrire");
  });

  it("icônes de rôle du jeu en émojis, sinon les émojis habituels", async () => {
    const withRoles = makeLookup(new Map([["fr_druid_2", "22"], ["fr_role_tank", "61"], ["fr_role_heal", "62"], ["fr_role_dps", "63"]]));
    expect(withRoles.role?.("Tank")).toBe("<:fr_role_tank:61>");
    expect(emoji.role?.("Tank")).toBe("");
    const f = renderAnnouncement(view(), withRoles).embeds[0]!.fields!;
    expect(f.slice(0, 3).map(x => x.name)).toEqual(["<:fr_role_tank:61> 1", "<:fr_role_heal:62> 1", "<:fr_role_dps:63> 0"]);
    const v = view({ roster: { groups: [{ group: 1, members: [{ name: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank" }] }] } });
    expect(renderAnnouncement(v, withRoles).embeds[0]!.fields![0]!.value).toBe("<:fr_role_tank:61> 1 · <:fr_role_heal:62> 0 · <:fr_role_dps:63> 0");
    const dir = await mkdtemp(path.join(tmpdir(), "roles-"));
    await mkdir(path.join(dir, "roles"));
    for (const f of ["dps.png", "heal.png", "tank.png", "autre.png"]) await writeFile(path.join(dir, "roles", f), "png");
    expect((await iconFiles(dir)).map(x => x.name)).toEqual(["fr_role_dps", "fr_role_heal", "fr_role_tank"]);
  });

  it("envoie à Discord les icônes manquantes, une seule fois", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "icons-"));
    await mkdir(path.join(dir, "class")); await mkdir(path.join(dir, "tree")); await mkdir(path.join(dir, "spec"));
    await writeFile(path.join(dir, "spec", "druid-feral-bear.png"), "png");
    await writeFile(path.join(dir, "spec", "druid-inconnue.png"), "png");
    await writeFile(path.join(dir, "class", "warlock.png"), "png");
    await writeFile(path.join(dir, "tree", "warlock-1.png"), "png");
    await writeFile(path.join(dir, "tree", "inconnu-1.png"), "png");
    await writeFile(path.join(dir, "class", "druid.png"), Buffer.alloc(300 * 1024));
    expect((await iconFiles(dir)).map(f => f.name)).toEqual(["fr_druid", "fr_warlock", "fr_druid_feral_bear", "fr_warlock_1"]);
    const created: string[] = [];
    const api = { list: vi.fn(async () => [{ id: "9", name: "fr_warlock" }, { id: "8", name: "autre" }]), create: vi.fn(async (name: string) => { created.push(name); return { id: "10", name }; }) };
    const log = vi.fn();
    const ids = await syncEmojis(dir, api, log);
    expect(created).toEqual(["fr_druid_feral_bear", "fr_warlock_1"]); // warlock déjà là, druid trop lourd
    expect([...ids]).toEqual([["fr_warlock", "9"], ["fr_druid_feral_bear", "10"], ["fr_warlock_1", "10"]]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("trop lourde"));
    expect(await iconFiles(path.join(dir, "absent"))).toEqual([]);
  });
});
