import type { MessageSourceStamp } from "@/features/channels/server/message-source-stamp";
import type { ChannelLink } from "../devices/service";

/**
 * Shapes for the glasses menu + read mode (docs/glasses-mcp.md › Menu). The
 * `MenuGateway` is everything the menu reads from or asks of Dopl; the real one
 * (`gateway.ts`) delegates to the channels service, and tests use a fake.
 */

export type AgentStatus = "working" | "waiting" | "idle" | "ended";

interface MenuChannel {
  id: string;
  name: string;
  containerId: string;
  containerName: string;
  lastActivity: string | null;
  unread: boolean;
}

export interface MenuSession {
  /** The agent id (`channel_sessions.name`), what voice @-addresses. */
  agentId: string;
  displayName: string | null;
  channelId: string;
  state: string;
  detail: string | null;
  model: string | null;
  lastActivity: string | null;
  /** When the desktop last pushed this row (the liveness clock). */
  updatedAt: string | null;
  /** The operator running the session. */
  userId: string | null;
  /** Operator-only telemetry: the tool being run, when `detail` is `tool`. */
  toolLabel: string | null;
}

/** One channel message as the menu needs it (already visibility-checked). */
export interface MenuMessage {
  /** The channel message id (what `…/messages/:messageId/display/answer` takes). */
  id: string;
  seq: number;
  kind: string;
  authorKind: string;
  authorUserId: string | null;
  authorName: string | null;
  /** The agent that wrote it (agent rows), else null. */
  authorAgentId: string | null;
  authorAgentName: string | null;
  recipientAgentIds: string[];
  body: string;
  createdAt: string;
  /** Raw `metadata.display` (server-written; re-validated before use), else null. */
  display: unknown;
}

type LaunchStatus = "launching" | "launched" | "refused" | "expired";

export interface LaunchState {
  directiveId: string;
  status: LaunchStatus;
  agentId: string | null;
  agentName: string | null;
  refusalReason: string | null;
}

/** One channel, opened once per request: the channels-service context is resolved once. */
export interface MenuChannelHandle {
  /** Oldest-first page ending before `before` (newest page when absent). */
  readMessages(q: { before?: number; limit: number }): Promise<{ messages: MenuMessage[]; hasMore: boolean }>;
  /** Hold until messages with seq > `after` exist or `deadline` (epoch ms) passes. */
  awaitMessages(after: number, deadline: number, signal?: AbortSignal): Promise<MenuMessage[]>;
  /** File a launch through Dopl's own launch path; `null` = the user's Dopl desktop is offline. */
  createLaunch(input: { runtime: string; model: string | null; agentName: string; clientMsgId: string }): Promise<LaunchState | null>;
  getLaunch(directiveId: string): Promise<LaunchState>;
  /** Answer a display on a message in this channel as the owner, via glasses (the app's own
   *  answer path, `display-actions.ts › answerDisplay`). */
  answerDisplay(messageId: string, input: DisplayAnswerInput, source: MessageSourceStamp): Promise<{ answer: unknown }>;
}

export interface DisplayAnswerInput {
  index: number;
  block_id?: string | null;
}

export interface MenuGateway {
  /** Channels the user is a member of (all containers), live ones only. */
  listChannels(userId: string): Promise<MenuChannel[]>;
  /** Agent sessions in these channels (ids the caller already proved membership of),
   *  most recently active first. */
  listSessions(channelIds: string[], limit: number): Promise<MenuSession[]>;
  /**
   * Names for agents with no live `channel_sessions` row (ended, or the Mac restarted): the run's
   * last reported name, else its launch name. Fenced on channel ids the caller proved membership
   * of; ids with no persisted name are absent.
   */
  persistedAgentNames(channelIds: string[], agentIds: string[]): Promise<Map<string, string>>;
  /** The runtime each agent was launched with, when Dopl knows it. */
  runtimesFor(agentIds: string[]): Promise<Map<string, string>>;
  /** Agent names this user's recent launches asked for or were given (any channel). */
  recentLaunchNames(userId: string): Promise<string[]>;
  /** Runtimes / models this user has launched before, most recent first. */
  launchHistory(userId: string): Promise<{ runtime: string; model: string | null }[]>;
  /** A channel the caller already proved membership of (`link`). */
  openChannel(userId: string, link: ChannelLink): Promise<MenuChannelHandle>;
}
