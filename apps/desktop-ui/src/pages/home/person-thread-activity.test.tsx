import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import {
  CHANNEL_ID,
  SERIES,
  openChannelRecord,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * THE HOME INFO TAB'S **THREAD ACTIVITY** STRIP.
 *
 * ⚠ SPLIT OUT OF `person-info-tab.test.tsx` ON 2026-09-01, when that file hit
 * the 500-line cap (§1 — `eslint.config.mjs › max-lines`) and could not absorb
 * the `openChannelRecord` gate every case on this page now needs. **A file at
 * the cap is relieved by a whole responsibility, not shaved**: the strip is a
 * different subject from the info CARD — it reads a workspace series endpoint
 * and renders a quantised ramp, where the card is a curated fact list with a
 * write behind it.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, like its parent suite, and for the same reason:
 * the strip's read is keyed by the CHANNEL, which only the real page resolves.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: (props: {
      slots?: {
        infoTab?: (ctx: {
          gate: { begin: () => void; end: () => void };
        }) => React.ReactNode;
      };
    }) => (
      <div data-testid="channel-surface">
        {props.slots?.infoTab?.({ gate: { begin: () => {}, end: () => {} } })}
      </div>
    ),
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected request: ${path}`))
  );
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) =>
      apiRequest(path, opts),
    getAuthState: () =>
      Promise.resolve({ signedIn: true, userId: "user-1" }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
});

describe("Channel activity", () => {
  /**
   * ⚠ THE VISUAL IS THE CHANNELS PAGE'S DENSITY STRIP AND THE NUMBERS ARE REAL
   * (Samuel, 2026-08-25 — this replaces the plain thread LIST the first pass
   * substituted). What it must never become again is that page's FIXTURE: the
   * squares are only honest because a counted series is behind them.
   */
  it("draws the strip from the channel-scoped series", async () => {
    renderHome();
    await openChannelRecord();
    expect(await screen.findByText("Channel activity")).toBeInTheDocument();

    const strip = await screen.findByRole("img", { name: /Messages in this channel/i });
    expect(strip.children).toHaveLength(SERIES.days.length);
    // The label states the unit and the window — a bare row of squares that
    // names neither is a picture the reader has to guess at.
    expect(strip.getAttribute("aria-label")).toContain("per day");
  });

  it("⚠ asks for THIS CHANNEL, not the container's whole workspace", async () => {
    renderHome();
    await openChannelRecord();
    await screen.findByRole("img", { name: /Messages in this channel/i });

    // ⚠ THE **WORKSPACE** series, named by its path: /home's Overview face has
    // its own `/api/home/overview-series` read that fires on first paint, so a
    // bare `/overview-series` match finds a different endpoint (2026-09-01).
    const call = bridgeCalls(apiRequest).find((c) =>
      c.path.includes("/api/workspaces/") && c.path.includes("/overview-series")
    );
    expect(call).toBeTruthy();
    // Today a link container holds exactly one channel, so an UNSCOPED series
    // would look identical and be right by accident. It would stop being right
    // the moment that stops being true, and nothing would say so.
    expect(call?.path).toContain(`channelId=${CHANNEL_ID}`);
    expect(call?.path).toContain("metric=messages");
  });

  it("renders NO squares rather than empty wells when the series cannot answer", async () => {
    // A stale persisted cache entry, or a read still in flight: an empty well
    // is a MEASURED zero, so 31 of them would state a month of quiet nobody
    // counted.
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path.split("?")[0].endsWith("/overview-series")
          ? Promise.resolve(ok({ metric: "messages" }))
          : (routes(path, opts) ??
            Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await openChannelRecord();
    expect(await screen.findByText("Channel activity")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Messages in this channel/i })
    ).toBeNull();
  });
});
