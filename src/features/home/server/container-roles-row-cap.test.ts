/**
 * 🔒 **THE /home GUEST/MEMBER SPLIT, PAST ONE POSTGREST PAGE (Samuel #2935, the
 * review of the `max_rows` sweep).**
 *
 * `listContainerRoles` was an UNLIMITED select across **every container the reader
 * belongs to** — the widest fence in this module — and `supabase/config.toml ›
 * max_rows` clips every select server-side at 1,000 and raises nothing. ⚠ Its own
 * docblock states what the map is for: *"THE guest/member split"*, and only
 * `workspace_members` can answer it (`channel_members.role` has no `guest` arm).
 *
 * ⚠ **THE ROWS THAT FELL OFF WENT A WHOLE CONTAINER'S ROSTER AT A TIME.** One
 * surrogate-key order puts a container's rows together, so the clip did not shave
 * a few people off every container — it dropped the LAST containers entirely, and
 * /home's by-person rail then filed real members under no role at all. A missing
 * role reads as "not a member of this container", which is a wrong answer that
 * looks exactly like a right one.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14), `MAX_ROWS` read out of
 * `supabase/config.toml` rather than written beside it. ⚠ `_fake-credit-db.ts` is
 * deliberately not used: it fakes the credit aggregate and its wallet fence, which
 * is not what this read is.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - un-page the read → "the LAST container's members keep their roles" and the
 *    page-shape case fail.
 *  - drop `.order("id")` → "the order is TOTAL" fails.
 *  - drop the `status` filter → "a pending member is not in the split" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  MAX_ROWS,
  fakePostgrest,
  type FakePostgrest,
  type Row,
} from "@/shared/testing/postgrest-cap";
import { listContainerRoles, roleKey } from "./repository-overview";

/** 🔒 **THREE CONTAINERS, 400 MEMBERS EACH = 1,200 ROWS**, so the clip lands
 *  inside the THIRD one: rows 0-999 cover containers A and B and 200 of C, and
 *  the remaining 200 of C were simply absent. */
const PER_CONTAINER = 400;
const CONTAINERS = ["ws-a", "ws-b", "ws-c"] as const;
const TOTAL = PER_CONTAINER * CONTAINERS.length;

/** The container whose roster the old read could not finish, and the member in it
 *  whose row sorts LAST of all 1,200. */
const LAST_CONTAINER = CONTAINERS[2];

const pad = (n: number) => String(n).padStart(5, "0");

/**
 * `workspace_members` rows, grouped by container in `id` order — which is how
 * Postgres hands them back and why a clip costs a whole roster rather than a
 * sprinkling. ⚠ Every row carries `id`: `workspace_members.id` is the PRIMARY KEY
 * (a surrogate `UUID`; `(workspace_id, user_id)` is merely UNIQUE).
 */
function roleRows(): Row[] {
  const rows: Row[] = [];
  CONTAINERS.forEach((workspace, w) => {
    for (let i = 0; i < PER_CONTAINER; i++) {
      rows.push({
        id: `wm-${pad(w * PER_CONTAINER + i)}`,
        workspace_id: workspace,
        user_id: `u-${pad(i)}`,
        // ⚠ `guest` exists in no other table, which is the whole reason this read
        // cannot be answered from `channel_members`.
        role: i % 3 === 0 ? "guest" : i % 3 === 1 ? "member" : "admin",
        status: "active",
      });
    }
  });
  return rows;
}

