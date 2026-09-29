import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, ORIGIN, safeJson, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

const PASSWORD = "correct horse battery staple";

describe("inscription et connexion", () => {
  it("impose la confirmation de l'e-mail avant la connexion", async () => {
    const c = new Client(env);
    const reg = await c.post("/api/auth/register", { email: "Thrall@Example.test", password: PASSWORD, displayName: "Thrall" });
    expect(reg.statusCode).toBe(202);

    const early = await c.post("/api/auth/login", { email: "thrall@example.test", password: PASSWORD });
    expect(early.statusCode).toBe(403);

    const mail = env.mailer.outbox.find(m => m.to === "thrall@example.test")!;
    expect(mail.text).toContain(`${ORIGIN}/verify-email#`);
    expect((await c.post("/api/auth/verify-email", { token: tokenFrom(mail.text) })).statusCode).toBe(200);
    // Un lien ne sert qu'une fois
    expect((await c.post("/api/auth/verify-email", { token: tokenFrom(mail.text) })).statusCode).toBe(400);

    const ok = await c.post("/api/auth/login", { email: "THRALL@example.test", password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find(k => k.name === "fr_sid")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(ok.json().user).not.toHaveProperty("passwordHash");

    const me = await c.get("/api/auth/me");
    expect(me.json().user.displayName).toBe("Thrall");
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("ne révèle pas si une adresse a déjà un compte", async () => {
    const c = new Client(env);
    const first = await c.post("/api/auth/register", { email: "jaina@example.test", password: PASSWORD, displayName: "Jaina" });
    const again = await c.post("/api/auth/register", { email: "jaina@example.test", password: PASSWORD, displayName: "Autre" });
    expect(again.statusCode).toBe(first.statusCode);
    expect(again.json()).toEqual(first.json());
    const forgotKnown = await c.post("/api/auth/forgot-password", { email: "jaina@example.test" });
    const forgotUnknown = await c.post("/api/auth/forgot-password", { email: "nobody@example.test" });
    expect(forgotKnown.json()).toEqual(forgotUnknown.json());
  });

  it("refuse les mots de passe faibles", async () => {
    const c = new Client(env);
    const short = await c.post("/api/auth/register", { email: "a@example.test", password: "court", displayName: "Abc" });
    expect(short.statusCode).toBe(400);
    const withEmail = await c.post("/api/auth/register", { email: "garrosh@example.test", password: "garrosh-hellscream", displayName: "Garrosh" });
    expect(withEmail.statusCode).toBe(400);
  });

  it("verrouille le compte après 10 échecs, sans le dire à l'attaquant", async () => {
    const { email, password } = await signedIn(env, "Victime");
    const attacker = new Client(env);
    for (let i = 0; i < 10; i++) {
      const r = await attacker.post("/api/auth/login", { email, password: "mauvais mot de passe" });
      expect(r.statusCode).toBe(401);
    }
    const locked = await attacker.post("/api/auth/login", { email, password });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error).toBe((await attacker.post("/api/auth/login", { email: "inconnu@example.test", password })).json().error);
  });
});

describe("protections de session", () => {
  it("rejette une requête sans jeton CSRF ou venant d'une autre origine", async () => {
    const { c } = await signedIn(env);
    const noToken = await c.req("POST", "/api/groups", { name: "Test" }, { "x-csrf-token": "" });
    expect(noToken.statusCode).toBe(403);
    const evil = await c.req("POST", "/api/groups", { name: "Test" }, { origin: "https://evil.test" });
    expect(evil.statusCode).toBe(403);
    const ok = await c.post("/api/groups", { name: "Test" });
    expect(ok.statusCode).toBe(201);
  });

  it("révoque la session à la déconnexion", async () => {
    const { c } = await signedIn(env);
    const saved = new Map(c.cookies);
    await c.post("/api/auth/logout");
    const replay = new Client(env); replay.cookies = saved;
    expect((await replay.get("/api/auth/me")).json().user).toBeNull();
  });

  it("liste et révoque les autres sessions", async () => {
    const { c, email, password } = await signedIn(env);
    const other = new Client(env);
    await other.post("/api/auth/login", { email, password });
    const list = await c.get("/api/account/sessions");
    expect(list.json().sessions).toHaveLength(2);
    expect((await c.post("/api/account/sessions/revoke-others")).json().revoked).toBe(1);
    expect((await other.get("/api/auth/me")).json().user).toBeNull();
    expect((await c.get("/api/auth/me")).json().user).not.toBeNull();
  });

  it("la réinitialisation du mot de passe ferme toutes les sessions", async () => {
    const { c, email } = await signedIn(env);
    await new Client(env).post("/api/auth/forgot-password", { email });
    const mail = env.mailer.outbox.filter(m => m.to === email).at(-1)!;
    const reset = await new Client(env).post("/api/auth/reset-password", { token: tokenFrom(mail.text), password: "un tout nouveau mot de passe" });
    expect(reset.statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().user).toBeNull();
    const again = new Client(env);
    expect((await again.post("/api/auth/login", { email, password: "un tout nouveau mot de passe" })).statusCode).toBe(200);
    const events = await again.get("/api/account/audit");
    expect(events.json().events.map((e: { type: string }) => e.type)).toContain("password_reset");
  });
});

describe("liens envoyés par e-mail", () => {
  it("un nouveau lien annule les précédents, et un lien utilisé annule les autres", async () => {
    const { email } = await signedIn(env, "Oublieux");
    const anon = new Client(env);
    await anon.post("/api/auth/forgot-password", { email });
    await anon.post("/api/auth/forgot-password", { email });
    const [first, second] = env.mailer.outbox.filter(m => m.to === email && m.subject.includes("Réinitialisation")).slice(-2).map(m => tokenFrom(m.text));
    expect((await anon.post("/api/auth/reset-password", { token: first, password: "un mot de passe tout neuf" })).statusCode).toBe(400);
    expect((await anon.post("/api/auth/reset-password", { token: second, password: "un mot de passe tout neuf" })).statusCode).toBe(200);
    expect((await anon.post("/api/auth/reset-password", { token: second, password: "encore un autre mot de passe" })).statusCode).toBe(400);
  });

  it("changer son mot de passe annule un lien de réinitialisation en attente", async () => {
    const { c, email, password } = await signedIn(env, "Prudent");
    await new Client(env).post("/api/auth/forgot-password", { email });
    const link = env.mailer.outbox.filter(m => m.to === email).at(-1)!;
    expect((await c.post("/api/account/password", { currentPassword: password, newPassword: "phrase de passe changee ce soir" })).statusCode).toBe(200);
    expect((await new Client(env).post("/api/auth/reset-password", { token: tokenFrom(link.text), password: "tentative apres changement" })).statusCode).toBe(400);
  });
});

describe("Have I Been Pwned", () => {
  it("refuse un mot de passe présent dans une fuite (seul le préfixe du hash est envoyé)", async () => {
    const local = await setup({ HIBP_CHECK: "true" });
    let calledUrl = "";
    // SHA-1("correct horse battery staple") = ABF7AAD6438836DBE526AA231ABDE2D0EEF74D42
    local.fetchMock.impl = (async (url: string | URL | Request) => {
      calledUrl = String(url);
      return new Response("AD6438836DBE526AA231ABDE2D0EEF74D42:3\r\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0", { status: 200 });
    }) as typeof fetch;
    const r = await new Client(local).post("/api/auth/register", { email: "pwned@example.test", password: PASSWORD, displayName: "Pwned" });
    expect(calledUrl).toBe("https://api.pwnedpasswords.com/range/ABF7A");
    expect(r.statusCode).toBe(400);
    await local.close();
    env = await setup();
  });
});

describe("Battle.net", () => {
  function mockBnet(id: number, battletag: string) {
    env.fetchMock.impl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/token")) return Response.json({ access_token: "at", token_type: "bearer" });
      if (u.endsWith("/userinfo")) return Response.json({ sub: String(id), id, battletag });
      return new Response("", { status: 404 });
    }) as typeof fetch;
  }

  it("crée un compte et ouvre une session via OAuth, avec un state vérifié", async () => {
    mockBnet(4242, "Tournicoti#2112");
    const c = new Client(env);
    const start = await c.get("/api/auth/battlenet/start");
    expect(start.statusCode).toBe(302);
    const loc = new URL(start.headers.location as string);
    expect(loc.origin).toBe("https://oauth.bnet.test");
    const state = loc.searchParams.get("state")!;

    const cb = await c.get(`/api/auth/battlenet/callback?code=abc&state=${state}`);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(`${ORIGIN}/`);
    const me = (await c.get("/api/auth/me")).json();
    expect(me.user.battletag).toBe("Tournicoti#2112");
    expect(me.user.hasPassword).toBe(false);
  });

  it("refuse un callback dont le state ne vient pas de ce navigateur", async () => {
    mockBnet(5151, "Intrus#1");
    const victim = new Client(env), attacker = new Client(env);
    const start = await attacker.get("/api/auth/battlenet/start");
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const cb = await victim.get(`/api/auth/battlenet/callback?code=abc&state=${state}`);
    expect(cb.headers.location).toBe(`${ORIGIN}/login?error=bnet_state`);
    expect(safeJson(await victim.get("/api/auth/me")).user).toBeNull();
  });
});

describe("e-mails", () => {
  it("envoie texte + HTML sans y insérer de contenu choisi par l'utilisateur", async () => {
    const c = new Client(env);
    await c.post("/api/auth/register", { email: "piege@example.test", password: PASSWORD, displayName: "Clique ici evil.test" });
    const mail = env.mailer.outbox.filter(m => m.to === "piege@example.test").at(-1)!;
    expect(mail.html).toContain("Confirmer mon adresse");
    expect(mail.text).toContain(`${ORIGIN}/verify-email#`);
    expect(mail.text + mail.html).not.toContain("evil.test");
  });
});
