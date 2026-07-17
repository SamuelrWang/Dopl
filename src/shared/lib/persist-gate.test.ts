import { describe, it, expect } from "vitest";
import { createPersistGate } from "./persist-gate";

/** A promise plus its resolver, so a test can hold a run "in flight". */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createPersistGate", () => {
  it("is idle before any run", async () => {
    const gate = createPersistGate();
    expect(gate.busy()).toBe(false);
    await expect(gate.idle()).resolves.toBeUndefined();
  });

  it("stays busy while a run is in flight, then settles", async () => {
    const gate = createPersistGate();
    const d = deferred();
    const run = gate.run(() => d.promise);
    expect(gate.busy()).toBe(true);
    d.resolve();
    await run;
    expect(gate.busy()).toBe(false);
  });

  it("idle() resolves only after the in-flight run settles", async () => {
    const gate = createPersistGate();
    const d = deferred();
    void gate.run(() => d.promise);
    let idleResolved = false;
    const idle = gate.idle().then(() => {
      idleResolved = true;
    });
    await Promise.resolve();
    expect(idleResolved).toBe(false);
    d.resolve();
    await idle;
    expect(idleResolved).toBe(true);
  });

  it("stays busy until the LAST of several concurrent runs settles", async () => {
    const gate = createPersistGate();
    const a = deferred();
    const b = deferred();
    void gate.run(() => a.promise);
    void gate.run(() => b.promise);
    expect(gate.busy()).toBe(true);
    a.resolve();
    await Promise.resolve();
    expect(gate.busy()).toBe(true);
    b.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.busy()).toBe(false);
  });

  it("decrements and resolves idle even when a run rejects", async () => {
    const gate = createPersistGate();
    const d = deferred();
    const run = gate.run(() => d.promise).catch(() => undefined);
    expect(gate.busy()).toBe(true);
    d.reject(new Error("boom"));
    await run;
    expect(gate.busy()).toBe(false);
    await expect(gate.idle()).resolves.toBeUndefined();
  });

  it("decrements when the run throws synchronously", async () => {
    const gate = createPersistGate();
    await expect(
      gate.run(() => {
        throw new Error("sync boom");
      })
    ).rejects.toThrow("sync boom");
    expect(gate.busy()).toBe(false);
  });
});
