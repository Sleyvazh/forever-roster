/**
 * Icônes de rôle du jeu (Tank, Heal, DPS) : ce sont des « atlas » de l'interface (UI-LFG-RoleIcon-*), c'est-à-dire
 * des morceaux d'une texture plus grande. Leur position vient des tables UiTextureAtlasMember et UiTextureAtlas du client.
 */
export const ROLE_ATLAS = { tank: "UI-LFG-RoleIcon-Tank", heal: "UI-LFG-RoleIcon-Healer", dps: "UI-LFG-RoleIcon-DPS" } as const;
export type RoleKey = keyof typeof ROLE_ATLAS;

export interface AtlasCrop { fileDataId: number; atlasWidth: number; atlasHeight: number; left: number; right: number; top: number; bottom: number }

/** Valeur d'une colonne, quel que soit l'intitulé exact (« CommittedName » ou « Name », casse ignorée). */
function col(row: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const key = Object.keys(row).find(k => k.toLowerCase() === n.toLowerCase());
    if (key !== undefined && row[key] !== "") return row[key]!;
  }
  return undefined;
}
const num = (v: string | undefined) => (v === undefined ? NaN : Number(v));

/** Position de chaque icône de rôle dans sa texture (les rôles introuvables sont absents du résultat). */
export function findRoleAtlases(members: Record<string, string>[], atlases: Record<string, string>[]): Partial<Record<RoleKey, AtlasCrop>> {
  const byId = new Map(atlases.map(a => [col(a, "ID"), a]));
  const out: Partial<Record<RoleKey, AtlasCrop>> = {};
  for (const [role, name] of Object.entries(ROLE_ATLAS) as [RoleKey, string][]) {
    const m = members.find(r => col(r, "CommittedName", "Name")?.toLowerCase() === name.toLowerCase());
    const a = m && byId.get(col(m, "UiTextureAtlasID"));
    if (!m || !a) continue;
    const crop: AtlasCrop = {
      fileDataId: num(col(a, "FileDataID")), atlasWidth: num(col(a, "AtlasWidth")), atlasHeight: num(col(a, "AtlasHeight")),
      left: num(col(m, "CommittedLeft")), right: num(col(m, "CommittedRight")), top: num(col(m, "CommittedTop")), bottom: num(col(m, "CommittedBottom")),
    };
    if (Object.values(crop).every(v => Number.isFinite(v)) && crop.right > crop.left && crop.bottom > crop.top) out[role] = crop;
  }
  return out;
}

/** Zone à découper dans l'image réelle (la texture peut être plus petite ou plus grande que l'atlas déclaré). */
export function cropBox(c: AtlasCrop, width: number, height: number) {
  const sx = width / c.atlasWidth, sy = height / c.atlasHeight;
  const left = Math.max(0, Math.round(c.left * sx)), top = Math.max(0, Math.round(c.top * sy));
  return {
    left, top,
    width: Math.max(1, Math.min(width - left, Math.round((c.right - c.left) * sx))),
    height: Math.max(1, Math.min(height - top, Math.round((c.bottom - c.top) * sy))),
  };
}
