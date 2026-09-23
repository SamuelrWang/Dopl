/** Session-state service: the read (the shape the MCP op renders, scoped to the caller's own user +
 *  workspace) and the write (F-147). The repository is mocked. */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-sessions");
// `listSessionStates` joins the caller's own heartbeat so the render can tell idle-but-alive from gone (F-294).
vi.mock("./repository-collab");

import * as collab from "./repository-collab";
import * as sessionRepo from "./repository-sessions";
import { listSessionStates, reportSessionStates } from "./session-state-service";
import type { SessionStateRow } from "./collab-dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const CHAN = "chan-1";
const TASK = "44444444-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "agent",
  role: "member",
};

function row(over: Partial<SessionStateRow> = {}): SessionStateRow {
  return {
    id: "s-1",
    channel_id: CHAN,
    workspace_id: WS,
    user_id: USER,
    session_key: `${CHAN}:${TASK}`,
    task_id: TASK,
    name: "flint",
    state: "working",
    channel_name: "General",
    thread_title: "Deploy check",
    created_at: "2026-08-05T12:00:00.000Z",
    updated_at: "2026-08-05T12:00:05.000Z",
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    identity_name: null,
    // Health columns default to `null`, as an older desktop reports them.
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    display_name: null,
    color: null,
    ...over,
  };
}

/** The own-session DTO `row()` maps to. Every telemetry and health field is `null`: the mapper must
 *  carry "not reported" through as unknown, never as `0`. */
function session(over: Record<string, unknown> = {}) {
  return {
    channelId: CHAN,
    threadId: TASK,
    name: "flint",
    state: "working",
    detail: null,
    channelName: "General",
    threadTitle: "Deploy check",
    color: null,
    updatedAt: "2026-08-05T12:00:05.000Z",
    model: null,
    toolLabel: null,
    contextUsed: null,
    contextWindow: null,
    tokensSpent: null,
    startedAt: null,
    lastActivityAt: null,
    identityName: null,
    displayName: null,
    turns: null,
    tokensDelta: null,
    stale: null,
    deniedCalls: null,
    lastDeniedTool: null,
    lastWakeSeq: null,
    lastWakeAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(collab.presenceForUser).mockResolvedValue(null);
});

describe("listSessionStates", () => {
  it("maps rows into the session-state shape the MCP op returns", async () => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([
      row(),
      row({ name: "onyx", state: "idle", task_id: null, thread_title: null }),
      row({ name: "quartz", state: "ended" }),
    ]);

    const out = await listSessionStates(ctx);

    expect(out.sessions).toEqual([
      session(),
      session({ threadId: null, name: "onyx", state: "idle", threadTitle: null }),
      session({ name: "quartz", state: "ended" }),
    ]);
  });

  it("scopes the read to the caller's own user + workspace", async () => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([]);
    await listSessionStates(ctx);
    expect(sessionRepo.listSessionStates).toHaveBeenCalledWith(USER, WS, undefined);
  });

  it("forwards a channel filter", async () => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([]);
    await listSessionStates(ctx, CHAN);
    expect(sessionRepo.listSessionStates).toHaveBeenCalledWith(USER, WS, CHAN);
  });

  it("an empty store returns [] — the honest 'no live sessions' the op renders", async () => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([]);
    expect((await listSessionStates(ctx)).sessions).toEqual([]);
  });
});

/** `channel_sessions` is pushed on state change, so a quiet row and a dead machine look alike there;
 *  `agent_presence` beats unconditionally. It crosses the wire as a boolean derived against
 *  `PRESENCE_ONLINE_WINDOW_MS`, so no client re-derives freshness against its own window. */
describe("listSessionStates — the operator's own presence rides beside the rows", () => {
  beforeEach(() => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([]);
  });

  it("reads presence for the CALLER, in the CALLER's workspace — never a peer's", async () => {
    await listSessionStates(ctx);
    expect(collab.presenceForUser).toHaveBeenCalledWith(USER, WS);
  });

  it("a fresh heartbeat answers online", async () => {
    vi.mocked(collab.presenceForUser).mockResolvedValue({
      online: true,
      lastSeenAt: "2026-08-23T12:00:00.000Z",
    });
    expect((await listSessionStates(ctx)).operatorOnline).toBe(true);
  });

  it("a stale heartbeat answers offline", async () => {
    vi.mocked(collab.presenceForUser).mockResolvedValue({
      online: false,
      lastSeenAt: "2026-08-23T11:00:00.000Z",
    });
    expect((await listSessionStates(ctx)).operatorOnline).toBe(false);
  });

  it("NO presence row answers offline — the fail-safe direction, never `undefined`", async () => {
    vi.mocked(collab.presenceForUser).mockResolvedValue(null);
    // `false`, never `undefined`: "not reported" is the route omitting the key; a missing row is measured.
    expect((await listSessionStates(ctx)).operatorOnline).toBe(false);
  });

  it("the two reads are CONCURRENT — the await route pays for this one per hold", async () => {
    let sessionsSettled = false;
    vi.mocked(sessionRepo.listSessionStates).mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => {
            sessionsSettled = true;
            resolve([]);
          }, 5)
        )
    );
    vi.mocked(collab.presenceForUser).mockImplementation(async () => {
      // Serialized reads would have settled the session read already.
      expect(sessionsSettled).toBe(false);
      return null;
    });
    await listSessionStates(ctx);
  });
});

