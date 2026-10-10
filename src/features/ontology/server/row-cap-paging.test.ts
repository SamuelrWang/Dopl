/**
 * Invariant suite — THE ONTOLOGY READS PAST `max_rows` (Samuel #2935, 2026-10-10).
 *
 * `supabase/config.toml › max_rows = 1000` clips every PostgREST select
 * server-side and raises nothing, so `dto.ts › ONTOLOGY_READ_LIMITS` asking
 * 5,000 objects / 20,000 memberships / 20,000 relationships got 1,000 of each
 * and the graph was assembled from the clip. ⚠ **THAT IS NOT AN UNDER-REPORT.**
 * It renders a SMALLER GRAPH whose edges point at objects that appear not to
 * exist, under a `truncated: false` that computed `1000 >= 5000`.
 *
 * Five properties, and the suite is only worth its runtime while all five hold:
 *
 *   1. THE CASE HAS TEETH — the same fixture, read single-shot the old way,
 *      comes back with exactly `MAX_ROWS`. Without this the rest could pass
 *      against a fake that never clips.
 *   2. EVERY ROW ARRIVES — asserted on the ID SET, not the length. A length is
 *      blind to the failure paging actually produces: one row twice and
 *      another never.
 *   3. THE ASSEMBLED GRAPH IS WHOLE — no membership pointing at a missing
 *      object, no edge with a missing endpoint, no duplicated child.
 *   4. THE PAGES ARE CONTIGUOUS AND NONE WIDER THAN THE CEILING — a page
 *      wider than `max_rows` is a silent clip again, and a gap between two
 *      pages is a lost row.
 *   5. THE ORDER IS TOTAL — `.order("id")` last on every walked read. Property
 *      2 is a *consequence* of this one, and the last case here proves the
 *      consequence by taking the tie-break away.
 *
 * ⚠ **`supabaseAdmin` HANDS OUT A FRESH FAKE PER CALL, ON PURPOSE.**
 * `service-reads.ts › admittedWalk` fans its reads with `Promise.all`, and one
 * `fakePostgrest` client holds ONE builder's mutable state — two concurrent
 * walks through a single instance would interleave and the suite would be
 * asserting the fake's bug. One instance per `supabaseAdmin()` call also gives
 * each read its own `calls`/`pageReads` to assert on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_ROWS,
  fakePostgrest,
  type FakePostgrest,
  type FakeTables,
  type Row,
} from "@/shared/testing/postgrest-cap";
import { readAllPages } from "@/shared/supabase/max-rows";
import { ONTOLOGY_READ_LIMITS } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

// A STANDARD workspace → `unrestricted`, which is the arm every board is on
// today: the fence is not this suite's subject, the row count is.
vi.mock("./repository-shares", () => ({
  findWorkspaceKind: vi.fn(async () => "standard"),
  countActiveWorkspaceMembers: vi.fn(async () => 1),
  listChannelIdsForWorkspace: vi.fn(async () => []),
  listSharesForChannels: vi.fn(async () => []),
  countSharesForOntologies: vi.fn(async () => new Map<string, number>()),
}));

vi.mock("@/shared/tenancy/home-space-reach", () => ({
  homeSpaceShelfContainerIds: vi.fn(async () => []),
}));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  listMemberships,
  listObjectsByIds,
  listOntologies,
  listRelationshipsForSources,
} from "./repository";
import { listObjectSummariesByIds, listOntologySummaries } from "./repository-projections";
import { getSnapshot, getSummary } from "./service";

const WS = "ws-1";
const ONTOLOGY = "ont-1";

/** Zero-padded so the `id` tie-break sorts the way a human reads it — the fake
 *  compares strings with `localeCompare`, exactly as Postgres collates text. */
const pad = (n: number) => String(n).padStart(5, "0");
const objectId = (n: number) => `obj-${pad(n)}`;

