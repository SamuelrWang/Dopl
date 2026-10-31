import { beforeEach, describe, expect, it, vi } from "vitest";

const ops: Array<{ table: string; op: string; args: unknown[] }> = [];
let pages: Record<string, string[][]> = {};

function from(table: string) {
  const chain: Record<string, unknown> = {};
  let selecting = false;
  for (const op of ["select", "delete", "lt", "neq", "or", "in", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      ops.push({ table, op, args });
      if (op === "select") selecting = true;
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) =>
    resolve(selecting ? { data: (pages[table]?.shift() ?? []).map((id) => ({ id, event_id: id })), error: null } : { count: (ops.filter((o) => o.table === table && o.op === "in").at(-1)?.args[1] as string[]).length, error: null });
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("./events", () => ({ DEFAULT_EVENT_RETENTION_DAYS: 30 }));
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ from }) }));

const { pruneDevEvents, pruneDeviceText } = await import("./retention");
const NOW = new Date("2026-11-30T00:00:00.000Z");
const on = (table: string, op: string) => ops.filter((o) => o.table === table && o.op === op);

beforeEach(() => {
  ops.length = 0;
  pages = {};
});

describe("pruneDeviceText", () => {
  it("reads only rows past the window, and deletes only the ids it read", async () => {
    pages = { dev_actions: [["a", "b"]] };
    const out = await pruneDeviceText({ now: NOW });
    expect(on("dev_actions", "lt")[0].args).toEqual(["created_at", "2026-10-31T00:00:00.000Z"]);
    expect(on("dev_actions", "in")[0].args).toEqual(["id", ["a", "b"]]);
    expect(out).toEqual({ dev_device_messages: 0, dev_actions: 2, dev_webhook_outbox: 0 });
  });

  it("keeps an event still to fan out and a message a device can still take, but not one past its expiry", async () => {
    await pruneDeviceText({ now: NOW });
    expect(on("dev_webhook_outbox", "or")[0].args[0]).toBe("status.neq.pending");
    expect(on("dev_device_messages", "or")[0].args[0]).toBe('status.neq.pending,expires_at.lt."2026-11-30T00:00:00.000Z"');
  });

  it("stops at its bound however long the backlog is", async () => {
    pages = { dev_actions: Array.from({ length: 80 }, () => Array.from({ length: 200 }, (_, i) => `x${i}`)) };
    const out = await pruneDeviceText({ now: NOW });
    expect(out.dev_actions).toBe(10_000);
    expect(pages.dev_actions).toHaveLength(30);
  });
});

describe("pruneDevEvents", () => {
  it("deletes past the window by its own key and time columns, and returns the count", async () => {
    pages = { dev_events: [["a", "b"]] };
    expect(await pruneDevEvents({ now: NOW })).toBe(2);
    expect(on("dev_events", "lt")[0].args).toEqual(["ts", "2026-10-31T00:00:00.000Z"]);
    expect(on("dev_events", "in")[0].args).toEqual(["event_id", ["a", "b"]]);
  });

  it("is bounded, and no delete names more ids than the gateway accepts", async () => {
    pages = { dev_events: Array.from({ length: 80 }, () => Array.from({ length: 200 }, (_, i) => `x${i}`)) };
    expect(await pruneDevEvents({ now: NOW })).toBe(10_000);
    expect(pages.dev_events).toHaveLength(30);
    expect(on("dev_events", "limit")[0].args).toEqual([200]);
  });
});
