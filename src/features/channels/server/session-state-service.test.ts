/**
 * READ-SESSION-STATE service (rollback §3.5) — the read half of "what is flint
 * doing?".
 *
 * Pins the SHAPE the MCP op renders (working/idle/ended, name, thread) and that
 * the read is scoped to the caller's own user + workspace (a session belongs to
 * one member's machine). The repository is mocked.
 *
 * F-147 added the WRITE half below — the delivery gap F-144 flagged, now wired
 * to `main/session-state-push.js`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-sessions");
// ⚠ The presence lane is mocked too since F-294: `listSessionStates` now joins
// the caller's OWN heartbeat so the render can tell idle-but-alive from gone.
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
    // ── HEALTH (2026-09-01, 20260909120000) ─────────────────────────────
    // ⚠ `null` IS THE FIXTURE DEFAULT, and that is the honest one: a desktop
    // older than these columns reports none, so the row a test builds by default
    // is the row most live rows still are.
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

/**
 * THE SECOND HALF OF THE ANSWER (2026-08-23, F-294) — IS THE MACHINE THERE?
 *
 * ⚠ **THE DEFECT THIS PINS: AN IDLE-BUT-ALIVE AGENT READ AS "its desktop may be
 * offline" WITHIN ~2 MINUTES.** `channel_sessions` is pushed on state CHANGE, so
 * a quiet row and a dead machine are indistinguishable ON THAT TABLE. They are
 * NOT indistinguishable on `agent_presence`, which beats unconditionally — so
 * the read joins it, and the render stops guessing.
 *
 * ⚠ It is a BOOLEAN on the wire, derived HERE against `PRESENCE_ONLINE_WINDOW_MS`.
 * Sending the stamp instead would invite a client to re-derive freshness against
 * a window of its own, which is the drift `SESSION_STALE_WINDOW_MS`'s
 * duplicate-plus-pin exists to prevent.
 */
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
    // ⚠ `false` here and NEVER `undefined`: "not reported" is a WIRE state (the
    // route omitting the key), and a missing row is a measured absence.
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
      // ⚠ If these were serialized, the session read would already be done.
      expect(sessionsSettled).toBe(false);
      return null;
    });
    await listSessionStates(ctx);
  });
});

/**
 * F-147 — `reportSessionStates`, the WRITE half.
 *
 * The service is where the API's vocabulary meets the column vocabulary, and
 * where the caller's identity is attached. Both are worth pinning: the mapping
 * because `undefined` and `null` are different things to a column, and the
 * identity because it is the entire authorization story for a table whose
 * writes are REVOKEd from `authenticated` and therefore run with RLS bypassed.
 */
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
    // A caller-supplied user id has nowhere to go: the entry type has no such
    // field, and the two ids the repository fences on come from `ctx` alone.
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

  /**
   * ⚠ THE SERVER STORES WHAT THE DESKTOP REPORTED AND RESOLVES NOTHING. `main`
   * captured the identity at spawn and reports its NAME; this service does not
   * look an identity up, does not check that one still exists under that name,
   * and must not — a session reports what it RAN AS, which is the whole reason
   * the column is a denormalized TEXT snapshot rather than an FK
   * (`20260823130000_channel_sessions_template_name.sql`).
   */
  it("carries a reported identity name straight to its column, unresolved", async () => {
    await reportSessionStates(ctx, [
      { ...entry, identityName: "Code Auditor" },
    ]);
    const rows = vi.mocked(sessionRepo.replaceSessionStates).mock.calls[0][2];
    expect(rows[0].identity_name).toBe("Code Auditor");
  });

  /**
   * ⚠ THE HEALTH ROUND TRIP, camelCase wire → snake_case column, INCLUDING THE
   * TWO VALUES A CARELESS `?? ` WOULD DESTROY. `turns: 0` and `stale: false` are
   * REPORTED measurements and must arrive as `0` and `false` — `entry.turns ??
   * null` keeps them, `entry.turns || null` does not, and the two differ only on
   * exactly these inputs. That is why the case drives them rather than a set of
   * comfortable non-zero numbers.
   */
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
