import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => { env = await setup(); });
afterAll(async () => { await env.close(); });

type GC = { id: string; name: string; isMain: boolean };
const names = (list: GC[]) => list.map(c => `${c.name}${c.isMain ? "*" : ""}`).sort();

describe("persos par groupe et main", () => {
  it("le joueur choisit ses persos et son main, un officier corrige, un membre ne touche qu'aux siens", async () => {
    const gm = await signedIn(env, "Meneuse"), p1 = await signedIn(env, "Joueur"), p2 = await signedIn(env, "Autre"), out = await signedIn(env, "Dehors");
    const g = (await gm.c.post("/api/groups", { name: "Les Mains" })).json().group;
    const inv = (await gm.c.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
    await p1.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    await p2.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    const mk = async (c: typeof gm.c, name: string, cls = "Mage", spec1 = "Frost") => (await c.post("/api/characters", { name, race: "Undead", cls, spec1 })).json().character;
    const a = await mk(p1.c, "Aelis"), b = await mk(p1.c, "Brenn", "Priest", "Holy"), z = await mk(p1.c, "Zorka");
    const o = await mk(p2.c, "Orrin");
    const intrus = await mk(out.c, "Intrus");
    const list = async () => (await gm.c.get(`/api/groups/${g.id}/characters`)).json().characters as GC[];
    const put = (c: typeof gm.c, id: string, body: object) => c.put(`/api/groups/${g.id}/characters/${id}`, body);

    // Rien par défaut ; le premier ajouté devient main, les suivants sont des alts
    expect(await list()).toEqual([]);
    expect((await put(p1.c, a.id, { assigned: true })).statusCode).toBe(200);
    expect((await put(p1.c, b.id, { assigned: true })).statusCode).toBe(200);
    expect(names(await list())).toEqual(["Aelis*", "Brenn"]);
    // Changer de main
    await put(p1.c, b.id, { assigned: true, main: true });
    expect(names(await list())).toEqual(["Aelis", "Brenn*"]);
    // Ajouter directement comme main
    await put(p1.c, z.id, { assigned: true, main: true });
    expect(names(await list())).toEqual(["Aelis", "Brenn", "Zorka*"]);
    // Retirer le main : le premier perso restant (ordre de Mes persos) le remplace
    await put(p1.c, z.id, { assigned: false });
    expect(names(await list())).toEqual(["Aelis*", "Brenn"]);

    // Un membre ne touche pas aux persos des autres ; personne n'ajoute le perso d'un autre
    await put(p2.c, o.id, { assigned: true });
    expect((await put(p2.c, a.id, { assigned: false })).statusCode).toBe(403);
    expect((await put(gm.c, z.id, { assigned: true })).statusCode).toBe(403);
    // Perso d'un non-membre : introuvable
    expect((await put(gm.c, intrus.id, { assigned: true })).statusCode).toBe(404);
    expect((await put(out.c, intrus.id, { assigned: true })).statusCode).toBe(404);

    // L'officier (ici la meneuse) corrige le main ou retire un perso, et c'est noté au journal
    expect((await put(gm.c, b.id, { assigned: true, main: true })).statusCode).toBe(200);
    expect(names(await list())).toEqual(["Aelis", "Brenn*", "Orrin*"]);
    expect((await put(gm.c, a.id, { assigned: false })).statusCode).toBe(200);
    expect(names(await list())).toEqual(["Brenn*", "Orrin*"]);
    const journal = (await gm.c.get(`/api/groups/${g.id}/audit`)).json();
    expect(JSON.stringify(journal)).toContain("group_character_changed");

    // Hors du groupe, un perso reste visible dans les Artisans
    expect((await gm.c.get(`/api/groups/${g.id}/crafters`)).statusCode).toBe(200);

    // S'inscrire à un raid avec un perso hors du groupe l'y ajoute
    const raid = (await gm.c.post(`/api/groups/${g.id}/raids`, { name: "Zul'Gurub", scheduledAt: new Date(Date.now() + 86400e3).toISOString() })).json().raid;
    expect((await p1.c.put(`/api/groups/${g.id}/raids/${raid.id}/signup`, { status: "present", characterId: z.id })).statusCode).toBe(200);
    expect(names(await list())).toEqual(["Brenn*", "Orrin*", "Zorka"]);

    // Cette semaine : le main du groupe sert de choix par défaut ; un groupe sans perso à moi est « à faire »
    const g2 = (await p1.c.post("/api/groups", { name: "Second groupe" })).json().group;
    const w = (await p1.c.get("/api/week")).json();
    expect(w.raids[0]).toMatchObject({ id: raid.id, mainId: b.id });
    expect(w.todo).toContainEqual({ kind: "assign", groupId: g2.id, groupName: "Second groupe" });

    // Quitter le groupe retire ses persos ; supprimer un perso aussi
    await p2.c.del(`/api/groups/${g.id}/members/${p2.user.id}`);
    expect(names(await list())).toEqual(["Brenn*", "Zorka"]);
    await p1.c.del(`/api/characters/${b.id}`);
    expect(names(await list())).toEqual(["Zorka*"]);
  });
});
