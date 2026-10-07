import { buildRRR, RETAIL_NO_SOFTRES, retailRoleOf, type RosterExportMember } from "@forever/game-data";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raids, raidTemplates } from "../src/db/schema";
import { importAddonText } from "../src/lib/addon-import";
import { frgEtag } from "../src/routes/sync";
import { Client, setup, signedIn, tokenFrom, type TestEnv } from "./helpers";

/**
 * Roster (lot R3a) : le site côté addon Roster de WoW Retail. « Copier pour le jeu » en RRG, compo en RRR,
 * bilan RRB collé (Ctrl+V) par un officier, textes de l'autre addon refusés sur chaque site. Noms fictifs.
 */
const RETAIL = "http://roster.test";
class RetailClient extends Client {
  override req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return super.req(method, url, body, { host: "roster.test", origin: RETAIL, ...headers });
  }
}

let env: TestEnv;
beforeAll(async () => { env = await setup({ RETAIL_ORIGIN: RETAIL }); });
afterAll(async () => { await env.close(); });

async function retailUser(name: string) {
  const { email, password, c: forever, user } = await signedIn(env, name);
  const r = new RetailClient(env);
  expect((await r.post("/api/auth/login", { email, password })).statusCode).toBe(200);
  return { r, forever, user };
}

type Ctx = Awaited<ReturnType<typeof scene>>;
/** Un groupe de Roster : officière (Kaeldra-Hyjal), membre (Tharok-Conseil des Ombres, et un homonyme sur Ysondre), raid Héroïque. */
async function scene(tag: string) {
  const off = await retailUser(`Off${tag}`), mem = await retailUser(`Mem${tag}`);
  const g = (await off.r.post("/api/groups", { name: `Pasta e Basta ${tag}` })).json().group;
  const inv = (await off.r.post(`/api/groups/${g.id}/invites`, { maxUses: 5, expiresInHours: 24 })).json().invite;
  expect((await mem.r.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) })).statusCode).toBe(200);
  const at = Math.floor(Date.now() / 1000) + 2 * 86400;
  const raid = (await off.r.post(`/api/groups/${g.id}/raids`, { name: "Flèche du Vide", difficulty: "heroic", size: 25, scheduledAt: new Date(at * 1000).toISOString() })).json().raid;
  const kaeldra = (await off.r.post("/api/characters", { name: "Kaeldra", realm: "Hyjal", cls: "Demon Hunter", spec1: "Devourer" })).json().character;
  const tharok = (await mem.r.post("/api/characters", { name: "Tharok", realm: "Conseil des Ombres", cls: "Death Knight", spec1: "Blood" })).json().character;
  const twin = (await mem.r.post("/api/characters", { name: "Tharok", realm: "Ysondre", cls: "Warrior", spec1: "Arms" })).json().character;
  const base = `/api/groups/${g.id}/raids/${raid.id}`;
  expect((await off.r.put(`${base}/signup`, { status: "present", characterId: kaeldra.id, spec: "Devourer" })).statusCode).toBe(200);
  expect((await mem.r.put(`${base}/signup`, { status: "late", characterId: tharok.id, spec: "Blood" })).statusCode).toBe(200);
  expect((await mem.r.put(`/api/groups/${g.id}/characters/${twin.id}`, { assigned: true })).statusCode).toBe(200);
  return { off, mem, g, raid, at, base, kaeldra, tharok, twin };
}

const rrb = (s: Ctx, opts: { lead?: boolean; loot?: boolean } = {}) => {
  const { raid, at } = s;
  const lines = [
    `A;Kaeldra-Hyjal;${at - 600};${at + 3 * 3600};190`,
    `A;tharok-ConseildesOmbres;${at + 1800};${at + 3 * 3600};150`,
    `A;Inconnue-Ysondre;${at};${at + 600};10`,
    ...(opts.loot === false ? [] : [`L;249321;Tharok-ConseildesOmbres;${at + 1200};Imperator Averzian;;;`, `L;249322;Kaeldra-Hyjal;${at + 5000};Vorasius;;;;Lame du Vide`]),
    `E;3176;Imperator Averzian;${at + 1000};0`,
    `E;3176;Imperator Averzian;${at + 1150};1`,
    `E;3177;Vorasius;${at + 4900};0`,
  ];
  return [`RRB;1;${raid.id};${at - 600};${at + 3 * 3600};Kaeldra-Hyjal;Flèche du Vide;The Voidspire;${opts.lead === false ? 0 : 1};heroic`, ...lines, `END;${lines.length}`].join("\n");
};

