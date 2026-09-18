import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge } from "#/test-utils/bridge";
import { openChannelRecord, renderHome, routes } from "./home-test-harness";

/**
 * ⚠ SPLIT OUT OF `home-info-tab.test.tsx`, WHICH IS AT THE 500-LINE CAP
 * (INVARIANTS §1) — `home-info-peers` and `home-info-description` set the precedent
 * and the reason is theirs: a file at the cap cannot absorb a case, let alone the
 * paragraph explaining one. Read-only; nothing here writes.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ ONE STUB, SHARED (`surface-slot-fixtures.tsx`), and the factory imports it
// itself because `vi.mock` is hoisted above every import.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
  apiRequest.mockImplementation((path: string, opts = {}) => routes(path, opts));
});

/**
 * THE MENTIONS SECTION — THE HOME-SPACE PARITY GAP (2026-09-15).
 *
 * ⚠ THE SLOT WAS BROKEN, NOT THE QUERY: the surface reads mentions for every mount,
 * home included and already container-scoped, and the injected tab dropped them. So
 * these assert the tab RENDERS the section in the right PLACE — not the list's own
 * behaviour, which `channels/components/mentions-list.test.tsx` owns.
 */
describe("home info tab — Mentions", () => {
  // ⚠ NO LOCAL `beforeEach`: the file's top-level one installs the stub server.
  // ⚠ THESE CASES PINNED A COLLAPSED DISCLOSURE for about an hour (aria-expanded, a
  // click to open, a position inside Channel info); Samuel superseded it the same day
  // — top-level category, list OPEN, below the activity strip. Rewritten rather than
  // deleted so the overruled shape stays on the record.

  it("is a TOP-LEVEL CATEGORY with its own heading, not a row inside Channel info", async () => {
    renderHome();
    await openChannelRecord();
    const heading = await screen.findByText("Mentions");
    expect(screen.queryByRole("button", { name: /^Mentions/ })).toBeNull();
    // A PEER of the other two headings, which is what "top-level" means here.
    const channelInfo = await screen.findByText("Channel info");
    expect(heading.tagName).toBe(channelInfo.tagName);
  });

  it("renders the list OPEN — no dropdown, nothing to click first", async () => {
    renderHome();
    await openChannelRecord();
    // `mentions-list.tsx`'s own empty copy, visible with no interaction: the REAL
    // list mounted, already open.
    expect(
      await screen.findByText("No messages tag you in this channel yet.")
    ).toBeTruthy();
  });

  it("sits BELOW the activity section, above Members", async () => {
    // ⚠ THE ORDER IS THE TAB'S RULING (HEADER → CHANNEL INFO → CHANNEL ACTIVITY →
    // MENTIONS → MEMBERS). It shipped between the card and the strip this morning
    // and Samuel moved it below on his live review the same hour; the case is
    // repointed rather than dropped, because POSITION is the thing that regresses.
    // A section merely PRESENT is not the same as a section in the right place.
    renderHome();
    await openChannelRecord();
    const channelInfo = await screen.findByText("Channel info");
    const mentions = await screen.findByText("Mentions");
    const activity = await screen.findByText("Channel activity");
    const follows = (a: HTMLElement, b: HTMLElement) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(channelInfo, activity)).toBeTruthy();
    expect(follows(activity, mentions)).toBeTruthy();
  });
});
