/**
 * `logDevEvent` (C8, A2): validated, batched, fire-and-forget, NEVER throws — not when the sink
 * throws synchronously, not when it rejects, not on an invalid row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceEventRowSchema, type DeviceEventRow } from "../types";

const db = vi.hoisted(() => ({ calls: [] as Array<{ table: string; method: string; args: unknown[] }> }));
vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["insert", "delete", "lt"]) {
        b[m] = (...args: unknown[]) => {
          db.calls.push({ table, method: m, args });
          return b;
        };
      }
      b.then = (f: (v: unknown) => unknown) => Promise.resolve({ error: null, count: 7 }).then(f);
      return b;
    },
  }),
}));

import {
  FLUSH_DELAY_MS,
  MAX_BATCH,
  buildDevEvent,
  flushDevEvents,
  logDevEvent,
  setDevEventSinkForTests,
} from "./events";

const base = { org_id: "org-1", project_id: "proj-1", env: "test", outcome: "ok" } as const;
let written: DeviceEventRow[][];

beforeEach(() => {
  written = [];
  db.calls = [];
  setDevEventSinkForTests({ write: async (rows) => void written.push(rows) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setDevEventSinkForTests(null);
});

describe("buildDevEvent", () => {
  it("fills every C8 field and passes the contract schema", () => {
    const row = buildDevEvent({ ...base, latency_ms: { api: 12 } });
    expect(DeviceEventRowSchema.parse(row)).toEqual(row);
    expect(row.latency_ms).toEqual({ api: 12, device_delivery: null, user_response: null });
    expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.bytes_in).toBe(0);
  });
});

describe("logDevEvent", () => {
  it("batches: several rows in one tick become ONE write", async () => {
    logDevEvent(base);
    logDevEvent(base);
    logDevEvent({ ...base, outcome: "denied", error_code: "insufficient_scope" });
    expect(written).toEqual([]); // fire-and-forget: nothing written synchronously
    await flushDevEvents();
    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(3);
  });

  it("flushes on its own after the coalescing window (timer)", async () => {
    vi.useFakeTimers();
    logDevEvent(base);
    expect(written).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FLUSH_DELAY_MS + 1);
    expect(written).toHaveLength(1);
  });

  it("the coalescing timer is unref'd (never keeps a process alive)", () => {
    const spy = vi.spyOn(globalThis, "setTimeout");
    logDevEvent(base);
    const handle = spy.mock.results[0]?.value as { hasRef?: () => boolean };
    expect(handle.hasRef?.()).toBe(false);
  });

  it("flushes at MAX_BATCH without waiting for the timer", async () => {
    for (let i = 0; i < MAX_BATCH; i++) logDevEvent(base);
    await Promise.resolve();
    await Promise.resolve();
    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(MAX_BATCH);
  });

  it("never throws when the sink throws synchronously or rejects", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setDevEventSinkForTests({
      write: () => {
        throw new Error("boom");
      },
    });
    expect(() => logDevEvent(base)).not.toThrow();
    await expect(flushDevEvents()).resolves.toBeUndefined();

    setDevEventSinkForTests({ write: async () => Promise.reject(new Error("db down")) });
    expect(() => logDevEvent(base)).not.toThrow();
    await expect(flushDevEvents()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(2);
  });

  it("drops an invalid row with a warning and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => logDevEvent({ ...base, env: "prod" as never })).not.toThrow();
    expect(() => logDevEvent({ ...base, project_id: "" })).not.toThrow();
    await flushDevEvents();
    expect(written).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain("env");
  });

  it("the default sink inserts the batch into dev_events", async () => {
    setDevEventSinkForTests(null);
    logDevEvent(base);
    await flushDevEvents();
    const insert = db.calls.find((c) => c.method === "insert");
    expect(insert?.table).toBe("dev_events");
    expect((insert?.args[0] as unknown[]).length).toBe(1);
  });
});
