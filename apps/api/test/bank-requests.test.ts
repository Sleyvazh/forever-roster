import type { BankRequest, GuildBankResponse, GuildHomeResponse } from "@forever/game-data";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, bankRequestNotices, bankRequests, gameItems, groupMembers, groups, users } from "../src/db/schema";
import { buildInternalApp } from "../src/internal";
import { bus, type LiveEvent } from "../src/lib/events";
import { purgeOldData } from "../src/lib/purges";
import { frc, frl, HOUR, m, NOW, paste, scene as sceneOf, type Signed } from "./guild-helpers";
import { setup, type TestEnv } from "./helpers";

/**
 * Demandes de retrait à la banque (Forever) et banquiers : création et ses limites, étapes et droits (officiers, propriétaire,
 * banquiers, demandeur), liste dans la banque et « À traiter » de l'accueil, MP du bot, départ d'un membre, purge des demandes
 * closes. Noms inventés.
 */

let env: TestEnv;
let internal: FastifyInstance;
const SECRET = "secret-interne-de-test-assez-long-0123456789";
beforeAll(async () => {
  env = await setup();
  internal = await buildInternalApp(env.app.ctx);
  await internal.ready();
  // Deux objets du catalogue ; les autres de la banque n'y sont pas (nom « Objet n° … »)
  await db().insert(gameItems).values([
    { id: 13446, name: "Major Healing Potion", quality: 1, itemLevel: 1, reqLevel: 45, classId: 0, subclassId: 1, inventoryType: 0 },
    { id: 2589, name: "Linen Cloth", quality: 1, itemLevel: 1, reqLevel: 1, classId: 7, subclassId: 5, inventoryType: 0 },
  ]);
});
afterAll(async () => { await internal.close(); await env.close(); });
afterEach(() => { env.app.ctx.now = undefined; });

const db = () => env.app.ctx.db;
const bot = (method: string, url: string, payload?: object) =>
  internal.inject({ method: method as "GET", url, headers: { authorization: `Bearer ${SECRET}` }, ...(payload ? { payload } : {}) });
let snow = 740000000000000000n;
const nextId = () => String(++snow);

/** Banque : 34 Major Healing Potion (20 + 14, deux onglets), 5 Linen Cloth, et six autres objets pour atteindre les limites. */
const B = (at: number) => [
  `B;${at};Kaeldra Brisevent;1234567;2`, "T;1;Consommables;1;1", "T;2;Matériaux;1;1",
  "I;1;1;13446;20", "I;2;3;13446;14", "I;1;2;2589;5", "I;2;4;2592;3", "I;2;5;4306;3", "I;2;6;4338;3", "I;2;7;14047;3", "I;2;8;2770;3",
];
const ITEM = 13446, TOTAL = 34, CLOTH = 2589;

/**
 * Guilde du site liée à une guilde du jeu qui a une banque : un propriétaire (Kaeldra), un officier (Off), un banquier
 * (Banq, nommé par le propriétaire), deux membres (Pikou, Vexou) et un membre qui n'a pas de perso dans la liste (Zed).
 */
async function world(name: string) {
  const s = await sceneOf(env, name, ["Off", "Banq", "Pikou", "Vexou", "Zed"]);
  const T = NOW() - HOUR;
  const K = m("Kaeldra Brisevent", 60, { rank: "Maître de guilde", ri: 0 });
  const O = m("Offa Plumedor", 50, { cls: "PRIEST", rank: "Officier", ri: 1 });
  const G = m("Gorrak Fendroc", 25, { rank: "Membre" });
  const P = m("Pikou Patacuivre", 33, { cls: "MAGE" });
  const V = m("Vex Ombrelame", 27, { cls: "ROGUE" });
  await paste(s.owner, `${frc("Kaeldra", "WARRIOR", "Orc", 60, K.guid, K.name)}\n${frl({ at: T, members: [K, O, G, P, V], bank: B(T) })}`);
  await paste(s.p.Off!, frc("Offa", "PRIEST", "Troll", 50, O.guid, O.name));
  await paste(s.p.Banq!, frc("Gorrak", "WARRIOR", "Orc", 25, G.guid, G.name));
  await paste(s.p.Pikou!, frc("Pikou", "MAGE", "Troll", 33, P.guid, P.name));
  await paste(s.p.Vexou!, frc("Vex", "ROGUE", "Undead", 27, V.guid, V.name));
  expect((await s.promote("Off")).statusCode).toBe(200);
  expect((await setBanker(s, s.owner, s.p.Banq!, true)).statusCode).toBe(200);
  return s;
}
type World = Awaited<ReturnType<typeof world>>;

