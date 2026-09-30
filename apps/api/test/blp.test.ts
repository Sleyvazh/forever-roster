import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { blpToJpeg, decodeBlp } from "../src/gamedata/blp";

const here = path.dirname(fileURLToPath(import.meta.url));

/** En-tête BLP2 de 148 octets + palette (1024) + données du premier niveau. */
function blp(compression: number, alphaDepth: number, alphaType: number, w: number, h: number, data: Buffer) {
  const head = Buffer.alloc(148 + 1024);
  head.write("BLP2", 0, "latin1"); head.writeUInt32LE(1, 4);
  head.writeUInt8(compression, 8); head.writeUInt8(alphaDepth, 9); head.writeUInt8(alphaType, 10);
  head.writeUInt32LE(w, 12); head.writeUInt32LE(h, 16);
  head.writeUInt32LE(head.length, 20); head.writeUInt32LE(data.length, 84);
  return Buffer.concat([head, data]);
}
const px = (img: { width: number; data: Buffer }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("textures BLP du jeu", () => {
  it("lit une image à palette (fichier écrit par Pillow)", () => {
    const img = decodeBlp(readFileSync(path.join(here, "fixtures/icon-palette.blp")));
    expect([img.width, img.height]).toEqual([8, 8]);
    expect(px(img, 0, 0)).toEqual([10, 120, 250, 255]);
    expect(px(img, 7, 7)).toEqual([200, 30, 40, 255]);
  });

  it("lit un bloc DXT1 (4 couleurs interpolées)", () => {
    // c0 = rouge pur, c1 = bleu pur ; indices : ligne 0 → 0, ligne 1 → 1, ligne 2 → 2, ligne 3 → 3
    const block = Buffer.alloc(8);
    block.writeUInt16LE(0xf800, 0); block.writeUInt16LE(0x001f, 2);
    block[4] = 0x00; block[5] = 0x55; block[6] = 0xaa; block[7] = 0xff;
    const img = decodeBlp(blp(2, 0, 0, 4, 4, block));
    expect(px(img, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(img, 3, 1)).toEqual([0, 0, 255, 255]);
    expect(px(img, 0, 2)).toEqual([170, 0, 85, 255]);
    expect(px(img, 0, 3)).toEqual([85, 0, 170, 255]);
  });

  it("lit l'alpha DXT5 et refuse ce qui n'est pas un BLP2", () => {
    const block = Buffer.alloc(16);
    block[0] = 255; block[1] = 0; // a0 opaque, a1 transparent ; tous les indices à 0 sauf le premier pixel à 1
    block[2] = 1;
    block.writeUInt16LE(0xffff, 8); block.writeUInt16LE(0x0000, 10);
    const img = decodeBlp(blp(2, 8, 7, 4, 4, block));
    expect(px(img, 0, 0)).toEqual([255, 255, 255, 0]);
    expect(px(img, 1, 0)).toEqual([255, 255, 255, 255]);
    expect(() => decodeBlp(Buffer.from("<html>pas une image</html>"))).toThrow("pas un fichier BLP2");
  });

  it("convertit en JPEG 56×56", async () => {
    const jpg = await blpToJpeg(readFileSync(path.join(here, "fixtures/icon-palette.blp")));
    expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(await sharp(jpg).metadata()).toMatchObject({ width: 56, height: 56, format: "jpeg" });
  });
});
