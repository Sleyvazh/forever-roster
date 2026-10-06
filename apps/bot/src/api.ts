import type { Game, Role, SignupStatus } from "@forever/game-data";

/** Client de l'API interne du site (réseau Docker uniquement, secret partagé). */

export interface ViewSignup {
  displayName: string; characterName: string | null; cls: string; spec: string; role: Role | null;
  status: SignupStatus; note: string; guest: boolean;
  /** Groupe dans la compo (null : pas placé). */
  group: number | null;
}
export interface RosterMember { name: string; cls: string; spec: string; role: Role | null }
export interface RaidView {
  raid: { id: string; name: string; description: string; scheduledAt: string | null; url: string; changedAt: string; size?: number; difficulty?: string | null };
  /** Jeu du groupe (Roster : WoW Retail) ; absent : Forever. */
  group: { id: string; name: string; game?: Game };
  channelId: string;
  messageId: string | null;
  signups: ViewSignup[];
  /** Compo validée par un officier (null tant qu'elle n'est pas publiée). */
  roster: { groups: { group: number; members: RosterMember[] }[] } | null;
}
export interface Recipient { discordUserId: string; status: SignupStatus; name: string; cls: string; spec: string; guest: boolean; group: number | null }
export interface Reminder { view: RaidView; recipients: Recipient[] }
/** Relance des sans-réponse : à qui écrire, qui n'est pas joignable, officiers à prévenir (relance automatique). */
export interface Nudge {
  view: RaidView; auto: boolean;
  recipients: { discordUserId: string; name: string }[];
  unreachable: { name: string; why: "no-discord" | "dm-off" }[];
  officers: string[];
}
/** « Demander à X » : un officier demande à un joueur de venir avec un perso précis. */
export interface Ask {
  id: string; discordUserId: string; character: { name: string; cls: string }; spec: string; role: Role | null; askedBy: string;
  current: { status: SignupStatus; characterName: string | null } | null;
  raid: { id: string; name: string; scheduledAt: string | null; url: string }; group: { id: string; name: string; game?: Game };
}
export interface AskAnswer { answer: "yes" | "no"; character: string; spec: string; url: string; view: RaidView | null; already: boolean }
/** Commande d'artisanat dans son salon Discord (lot F). */
export interface OrderView {
  id: string; group: { id: string; name: string }; channelId: string; messageId: string | null; changedAt: string; url: string;
  item: { id: number; name: string; quality: number } | null; recipeName: string; quantity: number; requester: string; character: string | null;
  crafters: string[]; status: "open" | "taken" | "done"; taker: string | null; reagents: { name: string; n: number; provided: boolean }[]; note: string;
}
export interface Current { status: SignupStatus; characterId: string | null; cls: string; spec: string }
export interface ChoiceChar { id: string; name: string; cls: string; spec1: string; spec2: string; specs: { name: string; role: Role }[] }
export type Choices =
  | { mode: "member"; linked: true; current: Current | null; characters: ChoiceChar[]; game?: Game }
  | { mode: "guest"; linked: boolean; current: Current | null; game?: Game };
export interface SignupBody { status: SignupStatus; characterId?: string | null; cls?: string; spec?: string }
export interface Deletion { id: number; channelId: string; messageId: string }
export interface FeedbackConfig { guildId: string; inboxChannelId: string; panelChannelId: string | null; panelMessageId: string | null; allowAnonymous: boolean }
export interface FeedbackRecord { id: string; guildId: string; channelId: string; messageId: string; anonymous: boolean; authorId: string }

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
    return this.req<{ group: { id: string; name: string }; kind: "raids" | "orders" }>("POST", "/internal/discord/bind", b);
  }
  createRaid(b: { guildId: string; channelId: string; discordUserId: string; name: string; scheduledAt: string; description?: string }) {
    return this.req<RaidView>("POST", "/internal/discord/raids", b);
  }
  outbox() { return this.req<{ raids: RaidView[]; deletions: Deletion[] }>("GET", "/internal/discord/outbox"); }
  published(raidId: string, b: { channelId: string; messageId: string; changedAt: string }) {
    return this.req<{ ok: true }>("POST", `/internal/discord/raids/${raidId}/published`, b);
  }
  claimReminders() { return this.req<{ reminders: Reminder[] }>("POST", "/internal/discord/reminders/claim", {}); }
  claimNudges() { return this.req<{ nudges: Nudge[] }>("POST", "/internal/discord/nudges/claim", {}); }
  claimAsks() { return this.req<{ asks: Ask[] }>("POST", "/internal/discord/asks/claim", {}); }
  askFailed(id: string) { return this.req<{ ok: true }>("POST", `/internal/discord/asks/${id}/failed`, {}); }
  answerAsk(id: string, discordUserId: string, yes: boolean) {
    return this.req<AskAnswer>("POST", `/internal/discord/asks/${id}/answer`, { discordUserId, yes });
  }
  ordersOutbox() { return this.req<{ orders: OrderView[] }>("GET", "/internal/discord/orders/outbox"); }
  orderPublished(id: string, b: { channelId: string; messageId: string; changedAt: string }) {
    return this.req<{ ok: true }>("POST", `/internal/discord/orders/${id}/published`, b);
  }
  takeOrder(id: string, discordUserId: string) { return this.req<{ view: OrderView | null }>("POST", `/internal/discord/orders/${id}/take`, { discordUserId }); }
  deletionDone(id: number) { return this.req<{ ok: true }>("DELETE", `/internal/discord/deletions/${id}`); }
  view(raidId: string) { return this.req<RaidView>("GET", `/internal/discord/raids/${raidId}/view`); }
  choices(raidId: string, discordUserId: string) {
    return this.req<Choices>("GET", `/internal/discord/raids/${raidId}/choices?discordUserId=${encodeURIComponent(discordUserId)}`);
  }
  signup(raidId: string, b: SignupBody & { discordUserId: string; discordName: string }) {
    return this.req<RaidView>("POST", `/internal/discord/raids/${raidId}/signup`, b);
  }
  /* Avis (feedback) : fonction autonome, sans groupe du site */
  feedbackConfig(guildId: string) { return this.req<{ config: FeedbackConfig | null }>("GET", `/internal/feedback/config/${guildId}`); }
  saveFeedbackConfig(guildId: string, b: Omit<FeedbackConfig, "guildId"> & { updatedBy: string }) {
    return this.req<{ config: FeedbackConfig; previous: FeedbackConfig | null }>("PUT", `/internal/feedback/config/${guildId}`, b);
  }
  removeFeedbackConfig(guildId: string) { return this.req<{ previous: FeedbackConfig | null }>("DELETE", `/internal/feedback/config/${guildId}`); }
  recordFeedback(b: FeedbackRecord) { return this.req<{ ok: true }>("POST", "/internal/feedback", b); }
  feedback(id: string) { return this.req<{ feedback: FeedbackRecord }>("GET", `/internal/feedback/${id}`); }
  unsign(raidId: string, discordUserId: string) {
    return this.req<RaidView>("DELETE", `/internal/discord/raids/${raidId}/signup/${discordUserId}`);
  }
}