const setBanker = (s: World, by: Signed, who: Signed, banker: unknown) => by.c.put(`/api/groups/${s.g.id}/members/${who.user.id}/banker`, { banker });
const reqUrl = (s: World, rid = "") => `/api/groups/${s.g.id}/guild/bank/requests${rid ? `/${rid}` : ""}`;
const ask = (s: World, who: Signed, body: object) => who.c.post(reqUrl(s), body);
const act = (s: World, who: Signed, rid: string, action: string, reason?: string) => who.c.patch(reqUrl(s, rid), { action, ...(reason !== undefined && { reason }) });
const bankOf = async (s: World, who: Signed = s.owner) => s.get<GuildBankResponse>(who, "/guild/bank");
const homeOf = (s: World, who: Signed) => s.get<GuildHomeResponse>(who, "/home");
/** Crée une demande qui doit réussir, et la renvoie. */
async function make(s: World, who: Signed, itemId = ITEM, quantity = 1, note?: string) {
  const r = await ask(s, who, { itemId, quantity, ...(note !== undefined && { note }) });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().request as BankRequest;
}
const rowOf = async (id: string) => (await db().select().from(bankRequests).where(eq(bankRequests.id, id)))[0]!;

describe("demander à la banque", () => {
  it("un membre demande : demande en attente, son nom de perso dans la guilde, visible par tous, quantité jusqu'au total de tous les onglets", async () => {
    const s = await world("Les Demandeurs");
    const before = Date.now();
    const r = await ask(s, s.p.Pikou!, { itemId: ITEM, quantity: TOTAL, note: "pour monter Alchimie" });
    expect(r.statusCode, r.body).toBe(201);
    const q = r.json().request as BankRequest;
    expect(q).toMatchObject({
      itemId: ITEM, quantity: TOTAL, note: "pour monter Alchimie", status: "pending", handledBy: null, reason: "",
      who: { userId: s.p.Pikou!.user.id, name: "Pikou Patacuivre", cls: "Mage", me: true },
    });
    expect(Date.parse(q.at)).toBeGreaterThanOrEqual(before - 1000);
    expect(q.updatedAt).toBe(q.at);
    // Tout membre la voit, avec « me » vrai pour le seul demandeur ; la banque dit combien j'en ai d'ouvertes
    const vue = await bankOf(s, s.p.Vexou!);
    expect(vue.requests.open).toEqual([{ ...q, who: { ...q.who, me: false } }]);
    expect(vue.requests).toMatchObject({ done: [], canHandle: false, myOpen: 0 });
    expect((await bankOf(s, s.p.Pikou!)).requests).toMatchObject({ myOpen: 1, canHandle: false });
    expect((await bankOf(s, s.p.Pikou!)).requests.open[0]!.who.me).toBe(true);
    // Mot facultatif ; le mot est nettoyé (espaces)
    const sans = await make(s, s.p.Vexou!, CLOTH, 2);
    expect(sans.note).toBe("");
    const mot = await make(s, s.p.Vexou!, 4306, 1, "  pour le tailleur  ");
    expect(mot.note).toBe("pour le tailleur");
    // Un membre sans perso dans la liste du jeu : son pseudo du site
    expect((await make(s, s.p.Zed!, 2592, 1)).who).toMatchObject({ name: expect.stringMatching(/Zed$/), cls: null });
  });

  it("limites : quantité de 1 au total de la banque, mot de 80 caractères, objet absent, banque pas relevée", async () => {
    const s = await world("Les Comptables");
    const bad = async (body: object, status = 400) => { const r = await ask(s, s.p.Pikou!, body); expect(r.statusCode, r.body).toBe(status); return r.json().error as string; };
    expect(await bad({ itemId: ITEM, quantity: 0 })).toContain("quantity");
    expect(await bad({ itemId: ITEM, quantity: -3 })).toContain("quantity");
    expect(await bad({ itemId: ITEM, quantity: 1.5 })).toContain("quantity");
    expect(await bad({ itemId: ITEM })).toContain("quantity");
    expect(await bad({ itemId: ITEM, quantity: "5" })).toContain("quantity");
    // Plus que la banque n'en a, tous onglets confondus (20 + 14)
    expect(await bad({ itemId: ITEM, quantity: TOTAL + 1 })).toBe("Il n'y a que 34 Major Healing Potion dans la banque.");
    expect(await bad({ itemId: CLOTH, quantity: 6 })).toBe("Il n'y a que 5 Linen Cloth dans la banque.");
    // Objet absent de la banque (dans le catalogue ou non)
    expect(await bad({ itemId: 2770 + 1, quantity: 1 })).toBe("Cet objet n'est pas dans la banque.");
    expect(await bad({ itemId: 19019, quantity: 1 })).toBe("Cet objet n'est pas dans la banque.");
    expect(await bad({ itemId: 0, quantity: 1 })).toContain("itemId");
    expect(await bad({ itemId: ITEM, quantity: 1, note: "x".repeat(81) })).toContain("note");
    // Rien n'a été enregistré ; 80 caractères et 34 pièces passent
    expect(await db().$count(bankRequests, eq(bankRequests.groupId, s.g.id))).toBe(0);
    expect((await ask(s, s.p.Pikou!, { itemId: ITEM, quantity: TOTAL, note: "é".repeat(80) })).statusCode).toBe(201);
  });

  it("5 demandes ouvertes au plus par joueur, une seule par objet ; les closes ne comptent plus", async () => {
    const s = await world("Les Gourmands");
    const items = [ITEM, CLOTH, 2592, 4306, 4338, 14047];
    const mine = [];
    for (const id of items.slice(0, 5)) mine.push(await make(s, s.p.Pikou!, id, 1));
    // Une sixième : refusée, même pour un autre objet
    const sixth = await ask(s, s.p.Pikou!, { itemId: items[5], quantity: 1 });
    expect(sixth.statusCode).toBe(400);
    expect(sixth.json().error).toBe("Tu as déjà 5 demandes ouvertes : attends qu'elles soient traitées, ou annules-en une.");
    // Une préparée compte encore comme ouverte
    expect((await act(s, s.owner, mine[0]!.id, "prepare")).statusCode).toBe(200);
    expect((await ask(s, s.p.Pikou!, { itemId: items[5], quantity: 1 })).statusCode).toBe(400);
    // Annulée ou remise : la place se libère
    expect((await act(s, s.p.Pikou!, mine[1]!.id, "cancel")).statusCode).toBe(200);
    expect((await ask(s, s.p.Pikou!, { itemId: items[5], quantity: 1 })).statusCode).toBe(201);
    expect((await ask(s, s.p.Pikou!, { itemId: 2770, quantity: 1 })).statusCode).toBe(400);
    expect((await act(s, s.owner, mine[0]!.id, "done")).statusCode).toBe(200);
    expect((await ask(s, s.p.Pikou!, { itemId: 2770, quantity: 1 })).statusCode).toBe(201);
    // Un autre joueur n'est pas gêné
    expect((await ask(s, s.p.Vexou!, { itemId: ITEM, quantity: 1 })).statusCode).toBe(201);

    // Une seule demande ouverte par objet : la deuxième est refusée tant que la première est ouverte (en attente ou préparée)…
    const t = await world("Les Doublons");
    const first = await make(t, t.p.Pikou!, ITEM, 3);
    const twice = await ask(t, t.p.Pikou!, { itemId: ITEM, quantity: 1 });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error).toBe("Tu as déjà une demande ouverte pour cet objet.");
    await act(t, t.owner, first.id, "prepare");
    expect((await ask(t, t.p.Pikou!, { itemId: ITEM, quantity: 1 })).statusCode).toBe(400);
    // … et possible de nouveau une fois refusée, remise ou annulée
    await act(t, t.owner, first.id, "refuse");
    const second = await make(t, t.p.Pikou!, ITEM, 1);
    await act(t, t.p.Pikou!, second.id, "cancel");
    const third = await make(t, t.p.Pikou!, ITEM, 1);
    await act(t, t.owner, third.id, "done");
    await make(t, t.p.Pikou!, ITEM, 1);
    expect(await db().$count(bankRequests, eq(bankRequests.groupId, t.g.id))).toBe(4);
  });

  it("deux demandes simultanées du même joueur : une seule passe quand c'est le même objet ou la sixième", async () => {
    const s = await world("Les Pressés");
    const same = await Promise.all([ask(s, s.p.Pikou!, { itemId: ITEM, quantity: 1 }), ask(s, s.p.Pikou!, { itemId: ITEM, quantity: 2 })]);
    expect(same.map(r => r.statusCode).sort()).toEqual([201, 400]);
    for (const id of [CLOTH, 2592, 4306]) await make(s, s.p.Pikou!, id, 1); // 4 ouvertes
    const race = await Promise.all([ask(s, s.p.Pikou!, { itemId: 4338, quantity: 1 }), ask(s, s.p.Pikou!, { itemId: 14047, quantity: 1 })]);
    expect(race.map(r => r.statusCode).sort()).toEqual([201, 400]);
  });

  it("pas membre : 404 ; pas de banque relevée : 400 ; guilde de Roster (Retail) : 400", async () => {
    const s = await world("Les Fermes");
    const out = await sceneOf(env, "Les Etrangers", []);
    expect((await out.owner.c.post(reqUrl(s), { itemId: ITEM, quantity: 1 })).statusCode).toBe(404);
    expect((await out.owner.c.patch(reqUrl(s, "0f6c1d2e-0000-4000-8000-000000000001"), { action: "prepare" })).statusCode).toBe(404);
    // Guilde du site sans guilde du jeu liée, ou liée sans banque relevée
    const nobank = await sceneOf(env, "Les Sans Banque", ["Pikou"]);
    const none = await nobank.p.Pikou!.c.post(`/api/groups/${nobank.g.id}/guild/bank/requests`, { itemId: ITEM, quantity: 1 });
    expect(none.statusCode).toBe(400);
    expect(none.json().error).toBe("La banque de la guilde n'a pas encore été relevée.");
    await paste(nobank.owner, frl({ at: NOW() - HOUR, members: [m("Kaeldra Brisevent", 60)] }));
    expect((await nobank.p.Pikou!.c.post(`/api/groups/${nobank.g.id}/guild/bank/requests`, { itemId: ITEM, quantity: 1 })).statusCode).toBe(400);
    // Roster (Retail) : pas de banque de guilde
    const retail = await sceneOf(env, "Les Retail", ["Pikou"]);
    await db().update(groups).set({ game: "retail" }).where(eq(groups.id, retail.g.id));
    expect((await retail.p.Pikou!.c.post(`/api/groups/${retail.g.id}/guild/bank/requests`, { itemId: ITEM, quantity: 1 })).statusCode).toBe(400);
    expect((await retail.owner.c.put(`/api/groups/${retail.g.id}/members/${retail.p.Pikou!.user.id}/banker`, { banker: true })).statusCode).toBe(400);
  });
});

