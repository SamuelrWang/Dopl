import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { installBridge, ok } from "#/test-utils/bridge";
import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import {
  CHANNEL,
  CHANNEL_ID,
  HOME,
  MEMBERS,
  THREADS,
  isAccountChannels,
  openChannelRecord,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * THE HOME INFO CARD's DESCRIPTION ROW (ruling, Samuel, 2026-09-15).
 *
 * ⚠ **"DESCRIPTION" IS THE PRODUCT'S WORD FOR `channels.topic`** — no new
 * column, and the same row is pinned on the workspace pane in
 * `src/features/channels/components/info-tab.test.tsx`.
 *
 * ⚠ **SPLIT OUT OF `home-info-tab.test.tsx`, WHICH IS AT THE 500-LINE CAP**
 * (INVARIANTS §1), on `home-info-peers.test.tsx`'s precedent. Read-only
 * stub — nothing here writes.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, not the component: the row reads `channel.topic`
 * off the `/api/channels` cache, so a direct mount would hand it a static prop
 * and pass while the read was broken.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ ONE STUB, FIVE FILES (`surface-slot-fixtures.tsx`). It imports the REAL
// `ChannelInfoTabContext`, so a slot contract that grows a field fails to compile here
// instead of passing against a hand-written shape that has quietly gone stale.
// ⚠ THE FACTORY IMPORTS IT ITSELF: `vi.mock` is hoisted above every import, so a
// top-level binding is not in scope yet when this runs.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

/** Serve the account surface with the shipped channel carrying `topic`. */
function serve(topic: string): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (isAccountChannels(path)) return Promise.resolve(ok(HOME));
      if (bare === "/api/channels") {
        return Promise.resolve(
          ok({ channels: [{ ...CHANNEL, topic, infoCard: EMPTY_INFO_CARD }] })
        );
      }
      if (bare === `/api/channels/${CHANNEL_ID}/members`) {
        return Promise.resolve(ok(MEMBERS));
      }
      if (bare === `/api/channels/${CHANNEL_ID}/tasks`) {
        return Promise.resolve(ok(THREADS));
      }
      return (
        routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
      );
    }
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

describe("Channel info — Description", () => {
  it("shows the channel's own topic under the word the product uses", async () => {
    serve("Everything about the raise");
    renderHome();
    await openChannelRecord();
    await screen.findByText("Description");
    expect(screen.getByText("Everything about the raise")).toBeTruthy();
  });

  it("says None — not a blank cell — when there is no description", async () => {
    // ⚠ THE COMMON ROW, not an edge case: `channels.topic` is `NOT NULL DEFAULT
    // ''` and every home channel created before 2026-09-15 has `""`.
    serve("");
    renderHome();
    await openChannelRecord();
    await screen.findByText("Description");
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("sits between Name and Creator, and carries no × — it is a FIXED row", async () => {
    serve("Everything about the raise");
    renderHome();
    await openChannelRecord();
    const name = await screen.findByText("Name");
    const description = screen.getByText("Description");
    const creator = screen.getByText("Creator");
    expect(
      name.compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      description.compareDocumentPosition(creator) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Remove Description from this card",
      })
    ).toBeNull();
  });
});
