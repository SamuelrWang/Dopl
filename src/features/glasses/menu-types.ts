/**
 * Shapes for the glasses menu + read mode (docs/glasses-mcp.md › Menu). The
 * `MenuGateway` is everything the menu reads from or asks of Dopl; the real one
 * (`menu-gateway.ts`) delegates to the channels service, and tests use a fake.
 */

export type AgentStatus = "working" | "waiting" | "idle" | "ended";

export interface MenuChannel {
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
}

/** One channel message as the menu needs it (already visibility-checked). */
export interface MenuMessage {
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
}

export type LaunchStatus = "launching" | "launched" | "refused" | "expired";

export interface LaunchState {
  directiveId: string;
  status: LaunchStatus;
  agentId: string | null;
  agentName: string | null;
  refusalReason: string | null;
}

export interface MenuGateway {
  /** Channels the user is a member of (all containers), live ones only. */
  listChannels(userId: string): Promise<MenuChannel[]>;
  /** Agent sessions in these channels (ids the caller already proved membership of),
   *  most recently active first. */
  listSessions(channelIds: string[], limit: number): Promise<MenuSession[]>;
  /** The runtime each agent was launched with, when Dopl knows it. */
  runtimesFor(agentIds: string[]): Promise<Map<string, string>>;
  /** Oldest-first page ending before `before` (newest page when absent). */
  readMessages(
    userId: string,
    channelId: string,
    q: { before?: number; limit: number },
  ): Promise<{ messages: MenuMessage[]; hasMore: boolean }>;
  /** Hold until messages with seq > `after` exist or `deadline` (epoch ms) passes. */
  awaitMessages(userId: string, channelId: string, after: number, deadline: number, signal?: AbortSignal): Promise<MenuMessage[]>;
  /** Runtimes / models this user has launched before, most recent first. */
  launchHistory(userId: string): Promise<{ runtime: string; model: string | null }[]>;
  /** File a launch through Dopl's own launch path; `null` = the user's Dopl desktop is offline. */
  createLaunch(
    userId: string,
    channelId: string,
    input: { runtime: string; model: string | null; agentName: string; clientMsgId: string },
  ): Promise<LaunchState | null>;
  getLaunch(userId: string, channelId: string, directiveId: string): Promise<LaunchState>;
}
