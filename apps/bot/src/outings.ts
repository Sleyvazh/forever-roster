import { classLabel, classRoles, CLASS_NAMES, ordinalEn, outingWhenText, specDef, specLabel, specsOf, type GameLang } from "@forever/game-data";
import { ButtonStyle, ComponentType, type APIButtonComponent } from "discord.js";
import type { InternalApi, OutingChoices, OutingJoin, OutingMember, OutingNotice, OutingRole, OutingSignupBody, OutingView } from "./api";
import { langOf, N, quote, tr, trn, type Lang } from "./i18n";
import { encodeOutingId } from "./ids";
import { noEmoji, type EmojiLookup } from "./emojis";
import { escapeMd, type MessagePayload, type Row } from "./render";
import type { Logger } from "./sync";

/**
 * Sorties donjon (Forever) sur Discord : annonce compacte (titre « Gnomeregan · 29-38 · ce soir 21:00 », une ligne par
 * rôle, la note, le créateur), boutons Tank / Soigneur / DPS grisés quand le rôle est plein, « Me mettre en attente »
 * quand c'est complet, « Me retirer ». Parcours (membre lié ou sans compte) et MP. Fonctions pures, testées sans Discord ;
 * main.ts s'occupe de Discord.
 */

const GOLD = 0xc8a04b;
export const ROLE_ICON: Record<OutingRole, string> = { Tank: "🛡️", Heal: "✚", DPS: "⚔️" };
const ROLE_BUTTON: Record<OutingRole, string> = { Tank: N("Tank"), Heal: N("Soigneur"), DPS: N("DPS") };
/** Dans une phrase : « inscrit en soigneur ». */
const ROLE_WORD: Record<OutingRole, string> = { Tank: N("tank"), Heal: N("soigneur"), DPS: N("DPS") };
export const roleWord = (lang: Lang, r: OutingRole) => tr(lang, ROLE_WORD[r]);
const roleButton = (lang: Lang, r: OutingRole) => tr(lang, ROLE_BUTTON[r]);
const ROLES: OutingRole[] = ["Tank", "Heal", "DPS"];
const placesOf = (v: Pick<OutingView, "places">, r: OutingRole) => (r === "Tank" ? v.places.tank : r === "Heal" ? v.places.heal : v.places.dps);
const total = (v: Pick<OutingView, "places">) => v.places.tank + v.places.heal + v.places.dps;
export const isComplete = (v: OutingView) => v.signups.length >= total(v);
const when = (v: { at: string | null; day: string }, now: Date, lang: Lang = "fr") => outingWhenText(v.at ? new Date(v.at) : null, v.day, now, undefined, lang);

/** Titre : « Gnomeregan · 29-38 · ce soir 21:00 », « · complète » quand il ne reste aucune place. */
export function outingTitle(v: OutingView, now = new Date()) {
  const lang = langOf(v.group);
  return [v.title, v.levels || null, when(v, now, lang), isComplete(v) ? tr(lang, "complète") : null].filter(Boolean).join(" · ").slice(0, 256);
}

/** Un inscrit : icône de sa spé (ou classe), nom en gras, « ✱ » s'il s'est inscrit depuis Discord sans compte. */
const member = (m: OutingMember, emoji: EmojiLookup) => {
  const icon = m.cls ? emoji(m.cls, m.spec) : "";
  return `${icon ? `${icon} ` : ""}**${escapeMd(m.name)}**${m.guest ? " ✱" : ""}`;
};

export function renderOuting(v: OutingView, emoji: EmojiLookup = noEmoji, now = new Date()): MessagePayload {
  const lang = langOf(v.group);
  const lines = ROLES.filter(r => placesOf(v, r) > 0).map(r => {
    const list = v.signups.filter(s => s.role === r).map(s => member(s, emoji));
    const free = Math.max(0, placesOf(v, r) - list.length);
    const icon = emoji.role?.(r) || ROLE_ICON[r];
    return `${icon} ${[...list, ...Array.from({ length: free }, () => `*${tr(lang, "libre")}*`)].join(", ")}`;
  });
  const desc = [lines.join("\n"), v.note ? quote(lang, escapeMd(v.note)) : null].filter(Boolean).join("\n\n");
  const foot = [tr(lang, "Proposée par {name}", { name: v.creator }), `${v.signups.length}/${total(v)}`, v.waiting.length ? tr(lang, "{n} en attente", { n: v.waiting.length }) : null].filter(Boolean).join(" · ");
  return {
    embeds: [{ title: outingTitle(v, now), url: v.url, description: desc.slice(0, 4000), color: GOLD, footer: { text: foot.slice(0, 2048) } }],
    components: outingButtons(v),
    allowedMentions: { parse: [] },
  };
}

