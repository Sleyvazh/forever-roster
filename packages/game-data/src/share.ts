/**
 * Partage entre joueurs des données des groupes (blocs RRG et FRG), signées par le site : docs/addon-format.md,
 * section « Partage entre joueurs (signature du site) ».
 *
 * Chaque bloc se termine par deux lignes, après toutes les autres et juste avant END, hors du compte de END
 * (un ancien addon les ignore) :
 *   M;<persos du groupe, séparés par des virgules>   (toujours là : l'addon qui reçoit garde les groupes dont il est membre)
 *   Z;<keyId>;<signature base64>                      (seulement si le serveur a une clé : SYNC_SIGNING_KEY)
 *
 * La signature (RSASSA-PKCS1-v1_5, SHA-256) porte sur la forme canonique du bloc (canonicalGroupBlock) : les champs
 * personnels (mon statut, mon perso) y sont vidés, pour que le bloc d'un joueur vaille pour tous les membres.
 * Ce fichier ne fait aucun calcul cryptographique (il sert aussi au navigateur) : la signature vient d'un signataire
 * fourni par l'API (apps/api/src/lib/sync-signing.ts).
 */

export type GroupBlockKind = "RRG" | "FRG";

/** Signature d'un bloc : identifiant de la clé (8 caractères hexadécimaux) et signature en base64. */
export interface GroupBlockSignature { keyId: string; signature: string }
/** Signataire fourni par l'API : reçoit la forme canonique, rend la signature (null : pas de signature). */
export type GroupBlockSigner = (canonical: string) => GroupBlockSignature | null | undefined;

/**
 * Champs personnels des lignes R, vidés dans la forme canonique (numérotés à partir de 1, le champ 1 étant « R ») :
 * RRG `R;<raid>;<date>;<nom>;<difficulté>;<effectif>;<mon statut>;<mon perso>;<butin>` → 7 et 8 ;
 * FRG `R;<raid>;<date>;<nom>;<mon statut>;<mon perso>;<butin>` → 5 et 6.
 */
export const PERSONAL_FIELDS: Record<GroupBlockKind, readonly number[]> = { RRG: [7, 8], FRG: [5, 6] };

const KEY_ID = /^[0-9a-f]{8}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Ligne nettoyée comme pour la signature : sans « \r », espaces et tabulations retirés au début et à la fin. */
const tidy = (line: string) => line.replace(/\r/g, "").replace(/^[ \t]+|[ \t]+$/g, "");
/** Type d'une ligne : son premier champ. */
const typeOf = (line: string) => line.split(";", 1)[0] ?? "";

/**
 * Blocs RRG ou FRG d'un texte (« Copier pour le jeu » en donne un par groupe, à la suite) : chacun de son en-tête
 * à sa ligne END comprise, lignes nettoyées (sans « \r », ni espaces au bord, ni lignes vides). Un bloc sans END
 * (texte coupé) va jusqu'au bloc suivant (ou à l'en-tête d'un autre format) ou à la fin du texte. Les lignes hors
 * d'un bloc sont ignorées.
 */
export function splitGroupBlocks(text: string, kind: GroupBlockKind): string[] {
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const raw of text.split("\n")) {
    const line = tidy(raw);
    if (!line) continue;
    const type = typeOf(line);
    if (type === kind) { cur = [line]; blocks.push(cur); continue; }
    // En-tête d'un autre format (FRR, RRR…) : fin du bloc en cours
    if (/^(FR|RR)[A-Z]$/.test(type)) { cur = null; continue; }
    if (!cur) continue;
    cur.push(line);
    if (type === "END") cur = null;
  }
  return blocks.map(b => b.join("\n"));
}

/**
 * Forme canonique d'un bloc (le premier du texte) : ce que le site signe et ce que l'addon vérifie. Lignes de l'en-tête
 * jusqu'à la dernière avant END, sans la ligne Z ni END ; chaque ligne sans « \r », espaces et tabulations retirés au
 * bord (lignes vides omises) ; dans les lignes R, champs personnels vidés en gardant les séparateurs (`a;b;;;c`) ;
 * lignes jointes par « \n », sans « \n » final. Un bloc dont les champs personnels sont déjà vides est sa propre forme
 * canonique. Texte sans bloc de ce type : "".
 */
export function canonicalGroupBlock(text: string, kind: GroupBlockKind): string {
  const block = splitGroupBlocks(text, kind)[0];
  if (!block) return "";
  const personal = PERSONAL_FIELDS[kind];
  const out: string[] = [];
  for (const line of block.split("\n")) {
    const type = typeOf(line);
    if (type === "END") break;
    if (type === "Z") continue;
    if (type !== "R") { out.push(line); continue; }
    // Seuls les champs présents sont vidés : le site écrit toujours tous les champs des lignes R
    const f = line.split(";");
    for (const i of personal) if (i <= f.length) f[i - 1] = "";
    out.push(f.join(";"));
  }
  return out.join("\n");
}

/** Signature portée par un bloc (ligne Z), ou null s'il n'est pas signé (ou si la ligne Z est illisible). */
export function groupBlockSignature(block: string): GroupBlockSignature | null {
  for (const raw of block.split("\n")) {
    const line = tidy(raw);
    if (typeOf(line) !== "Z") continue;
    const [, keyId = "", signature = ""] = line.split(";");
    return KEY_ID.test(keyId) && BASE64.test(signature) ? { keyId, signature } : null;
  }
  return null;
}

/**
 * Fin d'un bloc, commune à RRG et FRG : `lines` (en-tête et toutes les lignes, ligne M comprise), puis la ligne Z si
 * un signataire est donné (et signe), puis `END;<count>`.
 */
export function sealGroupBlock(kind: GroupBlockKind, lines: string[], count: number, sign?: GroupBlockSigner): string {
  const out = [...lines];
  const s = sign?.(canonicalGroupBlock(lines.join("\n"), kind));
  if (s) {
    // Jamais de « ; », de « | » ni de retour à la ligne dans la ligne Z : le signataire est vérifié
    if (!KEY_ID.test(s.keyId) || !BASE64.test(s.signature)) throw new Error("Signature de bloc invalide (keyId ou base64).");
    out.push(`Z;${s.keyId};${s.signature}`);
  }
  out.push(`END;${count}`);
  return out.join("\n");
}
