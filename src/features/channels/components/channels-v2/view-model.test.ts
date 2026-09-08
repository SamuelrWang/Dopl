/**
 * PRESENCE, AS THE VIEW MODEL DECIDES IT (2026-09-08, Samuel's Slack-parity ruling).
 *
 * ⚠ WHAT THIS FILE IS DEFENDING. `isPresent` used to RE-DERIVE `online` from `lastSeenAt` with
 * the CLIENT's clock on every render, and that was one of the four causes of "*sometimes i see
 * myself go offline, even though my computer is on and dopl is open*". The two facts arrive in
 * the same payload from the same read, so re-deriving refreshes nothing — it re-decides an old
 * fact on a newer clock, and the answer therefore decays toward OFFLINE the longer a refetch is
 * late. The server decides now; the fallback arm exists for exactly one thing and is pinned as
 * such below.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESENCE_ONLINE_WINDOW_MS } from "../../constants";

// ⚠ PARTIAL MOCK. `getSpaBridge` is what the avatar's image bridge calls; replacing the whole
// module would delete it and this file would be testing a render failure, not presence.
vi.mock("@/shared/lib/spa-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/spa-bridge")>()),
  isSpaRenderer: () => spaRenderer,
}));

let spaRenderer = false;
afterEach(() => {
  spaRenderer = false;
});

const { isPresent, isPresentForViewer } = await import("./view-model");

const NOW = Date.UTC(2026, 8, 8, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("isPresent — the SERVER's verdict", () => {
  it("returns the server's true even when lastSeenAt is far outside the window", () => {
    // ⚠ THE REGRESSION THIS FILE EXISTS FOR. A payload that took 5 minutes to arrive (or a
    // roster held through a slow tab) described a machine the server had judged ONLINE, and the
    // client drew it offline anyway. Nothing about the row got fresher by being re-judged.
    expect(
      isPresent({ agentOnline: true, lastSeenAt: ago(5 * 60_000) }, NOW)
    ).toBe(true);
  });

  it("returns the server's false even when lastSeenAt is fresh", () => {
    // The `away` posture is decided server-side and is NEVER on the wire, so a client that
    // trusted `lastSeenAt` could not see a suspended machine at all.
    expect(isPresent({ agentOnline: false, lastSeenAt: ago(1_000) }, NOW)).toBe(
      false
    );
  });

  it("`false` is an ANSWER, not a missing value — the fallback is not consulted", () => {
    expect(isPresent({ agentOnline: false, lastSeenAt: ago(0) }, NOW)).toBe(false);
  });
});

describe("the stale-cached-payload fallback (INVARIANTS §8)", () => {
  // ⚠ THE ONLY CASE IT SERVES: a body cached before `agentOnline` was hydrated into this shape,
  // rehydrated into today's types. Without it the whole roster would read offline after a
  // deploy, for as long as the cache lived.
  it("falls back to the window when the field is ABSENT", () => {
    expect(isPresent({ lastSeenAt: ago(1_000) }, NOW)).toBe(true);
    expect(
      isPresent({ lastSeenAt: ago(PRESENCE_ONLINE_WINDOW_MS + 1) }, NOW)
    ).toBe(false);
  });

  it("falls back when the field is null (a cache that stored it as such)", () => {
    expect(isPresent({ agentOnline: null, lastSeenAt: ago(1_000) }, NOW)).toBe(true);
  });

  it("no stamp and no flag reads OFFLINE — the fail-safe direction", () => {
    expect(isPresent({}, NOW)).toBe(false);
    expect(isPresent({ lastSeenAt: null }, NOW)).toBe(false);
    expect(isPresent({ lastSeenAt: "not a date" }, NOW)).toBe(false);
  });
});

describe("isPresentForViewer — the viewer is online while their app is open", () => {
  const me = { userId: "u-me", agentOnline: false, lastSeenAt: ago(10 * 60_000) };
  const peer = { userId: "u-peer", agentOnline: false, lastSeenAt: ago(10 * 60_000) };

  it("DESKTOP: my own row is online even when the server says otherwise", () => {
    // The SPA rendering IS the Slack definition — app open, machine unlocked. Asking the server
    // whether I am online is a strictly worse source than the fact I am holding.
    spaRenderer = true;
    expect(isPresentForViewer(me, "u-me", NOW)).toBe(true);
  });

  it("DESKTOP: the override applies to ME and to nobody else", () => {
    spaRenderer = true;
    expect(isPresentForViewer(peer, "u-me", NOW)).toBe(false);
  });

  it("WEB: my own row reads the server flag like everyone else's", () => {
    // A browser tab proves nothing about whether the desktop app is open.
    spaRenderer = false;
    expect(isPresentForViewer(me, "u-me", NOW)).toBe(false);
  });

  it("no viewer id is 'no override', never 'nobody is online'", () => {
    spaRenderer = true;
    expect(
      isPresentForViewer({ ...peer, agentOnline: true }, null, NOW)
    ).toBe(true);
    expect(isPresentForViewer(me, undefined, NOW)).toBe(false);
  });
});
