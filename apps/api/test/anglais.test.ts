import { sealText } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groups, raids } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/**
 * Version anglaise, lot E5 : l'API répond dans la langue de la page (en-tête X-Lang du site), sinon dans celle du compte :
 * messages d'erreur (variables comprises), messages de zod, résultats d'un import de l'addon, e-mails.
 */
let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });
const bot = (method: string, url: string, headers: Record<string, string> = {}) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}`, ...headers } });

const EN = { "x-lang": "en" };

describe("messages de l'API en anglais", () => {
  it("erreurs : X-Lang, sinon la langue du compte ; français par défaut", async () => {
    const c = new Client(env);
    const bad = { email: "nobody@example.test", password: "a long enough password here" };
    expect((await c.req("POST", "/api/auth/login", bad)).json().error).toBe("E-mail ou mot de passe incorrect, ou trop de tentatives récentes.");
    expect((await c.req("POST", "/api/auth/login", bad, EN)).json().error).toBe("Wrong e-mail or password, or too many recent attempts.");
    // Variables d'un message, et message de validation (mot de passe)
    const short = await c.req("POST", "/api/auth/register", { email: "short@example.test", password: "short", displayName: "Short" }, EN);
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toBe("The password must be at least 12 characters long.");
    // Message de zod traduit dans « Données invalides » (texte de zod connu du catalogue)
    const { c: me } = await signedIn(env, "Aldwin");
    const absence = await me.req("POST", "/api/absences", { startDate: "11/11/2026", endDate: "2026-11-12" }, EN);
    expect(absence.statusCode).toBe(400);
    expect(absence.json().error).toBe("Invalid data (startDate): Date in YYYY-MM-DD format");
    // Langue du compte (sans en-tête) : l'appli Roster Companion, le bot
    expect((await me.patch("/api/account/preferences", { lang: "en" })).statusCode).toBe(200);
    expect((await me.get("/api/groups/00000000-0000-4000-8000-000000000000")).json().error).toMatch(/^[A-Z][a-z]+ [a-z]/);
    expect((await me.req("PATCH", "/api/account/preferences", {}, {})).json().error).toBe("Invalid data: Choose at least one setting to change.");
    expect((await me.req("PATCH", "/api/account/preferences", {}, { "x-lang": "fr" })).json().error).toBe("Données invalides : Choisis au moins un réglage à changer.");
  });

  it("jeton CSRF manquant : repère « csrf » pour le site, message dans la langue de la page", async () => {
    const { c } = await signedIn(env, "Brena");
    c.csrf = null;
    const r = await c.req("PATCH", "/api/account/preferences", { gameRelay: false }, EN);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: "Invalid CSRF token. Reload the page.", code: "csrf" });
  });

  it("e-mails dans la langue de la page d'inscription", async () => {
    const c = new Client(env);
    await c.req("POST", "/api/auth/register", { email: "corvin@example.test", password: "correct horse battery staple", displayName: "Corvin" }, EN);
    const mail = env.mailer.outbox.filter(m => m.to === "corvin@example.test").at(-1)!;
    expect(mail.subject).toBe("Confirm your e-mail address");
    expect(mail.text).toContain("Hello,");
    expect(mail.text).toContain("character and raid management for WoW Forever");
    expect(mail.html).toContain('<html lang="en">');
    expect(`${mail.text}${mail.html}`).not.toMatch(/Bonjour|Confirme|ton adresse|gestion de personnages/);
  });

  it("import de l'addon : résultats et erreurs de lecture en anglais", async () => {
    const { c } = await signedIn(env, "Dara");
    const at = Math.floor(Date.now() / 1000) - 60;
    const ok = await c.req("POST", "/api/addon/import",
      { text: sealText(`FRC;2;Dara;Forever EU;ROGUE;Undead;20;Horde;${at};1.7.1\nEND;0`) }, EN);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().results[0].message).toBe("sheet created");
    const bad = await c.req("POST", "/api/addon/import", { text: `FRC;9;Dara;Forever EU;ROGUE;Undead;20;Horde;${at};1.7.1\nEND;0` }, EN);
    expect(bad.json().errors).toEqual(["Dara: Unsupported export version (9): update the website or the addon."]);
  });
});

describe("langue du bot (lot E6)", () => {
  it("choisie à la création (langue de la page), changée par les officiers, journal, annonces redessinées", async () => {
    const { c: chef } = await signedIn(env, "Elwen");
    const g = (await chef.req("POST", "/api/groups", { name: "The Wardens" }, EN)).json().group;
    expect((await chef.get(`/api/groups/${g.id}`)).json().group.lang).toBe("en");
    const fr = (await chef.req("POST", "/api/groups", { name: "Les Veilleurs" }, { "x-lang": "fr" })).json().group;
    expect((await chef.get(`/api/groups/${fr.id}`)).json().group.lang).toBe("fr");

    const inv = (await chef.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    const { c: membre } = await signedIn(env, "Fenn");
    await membre.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect((await membre.put(`/api/groups/${g.id}/lang`, { lang: "fr" })).statusCode).toBe(403);
    expect((await chef.put(`/api/groups/${g.id}/lang`, { lang: "de" })).statusCode).toBe(400);

    // Raid publié sur Discord : changer la langue le fait redessiner par le bot
    await env.app.ctx.db.update(groups).set({ discordGuildId: "100000000000000001", discordChannelId: "100000000000000002" }).where(eq(groups.id, g.id));
    const raid = (await chef.post(`/api/groups/${g.id}/raids`, { name: "Molten Core", scheduledAt: new Date(Date.now() + 30 * 3600e3).toISOString() })).json().raid;
    await env.app.ctx.db.update(raids).set({ discordChannelId: "100000000000000002", discordMessageId: "100000000000000003", discordSyncedAt: new Date() }).where(eq(raids.id, raid.id));
    const pending = async () => (await bot("GET", "/internal/discord/outbox")).json().raids.filter((v: { raid: { id: string } }) => v.raid.id === raid.id);
    expect(await pending()).toEqual([]);
    await new Promise(ok => setTimeout(ok, 5));
    const r = await chef.put(`/api/groups/${g.id}/lang`, { lang: "fr" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ lang: "fr" });
    const [v] = await pending();
    expect(v.group).toMatchObject({ name: "The Wardens", lang: "fr" });
    const journal = (await chef.get(`/api/groups/${g.id}/audit`)).json().events;
    expect(journal[0]).toMatchObject({ type: "group_lang", meta: { lang: "fr" } });
  });

  it("le bot passe la langue de la guilde : X-Lang de l'API interne", async () => {
    const r = await bot("GET", "/internal/discord/raids/00000000-0000-4000-8000-000000000000/view", { "x-lang": "en" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toMatch(/^[A-Z][a-z]+ /);
    expect(r.json().error).not.toMatch(/introuvable/);
  });
});
