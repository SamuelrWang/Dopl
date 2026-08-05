/**
 * READ-SESSION-STATE service (rollback §3.5) — the read half of "what is flint
 * doing?".
 *
 * Pins the SHAPE the MCP op renders (working/idle/ended, name, thread) and that
 * the read is scoped to the caller's own user + workspace (a session belongs to
 * one member's machine). The repository is mocked; the DELIVERY half (the
 * desktop pushing rows) is a flagged gap and is not under test here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository-collab");

import * as collab from "./repository-collab";
import { listSessionStates } from "./session-state-service";
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
    vi.mocked(collab.listSessionStates).mockResolvedValue([
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
    vi.mocked(collab.listSessionStates).mockResolvedValue([]);
    await listSessionStates(ctx);
    expect(collab.listSessionStates).toHaveBeenCalledWith(USER, WS, undefined);
  });

  it("forwards a channel filter", async () => {
    vi.mocked(collab.listSessionStates).mockResolvedValue([]);
    await listSessionStates(ctx, CHAN);
    expect(collab.listSessionStates).toHaveBeenCalledWith(USER, WS, CHAN);
  });

  it("an empty store returns [] — the honest 'no live sessions' the op renders", async () => {
    vi.mocked(collab.listSessionStates).mockResolvedValue([]);
    expect(await listSessionStates(ctx)).toEqual([]);
  });
});
