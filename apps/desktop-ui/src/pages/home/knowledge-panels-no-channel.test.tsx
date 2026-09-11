import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import {
  LINK_WORKSPACE_ID,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * /home → KNOWLEDGE, WITH NO CHANNELS AT ALL — every account's first day
 * (2026-09-10, the new-user flow).
 *
 * 🔒 **THE PANE USED TO RETURN THE "pick one on the left" EMPTY STATE INSTEAD OF
 * ITSELF**, so the whole face was one sentence beside an empty list: the caller's
 * own Personal bases — a HOME-workspace read that needs no channel — were off
 * screen, and so was the button that makes one. `channel === null` is a fact about
 * the CONTAINER, so it takes the SHARED section and nothing else.
 *
 * ⚠ **ITS OWN FILE BECAUSE `knowledge-panels.test.tsx` MEASURED 497 LINES**
 * against the 500-line cap on the day this landed (§1: a file at the cap cannot
 * absorb a new block). `wc -l` it before repeating that number. Same harness, same
 * page mount, same `openKnowledge` gesture — nothing here is a second opinion
 * about the fixtures.
 *
 * ⚠ THE CHANNEL SURFACE IS STUBBED, for the reason the sibling file gives:
 * `vi.mock` is hoisted per file and its factory may not close over imports, so
 * each suite declares its own.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

beforeEach(() => {
  apiRequest.mockReset();
  // ⚠ AN EMPTY CHANNELS PAYLOAD IS THE WHOLE SETUP. `selected` falls back to
  // `visible[0]`, so with no rows there is no channel — the same `null` a legacy
  // unbound link produces, reached the way a real new account reaches it.
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> =>
      path.split("?")[0] === "/api/home/channels"
        ? Promise.resolve(ok({ channels: [], pendingLinks: [] }))
        : (routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`)))
  );
  installBridge({ apiRequest });
});

async function openKnowledge(): Promise<void> {
  await screen.findByRole("tab", { name: "Overview" });
  fireEvent.click(screen.getByText("Knowledge"));
}

describe("🔒 with no channels, PERSONAL still renders", () => {
  it("lists the caller's own home-shelf bases", async () => {
    renderHome();
    await openKnowledge();

    expect(await screen.findByText("Fundraise memos")).toBeInTheDocument();
  });

  it("🔒 offers the Personal create button — the face is not read-only", async () => {
    // The point of the fix: a new account must be able to MAKE its first base. A
    // pane that only listed would still be a dead end.
    renderHome();
    await openKnowledge();
    await screen.findByText("Fundraise memos");

    const personal = screen.getByRole("region", { name: "Personal" });
    expect(
      within(personal).getByRole("button", { name: /Knowledge base/ })
    ).toBeEnabled();
  });

  it("says the sentence about the SHARED section, and only there", async () => {
    renderHome();
    await openKnowledge();
    await screen.findByText("Fundraise memos");

    expect(await screen.findByText(/pick one on the left/)).toBeInTheDocument();
    // 🔒 ONE SECTION LEFT, NOT TWO AND NOT ZERO — the shared panel is replaced by
    // the sentence; Personal is a region as before.
    expect(screen.getAllByRole("region").length).toBe(1);
    expect(
      screen.queryByText("Nothing is shared into this channel yet.")
    ).not.toBeInTheDocument();
  });

  it("⚠ never asks for a container's bases, and never paints the skeleton", async () => {
    // 🔒 THE SKELETON HALF IS THE REGRESSION THIS GUARDS. The container query is
    // `enabled: channel !== null`, so its `data` stays `undefined` forever — a
    // pane that waited on it would show "Loading knowledge" until the reader left
    // the tab. UNAVAILABLE read as PENDING, one scope over from F-339.
    renderHome();
    await openKnowledge();
    await screen.findByText("Fundraise memos");

    const containerReads = bridgeCalls(apiRequest).filter(
      (c) =>
        c.path.split("?")[0] === "/api/knowledge/bases" &&
        c.opts.workspaceId === LINK_WORKSPACE_ID
    );
    expect(containerReads).toHaveLength(0);
    expect(screen.queryByText("Loading knowledge")).not.toBeInTheDocument();
  });
});