describe("étapes et droits", () => {
  it("officier, propriétaire, banquier : préparer, remettre, refuser ; le demandeur annule en attente ; les autres, 403", async () => {
    const s = await world("Les Traiteurs");
    const rid = (await make(s, s.p.Pikou!, ITEM, 20, "pour 20 potions")).id;
    // Ni le demandeur, ni un autre membre, ni un membre sans compte de la liste ne traitent
    for (const who of [s.p.Pikou!, s.p.Vexou!, s.p.Zed!]) for (const a of ["prepare", "done", "refuse"]) expect((await act(s, who, rid, a)).statusCode, `${a}`).toBe(403);
    // Le demandeur seul annule : ni un autre membre, ni un officier, ni le propriétaire, ni un banquier
    for (const who of [s.p.Vexou!, s.p.Off!, s.owner, s.p.Banq!]) expect((await act(s, who, rid, "cancel")).statusCode).toBe(403);
    expect((await rowOf(rid)).status).toBe("pending");

    // Un officier prépare : « par Offa »
    const prep = await act(s, s.p.Off!, rid, "prepare");
    expect(prep.statusCode, prep.body).toBe(200);
    expect(prep.json().request).toMatchObject({ id: rid, status: "prepared", handledBy: "Offa", reason: "", who: { name: "Pikou Patacuivre", me: false } });
    expect(Date.parse(prep.json().request.updatedAt)).toBeGreaterThanOrEqual(Date.parse(prep.json().request.at));
    expect(await rowOf(rid)).toMatchObject({ status: "prepared", handledBy: s.p.Off!.user.id, handledByName: "Offa", closedAt: null });
    // Préparée : le demandeur ne peut plus annuler, rien ne se prépare deux fois
    expect((await act(s, s.p.Pikou!, rid, "cancel")).statusCode).toBe(409);
    expect((await act(s, s.owner, rid, "prepare")).statusCode).toBe(409);
    // Le banquier remet : close, avec son nom
    const done = await act(s, s.p.Banq!, rid, "done");
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().request).toMatchObject({ status: "done", handledBy: "Gorrak" });
    expect((await rowOf(rid)).closedAt).toBeInstanceOf(Date);
    // Close : plus rien
    for (const a of ["prepare", "done", "refuse"]) expect((await act(s, s.owner, rid, a)).statusCode).toBe(409);
    expect((await act(s, s.p.Pikou!, rid, "cancel")).statusCode).toBe(409);
  });

  it("« Remise » directement depuis « En attente » ; refus depuis « En attente » ou « Préparée », motif facultatif de 120 caractères au plus", async () => {
    const s = await world("Les Directs");
    const a = await make(s, s.p.Pikou!, ITEM, 1);
    expect((await act(s, s.owner, a.id, "done")).json().request).toMatchObject({ status: "done", handledBy: "Kaeldra" });
    // Refus avec motif, depuis « En attente »
    const b = await make(s, s.p.Pikou!, ITEM, 2);
    const refused = await act(s, s.p.Banq!, b.id, "refuse", "  réservé pour le raid de samedi  ");
    expect(refused.json().request).toMatchObject({ status: "refused", reason: "réservé pour le raid de samedi", handledBy: "Gorrak" });
    // Refus sans motif, depuis « Préparée »
    const c = await make(s, s.p.Pikou!, ITEM, 3);
    await act(s, s.owner, c.id, "prepare");
    expect((await act(s, s.p.Off!, c.id, "refuse")).json().request).toMatchObject({ status: "refused", reason: "" });
    const d = await make(s, s.p.Pikou!, ITEM, 4);
    expect((await act(s, s.owner, d.id, "refuse", "x".repeat(121))).statusCode).toBe(400);
    expect((await act(s, s.owner, d.id, "refuse", "é".repeat(120))).statusCode).toBe(200);
    // Le motif ne sert qu'à refuser
    const e = await make(s, s.p.Pikou!, ITEM, 5);
    expect((await act(s, s.owner, e.id, "done", "ignoré")).json().request.reason).toBe("");
    // Étape inconnue
    const f = await make(s, s.p.Pikou!, ITEM, 6);
    expect((await act(s, s.owner, f.id, "reopen")).statusCode).toBe(400);
    expect((await s.owner.c.patch(reqUrl(s, f.id), {})).statusCode).toBe(400);
    // Le demandeur annule en attente
    const g = await act(s, s.p.Pikou!, f.id, "cancel");
    expect(g.json().request).toMatchObject({ status: "cancelled", handledBy: null });
    expect((await rowOf(f.id)).closedAt).toBeInstanceOf(Date);
  });

  it("un officier ou un propriétaire peut traiter sa propre demande ; une demande d'une autre guilde ou inconnue : 404", async () => {
    const s = await world("Les Auto");
    const mine = await make(s, s.p.Off!, ITEM, 1);
    expect((await act(s, s.p.Off!, mine.id, "prepare")).statusCode).toBe(200);
    const other = await world("Les Autres");
    const theirs = await make(other, other.p.Pikou!, ITEM, 1);
    // L'identifiant d'une demande d'une autre guilde ne marche pas dans celle-ci
    expect((await act(s, s.owner, theirs.id, "prepare")).statusCode).toBe(404);
    expect((await act(s, s.owner, "0f6c1d2e-0000-4000-8000-000000000001", "prepare")).statusCode).toBe(404);
    expect((await s.owner.c.patch(reqUrl(s, "pas-un-uuid"), { action: "prepare" })).statusCode).toBe(400);
    expect((await rowOf(theirs.id)).status).toBe("pending");
  });

  it("banquier retiré : il ne traite plus (403) ; banquier promu officier ou rétrogradé : suit son rôle ; le demandeur n'a pas besoin du drapeau", async () => {
    const s = await world("Les Retraits");
    const rid = (await make(s, s.p.Pikou!, ITEM, 1)).id;
    expect((await act(s, s.p.Banq!, rid, "prepare")).statusCode).toBe(200);
    // Les officiers retirent le drapeau : le banquier est refusé à son prochain geste, sur le serveur
    expect((await setBanker(s, s.p.Off!, s.p.Banq!, false)).statusCode).toBe(200);
    for (const a of ["done", "refuse", "prepare"]) expect((await act(s, s.p.Banq!, rid, a)).statusCode, a).toBe(403);
    expect((await rowOf(rid)).status).toBe("prepared");
    expect((await bankOf(s, s.p.Banq!)).requests.canHandle).toBe(false);
    expect((await homeOf(s, s.p.Banq!)).bankRequests).toBeNull();
    // Renommé : il traite de nouveau
    await setBanker(s, s.owner, s.p.Banq!, true);
    expect((await act(s, s.p.Banq!, rid, "done")).statusCode).toBe(200);
    // Un officier traite sans drapeau ; rétrogradé, il ne traite plus
    const r2 = (await make(s, s.p.Pikou!, ITEM, 1)).id;
    expect((await act(s, s.p.Off!, r2, "prepare")).statusCode).toBe(200);
    expect((await s.owner.c.patch(`/api/groups/${s.g.id}/members/${s.p.Off!.user.id}`, { role: "member" })).statusCode).toBe(200);
    expect((await act(s, s.p.Off!, r2, "done")).statusCode).toBe(403);
  });

  it("un membre qui quitte la guilde : plus d'accès (404), ses demandes ouvertes sont annulées, les closes restent sous son pseudo ; un banquier parti ne traite plus", async () => {
    const s = await world("Les Departs");
    const open = await make(s, s.p.Vexou!, ITEM, 1);
    const prepared = await make(s, s.p.Vexou!, CLOTH, 1);
    await act(s, s.owner, prepared.id, "prepare");
    const done = await make(s, s.p.Vexou!, 4306, 1);
    await act(s, s.owner, done.id, "done");
    const pending = await make(s, s.p.Pikou!, ITEM, 1);
    expect((await s.p.Vexou!.c.del(`/api/groups/${s.g.id}/members/${s.p.Vexou!.user.id}`)).statusCode).toBe(200);
    expect((await ask(s, s.p.Vexou!, { itemId: 4338, quantity: 1 })).statusCode).toBe(404);
    expect((await act(s, s.p.Vexou!, open.id, "cancel")).statusCode).toBe(404);
    expect((await s.p.Vexou!.c.get(`/api/groups/${s.g.id}/guild/bank`)).statusCode).toBe(404);
    expect(await rowOf(open.id)).toMatchObject({ status: "cancelled" });
    expect(await rowOf(prepared.id)).toMatchObject({ status: "cancelled" });
    expect((await rowOf(open.id)).closedAt).toBeInstanceOf(Date);
    expect(await rowOf(done.id)).toMatchObject({ status: "done" });
    expect(await rowOf(pending.id)).toMatchObject({ status: "pending" });
    const v = await bankOf(s, s.p.Pikou!);
    expect(v.requests.open.map(r => r.id)).toEqual([pending.id]);
    expect(v.requests.done.map(r => r.id).sort()).toEqual([open.id, prepared.id, done.id].sort());
    // Le banquier parti : 404 et plus de drapeau s'il revient (le drapeau part avec l'appartenance)
    expect((await s.p.Banq!.c.del(`/api/groups/${s.g.id}/members/${s.p.Banq!.user.id}`)).statusCode).toBe(200);
    expect((await act(s, s.p.Banq!, pending.id, "prepare")).statusCode).toBe(404);
  });

  it("la banque dit à ses lecteurs ce qui change en direct : demande créée, étape, banquier nommé", async () => {
    const s = await world("Les Directs Live");
    const got: LiveEvent[] = [];
    const off = bus.add({ userId: s.owner.user.id, groups: new Set([s.g.id]), send: e => got.push(e) });
    try {
      const q = await make(s, s.p.Pikou!, ITEM, 1);
      await act(s, s.owner, q.id, "prepare");
      await act(s, s.owner, q.id, "done");
      await setBanker(s, s.owner, s.p.Vexou!, true);
      expect(got.filter(e => e.t === "guild")).toHaveLength(4);
      expect(got.every(e => "g" in e && e.g === s.g.id)).toBe(true);
      // Un geste refusé ne prévient personne
      got.length = 0;
      await act(s, s.p.Zed!, q.id, "prepare");
      expect(got).toEqual([]);
    } finally { off(); }
  });
});