describe("Roster : « Copier pour le jeu » (RRG) et compo (RRR)", () => {
  it("RRG sur Roster, FRG inchangé sur Forever Roster", async () => {
    const s = await scene("A");
    const out = (await s.off.r.get("/api/addon/export")).json();
    expect(out.groups).toEqual([{ name: "Pasta e Basta A", raids: 1, patterns: 0, bis: 0 }]);
    const lines = out.text.split("\n");
    expect(lines[0]).toMatch(new RegExp(`^RRG;1;${s.g.id};\\d+;Pasta e Basta A$`));
    expect(lines.slice(1)).toEqual([
      `R;${s.raid.id};${s.at};Flèche du Vide;heroic;25;present;Kaeldra-Hyjal;journal`,
      // Lot R3b : conseil par défaut (persos des officiers) et objets reçus, par joueur (main d'abord), hors du compte de END
      "O;Kaeldra-Hyjal",
      "N;saison;depuis le début;Kaeldra-Hyjal:0,Tharok-ConseildesOmbres+Tharok-Ysondre:0",
      "END;1",
    ]);
    // Le membre : son inscription et son perso
    expect((await s.mem.r.get("/api/addon/export")).json().text).toContain(`;heroic;25;late;Tharok-ConseildesOmbres;journal`);
    // Un seul groupe (Administration) : même format
    expect((await s.off.r.get(`/api/groups/${s.g.id}/addon-export`)).json().text).toMatch(/^RRG;1;/);
    // Forever Roster : seulement les groupes de Forever, en FRG
    const fg = (await s.off.forever.post("/api/groups", { name: "Classique A" })).json().group;
    const fe = (await s.off.forever.get("/api/addon/export")).json();
    expect(fe.text).toMatch(new RegExp(`^FRG;1;${fg.id};`));
    expect(fe.text).not.toContain("RRG");
    // Roster Companion : l'empreinte ne dépend pas de la date de génération
    const at = (t: number) => out.text.replace(/^(RRG;1;[^;]+;)\d+/, (_: string, head: string) => `${head}${t}`);
    expect(frgEtag(at(1))).toBe(frgEtag(at(2)));
    expect(frgEtag(at(1))).not.toBe(frgEtag(at(1).replace(";present;", ";late;")));
  });

  it("RRR : noms « Prénom-Royaume » d'après les fiches et les inscriptions du raid", async () => {
    const s = await scene("B");
    const view = (await s.off.r.get(s.base)).json();
    const chars = new Map(((await s.off.r.get(`/api/groups/${s.g.id}/characters`)).json().characters as { id: string; realm: string }[]).map(c => [c.id, c]));
    const members: RosterExportMember[] = (view.signups as { characterId: string; characterName: string; characterRealm: string; cls: string; spec: string; status: "present" }[])
      .map((su, i) => ({ name: su.characterName, realm: su.characterRealm ?? chars.get(su.characterId)?.realm ?? null, cls: su.cls, spec: su.spec, role: retailRoleOf(su.cls, su.spec),
        group: i === 0 ? 1 : 0, pos: i === 0 ? 1 : 0, status: su.status, source: "site" }));
    expect(view.signups.map((x: { characterRealm: string }) => x.characterRealm)).toEqual(["Hyjal", "Conseil des Ombres"]);
    const text = buildRRR({ id: s.raid.id, name: view.raid.name, scheduledAt: view.raid.scheduledAt, difficulty: view.raid.difficulty, size: view.raid.size }, members);
    expect(text.split("\n")).toEqual([
      `RRR;1;${s.raid.id};${s.at};Flèche du Vide;heroic;25`,
      "M;Kaeldra-Hyjal;DEMONHUNTER;DPS;Devourer;1;1;present;site",
      "M;Tharok-ConseildesOmbres;DEATHKNIGHT;Tank;Blood;0;0;late;site",
      "END;2",
    ]);
  });
});

