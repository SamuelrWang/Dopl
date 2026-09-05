import { vi } from "vitest";
import type { SessionStateRow } from "./collab-dto";
import { resolveWakeVerdict } from "./service-wake-verdict";
import type { ChannelContext } from "./service-shared";
import type { ChannelRow, ChannelMessageRow } from "./dto";
import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";

/**
 * **THE WAKE-VERDICT FIXTURES, SHARED BY THE TWO SUITES THAT DRIVE IT.**
 *
 * ⚠ **ONE HARNESS, BECAUSE THE SUBTLE HALF IS THE PROJECTION SEEDING.**
 * `channel_sessions` is ONE table read through TWO fences — the caller's own rows
 * and the room's — and {@link projection} seeds both because the first is a
 * subset of the second. A second copy of that rule is a second place for the two
 * to drift apart, which is exactly the class of defect these suites exist for.
 *
 * ⚠ **EACH SUITE STILL DECLARES ITS OWN `vi.mock("./repository-sessions")`.**
 * Those calls are hoisted per module by vitest and cannot be shared; what is
 * shared is the seeding, which is the part with a rule in it.
 *
 * ⚠ NOT A `*.test.ts` NAME ON PURPOSE — `vitest.config.ts` collects exactly
 * `src/**\/*.test.ts(x)`, so this file is imported and never collected. Same
 * arrangement `lib/runtime-descriptors-harness.ts` is in.
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
    template_name: null,
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
 * The CALLER'S OWN live sessions — the own-scoped door an AGENT author's body
 * parse reads.
 *
 * ⚠ **IT SEEDS THE ROOM READ TOO, AND THAT IS FIDELITY RATHER THAN CONVENIENCE.**
 * `channel_sessions` is one table: a caller's own rows are IN the channel-wide
 * answer, so a fixture that seeded only the own read would describe a database
 * that cannot exist — and since 2026-09-04 a HUMAN's body parse reads the
 * channel-wide door, so such a fixture would silently test nothing.
 * ⚠ Call {@link roomProjection} AFTER this to make the two DIVERGE, which is
 * exactly the peer's-agent case the carve is about.
 */
export function projection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue(rows);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(rows);
}

/** EVERY member's sessions in the room — RR3's candidate set, and a HUMAN's
 *  body parse. ⚠ A DIFFERENT read from the own-scoped one, and asserting on the
 *  wrong one is how the same-account carve would appear to hold while being
 *  widened. */
export function roomProjection(...rows: SessionStateRow[]): void {
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue(rows);
}

/**
 * RR3 ARM 3's ONE READ — the room's recent AGENT posts, newest first.
 *
 * ⚠ SEEDED EMPTY BY DEFAULT AND NEVER LEFT UNSEEDED: `vi.mock` automocks it to
 * `undefined`, and the arm is reached by every multi-agent room with no
 * configured responder — a suite that forgot it would fail on a TypeError
 * rather than on the rule it was measuring.
 */
export function recentAgentPosts(
  ...rows: Array<Partial<ChannelMessageRow>>
): void {
  vi.mocked(repoMessages.listRecentRoomAgentPosts).mockResolvedValue(
    rows.map(
      (row, i) =>
        ({
          seq: 100 + i,
          created_at: new Date(NOW - 1_000).toISOString(),
          author_kind: "agent",
          client_msg_id: null,
          metadata: {},
          ...row,
        }) as ChannelMessageRow
    )
  );
}

/** RR2's one read — the last main-room row addressed to this agent. */
export function lastAddress(row: Partial<ChannelMessageRow> | null): void {
  vi.mocked(repoMessages.findLastRoomAddressToAgent).mockResolvedValue(
    row === null ? null : ({ seq: 7, author_user_id: "user-2", ...row } as ChannelMessageRow)
  );
}

export function channelRow(over: Partial<ChannelRow> = {}): ChannelRow {
  return { id: "chan-1", workspace_id: "ws-1", ...over } as ChannelRow;
}

export interface ResolveOpts {
  kind?: "message" | "task_progress";
  authorKind?: string;
  toAgentId?: string | null;
  threadTagStripped?: boolean;
  clientMsgId?: string;
  channel?: Partial<ChannelRow>;
}

/** One post, resolved. `metadata` is the fold's OUTPUT, which is what the
 *  resolver reads — never the caller's raw input. */
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
    } as Parameters<typeof resolveWakeVerdict>[2],
    metadata,
    {
      authorKind: opts.authorKind ?? "user",
      toAgentId: opts.toAgentId ?? null,
      threadTagStripped: opts.threadTagStripped,
    },
    NOW
  );
}

