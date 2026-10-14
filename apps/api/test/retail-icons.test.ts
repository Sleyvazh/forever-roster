import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "../src/gamedata/csv";
import { classIconName, fetchRetailIcons, findRetailSpecIcons, latestRetailBuild } from "../src/gamedata/retail-icons";

/**
 * Faux wago.tools et faux serveur d'images de Blizzard sur une adresse locale : le code garde ses vraies URL,
 * seul l'hôte est remplacé par le `fetch` injecté. Depuis les tests, les vrais serveurs ne sont jamais contactés.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const BLP = readFileSync(path.join(here, "fixtures/icon-palette.blp")); // 8×8 à palette
const BUILD = "12.1.5.65100";
// Devourer manque (table d'une version plus ancienne) ; Vengeance a un identifiant que le CASC ne sert pas.
const CSV = [
  "ID,Name_lang,ClassID,SpellIconFileID",
  "250,Blood,6,135770", "251,Frost,6,135773", "252,Unholy,6,135775",
  "577,Havoc,12,1247264", "581,Vengeance,12,1247265",
  "268,Brewmaster,10,608951", "270,Mistweaver,10,608952", "269,Windwalker,10,608953",
  "1467,Devastation,13,4511811", "1468,Preservation,13,4511812", "1473,Augmentation,13,5198700",
  "62,Arcane,8,135932", "64,frost,8,135846", "",
].join("\n");

let server: Server, base = "";
let hits: string[] = [];
let wagoDown = false;
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 56, height: 56, channels: 3, background: "#c41e3a" } }).jpeg().toBuffer();
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.push(url.pathname + url.search);
    const m = /^\/us\/icons\/56\/(classicon_[a-z]+)\.jpg$/.exec(url.pathname);
    if (m) { res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(jpeg); return; }
    if (wagoDown) { res.writeHead(503); res.end("{\"error\":\"maintenance\"}"); return; }
    if (url.pathname === "/api/builds") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ wow_classic_beta: [{ version: "1.60.1.70009" }], wow: [{ version: "12.1.5.65000" }, { version: BUILD }], wowt: [{ version: "12.2.0.65200" }] }));
      return;
    }
    if (url.pathname === "/db2/ChrSpecialization/csv" && url.searchParams.get("build") === BUILD) { res.writeHead(200, { "Content-Type": "text/csv" }); res.end(CSV); return; }
    const casc = /^\/api\/casc\/(\d+)$/.exec(url.pathname);
    if (casc && casc[1] !== "1247265") { res.writeHead(200, { "Content-Type": "application/octet-stream" }); res.end(BLP); return; }
    res.writeHead(404); res.end("{\"error\":\"not found\"}");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});
afterAll(async () => { await new Promise(r => server.close(r)); });
beforeEach(() => { hits = []; wagoDown = false; });

const fetchLocal: typeof fetch = (input, init) =>
  fetch(String(input).replace("https://wago.tools", base).replace("https://render.worldofwarcraft.com", base), init);
const png = async (file: string) => sharp(await readFile(file)).metadata();
const logs: string[] = [];
const log = (m: string) => { logs.push(m); };

describe("icônes officielles des classes propres à Retail", () => {
  it("choisit la dernière version Retail (produit wow avant les serveurs de test)", async () => {
    expect(await latestRetailBuild(fetchLocal)).toEqual({ product: "wow", version: BUILD });
    const fake = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;
    expect(await latestRetailBuild(fake({ wowt: [{ version: "12.2.0.1" }], wow_classic: [{ version: "1.60.1.1" }] }))).toEqual({ product: "wowt", version: "12.2.0.1" });
    expect(await latestRetailBuild(fake({ wow_classic_era: [{ version: "1.15.9.1" }] }))).toBeNull();
    expect(classIconName("death-knight")).toBe("classicon_deathknight");
  });

  it("rapproche les spés de ChrSpecialization par leur nom anglais, pour les quatre classes seulement", () => {
    const icons = findRetailSpecIcons(parseCsv(CSV));
    expect(icons.size).toBe(11);
    expect(icons.get("Death Knight:Blood")).toBe(135770);
    expect(icons.get("Evoker:Augmentation")).toBe(5198700);
    expect(icons.has("Mage:Arcane") || icons.has("Mage:Frost") || icons.has("Demon Hunter:Devourer")).toBe(false);
    // Intitulés de colonnes en casse différente, identifiant de fichier absent → ligne ignorée
    expect(findRetailSpecIcons([{ id: "1", name_lang: "HAVOC", classid: "12", spellIconFileId: "7" }, { ID: "2", Name_lang: "Blood", ClassID: "6", SpellIconFileID: "" }]))
      .toEqual(new Map([["Demon Hunter:Havoc", 7]]));
  });

  it("télécharge classes et spés en PNG 64×64, copie l'icône de classe pour une spé introuvable, puis ne refait que ce qui manque", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "retail-icons-"));
    logs.length = 0;
    const r = await fetchRetailIcons(out, { fetch: fetchLocal, log });
    expect(r.done).toEqual(["death-knight", "demon-hunter", "evoker", "monk",
      "death-knight-blood", "death-knight-frost", "death-knight-unholy", "demon-hunter-havoc",
      "evoker-devastation", "evoker-preservation", "evoker-augmentation", "monk-brewmaster", "monk-mistweaver", "monk-windwalker"]);
    expect(r.copied).toEqual(["demon-hunter-vengeance", "demon-hunter-devourer"]);
    expect(r.failed).toEqual([]);
    expect(r.skipped).toBe(0);
    expect((await readdir(path.join(out, "class"))).sort()).toEqual(["death-knight.png", "demon-hunter.png", "evoker.png", "monk.png"]);
    expect(await readdir(path.join(out, "spec"))).toHaveLength(12);
    expect(await png(path.join(out, "class", "death-knight.png"))).toMatchObject({ width: 64, height: 64, format: "png" });
    expect(await png(path.join(out, "spec", "evoker-augmentation.png"))).toMatchObject({ width: 64, height: 64, format: "png", channels: 4 });
    // Le repli est une copie exacte de l'icône de la classe, et il est signalé
    expect((await readFile(path.join(out, "spec", "demon-hunter-devourer.png"))).equals(await readFile(path.join(out, "class", "demon-hunter.png")))).toBe(true);
    expect(logs.some(l => l.startsWith("icône de spé introuvable : demon-hunter-devourer (absente de ChrSpecialization"))).toBe(true);
    expect(logs.some(l => l.startsWith("icône de spé introuvable : demon-hunter-vengeance (fichier 1247265 introuvable"))).toBe(true);
    expect(logs.at(-1)).toContain("14 téléchargée(s), 0 déjà là, 2 copie(s)");
    // Serveur d'images pour les classes (une fois chacune), wago.tools pour le reste, avec la version Retail
    expect(hits.filter(h => h.startsWith("/us/icons/56/")).sort()).toEqual(["classicon_deathknight", "classicon_demonhunter", "classicon_evoker", "classicon_monk"].map(n => `/us/icons/56/${n}.jpg`));
    expect(hits).toContain(`/db2/ChrSpecialization/csv?build=${BUILD}`);
    expect(hits).toContain("/api/casc/135770?download&branch=wow");
    // Le fichier absent est cherché sur chaque branche Retail, puis on passe au repli
    expect(hits.filter(h => h.startsWith("/api/casc/1247265"))).toEqual(["wow", "wowt", "wowxptr", "wow_beta"].map(b => `/api/casc/1247265?download&branch=${b}`));

    // Deuxième appel : rien n'est retéléchargé, sauf les copies de repli, réessayées (reconnues à leur contenu)
    hits = [];
    const again = await fetchRetailIcons(out, { fetch: fetchLocal, log, branches: ["wow"] });
    expect(again.done).toEqual([]);
    expect(again.copied).toEqual(["demon-hunter-vengeance", "demon-hunter-devourer"]);
    expect(again.skipped).toBe(14);
    expect(hits.filter(h => h.startsWith("/us/icons/"))).toEqual([]);
    expect(hits.filter(h => h.startsWith("/api/casc/"))).toEqual(["/api/casc/1247265?download&branch=wow"]);

    // Tout en place (une vraie icône pour les deux spés) : aucun appel réseau
    for (const n of ["demon-hunter-vengeance", "demon-hunter-devourer"]) await writeFile(path.join(out, "spec", `${n}.png`), await readFile(path.join(out, "spec", "demon-hunter-havoc.png")));
    hits = [];
    const full = await fetchRetailIcons(out, { fetch: fetchLocal, log });
    expect([full.done, full.copied, full.failed, full.skipped]).toEqual([[], [], [], 16]);
    expect(hits).toEqual([]);
  });

  it("sans wago.tools : les classes sont prises, les spés attendent, rien n'est copié et on ne lève pas", async () => {
    const out = await mkdtemp(path.join(tmpdir(), "retail-icons-"));
    wagoDown = true;
    logs.length = 0;
    const r = await fetchRetailIcons(out, { fetch: fetchLocal, log });
    expect(r.done).toEqual(["death-knight", "demon-hunter", "evoker", "monk"]);
    expect(r.copied).toEqual([]);
    expect(r.failed).toHaveLength(12);
    expect(r.failed[0]).toBe("death-knight-blood (wago.tools injoignable)");
    expect(await readdir(path.join(out, "spec"))).toEqual([]);
    expect(logs.some(l => l.startsWith("wago.tools injoignable (wago.tools /api/builds : HTTP 503)"))).toBe(true);
    // Serveur d'images injoignable à son tour (adresse fermée) : l'erreur est comptée, pas levée
    const dead = await mkdtemp(path.join(tmpdir(), "retail-icons-"));
    const none = await fetchRetailIcons(dead, { fetch: (async () => { throw new Error("réseau coupé"); }) as unknown as typeof fetch, log });
    expect(none.done).toEqual([]);
    expect(none.failed.slice(0, 2)).toEqual(["death-knight (réseau coupé)", "demon-hunter (réseau coupé)"]);
    expect(none.failed).toHaveLength(16);
  });
});
