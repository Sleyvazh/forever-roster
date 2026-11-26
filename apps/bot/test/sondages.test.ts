import { describe, expect, it } from "vitest";
import type { PollView } from "../src/api";
import {
  closeConfirm, createModal, datesPanel, decodePollId, encodePollId, isPollId, parseDraft, raidCreatedReply, raidModal, renderPoll, voteReply, votersReply,
  type PollAction,
} from "../src/polls-core";

const ID = "0f6c1d2e-0000-4000-8000-000000000001";
const TZ = "Europe/Paris";
// Jeudi 26 novembre 2026, 19:42 à Paris
const NOW = new Date("2026-11-26T18:42:00Z");
type Btn = { custom_id?: string; label?: string; disabled?: boolean; style?: number; url?: string; emoji?: { name: string } };
const buttons = (p: { components: { components: unknown[] }[] }) => p.components.flatMap(r => r.components as Btn[]);

const base = {
  id: ID, multi: false, anonymous: true, results: "live" as const, hidden: false, closesAt: "2026-11-26T17:00:00.000Z", deadline: "2026-11-26T17:00:00.000Z", closedAt: null,
  createdAt: "2026-11-20T10:00:00.000Z", creator: "Sleyvazh", createdBy: "u", raidName: "", raid: null, group: { id: "g", name: "Forever", lang: "fr" as const },
  channelId: "300000000000000002", messageId: null, changedAt: "2026-11-26T18:00:00.000Z", url: `https://x.test/groups/g/membres/sondages?sondage=${ID}`,
};
const choice = (over: Partial<PollView> = {}): PollView => ({
  ...base, kind: "choice", question: "Quel donjon jeudi soir ?", voters: 13, best: null, leaders: [1],
  options: ([["Scholomance", 6], ["Stratholme (vivants)", 4], ["Pic Rochenoire", 2], ["Hache-Tripes", 1]] as const)
    .map(([label, n], i) => ({ id: i + 1, label, at: null, yes: n, maybe: 0, no: null, roles: null })),
  ...over,
});
const slot = (d: string) => new Date(d).toISOString();
const dates = (over: Partial<PollView> = {}): PollView => ({
  ...base, kind: "dates", multi: true, anonymous: false, question: "Quel soir pour Onyxia ?", voters: 18, best: 2, leaders: [], raidName: "Onyxia",
  closesAt: "2026-11-29T19:00:00.000Z",
  options: ([["2026-12-01T20:00:00Z", 11, 3], ["2026-12-02T20:00:00Z", 15, 1], ["2026-12-03T20:00:00Z", 9, 4]] as const)
    .map(([at, y, m], i) => ({ id: i + 1, label: "", at: slot(at), yes: y, maybe: m, no: 18 - y - m, roles: { Tank: 2, Heal: 4, DPS: 9 } })),
  ...over,
});

describe("identifiants des boutons, menus et fenêtres", () => {
  it("aller-retour, formes forgées refusées", () => {
    const all: PollAction[] = [
      { a: "vote", pollId: ID, optionId: 10 }, { a: "me", pollId: ID }, { a: "who", pollId: ID }, { a: "close", pollId: ID }, { a: "closeok", pollId: ID },
      { a: "raid", pollId: ID }, { a: "raidmodal", pollId: ID }, { a: "yes", pollId: ID }, { a: "maybe", pollId: ID },
      { a: "new", kind: "choice", anonymous: false, multi: true, results: "end" }, { a: "new", kind: "dates" }, { a: "fix" },
    ];
    for (const x of all) {
      const id = encodePollId(x);
      expect(isPollId(id)).toBe(true);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(decodePollId(id)).toEqual(x);
    }
    for (const bad of [`pl|v|${ID}|0`, `pl|v|${ID}|11`, `pl|v|${ID}`, `pl|me|nope`, `pl|me|${ID}|1`, "pl|new|c|a2m0rl", "pl|new|x", "pl|fix|1", `fr|me|${ID}`, `pl|zz|${ID}`]) {
      expect(decodePollId(bad)).toBeNull();
    }
  });
});

