import { weeklyOccurrences } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raids, raidTemplates } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { ensureRecurringRaids } from "../src/lib/recurring";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });

async function linkDiscord(c: Client, id: string) {
  env.fetchMock.impl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/api/oauth2/token")) return Response.json({ access_token: "at", token_type: "Bearer" });
    if (u.endsWith("/api/users/@me")) return Response.json({ id, username: `u${id.slice(-3)}` });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const state = new URL((await c.post("/api/auth/discord/link")).json().url).searchParams.get("state")!;
  await c.get(`/api/auth/discord/callback?code=abc&state=${state}`);
}

async function groupWithMember(name: string) {
  const off = await signedIn(env, `${name}Off`), mem = await signedIn(env, `${name}Mem`);
  const g = (await off.c.post("/api/groups", { name })).json().group;
  const inv = (await off.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  await mem.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
  return { off, mem, g };
}

describe("raids récurrents", () => {
  it("crée les occurrences à l'avance, sans doublon ni recréer un raid supprimé", async () => {
    const { off, mem, g } = await groupWithMember("Hebdo");
    // Un membre ne gère pas les modèles
    expect((await mem.c.post(`/api/groups/${g.id}/raid-templates`, { name: "MC", weekday: 3, time: "21:00" })).statusCode).toBe(403);
    expect((await off.c.post(`/api/groups/${g.id}/raid-templates`, { name: "MC", weekday: 3, time: "25:00" })).statusCode).toBe(400);
    const res = await off.c.post(`/api/groups/${g.id}/raid-templates`, { name: "Molten Core", weekday: 3, time: "21:00", leadDays: 14, description: "Flasques" });
    expect(res.statusCode).toBe(201);
    const t = res.json().template;
    expect(res.json().created).toBe(2); // 2 mercredis dans les 14 prochains jours
    expect((await mem.c.get(`/api/groups/${g.id}/raid-templates`)).json().templates).toHaveLength(1);

    const { db } = env.app.ctx;
    const list = async () => (await db.select().from(raids).where(eq(raids.templateId, t.id))).sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime());
    let rows = await list();
    expect(rows.map(r => r.name)).toEqual(["Molten Core", "Molten Core"]);
    expect(rows[0]!.description).toBe("Flasques");
    // Mercredi 21:00 à Paris
    const paris = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit" });
    expect(paris.format(rows[0]!.scheduledAt!)).toBe("mercredi 21:00");
    expect((await mem.c.get(`/api/groups/${g.id}/raids`)).json().raids[0].recurring).toBe(true);

    // Relancer ne crée rien ; supprimer un raid ne le fait pas revenir
    expect(await ensureRecurringRaids(db)).toBe(0);
    await off.c.del(`/api/groups/${g.id}/raids/${rows[0]!.id}`);
    expect(await ensureRecurringRaids(db)).toBe(0);
    expect(await list()).toHaveLength(1);

    // Une semaine plus tard, la semaine suivante est créée. Fenêtre comptée en heures : un changement d'heure (fin
    // octobre, fin mars) peut la faire finir juste avant le mercredi 21:00 ; le compte attendu suit alors la même règle.
    const later = new Date(Date.now() + 7 * 86400e3);
    const due = weeklyOccurrences(3, "21:00", rows[1]!.scheduledAt!, new Date(later.getTime() + 14 * 86400e3)).length;
    expect(due).toBeGreaterThanOrEqual(0);
    expect(due).toBeLessThanOrEqual(1);
    expect(await ensureRecurringRaids(db, later)).toBe(due);
    if (due === 0) expect(await ensureRecurringRaids(db, new Date(later.getTime() + 3600e3))).toBe(1);

    // En pause : plus rien n'est créé ; suppression du modèle : les raids restent
    await off.c.patch(`/api/groups/${g.id}/raid-templates/${t.id}`, { active: false });
    expect(await ensureRecurringRaids(db, new Date(Date.now() + 21 * 86400e3))).toBe(0);
    expect((await off.c.del(`/api/groups/${g.id}/raid-templates/${t.id}`)).statusCode).toBe(200);
    rows = await db.select().from(raids).where(eq(raids.groupId, g.id));
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.templateId === null)).toBe(true);
    expect(await db.select().from(raidTemplates).where(eq(raidTemplates.groupId, g.id))).toHaveLength(0);
  });
});

