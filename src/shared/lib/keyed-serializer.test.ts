import { describe, it, expect } from "vitest";
import { createKeyedSerializer } from "./keyed-serializer";

/** Flush the microtask queue a few turns so chained `.then`s advance. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("createKeyedSerializer", () => {
  it("serializes same-key ops: B starts only after A settles, even when issued synchronously", async () => {
    const s = createKeyedSerializer();
    const events: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((res) => {
      releaseA = res;
    });

    const pA = s.run("edge", async () => {
      events.push("A:start");
      await aGate;
      events.push("A:end");
      return "a";
    });
    // Issued synchronously, before A has had a chance to run.
    const pB = s.run("edge", async () => {
      events.push("B:start");
      return "b";
    });

    await flushMicrotasks();
    // A is in flight (blocked on the gate); B must NOT have started.
    expect(events).toEqual(["A:start"]);

    releaseA();
    const [a, b] = await Promise.all([pA, pB]);
    expect(a).toBe("a");
    expect(b).toBe("b");
    // B's work ran strictly after A fully settled.
    expect(events).toEqual(["A:start", "A:end", "B:start"]);
  });

  it("does not order or block across different keys", async () => {
    const s = createKeyedSerializer();
    const events: string[] = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((res) => {
      releaseA = res;
    });

    const pA = s.run("edge-1", async () => {
      events.push("A:start");
      await aGate;
      events.push("A:end");
    });
    const pB = s.run("edge-2", async () => {
      events.push("B:start");
      events.push("B:end");
    });

    await flushMicrotasks();
    // Different key: B ran to completion without waiting on A.
    expect(events).toEqual(["A:start", "B:start", "B:end"]);

    releaseA();
    await Promise.all([pA, pB]);
  });

  it("a rejected op does not block later same-key ops", async () => {
    const s = createKeyedSerializer();
    const events: string[] = [];

    const pA = s.run("edge", async () => {
      events.push("A");
      throw new Error("boom");
    });
    const pB = s.run("edge", async () => {
      events.push("B");
      return "ok";
    });

    await expect(pA).rejects.toThrow("boom");
    await expect(pB).resolves.toBe("ok");
    expect(events).toEqual(["A", "B"]);
  });
});
