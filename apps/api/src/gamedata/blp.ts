/**
 * Lecture des textures BLP2 de Blizzard (icônes du jeu) en pixels RGBA.
 * Formats pris en charge : palette (compression 1), DXT1/DXT3/DXT5 (compression 2) et BGRA brut (compression 3).
 * Seul le premier niveau de mipmap est lu : c'est l'image en pleine taille.
 */
import sharp from "sharp";

export interface Rgba { width: number; height: number; data: Buffer }

export function decodeBlp(buf: Buffer, maxSize = 1024): Rgba {
  if (buf.length < 148 || buf.toString("latin1", 0, 4) !== "BLP2") throw new Error("pas un fichier BLP2");
  const compression = buf.readUInt8(8), alphaDepth = buf.readUInt8(9), alphaType = buf.readUInt8(10);
  const width = buf.readUInt32LE(12), height = buf.readUInt32LE(16);
  if (!width || !height || width > maxSize || height > maxSize) throw new Error(`taille invalide ${width}×${height}`);
  const offset = buf.readUInt32LE(20), size = buf.readUInt32LE(84);
  if (!offset || offset + size > buf.length) throw new Error("données tronquées");
  const src = buf.subarray(offset, offset + size);
  const out = Buffer.alloc(width * height * 4);

  if (compression === 1) {
    const palette = buf.subarray(148, 148 + 1024);
    const n = width * height;
    if (src.length < n) throw new Error("données tronquées");
    for (let i = 0; i < n; i++) {
      const p = src[i]! * 4;
      out[i * 4] = palette[p + 2]!; out[i * 4 + 1] = palette[p + 1]!; out[i * 4 + 2] = palette[p]!;
      out[i * 4 + 3] = paletteAlpha(src, n, i, alphaDepth);
    }
  } else if (compression === 2) {
    const blockSize = alphaType === 0 ? 8 : 16;
    const bw = Math.max(1, Math.ceil(width / 4)), bh = Math.max(1, Math.ceil(height / 4));
    if (src.length < bw * bh * blockSize) throw new Error("données tronquées");
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      const b = src.subarray((by * bw + bx) * blockSize);
      const px = alphaType === 0 ? dxtColor(b, 0, alphaDepth > 0) : dxtColor(b, 8, false);
      if (alphaType === 1) dxt3Alpha(b, px);
      else if (alphaType === 7) dxt5Alpha(b, px);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const X = bx * 4 + x, Y = by * 4 + y;
        if (X >= width || Y >= height) continue;
        px.copy(out, (Y * width + X) * 4, (y * 4 + x) * 4, (y * 4 + x) * 4 + 4);
      }
    }
  } else if (compression === 3) {
    if (src.length < width * height * 4) throw new Error("données tronquées");
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = src[i * 4 + 2]!; out[i * 4 + 1] = src[i * 4 + 1]!; out[i * 4 + 2] = src[i * 4]!; out[i * 4 + 3] = src[i * 4 + 3]!;
    }
  } else throw new Error(`compression BLP ${compression} non prise en charge`);
  return { width, height, data: out };
}

function paletteAlpha(src: Buffer, n: number, i: number, depth: number) {
  if (depth === 8) return src[n + i] ?? 255;
  if (depth === 4) { const b = src[n + (i >> 1)] ?? 255; return ((i & 1 ? b >> 4 : b & 15) * 17); }
  if (depth === 1) return ((src[n + (i >> 3)] ?? 255) >> (i & 7)) & 1 ? 255 : 0;
  return 255;
}

const rgb565 = (c: number): [number, number, number] => {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
};

/** Bloc couleur DXT (4×4) → 64 octets RGBA. `punchThrough` : DXT1 avec alpha 1 bit. */
function dxtColor(b: Buffer, at: number, punchThrough: boolean) {
  const c0 = b.readUInt16LE(at), c1 = b.readUInt16LE(at + 2), bits = b.readUInt32LE(at + 4);
  const p0 = rgb565(c0), p1 = rgb565(c1);
  const four = c0 > c1 || at === 8; // DXT3/5 : toujours 4 couleurs
  const pal: [number, number, number, number][] = [[...p0, 255], [...p1, 255],
    four ? [0, 1, 2].map(k => Math.round((2 * p0[k]! + p1[k]!) / 3)).concat(255) as [number, number, number, number]
      : [0, 1, 2].map(k => Math.round((p0[k]! + p1[k]!) / 2)).concat(255) as [number, number, number, number],
    four ? [0, 1, 2].map(k => Math.round((p0[k]! + 2 * p1[k]!) / 3)).concat(255) as [number, number, number, number]
      : [0, 0, 0, punchThrough ? 0 : 255]];
  const px = Buffer.alloc(64);
  for (let i = 0; i < 16; i++) { const c = pal[(bits >>> (2 * i)) & 3]!; px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = c[3]; }
  return px;
}

function dxt3Alpha(b: Buffer, px: Buffer) {
  for (let i = 0; i < 16; i++) { const v = (b[i >> 1]! >> ((i & 1) * 4)) & 15; px[i * 4 + 3] = v * 17; }
}

function dxt5Alpha(b: Buffer, px: Buffer) {
  const a0 = b[0]!, a1 = b[1]!;
  const a = [a0, a1];
  if (a0 > a1) for (let k = 1; k < 7; k++) a.push(Math.round(((7 - k) * a0 + k * a1) / 7));
  else { for (let k = 1; k < 5; k++) a.push(Math.round(((5 - k) * a0 + k * a1) / 5)); a.push(0, 255); }
  let bits = 0n;
  for (let k = 0; k < 6; k++) bits |= BigInt(b[2 + k]!) << BigInt(8 * k);
  for (let i = 0; i < 16; i++) px[i * 4 + 3] = a[Number((bits >> BigInt(3 * i)) & 7n)]!;
}

/** Fichier BLP du jeu par son identifiant, depuis wago.tools (branches essayées dans l'ordre), ou null. */
export async function fetchBlp(fid: number, branches: string[]) {
  for (const branch of branches) {
    const res = await fetch(`https://wago.tools/api/casc/${fid}?download&branch=${encodeURIComponent(branch)}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.toString("latin1", 0, 4) === "BLP2") return buf;
  }
  return null;
}

/** BLP → JPEG 56×56 sur fond noir (même format que les icônes du serveur d'images de Blizzard). */
export async function blpToJpeg(blp: Buffer) {
  const img = decodeBlp(blp);
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(56, 56, { fit: "fill" }).flatten({ background: "#000000" }).jpeg({ quality: 90 }).toBuffer();
}
