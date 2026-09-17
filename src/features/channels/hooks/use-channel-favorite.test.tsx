// @vitest-environment jsdom
/**
 * 🔒 **THE BOOKMARK / PIN WRITE, END TO END THROUGH THE REAL MUTATION LAYER
 * (Samuel, 2026-09-15: *"i noticed that the bookmark icon like alway breaks and
 * is super buggy. we need to make sure that is fixed for the pin icon"*).**
 *
 * ⚠ **IT HAD NO COVERAGE AT ALL, AND THAT IS WHY IT COULD BREAK IN SILENCE.**
 * Measured 2026-09-15: `components/channel-surface.test.tsx` and
 * `components/channels-core.test.tsx` both stub the write as
 * `favorite: { mutate: () => {} }`, and nothing else in either tree mounts it —
 * so every surface asserted that the BUTTON is there and none of them that
 * pressing it does anything. This file drives the real hook over a real
 * `QueryClient` with only the TRANSPORT mocked.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { channelKeys } from "../client/query-keys";
import { channel, WS } from "../components/test-fixtures";

const request = vi.hoisted(() => vi.fn());
vi.mock("../client/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client/api")>()),
  channelRequest: request,
}));

const { useChannelPreferenceWrites } = await import(
  "./use-channel-preference-writes"
);

const CH = channel();
const LIST_KEY = channelKeys.list().entry({ workspaceId: WS });
const GATE = { begin: () => {}, end: () => {} };

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(LIST_KEY, {
    channels: [{ ...CH, myFavoritedAt: null }],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => useChannelPreferenceWrites({ workspaceId: WS, gate: GATE }),
    { wrapper }
  );
  const listFavorite = () =>
    (
      client.getQueryData(LIST_KEY) as {
        channels: Array<{ myFavoritedAt: string | null }>;
      }
    ).channels[0].myFavoritedAt;
  return { client, view, listFavorite };
}

describe("the favourite write — the cache the pin reads", () => {
  it("paints the channel list at once and keeps it after the write settles", async () => {
    request.mockResolvedValue({ member: {} });
    const { view, listFavorite } = harness();
    view.result.current.favorite.mutate({ channelId: CH.id, favorite: true });
    // ⚠ OPTIMISTIC: the icon fills on the click, not on the round trip.
    await waitFor(() => expect(listFavorite()).not.toBeNull());
    await waitFor(() => expect(view.result.current.favorite.pending).toBe(false));
    expect(listFavorite()).not.toBeNull();
  });

  it("rolls the channel list back when the write fails", async () => {
    request.mockRejectedValue(new Error("nope"));
    const { view, listFavorite } = harness();
    view.result.current.favorite.mutate({ channelId: CH.id, favorite: true });
    await waitFor(() => expect(view.result.current.favorite.pending).toBe(false));
    expect(listFavorite()).toBeNull();
  });

  /**
   * 🔒 **AND THE FACT REACHES /home THROUGH A CACHE BRIDGE, NOT THROUGH THIS
   * HOOK.** `GET /api/home/channels` carries the same pin for the channel list's
   * **Pinned** well, and this write neither patched nor invalidated it — the bug
   * behind Samuel's *"super buggy"*. ⚠ **THE FIX IS NOT HERE AND MUST NOT BE**:
   * INVARIANTS §1 forbids `channels → home`, and this write is the workspace
   * channels page's too. /home watches the cache this hook DOES own —
   * `pages/home/use-home-channel-sync.ts`, the shape `use-home-unread-refresh.ts`
   * already held — and its suite is `pages/home/relationship-list.test.tsx`.
   */
});