/** Rôles (grisés quand pleins), « Me mettre en attente » quand c'est complet, « Me retirer ». */
export function outingButtons(v: OutingView): Row[] {
  const lang = langOf(v.group);
  const full = isComplete(v);
  const buttons: APIButtonComponent[] = ROLES.filter(r => placesOf(v, r) > 0).map(r => {
    const open = v.signups.filter(s => s.role === r).length < placesOf(v, r);
    return { type: ComponentType.Button, style: open ? ButtonStyle.Success : ButtonStyle.Secondary, disabled: !open, label: `${ROLE_ICON[r]} ${roleButton(lang, r)}`,
      custom_id: encodeOutingId({ a: "join", outingId: v.id, role: r, wait: false }) };
  });
  if (full) buttons.push({ type: ComponentType.Button, style: ButtonStyle.Primary, label: tr(lang, "⏳ Me mettre en attente"), custom_id: encodeOutingId({ a: "wait", outingId: v.id }) });
  buttons.push({ type: ComponentType.Button, style: ButtonStyle.Secondary, label: tr(lang, "Me retirer"), custom_id: encodeOutingId({ a: "leave", outingId: v.id }) });
  return [{ type: ComponentType.ActionRow, components: buttons }];
}

/* ---------- Parcours d'inscription ---------- */

export type OutingStep =
  | { kind: "signup"; body: OutingSignupBody }
  | { kind: "reply"; content: string; components: Row[] };

const select = (custom_id: string, placeholder: string, options: { label: string; value: string; description?: string }[]): Row => ({
  type: ComponentType.ActionRow,
  components: [{ type: ComponentType.StringSelect, custom_id, placeholder, options: options.slice(0, 25), min_values: 1, max_values: 1 }],
});
const intro = (ui: Lang, role: OutingRole, wait: boolean) => (wait ? `⏳ **${tr(ui, "Liste d'attente")}** — ${roleWord(ui, role)}` : `${ROLE_ICON[role]} **${roleButton(ui, role)}**`);

/**
 * Clic sur un rôle (ou un rôle de la liste d'attente) : un membre lié s'inscrit avec son perso qui a le niveau (menu s'il
 * en a plusieurs) ; sans compte, il choisit sa classe puis sa spé (comme pour les raids), parmi celles du rôle.
 */
export function onOutingRole(outingId: string, role: OutingRole, wait: boolean, c: OutingChoices, lang: GameLang = "fr"): OutingStep {
  const ui = langOf(c);
  if (c.mode === "member") {
    if (!c.characters.length) {
      return { kind: "reply", components: [], content: c.anyAtLevel
        ? tr(ui, "Aucun de tes persos qui ont le niveau ne joue {role}.", { role: roleWord(ui, role) })
        : c.levels ? tr(ui, "Aucun de tes persos n'a le niveau de cette sortie ({levels}). Mets son niveau à jour sur le site (ou par l'addon).", { levels: c.levels })
          : tr(ui, "Aucun de tes persos n'a le niveau de cette sortie. Mets son niveau à jour sur le site (ou par l'addon).") };
    }
    const cur = c.current?.characterId ? c.characters.find(ch => ch.id === c.current!.characterId) : undefined;
    const pick = c.characters.length === 1 ? c.characters[0]! : cur && c.current!.role === role ? cur : null;
    if (pick) return { kind: "signup", body: { role, characterId: pick.id, spec: pick.spec, wait } };
    return {
      kind: "reply",
      content: `${intro(ui, role, wait)}\n${tr(ui, "Avec quel perso ?")}`,
      components: [select(encodeOutingId({ a: "char", outingId, role, wait }), tr(ui, "Ton perso"), c.characters.map(ch => ({
        label: tr(ui, "{name} — niveau {level}", { name: ch.name, level: ch.level }).slice(0, 100), value: ch.id,
        description: [classLabel("forever", ch.cls, lang), ch.spec && specLabel("forever", ch.cls, ch.spec, lang)].filter(Boolean).join(" · ").slice(0, 100),
      })))],
    };
  }
  // Sans compte : sa classe et sa spé déjà choisies pour ce rôle servent telles quelles
  if (c.current && c.current.cls && c.current.spec && specDef(c.current.cls, c.current.spec)?.role === role) {
    return { kind: "signup", body: { role, cls: c.current.cls, spec: c.current.spec, wait } };
  }
  const why = c.linked
    ? tr(ui, "Ton Discord est lié au site, mais tu n'es pas membre de cette guilde : inscription libre.")
    : tr(ui, "Inscription libre, sans compte. Lie ton Discord sur le site (Compte & sécurité) pour t'inscrire avec tes persos.");
  const classes = CLASS_NAMES.filter(cls => classRoles(cls).includes(role)).sort((a, b) => classLabel("forever", a, lang).localeCompare(classLabel("forever", b, lang), lang));
  return {
    kind: "reply",
    content: `${intro(ui, role, wait)}\n${why}\n${tr(ui, "Choisis ta classe :")}`,
    components: [select(encodeOutingId({ a: "cls", outingId, role, wait }), tr(ui, "Ta classe"), classes.map(cls => ({ label: classLabel("forever", cls, lang), value: cls })))],
  };
}

