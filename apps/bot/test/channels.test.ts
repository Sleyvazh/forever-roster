import { describe, expect, it, vi } from "vitest";
import type { ChannelName, LinkedChannel } from "../src/api";
import {
  createChannelNamer, ERR_ACCESS, ERR_NOT_FOUND, ERR_OTHER, ERR_PERMISSION, RENAME_REASON, renameError, RETRY_AFTER_ERROR_MS, templateLinkedReply,
  type NamedChannel,
} from "../src/channels";

const T1 = "1b2c3d4e-5555-4a1e-9a55-2f1f1d2c3b4a", T2 = "2b2c3d4e-5555-4a1e-9a55-2f1f1d2c3b4a";
const GUILD = "400000000000000001";
const target = (over: Partial<ChannelName> = {}): ChannelName => ({ templateId: T1, guildId: GUILD, channelId: "400000000000000002", name: "jeudi-15-10", ...over });
const quiet = { info: () => {}, warn: () => {} };
/** Erreur de l'API de Discord (même forme que DiscordAPIError : un code numérique). */
const discordError = (code: number, message: string) => Object.assign(new Error(message), { code });

/** Faux salon : garde son nom, compte les renommages, peut échouer. */
function fakeChannel(name: string, fail?: () => Error): NamedChannel & { renames: [string, string][] } {
  const ch = {
    name, guildId: GUILD, renames: [] as [string, string][],
    async setName(n: string, reason: string) {
      if (fail) throw fail();
      ch.renames.push([n, reason]);
      ch.name = n;
      return ch;
    },
  };
  return ch;
}

function setup(list: ChannelName[], channels: Record<string, NamedChannel | null | Error>, linked: LinkedChannel[] = [], log = quiet) {
  let clock = Date.parse("2026-10-15T10:00:00Z");
  const api = {
    channelNames: vi.fn(async () => list),
    channelReport: vi.fn(async (_id: string, _b: { channelId: string; name: string | null; error: string | null }) => ({ ok: true })),
    linkedChannels: vi.fn(async () => linked),
    channelName: vi.fn(async (_b: { kind: LinkedChannel["kind"]; id: string; channelId: string; name: string }) => ({ ok: true, changed: true })),
  };
  const fetchChannel = vi.fn(async (id: string) => {
    const c = channels[id];
    if (c instanceof Error) throw c;
    return c ?? null;
  });
  const namer = createChannelNamer(api, fetchChannel, log, () => clock);
  return { api, fetchChannel, namer, advance: (ms: number) => { clock += ms; } };
}

