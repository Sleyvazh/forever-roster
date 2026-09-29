import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { Db } from "../db/client";
import { images } from "../db/schema";
import { badRequest } from "./http";

export const IMAGE_SIZE = 200;
/** Taille maximale reçue : le navigateur recadre déjà l'image, 2 Mo laisse une large marge. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Vérifie la signature du fichier (« magic bytes ») : le Content-Type annoncé ne suffit pas. */
export function sniffImage(buf: Buffer): "png" | "jpeg" | "webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

/**
 * Ré-encode toute image reçue : décodage complet, recadrage 200×200, sortie WebP.
 * - le fichier stocké est toujours une image produite par nous (pas de fichier polyglotte ni de script caché) ;
 * - les métadonnées (EXIF, position GPS d'une photo de téléphone…) sont supprimées ;
 * - limitInputPixels bloque les « bombes de décompression » (petit fichier, image géante).
 */
export async function normalizeImage(buf: Buffer): Promise<Buffer> {
  if (!sniffImage(buf)) throw badRequest("Format d'image non pris en charge : PNG, JPEG ou WebP.");
  try {
    return await sharp(buf, { limitInputPixels: 4096 * 4096, failOn: "error", animated: false })
      .rotate()
      .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    throw badRequest("Image illisible ou trop grande (4096 × 4096 pixels maximum).");
  }
}

/** Enregistre une nouvelle image et supprime l'ancienne : l'identifiant change à chaque envoi (cache navigateur sûr). */
export async function replaceImage(db: Db, ownerId: string, data: Buffer, previousId: string | null, attach: (id: string) => Promise<unknown>) {
  const [row] = await db.insert(images).values({ ownerId, data, bytes: data.length }).returning({ id: images.id });
  await attach(row!.id);
  if (previousId) await db.delete(images).where(eq(images.id, previousId));
  return row!.id;
}

export async function deleteImage(db: Db, id: string | null) {
  if (id) await db.delete(images).where(eq(images.id, id));
}
