// @vitest-environment jsdom
/**
 * THE ROSTER'S DOT — the surface Samuel was actually looking at when he reported the flicker
 * ("*in the members listings, sometimes i see myself go offline*", 2026-09-08).
 *
 * ⚠ THE PARTITION IS THE ASSERTION, not the ring. `MemberRoster` splits the list into present
 * members and an `Offline` rule with the rest, so "am I online" is observable as WHICH SIDE OF
 * THE RULE my row is on — no ARIA on the avatar needed, and no test reaching into a class name.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { member, ME, PEER } from "./test-fixtures";

// ⚠ PARTIAL MOCK. `getSpaBridge` is what the avatar's image bridge calls; replacing the whole
// module would delete it and this file would be testing a render failure, not presence.
vi.mock("@/shared/lib/spa-bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/spa-bridge")>()),
  isSpaRenderer: () => spaRenderer,
}));

let spaRenderer = false;
afterEach(() => {
  cleanup();
  spaRenderer = false;
});

const { MemberRoster } = await import("./member-roster");

/** Everyone the server says is offline, including the viewer. */
const ALL_OFFLINE = [
  member({ userId: ME, displayName: "Sam Wang", agentOnline: false }),
  member({ userId: PEER, displayName: "Diana Taylor", agentOnline: false }),
];

/**
 * The names rendered ABOVE the `Offline` rule, in order.
 *
 * ⚠ THE SELECTOR IS THE NAME SPAN'S OWN RECIPE (`text-body font-semibold text-text-primary`),
 * not `font-semibold` alone — the avatar's initials fallback is also a bold span, and matching
 * it made this helper report a phantom "D" beside "Diana Taylor".
 */
function onlineNames(): string[] {
  const names = Array.from(
    document.querySelectorAll("span.text-body.font-semibold.text-text-primary")
  );
  const rule = screen.queryByText("Offline");
  if (!rule) return names.map((el) => el.textContent ?? "");
  return names
    // Node.DOCUMENT_POSITION_FOLLOWING: the rule comes AFTER this name.
    .filter((el) => el.compareDocumentPosition(rule) & 4)
    .map((el) => el.textContent ?? "");
}

describe("the viewer's own row while the desktop app is open", () => {
  it("DESKTOP: I am online even though the server row says offline", () => {
    spaRenderer = true;
    render(<MemberRoster members={ALL_OFFLINE} viewerUserId={ME} />);
    // ⚠ THE POINT OF THE WHOLE CHANGE. This SPA rendering IS the Slack definition of active, so
    // there is no state in which the operator watches their own dot blink.
    expect(onlineNames()).toEqual(["Sam Wang"]);
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("DESKTOP: the peer is NOT promoted with me", () => {
    spaRenderer = true;
    render(<MemberRoster members={ALL_OFFLINE} viewerUserId={ME} />);
    expect(onlineNames()).not.toContain("Diana Taylor");
  });

  it("WEB: my row reads the server flag like everyone else's", () => {
    spaRenderer = false;
    render(<MemberRoster members={ALL_OFFLINE} viewerUserId={ME} />);
    expect(onlineNames()).toEqual([]);
  });

  it("no viewerUserId: the roster is exactly the server's answer", () => {
    spaRenderer = true;
    render(<MemberRoster members={ALL_OFFLINE} />);
    expect(onlineNames()).toEqual([]);
  });
});

describe("everyone else's row is the server's `agentOnline`", () => {
  it("a stale lastSeenAt does NOT drag an online member offline", () => {
    // The old client-side arithmetic drew this row offline: same payload, older stamp, newer
    // clock. Re-deriving refreshed nothing and decayed toward OFFLINE the later a refetch was.
    spaRenderer = false;
    render(
      <MemberRoster
        members={[
          member({
            userId: PEER,
            displayName: "Diana Taylor",
            agentOnline: true,
            lastSeenAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          }),
        ]}
        viewerUserId={ME}
      />
    );
    expect(onlineNames()).toEqual(["Diana Taylor"]);
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("an `away` machine (server false) reads offline however fresh its stamp", () => {
    spaRenderer = false;
    render(
      <MemberRoster
        members={[
          member({
            userId: PEER,
            displayName: "Diana Taylor",
            agentOnline: false,
            lastSeenAt: new Date().toISOString(),
          }),
        ]}
        viewerUserId={ME}
      />
    );
    expect(onlineNames()).toEqual([]);
  });
});
