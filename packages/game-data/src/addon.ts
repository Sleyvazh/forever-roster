import type { Role, SignupStatus } from "./core";

/**
 * Export d'un raid pour un addon WoW (format « FRR », version 1) et macros d'invitation.
 * Spécification : docs/addon-format.md. Pensé pour être lu en Lua avec strsplit(";", ligne) :
 * pas de « | » (caractère d'échappement de WoW), une information par ligne, champs sans « ; ».
 */

export const ADDON_FORMAT_VERSION = 1;

export interface ExportMember {
  /** Nom du perso (ou pseudo Discord pour une inscription sans compte). */
  name: string;
  cls: string;
  spec: string | null;
  role: Role | null;
  /** Place dans la compo (0 = pas placé). */
  group: number;
  pos: number;
  status: SignupStatus | null;
  /** « site » (perso du site) ou « discord » (inscription libre, nom non garanti en jeu). */
  source: "site" | "discord";
}

const clean = (s: string) => s.replace(/[;\r\n|]/g, " ").trim();

/**
 * Nom du perso tel que le jeu le connaît : Forever permet un nom de famille (« Greta Coulé »),
 * mais le jeu (invitations, export de l'addon) n'utilise que le prénom.
 */
export const gameName = (name: string) => clean(name).split(/\s+/)[0] ?? "";

/** L'export du jeu (prénom seul) correspond-il à cette fiche (prénom + nom de famille éventuel) ? */
export const sameCharacter = (exportName: string, ficheName: string) =>
  gameName(exportName).normalize("NFC").toLocaleLowerCase("fr") === gameName(ficheName).normalize("NFC").toLocaleLowerCase("fr");

export function addonExport(raid: { id: string; name: string; scheduledAt: string | null }, members: ExportMember[]): string {
  const unix = raid.scheduledAt ? Math.floor(new Date(raid.scheduledAt).getTime() / 1000) : 0;
  const sorted = [...members].sort((a, b) => (a.group || 99) - (b.group || 99) || a.pos - b.pos || a.name.localeCompare(b.name));
  const lines = [
    `FRR;${ADDON_FORMAT_VERSION};${raid.id};${unix};${clean(raid.name)}`,
    ...sorted.map(m => ["M", m.source === "site" ? gameName(m.name) : clean(m.name), m.cls.toUpperCase(), m.role ?? "", clean(m.spec ?? ""), m.group, m.pos, m.status ?? "", m.source].join(";")),
    `END;${sorted.length}`,
  ];
  return lines.join("\n");
}

/** Macros « /inv Nom » découpées pour tenir dans la limite de 255 caractères d'une macro. */
export function inviteMacros(names: string[], max = 255): string[] {
  const macros: string[] = [];
  let cur = "";
  for (const n of [...new Set(names.map(gameName).filter(Boolean))]) {
    const line = `/inv ${n}`;
    if (cur && cur.length + 1 + line.length > max) { macros.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) macros.push(cur);
  return macros;
}
