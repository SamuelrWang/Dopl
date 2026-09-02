/**
 * THE ROUTING SWITCH FOR THE TWO ACCOUNT-WIDE READS (T21/T22).
 *
 * ⚠ **`account-scope.test.ts` PINS THE SEAM AND `status-render.test.ts` PINS THE
 * RENDER; NEITHER PINS THAT ANYTHING REACHES THEM.** The whole feature is one
 * `if` in `channel.ts`'s switch, and a mutation that sent a channel-less `read`
 * back to the per-channel handler would leave both of those suites green while
 * the op answered a 404 for a channel nobody named. §14: a pin on a symbol is
 * not a pin — so every case here drives the REAL registered `dopl_channel`
 * callback and asserts WHICH CLIENT METHOD it reached.
 *
 * The four rules:
 *   1. `op="read"` with no `channel` → the ACCOUNT page, and `since` is required.
 *   2. `op="read"` WITH a `channel` → the per-channel read, unchanged.
 *   3. `op="read_sessions"` with no `channel` → every session, everywhere.
 *   4. `op="read_sessions"` WITH a `channel` → the per-channel list, unchanged.
 */

import { describe, expect, it, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { ZodRawShape } from "zod";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import type { ToolResponse } from "./respond.js";
import { registerChannelTool } from "./channel.js";

const DIRECTORY: WorkspaceDirectory = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  // Unlocked — the lock's own behaviour is `account-scope.test.ts`'s subject.
  lockedWorkspaceId: () => null,
};

function stubClient(): DoplClient {
  return {
    readAccountMessages: vi.fn().mockResolvedValue({
      messages: [
        {
          id: "m1",
          seq: 42,
          channelId: "ch-a",
          channelName: "Dopl Main",
          channelSlug: "dopl-main",
          workspaceId: "ws-container-1",
          authorUserId: "u2",
          authorKind: "user",
          kind: "message",
          body: "the account-wide body",
          metadata: {},
          clientMsgId: null,
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
      channelCount: 3,
      truncated: false,
    }),
    getAccountStatus: vi.fn().mockResolvedValue({
      channels: [
        {
          channelId: "ch-a",
          channelName: "Dopl Main",
          channelSlug: "dopl-main",
          workspaceId: "ws-container-1",
          lastSeq: 42,
          lastMessageAt: null,
          unread: null,
          sessions: [
            {
              channelId: "ch-a",
              threadId: null,
              name: "x2sz1ztt",
              state: "working",
              channelName: "Dopl Main",
              threadTitle: null,
              updatedAt: new Date().toISOString(),
              model: null,
              toolLabel: null,
              contextUsed: null,
              contextWindow: null,
              tokensSpent: null,
              startedAt: null,
              lastActivityAt: null,
              templateName: null,
            },
          ],
          waiting: [],
        },
      ],
      operatorOnline: true,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    }),
    readChannelMessages: vi.fn().mockResolvedValue([]),
    listChannelSessions: vi
      .fn()
      .mockResolvedValue({ sessions: [], operatorOnline: true }),
    listChannels: vi
      .fn()
      .mockResolvedValue([
        { id: "ch-a", slug: "dopl-main", name: "Dopl Main", workspaceId: "w" },
      ]),
  } as unknown as DoplClient;
}

/** Register the REAL tool and hand back its callback plus the stub it closed over. */
function tool() {
  const client = stubClient();
  let handler:
    | ((args: Record<string, unknown>) => Promise<ToolResponse>)
    | null = null;
  const register = (
    _name: string,
    _description: string,
    _schema: ZodRawShape,
    cb: (args: never) => Promise<ToolResponse>,
  ) => {
    handler = cb as unknown as (
      args: Record<string, unknown>,
    ) => Promise<ToolResponse>;
  };
  registerChannelTool(register, client, undefined, false, DIRECTORY);
  if (!handler) throw new Error("dopl_channel was not registered");
  const call = handler as (
    args: Record<string, unknown>,
  ) => Promise<ToolResponse>;
  return {
    client,
    call: async (args: Record<string, unknown>) =>
      (await call(args)).content.map((c) => c.text ?? "").join("\n"),
  };
}

describe('op="read" with no channel', () => {
  it("reaches the ACCOUNT page, not the per-channel read", async () => {
    const t = tool();
    const text = await t.call({ op: "read", since: 10 });
    expect(t.client.readAccountMessages).toHaveBeenCalledWith({
      since: 10,
      limit: undefined,
    });
    // ⚠ The mutation this exists to catch: falling through to the per-channel
    // handler, which would resolve a channel nobody named.
    expect(t.client.readChannelMessages).not.toHaveBeenCalled();
    expect(text).toContain("Everywhere");
  });

  it("tags every group with the `workspace=` handle that reaches it", async () => {
    const text = await tool().call({ op: "read", since: 10 });
    // ⚠ Without this a home channel's rows name a room the reader cannot
    // address: the CONTAINER id appears here, in dopl_home and nowhere else.
    expect(text).toContain("workspace=`ws-container-1`");
    expect(text).toContain("`dopl-main`");
  });

  it("REQUIRES `since` — a cursorless account read is a firehose", async () => {
    const t = tool();
    const text = await t.call({ op: "read" });
    expect(text).toContain("since");
    expect(t.client.readAccountMessages).not.toHaveBeenCalled();
  });

  it("treats a BLANK channel as absent rather than 404ing on it", async () => {
    const t = tool();
    await t.call({ op: "read", channel: "   ", since: 10 });
    expect(t.client.readAccountMessages).toHaveBeenCalled();
  });

  it("names the scope, so silence is not read as the product being quiet", async () => {
    const text = await tool().call({ op: "read", since: 10 });
    expect(text).toContain("every channel you are a MEMBER of");
    expect(text).toContain("PUBLIC channel you never joined is NOT included");
  });
});

describe('op="read" WITH a channel', () => {
  it("still takes the per-channel path, untouched", async () => {
    const t = tool();
    await t.call({ op: "read", channel: "dopl-main", since: 10 });
    expect(t.client.readChannelMessages).toHaveBeenCalled();
    expect(t.client.readAccountMessages).not.toHaveBeenCalled();
  });
});

describe('op="read_sessions"', () => {
  it("with NO channel, reads every session everywhere", async () => {
    const t = tool();
    const text = await t.call({ op: "read_sessions" });
    expect(t.client.getAccountStatus).toHaveBeenCalledWith({
      view: "sessions",
    });
    expect(t.client.listChannelSessions).not.toHaveBeenCalled();
    // Grouped by room, with the handle to reach that room.
    expect(text).toContain("workspace=`ws-container-1`");
    // The projection renderer, reused verbatim — the handle is an AUDIENCE
    // decision and this read is own-scoped.
    expect(text).toContain("`@agent-x2sz1ztt`");
  });

  it("with a channel, still narrows through the per-channel read", async () => {
    const t = tool();
    await t.call({ op: "read_sessions", channel: "dopl-main" });
    expect(t.client.listChannelSessions).toHaveBeenCalled();
    expect(t.client.getAccountStatus).not.toHaveBeenCalled();
  });

  it("says what an EMPTY answer does and does not establish", async () => {
    const t = tool();
    (t.client.getAccountStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: [],
      operatorOnline: false,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    });
    const text = await t.call({ op: "read_sessions" });
    // ⚠ "No sessions are being REPORTED" — never "you have none". An asleep,
    // signed-out or older-build machine reports nothing.
    expect(text).toMatch(/being reported/i);
    expect(text).toContain("YOUR OWN machine");
  });
});
