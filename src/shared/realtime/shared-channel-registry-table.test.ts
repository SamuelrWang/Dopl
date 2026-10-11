// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TABLE-AWARE DOORBELL, registry half: every listener call names the table that changed, and a
 * catch-up (fresh SUBSCRIBED, a late joiner, the bridge's empty-table signal) names `null`, which
 * consumers read as "anything may have changed". Kept apart from `shared-channel-registry.test.ts`
 * (at its line cap); the realtime-js mock here is the minimum this needs.
 */

interface MockChannel {
  bindings: Array<{ table: string; handler: () => void }>;
  statusCb: ((status: string) => void) | null;
  on: (type: string, cfg: { table: string }, handler: () => void) => MockChannel;
  subscribe: (cb: (status: string) => void) => MockChannel;
}

const channels: MockChannel[] = [];

vi.mock("@/shared/supabase/browser", () => ({
  getSupabaseBrowser: () => ({
    channel: () => {
      const chan: MockChannel = {
        bindings: [],
        statusCb: null,
        on(_type, cfg, handler) {
          chan.bindings.push({ table: cfg.table, handler });
          return chan;
        },
        subscribe(cb) {
          chan.statusCb = cb;
          return chan;
        },
      };
      channels.push(chan);
      return chan;
    },
    removeChannel: () => Promise.resolve("ok"),
  }),
}));

import {
  __resetSharedChannelsForTests,
  subscribeSharedWorkspaceTables,
} from "./shared-channel-registry";

const TABLES = ["channels", "channel_members", "channel_messages"] as const;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  __resetSharedChannelsForTests();
  channels.length = 0;
  vi.useRealTimers();
});

describe("the doorbell names its table", () => {
  it("web: a postgres_changes event passes its table; SUBSCRIBED and a late joiner pass null", () => {
    const a = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "t", a);
    const chan = channels[0];
    expect(chan, "control: one channel was joined").toBeDefined();
    chan.statusCb?.("SUBSCRIBED");
    expect(a).toHaveBeenLastCalledWith(null);
    const members = chan.bindings.find((b) => b.table === "channel_members");
    const messages = chan.bindings.find((b) => b.table === "channel_messages");
    expect(members && messages, "control: both tables are bound").toBeTruthy();
    members!.handler();
    expect(a).toHaveBeenLastCalledWith("channel_members");
    messages!.handler();
    expect(a).toHaveBeenLastCalledWith("channel_messages");
    const late = vi.fn();
    subscribeSharedWorkspaceTables("ws1", TABLES, "t", late);
    expect(late).toHaveBeenCalledWith(null);
  });

  it("SPA bridge: a pushed event passes its table; the empty-table catch-up and mount pass null", () => {
    const events: Array<(e: { workspaceId: string; table: string }) => void> = [];
    (window as unknown as { dopl?: unknown }).dopl = {
      apiRequest: () => Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
      getAuthState: () => Promise.resolve({ signedIn: true, userId: "u1" }),
      openExternal: () => Promise.resolve({ ok: true }),
      syncWatch: () => Promise.resolve(),
      onSyncEvent: (cb: (e: { workspaceId: string; table: string }) => void) => {
        events.push(cb);
        return () => {};
      },
    };
    try {
      const a = vi.fn();
      subscribeSharedWorkspaceTables("ws1", TABLES, "t", a);
      expect(a).toHaveBeenLastCalledWith(null); // mount catch-up
      expect(events.length, "control: the bridge was subscribed").toBe(1);
      events[0]({ workspaceId: "ws1", table: "channel_members" });
      expect(a).toHaveBeenLastCalledWith("channel_members");
      events[0]({ workspaceId: "ws1", table: "" });
      expect(a).toHaveBeenLastCalledWith(null);
    } finally {
      delete (window as unknown as { dopl?: unknown }).dopl;
    }
  });
});
