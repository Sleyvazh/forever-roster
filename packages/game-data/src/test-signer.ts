import type { GroupBlockSigner } from "./share";

/**
 * Tests seulement (jamais importé par le site ni exporté par le paquet) : signataire avec la clé de TEST du site,
 * addon/tests/fixtures/site-test-key.pem (keyId a3de5db8), comme le fait l'API avec SYNC_SIGNING_KEY. Les signatures
 * RSASSA-PKCS1-v1_5 sont déterministes : les exemples écrits pour les tests Lua (sample.rrg, sample.frg) ne changent
 * qu'avec leur contenu.
 */

// Modules de Node sans leurs types (le paquet n'en dépend pas) : import dynamique, types minimaux
interface NodeCrypto {
  createPrivateKey(pem: string): object;
  createPublicKey(key: object): { export(o: { format: "jwk" }): { n: string } };
  createHash(alg: "sha256"): { update(data: string, enc: "base64url"): { digest(enc: "hex"): string } };
  createSign(alg: "sha256"): { update(data: string, enc: "utf8"): { sign(key: object, enc: "base64"): string } };
}
interface NodeFs { readFileSync(p: URL, e: "utf8"): string }
const load = <T>(name: string) => import(/* @vite-ignore */ ["node", name].join(":")) as Promise<T>;

export const TEST_KEY_ID = "a3de5db8";
export const fixture = (name: string) => new URL(`../../../addon/tests/fixtures/${name}`, import.meta.url);

/** Signataire de test, et la clé publique (PEM) pour vérifier. */
export async function testSigner(): Promise<{ sign: GroupBlockSigner; keyId: string; publicPem: string }> {
  const crypto = await load<NodeCrypto>("crypto");
  const fs = await load<NodeFs>("fs");
  const key = crypto.createPrivateKey(fs.readFileSync(fixture("site-test-key.pem"), "utf8"));
  // keyId : 8 premiers caractères hexadécimaux du SHA-256 du module (octets big-endian, sans zéro de tête)
  const keyId = crypto.createHash("sha256").update(crypto.createPublicKey(key).export({ format: "jwk" }).n, "base64url").digest("hex").slice(0, 8);
  const sign: GroupBlockSigner = canonical => ({ keyId, signature: crypto.createSign("sha256").update(canonical, "utf8").sign(key, "base64") });
  return { sign, keyId, publicPem: fs.readFileSync(fixture("site-test-key.pub.pem"), "utf8") };
}

/** Vérifie une signature avec la clé publique de test (Node : RSASSA-PKCS1-v1_5, SHA-256). */
export async function verifyWithTestKey(canonical: string, signature: string): Promise<boolean> {
  const crypto = await load<{ createVerify(alg: "sha256"): { update(d: string, e: "utf8"): { verify(k: string, s: string, e: "base64"): boolean } } }>("crypto");
  const { publicPem } = await testSigner();
  return crypto.createVerify("sha256").update(canonical, "utf8").verify(publicPem, signature, "base64");
}
