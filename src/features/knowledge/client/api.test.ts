/**
 * `fetchBaseList` — the client parse of `GET /api/knowledge/bases`, focused on
 * the `channelGrants` sibling key (M0, Home Knowledge Panels).
 *
 * ⚠ STALE-CACHE (§8): the desktop list is IndexedDB-persisted, so the first
 * launch after an update reads payloads written by the previous bundle — which
 * carry NO `channelGrants` key at all. A raw read would crash the pane over a
 * field that is decoration here. The parse falls back to `EMPTY_GRANTS`. This
 * copies `pages/home/person-info-tab.test.tsx`'s key-DELETED shape: the field is
 * deleted from the fixture, not set to null or {}.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/api-client", () => ({
  apiRequest,
  ApiError: class ApiError extends Error {},
}));

import { fetchBaseList, EMPTY_GRANTS } from "./api";

const FULL = {
  bases: [{ id: "kb-1" }, { id: "kb-2" }],
  ownerNames: {},
  baseStats: {},
  kbStorageLimit: null,
  starredBaseIds: [],
  channelGrants: {
    "kb-1": { level: "visible", guestWrite: true },
  },
};

beforeEach(() => apiRequest.mockReset());

describe("fetchBaseList › channelGrants", () => {
  it("passes channelGrants through when the server sends it", async () => {
    apiRequest.mockResolvedValue(FULL);
    const out = await fetchBaseList("ws-1", "chan-1");
    expect(out.channelGrants).toEqual({
      "kb-1": { level: "visible", guestWrite: true },
    });
  });

  it("sends ?channelId= only when a channel is given", async () => {
    apiRequest.mockResolvedValue(FULL);

    await fetchBaseList("ws-1", "chan-7");
    expect(apiRequest).toHaveBeenLastCalledWith("/api/knowledge/bases", {
      workspaceId: "ws-1",
      query: { channelId: "chan-7" },
    });

    await fetchBaseList("ws-1");
    expect(apiRequest).toHaveBeenLastCalledWith("/api/knowledge/bases", {
      workspaceId: "ws-1",
      query: undefined,
    });
  });

  it("STALE CACHE: a payload with the channelGrants key DELETED falls back to EMPTY_GRANTS", async () => {
    const stale: Record<string, unknown> = { ...FULL };
    // Deleted, not null or {} — a pre-grant cache entry does not carry the key.
    delete stale.channelGrants;
    apiRequest.mockResolvedValue(stale);

    const out = await fetchBaseList("ws-1");
    expect(out.channelGrants).toBe(EMPTY_GRANTS);
    expect(out.channelGrants).toEqual({});
    // The rest of the payload is unharmed.
    expect(out.bases).toHaveLength(2);
  });
});
