/**
 * OWN POSTS MUST NOT POP YOUR OWN HOLD. Observed live twice: an agent armed
 * `op="await"` and then its own close-echo (and, on the other occasion, a
 * sibling session on the same account) returned the hold instantly. Any agent
 * that posts a `task_progress` milestone after arming killed its own wake —
 * which is precisely the multi-step work the wake primitive exists for.
 *
 * The fix is opt-in at every other layer and ALWAYS-ON here: an MCP await
 * waits for a COUNTERPARTY by definition, so `opAwait` passes the caller's own
 * id as `excludeAuthor` whenever the boot handshake named it. When it did not
 * (`selfUserId === null`) nothing is passed and the poll is the pre-fix one.
 *
 * Split into its own file (rather than added to `channel-wake.test.ts`, which
 * owns the rest of the hold's behaviour) at the §2 500-line cap. The
 * @dopl/client is hand-stubbed; nothing transports.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opAwait } from "./channel-ops-await";

const ME = "user-me";

type AwaitOpts = {
  since: number;
  timeoutMs?: number;
  excludeAuthor?: string;
};

type AwaitSpy = (
  channelId: string,
  opts: AwaitOpts,
) => Promise<{ messages: Array<Record<string, unknown>>; timedOut: boolean }>;

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [
      { id: "chan-1", slug: "general", name: "General", visibility: "private" },
    ]),
    ...overrides,
  } as unknown as DoplClient;
}

/** Virtual clock — the whole multi-poll hold runs in microseconds. */
function fakeClock() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A hold where nothing ever arrives, so every inner poll is observable. */
function quietHold() {
  const clock = fakeClock();
  return vi.fn<AwaitSpy>(async (_ref, opts) => {
    clock.advance(opts.timeoutMs ?? 0);
    return { messages: [], timedOut: true };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opAwait — the caller's own posts are excluded", () => {
  it("passes excludeAuthor = selfUserId on EVERY inner poll", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, undefined, ME);

    expect(awaitChannelMessages.mock.calls.length).toBeGreaterThan(1);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      // Re-issued with the same cursor AND the same filter: a hold that
      // dropped the filter on re-issue would still wake on an own echo.
      expect(opts.since).toBe(7);
      expect(opts.excludeAuthor).toBe(ME);
    }
  });

  it("passes it on the poll that RETURNS messages too", async () => {
    const awaitChannelMessages = vi.fn<AwaitSpy>(async () => ({
      messages: [
        {
          id: "m-8",
          seq: 8,
          channelId: "chan-1",
          authorUserId: "user-peer",
          authorKind: "agent",
          kind: "message",
          body: "done",
          metadata: {},
          clientMsgId: null,
          createdAt: "2026-07-31T00:00:00Z",
          authorName: "Pat",
        },
      ],
      timedOut: false,
    }));

    const res = await opAwait(
      stubClient({ awaitChannelMessages }),
      "general",
      7,
      undefined,
      ME,
    );

    expect(res.isError).toBeFalsy();
    expect(awaitChannelMessages.mock.calls[0][1].excludeAuthor).toBe(ME);
  });

  it("passes NOTHING when selfUserId is null (boot handshake could not name the caller)", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7, undefined, null);

    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts).not.toHaveProperty("excludeAuthor");
    }
  });

  it("passes NOTHING when selfUserId is omitted entirely", async () => {
    const awaitChannelMessages = quietHold();

    await opAwait(stubClient({ awaitChannelMessages }), "general", 7);

    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts).not.toHaveProperty("excludeAuthor");
    }
  });
});
