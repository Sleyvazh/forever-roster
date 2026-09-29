import { CLASSES, SIGNUP_LABEL, SIGNUP_STATUSES, type SignupStatus } from "@forever/game-data";
import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIComponentInMessageActionRow, type APIEmbed, type APIEmbedField } from "discord.js";
import type { RaidView, ViewSignup } from "./api";
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

function line(s: ViewSignup) {
  const bits = [`**${who(s)}**`];
  if (s.spec) bits.push(s.spec);
  else if (s.cls) bits.push(s.cls);
  let out = bits.join(" · ");
  if (s.status === "late") out += " ⏰";
  if (s.guest) out += " ✱";
  return out;
}

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export function renderEmbed(v: RaidView): APIEmbed {
  const coming = v.signups.filter(s => COMING.includes(s.status));
  const fields: APIEmbedField[] = ROLES.map(({ role, icon }) => {
    const list = coming.filter(s => s.role === role);
    return { name: `${icon} ${role} — ${list.length}`, value: fitLines(list.map(line)), inline: true };
  });
  const noRole = coming.filter(s => !s.role);
  if (noRole.length) fields.push({ name: `Sans spé — ${noRole.length}`, value: fitLines(noRole.map(line)), inline: false });
  for (const st of OTHERS) {
    const list = v.signups.filter(s => s.status === st);
    if (!list.length) continue;
    const text = st === "absent" ? list.map(who) : list.map(line);
    fields.push({ name: `${SIGNUP_LABEL[st]} — ${list.length}`, value: fitLines(text, 1024, st === "absent" ? ", " : "\n"), inline: false });
  }

  const desc: string[] = [];
  if (v.raid.scheduledAt) { const t = unix(v.raid.scheduledAt); desc.push(`📅 <t:${t}:F> · <t:${t}:R>`); }
  if (v.raid.description) desc.push(v.raid.description.slice(0, 1500));
  const guests = v.signups.some(s => s.guest);
  const classes = new Set(coming.map(s => s.cls).filter(Boolean));

  return {
    title: v.raid.name.slice(0, 256),
    url: v.raid.url,
    description: desc.join("\n\n") || undefined,
    color: GOLD,
    fields,
    footer: {
      text: [
        v.group.name,
        `${coming.length} inscrit${coming.length > 1 ? "s" : ""}`,
        classes.size ? `${classes.size}/${Object.keys(CLASSES).length} classes` : null,
        guests ? "✱ inscrit sans compte" : null,
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

export function renderAnnouncement(v: RaidView): MessagePayload {
  return { embeds: [renderEmbed(v)], components: renderButtons(v), allowedMentions: { parse: [] } };
}
