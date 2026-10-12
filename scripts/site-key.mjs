#!/usr/bin/env node
/**
 * Clé publique du site → addon/shared/SiteKey.lua (partage entre joueurs : l'addon vérifie avec elle la signature des
 * données des groupes ; docs/operations.md, « Clé de signature du partage entre joueurs »).
 *
 *   node scripts/site-key.mjs sync-signing.pub.pem            affiche le fichier SiteKey.lua
 *   node scripts/site-key.mjs sync-signing.pub.pem --write    l'écrit dans addon/shared/SiteKey.lua
 *   node scripts/site-key.mjs nouvelle.pub.pem ancienne.pub.pem --write
 *       changement de clé : plusieurs clés acceptées, l'ancienne vérifie encore les données déjà partagées
 *
 * Seulement une clé PUBLIQUE, RSA 2048 (openssl pkey -in sync-signing.pem -pubout) : une clé privée est refusée,
 * elle ne quitte jamais le serveur. keyId : 8 premiers caractères hexadécimaux du SHA-256 du module (octets
 * big-endian, sans zéro de tête), comme l'API (apps/api/src/lib/sync-signing.ts).
 */
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "addon/shared/SiteKey.lua");
const MODULUS_BITS = 2048;

function fail(msg) {
  console.error(`site-key : ${msg}`);
  process.exit(1);
}

/** keyId, module (hexadécimal minuscule) et exposant d'une clé publique RSA au format PEM. */
export function siteKey(pem) {
  if (/PRIVATE KEY-----/.test(pem)) throw new Error("c'est une clé privée : donne la clé publique (openssl pkey -in sync-signing.pem -pubout -out sync-signing.pub.pem)");
  let key;
  try { key = createPublicKey(pem); } catch { throw new Error("clé publique illisible (fichier PEM « BEGIN PUBLIC KEY » attendu)"); }
  if (key.asymmetricKeyType !== "rsa") throw new Error(`clé RSA attendue (reçu : ${key.asymmetricKeyType})`);
  if (key.asymmetricKeyDetails?.modulusLength !== MODULUS_BITS) throw new Error(`clé RSA de ${MODULUS_BITS} bits attendue (reçu : ${key.asymmetricKeyDetails?.modulusLength} bits)`);
  const jwk = key.export({ format: "jwk" });
  let n = Buffer.from(jwk.n, "base64url");
  while (n.length > 1 && n[0] === 0) n = n.subarray(1);
  const e = Number(BigInt(`0x${Buffer.from(jwk.e, "base64url").toString("hex")}`));
  return { keyId: createHash("sha256").update(n).digest("hex").slice(0, 8), n: n.toString("hex"), e };
}

/** Contenu de addon/shared/SiteKey.lua pour ces clés. */
export function siteKeyLua(keys) {
  return [
    "-- Clés publiques du site : vérifient la signature des données des groupes partagées entre joueurs (Share.lua).",
    "-- La clé secrète reste sur le serveur (SYNC_SIGNING_KEY) ; ce fichier s'écrit avec scripts/site-key.mjs.",
    "local _, ns = ...",
    "ns.SITE_KEYS = ns.SITE_KEYS or {}",
    ...keys.map(k => `ns.SITE_KEYS["${k.keyId}"] = { n = "${k.n}", e = ${k.e} }`),
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const files = args.filter(a => a !== "--write");
  if (!files.length || files.some(f => f.startsWith("-"))) fail("usage : node scripts/site-key.mjs <clé publique.pem> [<autre clé publique.pem>…] [--write]");
  const keys = [];
  for (const f of files) {
    let pem;
    try { pem = readFileSync(f, "utf8"); } catch { fail(`fichier introuvable : ${f}`); }
    try { keys.push(siteKey(pem)); } catch (err) { fail(`${f} : ${err.message}`); }
  }
  if (new Set(keys.map(k => k.keyId)).size !== keys.length) fail("la même clé est donnée deux fois");
  const lua = siteKeyLua(keys);
  if (write) {
    writeFileSync(OUT, lua);
    console.error(`site-key : ${path.relative(ROOT, OUT)} écrit (${keys.map(k => k.keyId).join(", ")})`);
  } else {
    process.stdout.write(lua);
  }
}
