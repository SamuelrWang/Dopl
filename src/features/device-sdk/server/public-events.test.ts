/**
 * `GET /v1/events` reads: query parsing, the opaque cursor, and the query chain against a
 * recording fake of `supabaseAdmin()`.
 *
 * The properties that fail quietly:
 *  - 🔒 REACH: every read is `project_id = <key's project>` AND `env = <key's env>`.
 *  - 🔒 the cursor round-trips the stored µs timestamp exactly, and anything that is not a cursor
 *    this server wrote is refused (never read as "first page", never reaches `or()`).
 *  - a bad filter value is refused, not dropped (dropping would widen the read).
 *  - the page carries the PUBLIC shape: no org, bytes or cost fields.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const calls: Call[] = [];
let rows: unknown[] = [];

function query(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte", "or", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return chain;
}

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ from: (t: string) => query(t) }) }));

import { PRIVATE_EVENT_FIELDS, PublicDeviceEventSchema } from "../types";
import {
  EVENTS_DEFAULT_WINDOW_MS,
  EVENTS_MAX_WINDOW_MS,
  decodeEventCursor,
  encodeEventCursor,
  listPublicEvents,
  parseEventListQuery,
  utcZ,
  type EventListQuery,
} from "./public-events";

const NOW = new Date("2026-10-28T12:00:00.000Z");
const ID1 = "0b8f3c2e-5a41-4d7e-9c16-2f7a8e1d4b90";
const ID2 = "1c9f3c2e-5a41-4d7e-9c16-2f7a8e1d4b91";
const TS = "2026-10-28T11:59:01.123456+00:00";

const parse = (qs: string) => parseEventListQuery(new URLSearchParams(qs), NOW);
function ok(qs: string): EventListQuery {
  const r = parse(qs);
  if (!r.ok) throw new Error(r.message);
  return r.query;
}

function row(id: string, ts = TS) {
  return {
    event_id: id,
    ts,
    org_id: "org-1",
    project_id: "proj-1",
    env: "test",
    external_user_id: "usr_1",
    connection_id: null,
    device_id: null,
    device_kind: null,
    vendor: null,
    model: null,
    firmware: null,
    adapter_version: null,
    capability: null,
    intent: null,
    route_decision: null,
    profile_id: null,
    profile_version: null,
    risk_tier: null,
    confirmation: null,
    outcome: "ok",
    error_code: null,
    latency_ms: { api: 3, device_delivery: null, user_response: null },
    bytes_in: 10,
    bytes_out: 20,
    cost_units: 1,
  };
}

beforeEach(() => {
  calls.length = 0;
  rows = [];
});

describe("the opaque cursor", () => {
  it("round-trips a µs timestamp and id exactly", () => {
    const c = encodeEventCursor({ ts: TS, event_id: ID1 });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeEventCursor(c)).toEqual({ ts: TS, eventId: ID1 });
  });

  it("refuses anything this server did not write", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    for (const bad of [
      b64("not a cursor"),
      b64(`${TS}~not-a-uuid`),
      b64(`2026-10-28~${ID1}`),
      b64(`${TS}~${ID1}~extra`),
      b64(`ts.lt.x,and(1)~${ID1}`),
      `${encodeEventCursor({ ts: TS, event_id: ID1 })}x`,
    ]) {
      expect(decodeEventCursor(bad), bad).toBeNull();
    }
  });
});

describe("parseEventListQuery", () => {
  it("defaults: limit 50, last 24h, no filters, first page", () => {
    expect(ok("")).toMatchObject({
      limit: 50,
      after: null,
      outcome: null,
      deviceKind: null,
      capability: null,
      intent: null,
      route: null,
      sinceIso: new Date(NOW.getTime() - EVENTS_DEFAULT_WINDOW_MS).toISOString(),
    });
  });

  it("clamps since to 30 days and keeps a later one", () => {
    expect(ok("since=2020-01-01T00:00:00Z").sinceIso).toBe(new Date(NOW.getTime() - EVENTS_MAX_WINDOW_MS).toISOString());
    expect(ok("since=2026-10-28T11:00:00Z").sinceIso).toBe("2026-10-28T11:00:00.000Z");
  });

  it("refuses a bad value instead of dropping the filter", () => {
    for (const qs of [
      "limit=0",
      "limit=101",
      "limit=abc",
      "cursor=a+b",
      `cursor=${Buffer.from("x").toString("base64url")}`,
      "since=yesterday",
      "since=1730000000",
      "outcome=fine",
      "device_kind=toaster",
      "capability=present.everything",
      "intent=shout",
      "route=a,b",
      "route=" + "x".repeat(129),
    ]) {
      expect(parse(qs).ok, qs).toBe(false);
    }
  });

  it("reads every filter", () => {
    const c = encodeEventCursor({ ts: TS, event_id: ID1 });
    expect(
      ok(`limit=5&cursor=${c}&outcome=error&device_kind=glasses&capability=present.display&intent=display&route=auto`)
    ).toMatchObject({
      limit: 5,
      after: { ts: TS, eventId: ID1 },
      outcome: "error",
      deviceKind: "glasses",
      capability: "present.display",
      intent: "display",
      route: "auto",
    });
  });
});

describe("utcZ", () => {
  it("swaps a zero offset for Z and keeps µs", () => {
    expect(utcZ("2026-10-28T11:59:01.123456+00:00")).toBe("2026-10-28T11:59:01.123456Z");
    expect(utcZ("2026-10-28T11:59:01Z")).toBe("2026-10-28T11:59:01Z");
    expect(utcZ("2026-10-28T13:59:01+02:00")).toBe("2026-10-28T11:59:01.000Z");
  });
});

describe("listPublicEvents", () => {
  it("🔒 fences on the key's project AND env, and reads dev_events", async () => {
    await listPublicEvents({ projectId: "proj-1", env: "live", query: ok("") });
    expect(calls.map((c) => c.table)).toEqual(["dev_events"]);
    const ops = calls[0].ops;
    expect(ops).toContainEqual(["eq", "project_id", "proj-1"]);
    expect(ops).toContainEqual(["eq", "env", "live"]);
    expect(ops).toContainEqual(["order", "ts", { ascending: false }]);
    expect(ops).toContainEqual(["order", "event_id", { ascending: false }]);
    expect(ops).toContainEqual(["limit", 51]);
  });

  it("applies filters and the keyset from the cursor", async () => {
    const c = encodeEventCursor({ ts: TS, event_id: ID1 });
    await listPublicEvents({
      projectId: "proj-1",
      env: "test",
      query: ok(`cursor=${c}&outcome=denied&route=auto&intent=ask`),
    });
    const ops = calls[0].ops;
    expect(ops).toContainEqual(["eq", "outcome", "denied"]);
    expect(ops).toContainEqual(["eq", "route_decision->>target", "auto"]);
    expect(ops).toContainEqual(["eq", "intent", "ask"]);
    expect(ops).toContainEqual(["or", `ts.lt."${TS}",and(ts.eq."${TS}",event_id.lt.${ID1})`]);
  });

  it("pages: has_more and next_cursor from the last row kept; public shape only", async () => {
    rows = [row(ID2), row(ID1)];
    const page = await listPublicEvents({ projectId: "proj-1", env: "test", query: ok("limit=1") });
    expect(page.data).toHaveLength(1);
    expect(page.has_more).toBe(true);
    expect(decodeEventCursor(page.next_cursor!)).toEqual({ ts: TS, eventId: ID2 });
    for (const f of PRIVATE_EVENT_FIELDS) expect(page.data[0]).not.toHaveProperty(f);
    expect(PublicDeviceEventSchema.safeParse(page.data[0]).success).toBe(true);
    expect(page.data[0].ts).toBe("2026-10-28T11:59:01.123456Z");

    rows = [row(ID1)];
    const last = await listPublicEvents({ projectId: "proj-1", env: "test", query: ok("limit=1") });
    expect(last).toMatchObject({ next_cursor: null, has_more: false });
  });
});
