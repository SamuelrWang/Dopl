/**
 * THE "IT LIVES ELSEWHERE" READ's QUERY SHAPE (T35).
 *
 * ⚠ **THE ONLY COVERAGE THIS MODULE HAD WAS A MOCK OF ITSELF** — the two
 * `service-resolve*` suites stub `findTemplateTenancyRows`, so nothing anywhere
 * asserted the filters that actually reach PostgREST. This suite drives the real
 * function against a recording builder, `repository-messages.test.ts`'s shape.
 *
 * 🔒 **THE `.or()` IS WHAT KEEPS THIS FROM BEING AN EXISTENCE ORACLE**, and it
 * is the assertion to protect: two arms only — the caller's OWN rows, and
 * `visibility = 'workspace'` rows every member can already list. A `private` or
 * `team` row of another member's matches neither, so no refusal built on this
 * read can name the workspace one lives in.
 *
 * ⚠ **THE EMBED IS DELIBERATE AND IS NOT THE `!inner` THE DELETE ROUTE WARNS
 * ABOUT.** `app/api/user/delete/route.ts`'s note is about joining OUT of
 * `workspaces` after the May 2026 denormalizations; this is the opposite
 * direction — a child embedding its parent by FK — which is the identical shape
 * `workspaces/server/repository.ts › listWorkspacesForUser` and
 * `home/server/repository-containers.ts › listLinkContainers` run on every
 * workspace list. The flatten below (1:1 typed as an array) is pinned because
 * that is the half a future edit gets wrong.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { findTemplateTenancyRows } from "./repository-tenancy";

const ME = "22222222-3333-4444-5555-666666666666";
const WS_A = "11111111-2222-3333-4444-555555555555";
const WS_B = "99999999-8888-7777-6666-555555555555";

type Call = { op: string; args: unknown[] };

function makeAdmin(rows: unknown[]) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => rec("from", [t]),
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    or: (f: string) => rec("or", [f]),
    ilike: (c: string, v: unknown) => rec("ilike", [c, v]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

function arg(calls: Call[], op: string): unknown[] | undefined {
  return calls.find((c) => c.op === op)?.args;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 the two-arm visibility filter", () => {
  it("names the caller's own rows and workspace-visible rows, and nothing else", () => {
    const calls = makeAdmin([]);
    void findTemplateTenancyRows(ME, [WS_A, WS_B], { id: "t-1" });
    // ⚠ MUTATION CHECK. Drop the `created_by` arm and the caller loses their own
    // private rows; drop the `visibility` arm and the refusal stops naming the
    // shared template it exists to explain. ADD a third arm and this read starts
    // naming the workspace another member's private template lives in, which is
    // the existence oracle the 404-never-403 surface closes.
    expect(arg(calls, "or")).toEqual([
      `created_by.eq.${ME},visibility.eq.workspace`,
    ]);
  });

  it("is bounded to the caller's own memberships and never queries without them", async () => {
    const calls = makeAdmin([]);
    await findTemplateTenancyRows(ME, [WS_A, WS_B], { id: "t-1" });
    expect(arg(calls, "in")).toEqual(["workspace_id", [WS_A, WS_B]]);

    const none = makeAdmin([]);
    expect(await findTemplateTenancyRows(ME, [], { id: "t-1" })).toEqual([]);
    expect(none).toEqual([]);
  });

  it("issues nothing at all when the ref names neither an id nor a name", async () => {
    const calls = makeAdmin([]);
    expect(await findTemplateTenancyRows(ME, [WS_A], {})).toEqual([]);
    // The builder was built but never awaited — no `then` ran.
    expect(calls.some((c) => c.op === "eq" || c.op === "ilike")).toBe(false);
  });
});

describe("ref matching", () => {
  it("prefers the id and does not also match on the name", async () => {
    const calls = makeAdmin([]);
    await findTemplateTenancyRows(ME, [WS_A], { id: "t-1", name: "Auditor" });
    expect(arg(calls, "eq")).toEqual(["id", "t-1"]);
    expect(arg(calls, "ilike")).toBeUndefined();
  });

  it("matches a name case-insensitively and ESCAPES the wildcards", async () => {
    // ⚠ MUTATION CHECK. Unescaped, a caller-supplied `%` matches ANYTHING —
    // `ilike` is an exact match here, never a pattern.
    const calls = makeAdmin([]);
    await findTemplateTenancyRows(ME, [WS_A], { name: "100%_off\\x" });
    expect(arg(calls, "ilike")).toEqual(["name", "100\\%\\_off\\\\x"]);
  });
});

describe("the 1:1 embed is flattened, whichever way PostgREST types it", () => {
  it("reads an OBJECT embed", async () => {
    makeAdmin([
      {
        id: "t-1",
        name: "Auditor",
        workspace_id: WS_A,
        home_scoped: true,
        workspace: { name: "Alpha", kind: "link" },
      },
    ]);
    expect(await findTemplateTenancyRows(ME, [WS_A], { id: "t-1" })).toEqual([
      {
        id: "t-1",
        name: "Auditor",
        workspaceId: WS_A,
        workspaceName: "Alpha",
        workspaceKind: "link",
        homeScoped: true,
      },
    ]);
  });

  it("reads a one-element ARRAY embed identically", async () => {
    makeAdmin([
      {
        id: "t-1",
        name: "Auditor",
        workspace_id: WS_A,
        home_scoped: false,
        workspace: [{ name: "Alpha", kind: "standard" }],
      },
    ]);
    const [row] = await findTemplateTenancyRows(ME, [WS_A], { id: "t-1" });
    expect(row.workspaceName).toBe("Alpha");
    expect(row.workspaceKind).toBe("standard");
  });

  it("degrades an ABSENT embed to a blank name and a STANDARD kind", async () => {
    // ⚠ Never `undefined` into a rendered refusal, and never a guessed `link`:
    // "standard" is the answer that claims the least.
    makeAdmin([
      {
        id: "t-1",
        name: "Auditor",
        workspace_id: WS_A,
        home_scoped: null,
        workspace: [],
      },
    ]);
    const [row] = await findTemplateTenancyRows(ME, [WS_A], { id: "t-1" });
    expect(row.workspaceName).toBe("");
    expect(row.workspaceKind).toBe("standard");
    // ⚠ `=== true`, so a null column is FALSE rather than truthy-unknown.
    expect(row.homeScoped).toBe(false);
  });
});
