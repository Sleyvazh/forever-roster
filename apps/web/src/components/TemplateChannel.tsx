import type { LootMode, RetailDifficulty } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { del, get, patch, post } from "../api";
import { useMe } from "../auth";
import { useSite } from "../site";
import { LinkCodeBox } from "./DiscordLink";

/**
 * Salon Discord d'un raid récurrent, réglé au même endroit dans l'onglet Raids (« ↻ Récurrents »)
 * et dans Administration → Discord et relances.
 */

/** Salon Discord d'un raid récurrent : celui du groupe (linked = false) ou un salon à part, renommé avec la date du raid courant. */
export interface TemplateDiscord { linked: boolean; channelName: string | null; rename: boolean; renameError: string | null }
export interface RaidTemplate {
  id: string; name: string; description: string; weekday: number; time: string; leadDays: number; active: boolean; lootMode: LootMode; srHidden: boolean; size: number;
  difficulty?: RetailDifficulty | null; discord: TemplateDiscord;
}
type Guard = (fn: () => Promise<unknown>) => Promise<void>;

/** Raids récurrents du groupe (même requête aux deux endroits ; les événements en direct la rafraîchissent). */
export function useRaidTemplates(groupId: string) {
  return useQuery({ queryKey: ["raid-templates", groupId], queryFn: () => get<{ templates: RaidTemplate[] }>(`/groups/${groupId}/raid-templates`) });
}

/**
 * Salon Discord d'un raid récurrent : celui du groupe, ou un salon à part (lié par code comme celui du groupe) que le bot
 * renomme chaque semaine avec la date du raid courant (ex. jeudi-15-10). Les raids ponctuels restent dans le salon du groupe.
 */
export function TemplateChannel({ groupId, t, canEdit, guard, refresh, groupLinked }: {
  groupId: string; t: Pick<RaidTemplate, "id" | "name" | "discord">; canEdit: boolean; guard: Guard; refresh: () => Promise<unknown>; groupLinked: boolean;
}) {
  const game = useSite().game;
  const me = useMe();
  const hasDiscord = !!me.data?.user?.discordUsername;
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [wantCode, setWantCode] = useState(false);
  const d = t.discord;
  // Salon lié (ou changé) depuis Discord : le code a servi
  useEffect(() => { setCode(null); setWantCode(false); }, [d.linked, d.channelName]);
  const askCode = () => {
    setWantCode(true);
    if (hasDiscord) void guard(async () => { setCode(await post<{ code: string; expiresAt: string }>(`/groups/${groupId}/raid-templates/${t.id}/discord/code`)); });
  };
  return (
    <div className="stack" style={{ flexBasis: "100%", gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="small"><span className="muted">Salon Discord :</span>{" "}
          {d.linked ? <><b>{d.channelName ? `#${d.channelName}` : "salon à part"}</b> <span className="muted">(à part)</span></>
            : <>celui du groupe{!groupLinked && <span className="muted"> (aucun salon lié pour l'instant)</span>}</>}</span>
        {canEdit && <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn ghost sm" onClick={askCode}>{d.linked ? "Changer de salon…" : "Salon à part…"}</button>
          {d.linked && <button type="button" className="btn ghost sm" onClick={() => void guard(async () => { await del(`/groups/${groupId}/raid-templates/${t.id}/discord`); await refresh(); })}>Revenir au salon du groupe</button>}
        </span>}
      </div>
      {canEdit && (d.linked || code) && (
        <label className="gr-tog" style={{ paddingTop: 0 }}>
          <input type="checkbox" checked={d.rename} onChange={e => { const discordRename = e.target.checked; void guard(async () => { await patch(`/groups/${groupId}/raid-templates/${t.id}`, { discordRename }); await refresh(); }); }} />
          <i aria-hidden="true" />Renommer le salon avec la date du prochain raid (ex. jeudi-15-10)
        </label>
      )}
      {canEdit && d.linked && d.renameError && <span className="small"><span role="alert" style={{ color: "var(--bad)" }}>{d.renameError}</span> <span className="muted">Le bot réessaie toutes les heures.</span></span>}
      {canEdit && d.linked && d.rename && !d.renameError && <span className="hint">Le bot a besoin de « Gérer les salons » sur ce salon.</span>}
      {canEdit && wantCode && !hasDiscord && <div className="alert info">Pour lier un salon, lie d'abord ton propre Discord dans <Link to="/account">Compte &amp; sécurité</Link> : le bot vérifie que c'est bien un officier qui tape la commande.</div>}
      {code && <LinkCodeBox key={code.code} game={game} code={code} intro={`Dans le salon Discord voulu pour « ${t.name} », tape cette commande`} label={`Commande de liaison du salon pour « ${t.name} »`}
        footer={<span className="small muted">Ce salon recevra les annonces de ce raid récurrent seulement (les raids ponctuels restent dans le salon du groupe). Pour le renommer, le bot a besoin de « Gérer les salons » sur ce salon.</span>} />}
    </div>
  );
}