describe("banquiers", () => {
  it("les officiers et le propriétaire nomment et retirent ; GroupDetail dit qui est banquier ; journal de la guilde", async () => {
    const s = await world("Les Banquiers");
    const detail = async (who: Signed) => (await who.c.get(`/api/groups/${s.g.id}`)).json() as { banker: boolean; members: { userId: string; banker: boolean; role: string }[] };
    let d = await detail(s.p.Banq!);
    expect(d.banker).toBe(true);
    expect(d.members.filter(x => x.banker).map(x => x.userId)).toEqual([s.p.Banq!.user.id]);
    expect((await detail(s.p.Pikou!)).banker).toBe(false);

    // Un officier nomme Pikou, puis le retire
    const set = await setBanker(s, s.p.Off!, s.p.Pikou!, true);
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toEqual({ ok: true, banker: true });
    expect((await detail(s.p.Pikou!)).banker).toBe(true);
    expect((await bankOf(s, s.p.Pikou!)).requests.canHandle).toBe(true);
    expect((await setBanker(s, s.owner, s.p.Pikou!, false)).json()).toEqual({ ok: true, banker: false });
    d = await detail(s.owner);
    expect(d.members.filter(x => x.banker).map(x => x.userId)).toEqual([s.p.Banq!.user.id]);

    // Journal : un événement par changement, rien quand rien ne change
    await setBanker(s, s.owner, s.p.Banq!, true);
    const log = await db().select().from(auditEvents).where(and(eq(auditEvents.groupId, s.g.id)));
    const banker = log.filter(e => e.type === "banker_set" || e.type === "banker_unset");
    expect(banker.map(e => `${e.type}:${e.userId === s.p.Off!.user.id ? "Off" : e.userId === s.owner.user.id ? "Chef" : "?"}:${(e.meta as { target: string }).target === s.p.Pikou!.user.id ? "Pikou" : "autre"}`))
      .toEqual(expect.arrayContaining(["banker_set:Off:Pikou", "banker_unset:Chef:Pikou"]));
    expect(banker.filter(e => (e.meta as { target: string }).target === s.p.Banq!.user.id)).toHaveLength(1); // nommé par world(), pas deux fois
    const journal = (await s.owner.c.get(`/api/groups/${s.g.id}/audit`)).json().events as { type: string; meta: { name?: string } }[];
    expect(journal.find(e => e.type === "banker_unset")!.meta.name).toMatch(/Pikou$/);
  });

  it("droits : un membre ou un banquier ne nomme pas (403) ; cible hors de la guilde 404 ; corps invalide 400 ; guilde de Retail 400", async () => {
    const s = await world("Les Gardes");
    expect((await setBanker(s, s.p.Pikou!, s.p.Vexou!, true)).statusCode).toBe(403);
    expect((await setBanker(s, s.p.Banq!, s.p.Vexou!, true)).statusCode).toBe(403);
    expect((await setBanker(s, s.p.Banq!, s.p.Banq!, false)).statusCode).toBe(403);
    expect((await setBanker(s, s.p.Off!, s.p.Vexou!, "oui")).statusCode).toBe(400);
    expect((await s.owner.c.put(`/api/groups/${s.g.id}/members/${s.p.Vexou!.user.id}/banker`, {})).statusCode).toBe(400);
    const out = await sceneOf(env, "Les Hors", []);
    expect((await setBanker(s, s.owner, out.owner, true)).statusCode).toBe(404);
    expect((await out.owner.c.put(`/api/groups/${s.g.id}/members/${s.p.Vexou!.user.id}/banker`, { banker: true })).statusCode).toBe(404);
    expect(await db().$count(groupMembers, and(eq(groupMembers.groupId, s.g.id), eq(groupMembers.banker, true)))).toBe(1);
    // Un officier peut l'être aussi (le drapeau ne change pas ses droits)
    expect((await setBanker(s, s.owner, s.p.Off!, true)).statusCode).toBe(200);
  });
});

