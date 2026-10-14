import { classesOf, classLabel, DIFFICULTY_LABEL, isRetailDifficulty, SIGNUP_LABEL, SIGNUP_STATUSES, specLabel, type Game, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIComponentInMessageActionRow, type APIEmbed, type APIEmbedField } from "discord.js";
import type { RaidView, Recipient, RosterMember, ViewSignup } from "./api";
import { noEmoji, type EmojiLookup } from "./emojis";
import { encodeId } from "./ids";

/** Rendu de l'annonce d'un raid dans Discord (fonctions pures : testées sans Discord). */

export type Row = APIActionRowComponent<APIComponentInMessageActionRow>;
export interface MessagePayload { content?: string; embeds: APIEmbed[]; components: Row[]; allowedMentions: { parse: [] } }

const GOLD = 0xc8a04b;
const ROLES = [
  { role: "Tank", icon: "🛡️" },
  { role: "Heal", icon: "✚" },
  { role: "DPS", icon: "⚔️" },
] as const;
const COMING: SignupStatus[] = ["present", "late"];
const OTHERS: SignupStatus[] = ["tentative", "alt", "bench", "absent"];
const STYLE: Record<SignupStatus, ButtonStyle> = {
  present: ButtonStyle.Success, late: ButtonStyle.Primary, tentative: ButtonStyle.Secondary,
  alt: ButtonStyle.Secondary, bench: ButtonStyle.Secondary, absent: ButtonStyle.Danger,
};

