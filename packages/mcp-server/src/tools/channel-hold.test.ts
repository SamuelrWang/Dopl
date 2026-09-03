/**
 * ⚠ **THE DEFAULT `await` HOLD IS TWO NUMBERS, AND WHICH ONE YOU GET IS THE FIX
 * (T03).** Split out of `channel-wake.test.ts` — which pins the hold's SHAPE
 * (assembly, failure branches, cut-short) — because this file's subject is a
 * different question: not how the hold behaves, but how LONG it is allowed to
 * be for the caller doing the asking.
 *
 * A desktop-run session keeps the wake-length hold. Everything else gets one
 * that fits under its own client's ~60s call abort, because at 215s that caller
 * did not get a long wait — it got a raw transport timeout carrying no cursor,
 * no session block and no re-arm instruction, which is the one outcome the
 * deadline chain exists to prevent.
 *
 * ⚠ The CONSTANTS and the relations between them (env clamp, the margins, the
 * layers each hold must fit under) are pinned in `channel-deadlines.test.ts`.
 * What is pinned HERE is that the op actually holds for them.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient } from "@dopl/client";
import {
  HOLD_DEFAULT_MS,
  HOLD_EXTERNAL_DEFAULT_MS,
} from "./channel-hold-budget";
import { DESKTOP_SESSION_RUNTIME } from "./identity";
import { opHold } from "./channel-ops-hold";

const CHANNEL = {
  id: "chan-1",
  slug: "general",
  name: "General",
  visibility: "private",
};

function stubClient(overrides: Record<string, unknown>): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    ...overrides,
  } as unknown as DoplClient;
}

/** Virtual clock — a 215s hold runs in microseconds. */
function fakeClock() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
    elapsedFrom: (start: number) => now - start,
    get now() {
      return now;
    },
  };
}

type AwaitSpy = (
  channelId: string,
  opts: { since: number; timeoutMs?: number },
) => Promise<{ messages: Array<Record<string, unknown>>; timedOut: boolean }>;

/** A hold where nothing ever arrives, so the whole budget is spent. */
function quietHold(clock: ReturnType<typeof fakeClock>) {
  return vi.fn<AwaitSpy>(async (_ref, opts) => {
    clock.advance(opts.timeoutMs ?? 0);
    return { messages: [], timedOut: true };
  });
}

/**
 * ⚠ THE ASSEMBLED MULTI-POLL HOLD IS THE **DESKTOP** DEFAULT. An unstamped
 * caller's default is one inner poll long, so a case whose subject is the
 * ASSEMBLY has to say which caller it is or it silently tests one poll.
 */
const desktopAwait = (
  client: DoplClient,
  ref: string,
  since: number,
  timeoutMs?: number,
) => opHold(client, ref, since, timeoutMs, null, DESKTOP_SESSION_RUNTIME);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opHold — how long the hold is, and for whom (T03)", () => {
  it("a DESKTOP session still holds ~215s across polls, then says to re-arm", async () => {
    const clock = fakeClock();
    const start = clock.now;
    const awaitChannelMessages = quietHold(clock);
    const client = stubClient({ awaitChannelMessages });

    const res = await desktopAwait(client, "general", 7);

    expect(res.isError).toBeFalsy();
    // ⚠ Elapsed is the bound, and the DEFAULT is below the cap so it clears
    // every surrounding deadline; the cap is reachable only on an explicit ask.
    expect(clock.elapsedFrom(start)).toBe(HOLD_DEFAULT_MS);
    expect(clock.elapsedFrom(start)).toBe(215_000);
    expect(awaitChannelMessages).toHaveBeenCalledTimes(5);
    for (const [, opts] of awaitChannelMessages.mock.calls) {
      expect(opts.timeoutMs).toBeLessThanOrEqual(50_000);
      expect(opts.since).toBe(7);
    }
  });

  it("an UNSTAMPED caller holds under its own client's abort instead", async () => {
    const clock = fakeClock();
    const start = clock.now;
    const awaitChannelMessages = quietHold(clock);

    const res = await opHold(stubClient({ awaitChannelMessages }), "general", 7);

    expect(res.isError).toBeFalsy();
    expect(clock.elapsedFrom(start)).toBe(HOLD_EXTERNAL_DEFAULT_MS);
    // ⚠ Comfortably under 60s, with room for the route's auth + MCP boot +
    // workspace handshake, all of which run inside the caller's clock.
    expect(clock.elapsedFrom(start)).toBeLessThan(60_000);
    // ⚠ AND IT IS NOT REPORTED AS A PLATFORM CLAMP. A short hold that was ASKED
    // for must not trip the CUT SHORT branch, or the fix hands every external
    // caller "the platform is broken, stop waiting" on every empty hold.
    const text = res.content[0].text;
    expect(text).not.toContain("CUT SHORT");
    expect(text).toContain("timed out");
    expect(text).toContain("cursor=7");
    expect(text).toContain("since=7");
  });

  it("an EXPLICIT wait_ms is honoured exactly, on either side of the stamp", async () => {
    // ⚠ The external default is a DEFAULT, never a ceiling: a caller that knows
    // its own client outlasts it says so, and is not re-shortened.
    for (const runtime of [null, DESKTOP_SESSION_RUNTIME]) {
      const clock = fakeClock();
      const start = clock.now;
      const awaitChannelMessages = quietHold(clock);

      await opHold(stubClient({ awaitChannelMessages }), "general", 7, 150_000, null, runtime);

      expect(clock.elapsedFrom(start)).toBe(150_000);
      vi.restoreAllMocks();
    }
  });
});