/** Sans compte : classe choisie → sa spé dans ce rôle (directement s'il n'y en a qu'une). ui : langue du bot pour la guilde. */
export function onOutingClass(outingId: string, role: OutingRole, wait: boolean, cls: string, lang: GameLang = "fr", ui: Lang = "fr"): OutingStep {
  const specs = specsOf("forever", cls).filter(sp => specDef(cls, sp)?.role === role);
  if (!specs.length) return { kind: "reply", content: tr(ui, "Cette classe ne joue pas {role}.", { role: roleWord(ui, role) }), components: [] };
  if (specs.length === 1) return { kind: "signup", body: { role, cls, spec: specs[0]!, wait } };
  return {
    kind: "reply",
    content: `${intro(ui, role, wait)}\n${tr(ui, "**{name}** : dans quelle spé ?", { name: classLabel("forever", cls, lang) })}`,
    components: [select(encodeOutingId({ a: "spec", outingId, role, wait }), tr(ui, "Ta spé"), specs.map(sp => ({ label: specLabel("forever", cls, sp, lang), value: `${cls}:${sp}` })))],
  };
}

/** « En attente pour quel rôle ? » : un bouton par rôle de la sortie. */
export function waitChooser(outingId: string, ui: Lang = "fr"): { content: string; components: Row[] } {
  return {
    content: tr(ui, "⏳ La sortie est complète. En attente pour quel rôle ? Tu prendras la première place libérée dans ce rôle, un MP te préviendra."),
    components: [{ type: ComponentType.ActionRow, components: ROLES.map(r => ({
      type: ComponentType.Button as const, style: ButtonStyle.Secondary, label: `${ROLE_ICON[r]} ${roleButton(ui, r)}`, custom_id: encodeOutingId({ a: "join", outingId, role: r, wait: true }),
    })) }],
  };
}

const rank = (ui: Lang, n: number) => (ui === "en" ? ordinalEn(n) : n === 1 ? "1er" : `${n}e`);
/** Message (visible par le joueur seul) après l'inscription : « ✚ Inscrit en soigneur avec Kaelys, ton perso qui a le niveau. » */
export function outingConfirmation(r: OutingJoin, opts: { guest: boolean; leveled: boolean }, ui: Lang = "fr") {
  const name = `**${escapeMd(r.name)}**`;
  const role = `**${roleWord(ui, r.role)}**`;
  const who = opts.guest ? "" : opts.leveled ? tr(ui, " avec {name}, ton perso qui a le niveau", { name }) : tr(ui, " avec {name}", { name });
  if (r.state === "waiting") return tr(ui, "⏳ En attente en {role}{who} ({rank}). Tu prendras la première place libérée, un MP te préviendra.", { role, who, rank: rank(ui, r.position ?? 1) });
  return `${ROLE_ICON[r.role]} ${tr(ui, "Inscrit en {role}{who}.", { role, who })}`;
}

/* ---------- MP ---------- */

const linkRow = (url: string, ui: Lang): Row => ({ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: tr(ui, "Voir sur le site"), url }] });
const hour = (at: string | null) => (at ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(at)) : null);

