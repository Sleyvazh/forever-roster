import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Un site, deux adresses : Forever Roster (APP_ORIGIN) et Roster (RETAIL_ORIGIN), mêmes comptes. */
const RETAIL = "http://roster.test";

class RetailClient extends Client {
  override req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.req(method, url, body, { host: "roster.test", origin: RETAIL, ...headers });
  }
}

let env: TestEnv;
beforeAll(async () => { env = await setup({ RETAIL_ORIGIN: RETAIL }); });
afterAll(async () => { await env.close(); });

describe("un site, deux adresses", () => {
  it("chaque adresse se présente avec son jeu et désigne l'autre", async () => {
    const f = await new Client(env).get("/api/site");
    expect(f.json()).toMatchObject({ game: "forever", name: "Forever Roster", open: true, other: { game: "retail", name: "Roster", origin: RETAIL } });
    const r = await new RetailClient(env).get("/api/site");
    expect(r.json()).toMatchObject({ game: "retail", name: "Roster", open: false, origin: RETAIL, other: { game: "forever" } });
  });

  it("chaque adresse n'accepte que son origine (CSRF)", async () => {
    const r = await new RetailClient(env).post("/api/auth/login", { email: "x@example.test", password: "y" }, );
    expect(r.statusCode).not.toBe(403);
    const cross = await new RetailClient(env).req("POST", "/api/auth/login", { email: "x@example.test", password: "y" }, { origin: "http://app.test" });
    expect(cross.statusCode).toBe(403);
  });

  it("même compte sur les deux adresses ; persos et groupes séparés par jeu", async () => {
    const { c, email, password } = await signedIn(env, "Pasta");
    const char = (await c.post("/api/characters", { name: "Tournicoti" })).json().character;
    const fGroup = (await c.post("/api/groups", { name: "Forever" })).json().group;

    const r = new RetailClient(env);
    expect((await r.post("/api/auth/login", { email, password })).statusCode).toBe(200);
    expect((await r.get("/api/characters")).json().characters).toEqual([]);
    expect((await r.get("/api/groups")).json().groups).toEqual([]);
    const rGroup = (await r.post("/api/groups", { name: "Pasta e Basta" })).json().group;
    const rChar = (await r.post("/api/characters", { name: "Sleyvazh" })).json().character;
    expect((await r.get("/api/groups")).json().groups.map((g: { name: string }) => g.name)).toEqual(["Pasta e Basta"]);
    expect((await c.get("/api/groups")).json().groups.map((g: { name: string }) => g.name)).toEqual(["Forever"]);
    expect((await c.get("/api/characters")).json().characters.map((x: { name: string }) => x.name)).toEqual(["Tournicoti"]);
    expect((await r.get(`/api/groups/${rGroup.id}`)).json().group).toMatchObject({ game: "retail", site: { name: "Roster", origin: RETAIL } });

    // Un perso ne rejoint qu'un groupe de son jeu
    expect((await c.put(`/api/groups/${rGroup.id}/characters/${char.id}`, { assigned: true })).statusCode).toBe(400);
    expect((await r.put(`/api/groups/${rGroup.id}/characters/${rChar.id}`, { assigned: true })).statusCode).toBe(200);
    expect((await c.put(`/api/groups/${fGroup.id}/characters/${char.id}`, { assigned: true })).statusCode).toBe(200);
  });

  it("invitations, e-mails et Discord renvoient vers la bonne adresse", async () => {
    const { email, password } = await signedIn(env, "Officier");
    const r = new RetailClient(env);
    await r.post("/api/auth/login", { email, password });
    const g = (await r.post("/api/groups", { name: "Roster test" })).json().group;
    const inv = (await r.post(`/api/groups/${g.id}/invites`, {})).json().invite;
    expect(inv.url.startsWith(`${RETAIL}/join#`)).toBe(true);
    const token = inv.url.split("#")[1];

    // L'invitation d'un groupe Retail s'ouvre sur Roster, pas sur Forever Roster
    const { c } = await signedIn(env, "Invite");
    expect((await c.post("/api/groups/invites/preview", { token })).json().site).toMatchObject({ game: "retail", origin: RETAIL });
    const wrong = await c.post("/api/groups/invites/accept", { token });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error).toContain(RETAIL);

    // Mot de passe oublié depuis Roster : lien et nom de Roster
    await new RetailClient(env).post("/api/auth/forgot-password", { email });
    const mail = env.mailer.outbox.filter(m => m.to === email).at(-1)!;
    expect(mail.text).toContain(`${RETAIL}/reset-password#${tokenFrom(mail.text)}`);
    expect(mail.text).toContain("Roster — raids, soft reserve et conseil du butin");
    expect(mail.html).not.toContain("Forever Roster");
    expect(mail.fromName).toBe("Roster");

    // Liaison Discord lancée depuis Roster : retour sur Roster
    const link = (await r.post("/api/auth/discord/link")).json().url as string;
    expect(new URL(link).searchParams.get("redirect_uri")).toBe(`${RETAIL}/api/auth/discord/callback`);
  });

  it("sans RETAIL_ORIGIN, une seule adresse (Forever Roster)", async () => {
    const solo = await setup();
    try {
      expect((await new Client(solo).get("/api/site")).json()).toMatchObject({ game: "forever", other: null });
    } finally { await solo.close(); }
  });
});
