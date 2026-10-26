// @vitest-environment jsdom
/**
 * TABLE-AWARE DOORBELL, consumer half (`live.ts › useChannelsLive`). A batch of realtime signals
 * whose every table is `channel_members` (the read watermark, a join, a favourite) refetches the
 * ROSTER only, an all-`channel_tasks` batch the TASKS only; anything else — another table, a
 * catch-up (`null`), a mixed coalesced batch — runs the full refetch, as before. The realtime hook is replaced by a recorder so each case drives the
 * exact table sequence; the refetch gate is the real one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const rt = vi.hoisted(() => ({ channels: null as null | ((table: string | null) => void) }));

vi.mock("../client/realtime", () => ({
  useChannelsRealtime: (_ws: string, onChange: (table: string | null) => void) => {
    rt.channels = onChange;
  },
  usePresenceRealtime: () => {},
}));

import { doorbellScope, useChannelsLive } from "./live";

afterEach(() => {
  cleanup();
  rt.channels = null;
});

function mount(withRoster = true) {
  const all = vi.fn();
  const roster = vi.fn();
  const tasks = vi.fn();
  const { result } = renderHook(() =>
    useChannelsLive({
      workspaceId: "ws1",
      refetchAll: all,
      refetchMembers: () => {},
      ...(withRoster ? { refetchRoster: roster, refetchTasks: tasks } : {}),
    })
  );
  expect(rt.channels, "control: the channels doorbell was subscribed").toBeTypeOf("function");
  const ring = (table: string | null) => act(() => rt.channels!(table));
  return { all, roster, tasks, ring, gate: () => result.current.gate };
}

describe("useChannelsLive — table-aware doorbell", () => {
  it("a channel_members-only signal refetches the roster, not the transcript", () => {
    const h = mount();
    h.ring("channel_members");
    expect(h.roster).toHaveBeenCalledTimes(1);
    expect(h.all).not.toHaveBeenCalled();
  });

  it("a channel_messages signal runs the full refetch", () => {
    const h = mount();
    h.ring("channel_messages");
    expect(h.all).toHaveBeenCalledTimes(1);
    expect(h.roster).not.toHaveBeenCalled();
  });

  it("a catch-up (null table) runs the full refetch", () => {
    const h = mount();
    h.ring(null);
    expect(h.all).toHaveBeenCalledTimes(1);
    expect(h.roster).not.toHaveBeenCalled();
  });

  it("a batch coalesced behind a write, members + messages, runs the full refetch once", () => {
    const h = mount();
    act(() => h.gate().begin());
    h.ring("channel_members");
    h.ring("channel_messages");
    expect(h.all, "deferred while the write is in flight").not.toHaveBeenCalled();
    act(() => h.gate().end());
    expect(h.all).toHaveBeenCalledTimes(1);
    expect(h.roster).not.toHaveBeenCalled();
    // The batch was consumed: a later members-only signal is judged on its own.
    h.ring("channel_members");
    expect(h.roster).toHaveBeenCalledTimes(1);
    expect(h.all).toHaveBeenCalledTimes(1);
  });

  it("no refetchRoster supplied: a members-only signal falls back to the full refetch", () => {
    const h = mount(false);
    h.ring("channel_members");
    expect(h.all).toHaveBeenCalledTimes(1);
  });

  it("a channel_tasks-only signal refetches the tasks, nothing else", () => {
    const h = mount();
    h.ring("channel_tasks");
    expect(h.tasks).toHaveBeenCalledTimes(1);
    expect(h.all).not.toHaveBeenCalled();
    expect(h.roster).not.toHaveBeenCalled();
  });

  it("no refetchTasks supplied: a tasks-only signal falls back to the full refetch", () => {
    const h = mount(false);
    h.ring("channel_tasks");
    expect(h.all).toHaveBeenCalledTimes(1);
  });

  it("every host passes refetchTasks, so a task change never full-refetches a pop-out", () => {
    for (const file of ["channel-surface-data.ts", "thread-window.tsx", "agent-window.tsx"]) {
      const src = readFileSync(join(import.meta.dirname, file), "utf8");
      const call = src.slice(src.indexOf("useChannelsLive({"));
      expect(call.slice(0, call.indexOf("});")), file).toContain("refetchTasks:");
    }
  });

  it("doorbellScope: one scope only for a non-empty batch of that scope's table", () => {
    expect(doorbellScope(new Set(["channel_members"]))).toBe("roster");
    expect(doorbellScope(new Set(["channel_tasks"]))).toBe("tasks");
    expect(doorbellScope(new Set(["channel_members", "channel_tasks"]))).toBe("all");
    expect(doorbellScope(new Set(["channel_tasks", "channel_messages"]))).toBe("all");
    expect(doorbellScope(new Set())).toBe("all");
    expect(doorbellScope(new Set([null]))).toBe("all");
    expect(doorbellScope(new Set(["channel_members", null]))).toBe("all");
    expect(doorbellScope(new Set(["channels"]))).toBe("all");
  });
});