/** ⚠ ALL THREE SETS ARE OVER `MAX_ROWS`. 1,200 objects hang off the ontology
 *  and 200 more hang under the FIRST of them, so the nested 200 are reachable
 *  only through membership rows past the clip: a clipped membership read loses
 *  200 objects that the board would then draw edges into. */
const ROOT_OBJECTS = 1_200;
const NESTED_OBJECTS = 200;
const TOTAL_OBJECTS = ROOT_OBJECTS + NESTED_OBJECTS;
const NEST_PARENT = objectId(0);

const OBJECT_IDS = Array.from({ length: TOTAL_OBJECTS }, (_, i) => objectId(i));

function objectRows(): Row[] {
  return OBJECT_IDS.map((id, i) => ({
    id,
    workspace_id: WS,
    name: `Object ${i}`,
    subtitle: "",
    attributes: [],
    methods: [],
    template: [],
    user_id: null,
    last_edited_by: null,
    last_edited_source: null,
    position: i,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    deleted_at: null,
  }));
}

function membershipRows(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < ROOT_OBJECTS; i++) {
    rows.push({
      id: `mem-${pad(i)}`,
      workspace_id: WS,
      ontology_id: ONTOLOGY,
      parent_object_id: null,
      child_object_id: objectId(i),
      position: i,
      created_at: "2026-10-01T00:00:00Z",
    });
  }
  for (let j = 0; j < NESTED_OBJECTS; j++) {
    rows.push({
      id: `mem-${pad(ROOT_OBJECTS + j)}`,
      workspace_id: WS,
      ontology_id: null,
      parent_object_id: NEST_PARENT,
      child_object_id: objectId(ROOT_OBJECTS + j),
      // ⚠ Deliberately COLLIDES with a root row's `position`: the walked order
      // is non-unique and only `id` makes it total.
      position: j,
      created_at: "2026-10-01T00:00:00Z",
    });
  }
  return rows;
}

/** One edge per object, around a ring, so EVERY endpoint exists in the fixture
 *  — any missing endpoint in the answer is the read's doing, never the data's. */
function relationshipRows(): Row[] {
  return OBJECT_IDS.map((id, i) => ({
    id: `rel-${pad(i)}`,
    workspace_id: WS,
    source_object_id: id,
    label: "next",
    target_object_id: objectId((i + 1) % TOTAL_OBJECTS),
    position: 0,
    created_at: "2026-10-01T00:00:00Z",
  }));
}

function ontologyRows(count = 1): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: count === 1 ? ONTOLOGY : `ont-${pad(i)}`,
    workspace_id: WS,
    slug: `ontology-${i}`,
    name: `Ontology ${i}`,
    purpose: "",
    layout: null,
    position: 0,
    created_by: "user-1",
    agents_may_edit: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    deleted_at: null,
  }));
}

function tables(over: Partial<FakeTables> = {}): FakeTables {
  return {
    ontologies: ontologyRows(),
    ontology_objects: objectRows(),
    ontology_memberships: membershipRows(),
    ontology_relationships: relationshipRows(),
    ...over,
  };
}

let instances: FakePostgrest[] = [];

/** Install the fake, one instance per `supabaseAdmin()` call (see the header). */
function install(t: FakeTables = tables()): void {
  instances = [];
  vi.mocked(supabaseAdmin).mockImplementation(() => {
    const fake = fakePostgrest(t);
    instances.push(fake);
    return fake.client as never;
  });
}

/** The instance that read `table` — `calls[0]` is always its `from()`. */
function reader(table: string): FakePostgrest {
  const found = instances.find((i) => i.calls[0]?.args[0] === table);
  if (!found) throw new Error(`no read of ${table}: ${instances.length} instances`);
  return found;
}

function ranges(fake: FakePostgrest): Array<[number, number]> {
  return fake.calls
    .filter((c) => c.op === "range")
    .map((c) => [c.args[0] as number, c.args[1] as number]);
}

const ctx = ontologyContextFactory({ workspaceId: WS });

