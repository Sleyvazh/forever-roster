import { addonExport, buildRRR, fullName, inviteMacros, retailRoleOf, roleOf, rosterInviteMacros, type ExportMember, type RetailDifficulty, type RosterExportMember } from "@forever/game-data";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Character, RaidSignup, RaidSlot } from "../api";
import { t, tx } from "../i18n";

/**
 * Export du raid pour l'addon (format FRR v1, voir docs/addon-format.md) et macros « /inv ».
 * Roster (WoW Retail) : format RRR v1 de l'addon Roster, noms « Prénom-Royaume », macros « /inv Prénom-Royaume ».
 * Calculé dans le navigateur à partir de la compo affichée (y compris les changements non encore enregistrés).
 */
export function RaidExport({ raid, slots, chars, signups, retail }: {
  raid: { id: string; name: string; scheduledAt: string | null; difficulty?: RetailDifficulty | null; size?: number };
  slots: RaidSlot[]; chars: Map<string, Character>; signups: RaidSignup[];
  /** Raid de Roster (WoW Retail) : export pour l'addon Roster. */
  retail?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const byChar = new Map(signups.filter(s => s.characterId).map(s => [s.characterId!, s]));
  const members: RosterExportMember[] = [];
  const byId = new Map(signups.map(s => [s.id, s]));
  const placedSignups = new Set<string>();
  const role = (cls: string, spec: string | null) => (retail ? retailRoleOf(cls, spec) ?? roleOf(spec) : roleOf(spec));
  for (const s of slots) {
    if (s.signupId) {
      // Inscrit sans compte placé dans la compo
      const su = byId.get(s.signupId);
      if (!su || su.userId) continue;
      placedSignups.add(su.id);
      members.push({ name: su.displayName, realm: null, cls: su.cls, spec: su.spec || null, role: su.role, group: s.group, pos: s.pos, status: su.status, source: "discord" });
      continue;
    }
    const c = chars.get(s.characterId!);
    if (!c) continue;
    const su = byChar.get(c.id);
    if (su) placedSignups.add(su.id);
    const spec = su?.spec || c.spec1 || null;
    members.push({ name: c.name, realm: c.realm, cls: c.cls, spec, role: role(c.cls, spec), group: s.group, pos: s.pos, status: su?.status ?? null, source: "site" });
  }
  for (const su of signups) {
    if (su.status === "absent" || placedSignups.has(su.id)) continue;
    const realm = su.characterRealm ?? (su.characterId ? chars.get(su.characterId)?.realm : null) ?? null;
    members.push({
      name: su.characterName ?? su.displayName, realm, cls: su.cls, spec: su.spec || null, role: su.role, group: 0, pos: 0, status: su.status,
      source: su.userId ? "site" : "discord",
    });
  }
  const text = retail
    ? buildRRR({ id: raid.id, name: raid.name, scheduledAt: raid.scheduledAt, difficulty: raid.difficulty ?? null, size: raid.size ?? 0 }, members)
    : addonExport(raid, members.map(({ realm: _realm, ...m }): ExportMember => m));
  // Invitations : persos placés du site seulement (le pseudo Discord d'un inscrit sans compte n'est pas un nom de perso)
  const placed = members.filter(m => m.group > 0 && m.source === "site").sort((a, b) => a.group - b.group || a.pos - b.pos);
  const macros = retail ? rosterInviteMacros(placed.map(m => fullName(m.name, m.realm))) : inviteMacros(placed.map(m => m.name));
  const guestsPlaced = members.filter(m => m.group > 0 && m.source === "discord").map(m => m.name);

  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(key); window.setTimeout(() => setCopied(null), 1500); }, () => setCopied(null));
  };

  return (
    <details className="panel pad export">
      <summary><h3 style={{ display: "inline", margin: 0 }}>{t("Export pour le jeu")}</h3> <span className="muted small">{t("addon et macros d'invitation")}</span></summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="fld">
          <div className="row between"><label htmlFor="ex-addon">{retail ? t("Texte pour l'addon Roster (format RRR v1)") : t("Texte pour l'addon Forever Roster (format FRR v1)")}</label>
            <button className="btn sm" type="button" onClick={() => copy("addon", text)}>{copied === "addon" ? t("Copié") : t("Copier")}</button></div>
          <textarea id="ex-addon" readOnly className="num" rows={Math.min(12, text.split("\n").length)} value={text} onFocus={e => e.currentTarget.select()} />
          {retail
            ? <p className="hint" style={{ margin: 0 }}>{tx("Pour le chef de raid. Placés (groupe 1 à 8), puis inscrits non placés (groupe 0), chacun en {format}. En jeu : {cmd}, onglet {sync} (ou {compo}), colle ce texte, puis invite et place les groupes depuis l'onglet {compo}. Raids à venir et inscriptions : {copy}, en haut de la page (voir la page {addon}).", {
                format: <code>{t("Prénom-Royaume")}</code>, cmd: <code>/roster</code>, sync: <strong>{t("Synchro")}</strong>, compo: <strong>{t("Compo")}</strong>,
                copy: <strong>{t("Copier pour le jeu")}</strong>, addon: <Link to="/addon">{t("Addon")}</Link> })}</p>
            : <p className="hint" style={{ margin: 0 }}>{tx("Placés (groupe 1 à 8), puis inscrits non placés (groupe 0). En jeu : {cmd}, onglet {compo}, colle ce texte, « Charger », puis « Inviter » et « Placer les groupes ». Seul le prénom est envoyé (le jeu ignore le nom de famille). Inscriptions et patrons suivis : page {addon}.", {
                cmd: <code>/fr</code>, compo: <strong>{t("Compo")}</strong>, addon: <Link to="/addon">{t("Addon")}</Link> })}</p>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">{t("Macros d'invitation ({n})", { n: macros.length })}</span>
          {macros.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{t("Place des persos dans la compo pour générer les macros.")}</p> : macros.map((m, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start" }}>
              <textarea readOnly aria-label={t("Macro d'invitation {n}", { n: i + 1 })} className="num" rows={Math.min(8, m.split("\n").length)} value={m} style={{ flex: 1 }} onFocus={e => e.currentTarget.select()} />
              <button className="btn sm" type="button" onClick={() => copy(`m${i}`, m)}>{copied === `m${i}` ? t("Copié") : t("Copier")}</button>
            </div>
          ))}
          {guestsPlaced.length > 0 && <p className="hint" style={{ margin: 0 }}>{t("À inviter à la main (inscrits sans compte, pseudo Discord) : {names}.", { names: guestsPlaced.join(", ") })}</p>}
          {macros.length > 0 && <p className="hint" style={{ margin: 0 }}>{t("Une macro WoW fait 255 caractères au plus : colle chacune dans une macro (Échap → Macros), puis clique-les une à une.")}</p>}
        </div>
      </div>
    </details>
  );
}
