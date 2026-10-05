import { describe, expect, it } from "vitest";
import { COMMANDS } from "../src/commands";
import {
  authorReplyInbox, checkText, Cooldown, decodeFb, encodeFb, inboxMessage, MAX_TEXT, panelMessage, previewMessage, promptMessage,
  replyLog, SESSION_MS, Sessions, teamReplyDm, writeModal, type Session,
} from "../src/feedback-core";

const GUILD = "900000000000000001";
const USER = "900000000000000030";
const ID = "0b6f6f3e-3d0a-4a1e-9a55-2f1f1d2c3b4a";

const clock = (t = 1_000_000) => { const c = { t, now: () => c.t }; return c; };
const base = { guildId: GUILD, guildName: "Les Lanternes", allowAnonymous: true, name: "Aldric", avatarUrl: "https://cdn.test/a.png" };
const json = (x: unknown) => JSON.stringify(x);

describe("avis : identifiants des boutons", () => {
  it("aller-retour et refus des identifiants forgés", () => {
    for (const x of [{ a: "open" }, { a: "sign", guildId: GUILD }, { a: "anon", guildId: GUILD }, { a: "reply", id: ID }, { a: "bmodal", id: ID }] as const) {
      expect(decodeFb(encodeFb(x))).toEqual(x);
    }
    expect(encodeFb({ a: "open" })).toBe("fb|open");
    for (const bad of ["fb|sign|abc", "fb|reply|" + GUILD, "fb|open|x", "fr|sign|" + GUILD, "fb|sign|" + GUILD + "|x", "fb|zzz|" + GUILD]) {
      expect(decodeFb(bad)).toBeNull();
    }
    expect(encodeFb({ a: "rmodal", id: ID }).length).toBeLessThanOrEqual(100);
  });
});

describe("avis : session et limites", () => {
  it("une session par personne, expirée après 15 min, liée au serveur", () => {
    const c = clock();
    const s = new Sessions(c.now);
    s.start(USER, base);
    expect(s.get(USER, GUILD)?.text).toBeNull();
    expect(s.get(USER, "900000000000000002")).toBeNull();
    expect(s.setText(USER, "Merci pour le raid")?.text).toBe("Merci pour le raid");
    c.t += SESSION_MS + 1;
    expect(s.get(USER)).toBeNull();
    expect(s.setText(USER, "trop tard")).toBeNull();
  });

  it("1 avis par minute, 5 par heure", () => {
    const c = clock();
    const cd = new Cooldown(c.now);
    expect(cd.wait(USER)).toBe(0);
    cd.hit(USER);
    expect(cd.wait(USER)).toBe(1);
    for (let k = 0; k < 4; k++) { c.t += 61e3; expect(cd.wait(USER)).toBe(0); cd.hit(USER); }
    c.t += 61e3;
    expect(cd.wait(USER)).toBeGreaterThan(1);
    c.t += 3600e3;
    expect(cd.wait(USER)).toBe(0);
  });

  it("texte : vide, trop long, fichiers joints", () => {
    expect(checkText("   ")).toMatchObject({ ok: false });
    expect(checkText("", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/texte/) });
    expect(checkText("x".repeat(MAX_TEXT + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/trop long/) });
    expect(checkText("  Super soirée  ", 2)).toEqual({ ok: true, text: "Super soirée", note: expect.stringMatching(/pas transmis/) });
  });
});

describe("avis : messages", () => {
  it("anonyme : rien de l'auteur dans le message de l'équipe", () => {
    const anon = json(inboxMessage(ID, "Les pulls sont trop rapides", null));
    expect(anon).toContain("Anonyme");
    expect(anon).not.toContain(USER);
    expect(anon).not.toContain("Aldric");
    expect(anon).not.toContain("cdn.test");
    expect(anon).toContain(`fb|reply|${ID}`);
    // Réponse de l'auteur anonyme : toujours sans nom
    expect(json(authorReplyInbox(ID, "Merci", null))).not.toContain(USER);

    const signed = json(inboxMessage(ID, "Top", { id: USER, name: "Aldric", avatarUrl: "https://cdn.test/a.png" }));
    expect(signed).toContain(`<@${USER}>`);
    expect(signed).toContain("Aldric");
  });

  it("aucune mention ne notifie personne", () => {
    for (const m of [panelMessage(true), promptMessage(base), inboxMessage(ID, "@everyone", null), replyLog("Bob", "ok", true), teamReplyDm(ID, "G", "Bob", "ok", null)]) {
      expect(m.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("aperçu : bouton anonyme seulement si le serveur l'autorise", () => {
    const s = { ...base, text: "Idée : un raid le dimanche", expiresAt: 0 } as Session & { text: string };
    expect(json(previewMessage(s))).toContain(`fb|anon|${GUILD}`);
    const signedOnly = json(previewMessage({ ...s, allowAnonymous: false }));
    expect(signedOnly).not.toContain("fb|anon|");
    expect(signedOnly).toContain(`fb|sign|${GUILD}`);
    expect(json(panelMessage(false))).toContain("signés");
  });

  it("fenêtre d'écriture : titre de 45 caractères au plus", () => {
    expect(writeModal(GUILD, "Un nom de serveur vraiment très très long pour tester").title.length).toBeLessThanOrEqual(45);
  });

  it("commandes : /feedback pour tous, /feedback-config réservé à « Gérer le serveur »", () => {
    const fb = COMMANDS.find(c => c.name === "feedback");
    const cfg = COMMANDS.find(c => c.name === "feedback-config");
    expect(fb?.default_member_permissions).toBeUndefined();
    expect(cfg?.default_member_permissions).toBe("32");
    for (const c of COMMANDS) expect(c.description.length).toBeLessThanOrEqual(100);
  });
});
