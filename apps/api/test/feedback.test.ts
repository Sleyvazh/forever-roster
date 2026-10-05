import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { feedbacks } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { setup, type TestEnv } from "./helpers";

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => { env = await setup(); internal = await buildInternalApp(env.app.ctx); await internal.ready(); });
afterAll(async () => { await internal.close(); await env.close(); });

const bot = (method: string, url: string, payload?: object, secret = SECRET) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${secret}` }, ...(payload ? { payload } : {}) });

const GUILD = "900000000000000001";

describe("avis (feedback) du bot", () => {
  it("réglages par serveur, sans groupe ni compte sur le site", async () => {
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`, undefined, "mauvais")).statusCode).toBe(401);
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`)).json().config).toBeNull();

    const first = await bot("PUT", `/internal/feedback/config/${GUILD}`, {
      inboxChannelId: "900000000000000010", panelChannelId: "900000000000000011", panelMessageId: "900000000000000012", allowAnonymous: true, updatedBy: "900000000000000099",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().previous).toBeNull();
    expect(first.json().config).toMatchObject({ inboxChannelId: "900000000000000010", allowAnonymous: true });

    // Nouveaux réglages : les anciens sont renvoyés (le bot retire l'ancien bouton)
    const second = await bot("PUT", `/internal/feedback/config/${GUILD}`, {
      inboxChannelId: "900000000000000010", panelChannelId: null, panelMessageId: null, allowAnonymous: false, updatedBy: "900000000000000099",
    });
    expect(second.json().previous.panelMessageId).toBe("900000000000000012");
    expect(second.json().config).toMatchObject({ panelChannelId: null, allowAnonymous: false });

    expect((await bot("PUT", `/internal/feedback/config/${GUILD}`, { inboxChannelId: "pas-un-id", panelChannelId: null, panelMessageId: null, allowAnonymous: true, updatedBy: "1" })).statusCode).toBe(400);

    const removed = await bot("DELETE", `/internal/feedback/config/${GUILD}`);
    expect(removed.json().previous.inboxChannelId).toBe("900000000000000010");
    expect((await bot("GET", `/internal/feedback/config/${GUILD}`)).json().config).toBeNull();
  });

  it("garde l'auteur 30 jours pour la réponse, puis l'oublie", async () => {
    const id = randomUUID();
    const post = await bot("POST", "/internal/feedback", {
      id, guildId: GUILD, channelId: "900000000000000010", messageId: "900000000000000020", anonymous: true, authorId: "900000000000000030",
    });
    expect(post.statusCode).toBe(200);
    const got = await bot("GET", `/internal/feedback/${id}`);
    expect(got.json().feedback).toMatchObject({ authorId: "900000000000000030", anonymous: true, messageId: "900000000000000020" });

    // 31 jours plus tard : l'avis et son auteur sont effacés
    await env.app.ctx.db.execute(sql`update feedbacks set created_at = now() - interval '31 days' where id = ${id}`);
    const old = await bot("GET", `/internal/feedback/${id}`);
    expect(old.statusCode).toBe(404);
    expect(old.json().error).toMatch(/30 jours/);
    expect(await env.app.ctx.db.select().from(feedbacks).where(eq(feedbacks.id, id))).toEqual([]);
  });
});