function mount(rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ workspace_members: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

function orderedColumns(fake: FakePostgrest): string[] {
  return [
    ...new Set(
      fake.calls.filter((c) => c.op === "order").map((c) => String(c.args[0]))
    ),
  ];
}

function ranges(fake: FakePostgrest): number[][] {
  return fake.calls
    .filter((c) => c.op === "range")
    .map((c) => [Number(c.args[0]), Number(c.args[1])]);
}

function tupleCount(rows: readonly Row[], cols: readonly string[]): number {
  return new Set(rows.map((r) => cols.map((c) => String(r[c])).join("\u0000")))
    .size;
}

/** The fake's builder typed just enough to spell THE SHAPE THIS READ REPLACED. */
interface Unlimited {
  from: (table: string) => Unlimited;
  select: (cols: string) => Unlimited;
  in: (col: string, values: readonly unknown[]) => Unlimited;
  eq: (col: string, value: unknown) => Unlimited;
  then: (resolve: (r: { data: Row[]; error: unknown }) => void) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listContainerRoles — the guest/member split across every container", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** The read
   *  asked for NO bound and the server imposed one anyway, which is the half of
   *  this bug that reads as a non-bug in review. */
  it(`⚠ the old UNLIMITED select comes back as exactly ${MAX_ROWS}, silently`, async () => {
    expect(TOTAL).toBeGreaterThan(MAX_ROWS);
    const { client } = mount(roleRows());

    const { data, error } = await new Promise<{ data: Row[]; error: unknown }>(
      (resolve) =>
        (client as unknown as Unlimited)
          .from("workspace_members")
          .select("workspace_id, user_id, role")
          .in("workspace_id", [...CONTAINERS])
          .eq("status", "active")
          .then(resolve)
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it(`maps all ${TOTAL} role rows, keyed by container AND person`, async () => {
    mount(roleRows());

    const roles = await listContainerRoles([...CONTAINERS]);

    expect(roles.size).toBe(TOTAL);
    for (const row of roleRows()) {
      expect(
        roles.get(roleKey(String(row.workspace_id), String(row.user_id))),
        `${row.workspace_id}/${row.user_id}`
      ).toBe(row.role);
    }
  });

  /**
   * 🔒 **THE SYMPTOM, EXECUTABLE.** Under the clip, 200 of the third container's
   * 400 members had NO entry in this map — and a missing role is read downstream
   * as "not a member here", so real members were filed under nothing on the
   * by-person rail while the first two containers looked perfect.
   */
  it("the LAST container's members keep their roles, all 400 of them", async () => {
    mount(roleRows());

    const roles = await listContainerRoles([...CONTAINERS]);

    const inLast = [...roles.keys()].filter((k) =>
      k.startsWith(`${LAST_CONTAINER}:`)
    );
    expect(inLast).toHaveLength(PER_CONTAINER);
    // The very LAST row of the whole walk, and it is a `guest` — the marker the
    // rail reads off this map, on the row the clip was guaranteed to drop.
    expect(roles.get(roleKey(LAST_CONTAINER, `u-${pad(PER_CONTAINER - 1)}`))).toBe(
      "guest"
    );
    expect(roles.get(roleKey(LAST_CONTAINER, `u-${pad(PER_CONTAINER - 2)}`))).toBe(
      "admin"
    );
  });

  it("walks TWO contiguous pages of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount(roleRows());

    await listContainerRoles([...CONTAINERS]);

    const seen = ranges(fake);
    expect(seen).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
    // ⚠ No page wider than the ceiling — the walk's ONLY exhaustion signal.
    expect(seen.every(([from, to]) => to - from + 1 <= MAX_ROWS)).toBe(true);
  });

  /**
   * 🔒 **NOT ONE SELECTED COLUMN IS UNIQUE.** `workspace_id` repeats per roster,
   * `user_id` repeats across containers, `role` repeats everywhere — and even the
   * PAIR is only unique by constraint, not by the order this read had (it had
   * none). The PRIMARY KEY is ORDERED ON AND NEVER SELECTED, so the three-column
   * projection is untouched.
   */
  it("the order is TOTAL — `id`, where every selected column collides", async () => {
    const seeded = roleRows();
    const fake = mount(seeded);

    await listContainerRoles([...CONTAINERS]);

    expect(orderedColumns(fake)).toEqual(["id"]);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe(
      "workspace_id, user_id, role"
    );
    expect(tupleCount(seeded, ["id"])).toBe(seeded.length);
    expect(tupleCount(seeded, ["workspace_id"])).toBe(CONTAINERS.length);
    expect(tupleCount(seeded, ["user_id"])).toBe(PER_CONTAINER);
    expect(tupleCount(seeded, ["role"])).toBe(3);
  });

  it("holds the container fence and the active filter on EVERY page", async () => {
    const fake = mount([
      ...roleRows(),
      // ⚠ Neither may be mapped: a container the reader does not belong to, and
      // somebody who has not accepted yet.
      {
        id: "wm-99998",
        workspace_id: "ws-outside",
        user_id: "u-outsider",
        role: "admin",
        status: "active",
      },
      {
        id: "wm-99999",
        workspace_id: LAST_CONTAINER,
        user_id: "u-pending",
        role: "member",
        status: "pending",
      },
    ]);

    const roles = await listContainerRoles([...CONTAINERS]);

    expect(roles.size).toBe(TOTAL);
    expect(roles.has(roleKey("ws-outside", "u-outsider"))).toBe(false);
    // 🔒 A pending member is not in the split — this is the `status` filter.
    expect(roles.has(roleKey(LAST_CONTAINER, "u-pending"))).toBe(false);

    const ins = fake.calls.filter((c) => c.op === "in").map((c) => c.args);
    expect(ins).toHaveLength(2);
    expect(ins.every((a) => a[0] === "workspace_id")).toBe(true);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(2);
    expect(eqs.every((a) => a[0] === "status" && a[1] === "active")).toBe(true);
  });

  it("no containers is no query at all", async () => {
    const fake = mount(roleRows());
    expect((await listContainerRoles([])).size).toBe(0);
    expect(fake.pageReads()).toBe(0);
  });

  it("propagates a page error rather than reporting a short split", async () => {
    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      in: () => client,
      eq: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await expect(listContainerRoles([...CONTAINERS])).rejects.toMatchObject({
      code: "42501",
    });
  });
});