describe("inscrits sans compte dans la compo", () => {
  it("un officier place un inscrit Discord ; il apparaît dans la couverture, l'annonce et son rappel", async () => {
    const { off, mem, g } = await groupWithMember("Invites");
    await linkDiscord(off.c, "710000000000000001");
    const { code } = (await off.c.post(`/api/groups/${g.id}/discord/code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: "710000000000000010", channelId: "710000000000000011", discordUserId: "710000000000000001" });
    const soon = new Date(Date.now() + 5 * 3600e3).toISOString();
    const raidId = (await off.c.post(`/api/groups/${g.id}/raids`, { name: "ZG", scheduledAt: soon })).json().raid.id;
    await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "710000000000000003", discordName: "Chamy", status: "present", cls: "Shaman", spec: "Enhancement DPS" });
    const guest = (await off.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().signups.find((s: { displayName: string }) => s.displayName === "Chamy");

    const put = (slots: object[]) => off.c.put(`/api/groups/${g.id}/raids/${raidId}`, { name: "ZG", scheduledAt: soon, slots });
    // Refus : ni perso ni inscrit, les deux à la fois, inscrit d'un autre raid ou avec compte, doublon
    expect((await put([{ group: 1, pos: 1 }])).statusCode).toBe(400);
    expect((await put([{ group: 1, pos: 1, signupId: guest.id, characterId: guest.id }])).statusCode).toBe(400);
    expect((await put([{ group: 1, pos: 1, signupId: "00000000-0000-4000-8000-000000000000" }])).statusCode).toBe(400);
    expect((await put([{ group: 1, pos: 1, signupId: guest.id }, { group: 1, pos: 2, signupId: guest.id }])).statusCode).toBe(400);
    const druid = (await mem.c.post("/api/characters", { name: "Tournicoti", race: "Tauren", cls: "Druid", spec1: "Feral Cat" })).json().character;
    await mem.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, { status: "present", characterId: druid.id });
    const memberSignup = (await off.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().signups.find((s: { characterId: string }) => s.characterId === druid.id);
    expect((await put([{ group: 1, pos: 1, signupId: memberSignup.id }])).statusCode).toBe(400);

    const ok = await put([{ group: 1, pos: 1, signupId: guest.id }, { group: 1, pos: 2, characterId: druid.id }]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().coverage.find((c: { id: string }) => c.id === "wf")).toMatchObject({ covered: true });
    const detail = (await off.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json();
    expect(detail.slots).toEqual([{ group: 1, pos: 1, signupId: guest.id }, { group: 1, pos: 2, characterId: druid.id }]);

    await off.c.post(`/api/groups/${g.id}/raids/${raidId}/roster`);
    const v = (await bot("GET", `/internal/discord/raids/${raidId}/view`)).json();
    expect(v.roster.groups[0].members).toEqual([
      { name: "Chamy", cls: "Shaman", spec: "Enhancement DPS", role: "DPS" },
      { name: "Tournicoti", cls: "Druid", spec: "Feral Cat", role: "DPS" },
    ]);
    expect(v.signups.find((s: { displayName: string }) => s.displayName === "Chamy").group).toBe(1);
    const claim = (await bot("POST", "/internal/discord/reminders/claim")).json().reminders.find((r: { view: { raid: { id: string } } }) => r.view.raid.id === raidId);
    expect(claim.recipients.find((r: { name: string }) => r.name === "Chamy").group).toBe(1);

    // Il se désinscrit : sa place disparaît de la compo
    await bot("DELETE", `/internal/discord/raids/${raidId}/signup/710000000000000003`);
    const after = (await off.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json();
    expect(after.slots).toEqual([{ group: 1, pos: 2, characterId: druid.id }]);
    expect((await bot("GET", `/internal/discord/raids/${raidId}/view`)).json().roster.groups[0].members).toHaveLength(1);
  });
});

describe("compo publiée et rappels Discord", () => {
  it("publie la compo dans l'annonce, envoie un seul rappel aux inscrits qui le veulent", async () => {
    const { off, mem, g } = await groupWithMember("Compo");
    await linkDiscord(off.c, "700000000000000001");
    await linkDiscord(mem.c, "700000000000000002");
    const { code } = (await off.c.post(`/api/groups/${g.id}/discord/code`)).json();
    await bot("POST", "/internal/discord/bind", { code, guildId: "700000000000000010", channelId: "700000000000000011", discordUserId: "700000000000000001" });

    const druid = (await mem.c.post("/api/characters", { name: "Tournicoti", race: "Tauren", cls: "Druid", spec1: "Feral Cat" })).json().character;
    const mage = (await off.c.post("/api/characters", { name: "Givrette", race: "Gnome", cls: "Mage", spec1: "Frost" })).json().character;
    const soon = new Date(Date.now() + 5 * 3600e3).toISOString();
    const raidId = (await off.c.post(`/api/groups/${g.id}/raids`, { name: "Onyxia", scheduledAt: soon })).json().raid.id;
    await mem.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, { status: "present", characterId: druid.id, spec: "Feral Bear" });
    await off.c.put(`/api/groups/${g.id}/raids/${raidId}/signup`, { status: "tentative", characterId: mage.id });
    await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "700000000000000003", discordName: "Invité", status: "late", cls: "Priest", spec: "Shadow" });
    await bot("POST", `/internal/discord/raids/${raidId}/signup`, { discordUserId: "700000000000000004", discordName: "Absent", status: "absent" });
    await off.c.put(`/api/groups/${g.id}/raids/${raidId}`, { name: "Onyxia", scheduledAt: soon, slots: [{ group: 2, pos: 1, characterId: druid.id }] });

    // Compo non publiée : pas de roster dans l'annonce
    let v = (await bot("GET", `/internal/discord/raids/${raidId}/view`)).json();
    expect(v.roster).toBeNull();
    expect((await mem.c.post(`/api/groups/${g.id}/raids/${raidId}/roster`)).statusCode).toBe(403);
    await off.c.post(`/api/groups/${g.id}/raids/${raidId}/roster`);
    expect((await off.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json().raid.rosterPublished).toBe(true);
    v = (await bot("GET", `/internal/discord/raids/${raidId}/view`)).json();
    expect(v.roster.groups).toEqual([{ group: 2, members: [{ name: "Tournicoti", cls: "Druid", spec: "Feral Bear", role: "Tank" }] }]);
    expect(v.signups.find((s: { characterName: string }) => s.characterName === "Tournicoti").group).toBe(2);

    // L'officier coupe ses rappels
    expect((await off.c.patch("/api/account/discord", { reminders: false })).json().user.discordReminders).toBe(false);

    const claim = (await bot("POST", "/internal/discord/reminders/claim")).json();
    const mine = claim.reminders.find((r: { view: { raid: { id: string } } }) => r.view.raid.id === raidId);
    expect(mine.recipients).toEqual(expect.arrayContaining([
      { discordUserId: "700000000000000002", status: "present", name: "Tournicoti", cls: "Druid", spec: "Feral Bear", guest: false, group: 2 },
      { discordUserId: "700000000000000003", status: "late", name: "Invité", cls: "Priest", spec: "Shadow", guest: true, group: null },
    ]));
    expect(mine.recipients).toHaveLength(2); // ni l'officier (rappels coupés) ni l'absent
    // Un seul envoi…
    expect((await bot("POST", "/internal/discord/reminders/claim")).json().reminders.find((r: { view: { raid: { id: string } } }) => r.view.raid.id === raidId)).toBeUndefined();
    // …sauf si la date change
    const later = new Date(Date.now() + 6 * 3600e3).toISOString();
    await off.c.put(`/api/groups/${g.id}/raids/${raidId}`, { name: "Onyxia", scheduledAt: later, slots: [{ group: 2, pos: 1, characterId: druid.id }] });
    expect((await bot("POST", "/internal/discord/reminders/claim")).json().reminders.some((r: { view: { raid: { id: string } } }) => r.view.raid.id === raidId)).toBe(true);

    await off.c.del(`/api/groups/${g.id}/raids/${raidId}/roster`);
    expect((await bot("GET", `/internal/discord/raids/${raidId}/view`)).json().roster).toBeNull();
  });
});
