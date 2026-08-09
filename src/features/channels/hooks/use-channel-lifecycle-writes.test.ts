/**
 * The five channel LIFECYCLE writes, driven through TanStack's own
 * framework-free `MutationObserver` — the same runner
 * `shared/hooks/use-api-mutation.test.ts` uses, and for the same reason: the
 * order onMutate → mutationFn → onSuccess/onError → onSettled IS the contract,
 * and a hand-rolled runner would pin a re-implementation of it. `npm test` has
 * no DOM (component tests are `renderToStaticMarkup`), which is why the configs
 * are exported apart from the hook that wires them.
 *
 * WHAT THESE CASES PROTECT, in audit terms:
 *  - C-27: every config hands the refetch coordinator's gate to `settleWith`,
 *    and releases it on the THROWING path too. Losing that silently re-opens
 *    the race the deleted override maps used to hide.
 *  - C-21 / §7 rule 4: every cache key is built from the draft's own
 *    `channelId`, so a write cannot land in the channel the user switched to.
 *  - C-16 / F-173: delete keeps TWO mechanics. A DM soft-closes and MUST keep
 *    its transcript cached; anything else hard-deletes and MUST evict.
 */

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiPathKey, apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import type { ChannelsCache } from "../lib/optimistic-cache";
import type { Channel } from "../types";
import {
  archiveConfig,
  deleteConfig,
  dropChannelRow,
  joinConfig,
  leaveConfig,
  visibilityConfig,
  type LifecycleWriteDeps,
} from "./use-channel-lifecycle-writes";

const WORKSPACE = "ws-1";
const CHANNEL = "c-1";
const OTHER = "c-2";
const ME = "u-me";

const LIST = "/api/channels";
const ACTIVE_KEY = apiQueryKey(LIST, { workspaceId: WORKSPACE });
const ARCHIVED_KEY = apiQueryKey(LIST, {
  workspaceId: WORKSPACE,
  query: { include: "archived" },
});
const MESSAGES_KEY = apiQueryKey(`${LIST}/${CHANNEL}/messages`, {
  workspaceId: WORKSPACE,
  query: { limit: 200 },
});
const MEMBERS_KEY = apiQueryKey(`${LIST}/${CHANNEL}/members`, {
  workspaceId: WORKSPACE,
});
const THREADS_KEY = apiQueryKey(`${LIST}/${CHANNEL}/tasks`, {
  workspaceId: WORKSPACE,
});

function channel(over: Partial<Channel> = {}): Channel {
  return {
    id: CHANNEL,
    workspaceId: WORKSPACE,
    slug: "general",
    name: "general",
    topic: "",
    visibility: "public",
    isDirect: false,
    directPeer: null,
    createdBy: ME,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberCount: 2,
    lastMessageAt: null,
    role: "owner",
    isMember: true,
    lastReadAt: null,
    unread: false,
    myNotifyScope: null,
    myAgentToolProfile: null,
    onlineMemberCount: 0,
    ...over,
  };
}

/** A transport the test settles by hand, so "before the network answers" is a
 *  real assertion rather than a timing hope. */
