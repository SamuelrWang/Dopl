// @vitest-environment jsdom
/**
 * `useSetChannelGrant` + `patchChannelGrantInCache` — the scope-A grant write's
 * cache half. Hand-rolled, not `use-api-mutation.ts`, because knowledge reads
 * aren't on `useApiQuery` (INVARIANTS §8 rule 6), so this file pins the rules
 * that layer would have enforced: the patch MERGES (every sibling map on the
 * base-list entry survives); `null` REMOVES the key rather than storing a
 * level; a failure restores the SNAPSHOT; a cold entry is DECLINED by the patch
 * and picked up by `coldKeys`; the UNSCOPED base list is never touched.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  KnowledgeApiError: class extends Error {},
  fetchBaseList: vi.fn(),
  fetchEntry: vi.fn(),
  fetchTree: vi.fn(),
  setBaseStar: vi.fn(),
  fetchChannelGrants: vi.fn(),
  setChannelGrant: vi.fn(),
}));

import { setChannelGrant, type ChannelGrantSettings, type KnowledgeBaseList } from "./api";
import { knowledgeBasesQueryKey } from "./hooks";
import {
  knowledgeChannelGrantsQueryKey,
  patchChannelGrantInCache,
  useSetChannelGrant,
} from "./hooks-channel-grants";

const mockWrite = vi.mocked(setChannelGrant);

const WS = "ws-1";
const BASE_ID = "kb-1";
const CHAN = "chan-1";
const SETTINGS_KEY = knowledgeChannelGrantsQueryKey(WS, BASE_ID);
const SCOPED_KEY = knowledgeBasesQueryKey(WS, CHAN);
const UNSCOPED_KEY = knowledgeBasesQueryKey(WS);

function settings(
  grants: ChannelGrantSettings["grants"]
): ChannelGrantSettings {
  return {
    canManage: true,
    channels: [{ id: CHAN, name: "engineering", isDirect: false }],
    grants,
  };
}

/** Whole cache entry, not just grants — the merge assertions read the siblings. */
function baseList(
  channelGrants: KnowledgeBaseList["channelGrants"]
): KnowledgeBaseList {
  return {
    bases: [{ id: BASE_ID }, { id: "kb-2" }] as KnowledgeBaseList["bases"],
    ownerNames: { "u-other": "Dana Reed" },
    baseStats: {
      "kb-1": { entryCount: 12, lastEntryUpdatedAt: null, storageBytes: 900 },
    },
    kbStorageLimit: 5_000_000,
    starredBaseIds: ["kb-2"],
    channelGrants,
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});

afterEach(() => client.clear());

