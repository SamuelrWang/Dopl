/**
 * 🔒 **THE HOLD IS EXTERNAL-ONLY, AND THIS IS THE SERVER SAYING SO** (T85;
 * Desktop Agent default 2026-09-02, **Samuel may reverse**).
 *
 * ⚠ **THE RULE EXISTED AND THE FENCE DID NOT.** `channel-doctrine.ts` has told
 * agents *"a session your operator's own Dopl app runs is woken by the MESSAGE
 * ITSELF, so that machine REFUSES the hold outright"* since B8, and the desktop
 * enforces it — in its PERMISSION GATE (`main/session-permissions.js`), for the
 * one runtime that gate covers. Everything else on that machine (another
 * vendor's runtime, a raw loopback, a `full`-profile shell) issued the call and
 * got the full wake-length hold, spending a turn asleep waiting for a message
 * that was already being delivered as a turn. A rule stated in doctrine and
 * enforced by one client is not enforced.
 *
 * ⚠ **TWO MARKS, AND THE SECOND IS THE ONE THAT CANNOT BE DROPPED.** The
 * runtime stamp is a HEADER, so an agent with a shell can omit it; the
 * container lock rides the TOKEN ROW and only the desktop's container minter
 * sets it (`identity.ts › isDesktopRun`). Either mark refuses.
 *
 * ⚠ **AND THE READ IS UNTOUCHED.** Nothing is withheld: `op="read"` without
 * `wait_ms` answers exactly as before, on every caller. That is why the refusal
 * names no remedy — the next action is "stop", not "ask for something else".
 */

import { describe, expect, it, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { ZodRawShape } from "zod";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import type { ToolResponse } from "./respond.js";
import { registerChannelTool } from "./channel.js";
import { DESKTOP_HOLD_REFUSAL } from "./channel-hold-budget.js";
import { DESKTOP_SESSION_RUNTIME, UNKNOWN_CALLER } from "./identity.js";

const DIRECTORY: WorkspaceDirectory = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
  lockedWorkspaceId: () => null,
};

const CHANNEL = { id: "ch-a", slug: "general", name: "General", workspaceId: "w" };

function stubClient(): DoplClient {
  return {
    listChannels: vi.fn().mockResolvedValue([CHANNEL]),
    readChannelMessages: vi.fn().mockResolvedValue([]),
    listChannelSessions: vi
      .fn()
      .mockResolvedValue({ sessions: [], operatorOnline: true }),
    // The two hold doors. ⚠ `timedOut` so neither renderer needs a message.
    awaitChannelMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], timedOut: true }),
    awaitWorkspaceMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], timedOut: true }),
  } as unknown as DoplClient;
}

/** The REAL registered callback — §14: a pin on a symbol is not a pin. */
function tool(caller: Partial<typeof UNKNOWN_CALLER>) {
  const client = stubClient();
  let handler: ((args: Record<string, unknown>) => Promise<ToolResponse>) | null =
    null;
  registerChannelTool(
    ((_n: string, _d: string, _s: ZodRawShape, cb: (a: never) => Promise<ToolResponse>) => {
      handler = cb as unknown as (a: Record<string, unknown>) => Promise<ToolResponse>;
    }) as Parameters<typeof registerChannelTool>[0],
    client,
    { ...UNKNOWN_CALLER, userId: "u-1", ...caller },
    false,
    DIRECTORY,
  );
  if (!handler) throw new Error("dopl_channel was not registered");
  const call = handler as (a: Record<string, unknown>) => Promise<ToolResponse>;
  return {
    client,
    call: async (args: Record<string, unknown>) => {
      const res = await call(args);
      return {
        text: res.content.map((c) => c.text ?? "").join("\n"),
        isError: res.isError === true,
      };
    },
  };
}

const DESKTOP_RUN = {
  "a runtime-stamped desktop session": { runtime: DESKTOP_SESSION_RUNTIME },
  "a container-locked credential": { containerId: "ws-container-1" },
  "both marks at once": {
    runtime: DESKTOP_SESSION_RUNTIME,
    containerId: "ws-container-1",
  },
} as const;

describe.each(Object.entries(DESKTOP_RUN))(
  "🔒 a desktop-run caller is refused the hold — %s",
  (_label, caller) => {
    it("per-channel: refuses, and no hold is opened", async () => {
      const t = tool(caller);
      const { text, isError } = await t.call({
        op: "read",
        channel: "general",
        since: 1,
        wait_ms: 200_000,
      });
      expect(text).toBe(DESKTOP_HOLD_REFUSAL);
      expect(isError).toBe(true);
      expect(t.client.awaitChannelMessages).not.toHaveBeenCalled();
    });

    it("account-wide: the same refusal, since it is the same hold", async () => {
      const t = tool(caller);
      const { text } = await t.call({ op: "read", since: 1, wait_ms: 200_000 });
      expect(text).toBe(DESKTOP_HOLD_REFUSAL);
      expect(t.client.awaitWorkspaceMessages).not.toHaveBeenCalled();
    });

    it("…and it refuses BEFORE asking for `since`, so nothing teaches a retry", async () => {
      // ⚠ A missing-parameter refusal is an invitation to send the parameter.
      // This caller may not have the hold at all, so the order is the message.
      const { text } = await tool(caller).call({
        op: "read",
        channel: "general",
        wait_ms: 200_000,
      });
      expect(text).toBe(DESKTOP_HOLD_REFUSAL);
    });

    it("🔒 but the ordinary READ is untouched — nothing is withheld", async () => {
      const t = tool(caller);
      const { text } = await t.call({ op: "read", channel: "general", since: 1 });
      expect(text).not.toContain(DESKTOP_HOLD_REFUSAL);
      expect(t.client.readChannelMessages).toHaveBeenCalled();
    });
  },
);

describe("🔒 an EXTERNAL caller keeps the hold", () => {
  it("per-channel: the hold is opened, not refused", async () => {
    const t = tool({});
    const { text } = await t.call({
      op: "read",
      channel: "general",
      since: 1,
      wait_ms: 200_000,
    });
    expect(text).not.toContain(DESKTOP_HOLD_REFUSAL);
    expect(t.client.awaitChannelMessages).toHaveBeenCalled();
  });

  it("account-wide: the same", async () => {
    const t = tool({});
    const { text } = await t.call({ op: "read", since: 1, wait_ms: 200_000 });
    expect(text).not.toContain(DESKTOP_HOLD_REFUSAL);
    expect(t.client.awaitWorkspaceMessages).toHaveBeenCalled();
  });

  it("⚠ an UNSTAMPED caller is not assumed external OR desktop — it keeps the hold", async () => {
    // An older desktop build sends no runtime and holds no container lock. The
    // fail-toward is the pre-2026-09-02 behaviour: a wasted long-poll, never a
    // lost message.
    const t = tool({ runtime: null, containerId: null });
    await t.call({ op: "read", channel: "general", since: 1, wait_ms: 1_000 });
    expect(t.client.awaitChannelMessages).toHaveBeenCalled();
  });
});
