// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ref-counted shared realtime channel registry. ⚠ The mock mirrors the dangerous
 * parts of the realtime-js v2 contract the registry must respect:
 *   - `.on("postgres_changes", …)` after `.subscribe()` THROWS;
 *   - `client.channel(topic)` RETURNS THE EXISTING channel object for a topic
 *     the client still remembers (it does NOT mint a fresh one);
 *   - `removeChannel()` is async — the topic is forgotten only after the leave
 *     settles, and the removed channel's status callback gets a late CLOSED.
 */

interface MockChannel {
  topic: string;
  bindings: Array<{ table: string; handler: () => void }>;
  statusCb: ((status: string) => void) | null;
  subscribed: boolean;
  lastStatus: string | null;
  on: (type: string, cfg: { table: string }, handler: () => void) => MockChannel;
  subscribe: (cb: (status: string) => void) => MockChannel;
}

const channels: MockChannel[] = [];
const removed: MockChannel[] = [];
/** Topics the mock client still remembers — channel(topic) dedupes on this. */
const liveByTopic = new Map<string, MockChannel>();

function makeChannel(topic: string): MockChannel {
  const chan: MockChannel = {
    topic,
    bindings: [],
    statusCb: null,
    subscribed: false,
    lastStatus: null,
    on(_type, cfg, handler) {
      if (chan.subscribed) {
        throw new Error(`tried to bind after subscribe on ${topic}`);
      }
      chan.bindings.push({ table: cfg.table, handler });
      return chan;
    },
    subscribe(cb) {
      if (chan.subscribed) {
        // ⚠ Real realtime-js silently no-ops (callback NOT stored).
        return chan;
      }
      chan.subscribed = true;
      chan.statusCb = (status: string) => {
        chan.lastStatus = status;
        cb(status);
      };
      return chan;
    },
  };
  channels.push(chan);
  liveByTopic.set(topic, chan);
  return chan;
}

vi.mock("@/shared/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    channel: (topic: string) =>
      liveByTopic.get(topic) ?? makeChannel(topic),
    removeChannel: (chan: MockChannel) => {
      removed.push(chan);
      if (chan.lastStatus === "CHANNEL_ERROR" || chan.lastStatus === "TIMED_OUT") {
        // ⚠ Phoenix leave() on a channel that can't push fires leave-ok
        // SYNCHRONOUSLY — close lands before removeChannel returns. Common
        // reconnect path.
        if (liveByTopic.get(chan.topic) === chan) liveByTopic.delete(chan.topic);
        chan.statusCb?.("CLOSED");
      } else {
        queueMicrotask(() => {
          if (liveByTopic.get(chan.topic) === chan) liveByTopic.delete(chan.topic);
          chan.statusCb?.("CLOSED");
        });
      }
      return Promise.resolve("ok");
    },
  }),
}));

import {
  __resetSharedChannelsForTests,
  __sharedChannelCountForTests,
  subscribeSharedWorkspaceTables,
} from "./shared-channel-registry";
// ⚠ The REAL constants, never a copy: this file's job below is to prove the
// channels page is live in the SPA, and a hardcoded list here would keep
// passing while the tables the hooks actually pass drifted out from under it.
import {
  CHANNEL_TABLES,
  CONSENT_TABLES,
  PRESENCE_TABLES,
} from "@/features/channels/constants";

const TABLES = ["knowledge_bases", "knowledge_entries"] as const;

function lastChannel(): MockChannel {
  return channels[channels.length - 1];
}

/** Run pending microtasks (mock's async removeChannel settlement). */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  __resetSharedChannelsForTests();
  channels.length = 0;
  removed.length = 0;
  liveByTopic.clear();
  vi.useRealTimers();
});

