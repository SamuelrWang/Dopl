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

import {
  fetchBaseList,
  fetchChannelGrants,
  setChannelGrant,
  EMPTY_GRANTS,
} from "./api";

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

describe("fetchChannelGrants — the settings read (M1)", () => {
  it("passes the three keys through", async () => {
    apiRequest.mockResolvedValue({
      canManage: true,
      channels: [{ id: "chan-1", name: "engineering", isDirect: false }],
      grants: { "chan-1": { level: "visible", guestWrite: true } },
    });

    expect(await fetchChannelGrants("kb-1", "ws-1")).toEqual({
      canManage: true,
      channels: [{ id: "chan-1", name: "engineering", isDirect: false }],
      grants: { "chan-1": { level: "visible", guestWrite: true } },
    });
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/knowledge/bases/kb-1/channel-grants",
      { workspaceId: "ws-1" }
    );
  });

  it("STALE CACHE / OLD SERVER: every deleted key falls back CLOSED", async () => {
    // Keys deleted, not nulled — a payload written before this route existed
    // does not carry them. ⚠ The fallback direction is the property: an unknown
    // `canManage` must render the READ-ONLY summary, never an editor over an
    // invented channel list.
    apiRequest.mockResolvedValue({});

    expect(await fetchChannelGrants("kb-1")).toEqual({
      canManage: false,
      channels: [],
      grants: {},
    });
  });
});

describe("setChannelGrant — the write (M1)", () => {
  it("PUTs the end state and returns the STORED grant", async () => {
    apiRequest.mockResolvedValue({
      channelId: "chan-1",
      grant: { level: "agent_only", guestWrite: false },
    });

    const out = await setChannelGrant(
      "kb-1",
      { channelId: "chan-1", level: "agent_only", guestWrite: true },
      "ws-1"
    );

    // The server normalised `guestWrite` away; the client believes the answer.
    expect(out).toEqual({ level: "agent_only", guestWrite: false });
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/knowledge/bases/kb-1/channel-grants",
      {
        method: "PUT",
        body: { channelId: "chan-1", level: "agent_only", guestWrite: true },
        workspaceId: "ws-1",
      }
    );
  });

  it("returns null for `none` — the cache patch reads that as 'remove the key'", async () => {
    apiRequest.mockResolvedValue({ channelId: "chan-1", grant: null });
    expect(
      await setChannelGrant(
        "kb-1",
        { channelId: "chan-1", level: "none", guestWrite: false },
        "ws-1"
      )
    ).toBeNull();
  });
});
