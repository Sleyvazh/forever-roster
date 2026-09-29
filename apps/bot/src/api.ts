import type { Role, SignupStatus } from "@forever/game-data";

/** Client de l'API interne du site (réseau Docker uniquement, secret partagé). */

export interface ViewSignup {
  displayName: string; characterName: string | null; cls: string; spec: string; role: Role | null;
  status: SignupStatus; note: string; guest: boolean;
  /** Groupe dans la compo (null : pas placé). */
  group: number | null;
}
export interface RosterMember { name: string; cls: string; spec: string; role: Role | null }
export interface RaidView {
  raid: { id: string; name: string; description: string; scheduledAt: string | null; url: string; changedAt: string };
  group: { id: string; name: string };
  channelId: string;
  messageId: string | null;
  signups: ViewSignup[];
  /** Compo validée par un officier (null tant qu'elle n'est pas publiée). */
  roster: { groups: { group: number; members: RosterMember[] }[] } | null;
}
export interface Recipient { discordUserId: string; status: SignupStatus; name: string; cls: string; spec: string; guest: boolean; group: number | null }
export interface Reminder { view: RaidView; recipients: Recipient[] }
export interface Current { status: SignupStatus; characterId: string | null; cls: string; spec: string }
export interface ChoiceChar { id: string; name: string; cls: string; spec1: string; spec2: string; specs: { name: string; role: Role }[] }
export type Choices =
  | { mode: "member"; linked: true; current: Current | null; characters: ChoiceChar[] }
  | { mode: "guest"; linked: boolean; current: Current | null };
export interface SignupBody { status: SignupStatus; characterId?: string | null; cls?: string; spec?: string }
export interface Deletion { id: number; channelId: string; messageId: string }

/** Erreur renvoyée par le site ; `message` peut être montré tel quel au joueur. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class InternalApi {
  constructor(private readonly base: string, private readonly secret: string, private readonly f: typeof fetch = fetch) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(503, "Le site ne répond pas, réessaie dans un instant.");
    }
    const data = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 || !data.error ? "Le site ne répond pas, réessaie dans un instant." : data.error);
    return data as T;
  }

  bind(b: { code: string; guildId: string; channelId: string; discordUserId: string }) {
    return this.req<{ group: { id: string; name: string } }>("POST", "/internal/discord/bind", b);
  }
  createRaid(b: { guildId: string; channelId: string; discordUserId: string; name: string; scheduledAt: string; description?: string }) {
    return this.req<RaidView>("POST", "/internal/discord/raids", b);
  }
  outbox() { return this.req<{ raids: RaidView[]; deletions: Deletion[] }>("GET", "/internal/discord/outbox"); }
  published(raidId: string, b: { channelId: string; messageId: string; changedAt: string }) {
    return this.req<{ ok: true }>("POST", `/internal/discord/raids/${raidId}/published`, b);
  }
  claimReminders() { return this.req<{ reminders: Reminder[] }>("POST", "/internal/discord/reminders/claim", {}); }
  deletionDone(id: number) { return this.req<{ ok: true }>("DELETE", `/internal/discord/deletions/${id}`); }
  view(raidId: string) { return this.req<RaidView>("GET", `/internal/discord/raids/${raidId}/view`); }
  choices(raidId: string, discordUserId: string) {
    return this.req<Choices>("GET", `/internal/discord/raids/${raidId}/choices?discordUserId=${encodeURIComponent(discordUserId)}`);
  }
  signup(raidId: string, b: SignupBody & { discordUserId: string; discordName: string }) {
    return this.req<RaidView>("POST", `/internal/discord/raids/${raidId}/signup`, b);
  }
  unsign(raidId: string, discordUserId: string) {
    return this.req<RaidView>("DELETE", `/internal/discord/raids/${raidId}/signup/${discordUserId}`);
  }
}