beforeEach(() => {
  vi.clearAllMocks();
  install();
});

describe("1. the case has teeth — the fake really does clip", () => {
  it("a single-shot .limit(ONTOLOGY_READ_LIMITS.objects) returns exactly MAX_ROWS", async () => {
    expect(TOTAL_OBJECTS).toBeGreaterThan(MAX_ROWS);
    const fake = fakePostgrest(tables());
    const db = fake.client as never as {
      from: (t: string) => Record<string, (...a: unknown[]) => unknown>;
    };
    const query = db.from("ontology_objects");
    const { data } = (await (
      query.select("*") as Record<string, (...a: unknown[]) => unknown>
    ).limit(ONTOLOGY_READ_LIMITS.objects)) as { data: Row[] };
    // THE BUG, reproduced: asked 5,000, served 1,000, told nothing.
    expect(data).toHaveLength(MAX_ROWS);
    expect(ONTOLOGY_READ_LIMITS.objects).toBeGreaterThan(MAX_ROWS);
  });
});

describe("2. every row arrives — the id SET, not the length", () => {
  const complete = (rows: Array<{ id: string }>, expected: string[]) => {
    const ids = rows.map((r) => r.id);
    // Three distinct failures, three distinct assertions: short, duplicated,
    // and gapped. A length check alone passes a walk that re-served page 0.
    expect(ids).toHaveLength(expected.length);
    expect(new Set(ids).size).toBe(expected.length);
    expect([...ids].sort()).toEqual([...expected].sort());
  };

  it("listObjectsByIds pages all 1,400 objects", async () => {
    const { rows, truncated } = await listObjectsByIds([WS], OBJECT_IDS);
    complete(rows, OBJECT_IDS);
    expect(truncated).toBe(false);
  });

  it("listMemberships pages all 1,400 membership rows", async () => {
    const { rows, truncated } = await listMemberships([WS]);
    complete(
      rows,
      membershipRows().map((r) => r.id as string)
    );
    expect(truncated).toBe(false);
  });

  it("listRelationshipsForSources pages all 1,400 edges", async () => {
    const { rows, truncated } = await listRelationshipsForSources([WS], OBJECT_IDS);
    complete(
      rows,
      relationshipRows().map((r) => r.id as string)
    );
    expect(truncated).toBe(false);
  });

  it("listObjectSummariesByIds — the map projection pages too", async () => {
    const { rows } = await listObjectSummariesByIds([WS], OBJECT_IDS);
    complete(rows, OBJECT_IDS);
  });
});

describe("3. the assembled graph is whole", () => {
  it("getSnapshot returns every object and no edge with a missing endpoint", async () => {
    const snapshot = await getSnapshot(ctx());

    expect(Object.keys(snapshot.objects)).toHaveLength(TOTAL_OBJECTS);
    expect([...Object.keys(snapshot.objects)].sort()).toEqual([...OBJECT_IDS].sort());

    // 🔒 THE SYMPTOM THIS WHOLE FIX EXISTS FOR: an edge into an object the
    // caller was told does not exist. `getSnapshot` DROPS such an edge, so a
    // clipped object read shows up here as missing targets, not as broken ones.
    let targets = 0;
    for (const [id, object] of Object.entries(snapshot.objects)) {
      for (const edge of object.relationships) {
        for (const target of edge.targetIds) {
          expect(snapshot.objects[target], `${id} → ${target}`).toBeDefined();
          targets += 1;
        }
      }
    }
    expect(targets).toBe(TOTAL_OBJECTS);
  });

  it("the ontology keeps all 1,200 columns, once each, and the nested 200 arrive", async () => {
    const snapshot = await getSnapshot(ctx());
    const columnIds = snapshot.ontologies[0].columnIds;
    expect(columnIds).toHaveLength(ROOT_OBJECTS);
    expect(new Set(columnIds).size).toBe(ROOT_OBJECTS);
    // Reachable ONLY through membership rows past row 1,000.
    expect(snapshot.objects[NEST_PARENT].childIds).toHaveLength(NESTED_OBJECTS);
    expect(new Set(snapshot.objects[NEST_PARENT].childIds).size).toBe(NESTED_OBJECTS);
  });

  it("getSummary assembles the same whole structure and reports truncated:false", async () => {
    const summary = await getSummary(ctx());
    expect(Object.keys(summary.objects)).toHaveLength(TOTAL_OBJECTS);
    expect(summary.ontologies[0].columnIds).toHaveLength(ROOT_OBJECTS);
    expect(summary.objects[NEST_PARENT].childIds).toHaveLength(NESTED_OBJECTS);
    expect(summary.truncated).toBe(false);
  });
});