describe("subscribeSharedWorkspaceTables", () => {
  it("shares one channel across subscribers with the same key", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", a);
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", b);

    expect(channels).toHaveLength(1);
    expect(__sharedChannelCountForTests()).toBe(1);
    expect(lastChannel().bindings.map((x) => x.table)).toEqual([...TABLES]);
  });

  it("keeps different keys on different channels and unique topics", () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", vi.fn());
    subscribeSharedWorkspaceTables("ws2", TABLES, "knowledge", vi.fn());
    subscribeSharedWorkspaceTables("ws1", TABLES, "skills", vi.fn());
    expect(channels).toHaveLength(3);
    expect(new Set(channels.map((c) => c.topic)).size).toBe(3);
  });

  it("fans a table event out to every listener", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", a);
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", b);

    lastChannel().bindings[0].handler();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("fires all listeners on SUBSCRIBED (catch-up refetch)", () => {
    const a = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", a);
    lastChannel().statusCb?.("SUBSCRIBED");
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("immediately fires a listener that joins an already-live channel", () => {
    const early = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", early);
    lastChannel().statusCb?.("SUBSCRIBED");

    const late = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "knowledge", late);
    expect(late).toHaveBeenCalledTimes(1);
    expect(early).toHaveBeenCalledTimes(1);
    expect(channels).toHaveLength(1);
  });

  it("tears the channel down after the last unsubscribe (with grace)", async () => {
    const off1 = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const off2 = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());

    off1();
    vi.advanceTimersByTime(5_000);
    expect(removed).toHaveLength(0); // one subscriber still active

    off2();
    expect(removed).toHaveLength(0); // grace window
    vi.advanceTimersByTime(1_001);
    expect(removed).toHaveLength(1);
    expect(__sharedChannelCountForTests()).toBe(0);
    // ⚠ The removed channel's late CLOSED must not resurrect anything.
    await settle();
    expect(__sharedChannelCountForTests()).toBe(0);
  });

  it("revives within the grace window without re-joining (StrictMode)", () => {
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    off();
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    vi.advanceTimersByTime(5_000);
    expect(removed).toHaveLength(0);
    expect(channels).toHaveLength(1);
  });

  it("reconnects with backoff on CHANNEL_ERROR using a FRESH topic", async () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const first = lastChannel();

    first.statusCb?.("CHANNEL_ERROR");
    expect(channels).toHaveLength(1); // not yet — backoff pending
    vi.advanceTimersByTime(500);
    await settle();
    expect(channels).toHaveLength(2); // fresh channel object
    expect(removed).toContain(first); // old one released
    // ⚠ Topic reuse returns the old subscribed channel and throws on .on().
    expect(lastChannel().topic).not.toBe(first.topic);

    lastChannel().statusCb?.("TIMED_OUT");
    vi.advanceTimersByTime(999);
    expect(channels).toHaveLength(2);
    vi.advanceTimersByTime(2);
    expect(channels).toHaveLength(3);
  });

  it("ignores the stale CLOSED our own cleanup emits (no reconnect storm)", async () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const first = lastChannel();
    first.statusCb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(500); // reconnect → releases first, joins second
    const second = lastChannel();
    second.statusCb?.("SUBSCRIBED");

    await settle();
    // ⚠ A healthy second channel must be left alone.
    vi.advanceTimersByTime(60_000);
    expect(channels).toHaveLength(2);
    expect(second.subscribed).toBe(true);
    expect(removed).not.toContain(second);
  });

  it("SUBSCRIBED cancels a pending external reconnect (internal recovery)", () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const chan = lastChannel();
    chan.statusCb?.("CHANNEL_ERROR"); // arms 500ms retry
    chan.statusCb?.("SUBSCRIBED"); // realtime-js recovered on its own
    vi.advanceTimersByTime(60_000);
    expect(channels).toHaveLength(1);
    expect(removed).toHaveLength(0);
  });

  it("recovered SUBSCRIBED resets the backoff ladder", async () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    lastChannel().statusCb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(500);
    await settle();
    lastChannel().statusCb?.("SUBSCRIBED");
    lastChannel().statusCb?.("CLOSED");
    vi.advanceTimersByTime(500);
    await settle();
    expect(channels).toHaveLength(3);
  });

  it("suppresses reconnect during the grace window, revives on resubscribe", async () => {
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const chan = lastChannel();
    chan.statusCb?.("SUBSCRIBED");
    off();
    chan.statusCb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(999); // would be within backoff rung anyway
    expect(channels).toHaveLength(1); // no join for a doomed entry

    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    await settle();
    expect(channels).toHaveLength(2);
    expect(lastChannel().topic).not.toBe(chan.topic);
  });

  it("does not fan out events from a stale generation's bindings", async () => {
    const listener = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", listener);
    const first = lastChannel();
    first.statusCb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(500); // second generation joins
    // Buffered event on the old channel arrives after replacement.
    first.bindings[0].handler();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener does not starve its siblings", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", bad);
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", good);
    lastChannel().bindings[0].handler();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe is idempotent", () => {
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    off();
    off();
    vi.advanceTimersByTime(1_001);
    expect(removed).toHaveLength(1);
  });

  it("resubscribing a key right after teardown gets a FRESH topic (leave unsettled)", () => {
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const first = lastChannel();
    first.statusCb?.("SUBSCRIBED"); // joined → its leave will settle async
    off();
    vi.advanceTimersByTime(1_001); // teardown; corpse still in liveByTopic

    // Resubscribe BEFORE the leave settles. A per-entry generation counter
    // would reset and mint the corpse's topic — channel() would return the
    // leaving corpse whose subscribe() no-ops, leaving the key dead.
    const listener = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", listener);
    const fresh = lastChannel();
    expect(fresh).not.toBe(first);
    expect(fresh.topic).not.toBe(first.topic);
    expect(fresh.statusCb).not.toBeNull(); // subscribe really registered
    fresh.statusCb?.("SUBSCRIBED");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("synchronous leave-close during reconnect does not arm a spurious retry", () => {
    subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    const first = lastChannel();
    first.statusCb?.("CHANNEL_ERROR");
    vi.advanceTimersByTime(500);
    // connect() released `first` (errored → CLOSED delivered synchronously
    // into the OLD status callback during the release). With the
    // generation bumped first, that CLOSED is stale noise.
    const second = lastChannel();
    expect(second).not.toBe(first);
    second.statusCb?.("SUBSCRIBED");
    // No pending retry should exist to tear down the healthy channel.
    vi.advanceTimersByTime(60_000);
    expect(removed).not.toContain(second);
    expect(channels).toHaveLength(2);
  });

  it("error-then-full-unsubscribe cancels the armed retry (no ghost join)", () => {
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
    lastChannel().statusCb?.("SUBSCRIBED");
    lastChannel().statusCb?.("CHANNEL_ERROR"); // arms 500ms retry
    off(); // last listener leaves with retry pending
    vi.advanceTimersByTime(600); // retry window passes during grace
    expect(channels).toHaveLength(1); // no join for a doomed entry
    vi.advanceTimersByTime(500); // grace expires → teardown
    expect(channels).toHaveLength(1);
  });

  it("SPA bridge: events feed listeners; watch follows subscriptions", () => {
    const events: Array<(e: { workspaceId: string; table: string }) => void> = [];
    const watches: Array<string | null> = [];
    const offSpy = vi.fn();
    (window as unknown as { dopl?: unknown }).dopl = {
      // Full capability surface — getSpaBridge() keys on apiRequest/
      // getAuthState/openExternal, so a partial object (like the legacy
      // wrapper's) is treated as the WEB, not the SPA.
      apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
      getAuthState: () => Promise.resolve({ signedIn: true, userId: "u1" }),
      openExternal: () => Promise.resolve({ ok: true }),
      syncWatch: (ws: string | null) => {
        watches.push(ws);
        return Promise.resolve();
      },
      onSyncEvent: (cb: (e: { workspaceId: string; table: string }) => void) => {
        events.push(cb);
        return offSpy;
      },
    };
    try {
      const a = vi.fn();
      const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", a);
      expect(a).toHaveBeenCalledTimes(1); // mount catch-up
      expect(watches).toEqual(["ws1"]);
      expect(channels).toHaveLength(0); // NO supabase channel in SPA mode

      events[0]({ workspaceId: "ws1", table: "knowledge_bases" });
      expect(a).toHaveBeenCalledTimes(2);
      events[0]({ workspaceId: "ws1", table: "unrelated_table" });
      expect(a).toHaveBeenCalledTimes(2); // filtered
      events[0]({ workspaceId: "ws2", table: "knowledge_bases" });
      expect(a).toHaveBeenCalledTimes(2); // other workspace
      events[0]({ workspaceId: "ws1", table: "" });
      expect(a).toHaveBeenCalledTimes(3); // catch-up broadcast

      off();
      // Unwatch is deferred behind the grace window (navigation churn must
      // not cost a leave/rejoin) — nothing sent yet…
      expect(watches.at(-1)).toBe("ws1");
      vi.advanceTimersByTime(1_001);
      expect(watches.at(-1)).toBeNull();
      expect(offSpy).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as unknown as { dopl?: unknown }).dopl;
    }
  });

  it("SPA bridge: the CHANNELS tables ride it — the SPA is not realtime-dark", () => {
    // F-199: three comments claimed realtime was OFF in the SPA for fifteen
    // days after it stopped being true. RENDERER HALF — the three channels
    // subscriptions take the BRIDGE and each of their five tables reaches its
    // listener. MAIN HALF — those five staying in `main/ui-sync.js ›
    // SYNC_TABLES`, without which the bridge delivers nothing and the
    // transcript freezes — is `dopl-desktop-app/test/ui-sync-tables.test.mjs`.
    const events: Array<(e: { workspaceId: string; table: string }) => void> = [];
    const watches: Array<string | null> = [];
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
      syncWatch: (ws: string | null) => {
        watches.push(ws);
        return Promise.resolve();
      },
      onSyncEvent: (cb: (e: { workspaceId: string; table: string }) => void) => {
        events.push(cb);
        return () => {};
      },
    };
    try {
      // Exactly what the channels page mounts, on the hooks' own table lists.
      const listenerFor = new Map<string, ReturnType<typeof vi.fn>>();
      for (const [tables, prefix] of [
        [CHANNEL_TABLES, "channels-realtime"],
        [CONSENT_TABLES, "channels-consent-realtime"],
        [PRESENCE_TABLES, "channels-presence-realtime"],
      ] as const) {
        const listener = vi.fn();
        subscribeSharedWorkspaceTables("ws1", tables, prefix, listener);
        for (const table of tables) listenerFor.set(table, listener);
      }
      expect(channels).toHaveLength(0); // no supabase socket in SPA mode
      expect(watches).toEqual(["ws1"]); // one watch, deduped across the three
      // The list itself is load-bearing: a table dropped from the constants is
      // a surface that silently stops updating, not a test that goes red.
      expect([...listenerFor.keys()].sort()).toEqual([
        "agent_presence",
        "channel_consent_requests",
        "channel_members",
        "channel_messages",
        "channels",
      ]);
      for (const [table, listener] of listenerFor) {
        const before = listener.mock.calls.length;
        events[0]({ workspaceId: "ws1", table });
        expect(
          listener.mock.calls.length,
          `${table} must reach its listener over the bridge`
        ).toBe(before + 1);
      }
    } finally {
      delete (window as unknown as { dopl?: unknown }).dopl;
    }
  });

  it("SPA bridge: an older main without the sync surface degrades to no-op", () => {
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
      getAuthState: () => Promise.resolve({ signedIn: true, userId: "u1" }),
      openExternal: () => Promise.resolve({ ok: true }),
      // no syncWatch/onSyncEvent — the older-main case
    };
    try {
      const a = vi.fn();
      const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", a);
      expect(channels).toHaveLength(0);
      expect(a).not.toHaveBeenCalled();
      off();
    } finally {
      delete (window as unknown as { dopl?: unknown }).dopl;
    }
  });

  it("LEGACY WRAPPER: a partial window.dopl takes the WEB path (regression)", () => {
    // The pre-1.8 wrapper exposes {isDesktop, platform, versions, channels,
    // sessions} — no apiRequest. It must get a real supabase channel, not
    // the bridge branch (fleet audit 2026-08-03, critical).
    (window as unknown as { dopl?: unknown }).dopl = {
      isDesktop: true,
      platform: "darwin",
      channels: {},
    };
    try {
      subscribeSharedWorkspaceTables("ws1", TABLES, "k", vi.fn());
      expect(channels).toHaveLength(1); // web path: real channel created
    } finally {
      delete (window as unknown as { dopl?: unknown }).dopl;
    }
  });

  it("no listener fires after teardown, even from buffered events", () => {
    const listener = vi.fn();
    const off = subscribeSharedWorkspaceTables("ws1", TABLES, "k", listener);
    const chan = lastChannel();
    chan.statusCb?.("SUBSCRIBED");
    listener.mockClear();
    off();
    vi.advanceTimersByTime(1_001); // teardown
    chan.bindings[0].handler(); // buffered event lands late
    expect(listener).not.toHaveBeenCalled();
  });
});
