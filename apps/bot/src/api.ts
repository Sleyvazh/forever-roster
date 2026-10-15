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
/* ---------- Sorties donjon (Forever) ---------- */

export type OutingRole = "Tank" | "Heal" | "DPS";
export interface OutingMember { role: OutingRole; name: string; cls: string; spec: string; guest: boolean }
/** Sortie dans son salon Discord : de quoi dessiner l'annonce compacte. */
export interface OutingView {
  id: string; group: { id: string; name: string }; channelId: string; messageId: string | null; changedAt: string;
  /** Jour (Paris) au moment de la vue : renvoyé à la publication (le lendemain, « demain » devient « ce soir »). */
  today: string; url: string;
  dungeon: string; title: string; levels: string; day: string; at: string | null; note: string; creator: string;
  places: { tank: number; heal: number; dps: number };
  signups: OutingMember[]; waiting: OutingMember[];
}
export interface OutingCurrent { role: OutingRole; waiting: boolean; characterId: string | null; cls: string; spec: string }
export type OutingChoices =
  | { mode: "member"; linked: true; current: OutingCurrent | null; creator: boolean; levels: string; anyAtLevel: boolean; characters: { id: string; name: string; cls: string; level: number; spec: string }[] }
  | { mode: "guest"; linked: boolean; current: OutingCurrent | null; levels: string };
export interface OutingJoin { state: "in" | "waiting"; role: OutingRole; name: string; position: number | null }
export interface OutingSignupBody { role: OutingRole; characterId?: string | null; cls?: string; spec?: string; wait?: boolean }
export type OutingNoticeKind = "full" | "soon" | "moved" | "cancelled" | "promoted";
/** MP à envoyer (le texte est rendu par le bot). */
export interface OutingNotice {
  id: number; discordUserId: string; kind: OutingNoticeKind;
  payload: {
    outingId: string; groupName: string; title: string; levels: string; day: string; at: string | null; url: string; creator: string;
    oldDay?: string; oldAt?: string | null; isCreator?: boolean; role?: string; character?: string; count?: number; waiting?: number;
  };
}
export interface DungeonChoice { key: string; name: string; levels: string; count: number; fits: boolean }

export interface Current { status: SignupStatus; characterId: string | null; cls: string; spec: string }
export interface ChoiceChar { id: string; name: string; cls: string; spec1: string; spec2: string; specs: { name: string; role: Role }[] }
export type Choices =
  | { mode: "member"; linked: true; current: Current | null; characters: ChoiceChar[]; game?: Game }
  | { mode: "guest"; linked: boolean; current: Current | null; game?: Game };
export interface SignupBody { status: SignupStatus; characterId?: string | null; cls?: string; spec?: string }
export interface Deletion { id: number; channelId: string; messageId: string }
/** Salon à part d'un raid récurrent, et le nom qu'il doit porter (date du raid courant, ex. jeudi-15-10). */
export interface ChannelName { templateId: string; guildId: string; channelId: string; name: string }
/** Salon lié (celui du groupe, des commandes, d'un raid récurrent ou des sorties) et le nom que le site en connaît (null : inconnu). */
export interface LinkedChannel { kind: "group" | "orders" | "template" | "outings"; id: string; guildId: string | null; channelId: string; name: string | null }
/** Liaison d'un salon : raids du groupe, commandes d'artisanat, sorties donjon, ou salon à part d'un raid récurrent. */
export type BindResult =
  | { group: { id: string; name: string }; kind: "raids" | "orders" | "outings" }
  | { group: { id: string; name: string }; kind: "template"; template: { id: string; name: string; rename?: boolean; next?: string | null } };
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

  bind(b: { code: string; guildId: string; channelId: string; discordUserId: string; channelName?: string }) {
    return this.req<BindResult>("POST", "/internal/discord/bind", b);
  }
  /** Salons des raids récurrents à renommer, avec le nom attendu. */
  channelNames() { return this.req<ChannelName[]>("GET", "/internal/discord/channel-names"); }
  /** Nom actuel du salon d'un raid récurrent et erreur du dernier renommage (affichés sur le site). */
  channelReport(templateId: string, b: { channelId: string; name: string | null; error: string | null }) {
    return this.req<{ ok: boolean }>("POST", `/internal/discord/templates/${templateId}/channel`, b);
  }
  /** Tous les salons liés, avec le nom que le site en connaît. */
  linkedChannels() { return this.req<LinkedChannel[]>("GET", "/internal/discord/linked-channels"); }
  /** Nom actuel d'un salon lié (affiché sur le site, Administration → Discord). */
  channelName(b: { kind: LinkedChannel["kind"]; id: string; channelId: string; name: string }) {
    return this.req<{ ok: boolean; changed: boolean }>("POST", "/internal/discord/channel-name", b);
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
  /* Sorties donjon (Forever) */
  outingsOutbox() { return this.req<{ outings: OutingView[] }>("GET", "/internal/discord/outings/outbox"); }
  outingPublished(id: string, b: { channelId: string; messageId: string; changedAt: string; renderedOn: string }) {
    return this.req<{ ok: true }>("POST", `/internal/discord/outings/${id}/published`, b);
  }
  outingChoices(id: string, discordUserId: string, role: OutingRole) {
    return this.req<OutingChoices>("GET", `/internal/discord/outings/${id}/choices?discordUserId=${encodeURIComponent(discordUserId)}&role=${role}`);
  }
  outingSignup(id: string, b: OutingSignupBody & { discordUserId: string; discordName: string }) {
    return this.req<{ result: OutingJoin; view: OutingView }>("POST", `/internal/discord/outings/${id}/signup`, b);
  }
  outingUnsign(id: string, discordUserId: string) {
    return this.req<{ removed: boolean; view: OutingView }>("DELETE", `/internal/discord/outings/${id}/signup/${discordUserId}`);
  }
  createOuting(b: { guildId: string; channelId: string; discordUserId: string; dungeon: string; day: string; at: string | null; note?: string }) {
    return this.req<{ view: OutingView; character: string; role: OutingRole; open: { mine: number; max: number } }>("POST", "/internal/discord/outings", b);
  }
  dungeonChoices(b: { guildId: string; channelId: string; discordUserId: string; q: string }) {
    const qs = new URLSearchParams({ ...b, q: b.q.slice(0, 60) });
    return this.req<{ choices: DungeonChoice[] }>("GET", `/internal/discord/outings/dungeons?${qs}`);
  }
  claimOutingNotices() { return this.req<{ notices: OutingNotice[] }>("POST", "/internal/discord/outings/notices/claim", {}); }
  unsign(raidId: string, discordUserId: string) {
    return this.req<RaidView>("DELETE", `/internal/discord/raids/${raidId}/signup/${discordUserId}`);
  }
}
