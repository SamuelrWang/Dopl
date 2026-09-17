// @vitest-environment jsdom
/**
 * 🔒 **WHAT A SEARCH ROW HANDS THE SURFACE, ON THE WORKSPACE HOST (F-714,
 * 2026-09-17).** Samuel's ruling for a message row is *"open channel at that seq
 * so the transcript jumps"*.
 *
 * ⚠ **THE PROPERTY IS THE HOST'S MAPPING, NOT THE JUMP.** Resolving a seq to a
 * message id and moving the scroller is `use-message-jump.ts`, pinned in its own
 * file against the real rows; what only THIS file can fail on is that the seq
 * travels from the popup's item to `ChannelSurface.initialSeq` **for a message
 * row and for no other kind** — the shape that was inert for a release when the
 * citation pill shipped with no host passing `onJumpToSeq`
 * (`transcript-citation.test.tsx` carries that scar).
 *
 * ⚠ **ITS OWN FILE BECAUSE `channels-core.test.tsx` SITS AT 307 LINES AGAINST A
 * 500-LINE CAP AND MOCKS EVERY DATA HOOK ONE BY ONE.** This one mocks
 * `channel-surface-data.ts` instead — one seam for all of them — because the
 * question here is about props, not about reads.
 *
 * MUTATION-VERIFY: 3 reverts, 3 failures, 0 vacuous (2026-09-17) — dropping
 * `initialSeq` from the surface mount, dropping the `kind === "messages"` guard,
 * and failing to CLEAR the seq on a later non-message row each turn a case here
 * red.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channel, ME, WS } from "./test-fixtures";
import type { SearchItem } from "@/features/search/contracts";

const CH = "ch-1";

const HITS: Record<string, SearchItem> = {
  message: {
    id: "msg-4821",
    kind: "messages",
    title: "Priya Shah",
    containerId: WS,
    channelId: CH,
    seq: 4821,
  },
  channel: { id: CH, kind: "channels", title: "q4", containerId: WS, channelId: CH },
};

vi.mock("../hooks/use-channels", () => ({
  useChannels: () => ({ channels: [channel()], loading: false, refetch: () => {} }),
}));
// ⚠ ONE SEAM FOR EVERY READ THIS PAGE MAKES — the surface's own data module.
vi.mock("./channel-surface-data", () => ({
  useChannelSurfaceData: () => ({ openThread: null, rows: [], gate: {} }),
}));
vi.mock("./overlays", () => ({ ChannelsOverlays: () => null }));
vi.mock("./channel-manage", () => ({
  ChannelsManageActions: () => null,
  ChannelsCreateDialogs: () => null,
}));
/** The sidebar is the popup's host here — two buttons, two kinds of row. */
vi.mock("./sidebar", () => ({
  ChannelsSidebar: ({
    onSearchNavigate,
  }: {
    onSearchNavigate: (item: SearchItem) => void;
  }) => (
    <div>
      {Object.entries(HITS).map(([name, item]) => (
        <button key={name} onClick={() => onSearchNavigate(item)}>
          take {name}
        </button>
      ))}
    </div>
  ),
}));
/** The surface reports the one prop under test. */
vi.mock("./channel-surface", () => ({
  ChannelSurface: ({ initialSeq }: { initialSeq?: number | null }) => (
    <span data-testid="initial-seq">{initialSeq ?? "none"}</span>
  ),
}));

import { ChannelsCore } from "./channels-core";

const TestLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href}>{children}</a>
);

afterEach(cleanup);

function renderCore() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChannelsCore
        workspaceId={WS}
        workspaceSlug="acme"
        currentUserId={ME}
        role="owner"
        Link={TestLink}
      />
    </QueryClientProvider>
  );
}

const seq = () => screen.getByTestId("initial-seq").textContent;

describe("a search row's seq reaches the surface", () => {
  it("passes the seq of a MESSAGE row", () => {
    renderCore();
    expect(seq()).toBe("none");
    fireEvent.click(screen.getByText("take message"));
    expect(seq()).toBe("4821");
  });

  it("🔒 passes NOTHING for a row that names no message", () => {
    renderCore();
    fireEvent.click(screen.getByText("take channel"));
    // ⚠ A channel row opens the room and leaves the transcript alone.
    expect(seq()).toBe("none");
  });

  it("🔒 CLEARS a held seq when the next row is not a message", () => {
    renderCore();
    fireEvent.click(screen.getByText("take message"));
    expect(seq()).toBe("4821");
    fireEvent.click(screen.getByText("take channel"));
    // ⚠ A stale seq would scroll the next room's transcript to a coordinate
    // that means nothing in it.
    expect(seq()).toBe("none");
  });
});