describe("liste des demandes dans la banque, accueil", () => {
  it("en cours : toutes, la plus ancienne d'abord, nom de l'objet ; terminées : les 20 dernières closes, la plus récente d'abord ; canHandle pour ceux qui traitent", async () => {
    const s = await world("Les Listes");
    const t0 = Date.now();
    const a = await make(s, s.p.Pikou!, ITEM, 10, "pour monter Alchimie");
    const b = await make(s, s.p.Vexou!, CLOTH, 2);
    const c = await make(s, s.p.Pikou!, 4306, 1);
    await act(s, s.owner, c.id, "prepare");
    await db().update(bankRequests).set({ createdAt: new Date(t0 - 3 * HOUR * 1000) }).where(eq(bankRequests.id, c.id));
    await db().update(bankRequests).set({ createdAt: new Date(t0 - HOUR * 1000) }).where(eq(bankRequests.id, a.id));
    let v = await bankOf(s, s.p.Vexou!);
    expect(v.requests.open.map(r => r.id)).toEqual([c.id, a.id, b.id]);
    expect(v.requests.open.map(r => r.status)).toEqual(["prepared", "pending", "pending"]);
    expect(v.requests.myOpen).toBe(1);
    expect(v.objects[ITEM]).toMatchObject({ name: "Major Healing Potion" });
    expect(Object.keys(v.requests).sort()).toEqual(["canHandle", "done", "myOpen", "open"]);
    for (const who of [s.owner, s.p.Off!, s.p.Banq!]) expect((await bankOf(s, who)).requests.canHandle).toBe(true);
    for (const who of [s.p.Pikou!, s.p.Zed!]) expect((await bankOf(s, who)).requests.canHandle).toBe(false);

    // 22 demandes closes : seules les 20 dernières sont montrées, la plus récemment close d'abord
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const r = await db().insert(bankRequests).values({
        groupId: s.g.id, userId: s.p.Zed!.user.id, itemId: 2589, quantity: i + 1, status: "done", closedAt: new Date(t0 - (30 - i) * 60e3),
      }).returning({ id: bankRequests.id });
      ids.push(r[0]!.id);
    }
    v = await bankOf(s, s.p.Vexou!);
    expect(v.requests.done).toHaveLength(20);
    expect(v.requests.done.map(r => r.id)).toEqual(ids.slice(2).reverse());
    expect(v.requests.done[0]).toMatchObject({ status: "done", quantity: 22 });
    // Les demandes de la liste et de la banque : aussi pour la guilde qui n'est pas liée (rien)
    const none = await sceneOf(env, "Les Rien", ["Pikou"]);
    const empty = await none.get<GuildBankResponse>(none.p.Pikou!, "/guild/bank");
    expect(empty).toMatchObject({ linked: false, bank: null, requests: { open: [], done: [], canHandle: false, myOpen: 0 } });
    const nobank = await none.get<GuildBankResponse>(none.owner, "/guild/bank");
    expect(nobank.requests).toMatchObject({ canHandle: true });
  });

  it("« À traiter » de l'accueil : le nombre de demandes en attente pour les officiers, le propriétaire et les banquiers ; null pour les autres", async () => {
    const s = await world("Les Accueils");
    for (const who of [s.owner, s.p.Off!, s.p.Banq!]) expect((await homeOf(s, who)).bankRequests, "avant").toBe(0);
    for (const who of [s.p.Pikou!, s.p.Zed!]) expect((await homeOf(s, who)).bankRequests).toBeNull();
    const a = await make(s, s.p.Pikou!, ITEM, 1);
    await make(s, s.p.Vexou!, CLOTH, 1);
    const c = await make(s, s.p.Vexou!, 4306, 1);
    for (const who of [s.owner, s.p.Off!, s.p.Banq!]) expect((await homeOf(s, who)).bankRequests).toBe(3);
    // Préparée, remise, refusée, annulée : ne comptent plus
    await act(s, s.owner, a.id, "prepare");
    expect((await homeOf(s, s.p.Banq!)).bankRequests).toBe(2);
    await act(s, s.owner, c.id, "refuse");
    expect((await homeOf(s, s.owner)).bankRequests).toBe(1);
    expect((await homeOf(s, s.p.Pikou!)).bankRequests).toBeNull();
  });

  it("délier la guilde du jeu efface aussi les demandes", async () => {
    const s = await world("Les Delies");
    const q = await make(s, s.p.Pikou!, ITEM, 1);
    await act(s, s.owner, q.id, "prepare");
    expect(await db().$count(bankRequestNotices)).toBeGreaterThan(0);
    expect((await s.owner.c.del(`/api/groups/${s.g.id}/guild/link`)).statusCode).toBe(200);
    expect(await db().$count(bankRequests, eq(bankRequests.groupId, s.g.id))).toBe(0);
  });
});