describe("Roster : bilan RRB collé sur le site", () => {
  it("officier : présence rapprochée avec le royaume, butin, rencontres ; un membre est refusé", async () => {
    const s = await scene("C");
    // Un simple membre ne peut pas enregistrer le bilan
    const refused = (await s.mem.r.post("/api/addon/import", { text: rrb(s) })).json();
    expect(refused.results).toMatchObject([{ kind: "raidlog", status: "refused", key: `rrb:${s.raid.id}` }]);
    const ok = (await s.off.r.post("/api/addon/import", { text: rrb(s) })).json();
    expect(ok.errors).toEqual([]);
    expect(ok.results).toMatchObject([{ kind: "raidlog", status: "updated", name: "Bilan de Flèche du Vide" }]);
    expect(ok.results[0].message).toBe("enregistré · 3 présents, 2 objets, 1 boss vaincu · sans fiche : Inconnue-Ysondre");

    const log = (await s.mem.r.get(s.base)).json().log;
    // Tharok de Conseil des Ombres (pas son homonyme d'Ysondre), en retard ; l'inconnue reste sans fiche
    expect(log.attendance.map((a: { name: string; characterId: string | null; status: string }) => [a.name, a.characterId, a.status])).toEqual([
      ["Kaeldra", s.kaeldra.id, "present"], ["Tharok", s.tharok.id, "late"], ["Inconnue-Ysondre", null, "left"],
    ]);
    expect(log.loot).toMatchObject([
      { itemId: 249321, itemName: "Objet 249321", name: "Tharok", characterId: s.tharok.id, boss: "Imperator Averzian" },
      { itemId: 249322, itemName: "Lame du Vide", name: "Kaeldra", characterId: s.kaeldra.id },
    ]);
    expect(log.encounters).toEqual([
      { encounterId: 3176, boss: "Imperator Averzian", at: s.at + 1000, killed: false },
      { encounterId: 3176, boss: "Imperator Averzian", at: s.at + 1150, killed: true },
      { encounterId: 3177, boss: "Vorasius", at: s.at + 4900, killed: false },
    ]);
    expect(log.difficulty).toBe("heroic");
    expect(log.recorder).toBe("Kaeldra-Hyjal");

    // Présence & butin du groupe : par perso, avec le royaume
    const att = (await s.mem.r.get(`/api/groups/${s.g.id}/attendance`)).json();
    const byId = Object.fromEntries(att.characters.map((c: { id: string }) => [c.id, c]));
    expect(byId[s.tharok.id]).toMatchObject({ cells: ["late"], attended: 1, loot: 1, lastItem: { id: 249321, name: "Objet 249321" } });
    expect(byId[s.kaeldra.id]).toMatchObject({ cells: ["present"], loot: 1, lastItem: { name: "Lame du Vide" } });
    // L'homonyme d'Ysondre n'était pas là (il partage le compte des objets reçus de son joueur)
    expect(byId[s.twin.id]).toMatchObject({ cells: [null], attended: 0, loot: 0, counted: 1 });
    expect(byId[s.tharok.id].counted).toBe(1);
    // Fiche du joueur dans le groupe
    const sheet = (await s.off.r.get(`/api/groups/${s.g.id}/members/${s.mem.user.id}/sheet`)).json();
    expect(sheet.attendance).toMatchObject({ raids: 1, attended: 1 });
    expect(sheet.loot).toMatchObject([{ itemId: 249321, character: "Tharok-ConseildesOmbres" }]);
  });

  it("chef de raid (K1) : un envoi automatique d'un autre ne remplace pas son bilan ; un collage, si", async () => {
    const s = await scene("D");
    const user = { id: s.off.user.id, displayName: "OffD" };
    const db = env.app.ctx.db;
    expect((await importAddonText(db, user, rrb(s), { game: "retail" })).results[0]).toMatchObject({ status: "updated" });
    const kept = await importAddonText(db, user, rrb(s, { lead: false, loot: false }), { game: "retail", auto: true });
    expect(kept.results[0]).toMatchObject({ status: "kept" });
    expect((await s.off.r.get(s.base)).json().log.loot).toHaveLength(2);
    // Collé à la main : le dernier bilan remplace toujours le précédent
    expect((await s.off.r.post("/api/addon/import", { text: rrb(s, { lead: false, loot: false }) })).json().results[0]).toMatchObject({ status: "updated" });
    expect((await s.off.r.get(s.base)).json().log.loot).toEqual([]);
    // Un bilan ignoré au collage (skipLogs) n'est pas enregistré
    expect((await s.off.r.post("/api/addon/import", { text: rrb(s), skipLogs: [s.raid.id] })).json().results).toEqual([]);
  });

  it("bilans abîmés signalés, les autres enregistrés", async () => {
    const s = await scene("E");
    const r = (await s.off.r.post("/api/addon/import", { text: `${rrb(s)}\nRRB;1;pas-un-raid;1;2;X-Y;Raid;;0;\nEND;0` })).json();
    expect(r.results).toHaveLength(1);
    expect(r.errors).toEqual(["Bilan ignoré : bilan sans raid du site (copie les données du site dans l'addon avant le raid)"]);
  });
});

