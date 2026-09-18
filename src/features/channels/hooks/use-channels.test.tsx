// @vitest-environment jsdom
/**
 * 🔒 **THE LIST'S ABSENT-FALLBACK IS ONE FROZEN ARRAY, NOT A FRESH `[]`**
 * (2026-09-17). `?? []` stood in two places here — inside the TanStack `select`
 * and on the hook's own return — so `channels` was a NEW array identity on every
 * render whenever the key was absent or the read was still pending, and every
 * memo, effect dep and `React.memo` keyed on it churned.
 *
 * ⚠ THE PENDING CASE IS THE ONE THAT BITES, because it is every first paint of
 * every surface that reads this hook.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY_CHANNELS } from "../types";
import { channelsPath } from "../client/query-keys";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-client", () => ({ apiRequest: request }));

const { useChannels } = await import("./use-channels");

const WS = "11111111-2222-3333-4444-555555555555";

function harness(seed?: unknown) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seed !== undefined) {
    // The cache key `use-api-query-core.ts` builds: `[path, workspaceId, query]`.
    client.setQueryData([channelsPath(), WS, { scope: "container" }], seed);
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useChannels(WS), { wrapper });
}

describe("the absent-channels fallback", () => {
  it("hands back the SAME array across renders while the read is pending", () => {
    request.mockReturnValue(new Promise(() => {}));
    const view = harness();

    const first = view.result.current.channels;
    view.rerender();
    const second = view.result.current.channels;

    expect(first).toBe(second);
    expect(first).toBe(EMPTY_CHANNELS);
  });

  /** 🔒 §8 STALE CACHE — a payload written by a bundle that had no `channels`
   *  key. The `select` runs on it, and its fallback must be the same array too. */
  it("hands back the SAME array for a cached payload with no `channels` key", async () => {
    request.mockReturnValue(new Promise(() => {}));
    const view = harness({ pendingLinks: [] });

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const first = view.result.current.channels;
    view.rerender();

    expect(view.result.current.channels).toBe(first);
    expect(first).toBe(EMPTY_CHANNELS);
  });
});
