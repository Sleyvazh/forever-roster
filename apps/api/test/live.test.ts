import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeSlots } from "../src/lib/compo";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
let base = "";
beforeAll(async () => {
  env = await setup();
  await env.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(env.app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await env.close(); });

/** Ouvre /api/events avec les cookies d'un client et collecte les événements reçus. */
async function listen(cookies: Map<string, string>) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { headers: { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") }, signal: ctrl.signal });
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split("\n").find(l => l.startsWith("data: "));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch { /* fermé */ }
  })();
  const waitFor = async (pred: (e: Record<string, unknown>) => boolean) => {
    for (let n = 0; n < 50; n++) { if (events.some(pred)) return true; await new Promise(r => setTimeout(r, 40)); }
    return false;
  };
  return { res, events, waitFor, close: () => ctrl.abort() };
}

const s = (group: number, pos: number, characterId: string) => ({ group, pos, characterId });

describe("fusion de la compo", () => {
  const A = "a", B = "b", C = "c";
  it("garde les déplacements de chacun", () => {
    const base = [s(1, 1, A), s(1, 2, B)];
    const mine = [s(2, 1, A), s(1, 2, B)];                // je déplace A
    const theirs = [s(1, 1, A), s(1, 2, B), s(3, 1, C)];  // l'autre ajoute C
    expect(mergeSlots(base, mine, theirs)).toEqual({ ok: true, slots: [s(1, 2, B), s(2, 1, A), s(3, 1, C)] });
    // Retrait de mon côté, rien du leur
    expect(mergeSlots(base, [s(1, 2, B)], base)).toEqual({ ok: true, slots: [s(1, 2, B)] });
  });
  it("conflit : même perso déplacé ailleurs, ou même place prise", () => {
    const base = [s(1, 1, A)];
    expect(mergeSlots(base, [s(2, 1, A)], [s(3, 1, A)]).ok).toBe(false);
    expect(mergeSlots(base, [s(2, 1, A)], [s(2, 1, A)]).ok).toBe(true); // même décision des deux côtés
    expect(mergeSlots([], [s(1, 1, A)], [s(1, 1, B)]).ok).toBe(false);
  });
});

describe("temps réel", () => {
  it("prévient les membres du groupe, et eux seuls, puis fusionne deux officiers", async () => {
    const off1 = await signedIn(env, "Off1"), off2 = await signedIn(env, "Off2"), stranger = await signedIn(env, "Inconnu");
    const g = (await off1.c.post("/api/groups", { name: "Direct" })).json().group;
    const inv = (await off1.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;

    const l2 = await listen(off2.c.cookies);
    expect(l2.res.headers.get("content-type")).toContain("text/event-stream");
    const ls = await listen(stranger.c.cookies);
    expect((await fetch(`${base}/api/events`)).status).toBe(401);

    // En rejoignant, off2 reçoit « membership » puis les événements du groupe
    await off2.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    expect(await l2.waitFor(e => e.t === "membership")).toBe(true);
    await off1.c.patch(`/api/groups/${g.id}/members/${off2.user.id}`, { role: "officer" });

    const tank = (await off1.c.post("/api/characters", { name: "Tanky", race: "Tauren", cls: "Warrior", spec1: "Protection" })).json().character;
    const heal = (await off2.c.post("/api/characters", { name: "Soigne", race: "Tauren", cls: "Druid", spec1: "Restoration" })).json().character;
    expect(await l2.waitFor(e => e.t === "chars" && e.g === g.id)).toBe(true);
    await off1.c.put(`/api/groups/${g.id}/characters/${tank.id}`, { assigned: true });
    await off2.c.put(`/api/groups/${g.id}/characters/${heal.id}`, { assigned: true });

    const raidId = (await off1.c.post(`/api/groups/${g.id}/raids`, { name: "MC" })).json().raid.id;
    expect(await l2.waitFor(e => e.t === "raids" && e.g === g.id)).toBe(true);
    const v0 = (await off1.c.get(`/api/groups/${g.id}/raids/${raidId}`)).json();
    const meta = { name: "MC", scheduledAt: null, description: "" };
    const b0 = { version: v0.version, slots: [], ...meta };

    // Deux officiers partent de la même version
    const r1 = await off1.c.put(`/api/groups/${g.id}/raids/${raidId}`, { ...meta, slots: [s(1, 1, tank.id)], base: b0 });
    expect(r1.json()).toMatchObject({ merged: false });
    expect(await l2.waitFor(e => e.t === "raid" && e.r === raidId && e.byName === "Off1")).toBe(true);
    const r2 = await off2.c.put(`/api/groups/${g.id}/raids/${raidId}`, { ...meta, description: "Flasques", slots: [s(2, 1, heal.id)], base: b0 });
    expect(r2.json()).toMatchObject({ merged: true, slots: [s(1, 1, tank.id), s(2, 1, heal.id)], raid: { description: "Flasques" } });
    // Même place prise : conflit
    const r3 = await off1.c.put(`/api/groups/${g.id}/raids/${raidId}`, { ...meta, slots: [s(1, 1, tank.id), s(2, 1, heal.id)], base: { ...b0, version: r1.json().version, slots: [s(1, 1, tank.id)] } });
    expect(r3.statusCode).toBe(200); // décision identique : pas de conflit
    const r4 = await off2.c.put(`/api/groups/${g.id}/raids/${raidId}`, { ...meta, slots: [s(1, 1, heal.id), s(1, 2, tank.id)], base: { ...b0, version: r1.json().version, slots: [s(1, 1, tank.id)] } });
    expect(r4.statusCode).toBe(409);
    expect(r4.json().conflict).toBe(true);

    // L'inconnu n'a rien reçu du groupe
    expect(ls.events.some(e => e.g === g.id)).toBe(false);
    l2.close(); ls.close();
  });
});