describe("message d'un sondage à choix", () => {
  it("barres en texte, 🏆 en tête, un bouton par choix, Mon vote, Clore ; anonyme : pas de « Qui a voté ? »", () => {
    const p = renderPoll(choice());
    const e = p.embeds[0]!;
    expect(e.title).toBe("📊 Quel donjon jeudi soir ?");
    expect(e.url).toBe(base.url);
    expect(e.description).toBe([
      "*Posé par Sleyvazh · vote anonyme · un seul choix · se termine jeudi 26/11 à 18:00*", "",
      "1️⃣ **Scholomance** 🏆", "`██████░░░░░░░░` 6 · 46 %",
      "2️⃣ **Stratholme \\(vivants\\)**", "`████░░░░░░░░░░` 4 · 31 %",
      "3️⃣ **Pic Rochenoire**", "`██░░░░░░░░░░░░` 2 · 15 %",
      "4️⃣ **Hache\\-Tripes**", "`█░░░░░░░░░░░░░` 1 · 8 %",
    ].join("\n"));
    expect(e.footer!.text).toBe("13 votes · ton vote se change jusqu'à la fin");
    const b = buttons(p);
    expect(b.map(x => x.label)).toEqual(["Scholomance", "Stratholme (vivants)", "Pic Rochenoire", "Hache-Tripes", "Mon vote", "Clore le sondage", "Sur le site"]);
    expect(b[0]!.emoji).toEqual({ name: "1️⃣" });
    expect(decodePollId(b[1]!.custom_id!)).toEqual({ a: "vote", pollId: ID, optionId: 2 });
    expect(b[6]!.url).toBe(base.url);
    expect(p.allowedMentions).toEqual({ parse: [] });
  });

  it("résultats cachés jusqu'à la fin ; public et clos : résultats, « Qui a voté ? » seul ; anglais", () => {
    const hidden = renderPoll(choice({ hidden: true, results: "end", closesAt: null, leaders: [], options: choice().options.map(o => ({ ...o, yes: null })) })).embeds[0]!;
    expect(hidden.description).toBe("*Posé par Sleyvazh · vote anonyme · un seul choix · résultats à la fin · jusqu'à ce qu'il soit clos*\n\n1️⃣ **Scholomance**\n2️⃣ **Stratholme \\(vivants\\)**\n3️⃣ **Pic Rochenoire**\n4️⃣ **Hache\\-Tripes**");
    expect(hidden.footer!.text).toBe("13 votes · résultats visibles à la fin du sondage");
    const closed = renderPoll(choice({ anonymous: false, multi: true, closedAt: "2026-11-26T17:00:00.000Z" }));
    expect(closed.embeds[0]!.title).toBe("🔒 📊 Quel donjon jeudi soir ?");
    expect(closed.embeds[0]!.description!.split("\n")[0]).toBe("*Posé par Sleyvazh · vote public · plusieurs choix · clos le jeudi 26/11 à 18:00*");
    expect(buttons(closed).map(x => x.label)).toEqual(["Qui a voté ?", "Sur le site"]);
    const en = renderPoll(choice({ group: { id: "g", name: "Forever", lang: "en" } })).embeds[0]!;
    expect(en.description!.split("\n")[0]).toBe("*Asked by Sleyvazh · anonymous vote · one choice · ends Thursday 26/11 at 18:00*");
    expect(en.footer!.text).toBe("13 votes · you can change your vote until the end");
  });

  it("réponses visibles par le joueur seul", () => {
    expect(voteReply(choice(), [2])).toBe("✅ Ton vote : **Stratholme \\(vivants\\)**. Clique un autre choix pour changer d'avis, ou le même pour le retirer.");
    expect(voteReply(choice({ multi: true }), [1, 3])).toBe("✅ Tes choix : **Scholomance**, **Pic Rochenoire**. Chaque clic sur un choix le coche ou le décoche.");
    expect(voteReply(choice(), [])).toBe("Tu n'as pas (ou plus) de vote : clique un choix du sondage.");
    const who = votersReply(choice({ anonymous: false }), {
      options: [{ id: 1, yes: [{ name: "Kaelys", role: "Heal", guest: false }, { name: "Passant", role: null, guest: true }], maybe: [] }], none: [],
    });
    expect(who).toBe("**Quel donjon jeudi soir ?**\n\n1️⃣ **Scholomance** (2) : Kaelys, Passant ✱\n2️⃣ **Stratholme \\(vivants\\)** (0)\n3️⃣ **Pic Rochenoire** (0)\n4️⃣ **Hache\\-Tripes** (0)\n\n-# ✱ a répondu depuis Discord, sans compte du site");
    const c = closeConfirm(choice());
    expect(c.content).toBe("Clore le sondage « Quel donjon jeudi soir ? » ? Les votes s'arrêtent et les résultats restent affichés.");
    expect(decodePollId(buttons(c)[0]!.custom_id!)).toEqual({ a: "closeok", pollId: ID });
  });
});

