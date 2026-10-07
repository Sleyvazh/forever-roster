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
/** Signalement (bug, idée, question) dans le salon des admins du site. */
export interface ReportView {
  id: string; channelId: string; messageId: string | null; changedAt: string; createdAt: string; url: string;
  kind: "bug" | "idea" | "question"; area: "site" | "addon" | "bot" | "companion"; title: string; body: string; author: string;
  site: string; page: string; browser: string; addonVersion: string | null; hasImage: boolean; status: "new" | "wip" | "done" | "refused"; reply: string; repliedBy: string | null;
}
export interface Current { status: SignupStatus; characterId: string | null; cls: string; spec: string }
export interface ChoiceChar { id: string; name: string; cls: string; spec1: string; spec2: string; specs: { name: string; role: Role }[] }
export type Choices =
  | { mode: "member"; linked: true; current: Current | null; characters: ChoiceChar[]; game?: Game }
  | { mode: "guest"; linked: boolean; current: Current | null; game?: Game };
export interface SignupBody { status: SignupStatus; characterId?: string | null; cls?: string; spec?: string }
export interface Deletion { id: number; channelId: string; messageId: string }
/** Groupe du site qui suit les avis d'un serveur (Administration → Avis). */
export interface FeedbackTrack { groupId: string; groupName: string; game: Game; site: string; url: string }
export interface FeedbackConfig {
  guildId: string; inboxChannelId: string; panelChannelId: string | null; panelMessageId: string | null; allowAnonymous: boolean;
  guildName?: string; groupId?: string | null; track?: FeedbackTrack | null;
}
export interface FeedbackRecord { id: string; guildId: string; channelId: string; messageId: string; anonymous: boolean; authorId: string; tracked?: boolean }
export type FeedbackStatus = "new" | "wip" | "done" | "refused";
/** Groupe proposé par l'autocomplétion de /feedback-config (lié à ce serveur). */
export interface FeedbackGroupChoice { id: string; name: string; site: string; raidsChannelId: string | null; ordersChannelId: string | null }
/** Relève : réponse écrite sur le site à envoyer en MP, statut à reporter sur le message de l'avis. */
export interface FeedbackReplyOut { id: number; feedbackId: string; responder: string; text: string; authorId: string; guildId: string; guildName: string; channelId: string; messageId: string; original: string | null }
export interface FeedbackStatusOut { id: string; channelId: string; messageId: string; status: FeedbackStatus; changedAt: string; track: { groupName: string; site: string; url: string } }

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
  bindReports(b: { guildId: string; channelId: string; discordUserId: string }) { return this.req<{ ok: true }>("POST", "/internal/discord/reports/bind", b); }
  reportsOutbox() { return this.req<{ reports: ReportView[] }>("GET", "/internal/discord/reports/outbox"); }
  reportPublished(id: string, b: { channelId: string; messageId: string; changedAt: string }) {
    return this.req<{ ok: true }>("POST", `/internal/discord/reports/${id}/published`, b);
  }
  /** Capture du signalement (WebP), ou null si elle n'existe plus. */
  async reportImage(id: string): Promise<Buffer | null> {
    const res = await this.f(`${this.base}/internal/discord/reports/${id}/image`, {
      headers: { authorization: `Bearer ${this.secret}` }, signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    return res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  deletionDone(id: number) { return this.req<{ ok: true }>("DELETE", `/internal/discord/deletions/${id}`); }
  view(raidId: string) { return this.req<RaidView>("GET", `/internal/discord/raids/${raidId}/view`); }
  choices(raidId: string, discordUserId: string) {
    return this.req<Choices>("GET", `/internal/discord/raids/${raidId}/choices?discordUserId=${encodeURIComponent(discordUserId)}`);
  }
  signup(raidId: string, b: SignupBody & { discordUserId: string; discordName: string }) {
    return this.req<RaidView>("POST", `/internal/discord/raids/${raidId}/signup`, b);
  }
  /* Avis (feedback) : fonction autonome ; suivi facultatif par un groupe du site lié au serveur */
  feedbackConfig(guildId: string) { return this.req<{ config: FeedbackConfig | null }>("GET", `/internal/feedback/config/${guildId}`); }
  /** groupId : absent = garder le groupe actuel, null = plus de suivi sur le site. */
  saveFeedbackConfig(guildId: string, b: Omit<FeedbackConfig, "guildId" | "track" | "groupId"> & { updatedBy: string; updatedByName?: string; groupId?: string | null }) {
    return this.req<{ config: FeedbackConfig; previous: FeedbackConfig | null }>("PUT", `/internal/feedback/config/${guildId}`, b);
  }
  removeFeedbackConfig(guildId: string, by?: { by: string; byName: string }) {
    return this.req<{ previous: FeedbackConfig | null }>("DELETE", `/internal/feedback/config/${guildId}`, by ?? {});
  }
  feedbackGroups(guildId: string, q: string, game?: Game) {
    const qs = new URLSearchParams({ q: q.slice(0, 60), ...(game ? { game } : {}) });
    return this.req<{ groups: FeedbackGroupChoice[] }>("GET", `/internal/feedback/groups/${guildId}?${qs}`);
  }
  recordFeedback(b: FeedbackRecord & { text: string; authorName: string | null }) { return this.req<{ ok: true; tracked: boolean }>("POST", "/internal/feedback", b); }
  feedback(id: string) { return this.req<{ feedback: FeedbackRecord }>("GET", `/internal/feedback/${id}`); }
  /** Réponse écrite dans Discord (équipe ou auteur), ajoutée au fil d'un avis suivi. */
  feedbackMessage(id: string, b: { from: "team" | "author"; name: string | null; text: string; delivered?: boolean }) {
    return this.req<{ ok: true; tracked: boolean }>("POST", `/internal/feedback/${id}/messages`, b);
  }
  feedbackOutbox() { return this.req<{ replies: FeedbackReplyOut[]; statuses: FeedbackStatusOut[] }>("GET", "/internal/feedback/outbox"); }
  feedbackReplyDone(id: number, delivered: boolean) { return this.req<{ ok: true }>("POST", `/internal/feedback/replies/${id}`, { delivered }); }
  feedbackSynced(id: string, changedAt: string) { return this.req<{ ok: true }>("POST", `/internal/feedback/${id}/synced`, { changedAt }); }
  unsign(raidId: string, discordUserId: string) {
    return this.req<RaidView>("DELETE", `/internal/discord/raids/${raidId}/signup/${discordUserId}`);
  }
}
