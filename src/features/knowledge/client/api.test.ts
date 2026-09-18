/**
 * `fetchBaseList` — the client parse of `GET /api/knowledge/bases`, focused on
 * the `channelGrants` sibling key.
 *
 * Stale-cache (§8): the desktop list is IndexedDB-persisted, so the first launch
 * after an update reads payloads written by the previous bundle, carrying no
 * `channelGrants` key. The parse falls back to `EMPTY_GRANTS`. Fixtures use the
 * key-DELETED shape, not null or {}.
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
    // deleted, not null or {} — a pre-grant cache entry does not carry the key.
    delete stale.channelGrants;
    apiRequest.mockResolvedValue(stale);

    const out = await fetchBaseList("ws-1");
    expect(out.channelGrants).toBe(EMPTY_GRANTS);
    expect(out.channelGrants).toEqual({});
    expect(out.bases).toHaveLength(2);
  });
});

describe("fetchChannelGrants — the settings read (M1)", () => {
  it("passes the four keys through", async () => {
    apiRequest.mockResolvedValue({
      canManage: true,
      channelScopeAllowed: true,
      channels: [{ id: "chan-1", name: "engineering", isDirect: false }],
      grants: { "chan-1": { level: "visible", guestWrite: true } },
    });

    expect(await fetchChannelGrants("kb-1", "ws-1")).toEqual({
      canManage: true,
      channelScopeAllowed: true,
      channels: [{ id: "chan-1", name: "engineering", isDirect: false }],
      grants: { "chan-1": { level: "visible", guestWrite: true } },
    });
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/api/knowledge/bases/kb-1/channel-grants",
      { workspaceId: "ws-1" }
    );
  });

  it("STALE CACHE / OLD SERVER: every deleted key falls back CLOSED", async () => {
    // keys deleted, not nulled. The fallback DIRECTION is the property: an
    // unknown `canManage` must render the read-only summary, never an editor
    // over an invented channel list.
    apiRequest.mockResolvedValue({});

    expect(await fetchChannelGrants("kb-1")).toEqual({
      canManage: false,
      // an absent `channelScopeAllowed` renders NO channel control at all.
      channelScopeAllowed: false,
      channels: [],
      grants: {},
    });
  });

  it("🔒 carries a STANDARD workspace's refusal through as `false`", async () => {
    apiRequest.mockResolvedValue({
      canManage: false,
      channelScopeAllowed: false,
      channels: [],
      grants: {},
    });
    expect((await fetchChannelGrants("kb-1", "ws-1")).channelScopeAllowed).toBe(
      false
    );
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

    // the server normalised `guestWrite` away; the client believes the answer.
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