function deferredRequest() {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const calls: Array<{ path: string; opts: unknown }> = [];
  const request = ((path: string, opts: unknown) => {
    calls.push({ path, opts });
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, calls };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  client: QueryClient;
  deps: LifecycleWriteDeps;
  gate: MutationGate & { begun: number; ended: number };
  evicted: string[];
  deselects: () => number;
}

function harness(rows: Channel[]): Harness {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(ACTIVE_KEY, {
    channels: rows.filter((c) => c.archivedAt === null),
  } satisfies ChannelsCache);
  client.setQueryData(ARCHIVED_KEY, { channels: rows } satisfies ChannelsCache);
  const gate = {
    begun: 0,
    ended: 0,
    begin() {
      gate.begun += 1;
    },
    end() {
      gate.ended += 1;
    },
  };
  const evicted: string[] = [];
  let deselects = 0;
  return {
    client,
    gate,
    evicted,
    deselects: () => deselects,
    deps: {
      workspaceId: WORKSPACE,
      gate,
      onDeselect: () => {
        deselects += 1;
      },
      evictChannel: (id) => {
        evicted.push(id);
        for (const tail of ["messages", "members", "tasks"]) {
          client.removeQueries({
            queryKey: apiPathKey(`${LIST}/${id}/${tail}`),
          });
        }
      },
    },
  };
}

/** Ids in the ACTIVE list variant (the read that excludes archived rows). */
function activeIds(h: Harness): string[] {
  return (
    h.client.getQueryData<ChannelsCache>(ACTIVE_KEY)?.channels.map((c) => c.id) ??
    []
  );
}

/** Rows in the ARCHIVED variant (the read that holds everything). */
function allRows(h: Harness): Channel[] {
  return h.client.getQueryData<ChannelsCache>(ARCHIVED_KEY)?.channels ?? [];
}

function row(h: Harness, id = CHANNEL): Channel | undefined {
  return allRows(h).find((c) => c.id === id);
}

function run<TDraft, TData>(
  h: Harness,
  config: UseApiMutationConfig<TDraft, TData>,
  draft: TDraft
) {
  const { request, settle, fail, calls } = deferredRequest();
  const observer = new MutationObserver(
    h.client,
    buildApiMutationOptions<TDraft, TData>(h.client, request, config)
  );
  const inFlight = observer.mutate(draft).catch(() => "rejected");
  return { inFlight, settle, fail, calls };
}

describe("dropChannelRow", () => {
  it("removes only the named row, and leaves an unloaded cache alone", () => {
    const cache: ChannelsCache = {
      channels: [channel(), channel({ id: OTHER })],
    };
    expect(dropChannelRow(cache, CHANNEL)?.channels.map((c) => c.id)).toEqual([
      OTHER,
    ]);
    // Seeding a one-row list into a query that never loaded would render
    // exactly that row and then flip when the read lands.
    expect(dropChannelRow(undefined, CHANNEL)).toBeUndefined();
  });

  /**
   * THE ROLLBACK CASES ABOVE CANNOT SEE THIS FAIL. `onMutate` snapshots the
   * cache object by reference and `onError` writes that same reference back,
   * so an in-place edit would "restore" the optimistic value and every
   * `toEqual(before)` in this file would still pass — `before` is that same
   * live object. So the purity is asserted directly, once.
   */
  it("never edits the input cache in place — the rollback is a reference restore", () => {
    const rows = [channel(), channel({ id: OTHER })];
    const cache: ChannelsCache = { channels: rows };
    const next = dropChannelRow(cache, CHANNEL);

    expect(next).not.toBe(cache);
    expect(next?.channels).not.toBe(cache.channels);
    expect(cache.channels.map((c) => c.id)).toEqual([CHANNEL, OTHER]);
    // The surviving row is the SAME object, so nothing else re-renders.
    expect(next?.channels[0]).toBe(rows[1]);
  });
});

describe("archive — the two list variants move in OPPOSITE directions", () => {
  it("drops the row from the ACTIVE list and stamps it in the ARCHIVED one, before the network answers", async () => {
    const h = harness([channel(), channel({ id: OTHER })]);
    const { inFlight, settle, calls } = run(h, archiveConfig(h.deps), {
      channelId: CHANNEL,
      archived: true,
    });
    await flush();

    expect(calls[0].path).toBe(`${LIST}/${CHANNEL}`);
    expect(calls[0].opts).toMatchObject({
      method: "PATCH",
      body: { archived: true },
      workspaceId: WORKSPACE,
    });
    expect(activeIds(h)).toEqual([OTHER]);
    expect(row(h)?.archivedAt).not.toBeNull();
    expect([h.gate.begun, h.gate.ended]).toEqual([1, 0]);

    settle({ channel: channel({ archivedAt: "2026-08-08T00:00:00.000Z" }) });
    await inFlight;
    expect(h.gate.ended).toBe(1);
  });

  it("unarchiving clears the stamp, so the archived tab's own filter drops it", async () => {
    const h = harness([channel({ archivedAt: "2026-08-01T00:00:00.000Z" })]);
    const { inFlight, settle } = run(h, archiveConfig(h.deps), {
      channelId: CHANNEL,
      archived: false,
    });
    await flush();
    expect(row(h)?.archivedAt).toBeNull();
    settle({ channel: channel() });
    await inFlight;
  });

  it("restores BOTH variants verbatim when the PATCH fails, and still opens the gate", async () => {
    const h = harness([channel(), channel({ id: OTHER })]);
    const before = {
      active: h.client.getQueryData(ACTIVE_KEY),
      archived: h.client.getQueryData(ARCHIVED_KEY),
    };
    const { inFlight, fail } = run(h, archiveConfig(h.deps), {
      channelId: CHANNEL,
      archived: true,
    });
    await flush();
    expect(activeIds(h)).toEqual([OTHER]);

    fail(new Error("network"));
    await inFlight;
    expect(h.client.getQueryData(ACTIVE_KEY)).toEqual(before.active);
    expect(h.client.getQueryData(ARCHIVED_KEY)).toEqual(before.archived);
    expect(h.gate.ended).toBe(1);
  });
});

describe("visibility — the header pill's value, on the click", () => {
  it("flips visibility in every list variant before the network answers", async () => {
    const h = harness([channel({ visibility: "public" })]);
    const { inFlight, settle, calls } = run(h, visibilityConfig(h.deps), {
      channelId: CHANNEL,
      visibility: "private",
    });
    await flush();

    expect(calls[0].opts).toMatchObject({ body: { visibility: "private" } });
    expect(
      h.client.getQueryData<ChannelsCache>(ACTIVE_KEY)?.channels[0].visibility
    ).toBe("private");
    expect(row(h)?.visibility).toBe("private");

    settle({ channel: channel({ visibility: "private" }) });
    await inFlight;
  });

  it("rolls the pill back to the stored value when the PATCH fails", async () => {
    const h = harness([channel({ visibility: "public" })]);
    const { inFlight, fail } = run(h, visibilityConfig(h.deps), {
      channelId: CHANNEL,
      visibility: "private",
    });
    await flush();
    expect(row(h)?.visibility).toBe("private");

    fail(new Error("network"));
    await inFlight;
    expect(row(h)?.visibility).toBe("public");
  });
});

describe("delete — one verb, two mechanics (C-16 / F-173)", () => {
  function seedChannelCaches(h: Harness) {
    h.client.setQueryData(MESSAGES_KEY, { messages: [{ id: "m-1" }] });
    h.client.setQueryData(MEMBERS_KEY, { members: [] });
    h.client.setQueryData(THREADS_KEY, { tasks: [] });
  }

  it("HARD-deletes a non-DM: the row goes at once, the per-channel caches are evicted ON SUCCESS", async () => {
    const h = harness([channel(), channel({ id: OTHER })]);
    seedChannelCaches(h);
    const { inFlight, settle, calls } = run(h, deleteConfig(h.deps), {
      channelId: CHANNEL,
      isDirect: false,
    });
    await flush();

    expect(calls[0].opts).toMatchObject({ method: "DELETE" });
    expect(activeIds(h)).toEqual([OTHER]);
    // NOT evicted yet: a removed query has no snapshot, so evicting before the
    // server says yes would make a failed delete unrecoverable.
    expect(h.evicted).toEqual([]);
    expect(h.client.getQueryData(MESSAGES_KEY)).toBeDefined();

    settle(undefined);
    await inFlight;
    expect(h.evicted).toEqual([CHANNEL]);
    expect(h.client.getQueryData(MESSAGES_KEY)).toBeUndefined();
    expect(h.client.getQueryData(MEMBERS_KEY)).toBeUndefined();
    expect(h.client.getQueryData(THREADS_KEY)).toBeUndefined();
    expect(h.deselects()).toBe(1);
  });

  it("SOFT-closes a DM: it leaves the list but KEEPS its transcript cached", async () => {
    const h = harness([channel({ isDirect: true, visibility: "private" })]);
    seedChannelCaches(h);
    const { inFlight, settle } = run(h, deleteConfig(h.deps), {
      channelId: CHANNEL,
      isDirect: true,
    });
    await flush();
    expect(activeIds(h)).toEqual([]);

    settle(undefined);
    await inFlight;
    // Reopening revives the SAME row with its full history, so evicting here
    // would throw away live product state.
    expect(h.evicted).toEqual([]);
    expect(h.client.getQueryData(MESSAGES_KEY)).toBeDefined();
    expect(h.deselects()).toBe(1);
  });

  it("puts the row back, evicts nothing and never deselects when the DELETE fails", async () => {
    const h = harness([channel()]);
    seedChannelCaches(h);
    const { inFlight, fail } = run(h, deleteConfig(h.deps), {
      channelId: CHANNEL,
      isDirect: false,
    });
    await flush();
    expect(activeIds(h)).toEqual([]);

    fail(new Error("network"));
    await inFlight;
    expect(activeIds(h)).toEqual([CHANNEL]);
    expect(h.evicted).toEqual([]);
    expect(h.client.getQueryData(MESSAGES_KEY)).toBeDefined();
    expect(h.deselects()).toBe(0);
    expect(h.gate.ended).toBe(1);
  });
});

describe("join / leave", () => {
  it("join flips isMember on the click, so the composer replaces the join bar", async () => {
    const h = harness([channel({ isMember: false, role: null })]);
    const { inFlight, settle, calls } = run(h, joinConfig(h.deps), {
      channelId: CHANNEL,
      userId: ME,
    });
    await flush();

    expect(calls[0].path).toBe(`${LIST}/${CHANNEL}/members`);
    expect(calls[0].opts).toMatchObject({
      method: "POST",
      body: { userId: ME },
    });
    expect(row(h)?.isMember).toBe(true);
    expect(row(h)?.role).toBe("member");

    settle({ member: { userId: ME } });
    await inFlight;
    expect(h.gate.ended).toBe(1);
  });

  it("leaving a PUBLIC channel keeps the row, read-only", async () => {
    const h = harness([channel({ visibility: "public" })]);
    const { inFlight, settle } = run(h, leaveConfig(h.deps), {
      channelId: CHANNEL,
      userId: ME,
      visibility: "public",
    });
    await flush();
    expect(row(h)?.isMember).toBe(false);
    expect(row(h)?.role).toBeNull();
    expect(activeIds(h)).toEqual([CHANNEL]);

    settle(undefined);
    await inFlight;
    expect(h.deselects()).toBe(1);
  });

  it("leaving a PRIVATE channel removes the row — the caller can no longer see it", async () => {
    const h = harness([channel({ visibility: "private" }), channel({ id: OTHER })]);
    const { inFlight, settle } = run(h, leaveConfig(h.deps), {
      channelId: CHANNEL,
      userId: ME,
      visibility: "private",
    });
    await flush();
    expect(activeIds(h)).toEqual([OTHER]);

    settle(undefined);
    await inFlight;
    expect(h.deselects()).toBe(1);
  });

  it("a failed leave restores membership and never deselects", async () => {
    const h = harness([channel({ visibility: "private" })]);
    const { inFlight, fail } = run(h, leaveConfig(h.deps), {
      channelId: CHANNEL,
      userId: ME,
      visibility: "private",
    });
    await flush();
    expect(activeIds(h)).toEqual([]);

    fail(new Error("network"));
    await inFlight;
    expect(activeIds(h)).toEqual([CHANNEL]);
    expect(h.deselects()).toBe(0);
    expect(h.gate.ended).toBe(1);
  });
});

describe("every write is keyed by the channel captured AT SUBMIT (C-21)", () => {
  it("a draft naming one channel touches neither the other row nor the other channel's caches", async () => {
    const h = harness([channel(), channel({ id: OTHER, visibility: "public" })]);
    const visible = run(h, visibilityConfig(h.deps), {
      channelId: OTHER,
      visibility: "private",
    });
    await flush();
    expect(row(h, OTHER)?.visibility).toBe("private");
    expect(row(h, CHANNEL)?.visibility).toBe("public");
    visible.settle({ channel: channel({ id: OTHER, visibility: "private" }) });
    await visible.inFlight;

    const removed = run(h, deleteConfig(h.deps), {
      channelId: OTHER,
      isDirect: false,
    });
    removed.settle(undefined);
    await removed.inFlight;
    expect(h.evicted).toEqual([OTHER]);
    expect(activeIds(h)).toEqual([CHANNEL]);
  });
});