describe("textes de l'autre addon refusés", () => {
  it("sur Roster, un texte de Forever Roster (persos ou bilan) ; sur Forever Roster, un texte de Roster", async () => {
    const s = await scene("F");
    const frc = "FRC;2;Tournicoti;Forever EU;DRUID;Tauren;60;Horde;1790000000;1.5.4\nEND;0";
    const onRoster = (await s.off.r.post("/api/addon/import", { text: frc })).json();
    expect(onRoster.results).toEqual([]);
    expect(onRoster.errors).toEqual(["Ce texte vient de l'addon Forever Roster : colle-le sur app.test. Sur Roster, les persos viennent de Battle.net (« Importer depuis Battle.net ») ou se créent à la main."]);
    expect((await s.off.r.get("/api/characters")).json().characters.map((c: { name: string }) => c.name)).toEqual(["Kaeldra"]);
    const frb = `FRB;2;${s.raid.id};${s.at};${s.at + 3600};Kaeldra;Flèche du Vide;The Voidspire;1\nA;Kaeldra;${s.at};${s.at + 3600};60\nEND;1`;
    const frbOnRoster = (await s.off.r.post("/api/addon/import", { text: frb })).json();
    expect(frbOnRoster).toEqual({ results: [], errors: ["Ce texte vient de l'addon Forever Roster : colle-le sur app.test."] });
    expect((await s.off.r.get(s.base)).json().log).toBeNull();

    const onForever = (await s.off.forever.post("/api/addon/import", { text: rrb(s) })).json();
    expect(onForever).toEqual({ results: [], errors: ["Ce texte vient de l'addon Roster (WoW Retail) : colle-le sur roster.test."] });
    // Un bilan de Forever pour un raid de Roster (identifiant recopié à la main) : refusé, rien d'enregistré
    const cross = (await s.off.forever.post("/api/addon/import", { text: frb })).json();
    expect(cross.results).toMatchObject([{ status: "error", message: "Ce bilan est celui d'un raid de Roster (WoW Retail)." }]);
    expect((await s.off.r.get(s.base)).json().log).toBeNull();
  });
});

/* ---------- Lot R3b : distribution du butin par Roster ---------- */

