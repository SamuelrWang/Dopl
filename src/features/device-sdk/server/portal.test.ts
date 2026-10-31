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

import { getPortalEvent, listPortalProjects } from "./portal";

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

describe("getPortalEvent", () => {
  it("is fenced to the caller's projects", async () => {
    await getPortalEvent("e1", ["p1"]);
    expect(opsOn("dev_events")).toContainEqual(["in", "project_id", ["p1"]]);
    expect(await getPortalEvent("e1", [])).toBeNull();
  });
});
