/**
 * Sceau des textes de l'addon ForeverRoster (1.6.5, 8/11 : un relevé de guilde retouché à la main avait mis un perso 60).
 * L'addon termine chaque bloc envoyé au site (persos FRC, relevé de guilde FRL, bilan FRB) par `END;<lignes>;<sceau>` :
 * les 16 premiers caractères hexadécimaux du HMAC-SHA256 du bloc, calculé avec SEAL_KEY. Le site refuse un bloc sans sceau
 * (addon trop ancien) ou dont le sceau ne correspond plus (texte retouché, ou abîmé par le copier-coller).
 *
 * Ce n'est pas un secret : la clé est dans le code de l'addon, chez chaque joueur. Le sceau arrête une retouche à la main du
 * texte, pas quelqu'un qui lit le code de l'addon (aucun système ne le peut quand le PC du joueur produit les données) :
 * c'est pour cela que le niveau d'un membre suit aussi le relevé le plus récent (guild-import.ts).
 *
 * Forme scellée : les lignes du bloc, de l'en-tête à END, sans les blancs ASCII de début et de fin (espace, tabulation,
 * retours), sans les lignes vides, jointes par « \n », la ligne END réduite à `END;<lignes>`. Même calcul dans l'addon
 * (F.Seal, addon/ForeverRoster/Format.lua), vérifié par les mêmes vecteurs (seal.test.ts, addon/tests/format_test.lua).
 */
export const SEAL_KEY = "fFHqJKgJJdSOroSdClByPgU72Id7t0mP";
/** Blocs scellés par l'addon. */
export const SEALED_BLOCKS = ["FRC", "FRL", "FRB"] as const;
export type SealState = "ok" | "missing" | "bad";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 (FIPS 180-4), synchrone : le site le calcule aussi dans le navigateur (aperçu du Ctrl+V). */
export function sha256(data: Uint8Array): Uint8Array {
  const size = (((data.length + 9) + 63) >> 6) << 6;
  const buf = new Uint8Array(size);
  buf.set(data);
  buf[data.length] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = data.length * 8;
  dv.setUint32(size - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(size - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < size; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15]!, y = W[t - 2]!;
      W[t] = W[t - 16]! + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + W[t - 7]! + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10));
    }
    let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + W[t]!) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0]! += a; H[1]! += b; H[2]! += c; H[3]! += d; H[4]! += e; H[5]! += f; H[6]! += g; H[7]! += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]!);
  return out;
}

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 (RFC 2104) d'un texte UTF-8, en hexadécimal. */
export function hmacSha256Hex(key: string, message: string): string {
  let k: Uint8Array = encoder.encode(key);
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = (k[i] ?? 0) ^ 0x36; opad[i] = (k[i] ?? 0) ^ 0x5c; }
  const msg = encoder.encode(message);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad); inner.set(msg, 64);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad); outer.set(sha256(inner), 64);
  return hex(sha256(outer));
}

/** Blancs ASCII seulement (comme %s dans le Lua du jeu), pas l'espace insécable. */
const asciiTrim = (s: string) => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, "");

/** Sceau d'un bloc : lignes de l'en-tête à la ligne END comprise (un éventuel sceau sur END est ignoré). */
export function sealOf(lines: readonly string[]): string {
  const kept = lines.map(asciiTrim).filter(Boolean);
  const end = (kept.at(-1) ?? "").split(";");
  kept[kept.length - 1] = `${end[0]};${end[1] ?? ""}`;
  return hmacSha256Hex(SEAL_KEY, kept.join("\n")).slice(0, 16);
}

/** Sceau d'un bloc reçu : « ok », « missing » (pas de sceau : addon 1.6.4 ou plus ancien) ou « bad » (texte retouché). */
export function sealState(lines: readonly string[]): SealState {
  const kept = lines.map(asciiTrim).filter(Boolean);
  const end = (kept.at(-1) ?? "").split(";");
  if (end[0] !== "END") return "bad";
  const seal = (end[2] ?? "").trim();
  if (!seal) return "missing";
  return end.length === 3 && seal === sealOf(kept) ? "ok" : "bad";
}

/** Raison du refus d'un bloc, pour les messages des parseurs (sans majuscule : ils la précèdent d'un préfixe). */
export function sealError(state: Exclude<SealState, "ok">): string {
  return state === "missing"
    ? "texte d'un addon ForeverRoster trop ancien (1.6.4 ou avant) : mets l'addon à jour (page Addon du site), puis renvoie-le"
    : "texte modifié depuis l'addon (retouché à la main, ou abîmé par le copier-coller) : recopie-le tel quel depuis le jeu";
}

/**
 * Scelle les blocs FRC, FRL et FRB d'un texte comme l'addon (tests du site, captures) : la ligne END de chaque bloc reçoit
 * son sceau ; le reste du texte ne change pas.
 */
export function sealText(text: string): string {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = asciiTrim(lines[i]!);
    if ((SEALED_BLOCKS as readonly string[]).some(b => t.startsWith(`${b};`))) start = i;
    else if (start >= 0 && t.startsWith("END;")) {
      const end = t.split(";");
      const seal = sealOf(lines.slice(start, i + 1));
      lines[i] = `${end[0]};${end[1] ?? ""};${seal}`;
      start = -1;
    } else if (/^(FR|RR)[A-Z];/.test(t)) start = -1;
  }
  return lines.join("\n");
}