describe("4. the pages are contiguous and none wider than the ceiling", () => {
  it("walks 0..999, 1000..1399 — two reads, no gap, no page over MAX_ROWS", async () => {
    await listMemberships([WS]);
    const fake = reader("ontology_memberships");
    const windows = ranges(fake);

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0][0]).toBe(0);
    let next = 0;
    for (const [from, to] of windows) {
      // A gap loses rows; an overlap double-counts them.
      expect(from).toBe(next);
      expect(to - from + 1).toBeLessThanOrEqual(MAX_ROWS);
      next = to + 1;
    }
    expect(fake.pageReads()).toBe(windows.length);
    // ⚠ NO `.limit()` SURVIVES on a walked read: `max_rows` already bounds the
    // window, and a stray `.limit` above it is the request the server declines.
    expect(fake.calls.some((c) => c.op === "limit")).toBe(false);
  });

  it("every walked read orders by id LAST — the total order paging needs", async () => {
    await Promise.all([
      listMemberships([WS]),
      listObjectsByIds([WS], OBJECT_IDS),
      listRelationshipsForSources([WS], OBJECT_IDS),
      listOntologies([WS]),
      listOntologySummaries([WS]),
    ]);
    for (const table of [
      "ontology_memberships",
      "ontology_objects",
      "ontology_relationships",
      "ontologies",
    ]) {
      const orders = reader(table)
        .calls.filter((c) => c.op === "order")
        .map((c) => c.args[0]);
      // Per PAGE, so take the last of the first page's keys.
      expect(orders[orders.length - 1]).toBe("id");
      expect(orders).toContain("id");
    }
  });
});

describe("5. the hardCap is still a ceiling, and still reported", () => {
  it("an ontology set AT ONTOLOGY_READ_LIMITS.ontologies reports truncated:true", async () => {
    const atCap = ONTOLOGY_READ_LIMITS.ontologies;
    // ⚠ Under `MAX_ROWS`, so this is the `hardCap` talking and not the server:
    // the walk filled its whole budget without a short page, which is
    // indistinguishable from more rows waiting.
    expect(atCap).toBeLessThanOrEqual(MAX_ROWS);
    install(tables({ ontologies: ontologyRows(atCap) }));
    const { rows, truncated } = await listOntologies([WS]);
    expect(rows).toHaveLength(atCap);
    expect(truncated).toBe(true);
  });

  it("a membership set AT its 20,000 hardCap walks all of it and reports the clip", async () => {
    // The real cap, walked for real: 20 pages of 1,000, every row served once,
    // and `truncated` true because the budget ran out rather than the table.
    const atCap: Row[] = Array.from(
      { length: ONTOLOGY_READ_LIMITS.memberships },
      (_, i) => ({
        id: `mem-${pad(i)}`,
        workspace_id: WS,
        ontology_id: ONTOLOGY,
        parent_object_id: null,
        child_object_id: objectId(i % TOTAL_OBJECTS),
        position: i,
        created_at: "2026-10-01T00:00:00Z",
      })
    );
    install(tables({ ontology_memberships: atCap }));
    const { rows, truncated } = await listMemberships([WS]);
    expect(rows).toHaveLength(ONTOLOGY_READ_LIMITS.memberships);
    expect(new Set(rows.map((r) => r.id)).size).toBe(ONTOLOGY_READ_LIMITS.memberships);
    expect(truncated).toBe(true);
    expect(reader("ontology_memberships").pageReads()).toBe(
      ONTOLOGY_READ_LIMITS.memberships / MAX_ROWS
    );
  });

  it("one row under the hardCap is exhausted, not clipped", async () => {
    install(tables({ ontologies: ontologyRows(ONTOLOGY_READ_LIMITS.ontologies - 1) }));
    const { truncated } = await listOntologies([WS]);
    expect(truncated).toBe(false);
  });

  it("getSummary surfaces the walk's own truncated, never a length comparison", async () => {
    install(
      tables({
        ontologies: ontologyRows(ONTOLOGY_READ_LIMITS.ontologies),
        ontology_memberships: [],
      })
    );
    const summary = await getSummary(ctx());
    // The old code compared `objectRows.length >= 5_000` and friends, which a
    // 1,000-row clip could never satisfy — this line could not fire at all.
    expect(summary.truncated).toBe(true);
  });
});