describe("salons des raids récurrents", () => {
  it("renomme le salon avec la date du raid courant, puis ne fait plus rien tant que le nom est bon", async () => {
    const ch = fakeChannel("molten-core");
    const s = setup([target()], { "400000000000000002": ch });
    await s.namer.tick();
    expect(ch.renames).toEqual([["jeudi-15-10", RENAME_REASON]]);
    expect(s.api.channelReport).toHaveBeenCalledWith(T1, { channelId: "400000000000000002", name: "jeudi-15-10", error: null });
    // Tour suivant : déjà le bon nom, rien à renommer ni à rapporter
    await s.namer.tick();
    expect(ch.renames).toHaveLength(1);
    expect(s.api.channelReport).toHaveBeenCalledTimes(1);
  });

  it("salon déjà au bon nom : seulement le rapport du nom au site", async () => {
    const ch = fakeChannel("jeudi-15-10");
    const s = setup([target()], { "400000000000000002": ch });
    await s.namer.tick();
    expect(ch.renames).toEqual([]);
    expect(s.api.channelReport).toHaveBeenCalledWith(T1, { channelId: "400000000000000002", name: "jeudi-15-10", error: null });
  });

  it("sans « Gérer les salons » : erreur rapportée, pas de nouvel essai avant une heure", async () => {
    const ch = fakeChannel("molten-core", () => discordError(50013, "Missing Permissions"));
    const s = setup([target()], { "400000000000000002": ch });
    await s.namer.tick();
    expect(s.api.channelReport).toHaveBeenLastCalledWith(T1, { channelId: "400000000000000002", name: "molten-core", error: ERR_PERMISSION });
    expect(ERR_PERMISSION).toBe("Le bot ne peut pas renommer ce salon : donne-lui la permission « Gérer les salons » sur ce salon.");
    s.fetchChannel.mockClear();
    s.advance(RETRY_AFTER_ERROR_MS - 60e3);
    await s.namer.tick();
    expect(s.fetchChannel).not.toHaveBeenCalled();
    // Une heure après : nouvel essai ; la permission a été donnée entre-temps
    s.advance(60e3);
    const ok = fakeChannel("molten-core");
    s.fetchChannel.mockImplementation(async () => ok);
    await s.namer.tick();
    expect(ok.renames).toEqual([["jeudi-15-10", RENAME_REASON]]);
    expect(s.api.channelReport).toHaveBeenLastCalledWith(T1, { channelId: "400000000000000002", name: "jeudi-15-10", error: null });
  });

  it("salon supprimé ou d'un autre serveur : « Salon introuvable »", async () => {
    const elsewhere = { ...fakeChannel("jeudi-15-10"), guildId: "499999999999999999" };
    const s = setup([target(), target({ templateId: T2, channelId: "400000000000000003" })], {
      "400000000000000002": discordError(10003, "Unknown Channel"), "400000000000000003": elsewhere,
    });
    await s.namer.tick();
    expect(s.api.channelReport).toHaveBeenCalledWith(T1, { channelId: "400000000000000002", name: null, error: ERR_NOT_FOUND });
    expect(s.api.channelReport).toHaveBeenCalledWith(T2, { channelId: "400000000000000003", name: null, error: ERR_NOT_FOUND });
    expect(ERR_NOT_FOUND).toBe("Salon introuvable : lie un autre salon.");
  });

  it("une erreur sur un salon n'empêche pas les autres ; un raid récurrent retiré de la liste repart de zéro", async () => {
    const broken = fakeChannel("a", () => new Error("réseau"));
    const fine = fakeChannel("b");
    const list = [target({ channelId: "400000000000000002" }), target({ templateId: T2, channelId: "400000000000000003", name: "dimanche-18-10" })];
    const s = setup(list, { "400000000000000002": broken, "400000000000000003": fine });
    await s.namer.tick();
    expect(fine.renames).toEqual([["dimanche-18-10", RENAME_REASON]]);
    expect(s.api.channelReport).toHaveBeenCalledWith(T1, { channelId: "400000000000000002", name: "a", error: ERR_OTHER });
    // Renommage coupé puis remis sur le site (le raid récurrent sort de la liste puis revient) : nouvel essai tout de suite
    s.api.channelNames.mockResolvedValueOnce([list[1]!]);
    await s.namer.tick();
    s.fetchChannel.mockClear();
    await s.namer.tick();
    expect(s.fetchChannel).toHaveBeenCalledWith("400000000000000002");
  });

  it("ne touche qu'aux salons que donne l'API", async () => {
    const s = setup([], { "400000000000000002": fakeChannel("general") });
    await s.namer.tick();
    expect(s.fetchChannel).not.toHaveBeenCalled();
    expect(s.api.channelReport).not.toHaveBeenCalled();
    expect(s.api.channelName).not.toHaveBeenCalled();
  });

  it("messages d'erreur de Discord en français", () => {
    expect(renameError(discordError(50013, "Missing Permissions"))).toBe(ERR_PERMISSION);
    expect(renameError(discordError(10003, "Unknown Channel"))).toBe(ERR_NOT_FOUND);
    expect(renameError(discordError(50001, "Missing Access"))).toBe(ERR_ACCESS);
    expect(renameError(new Error("?"))).toBe(ERR_OTHER);
    expect(renameError(null)).toBe(ERR_OTHER);
  });

  it("réponse de /forever-lier : nom à venir, permission manquante, renommage coupé", () => {
    expect(templateLinkedReply({ name: "Molten Core", rename: true, next: "jeudi-15-10" }, true))
      .toBe("✅ Ce salon reçoit maintenant les annonces du raid récurrent « Molten Core ». Il prendra le nom du prochain raid (ici jeudi-15-10).");
    const noPerm = templateLinkedReply({ name: "Molten Core", rename: true, next: null }, false);
    expect(noPerm).toContain("(ex. jeudi-15-10)");
    expect(noPerm.split("\n")[1]).toContain("« Gérer les salons » sur ce salon");
    expect(templateLinkedReply({ name: "Onyxia", rename: false }, false))
      .toBe("✅ Ce salon reçoit maintenant les annonces du raid récurrent « Onyxia ». Son nom ne change pas : le renommage est coupé sur le site.");
  });
});

