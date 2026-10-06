/**
 * Icônes de rôle du jeu (Tank, Heal, DPS) en PNG 64×64 transparents : tank.png, heal.png, dps.png.
 * Position lue dans les tables du client de Forever (wago.tools), texture téléchargée en BLP puis découpée.
 * Ce sont des fichiers de Blizzard : ils restent dans icons/roles/ du serveur, jamais dans Git. Caddy les sert sous
 * /icons/roles/, le bot en fait des émojis. Sans eux, le site et le bot écrivent le rôle en toutes lettres.
 *
 *   docker compose run --rm --no-deps -T -v "$PWD/icons/roles:/out" api node dist/role-icons.js /out
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { decodeBlp, fetchBlp } from "./blp";
import { cropBox, findRoleAtlases, ROLE_ATLAS, type RoleKey } from "./roles";
import { downloadDb2, latestBuild } from "./source";

const BRANCHES = (process.env.WAGO_BRANCHES ?? "wow_classic_beta,wow_classic,wow_classic_era,wow").split(",");
const out = process.argv[2];
if (!out) throw new Error("dossier de destination manquant");

const { version } = await latestBuild();
const crops = findRoleAtlases(await downloadDb2("UiTextureAtlasMember", version), await downloadDb2("UiTextureAtlas", version));
const textures = new Map<number, ReturnType<typeof decodeBlp> | null>();
const done: string[] = [], failed: string[] = [];
for (const role of Object.keys(ROLE_ATLAS) as RoleKey[]) {
  const c = crops[role];
  if (!c) { failed.push(`${role} (atlas ${ROLE_ATLAS[role]} introuvable)`); continue; }
  if (!textures.has(c.fileDataId)) {
    const blp = await fetchBlp(c.fileDataId, BRANCHES);
    textures.set(c.fileDataId, blp ? decodeBlp(blp, 4096) : null);
  }
  const img = textures.get(c.fileDataId);
  if (!img) { failed.push(`${role} (texture ${c.fileDataId} introuvable)`); continue; }
  const png = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract(cropBox(c, img.width, img.height))
    .resize(64, 64, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  await writeFile(path.join(out, `${role}.png`), png);
  done.push(role);
}
console.log(`Icônes de rôle (version ${version}) : ${done.length ? done.join(", ") : "aucune"}${failed.length ? ` ; manquantes : ${failed.join(", ")}` : ""}.`);
if (failed.length) process.exitCode = 1;
