// Vecteurs de test de addon/shared/Crypto.lua, calculés par le module crypto de Node :
//   node addon/tests/fixtures/make-crypto-vectors.mjs   (écrit addon/tests/fixtures/crypto_vectors.lua)
// Signatures RSASSA-PKCS1-v1_5 / SHA-256 avec la clé de test du site (site-test-key.pem), signatures volontairement
// fausses (message encodé modifié, signé « à la main » par l'opération RSA brute), et quelques clés de tailles
// différentes générées ici (le fichier change donc à chaque exécution ; il est commité tel quel).
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const siteKey = crypto.createPrivateKey(readFileSync(join(dir, 'site-test-key.pem')));

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
const modulusOf = (key) => Buffer.from(crypto.createPublicKey(key).export({ format: 'jwk' }).n, 'base64url');
const keyIdOf = (key) => sha256(modulusOf(key)).toString('hex').slice(0, 8);
const toBig = (buf) => BigInt('0x' + (buf.toString('hex') || '0'));
const toBuf = (big, len) => Buffer.from(big.toString(16).padStart(len * 2, '0'), 'hex');

// Chaîne Lua : ASCII imprimable tel quel, le reste en \ddd
function lua(buf) {
  let out = '"';
  for (const b of buf) {
    if (b >= 32 && b < 127 && b !== 34 && b !== 92) out += String.fromCharCode(b);
    else out += '\\' + String(b).padStart(3, '0');
  }
  return out + '"';
}

// Octets pseudo-aléatoires reproductibles : SHA-256 d'un compteur
function bytes(len, seed) {
  const parts = [];
  for (let i = 0; parts.length * 32 < len; i++) parts.push(sha256(Buffer.from(`${seed}:${i}`)));
  return Buffer.concat(parts).subarray(0, len);
}

// Message de 30 Ko, refait à l'identique par le test Lua (longMessage)
const LONG_COUNT = 900;
function longMessage() {
  const lines = [];
  for (let i = 1; i <= LONG_COUNT; i++) lines.push(`R;${i};Raid ${(i * 7919) % 1000};heroic;25;;;council`);
  return Buffer.from(lines.join('\n'), 'utf8');
}

// Signature RSA brute : s = em^d mod n (em fait exactement la longueur du module)
function rawSign(key, em) {
  return crypto.privateEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, em);
}
const DIGEST_INFO = Buffer.from('3031300d060960864801650304020105000420', 'hex');
function encode(len, { hash, digestInfo = DIGEST_INFO, head = [0, 1], fill = 0xff, psLen, trailer = Buffer.alloc(0) }) {
  const ps = psLen ?? len - 3 - digestInfo.length - hash.length - trailer.length;
  const em = Buffer.concat([Buffer.from(head), Buffer.alloc(ps, fill), Buffer.from([0]), digestInfo, hash, trailer]);
  if (em.length !== len) throw new Error(`longueur ${em.length} au lieu de ${len}`);
  return em;
}

// --- SHA-256 ---------------------------------------------------------------------------------------------------
const french = Buffer.from('Les Veilleurs d’Ysondre — Écho de la Faille : « présent », côté Horde, ½ raid, 25 joueurs ✓', 'utf8');
const sha = [];
for (const len of [0, 1, 2, 3, 31, 32, 54, 55, 56, 57, 62, 63, 64, 65, 111, 112, 118, 119, 120, 121, 127, 128, 129, 191, 192, 255, 256, 1000]) {
  const msg = bytes(len, `sha-${len}`);
  sha.push({ msg, hex: sha256(msg).toString('hex') });
}
sha.push({ msg: french, hex: sha256(french).toString('hex') });
const all256 = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
sha.push({ msg: all256, hex: sha256(all256).toString('hex') });

// --- Base64 ----------------------------------------------------------------------------------------------------
const b64 = [];
for (const len of [0, 1, 2, 3, 4, 5, 6, 255, 256, 257]) {
  const msg = len === 256 ? all256 : bytes(len, `b64-${len}`);
  b64.push({ msg, text: msg.toString('base64') });
}

// --- RSA -------------------------------------------------------------------------------------------------------
const keys = {};
function addKey(key) {
  const id = keyIdOf(key);
  const jwk = crypto.createPublicKey(key).export({ format: 'jwk' });
  keys[id] = { n: modulusOf(key).toString('hex'), e: Number(toBig(Buffer.from(jwk.e, 'base64url'))) };
  return id;
}
const siteId = addKey(siteKey);
if (siteId !== 'a3de5db8') throw new Error(`identifiant de la clé de test : ${siteId}`);
const siteN = toBig(modulusOf(siteKey));
const LEN = modulusOf(siteKey).length;

const long = longMessage();
const rsa = [];
const sign = (msg, key = siteKey, alg = 'sha256') => crypto.sign(alg, msg, key).toString('base64');
function add(note, key, msg, sig, ok, reason) { rsa.push({ note, key, msg, sig, ok, reason }); }

// Signatures correctes
for (const [note, msg] of [['vide', Buffer.alloc(0)], ['abc', Buffer.from('abc')], ['français', french],
  ['256 octets', all256], ['30 Ko', long]]) {
  add(`signature du site : ${note}`, siteId, msg, sign(msg), true);
}
// Même message encodé à la main : l'opération brute doit redonner la signature de Node (PKCS#1 v1.5 déterministe)
const abc = Buffer.from('abc');
const abcHash = sha256(abc);
const manual = rawSign(siteKey, encode(LEN, { hash: abcHash })).toString('base64');
if (manual !== sign(abc)) throw new Error('encodage manuel différent de crypto.sign');
add('encodage manuel', siteId, abc, manual, true);