describe("Roster : modes de butin (journal ou conseil, pas de soft reserve)", () => {
  it("soft reserve refusée pour un raid ou un raid récurrent de Roster ; conseil accepté ; Forever inchangé", async () => {
    const s = await scene("G");
    const gr = `/api/groups/${s.g.id}`;
    const refused = await s.off.r.post(`${gr}/raids`, { name: "L'Abîme Venimeux", difficulty: "normal", lootMode: "softres" });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe(RETAIL_NO_SOFTRES);
    const council = await s.off.r.post(`${gr}/raids`, { name: "L'Abîme Venimeux", difficulty: "normal", lootMode: "council" });
    expect(council.statusCode).toBe(201);
    expect((await s.off.r.get(`${gr}/raids/${council.json().raid.id}`)).json().raid.lootMode).toBe("council");
    // Page du raid (onglet Butin) et enregistrement de la compo
    expect((await s.off.r.patch(`${s.base}/loot`, { lootMode: "softres" })).json().error).toBe(RETAIL_NO_SOFTRES);
    expect((await s.off.r.patch(`${s.base}/loot`, { lootMode: "council" })).json()).toMatchObject({ lootMode: "council" });
    expect((await s.off.r.put(s.base, { name: "Flèche du Vide", slots: [], lootMode: "softres" })).json().error).toBe(RETAIL_NO_SOFTRES);
    // Raids récurrents
    expect((await s.off.r.post(`${gr}/raid-templates`, { name: "Flèche du Vide", weekday: 3, time: "21:00", difficulty: "heroic", lootMode: "softres" })).json().error).toBe(RETAIL_NO_SOFTRES);
    const t = (await s.off.r.post(`${gr}/raid-templates`, { name: "Flèche du Vide", weekday: 3, time: "21:00", difficulty: "heroic", lootMode: "council", leadDays: 10, description: "Pull à 21 h" })).json().template;
    expect(t.lootMode).toBe("council");
    // Pause : le reste du modèle ne change pas (mode de butin, description, jours d'avance)
    expect((await s.off.r.patch(`${gr}/raid-templates/${t.id}`, { active: false })).json().template)
      .toMatchObject({ active: false, lootMode: "council", leadDays: 10, description: "Pull à 21 h" });
    expect((await s.off.r.patch(`${gr}/raid-templates/${t.id}`, { lootMode: "softres" })).json().error).toBe(RETAIL_NO_SOFTRES);
    expect((await s.off.r.patch(`${gr}/raid-templates/${t.id}`, { lootMode: "journal" })).json().template.lootMode).toBe("journal");
    // Réservations : jamais sur Roster
    expect((await s.mem.r.put(`${s.base}/soft-reserves`, { characterId: s.tharok.id, itemId: 1 })).json().error).toBe(RETAIL_NO_SOFTRES);
    // Forever Roster : la soft reserve reste proposée
    const fg = (await s.off.forever.post("/api/groups", { name: "Classique G" })).json().group;
    expect((await s.off.forever.post(`/api/groups/${fg.id}/raids`, { name: "Molten Core", lootMode: "softres" })).statusCode).toBe(201);
  });

  it("données existantes : un raid ou un modèle de Roster déjà en soft reserve reste valable, envoyé en journal à l'addon", async () => {
    const s = await scene("H");
    const db = env.app.ctx.db;
    await db.update(raids).set({ lootMode: "softres" }).where(eq(raids.id, s.raid.id));
    expect((await s.off.r.patch(`${s.base}/loot`, { lootMode: "softres", srHidden: true })).statusCode).toBe(200);
    expect((await s.off.r.put(s.base, { name: "Flèche du Vide", slots: [], lootMode: "softres" })).statusCode).toBe(200);
    expect((await s.off.r.get("/api/addon/export")).json().text).toContain(`;heroic;25;present;Kaeldra-Hyjal;journal`);
    const gr = `/api/groups/${s.g.id}`;
    const t = (await s.off.r.post(`${gr}/raid-templates`, { name: "Flèche du Vide", weekday: 4, time: "21:00", difficulty: "heroic" })).json().template;
    await db.update(raidTemplates).set({ lootMode: "softres" }).where(eq(raidTemplates.id, t.id));
    expect((await s.off.r.patch(`${gr}/raid-templates/${t.id}`, { name: "Flèche du Vide", lootMode: "softres", time: "21:30" })).statusCode).toBe(200);
  });
});

