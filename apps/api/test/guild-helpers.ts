import type { GuildMembersResponse, GuildRaceResponse } from "@forever/game-data";
import { expect } from "vitest";
import { signedIn, tokenFrom, type TestEnv } from "./helpers";

/** Lot « Guilde » : relevés FRL et en-têtes FRC comme l'addon 1.6.2 les écrit, guilde du site de test. Noms inventés. */

export const DAY = 86400, HOUR = 3600;
export const NOW = () => Math.floor(Date.now() / 1000);
let n = 0;
export const guid = () => `Player-4620-${(++n).toString(16).toUpperCase().padStart(8, "0")}`;
export type Signed = Awaited<ReturnType<typeof signedIn>>;
export interface M { name: string; cls?: string; level: number; rank?: string; ri?: number; online?: boolean; hours?: number | null; note?: string; onote?: string; guid: string }
export const m = (name: string, level: number, more: Partial<M> = {}): M => ({ name, level, guid: guid(), ...more });

/** Bloc FRL comme l'addon 1.6.2 l'écrit (docs/addon-format.md). */
export function frl(o: { guild?: string; at: number; by?: string; officer?: boolean; total?: number; members?: M[]; journal?: { at: number; events: (string | number)[][] }; xp?: (string | number)[][]; levels?: (string | number)[][] }) {
  const members = o.members ?? [];
  const lines = [
    ...members.map(x => ["M", x.name, (x.cls ?? "WARRIOR").toUpperCase(), x.level, x.rank ?? "Membre", x.ri ?? 3, x.online ? 1 : 0, x.online ? 0 : x.hours === null ? "" : x.hours ?? 2, x.note ?? "", x.onote ?? "", x.guid].join(";")),
    ...(o.journal ? [`J;${o.journal.at};${o.by ?? "Morwen Cendrevoile"}`, ...o.journal.events.map(e => ["E", ...e].join(";"))] : []),
    ...(o.xp ?? []).map(x => ["P", ...x].join(";")),
    ...(o.levels ?? []).map(x => ["U", ...x].join(";")),
  ];
  return [`FRL;1;${o.guild ?? "Les Lanternes"};Horde;${o.at};${o.by ?? "Morwen Cendrevoile"};${o.officer === false ? 0 : 1};Officier;${o.total ?? members.length};Forever EU;1.6.2`, ...lines, `END;${lines.length}`].join("\n");
}
/** En-tête FRC : nouveau (GUID et nom complet) ou ancien (addon 1.6.1). */
export const frc = (first: string, cls: string, race: string, level: number, g?: string, full?: string) =>
  `FRC;2;${first};Forever EU;${cls};${race};${level};Horde;1790000000;${g ? `1.6.2;${g};${full ?? ""}` : "1.6.1"}\nEND;0`;
export const paste = async (s: Signed, text: string, extra: object = {}) => {
  const r = await s.c.post("/api/addon/import", { text, ...extra });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { results: { kind: string; status: string; message: string; name: string; groups?: { id: string; name: string }[]; nameConflict?: object; characterId?: string }[]; errors: string[] };
};

/** Guilde du site (Forever) : un propriétaire et des membres. */
export async function scene(env: TestEnv, name: string, others: string[] = []) {
  const slug = name.replace(/[^A-Za-z]/g, "");
  const owner = await signedIn(env, `${slug}Chef`);
  const g = (await owner.c.post("/api/groups", { name })).json().group as { id: string; name: string };
  const inv = (await owner.c.post(`/api/groups/${g.id}/invites`, { maxUses: 20, expiresInHours: 24 })).json().invite;
  const p: Record<string, Signed> = {};
  for (const o of others) {
    const s = await signedIn(env, `${slug}${o}`);
    await s.c.post("/api/groups/invites/accept", { token: tokenFrom(inv.url) });
    p[o] = s;
  }
  const get = async <T>(s: Signed, path: string) => { const r = await s.c.get(`/api/groups/${g.id}${path}`); expect(r.statusCode, r.body).toBe(200); return r.json() as T; };
  return {
    owner, g, p, get,
    guild: (s: Signed = owner) => get<GuildMembersResponse>(s, "/guild"),
    race: (s: Signed = owner) => get<GuildRaceResponse>(s, "/guild/race"),
    promote: (o: string) => owner.c.patch(`/api/groups/${g.id}/members/${p[o]!.user.id}`, { role: "officer" }),
  };
}
