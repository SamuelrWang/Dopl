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
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSessionStates", () => {
  it("maps rows into the session-state shape the MCP op returns", async () => {
    vi.mocked(sessionRepo.listSessionStates).mockResolvedValue([
      row(),
      row({ name: "onyx", state: "idle", task_id: null, thread_title: null }),
      row({ name: "quartz", state: "ended" }),
    ]);

    const out = await listSessionStates(ctx);

    expect(out).toEqual([
      {
        channelId: CHAN,
        threadId: TASK,
        name: "flint",
        state: "working",
        channelName: "General",
        threadTitle: "Deploy check",
        updatedAt: "2026-08-05T12:00:05.000Z",
      },
      {
        channelId: CHAN,
        threadId: null,
        name: "onyx",
        state: "idle",
        channelName: "General",
        threadTitle: null,
        updatedAt: "2026-08-05T12:00:05.000Z",
      },
      {
        channelId: CHAN,
        threadId: TASK,
        name: "quartz",
        state: "ended",
        channelName: "General",
        threadTitle: "Deploy check",
        updatedAt: "2026-08-05T12:00:05.000Z",
      },
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
    expect(await listSessionStates(ctx)).toEqual([]);
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
  const entry = {
    sessionKey: `${CHAN}:${TASK}`,
    channelId: CHAN,
    threadId: TASK,
    name: "flint" as const,
    state: "working" as const,
    channelName: "General",
    threadTitle: "Deploy check",
  };

  it("keys the write on the CALLER, never on anything in the payload", async () => {
    vi.mocked(sessionRepo.replaceSessionStates).mockResolvedValue({
      stored: 1,
      changed: 1,
      removed: 0,
    });
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
      },
    ]);
  });

  it("absent optional text becomes the NULL the column stores", async () => {
    vi.mocked(sessionRepo.replaceSessionStates).mockResolvedValue({
      stored: 1,
      changed: 1,
      removed: 0,
    });
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
