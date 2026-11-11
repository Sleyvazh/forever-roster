import { sealText } from "@forever/game-data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, setup, signedIn, type TestEnv } from "./helpers";

/**
 * Version anglaise, lot E5 : l'API répond dans la langue de la page (en-tête X-Lang du site), sinon dans celle du compte :
 * messages d'erreur (variables comprises), messages de zod, résultats d'un import de l'addon, e-mails.
 */
let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

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
