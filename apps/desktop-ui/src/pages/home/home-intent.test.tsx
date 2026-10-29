import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "@/features/channels/types";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, installBridge, renderWithProviders } from "#/test-utils/bridge";
import HomePage from "./index";
import { homeChannelPath, readHomeIntent } from "./home-intent";
import { CHANNEL, CHANNEL_ID, HOME, LINK_WORKSPACE_ID, withHome } from "./home-test-harness";

/**
 * 🔒 `/home?channel=<workspaceId>&thread=…&seq=…` LANDS ON THAT CHANNEL (2026-10-29,
 * Samuel: "Yes, fix it"). The shell's redirect off a `kind='link'` container's
 * workspace URL (`components/app-shell/app-shell.tsx`) ends here, so this is the
 * other half of `app-shell-guest.test.tsx`: the row is selected, the Channel face
 * raised, the thread and seq handed to the surface — then the query is cleared.
 *
 * ⚠ A NEWER ROW FROM ANOTHER CONTAINER SITS FIRST, so "the named row is selected"
 * cannot pass on the page's own first-row fallback.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/features/channels/components/channel-surface-standalone", () => ({
  StandaloneChannelSurface: (props: {
    channel: { id: string };
    initialThreadId?: string | null;
    initialSeq?: number | null;
  }) => (
    <div
      data-testid="channel-surface"
      data-channel={props.channel.id}
      data-initial-thread={props.initialThreadId ?? "none"}
      data-initial-seq={props.initialSeq ?? "none"}
    />
  ),
}));

const NEWER: Channel = {
  ...CHANNEL,
  id: "other-channel",
  workspaceId: "ws-other",
  name: "Someone Else",
  container: { id: "ws-other", kind: "link", segment: "someone-else-cc22dd" },
  lastMessageAt: new Date().toISOString(),
};

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    withHome({ ...HOME, channels: [...HOME.channels, NEWER] })
  );
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) => apiRequest(path, opts),
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
  globalThis.localStorage?.clear();
});

function renderAt(path: string) {
  return renderWithProviders(
    [
      { path: "/home", element: <HomePage /> },
      { path: "/:workspaceSegment", element: <p>Workspace page</p> },
    ],
    [path]
  );
}

describe("/home's channel intent", () => {
  it("round-trips through the URL, and drops a junk seq or an empty thread", () => {
    const path = homeChannelPath("ws-1", "t-1", 42);
    expect(readHomeIntent(new URLSearchParams(path.split("?")[1]))).toEqual({
      workspaceId: "ws-1",
      threadId: "t-1",
      seq: 42,
    });
    expect(readHomeIntent(new URLSearchParams("channel=ws-1&thread=&seq=-3"))).toEqual({
      workspaceId: "ws-1",
      threadId: null,
      seq: null,
    });
    expect(readHomeIntent(new URLSearchParams("thread=t-1"))).toBeNull();
  });

  it("selects the named container's row, opens the thread at the seq, then clears the query", async () => {
    const { router } = renderAt(homeChannelPath(LINK_WORKSPACE_ID, "thread-9", 4821));

    const surface = await screen.findByTestId("channel-surface");
    expect(surface.dataset.channel).toBe(CHANNEL_ID);
    expect(surface.dataset.initialThread).toBe("thread-9");
    expect(surface.dataset.initialSeq).toBe("4821");
    expect(screen.getByRole("tab", { name: "Channel", selected: true })).toBeTruthy();
    // Consumed once: Back or a reload must not re-raise a thread the operator left.
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.location.pathname).toBe("/home");
  });

  it("an unknown container still lands on /home and clears the query", async () => {
    const { router } = renderAt(homeChannelPath("ws-gone"));

    // The Channel face is raised on whatever /home selects; no error, no route.
    await screen.findByRole("tab", { name: "Channel", selected: true });
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.location.pathname).toBe("/home");
    expect(screen.queryByText(/could not open home/i)).toBeNull();
  });
});
