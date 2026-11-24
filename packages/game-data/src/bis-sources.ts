/**
 * Provenances de départ des objets (module BiS), relevées sur le web le 24/11/2026. Elles servent tant que l'addon
 * n'a rien appris et qu'aucun admin n'a corrigé l'objet (la base l'emporte sur cette table). Un objet présent ici
 * compte comme obtenable même si personne ne l'a encore vu en jeu.
 *
 * Mise à jour : Claude repasse de temps en temps sur les bases web (Wowhead Forever, metaforge…) pour compléter
 * cette table (décision de Flo, 24/11). Ne mettre ici que ce qu'une page publique affirme, avec sa référence.
 */
import type { BisSource } from "./bis";

const WOWTBC = "https://wowtbc.gg/warcraftforever/bis-list/feral-dps-druid/";
const WOWGG = "https://wow.gg/guides/wow-forever-feral-druid";
const TIMESAVER = "https://timesaver.gg/tools/wow-forever/leveling-gear/druid/feral";

const drop = (where: string, npc: string, ref: string): BisSource => ({ kind: "drop", where, npc, ref });
const craft = (profession: string, skill: number | undefined, ref: string): BisSource => ({ kind: "craft", profession, ...(skill ? { skill } : {}), ref });
const pix = (cost: number): BisSource => ({ kind: "vendor", where: "Stranglethorn Vale", npc: "Pix Xizzix", cost: `${cost} Tarnished Undermine Real`, ref: WOWTBC });
const av: BisSource = { kind: "reputation", faction: "Stormpike Guard / Frostwolf Clan", standing: "exalted", ref: WOWTBC };

export const BIS_SOURCE_SEED: Record<number, BisSource> = {
  // wowtbc.gg (pré-raid Feral DPS)
  16708: drop("Stratholme", "Cannon Master Willey", WOWTBC), // Shadowcraft Spaulders
  13340: drop("Stratholme", "Baron Rivendare", WOWTBC), // Cape of the Black Baron
  252484: craft("Leatherworking", undefined, WOWTBC), // Timbermaw Tunic
  16710: { kind: "world", ref: WOWTBC }, // Shadowcraft Bracers
  272396: pix(100), // Shifter's Belt
  16711: drop("Scholomance", "Rattlegore", WOWTBC), // Shadowcraft Boots
  19325: av, // Don Julio's Band
  272408: pix(75), // Cutthroat's Signet
  280065: drop("Blackmaw Hold", "Blackmaw Behemoth", WOWTBC), // Behemoth Bones
  19323: av, // The Unstoppable Force
  272427: pix(50), // Howling Idol
  // wow.gg (compétence de métier précisée)
  19049: craft("Leatherworking", 300, WOWGG), // Timbermaw Brawlers
  15065: craft("Leatherworking", 285, WOWGG), // Warbear Woolies
  22241: drop("Blackrock Depths", "Warder Stilgiss", WOWGG), // Dark Warder's Pauldrons
  19044: craft("Leatherworking", 290, WOWGG), // Might of the Timbermaw
  19052: craft("Leatherworking", 290, WOWGG), // Dawn Treaders
  250613: craft("Blacksmithing", 270, WOWGG), // Thorium Greatmace
  220606: craft("Enchanting", 320, WOWGG), // Idol of the Dream
  // timesaver.gg
  13404: drop("Stratholme", "The Unforgiven", TIMESAVER), // Mask of the Unforgiven
  12927: drop("Blackrock Spire", "Pyroguard Emberseer", TIMESAVER), // Truestrike Shoulders
  252483: craft("Leatherworking", undefined, TIMESAVER), // Dawn Armor
  15063: craft("Leatherworking", undefined, TIMESAVER), // Devilsaur Gauntlets
  15062: craft("Leatherworking", undefined, TIMESAVER), // Devilsaur Leggings
  19167: craft("Blacksmithing", undefined, TIMESAVER), // Blackfury
  13213: drop("Blackrock Spire", "Mother Smolderweb", TIMESAVER), // Smolderweb's Eye
  12966: drop("Blackrock Spire", "The Beast", TIMESAVER), // Blackmist Armguards
  273887: craft("Leatherworking", undefined, TIMESAVER), // Grovekeeper Stompers
  13392: drop("Stratholme", "Postmaster Malown", TIMESAVER), // The Postmaster's Seal
};