/* ───────────────────────── 6. the tie-break itself ─────────────────────────
 * ⚠ `fakePostgrest` sorts STABLY, so it cannot reproduce what a non-unique
 * ORDER BY actually costs — Postgres is free to answer ties in a different
 * order per statement, and two pages are two statements. This pager does what
 * the server is allowed to do: it rotates each tie-group by the page number.
 * With `position` alone the walk then duplicates and skips rows; with
 * `position, id` there are no ties left to rotate. That is the whole reason
 * every converted read above ends `.order("id")`.
 */

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function pagerWithRotatedTies(rows: Row[], keys: string[]) {
  let statement = 0;
  return async (from: number, to: number) => {
    const sorted = [...rows].sort((a, b) => {
      for (const k of keys) {
        const c = cmp(a[k], b[k]);
        if (c !== 0) return c;
      }
      return 0;
    });
    const spin = ++statement;
    const out: Row[] = [];
    for (let i = 0; i < sorted.length; ) {
      let j = i + 1;
      while (
        j < sorted.length &&
        keys.every((k) => cmp(sorted[i][k], sorted[j][k]) === 0)
      )
        j += 1;
      const group = sorted.slice(i, j);
      // A legal answer the server may give: same rows, any order within the tie.
      out.push(...group.slice(spin % group.length), ...group.slice(0, spin % group.length));
      i = j;
    }
    return { data: out.slice(from, to + 1), error: null };
  };
}

describe("6. a NON-UNIQUE sort column duplicates and skips — the id tie-break is what stops it", () => {
  // 20 positions × 3 rows: a tie-group straddles every page boundary below.
  const TIED: Row[] = Array.from({ length: 60 }, (_, i) => ({
    id: `row-${pad(i)}`,
    position: Math.floor(i / 3),
  }));

  it("ordering on `position` ALONE loses rows and repeats others", async () => {
    const { rows } = await readAllPages<Row>(
      pagerWithRotatedTies(TIED, ["position"]),
      { hardCap: 1_000, pageSize: 10 }
    );
    const ids = rows.map((r) => r.id as string);
    const seen = new Set(ids);
    // The silent corruption, demonstrated: a duplicate AND a row never served.
    expect(seen.size).toBeLessThan(TIED.length);
    expect(ids.length).toBeGreaterThan(seen.size);
  });

  it("ordering on `position, id` serves all 60 exactly once", async () => {
    const { rows } = await readAllPages<Row>(
      pagerWithRotatedTies(TIED, ["position", "id"]),
      { hardCap: 1_000, pageSize: 10 }
    );
    const ids = rows.map((r) => r.id as string);
    expect(ids).toHaveLength(TIED.length);
    expect(new Set(ids).size).toBe(TIED.length);
    expect(ids).toEqual(TIED.map((r) => r.id as string));
  });
});