/** Neutralise la mise en forme Discord dans un pseudo (et les mentions). */
export function escapeMd(s: string) {
  return s.replace(/([\\*_~`|>#[\]()-])/g, "\\$1").replace(/@/g, "@\u200b");
}

/** Liste de lignes tronquée à `max` caractères, avec « … et N autres ». */
export function fitLines(lines: string[], max = 1024, sep = "\n") {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const rest = lines.length - i;
    const tail = `${sep}… et ${rest} autre${rest > 1 ? "s" : ""}`;
    const add = (out.length ? sep.length : 0) + line.length;
    // Garde toujours la place de la mention « … et N autres » si ce n'est pas la dernière ligne
    if (len + add + (i < lines.length - 1 ? tail.length : 0) > max) { out.push(`… et ${rest} autre${rest > 1 ? "s" : ""}`); break; }
    out.push(line); len += add;
  }
  return out.join(sep) || "—";
}

const who = (s: ViewSignup) => escapeMd(s.characterName ?? s.displayName);

/** Jeu du groupe : Roster (WoW Retail) affiche les noms de classes et de spés en français, comme le reste du bot. */
const gameOf = (v: RaidView): Game => v.group.game ?? "forever";
const specName = (g: Game, cls: string, spec: string) => specLabel(g, cls, spec, "fr");
const clsName = (g: Game, cls: string) => classLabel(g, cls, "fr");

/**
 * Une ligne d'inscrit : l'icône de la spé (ou de la classe) puis le nom en gras. La spé n'est écrite qu'à défaut
 * d'icône : chaque ligne tient sur une colonne de Discord (un tiers de la largeur), même « Maîtrise des bêtes ».
 * Les inscrits sans compte sur le site ne sont plus marqués (seul leur nombre figure dans le pied de page).
 */
function line(s: ViewSignup, emoji: EmojiLookup, g: Game) {
  const icon = s.cls ? emoji(s.cls, s.spec) : "";
  const bits = [`${icon ? `${icon} ` : ""}**${who(s)}**`];
  if (!icon && s.spec) bits.push(specName(g, s.cls, s.spec));
  else if (!icon && s.cls) bits.push(clsName(g, s.cls));
  let out = bits.join(" · ");
  if (s.status === "late") out += " ⏰";
  return out;
}

/** Ordre de lecture d'une colonne : par classe (les icônes identiques se suivent), puis par spé, puis par nom. */
function byClass(g: Game) {
  const keys = (s: ViewSignup) => [s.cls ? clsName(g, s.cls) : "\uffff", s.spec ? specName(g, s.cls, s.spec) : "", who(s)];
  return (a: ViewSignup, b: ViewSignup) => {
    const ka = keys(a), kb = keys(b);
    for (let i = 0; i < ka.length; i++) { const c = ka[i]!.localeCompare(kb[i]!, "fr"); if (c) return c; }
    return 0;
  };
}

/** À partir de combien de DPS les tanks et les heals partagent une colonne et les DPS en prennent deux. */
const SPLIT_DPS_FROM = 7;

/**
 * Colonnes des inscrits qui viennent : une par rôle (Tank, Heal, DPS). Quand les DPS sont nombreux, les colonnes
 * seraient déséquilibrées (deux tanks, deux heals, douze DPS) : tanks et heals partagent alors la première, les DPS
 * sont répartis sur les deux autres.
 */
function roleFields(coming: ViewSignup[], emoji: EmojiLookup, g: Game): APIEmbedField[] {
  const sort = byClass(g);
  const lists = ROLES.map(({ role, icon }) => {
    const list = coming.filter(s => s.role === role).sort(sort);
    const e = emoji.role?.(role);
    return { role, icon, list, head: e ? `${e} ${list.length}` : `${icon} ${role} — ${list.length}`, lines: list.map(s => line(s, emoji, g)) };
  });
  const [tank, heal, dps] = lists as [typeof lists[number], typeof lists[number], typeof lists[number]];
  if (dps.list.length < SPLIT_DPS_FROM) return lists.map(c => ({ name: c.head, value: fitLines(c.lines), inline: true }));
  const half = Math.ceil(dps.lines.length / 2);
  return [
    { name: tank.head, value: fitLines([...tank.lines, `**${heal.head}**`, ...heal.lines], 1024), inline: true },
    { name: dps.head, value: fitLines(dps.lines.slice(0, half)), inline: true },
    { name: "\u200b", value: fitLines(dps.lines.slice(half)), inline: true },
  ];
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function rosterLine(m: RosterMember, emoji: EmojiLookup, g: Game) {
  const icon = emoji(m.cls, m.spec);
  return `${icon ? `${icon} ` : ""}**${escapeMd(m.name)}**${!icon && m.spec ? ` · ${specName(g, m.cls, m.spec)}` : ""}`;
}

/** Compo validée : un champ par groupe (3 par ligne), puis les inscrits non retenus. */
function rosterFields(v: RaidView, coming: ViewSignup[], emoji: EmojiLookup): APIEmbedField[] {
  const g0 = gameOf(v);
  const groups = v.roster!.groups;
  const all = groups.flatMap(g => g.members);
  const count = (r: string) => all.filter(m => m.role === r).length;
  const fields: APIEmbedField[] = [{
    name: `✅ Compo validée — ${all.length}/${v.raid.size ?? 40}`,
    value: ROLES.map(({ role, icon }) => {
      const e = emoji.role?.(role);
      return e ? `${e} ${count(role)}` : `${icon} ${count(role)} ${role}`;
    }).join(" · "),
    inline: false,
  }];
  for (const g of groups) fields.push({ name: `Groupe ${g.group}`, value: fitLines(g.members.map(m => rosterLine(m, emoji, g0))), inline: true });
  const out = coming.filter(s => !s.group);
  if (out.length) fields.push({ name: `Inscrits non placés — ${out.length}`, value: fitLines(out.map(s => line(s, emoji, g0))), inline: false });
  return fields;
}

export function renderEmbed(v: RaidView, emoji: EmojiLookup = noEmoji): APIEmbed {
  const g = gameOf(v);
  const coming = v.signups.filter(s => COMING.includes(s.status));
  const fields: APIEmbedField[] = v.roster ? rosterFields(v, coming, emoji) : roleFields(coming, emoji, g);
  const noRole = coming.filter(s => !s.role);
  if (!v.roster && noRole.length) fields.push({ name: `Sans spé — ${noRole.length}`, value: fitLines(noRole.map(s => line(s, emoji, g))), inline: false });
  for (const st of OTHERS) {
    const list = v.signups.filter(s => s.status === st);
    if (!list.length) continue;
    const text = st === "absent" ? list.map(who) : list.map(s => line(s, emoji, g));
    fields.push({ name: `${SIGNUP_LABEL[st]} — ${list.length}`, value: fitLines(text, 1024, st === "absent" ? ", " : "\n"), inline: false });
  }

  const desc: string[] = [];
  if (v.raid.scheduledAt) { const t = unix(v.raid.scheduledAt); desc.push(`📅 <t:${t}:F> · <t:${t}:R>`); }
  if (v.raid.description) desc.push(v.raid.description.slice(0, 1500));
  const guests = coming.filter(s => s.guest).length;
  const classes = new Set(coming.map(s => s.cls).filter(Boolean));

  return {
    title: (isRetailDifficulty(v.raid.difficulty) ? `${v.raid.name} · ${DIFFICULTY_LABEL[v.raid.difficulty].fr}` : v.raid.name).slice(0, 256),
    url: v.raid.url,
    description: desc.join("\n\n") || undefined,
    color: GOLD,
    fields,
    footer: {
      text: [
        v.group.name,
        `${coming.length} inscrit${coming.length > 1 ? "s" : ""}`,
        classes.size ? `${classes.size}/${classesOf(g).length} classes` : null,
        guests ? `${guests} sans compte` : null,
      ].filter(Boolean).join(" · ").slice(0, 2048),
    },
    ...(v.raid.scheduledAt ? { timestamp: new Date(v.raid.scheduledAt).toISOString() } : {}),
  };
}

export function renderButtons(v: RaidView): Row[] {
  const btn = (st: SignupStatus) => ({ type: ComponentType.Button as const, style: STYLE[st], label: SIGNUP_LABEL[st], custom_id: encodeId({ a: "st", raidId: v.raid.id, status: st }) });
  const statuses = SIGNUP_STATUSES.filter(s => s !== "absent");
  return [
    { type: ComponentType.ActionRow, components: statuses.map(btn) },
    {
      type: ComponentType.ActionRow,
      components: [
        btn("absent"),
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Me désinscrire", custom_id: encodeId({ a: "off", raidId: v.raid.id }) },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: "Voir sur le site", url: v.raid.url },
      ],
    },
  ] as Row[];
}

export function renderAnnouncement(v: RaidView, emoji: EmojiLookup = noEmoji): MessagePayload {
  return { embeds: [renderEmbed(v, emoji)], components: renderButtons(v), allowedMentions: { parse: [] } };
}

/** Rappel envoyé en message privé la veille du raid, avec les mêmes boutons que l'annonce. */
export function renderReminder(v: RaidView, r: Recipient, emoji: EmojiLookup = noEmoji): MessagePayload {
  const t = v.raid.scheduledAt ? unix(v.raid.scheduledAt) : null;
  const icon = r.cls ? emoji(r.cls, r.spec) : "";
  const lines = [
    t ? `📅 <t:${t}:F> · <t:${t}:R>` : null,
    `Tu es inscrit : **${SIGNUP_LABEL[r.status]}**${r.name ? ` avec ${icon ? `${icon} ` : ""}**${escapeMd(r.name)}**` : ""}${r.spec ? ` (${specName(gameOf(v), r.cls, r.spec)})` : ""}.`,
    r.group ? `Tu es dans le **groupe ${r.group}** de la compo.` : v.roster && ["present", "late"].includes(r.status) ? "Tu n'es pas placé dans la compo pour l'instant." : null,
    "Un changement ? Clique sur un statut ci-dessous.",
  ].filter(Boolean);
  return {
    embeds: [{
      title: `Rappel : ${v.raid.name}`.slice(0, 256),
      url: v.raid.url,
      description: lines.join("\n"),
      color: GOLD,
      footer: {
        text: r.guest
          ? `${v.group.name} · Inscrit sans compte : « Me désinscrire » arrête les rappels de ce raid.`
          : `${v.group.name} · Rappels désactivables dans Compte & sécurité sur le site.`,
      },
    }],
    components: renderButtons(v),
    allowedMentions: { parse: [] },
  };
}
