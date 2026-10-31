import { describe, expect, it, vi } from "vitest";
import type { SiteAlertView } from "../src/api";
import { createSiteAlertSync, renderSiteAlert } from "../src/site-alerts";

const CHANNEL = "300000000000000002";
const TZ = "Europe/Paris";
const log = () => ({ info: vi.fn(), warn: vi.fn() });
// 13:12 UTC = 14:12 à Paris (heure d'hiver depuis le 25/10)
const alert = (over: Partial<SiteAlertView> = {}): SiteAlertView => ({
  id: 1, kind: "bot_down", text: "Le bot Discord ne répond plus depuis 10 min", at: "2026-10-29T13:12:00.000Z", channelId: CHANNEL, ...over,
});

describe("alertes de surveillance dans le salon des admins", () => {
  it("bot tombé : embed rouge, dernier signe de vie et heure de l'e-mail, posté au retour du bot", () => {
    const p = renderSiteAlert(alert(), TZ);
    const e = p.embeds[0]!;
    expect(e.title).toBe("Le bot Discord ne répond plus depuis 10 min");
    expect(e.color).toBe(0xed4245);
    expect(e.description).toBe("Dernier signe de vie : 14:02. Un e-mail est parti aux admins à 14:12.");
    expect(e.footer).toEqual({ text: "Message posté au retour du bot, pas avant" });
    expect(e.timestamp).toBe("2026-10-29T13:12:00.000Z");
    expect(p.components).toEqual([]);
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("bot de retour : embed vert, tout est rentré dans l'ordre", () => {
    const e = renderSiteAlert(alert({ id: 2, kind: "bot_up", text: "Le bot Discord répond à nouveau (coupure de 23 min)", at: "2026-10-29T13:25:00.000Z" }), TZ).embeds[0]!;
    expect(e.title).toBe("Le bot Discord répond à nouveau (coupure de 23 min)");
    expect(e.color).toBe(0x3ba55d);
    expect(e.description).toBe("Tout est rentré dans l'ordre.");
    expect(e.footer).toEqual({ text: "État du site : page Administration du site" });
  });

  it("sauvegarde en retard : rouge ; sauvegarde rétablie : vert", () => {
    const late = renderSiteAlert(alert({ id: 3, kind: "backup_late", text: "Pas de sauvegarde réussie depuis 26 h", at: "2026-10-30T04:12:00.000Z" }), TZ).embeds[0]!;
    expect(late.title).toBe("Pas de sauvegarde réussie depuis 26 h");
    expect(late.color).toBe(0xed4245);
    expect(late.description).toBe("La sauvegarde de nuit n'a rien signalé. Un e-mail est parti aux admins à 05:12.");
    expect(late.footer).toEqual({ text: "État du site : page Administration du site" });
    const ok = renderSiteAlert(alert({ id: 4, kind: "backup_ok", text: "Sauvegarde rétablie", at: "2026-10-31T03:12:00.000Z" }), TZ).embeds[0]!;
    expect(ok.title).toBe("Sauvegarde rétablie");
    expect(ok.color).toBe(0x3ba55d);
    expect(ok.description).toBe("Tout est rentré dans l'ordre.");
  });

  it("l'heure suit le fuseau du bot", () => {
    expect(renderSiteAlert(alert(), "UTC").embeds[0]!.description).toBe("Dernier signe de vie : 13:02. Un e-mail est parti aux admins à 13:12.");
  });

  it("relève : poste les alertes dans l'ordre reçu (la coupure, puis le retour) et confirme chacune", async () => {
    const down = alert();
    const up = alert({ id: 2, kind: "bot_up", text: "Le bot Discord répond à nouveau (coupure de 23 min)", at: "2026-10-29T13:25:00.000Z" });
    const order: string[] = [];
    const api = {
      siteAlertsOutbox: vi.fn(async () => ({ alerts: [down, up] })),
      siteAlertPosted: vi.fn(async (id: number) => { order.push(`posted ${id}`); return { ok: true as const }; }),
    };
    const post = vi.fn(async (a: SiteAlertView) => { order.push(`post ${a.id}`); });
    await createSiteAlertSync(api, { post }, log()).tick();
    expect(order).toEqual(["post 1", "posted 1", "post 2", "posted 2"]);
  });

  it("rien à poster : le bot ne fait rien (pas de salon des signalements, ou tout est déjà posté)", async () => {
    const api = { siteAlertsOutbox: vi.fn(async () => ({ alerts: [] as SiteAlertView[] })), siteAlertPosted: vi.fn(async (_id: number) => ({ ok: true as const })) };
    const post = vi.fn(async (_a: SiteAlertView) => {});
    const l = log();
    await createSiteAlertSync(api, { post }, l).tick();
    expect(post).not.toHaveBeenCalled();
    expect(api.siteAlertPosted).not.toHaveBeenCalled();
    expect(l.warn).not.toHaveBeenCalled();
  });

  it("un échec (salon supprimé, droits) : rien n'est confirmé, les suivantes attendent pour garder l'ordre, tout est retenté à la relève suivante", async () => {
    const alerts = [alert(), alert({ id: 2, kind: "bot_up", text: "Le bot Discord répond à nouveau (coupure de 23 min)" })];
    const api = { siteAlertsOutbox: vi.fn(async () => ({ alerts })), siteAlertPosted: vi.fn(async (_id: number) => ({ ok: true as const })) };
    const post = vi.fn<(a: SiteAlertView) => Promise<void>>(async () => { throw new Error("Salon inaccessible"); });
    const l = log();
    const sync = createSiteAlertSync(api, { post }, l);
    await sync.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(api.siteAlertPosted).not.toHaveBeenCalled();
    expect(l.warn).toHaveBeenCalledTimes(1);

    // Le salon est de nouveau joignable
    post.mockImplementation(async () => {});
    await sync.tick();
    expect(post).toHaveBeenCalledTimes(3);
    expect(api.siteAlertPosted.mock.calls.map(c => c[0])).toEqual([1, 2]);
  });

  it("deux relèves en même temps : la seconde attend la fin de la première (pas de double message)", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const api = { siteAlertsOutbox: vi.fn(async () => ({ alerts: [alert()] })), siteAlertPosted: vi.fn(async (_id: number) => ({ ok: true as const })) };
    const post = vi.fn(async (_a: SiteAlertView) => { await gate; });
    const sync = createSiteAlertSync(api, { post }, log());
    const first = sync.tick();
    await sync.tick();
    release();
    await first;
    expect(post).toHaveBeenCalledTimes(1);
  });
});
