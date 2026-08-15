import { describe, expect, it, vi } from "vitest";
import { createRefetchCoordinator } from "./refetch-coordinator";

describe("createRefetchCoordinator", () => {
  it("runs immediately when idle", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.request(false);

    expect(run).toHaveBeenCalledTimes(1);
    expect(c.isDeferred()).toBe(false);
  });

  it("defers while busy and runs once on settle", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.request(true);
    expect(run).not.toHaveBeenCalled();
    expect(c.isDeferred()).toBe(true);

    c.settle(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.isDeferred()).toBe(false);
  });

  it("coalesces many busy requests into a single deferred run", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.request(true);
    c.request(true);
    c.request(true);
    expect(run).not.toHaveBeenCalled();

    c.settle(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run on settle when no refetch was deferred", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.settle(false);

    expect(run).not.toHaveBeenCalled();
  });

  it("keeps deferring while writes are still in flight", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.request(true);
    c.settle(true);
    expect(run).not.toHaveBeenCalled();
    expect(c.isDeferred()).toBe(true);

    c.settle(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clears a prior deferral when a later request runs while idle", () => {
    const run = vi.fn();
    const c = createRefetchCoordinator(run);

    c.request(true); // deferred
    c.request(false); // idle now — runs and satisfies the deferral
    expect(run).toHaveBeenCalledTimes(1);
    expect(c.isDeferred()).toBe(false);

    // ⚠ A later settle must NOT re-run the already-satisfied refetch.
    c.settle(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
