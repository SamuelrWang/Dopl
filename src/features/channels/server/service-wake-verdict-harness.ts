import { vi } from "vitest";
import type { SessionStateRow } from "./collab-dto";
import { resolveWakeVerdict } from "./service-wake-verdict";
import type { ChannelContext } from "./service-shared";
import type { ChannelRow, ChannelMessageRow } from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";

/**
 * Wake-verdict fixtures shared by the suites that drive it. Shared because `channel_sessions` is
 * one table read through two fences (own, room) and {@link projection} must seed both alike.
 * Each suite still declares its own `vi.mock(...)` calls: vitest hoists them per module.
 * Not a `*.test.ts` name on purpose, so vitest imports it and never collects it.
 */

export const NOW = Date.parse("2026-09-02T12:00:00Z");
export const CTX: ChannelContext = {
  userId: "user-1",
  workspaceId: "ws-1",
} as ChannelContext;

export function sessionRow(over: Partial<SessionStateRow>): SessionStateRow {
  return {
    id: "s-1",
    channel_id: "chan-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    session_key: "chan-1:task-1:k3v7d2mq",
    task_id: null,
    name: "k3v7d2mq",
    state: "working",
    channel_name: null,
    thread_title: null,
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW - 1_000).toISOString(),
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    display_name: null,
    identity_name: null,
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    ...over,
  } as SessionStateRow;
}

/**
 * The caller's own live sessions (an agent author's own-scoped read). Seeds the room read too:
 * own rows are always in the channel-wide answer. Call {@link roomProjection} after this to make
 * the two diverge (a peer's agent).
 */
export function projection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue(rows);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(rows);
}

/** Every member's sessions in the room: RR3's candidates and a human author's body parse. A
 *  different read from the own-scoped one; asserting on the wrong one hides a widened carve. */
export function roomProjection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(rows);
}

/**
 * RR3's recency read: the rows where this author tagged an agent here, newest first. Seed it in
 * every multi-agent case: automocked, it resolves `undefined` and the case fails on a TypeError.
 * Defaults are an author-typed tag (`author_user_id` = caller, `author_kind: "user"`, empty
 * `metadata`). Pass `metadata: { wake_reason: … }` for a server-aimed row, or
 * `author_kind: "agent"` for the author's own agent (F-704); neither counts as addressing.
 */
export function recentAgentPosts(
  ...rows: Array<Partial<ChannelMessageRow>>
): void {
  vi.mocked(repoMessages.listRecentRoomTagsBy).mockResolvedValue(
    rows.map(
      (row, i) =>
        ({
          seq: 100 + i,
          created_at: new Date(NOW - 1_000).toISOString(),
          // The arm reads the routed message's author, and every case resolves as `CTX`.
          author_user_id: CTX.userId,
          // An agent shares `author_user_id`, so this is the only field saying whose act it was.
          author_kind: "user",
          recipient_agent_ids: [],
          metadata: {},
          ...row,
        }) as ChannelMessageRow
    )
  );
}

export function channelRow(over: Partial<ChannelRow> = {}): ChannelRow {
  return { id: "chan-1", workspace_id: "ws-1", ...over } as ChannelRow;
}

export interface ResolveOpts {
  kind?: "message" | "task_progress";
  authorKind?: string;
  /** Fixture convenience; the contract is `toAgentIds` (folds into a one-element list). */
  toAgentId?: string | null;
  toAgentIds?: string[];
  toUserIds?: string[];
  /** The operators whose outside sessions `to=@desktop` named. Defaults to `[]`. */
  toDesktopOperatorIds?: string[];
  /** `"chat"` is the RECORD marker — the MCP surface's `kind="record"`. */
  intent?: "chat" | "request";
  threadTagStripped?: boolean;
  clientMsgId?: string;
  channel?: Partial<ChannelRow>;
  /** The room's member handles (`PostMetadataResult.memberHandles`). Empty = no member
   *  namespace to respect. */
  reservedHandles?: readonly string[];
}

/**
 * The author's own `channel_members.unaddressed_responder`, as the raw column (the coercion is
 * the code under test). Each suite needs a partial `vi.mock("./repository", …)`: unmocked, the
 * read times out, or passes through `unaddressedResponderFor`'s catch instead of the setting.
 */
export function unaddressedResponder(value: string | null = "last_addressed"): void {
  vi.mocked(repo.findUnaddressedResponder).mockResolvedValue(value);
}

/** One post, resolved. `metadata` is the fold's output, which is what the resolver reads. */
export function resolve(
  body: string,
  metadata: Record<string, unknown> = {},
  opts: ResolveOpts = {}
) {
  return resolveWakeVerdict(
    CTX,
    channelRow(opts.channel),
    {
      body,
      kind: opts.kind ?? "message",
      clientMsgId: opts.clientMsgId,
      intent: opts.intent,
    } as Parameters<typeof resolveWakeVerdict>[2],
    metadata,
    {
      authorKind: opts.authorKind ?? "user",
      toAgentIds:
        opts.toAgentIds ?? (opts.toAgentId ? [opts.toAgentId] : []),
      toUserIds: opts.toUserIds ?? [],
      toDesktopOperatorIds: opts.toDesktopOperatorIds ?? [],
      threadTagStripped: opts.threadTagStripped,
      reservedHandles: opts.reservedHandles,
    },
    NOW
  );
}

