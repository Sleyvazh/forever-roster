/**
 * Icônes absentes du serveur d'images de Blizzard : téléchargées depuis les fichiers du jeu (wago.tools, format BLP)
 * par leur identifiant de fichier, puis converties en JPEG 56×56 comme les autres.
 *
 *   entrée standard : une ligne « <identifiant> <nom> » par icône ; argument : dossier de destination
 *   docker compose run --rm --no-deps -T -v "$PWD/icons/items:/out" api node dist/blp-icons.js /out < liste
 *
 * Le nom ne sert qu'au nom du fichier : seuls a-z, 0-9, « _ » et « - » sont acceptés.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { blpToJpeg } from "./blp";

const BRANCHES = (process.env.WAGO_BRANCHES ?? "wow_classic_beta,wow_classic,wow_classic_era").split(",");
const out = process.argv[2];
if (!out) throw new Error("dossier de destination manquant");

async function fetchBlp(fid: number) {
  for (const branch of BRANCHES) {
    const res = await fetch(`https://wago.tools/api/casc/${fid}?download&branch=${encodeURIComponent(branch)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.toString("latin1", 0, 4) === "BLP2") return buf;
  }
  return null;
}

const input: Buffer[] = [];
for await (const c of process.stdin) input.push(c as Buffer);
const jobs = Buffer.concat(input).toString("utf8").split("\n").map(l => l.trim().split(/\s+/))
  .filter(([fid, name]) => /^\d{1,9}$/.test(fid ?? "") && /^[a-z0-9_-]{1,100}$/.test(name ?? ""));

let ok = 0; const failed: string[] = [];
const queue = [...jobs];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const [fid, name] = job as [string, string];
    try {
      const blp = await fetchBlp(Number(fid));
      if (!blp) { failed.push(name); continue; }
      await writeFile(path.join(out, `${name}.jpg`), await blpToJpeg(blp));
      ok++;
    } catch (err) { failed.push(`${name} (${(err as Error).message})`); }
  }
}));
console.log(`Fichiers du jeu : ${ok} icônes converties${failed.length ? `, ${failed.length} introuvables (ex. ${failed.slice(0, 3).join(", ")})` : ""}.`);