/** Where the wire vocabulary meets the columns and the caller's identity is attached — the whole
 *  authorization story, since writes run on the admin client with RLS bypassed. */
describe("reportSessionStates", () => {
  /** The columns an entry that reports no telemetry or health writes: `null`, never `0` or `false`. */
  const UNREPORTED = {
    detail: null,
    tool_label: null,
    model: null,
    context_used: null,
    context_window: null,
    tokens_spent: null,
    started_at: null,
    last_activity_at: null,
    identity_name: null,
    turns: null,
    tokens_delta: null,
    stale: null,
    denied_calls: null,
    last_denied_tool: null,
    last_wake_seq: null,
    last_wake_at: null,
    display_name: null,
    color: null,
  };

  const entry = {
    sessionKey: `${CHAN}:${TASK}`,
    channelId: CHAN,
    threadId: TASK,
    name: "flint" as const,
    state: "working" as const,
    channelName: "General",
    threadTitle: "Deploy check",
  };

  beforeEach(() => {
    vi.mocked(sessionRepo.replaceSessionStates).mockResolvedValue({
      stored: 1,
      changed: 1,
      removed: 0,
    });
  });

  it("keys the write on the CALLER, never on anything in the payload", async () => {
    // The entry type has no user field; both fenced ids come from `ctx`.
    await reportSessionStates(ctx, [
      { ...entry, userId: "someone-else", workspaceId: "not-mine" },
    ] as never);
    expect(sessionRepo.replaceSessionStates).toHaveBeenCalledWith(USER, WS, [
      {
        session_key: `${CHAN}:${TASK}`,
        channel_id: CHAN,
        task_id: TASK,
        name: "flint",
        state: "working",
        channel_name: "General",
        thread_title: "Deploy check",
        ...UNREPORTED,
      },
    ]);
  });

  it("absent optional text becomes the NULL the column stores", async () => {
    await reportSessionStates(ctx, [
      { sessionKey: `${CHAN}:`, channelId: CHAN, name: "onyx", state: "idle" },
    ]);
    const rows = vi.mocked(sessionRepo.replaceSessionStates).mock.calls[0][2];
    expect(rows[0]).toEqual({
      session_key: `${CHAN}:`,
      channel_id: CHAN,
      task_id: null,
      name: "onyx",
      state: "idle",
      channel_name: null,
      thread_title: null,
      ...UNREPORTED,
    });
  });

  /** Stored as reported, never looked up: a session reports what it ran as, so the column is a TEXT snapshot, not an FK. */
  it("carries a reported identity name straight to its column, unresolved", async () => {
    await reportSessionStates(ctx, [
      { ...entry, identityName: "Code Auditor" },
    ]);
    const rows = vi.mocked(sessionRepo.replaceSessionStates).mock.calls[0][2];
    expect(rows[0].identity_name).toBe("Code Auditor");
  });

  /** `turns: 0` and `stale: false` are measurements: `?? null` keeps them, `|| null` would not. */
  it("carries a reported health set to its columns, zero and false included", async () => {
    await reportSessionStates(ctx, [
      {
        ...entry,
        turns: 0,
        tokensDelta: 8_675_309,
        stale: false,
        deniedCalls: 419,
        lastDeniedTool: "Terraform",
        lastWakeSeq: 90_210,
        lastWakeAt: "2026-09-01T09:59:00.000Z",
      },
    ]);
    const rows = vi.mocked(sessionRepo.replaceSessionStates).mock.calls[0][2];
    expect(rows[0]).toMatchObject({
      turns: 0,
      tokens_delta: 8_675_309,
      stale: false,
      denied_calls: 419,
      last_denied_tool: "Terraform",
      last_wake_seq: 90_210,
      last_wake_at: "2026-09-01T09:59:00.000Z",
    });
  });

  it("an EMPTY report is a real instruction — it clears the caller's set", async () => {
    vi.mocked(sessionRepo.replaceSessionStates).mockResolvedValue({
      stored: 0,
      changed: 0,
      removed: 2,
    });
    const out = await reportSessionStates(ctx, []);
    expect(sessionRepo.replaceSessionStates).toHaveBeenCalledWith(USER, WS, []);
    expect(out.removed).toBe(2);
  });
});
