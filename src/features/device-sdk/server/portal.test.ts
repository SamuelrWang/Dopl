/**
 * Developer portal reads (W1.3) against a recording fake of `supabaseAdmin()`: each query's
 * table and filter chain is captured, and canned rows come back per table.
 *
 * The properties that fail quietly:
 *  - 🔒 REACH: a user's projects are exactly their owned + member orgs' projects, with the
 *    strongest role; an org they are in neither way never appears.
 *  - 🔒 USAGE READS `dev_billable_events`, never `dev_events` (W0.2); LOG reads `dev_events`.
 *  - 🔒 every event read is fenced by `project_id IN (caller's ids)`; an empty id list reads nothing.
 *  - keys never select `key_hash`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; ops: Array<[string, ...unknown[]]> };
const calls: Call[] = [];
const canned = new Map<string, { data?: unknown; count?: number }>();

function query(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const result = () => ({ data: canned.get(table)?.data ?? [], count: canned.get(table)?.count ?? 0, error: null });
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "gte", "lt", "or", "order", "limit", "is"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = () => {
    const r = result();
    const rows = r.data as unknown[];
    return Promise.resolve({ ...r, data: Array.isArray(rows) ? (rows[0] ?? null) : rows });
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve(result());
  return chain;
}

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({ from: (t: string) => query(t) }) }));

import {
  LOG_PAGE_SIZE,
  countBillableEvents,
  getPortalEvent,
  listPortalProjects,
  listProjectKeys,
  queryPortalEvents,
} from "./portal";
import { EMPTY_FILTERS } from "../portal/scope";

const tables = () => calls.map((c) => c.table);
const opsOn = (table: string) => calls.filter((c) => c.table === table).flatMap((c) => c.ops);

beforeEach(() => {
  calls.length = 0;
  canned.clear();
});

describe("listPortalProjects", () => {
  it("joins owned and member orgs, keeps the strongest role, internal orgs last", async () => {
    // Both dev_orgs reads share the fake's canned rows; the owner read only needs `id`.
    canned.set("dev_orgs", {
      data: [
        { id: "o-own", name: "Zeta", internal: false },
        { id: "o-int", name: "Dopl", internal: true },
      ],
    });
    canned.set("dev_org_members", {
      data: [
        { org_id: "o-own", role: "developer" },
        { org_id: "o-int", role: "admin" },
        { org_id: "o-bad", role: "superuser" },
      ],
    });
    canned.set("dev_projects", {
      data: [
        { id: "p-int", org_id: "o-int", name: "Dopl App", api_version: "2026-10-27" },
        { id: "p-own", org_id: "o-own", name: "Zeta app", api_version: "2026-10-27" },
        { id: "p-stray", org_id: "o-elsewhere", name: "Not mine", api_version: "2026-10-27" },
      ],
    });
    const out = await listPortalProjects("u1");
    expect(out.map((p) => [p.id, p.role, p.org.internal])).toEqual([
      // o-own is in the owner read (canned) AND a developer membership → owner wins.
      ["p-own", "owner", false],
      ["p-int", "owner", true],
    ]);
    expect(opsOn("dev_org_members")).toContainEqual(["eq", "user_id", "u1"]);
    const projectsIn = opsOn("dev_projects").find((o) => o[0] === "in");
    expect(projectsIn?.[2]).not.toContain("o-bad");
  });

  it("reads no projects when the user is in no org", async () => {
    canned.set("dev_orgs", { data: [] });
    canned.set("dev_org_members", { data: [] });
    expect(await listPortalProjects("u1")).toEqual([]);
    expect(tables()).not.toContain("dev_projects");
  });
});

describe("listProjectKeys", () => {
  it("filters on project and env and never selects key_hash", async () => {
    await listProjectKeys("p1", "live");
    const ops = opsOn("dev_api_keys");
    expect(ops).toContainEqual(["eq", "project_id", "p1"]);
    expect(ops).toContainEqual(["eq", "env", "live"]);
    const select = ops.find((o) => o[0] === "select");
    expect(String(select?.[1])).not.toContain("key_hash");
  });
});

describe("queryPortalEvents", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("reads dev_events fenced to the caller's projects, with every filter", async () => {
    await queryPortalEvents({
      projectIds: ["p1", "p2"],
      env: "test",
      now,
      filters: {
        ...EMPTY_FILTERS,
        outcome: "error",
        deviceKind: "glasses",
        capability: "display.card",
        intent: "notify",
        route: "auto",
        window: "1h",
        before: "2026-10-28T11:30:00.000Z~55555555-5555-4555-8555-555555555555",
      },
    });
    expect(tables()).toEqual(["dev_events"]);
    const ops = opsOn("dev_events");
    expect(ops).toContainEqual(["in", "project_id", ["p1", "p2"]]);
    expect(ops).toContainEqual(["eq", "env", "test"]);
    expect(ops).toContainEqual(["gte", "ts", "2026-10-28T11:00:00.000Z"]);
    expect(ops).toContainEqual(["eq", "outcome", "error"]);
    expect(ops).toContainEqual(["eq", "device_kind", "glasses"]);
    expect(ops).toContainEqual(["eq", "capability", "display.card"]);
    expect(ops).toContainEqual(["eq", "intent", "notify"]);
    expect(ops).toContainEqual(["eq", "route_decision->>target", "auto"]);
    expect(ops).toContainEqual([
      "or",
      "ts.lt.2026-10-28T11:30:00.000Z,and(ts.eq.2026-10-28T11:30:00.000Z,event_id.lt.55555555-5555-4555-8555-555555555555)",
    ]);
    expect(ops).toContainEqual(["order", "event_id", { ascending: false }]);
    expect(ops).toContainEqual(["limit", LOG_PAGE_SIZE + 1]);
  });

  it("returns a cursor only when an older page exists", async () => {
    const rows = Array.from({ length: LOG_PAGE_SIZE + 1 }, (_, i) => ({
      event_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ts: new Date(now.getTime() - i * 1000).toISOString(),
    }));
    canned.set("dev_events", { data: rows });
    const page = await queryPortalEvents({ projectIds: ["p1"], env: "test", now, filters: EMPTY_FILTERS });
    expect(page.rows).toHaveLength(LOG_PAGE_SIZE);
    const last = rows[LOG_PAGE_SIZE - 1];
    expect(page.nextBefore).toBe(`${last.ts}~${last.event_id}`);

    canned.set("dev_events", { data: rows.slice(0, 3) });
    expect((await queryPortalEvents({ projectIds: ["p1"], env: "test", now, filters: EMPTY_FILTERS })).nextBefore).toBeNull();
  });

  it("reads nothing for an empty project list", async () => {
    expect(await queryPortalEvents({ projectIds: [], env: "test", filters: EMPTY_FILTERS })).toEqual({
      rows: [],
      nextBefore: null,
    });
    expect(calls).toEqual([]);
  });
});

describe("getPortalEvent", () => {
  it("is fenced to the caller's projects", async () => {
    await getPortalEvent("e1", ["p1"]);
    expect(opsOn("dev_events")).toContainEqual(["in", "project_id", ["p1"]]);
    expect(await getPortalEvent("e1", [])).toBeNull();
  });
});

describe("countBillableEvents", () => {
  it("reads the billable view, never dev_events", async () => {
    canned.set("dev_billable_events", { count: 7 });
    const n = await countBillableEvents({ projectIds: ["p1"], env: "live", sinceIso: "2026-09-28T00:00:00.000Z" });
    expect(n).toBe(7);
    expect(tables()).toEqual(["dev_billable_events"]);
    const ops = opsOn("dev_billable_events");
    expect(ops).toContainEqual(["in", "project_id", ["p1"]]);
    expect(ops).toContainEqual(["eq", "env", "live"]);
  });
});