describe("message d'un sondage de disponibilités", () => {
  it("un créneau par ligne (Oui, Si besoin, Non), ★ et rôles sur le meilleur, boutons", () => {
    const p = renderPoll(dates());
    expect(p.embeds[0]!.description).toBe([
      "*Posé par Sleyvazh · coche tous les soirs où tu peux venir · se termine dimanche 29/11 à 20:00*", "",
      "**Mardi 01/12 · 21:00**  ✅ 11 · 🤔 3 · ❌ 4",
      "★ **Mercredi 02/12 · 21:00**  ✅ 15 · 🤔 1 · ❌ 2 · 2 tanks, 4 heals",
      "**Jeudi 03/12 · 21:00**  ✅ 9 · 🤔 4 · ❌ 5",
    ].join("\n"));
    expect(p.embeds[0]!.footer!.text).toBe("18 réponses · ★ meilleur créneau (le plus de « Oui », puis de « Si besoin »)");
    const b = buttons(p);
    expect(b.map(x => `${x.label}${x.disabled ? " (grisé)" : ""}`)).toEqual(["Mes disponibilités", "Qui a répondu ?", "Créer le raid sur ★", "Clore", "Sur le site"]);
    // Sans aucun « Oui » : pas de ★, bouton du raid grisé ; raid créé : lien vers le raid
    expect(buttons(renderPoll(dates({ best: null })))[2]).toMatchObject({ disabled: true });
    const done = renderPoll(dates({ closedAt: "2026-11-27T10:00:00.000Z", raid: { id: "r", name: "Onyxia", scheduledAt: slot("2026-12-02T20:00:00Z"), url: "https://x.test/r" } }));
    expect(done.embeds[0]!.description).toContain("🗓️ Raid créé : [Onyxia · Mercredi 02/12 · 21:00](https://x.test/r)");
    expect(buttons(done).map(x => x.label)).toEqual(["Qui a répondu ?", "Voir le raid", "Sur le site"]);
  });

  it("« Mes disponibilités » : deux menus cochés comme le vote ; « Qui a répondu ? »", () => {
    const p = datesPanel(dates(), { yes: [1, 2], maybe: [3] }, { name: "Tournicoti", role: "Tank", guest: false }, "fr", true);
    expect(p.content).toBe("**Tes disponibilités** · avec **Tournicoti**\n✅ Je viens : Mardi 01/12 · 21:00, Mercredi 02/12 · 21:00\n🤔 Si besoin : Jeudi 03/12 · 21:00\n-# Enregistré. Les créneaux non cochés comptent « Non ».");
    const [yes, maybe] = p.components.map(r => r.components[0] as { custom_id: string; min_values: number; max_values: number; options: { value: string; default: boolean; label: string }[] });
    expect(decodePollId(yes!.custom_id)).toEqual({ a: "yes", pollId: ID });
    expect(decodePollId(maybe!.custom_id)).toEqual({ a: "maybe", pollId: ID });
    expect(yes!.options.filter(o => o.default).map(o => o.value)).toEqual(["1", "2"]);
    expect(maybe!.options.filter(o => o.default).map(o => o.value)).toEqual(["3"]);
    expect([yes!.min_values, yes!.max_values]).toEqual([0, 3]);
    expect(datesPanel(dates(), null, { name: "Passant", role: null, guest: true }).content.split("\n")[0]).toBe("**Tes disponibilités** (sans compte : sous ton pseudo Discord)");
    const who = votersReply(dates(), { options: [{ id: 2, yes: [{ name: "Bramm", role: "Tank", guest: false }], maybe: [{ name: "Kaelys", role: "Heal", guest: false }] }], none: [{ name: "Nyx", role: null, guest: false }] });
    expect(who).toBe("**Quel soir pour Onyxia ?**\n\n**Mardi 01/12 · 21:00**\n✅ —\n**Mercredi 02/12 · 21:00**\n✅ Bramm\n🤔 Kaelys\n**Jeudi 03/12 · 21:00**\n✅ —\n❌ Aucun créneau : Nyx");
  });

  it("« Créer le raid sur ★ » : fenêtre préremplie (nom, meilleur créneau) ; réponse", () => {
    const m = raidModal(dates());
    expect(decodePollId(m.custom_id)).toEqual({ a: "raidmodal", pollId: ID });
    const fields = m.components.map(r => (r as { components: { custom_id: string; value?: string }[] }).components[0]!);
    expect(fields.map(f => [f.custom_id, f.value])).toEqual([["name", "Onyxia"], ["slot", "Mercredi 02/12 · 21:00"]]);
    expect(raidCreatedReply({ raid: { name: "Onyxia", scheduledAt: slot("2026-12-02T20:00:00Z"), url: "https://x.test/r" }, hasChannel: true }, "fr"))
      .toBe("✅ Raid **Onyxia** créé : Mercredi 02/12 · 21:00. Son annonce arrive dans le salon des raids ; le sondage est clos. [Voir sur le site](<https://x.test/r>)");
  });
});