// Signatures fausses (message encodé modifié)
const forged = [
  ['bloc de type 2', { hash: abcHash, head: [0, 2] }],
  ['premier octet 01', { hash: abcHash, head: [1, 1] }],
  ['remplissage FE', { hash: abcHash, fill: 0xfe }],
  ['sans DigestInfo', { hash: abcHash, digestInfo: Buffer.alloc(0) }],
  ['DigestInfo sans NULL', { hash: abcHash, digestInfo: Buffer.from('302f300b0609608648016503040201' + '0420', 'hex') }],
  ['remplissage court et octets en fin', { hash: abcHash, psLen: 8, trailer: Buffer.alloc(LEN - 3 - 8 - 19 - 32, 0x41) }],
  ['empreinte d’un autre message', { hash: sha256(Buffer.from('abd')) }],
];
for (const [note, opts] of forged) add(`fausse : ${note}`, siteId, abc, rawSign(siteKey, encode(LEN, opts)).toString('base64'), false, 'bad signature');
// Remplissage court avec un octet FF en moins : rendu en position un octet plus loin
{
  const em = encode(LEN, { hash: abcHash });
  const shifted = Buffer.concat([em.subarray(0, 2), em.subarray(3), Buffer.from([0])]);
  add('fausse : tout décalé d’un octet', siteId, abc, rawSign(siteKey, shifted).toString('base64'), false, 'bad signature');
}
add('fausse : SHA-1', siteId, abc, sign(abc, siteKey, 'sha1'), false, 'bad signature');
add('fausse : SHA-512', siteId, abc, sign(abc, siteKey, 'sha512'), false, 'bad signature');
add('fausse : signature d’un autre message', siteId, abc, sign(Buffer.from('abd')), false, 'bad signature');
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
add('fausse : autre clé', siteId, abc, sign(abc, other), false, 'bad signature');

// Valeurs de s aux limites (256 octets)
for (const [note, s, reason] of [['s = 0', 0n, 'bad signature'], ['s = 1', 1n, 'bad signature'], ['s = n - 1', siteN - 1n, 'bad signature'],
  ['s = n', siteN, 'out of range'], ['s = n + 1', siteN + 1n, 'out of range'], ['s = 2^2048 - 1', (1n << 2048n) - 1n, 'out of range']]) {
  add(`limite : ${note}`, siteId, abc, toBuf(s, LEN).toString('base64'), false, reason);
}
// Longueurs fausses : zéro en tête (même valeur), dernier octet retiré
const good = Buffer.from(sign(abc), 'base64');
add('longueur : zéro en tête', siteId, abc, Buffer.concat([Buffer.from([0]), good]).toString('base64'), false, 'bad length');
add('longueur : un octet de moins', siteId, abc, good.subarray(1).toString('base64'), false, 'bad length');
add('longueur : vide', siteId, abc, '', false, 'bad length');

// Autres tailles de clé (le jeu n'a qu'une clé de 2048 bits, mais rien n'en dépend) : 3072, 2047, 1032 bits, e = 3
for (const [bits, e] of [[3072, 65537], [2047, 65537], [1032, 3]]) {
  const key = crypto.generateKeyPairSync('rsa', { modulusLength: bits, publicExponent: e }).privateKey;
  const id = addKey(key);
  if (toBig(modulusOf(key)).toString(2).length !== bits) throw new Error(`taille de la clé ${id}`);
  add(`clé de ${bits} bits (e = ${e}) : abc`, id, abc, sign(abc, key), true);
  add(`clé de ${bits} bits (e = ${e}) : 30 Ko`, id, long, sign(long, key), true);
  add(`clé de ${bits} bits (e = ${e}) : autre message`, id, abc, sign(french, key), false, 'bad signature');
  // Même longueur (2047 bits) : refusée, hors limites ou fausse selon la valeur ; sinon, longueur fausse
  const sameLength = modulusOf(key).length === LEN;
  add(`clé de ${bits} bits (e = ${e}) : signature de la clé du site`, id, abc, sign(abc), false, sameLength ? undefined : 'bad length');
}

// --- Fichier Lua -----------------------------------------------------------------------------------------------
const L = [];
L.push('-- Écrit par addon/tests/fixtures/make-crypto-vectors.mjs (node) : ne pas modifier à la main.');
L.push('return {');
L.push('  sha = {');
for (const v of sha) L.push(`    { msg = ${lua(v.msg)}, hex = "${v.hex}" },`);
L.push('  },');
L.push('  b64 = {');
for (const v of b64) L.push(`    { msg = ${lua(v.msg)}, text = "${v.text}" },`);
L.push('  },');
L.push(`  long = { count = ${LONG_COUNT}, len = ${long.length}, hex = "${sha256(long).toString('hex')}" },`);
L.push('  keys = {');
for (const [id, k] of Object.entries(keys)) L.push(`    ["${id}"] = { n = "${k.n}", e = ${k.e} },`);
L.push('  },');
L.push('  rsa = {');
for (const v of rsa) {
  const msg = v.msg === long ? 'long = true' : `msg = ${lua(v.msg)}`;
  const reason = v.reason ? `, reason = "${v.reason}"` : '';
  L.push(`    { note = ${lua(Buffer.from(v.note, 'utf8'))}, key = "${v.key}", ${msg}, sig = "${v.sig}", ok = ${v.ok}${reason} },`);
}
L.push('  },');
L.push('}');
writeFileSync(join(dir, 'crypto_vectors.lua'), L.join('\n') + '\n');
console.log(`crypto_vectors.lua : ${sha.length} SHA-256, ${b64.length} base64, ${rsa.length} RSA, message long de ${long.length} octets`);