/** Texte d'un MP (sortie complète, 15 min avant, heure changée, annulée, place libérée), dans la langue de la guilde. */
export function renderNotice(n: OutingNotice, now = new Date()): { content: string; components: Row[] } {
  const p = n.payload;
  const ui = langOf(p);
  const t = `**${escapeMd(p.title)}**`;
  const w = when(p, now, ui);
  const others = Math.max(0, (p.count ?? 5) - 1);
  const role = p.role ? (ROLE_WORD[p.role as OutingRole] ? roleWord(ui, p.role as OutingRole) : p.role) : "";
  let content: string;
  switch (n.kind) {
    case "full": {
      const at = p.at ? tr(ui, "de {time}", { time: hour(p.at)! }) : `(${w})`;
      content = p.at ? tr(ui, "{title} {at} est complète ({n}/{n}). En jeu, ton addon proposera « Inviter les {others} » à l'heure.", { title: t, at, n: p.count ?? 5, others })
        : tr(ui, "{title} {at} est complète ({n}/{n}). En jeu, ton addon proposera « Inviter les {others} ».", { title: t, at, n: p.count ?? 5, others });
      break;
    }
    case "soon": {
      const min = p.at ? Math.max(1, Math.round((new Date(p.at).getTime() - now.getTime()) / 60e3)) : 15;
      content = p.isCreator
        ? tr(ui, "{title} dans {min} min. En jeu, ton addon proposera « Inviter les {others} » à l'heure.", { title: t, min, others })
        : tr(ui, "{title} dans {min} min. {creator} t'invite en jeu ; sinon, chuchote-le.", { title: t, min, creator: escapeMd(p.creator) });
      break;
    }
    case "moved": {
      const old = when({ at: p.oldAt ?? null, day: p.oldDay ?? p.day }, now, ui);
      content = role ? tr(ui, "{title} change d'heure : ~~{old}~~ → {when}. Tu restes inscrit en {role}.", { title: t, old, when: w, role })
        : tr(ui, "{title} change d'heure : ~~{old}~~ → {when}. Tu restes inscrit.", { title: t, old, when: w });
      break;
    }
    case "cancelled":
      content = tr(ui, "La sortie {title} ({when}) est annulée.", { title: t, when: w });
      break;
    case "promoted": {
      const bits = `${role ? tr(ui, " en {role}", { role }) : ""}${p.character ? tr(ui, " avec {name}", { name: `**${escapeMd(p.character)}**` }) : ""}`;
      content = tr(ui, "Une place s'est libérée : tu es inscrit à {title} ({when}){bits}.", { title: t, when: w, bits });
      break;
    }
  }
  return { content: content!, components: n.kind === "cancelled" ? [] : [linkRow(p.url, ui)] };
}

/* ---------- Relève : annonces dans le salon des sorties (ou du groupe) ---------- */

export interface OutingPublisher { upsert(v: OutingView, messageId: string | null): Promise<{ channelId: string; messageId: string }> }

/** Annonces à publier ou mettre à jour ; une seule publication à la fois par sortie (clic et relève simultanés). */
export function createOutingSync(api: Pick<InternalApi, "outingsOutbox" | "outingPublished">, pub: OutingPublisher, log: Logger, now = () => Date.now()) {
  const posted = new Map<string, { channelId: string; messageId: string }>();
  const locks = new Map<string, Promise<unknown>>();
  const failures = new Map<string, number>();
  let running = false;
  const serial = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    locks.set(key, next);
    void next.catch(() => {}).finally(() => { if (locks.get(key) === next) locks.delete(key); });
    return next;
  };
  function publish(v: OutingView) {
    return serial(v.id, async () => {
      const known = posted.get(v.id);
      const msg = await pub.upsert(v, v.messageId ?? (known?.channelId === v.channelId ? known.messageId : null));
      posted.set(v.id, msg);
      await api.outingPublished(v.id, { ...msg, changedAt: v.changedAt, renderedOn: v.today });
      failures.delete(v.id);
      return msg;
    });
  }
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { outings } = await api.outingsOutbox();
      for (const v of outings) {
        if ((failures.get(v.id) ?? 0) > now()) continue;
        try { await publish(v); } catch (e) {
          failures.set(v.id, now() + 60e3);
          log.warn(`Sortie non publiée (${v.id})`, e instanceof Error ? e.message : e);
        }
      }
    } finally { running = false; }
  }
  return { publish, tick };
}