describe("Roster : conseil du butin et objets reçus (RRG O, L, N)", () => {
  /** Butin distribué par Roster : conseil, jets MS / OS, jet libre, chef de butin, et un objet seulement noté. */
  const lootRRB = (s: Ctx) => {
    const { raid, at } = s;
    const lines = [
      `A;Kaeldra-Hyjal;${at};${at + 3 * 3600};180`,
      `A;Tharok-ConseildesOmbres;${at};${at + 3 * 3600};180`,
      `L;250001;Tharok-ConseildesOmbres;${at + 100};Imperator Averzian;council;bis;3 votes;Heaume du Vide`,
      `L;250002;Kaeldra-Hyjal;${at + 200};Imperator Averzian;council;off;1 vote;Cape d'ombre`,
      `L;250003;Kaeldra-Hyjal;${at + 300};Imperator Averzian;roll;;MS 87;Dague`,
      `L;250004;Tharok-ConseildesOmbres;${at + 400};Vorasius;roll;;OS 54;Bottes`,
      `L;250005;Tharok-Ysondre;${at + 500};Vorasius;roll;;jet 54;Anneau`,
      `L;250006;Tharok-Ysondre;${at + 600};Vorasius;ml;;;Bague`,
      `L;250007;Kaeldra-Hyjal;${at + 700};Vorasius;;;;Cape grise`,
    ];
    return [`RRB;1;${raid.id};${at};${at + 3 * 3600};Kaeldra-Hyjal;Flèche du Vide;The Voidspire;1;heroic`, ...lines, `END;${lines.length}`].join("\n");
  };

  it("conseil choisi pour le raid (onglet Butin) : lu par tous, modifié par les officiers, envoyé en ligne L", async () => {
    const s = await scene("I");
    const view = (await s.mem.r.get(`${s.base}/council`)).json();
    expect(view).toEqual({ council: null, canEdit: false, members: [
      { userId: s.mem.user.id, name: "MemI", officer: false }, { userId: s.off.user.id, name: "OffI", officer: true },
    ] });
    expect((await s.mem.r.put(`${s.base}/council`, { userIds: [s.mem.user.id] })).statusCode).toBe(403);
    expect((await s.off.r.put(`${s.base}/council`, { userIds: [s.mem.user.id, s.off.user.id] })).statusCode).toBe(200);
    expect((await s.off.r.get(`${s.base}/council`)).json()).toMatchObject({ council: [s.mem.user.id, s.off.user.id], canEdit: true });

    // Raid en journal : pas de ligne L ; O = persos des officiers et du propriétaire joués dans le groupe
    const lines = (await s.off.r.get("/api/addon/export")).json().text.split("\n") as string[];
    expect(lines.filter(l => /^[OL];/.test(l))).toEqual(["O;Kaeldra-Hyjal"]);
    expect(lines.at(-1)).toBe("END;1");
    // Raid en conseil : ligne L avec les persos des membres choisis (Prénom-Royaume)
    expect((await s.off.r.patch(`${s.base}/loot`, { lootMode: "council" })).statusCode).toBe(200);
    const text = (await s.mem.r.get("/api/addon/export")).json().text as string;
    expect(text.split("\n").filter(l => /^[ROL];/.test(l))).toEqual([
      `R;${s.raid.id};${s.at};Flèche du Vide;heroic;25;late;Tharok-ConseildesOmbres;council`,
      "O;Kaeldra-Hyjal",
      `L;${s.raid.id};Kaeldra-Hyjal,Tharok-ConseildesOmbres,Tharok-Ysondre`,
    ]);
    // Retour au conseil par défaut : plus de ligne L
    expect((await s.off.r.put(`${s.base}/council`, { userIds: null })).statusCode).toBe(200);
    expect((await s.off.r.get("/api/addon/export")).json().text).not.toMatch(/\nL;/);
  });

  it("objets reçus d'après les bilans RRB : conseil BiS, jet MS, chef de butin et objets notés comptent ; pas OS, jet libre ni Off-Spec", async () => {
    const s = await scene("J");
    const gr = `/api/groups/${s.g.id}`;
    expect((await s.off.r.post("/api/addon/import", { text: lootRRB(s) })).json().results).toMatchObject([{ status: "updated" }]);

    // Bilan : méthode, réponse et détail de chaque objet, et s'il compte
    const log = (await s.mem.r.get(s.base)).json().log;
    expect(log.loot.map((l: { itemId: number; method: string | null; response: string | null; detail: string; skip: string | null; characterId: string | null }) =>
      [l.itemId, l.method, l.response, l.detail, l.skip, l.characterId])).toEqual([
      [250001, "council", "bis", "3 votes", null, s.tharok.id],
      [250002, "council", "off", "1 vote", "Off-Spec", s.kaeldra.id],
      [250003, "roll", null, "MS 87", null, s.kaeldra.id],
      [250004, "roll", null, "OS 54", "jet OS", s.tharok.id],
      [250005, "roll", null, "jet 54", "jet libre", s.twin.id],
      [250006, "ml", null, "", null, s.twin.id],
      [250007, null, null, "", null, s.kaeldra.id],
    ]);

    // Par joueur (réglage par défaut) : Kaeldra 2 (MS, noté) ; Tharok et son homonyme d'Ysondre 2 (conseil BiS, chef de butin)
    const counted = async () => Object.fromEntries(((await s.mem.r.get(`${gr}/attendance`)).json().characters as { id: string; counted: number }[]).map(c => [c.id, c.counted]));
    expect(await counted()).toMatchObject({ [s.kaeldra.id]: 2, [s.tharok.id]: 2, [s.twin.id]: 2 });
    const n = () => s.off.r.get("/api/addon/export").then(r => (r.json().text as string).split("\n").find(l => l.startsWith("N;")));
    expect(await n()).toMatch(/^N;saison;depuis le début;(Kaeldra-Hyjal:2,Tharok-(ConseildesOmbres\+Tharok-Ysondre|Ysondre\+Tharok-ConseildesOmbres):2|Tharok-(ConseildesOmbres\+Tharok-Ysondre|Ysondre\+Tharok-ConseildesOmbres):2,Kaeldra-Hyjal:2)$/);

    // Exclusion par un officier (« Ne pas compter ») : un membre ne peut pas
    const excl = { itemId: 250007, name: "Kaeldra-Hyjal", at: s.at + 700, excluded: true };
    expect((await s.mem.r.put(`${s.base}/loot-exclusions`, excl)).statusCode).toBe(403);
    expect((await s.off.r.put(`${s.base}/loot-exclusions`, excl)).json()).toEqual({ excluded: true });
    expect((await s.mem.r.get(s.base)).json().log.loot.find((l: { itemId: number }) => l.itemId === 250007)).toMatchObject({ excluded: true, skip: null });
    expect(await counted()).toMatchObject({ [s.kaeldra.id]: 1, [s.tharok.id]: 2 });
    // Nom introuvable dans le bilan
    expect((await s.off.r.put(`${s.base}/loot-exclusions`, { ...excl, name: "Kaeldra-Ysondre" })).statusCode).toBe(404);

    // Par perso, avec une correction d'un officier ; la fiche du joueur suit
    expect((await s.off.r.put(`${gr}/loot-settings`, { countBy: "character" })).statusCode).toBe(200);
    expect((await s.off.r.post(`${gr}/loot-corrections`, { characterId: s.tharok.id, delta: 2, note: "Objets donnés hors addon" })).statusCode).toBe(201);
    expect(await counted()).toMatchObject({ [s.kaeldra.id]: 1, [s.tharok.id]: 3, [s.twin.id]: 1 });
    expect(await n()).toMatch(/^N;saison;depuis le début;/);
    expect((await n())!.split(";")[3]!.split(",").sort()).toEqual(["Kaeldra-Hyjal:1", "Tharok-ConseildesOmbres:3", "Tharok-Ysondre:1"]);
    const sheet = (await s.off.r.get(`${gr}/members/${s.mem.user.id}/sheet`)).json();
    expect(sheet.lootCount).toMatchObject({ by: "character", player: 4 });
    expect(sheet.loot.filter((l: { skip: string | null }) => l.skip).map((l: { itemId: number; skip: string }) => [l.itemId, l.skip]).sort())
      .toEqual([[250004, "jet OS"], [250005, "jet libre"]]);
  });
});
