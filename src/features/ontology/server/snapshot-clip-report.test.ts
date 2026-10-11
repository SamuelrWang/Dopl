/**
 * 🔒 **`getSnapshot` REPORTS ITS CLIP (Samuel #2935, the review of the `max_rows`
 * sweep).**
 *
 * The sweep turned all four reads behind this projection into page walks that
 * return `Clipped<>` — the ontologies, the membership walk, the objects and the
 * relationships — and `getSnapshot` **discarded every one of those markers** while
 * {@link getSummary}, built on the SAME walk, reported its own.
 * `packages/mcp-server/src/tools/ontology-clipped.ts` names the asymmetry in so
 * many words: *"`getSummary` returns `truncated` while `getSnapshot` carries the
 * identical ceilings silently"*.
 *
 * ⚠ **AND A CLIPPED GRAPH IS NOT AN UNDER-REPORT, IT IS A WRONG PICTURE.** At the
 * `ONTOLOGY_READ_LIMITS.objects` cap the board draws a SMALLER GRAPH whose
 * memberships and edges point at objects the payload says do not exist — and
 * `row-cap-paging.test.ts` already proves the assembly drops those dangling ends,
 * which is precisely why nothing downstream could notice. Only the flag can.
 *
 * ⚠ **THE FIXTURE SITS *AT* THE OBJECT CAP, NOT MERELY OVER `max_rows`.** Paging
 * fixed the 1,000-row clip; what is left is the hard cap, so a 1,200-object
 * fixture (what `row-cap-paging.test.ts` uses) is caught by the walk and proves
 * nothing here. `ONTOLOGY_READ_LIMITS.objects` objects is the smallest fixture
 * that reaches it — and AT the ceiling counts as clipped, because at is
 * indistinguishable from over.
 *
 * ⚠ `supabaseAdmin` HANDS OUT A FRESH FAKE PER CALL, for the reason
 * `row-cap-paging.test.ts` gives: `admittedWalk` fans its reads with
 * `Promise.all`, and one `fakePostgrest` client holds ONE builder's mutable state.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - drop `truncated` from `getSnapshot`'s return → every case here fails to
 *    compile or reads `undefined`.
 *  - OR only `walkTruncated` and forget `objectRows.truncated` → "reports the
 *    object cap" fails.
 *  - hardcode `truncated: false` → "reports the object cap" fails while
 *    "an exhausted graph" still passes, which is why both are here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fakePostgrest,
  type FakePostgrest,
  type FakeTables,
  type Row,
} from "@/shared/testing/postgrest-cap";
import { ONTOLOGY_READ_LIMITS } from "./dto";
import { ontologyContextFactory } from "./test-fixtures";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

// A STANDARD workspace → `unrestricted`: the fence is not this suite's subject.
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
import { getSnapshot, getSummary } from "./service";

const WS = "ws-1";
const ONTOLOGY = "ont-1";

/** 🔒 **EXACTLY THE OBJECT CEILING.** `readAllPages` returns `truncated: true`
 *  when the walk reaches its `hardCap`, and AT the ceiling IS clipped. */
const AT_CAP = ONTOLOGY_READ_LIMITS.objects;
/** A graph the walks finish — the control for "the flag is not hardcoded". */
const UNDER_CAP = 1_200;

const pad = (n: number) => String(n).padStart(5, "0");
const objectId = (n: number) => `obj-${pad(n)}`;

function objectRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: objectId(i),
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

/** One membership per object, all hanging off the ontology, so the walk reaches
 *  every object and the OBJECT read is the one that hits its ceiling. */
function membershipRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mem-${pad(i)}`,
    workspace_id: WS,
    ontology_id: ONTOLOGY,
    parent_object_id: null,
    child_object_id: objectId(i),
    position: i,
    created_at: "2026-10-01T00:00:00Z",
  }));
}

function ontologyRows(): Row[] {
  return [
    {
      id: ONTOLOGY,
      workspace_id: WS,
      slug: "ontology-0",
      name: "Ontology 0",
      purpose: "",
      layout: null,
      position: 0,
      created_by: "user-1",
      agents_may_edit: true,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      deleted_at: null,
    },
  ];
}

function tables(count: number): FakeTables {
  return {
    ontologies: ontologyRows(),
    ontology_objects: objectRows(count),
    ontology_memberships: membershipRows(count),
    // ⚠ No edges: the relationships walk has its own ceiling (20,000) and this
    // suite's subject is the OBJECT one, so leaving it empty keeps exactly one
    // marker true and makes the OR under test observable.
    ontology_relationships: [],
  };
}

let instances: FakePostgrest[] = [];

function install(count: number): void {
  instances = [];
  const t = tables(count);
  vi.mocked(supabaseAdmin).mockImplementation(() => {
    const fake = fakePostgrest(t);
    instances.push(fake);
    return fake.client as never;
  });
}

const ctx = ontologyContextFactory({ workspaceId: WS });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSnapshot reports the clip getSummary already reported", () => {
  /** 🔒 **THE SYMPTOM, AND IT IS A SILENT ONE BY CONSTRUCTION.** The payload is a
   *  smaller graph; nothing in it is malformed, because the assembly drops the
   *  dangling ends. The flag is the only thing that can distinguish this from a
   *  workspace that really holds 5,000 objects. */
  it(`reports the ${AT_CAP}-object cap as truncated`, async () => {
    install(AT_CAP);

    const snapshot = await getSnapshot(ctx());

    expect(snapshot.truncated).toBe(true);
    // The graph really is at its ceiling — the clip is real, not asserted in the
    // abstract.
    expect(Object.keys(snapshot.objects)).toHaveLength(AT_CAP);
  });

  it("reports an exhausted graph as complete", async () => {
    install(UNDER_CAP);

    const snapshot = await getSnapshot(ctx());

    expect(snapshot.truncated).toBe(false);
    expect(Object.keys(snapshot.objects)).toHaveLength(UNDER_CAP);
  });

  /** 🔒 **THE TWO PROJECTIONS NOW AGREE, WHICH IS THE WHOLE COMPLAINT.** They run
   *  the same walk under the same ceilings; only one of them used to admit it. */
  it("agrees with getSummary on the same fixture, clipped and not", async () => {
    install(AT_CAP);
    const cappedSnapshot = await getSnapshot(ctx());
    install(AT_CAP);
    const cappedSummary = await getSummary(ctx());
    expect(cappedSnapshot.truncated).toBe(cappedSummary.truncated);
    expect(cappedSummary.truncated).toBe(true);

    install(UNDER_CAP);
    const wholeSnapshot = await getSnapshot(ctx());
    install(UNDER_CAP);
    const wholeSummary = await getSummary(ctx());
    expect(wholeSnapshot.truncated).toBe(wholeSummary.truncated);
    expect(wholeSummary.truncated).toBe(false);
  });

  /** ⚠ The field is ADDITIVE: every `OntologySnapshot` consumer still reads the
   *  keys it always read, and the flag rides beside them on the wire. */
  it("adds the flag without disturbing the payload's own keys", async () => {
    install(UNDER_CAP);

    const snapshot = await getSnapshot(ctx());

    expect(Object.keys(snapshot).sort()).toEqual([
      "homeSpaceOntologyIds",
      "objects",
      "ontologies",
      "truncated",
    ]);
    expect(snapshot.ontologies).toHaveLength(1);
    expect(snapshot.ontologies[0].columnIds).toHaveLength(UNDER_CAP);
  });
});
