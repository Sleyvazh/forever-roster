import { addonExport, inviteMacros, roleOf, type ExportMember } from "@forever/game-data";
import { useState } from "react";
import type { Character, RaidSignup, RaidSlot } from "../api";

/**
 * Export du raid pour l'addon (format FRR v1, voir docs/addon-format.md) et macros « /inv ».
 * Calculé dans le navigateur à partir de la compo affichée (y compris les changements non encore enregistrés).
 */
export function RaidExport({ raid, slots, chars, signups }: {
  raid: { id: string; name: string; scheduledAt: string | null };
  slots: RaidSlot[]; chars: Map<string, Character>; signups: RaidSignup[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const byChar = new Map(signups.filter(s => s.characterId).map(s => [s.characterId!, s]));
  const members: ExportMember[] = [];
  const byId = new Map(signups.map(s => [s.id, s]));
  const placedSignups = new Set<string>();
  for (const s of slots) {
    if (s.signupId) {
      // Inscrit sans compte placé dans la compo
      const su = byId.get(s.signupId);
      if (!su || su.userId) continue;
      placedSignups.add(su.id);
      members.push({ name: su.displayName, cls: su.cls, spec: su.spec || null, role: su.role, group: s.group, pos: s.pos, status: su.status, source: "discord" });
      continue;
    }
    const c = chars.get(s.characterId!);
    if (!c) continue;
    const su = byChar.get(c.id);
    if (su) placedSignups.add(su.id);
    const spec = su?.spec || c.spec1 || null;
    members.push({ name: c.name, cls: c.cls, spec, role: roleOf(spec), group: s.group, pos: s.pos, status: su?.status ?? null, source: "site" });
  }
  for (const su of signups) {
    if (su.status === "absent" || placedSignups.has(su.id)) continue;
    members.push({
      name: su.characterName ?? su.displayName, cls: su.cls, spec: su.spec || null, role: su.role, group: 0, pos: 0, status: su.status,
      source: su.userId ? "site" : "discord",
    });
  }
  const text = addonExport(raid, members);
  // Invitations : persos placés du site seulement (le pseudo Discord d'un inscrit sans compte n'est pas un nom de perso)
  const macros = inviteMacros(members.filter(m => m.group > 0 && m.source === "site").map(m => m.name));
  const guestsPlaced = members.filter(m => m.group > 0 && m.source === "discord").map(m => m.name);

  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value).then(() => { setCopied(key); window.setTimeout(() => setCopied(null), 1500); }, () => setCopied(null));
  };

  return (
    <details className="panel pad export">
      <summary><h3 style={{ display: "inline", margin: 0 }}>Export pour le jeu</h3> <span className="muted small">addon et macros d'invitation</span></summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="fld">
          <div className="row between"><label htmlFor="ex-addon">Texte pour l'addon Forever Roster (format FRR v1)</label>
            <button className="btn sm" type="button" onClick={() => copy("addon", text)}>{copied === "addon" ? "Copié" : "Copier"}</button></div>
          <textarea id="ex-addon" readOnly className="num" rows={Math.min(12, text.split("\n").length)} value={text} onFocus={e => e.currentTarget.select()} />
          <p className="hint" style={{ margin: 0 }}>Placés (groupe 1 à 8), puis inscrits non placés (groupe 0). À coller dans l'addon quand il sera prêt.</p>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span className="lbl">Macros d'invitation ({macros.length})</span>
          {macros.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Place des persos dans la compo pour générer les macros.</p> : macros.map((m, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start" }}>
              <textarea readOnly aria-label={`Macro d'invitation ${i + 1}`} className="num" rows={Math.min(8, m.split("\n").length)} value={m} style={{ flex: 1 }} onFocus={e => e.currentTarget.select()} />
              <button className="btn sm" type="button" onClick={() => copy(`m${i}`, m)}>{copied === `m${i}` ? "Copié" : "Copier"}</button>
            </div>
          ))}
          {guestsPlaced.length > 0 && <p className="hint" style={{ margin: 0 }}>À inviter à la main (inscrits sans compte, pseudo Discord) : {guestsPlaced.join(", ")}.</p>}
          {macros.length > 0 && <p className="hint" style={{ margin: 0 }}>Une macro WoW fait 255 caractères au plus : colle chacune dans une macro (Échap → Macros), puis clique-les une à une.</p>}
        </div>
      </div>
    </details>
  );
}