describe("fenêtres de /sondage et /dispos", () => {
  const choiceAction = { a: "new", kind: "choice", anonymous: true, multi: false, results: "live" } as const;
  it("champs, saisie gardée pour « Corriger »", () => {
    const m = createModal(choiceAction, "fr");
    expect(m.title).toBe("Nouveau sondage");
    expect(decodePollId(m.custom_id)).toEqual(choiceAction);
    const ids = (x: typeof m) => x.components.map(r => (r as { components: { custom_id: string; label: string; required: boolean; value?: string }[] }).components[0]!);
    expect(ids(m).map(f => `${f.custom_id}:${f.label}${f.required ? "" : " (facultatif)"}`)).toEqual(["question:Question", "options:Choix (un par ligne, 2 à 10)", "end:Fin (facultatif) (facultatif)"]);
    const d = createModal({ a: "new", kind: "dates" }, "fr", { action: { a: "new", kind: "dates" }, question: "Quel soir ?", options: "mardi 21h", end: "", raidName: "Onyxia" });
    expect(ids(d).map(f => [f.custom_id, f.value ?? null])).toEqual([["question", "Quel soir ?"], ["options", "mardi 21h"], ["raid", "Onyxia"], ["end", null]]);
    for (const f of [...ids(m), ...ids(d)]) expect(f.label.length).toBeLessThanOrEqual(45);
  });

  it("lecture : choix, fin, erreurs par ligne ; créneaux en heure de Paris", () => {
    const draft = (options: string, end = "", question = "Quel donjon ?") => ({ action: choiceAction, question, options, end, raidName: "" });
    const ok = parseDraft(draft("Scholomance\n\n  Stratholme  \n", "2j"), NOW, TZ, "fr");
    expect(ok).toEqual({ ok: true, body: { kind: "choice", question: "Quel donjon ?", options: [{ label: "Scholomance" }, { label: "Stratholme" }], multi: false, anonymous: true, results: "live", closesAt: "2026-11-28T18:42:00.000Z" } });
    expect(parseDraft(draft("Scholomance"), NOW, TZ, "fr")).toEqual({ ok: false, error: "Propose au moins 2 choix, un par ligne." });
    expect(parseDraft(draft("A\nB\na"), NOW, TZ, "fr")).toEqual({ ok: false, error: "Ligne 3 : ce choix est déjà dans la liste." });
    expect(parseDraft(draft("A\nB", "mercredi"), NOW, TZ, "fr")).toEqual({ ok: false, error: "Fin « mercredi » : date ou heure illisible (ex. mardi 01/12 21:00, mercredi 21h)." });
    expect(parseDraft(draft("A\nB", "", "  "), NOW, TZ, "fr")).toEqual({ ok: false, error: "Écris la question du sondage." });
    const d = (options: string, end = "") => parseDraft({ action: { a: "new", kind: "dates" }, question: "Quel soir ?", options, end, raidName: " Onyxia " }, NOW, TZ, "fr");
    const r = d("mardi 01/12 21:00\nmercredi 21h\njeudi 19h");
    expect(r).toEqual({ ok: true, body: { kind: "dates", question: "Quel soir ?", raidName: "Onyxia", closesAt: null, options: [
      { label: "mardi 01/12 21:00", at: "2026-12-01T20:00:00.000Z" }, { label: "mercredi 21h", at: "2026-12-02T20:00:00.000Z" }, { label: "jeudi 19h", at: "2026-12-03T18:00:00.000Z" },
    ] } });
    expect(d("mardi 21h\nmerc 21h")).toEqual({ ok: false, error: "Ligne 2 « merc 21h » : date ou heure illisible (ex. mardi 01/12 21:00, mercredi 21h)." });
    expect(d("mardi 21h\n01/12 21:00")).toEqual({ ok: false, error: "Ligne 2 : ce créneau est déjà dans la liste." });
    expect(d("mardi 21h\nmercredi 21h", "dimanche 06/12 20:00")).toEqual({ ok: false, error: "La fin du sondage tombe après le dernier créneau." });
    expect(parseDraft({ action: { a: "new", kind: "dates" }, question: "Which evening?", options: "tuesday 9pm\nnope", end: "", raidName: "" }, NOW, TZ, "en"))
      .toEqual({ ok: false, error: "Line 2 “nope”: unreadable date or time (e.g. tuesday 01/12 21:00, wednesday 9pm)." });
  });
});
