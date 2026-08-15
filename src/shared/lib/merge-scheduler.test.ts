/** Debounced merging save scheduler. Fake timers drive the debounce window;
 *  each run records its flushed payload. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMergeScheduler } from "./merge-scheduler";

const DELAY = 400;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function recorder() {
  const calls: Array<Record<string, unknown>> = [];
  const run = (merged: Record<string, unknown>) => {
    calls.push(merged);
    return Promise.resolve();
  };
  return { calls, run };
}

describe("createMergeScheduler", () => {
  it("merges fields across calls under one key and runs once with the union", () => {
    const s = createMergeScheduler(DELAY);
    const { calls, run } = recorder();

    // Two fields inside one window — the classic lost-field bug.
    s.schedule("step:wf:n1", { title: "Hi" }, run);
    vi.advanceTimersByTime(200);
    s.schedule("step:wf:n1", { description: "There" }, run);
    vi.advanceTimersByTime(DELAY);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ title: "Hi", description: "There" });
  });

  it("keeps the latest value when the same field is edited repeatedly", () => {
    const s = createMergeScheduler(DELAY);
    const { calls, run } = recorder();

    s.schedule("wf:1", { name: "a" }, run);
    s.schedule("wf:1", { name: "ab" }, run);
    s.schedule("wf:1", { name: "abc" }, run);
    vi.advanceTimersByTime(DELAY);

    expect(calls).toEqual([{ name: "abc" }]);
  });

  it("keeps separate keys independent", () => {
    const s = createMergeScheduler(DELAY);
    const a = recorder();
    const b = recorder();

    s.schedule("step:wf:a", { title: "A" }, a.run);
    s.schedule("step:wf:b", { title: "B" }, b.run);
    vi.advanceTimersByTime(DELAY);

    expect(a.calls).toEqual([{ title: "A" }]);
    expect(b.calls).toEqual([{ title: "B" }]);
  });

  it("cancel() drops a pending save so its timer never runs", () => {
    const s = createMergeScheduler(DELAY);
    const { calls, run } = recorder();

    s.schedule("edge:wf:a:b", { condition: "approved" }, run);
    s.cancel("edge:wf:a:b");
    vi.advanceTimersByTime(DELAY);

    expect(calls).toHaveLength(0);
    expect(s.pendingKeys()).toEqual([]);
  });

  it("cancelWhere() drops only matching keys (disconnect/remove-step case)", () => {
    const s = createMergeScheduler(DELAY);
    const edge = recorder();
    const other = recorder();

    s.schedule("edge:wf:a:b", { condition: "x" }, edge.run);
    s.schedule("step:wf:c", { title: "keep" }, other.run);
    s.cancelWhere((k) => k.startsWith("edge:wf:"));
    vi.advanceTimersByTime(DELAY);

    expect(edge.calls).toHaveLength(0);
    expect(other.calls).toEqual([{ title: "keep" }]);
  });

  it("flush() runs a pending save immediately with the merged payload", async () => {
    const s = createMergeScheduler(DELAY);
    const { calls, run } = recorder();

    s.schedule("step:wf:n1", { title: "T" }, run);
    s.schedule("step:wf:n1", { userInput: "U" }, run);
    await s.flush("step:wf:n1");

    expect(calls).toEqual([{ title: "T", userInput: "U" }]);
    vi.advanceTimersByTime(DELAY);
    expect(calls).toHaveLength(1);
  });

  it("flushWhere() forces matching saves and flushAll() drains the rest", async () => {
    const s = createMergeScheduler(DELAY);
    const wf1 = recorder();
    const wf2 = recorder();

    s.schedule("step:wf1:a", { title: "1" }, wf1.run);
    s.schedule("step:wf2:a", { title: "2" }, wf2.run);
    await s.flushWhere((k) => k.startsWith("step:wf1:"));
    expect(wf1.calls).toEqual([{ title: "1" }]);
    expect(wf2.calls).toHaveLength(0);

    await s.flushAll();
    expect(wf2.calls).toEqual([{ title: "2" }]);
    expect(s.pendingKeys()).toEqual([]);
  });
});