describe("nom des salons liés (groupe, commandes, raids récurrents)", () => {
  const G1 = "3b2c3d4e-5555-4a1e-9a55-2f1f1d2c3b4a";
  const linked = (over: Partial<LinkedChannel> = {}): LinkedChannel => ({ kind: "group", id: G1, guildId: GUILD, channelId: "400000000000000010", name: "raids", ...over });

  it("nom changé sur Discord : un rapport ; nom identique : aucun", async () => {
    const s = setup([], { "400000000000000010": fakeChannel("raids-du-jeudi"), "400000000000000011": fakeChannel("commandes") }, [
      linked(), linked({ kind: "orders", channelId: "400000000000000011", name: "commandes" }),
    ]);
    await s.namer.tick();
    expect(s.api.channelName).toHaveBeenCalledTimes(1);
    expect(s.api.channelName).toHaveBeenCalledWith({ kind: "group", id: G1, channelId: "400000000000000010", name: "raids-du-jeudi" });
  });

  it("nom encore inconnu du site (salon lié avant) : rapporté", async () => {
    const s = setup([], { "400000000000000011": fakeChannel("commandes") }, [linked({ kind: "orders", channelId: "400000000000000011", name: null })]);
    await s.namer.tick();
    expect(s.api.channelName).toHaveBeenCalledWith({ kind: "orders", id: G1, channelId: "400000000000000011", name: "commandes" });
  });

  it("salon introuvable, invisible ou d'un autre serveur : aucun rapport, rien au journal ; les autres salons continuent", async () => {
    const warn = vi.fn();
    const elsewhere = { ...fakeChannel("ailleurs"), guildId: "499999999999999999" };
    const list = [
      linked({ channelId: "400000000000000020" }), linked({ channelId: "400000000000000021" }), linked({ channelId: "400000000000000022" }),
      linked({ channelId: "400000000000000023" }), linked({ kind: "template", id: T1, channelId: "400000000000000024", name: "jeudi-15-10" }),
    ];
    const s = setup([], {
      "400000000000000020": discordError(10003, "Unknown Channel"), "400000000000000021": discordError(50001, "Missing Access"),
      "400000000000000022": null, "400000000000000023": elsewhere, "400000000000000024": fakeChannel("vendredi-16-10"),
    }, list, { info: () => {}, warn });
    await s.namer.tick();
    expect(s.api.channelName).toHaveBeenCalledTimes(1);
    expect(s.api.channelName).toHaveBeenCalledWith({ kind: "template", id: T1, channelId: "400000000000000024", name: "vendredi-16-10" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("une erreur (réseau, site) sur un salon n'arrête pas les autres", async () => {
    const s = setup([], { "400000000000000030": new Error("réseau"), "400000000000000031": fakeChannel("b"), "400000000000000032": fakeChannel("c") }, [
      linked({ channelId: "400000000000000030" }), linked({ channelId: "400000000000000031" }), linked({ channelId: "400000000000000032" }),
    ]);
    s.api.channelName.mockRejectedValueOnce(new Error("site indisponible"));
    await s.namer.tick();
    expect(s.api.channelName.mock.calls.map(([b]) => b.channelId)).toEqual(["400000000000000031", "400000000000000032"]);
  });

  it("après un renommage du salon d'un raid récurrent : pas de second rapport", async () => {
    const ch = fakeChannel("molten-core");
    // L'API donne déjà le nouveau nom (rapporté par le renommage, juste avant)
    const s = setup([target()], { "400000000000000002": ch }, [linked({ kind: "template", id: T1, channelId: "400000000000000002", name: "jeudi-15-10" })]);
    await s.namer.tick();
    expect(ch.renames).toEqual([["jeudi-15-10", RENAME_REASON]]);
    expect(s.api.channelReport).toHaveBeenCalledTimes(1);
    expect(s.api.channelName).not.toHaveBeenCalled();
  });
});
