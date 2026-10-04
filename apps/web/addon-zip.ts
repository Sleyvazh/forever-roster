/**
 * Paquet de l'addon servi par le site : à la construction, addon/ForeverRoster est compressé en
 * dist/downloads/ForeverRoster.zip (format ZIP « deflate », sans dépendance). La version vient du .toc.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import type { Plugin } from "vite";

const ADDON_DIR = fileURLToPath(new URL("../../addon/ForeverRoster", import.meta.url));

export function addonVersion() {
  try { return readFileSync(path.join(ADDON_DIR, "ForeverRoster.toc"), "utf8").match(/^## Version:\s*(\S+)/m)?.[1] ?? "?"; } catch { return "?"; }
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

function addonFiles() {
  const top = readdirSync(ADDON_DIR).filter(f => /\.(lua|toc|xml)$/.test(f)).sort()
    .map(f => ({ name: `ForeverRoster/${f}`, data: readFileSync(path.join(ADDON_DIR, f)) }));
  // Police des titres (habillage « site ») et sa licence (SIL OFL, à distribuer avec la police)
  const fontsDir = path.join(ADDON_DIR, "Fonts");
  let fonts: { name: string; data: Buffer }[] = [];
  try {
    fonts = readdirSync(fontsDir).filter(f => /\.(ttf|txt)$/.test(f)).sort()
      .map(f => ({ name: `ForeverRoster/Fonts/${f}`, data: readFileSync(path.join(fontsDir, f)) }));
  } catch { /* pas de polices */ }
  return [...top, ...fonts];
}

/** Empreinte SHA-256 du zip (le zip est reproductible : même contenu, même date, même empreinte). */
export function addonSha256() {
  try { return createHash("sha256").update(zip(addonFiles())).digest("hex"); } catch { return ""; }
}

export function addonZip(): Plugin {
  let outDir = "dist";
  return {
    name: "forever-addon-zip",
    apply: "build",
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const data = zip(addonFiles());
      mkdirSync(path.join(outDir, "downloads"), { recursive: true });
      writeFileSync(path.join(outDir, "downloads", "ForeverRoster.zip"), data);
      writeFileSync(path.join(outDir, "downloads", "ForeverRoster.zip.sha256"), `${createHash("sha256").update(data).digest("hex")}  ForeverRoster.zip\n`);
    },
  };
}