describe("patchChannelGrantInCache", () => {
  it("writes the grant into BOTH shapes, keyed the way each one keys it", async () => {
    client.setQueryData(SETTINGS_KEY, settings({}));
    client.setQueryData(SCOPED_KEY, baseList({}));

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "visible", guestWrite: true },
    });

    // Settings entry: one base, keyed by CHANNEL.
    expect(
      client.getQueryData<ChannelGrantSettings>(SETTINGS_KEY)?.grants
    ).toEqual({ [CHAN]: { level: "visible", guestWrite: true } });
    // Channel-scoped base list: one channel, keyed by BASE.
    expect(
      client.getQueryData<KnowledgeBaseList>(SCOPED_KEY)?.channelGrants
    ).toEqual({ [BASE_ID]: { level: "visible", guestWrite: true } });
  });

  it("MERGES — every sibling map on the base-list entry survives", async () => {
    client.setQueryData(SCOPED_KEY, baseList({}));

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "agent_only", guestWrite: false },
    });

    const after = client.getQueryData<KnowledgeBaseList>(SCOPED_KEY);
    expect(after?.bases).toHaveLength(2);
    expect(after?.ownerNames).toEqual({ "u-other": "Dana Reed" });
    expect(after?.starredBaseIds).toEqual(["kb-2"]);
    expect(after?.kbStorageLimit).toBe(5_000_000);
  });

  it("REMOVES the key for a null grant — absence is the third state", async () => {
    client.setQueryData(
      SETTINGS_KEY,
      settings({ [CHAN]: { level: "visible", guestWrite: true } })
    );
    client.setQueryData(
      SCOPED_KEY,
      baseList({ [BASE_ID]: { level: "visible", guestWrite: true } })
    );

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: null,
    });

    const s = client.getQueryData<ChannelGrantSettings>(SETTINGS_KEY);
    expect(CHAN in (s?.grants ?? {})).toBe(false);
    const l = client.getQueryData<KnowledgeBaseList>(SCOPED_KEY);
    expect(BASE_ID in (l?.channelGrants ?? {})).toBe(false);
  });

  it("leaves OTHER bases and OTHER channels alone", async () => {
    client.setQueryData(
      SCOPED_KEY,
      baseList({ "kb-2": { level: "agent_only", guestWrite: false } })
    );
    const otherChannel = knowledgeBasesQueryKey(WS, "chan-other");
    client.setQueryData(otherChannel, baseList({}));

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "visible", guestWrite: false },
    });

    expect(
      client.getQueryData<KnowledgeBaseList>(SCOPED_KEY)?.channelGrants
    ).toEqual({
      "kb-2": { level: "agent_only", guestWrite: false },
      [BASE_ID]: { level: "visible", guestWrite: false },
    });
    // A grant on chan-1 says nothing about chan-other's view.
    expect(
      client.getQueryData<KnowledgeBaseList>(otherChannel)?.channelGrants
    ).toEqual({});
  });

  it("NEVER touches the UNSCOPED base list — it carries no channelGrants at all", async () => {
    // Absent param ⇒ absent key (§9). Writing one here would invent a
    // channel-scoped payload nobody asked for.
    client.setQueryData(UNSCOPED_KEY, baseList({}));

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "visible", guestWrite: false },
    });

    expect(
      client.getQueryData<KnowledgeBaseList>(UNSCOPED_KEY)?.channelGrants
    ).toEqual({});
  });

  it("matches a channel-scoped entry by PREFIX, so a longer segment is still patched", async () => {
    const extended = ["knowledge", `bases:${WS}:channel:${CHAN}:starred`] as const;
    client.setQueryData(extended, baseList({}));

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "visible", guestWrite: false },
    });

    expect(
      client.getQueryData<KnowledgeBaseList>(extended)?.channelGrants
    ).toEqual({ [BASE_ID]: { level: "visible", guestWrite: false } });
  });

  it("declines a COLD entry rather than seeding one", async () => {
    // Nothing in the cache: `setQueryData` with an undefined `prev` must not
    // fabricate a list, which would render as "this workspace has no bases".
    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE_ID,
      channelId: CHAN,
      grant: { level: "visible", guestWrite: false },
    });
    expect(client.getQueryData(SCOPED_KEY)).toBeUndefined();
    expect(client.getQueryData(SETTINGS_KEY)).toBeUndefined();
  });
});

describe("useSetChannelGrant", () => {
  it("patches from the SERVER'S answer, not the requested one", async () => {
    client.setQueryData(SETTINGS_KEY, settings({}));
    // Asked for guestWrite at agent_only; the server normalised it away.
    mockWrite.mockResolvedValue({ level: "agent_only", guestWrite: false });

    const { result } = renderHook(() => useSetChannelGrant(BASE_ID, WS), {
      wrapper,
    });
    result.current.mutate({
      channelId: CHAN,
      level: "agent_only",
      guestWrite: true,
    });

    await waitFor(() =>
      expect(
        client.getQueryData<ChannelGrantSettings>(SETTINGS_KEY)?.grants[CHAN]
      ).toEqual({ level: "agent_only", guestWrite: false })
    );
  });

  it("restores the SNAPSHOT on failure", async () => {
    const before = settings({ [CHAN]: { level: "agent_only", guestWrite: false } });
    client.setQueryData(SETTINGS_KEY, before);
    mockWrite.mockRejectedValue(new Error("write failed"));

    const { result } = renderHook(() => useSetChannelGrant(BASE_ID, WS), {
      wrapper,
    });
    result.current.mutate({ channelId: CHAN, level: "visible", guestWrite: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData<ChannelGrantSettings>(SETTINGS_KEY)).toEqual(before);
  });

  it("names the ?channelId= variant through coldKeys when it never loaded", async () => {
    client.setQueryData(SETTINGS_KEY, settings({}));
    mockWrite.mockResolvedValue({ level: "visible", guestWrite: false });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSetChannelGrant(BASE_ID, WS), {
      wrapper,
    });
    result.current.mutate({ channelId: CHAN, level: "visible", guestWrite: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: SCOPED_KEY,
      exact: true,
    });
  });

  it("does NOT invalidate a WARM channel-scoped list — the patch already covered it", async () => {
    client.setQueryData(SETTINGS_KEY, settings({}));
    client.setQueryData(SCOPED_KEY, baseList({}));
    mockWrite.mockResolvedValue({ level: "visible", guestWrite: false });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSetChannelGrant(BASE_ID, WS), {
      wrapper,
    });
    result.current.mutate({ channelId: CHAN, level: "visible", guestWrite: false });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