describe("MP du bot au demandeur", () => {
  /** Joueur dont le Discord est lié (et ses messages privés du bot gardés ou non). */
  const linkDiscord = async (who: Signed, reminders = true) => {
    const discordId = nextId();
    await db().update(users).set({ discordId, discordReminders: reminders }).where(eq(users.id, who.user.id));
    return discordId;
  };
  const claim = async () => (await bot("POST", "/internal/discord/bank/notices/claim")).json().notices as {
    id: number; discordUserId: string; kind: string; item: string; quantity: number; by: string; reason: string; groupName: string; url: string;
  }[];

  it("préparée ou refusée : un MP, remis une seule fois au bot, avec le nom de l'objet, de qui l'a préparée et le motif", async () => {
    const s = await world("Les Messagers");
    await claim(); // vide la file des autres tests
    const dId = await linkDiscord(s.p.Pikou!);
    const a = await make(s, s.p.Pikou!, ITEM, 20);
    const b = await make(s, s.p.Pikou!, CLOTH, 2);
    const c = await make(s, s.p.Pikou!, 4306, 1);
    // Rien tant que personne n'a traité, ni quand c'est remis directement ou annulé
    expect(await claim()).toEqual([]);
    await act(s, s.p.Banq!, c.id, "done");
    expect(await claim()).toEqual([]);
    await act(s, s.p.Off!, a.id, "prepare");
    await act(s, s.owner, b.id, "refuse", "réservé pour le raid");
    const notices = await claim();
    expect(notices).toEqual([
      expect.objectContaining({ discordUserId: dId, kind: "prepared", item: "Major Healing Potion", quantity: 20, by: "Offa", reason: "", groupName: "Les Messagers", url: `${env.cfg.APP_ORIGIN}/groups/${s.g.id}/membres/banque` }),
      expect.objectContaining({ discordUserId: dId, kind: "refused", item: "Linen Cloth", quantity: 2, by: "Kaeldra", reason: "réservé pour le raid" }),
    ]);
    // Une seule fois
    expect(await claim()).toEqual([]);
    const rows = await db().select().from(bankRequestNotices).where(eq(bankRequestNotices.requestId, a.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.claimedAt).toBeInstanceOf(Date);
    expect(rows[0]!.sentAt).toBeNull();
    // Le bot confirme l'envoi
    expect((await bot("POST", `/internal/discord/bank/notices/${notices[0]!.id}/sent`)).statusCode).toBe(200);
    expect((await db().select().from(bankRequestNotices).where(eq(bankRequestNotices.id, notices[0]!.id)))[0]!.sentAt).toBeInstanceOf(Date);
    expect((await bot("POST", "/internal/discord/bank/notices/0/sent")).statusCode).toBe(400);
  });

  it("pas de MP : Discord pas lié, messages privés du bot désactivés, ou demande plus dans l'étape annoncée ; le motif et le nom manquants sont gérés", async () => {
    const s = await world("Les Silencieux");
    await claim();
    await linkDiscord(s.p.Vexou!, false); // MP du bot coupés
    // Zed n'a pas de Discord
    const v = await make(s, s.p.Vexou!, ITEM, 1);
    const z = await make(s, s.p.Zed!, ITEM, 1);
    await act(s, s.owner, v.id, "prepare");
    await act(s, s.owner, z.id, "refuse");
    expect(await claim()).toEqual([]);
    // Il remet ses MP : les anciens avis, déjà pris, ne reviennent pas
    await db().update(users).set({ discordReminders: true }).where(eq(users.id, s.p.Vexou!.user.id));
    expect(await claim()).toEqual([]);
    // Préparée puis remise avant que le bot ne passe : « est prête » serait faux
    const dId = await linkDiscord(s.p.Pikou!);
    const q = await make(s, s.p.Pikou!, ITEM, 3);
    await act(s, s.owner, q.id, "prepare");
    await act(s, s.owner, q.id, "done");
    expect(await claim()).toEqual([]);
    // Un refus sans motif
    const r = await make(s, s.p.Pikou!, CLOTH, 1);
    await act(s, s.p.Banq!, r.id, "refuse");
    expect(await claim()).toEqual([expect.objectContaining({ discordUserId: dId, kind: "refused", reason: "", by: "Gorrak" })]);
  });

  it("la route du bot demande le secret", async () => {
    expect((await internal.inject({ method: "POST", url: "/internal/discord/bank/notices/claim" })).statusCode).toBe(401);
  });
});

describe("purge des demandes closes", () => {
  it("closes depuis plus de 90 jours : effacées avec leurs avis ; ouvertes et récentes : gardées", async () => {
    const s = await world("Les Archives");
    const DAYS = 86400e3;
    const mk = async (status: "pending" | "prepared" | "done" | "refused" | "cancelled", closedDaysAgo: number | null, itemId = ITEM) => {
      const [r] = await db().insert(bankRequests).values({
        groupId: s.g.id, userId: s.p.Pikou!.user.id, itemId, quantity: 1, status,
        createdAt: new Date(Date.now() - 200 * DAYS), closedAt: closedDaysAgo === null ? null : new Date(Date.now() - closedDaysAgo * DAYS),
      }).returning({ id: bankRequests.id });
      return r!.id;
    };
    const old = [await mk("done", 91), await mk("refused", 120), await mk("cancelled", 365)];
    const recent = await mk("done", 89);
    const openOld = [await mk("pending", null), await mk("prepared", null)];
    await db().insert(bankRequestNotices).values([{ requestId: old[1]!, kind: "refused" }, { requestId: recent, kind: "prepared" }]);
    const n = await purgeOldData(db());
    expect(n).toMatchObject({ bankRequests: 3 });
    const left = (await db().select({ id: bankRequests.id }).from(bankRequests).where(eq(bankRequests.groupId, s.g.id))).map(r => r.id).sort();
    expect(left).toEqual([recent, ...openOld].sort());
    expect(await db().$count(bankRequestNotices, eq(bankRequestNotices.requestId, old[1]!))).toBe(0);
    expect(await db().$count(bankRequestNotices, eq(bankRequestNotices.requestId, recent))).toBe(1);
    // Au passage suivant, rien à effacer
    expect(await purgeOldData(db())).toMatchObject({ bankRequests: 0 });
  });
});
