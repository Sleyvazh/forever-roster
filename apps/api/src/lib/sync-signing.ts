import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import type { GroupBlockSigner } from "@forever/game-data";

/**
 * Signature des données des groupes (blocs RRG et FRG) : partage entre joueurs, docs/addon-format.md, section
 * « Partage entre joueurs (signature du site) ». Le serveur signe la forme canonique de chaque bloc avec sa clé privée
 * (SYNC_SIGNING_KEY : le fichier PEM encodé en base64) ; chaque addon vérifie avec la clé publique compilée dans
 * l'addon (addon/shared/SiteKey.lua, écrit par scripts/site-key.mjs). Sans clé, les blocs partent sans ligne Z
 * et l'addon ne les partage pas.
 */

export interface SyncSigner {
  /** 8 premiers caractères hexadécimaux du SHA-256 du module RSA (octets big-endian, sans zéro de tête). */
  keyId: string;
  /** Clé publique (PEM SPKI), servie par GET /api/sync/key. */
  publicKey: string;
  /** RSASSA-PKCS1-v1_5, SHA-256, sur les octets UTF-8 de la forme canonique ; signature en base64. */
  sign: GroupBlockSigner;
}

const MODULUS_BITS = 2048;
const HOWTO = "voir docs/operations.md, « Clé de signature du partage entre joueurs »";

/** Identifiant d'une clé RSA (publique ou privée) : SHA-256 du module, 8 premiers caractères hexadécimaux. */
export function keyIdOf(key: KeyObject): string {
  const n = Buffer.from(createPublicKey(key).export({ format: "jwk" }).n ?? "", "base64url");
  let i = 0;
  while (i < n.length - 1 && n[i] === 0) i++;
  return createHash("sha256").update(n.subarray(i)).digest("hex").slice(0, 8);
}

/**
 * Lit SYNC_SIGNING_KEY (PEM de la clé privée, encodé en base64 sur une ligne) ; erreur claire sinon
 * (vérifié au démarrage, par loadConfig).
 */
export function parseSigningKey(value: string): SyncSigner {
  const raw = value.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new Error(`le fichier PEM de la clé privée, encodé en base64 sur une ligne, est attendu (base64 -w0 sync-signing.pem) ; ${HOWTO}`);
  const pem = Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) throw new Error(`ce n'est pas un fichier PEM encodé en base64 (base64 -w0 sync-signing.pem) ; ${HOWTO}`);
  if (/-----BEGIN (RSA )?PUBLIC KEY-----/.test(pem)) throw new Error("c'est la clé publique : il faut la clé privée (sync-signing.pem), qui ne quitte jamais le serveur");
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch (err) {
    const why = /passphrase/i.test(String(err)) ? "clé protégée par une phrase de passe (à créer sans, avec openssl genpkey)" : "clé privée illisible";
    throw new Error(`${why} ; ${HOWTO}`);
  }
  if (key.asymmetricKeyType !== "rsa") throw new Error(`clé RSA attendue (reçu : ${key.asymmetricKeyType ?? "?"}) ; ${HOWTO}`);
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (bits !== MODULUS_BITS) throw new Error(`clé RSA de ${MODULUS_BITS} bits attendue (reçu : ${bits ?? "?"} bits) ; ${HOWTO}`);
  const keyId = keyIdOf(key);
  return {
    keyId,
    publicKey: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
    sign: canonical => ({ keyId, signature: sign("sha256", Buffer.from(canonical, "utf8"), key).toString("base64") }),
  };
}

const cache = new Map<string, SyncSigner>();

/** Signataire du serveur d'après la configuration (null sans clé : blocs non signés, jamais partagés). */
export function syncSigner(cfg: { SYNC_SIGNING_KEY: string }): SyncSigner | null {
  const value = cfg.SYNC_SIGNING_KEY;
  if (!value) return null;
  let s = cache.get(value);
  if (!s) {
    s = parseSigningKey(value);
    cache.set(value, s);
  }
  return s;
}
