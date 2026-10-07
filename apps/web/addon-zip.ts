/**
 * Paquets des addons servis par le site : à la construction, addon/ForeverRoster (et addon/Roster, s'il existe), avec
 * addon/shared, sont compressés en dist/downloads/<nom>.zip (format ZIP « deflate », sans dépendance). La version vient du .toc.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import type { Plugin } from "vite";

/** Forever Roster (WoW Forever) et Roster (WoW Retail, lot R3) : un dossier et un zip chacun, code commun dans addon/shared. */
export type AddonName = "ForeverRoster" | "Roster";
const ADDONS_DIR = fileURLToPath(new URL("../../addon", import.meta.url));
const SHARED_DIR = path.join(ADDONS_DIR, "shared");
const addonDir = (name: AddonName) => path.join(ADDONS_DIR, name);
const tocOf = (name: AddonName) => readFileSync(path.join(addonDir(name), `${name}.toc`), "utf8");
const hasAddon = (name: AddonName) => { try { tocOf(name); return true; } catch { return false; } };

export function addonVersion(name: AddonName = "ForeverRoster") {
  try { return tocOf(name).match(/^## Version:\s*(\S+)/m)?.[1] ?? "?"; } catch { return "?"; }
}

/** ZIP minimal : un en-tête local par fichier, puis le répertoire central. */
export function zip(files: { name: string; data: Buffer }[], date = new Date(2026, 0, 1)) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(dosTime, 10); head.writeUInt16LE(dosDate, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26);
    locals.push(head, name, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(dosTime, 12); dir.writeUInt16LE(dosDate, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(f.data.length, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + packed.length;
  }
  const dirSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

/**
 * Fichiers d'un addon : les siens (addon/<nom>), puis ceux communs aux deux addons (addon/shared : boîte à outils,
 * police des titres et sa licence SIL OFL, à distribuer avec la police), et son logo (Media, texture TGA).
 */
function filesIn(dir: string, re: RegExp, prefix: string) {
  try {
    return readdirSync(dir).filter(f => re.test(f)).sort().map(f => ({ name: `${prefix}/${f}`, data: readFileSync(path.join(dir, f)) }));
  } catch { return []; }
}
function addonFiles(name: AddonName = "ForeverRoster") {
  const dir = addonDir(name);
  const own = filesIn(dir, /\.(lua|toc|xml)$/, name);
  const shared = filesIn(SHARED_DIR, /\.lua$/, name).filter(f => !own.some(o => o.name === f.name));
  const fonts = filesIn(path.join(SHARED_DIR, "Fonts"), /\.(ttf|txt)$/, `${name}/Fonts`);
  const media = filesIn(path.join(dir, "Media"), /\.(tga|blp)$/, `${name}/Media`);
  return [...own, ...shared, ...fonts, ...media].sort((a, b) => a.name.localeCompare(b.name));
}

/** Empreinte SHA-256 du zip (le zip est reproductible : même contenu, même date, même empreinte). */
export function addonSha256(name: AddonName = "ForeverRoster") {
  if (!hasAddon(name)) return "";
  try { return createHash("sha256").update(zip(addonFiles(name))).digest("hex"); } catch { return ""; }
}

export function addonZip(): Plugin {
  let outDir = "dist";
  return {
    name: "forever-addon-zip",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      mkdirSync(path.join(outDir, "downloads"), { recursive: true });
      for (const name of ["ForeverRoster", "Roster"] as const) {
        if (!hasAddon(name)) continue;
        const data = zip(addonFiles(name));
        const sha = createHash("sha256").update(data).digest("hex");
        writeFileSync(path.join(outDir, "downloads", `${name}.zip`), data);
        writeFileSync(path.join(outDir, "downloads", `${name}.zip.sha256`), `${sha}  ${name}.zip\n`);
        // Roster Companion (lot K1) : version et empreinte lues par l'appli pour installer ou mettre à jour l'addon
        writeFileSync(path.join(outDir, "downloads", `${name}.json`), `${JSON.stringify({
          name, file: `${name}.zip`, version: addonVersion(name),
          interface: tocOf(name).match(/^## Interface:\s*(.+)$/m)?.[1]?.trim() ?? "", sha256: sha, size: data.length,
        }, null, 2)}\n`);
      }
    },
  };
}
