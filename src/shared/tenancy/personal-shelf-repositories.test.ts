/**
 * BOTH SHELF-BEARING TABLES, DRIVEN THROUGH THE REAL REPOSITORY FUNCTIONS, so
 * what is pinned is the SQL each one emits rather than the resolver's return
 * value (which `personal-container.test.ts` already holds).
 *
 * ⚠ ONE FILE FOR TWO FEATURES ON PURPOSE. `knowledge_bases` and
 * `agent_templates` are hand mirrors of each other on the shelf axis — same
 * column, same three functions, same fence — and every previous divergence
 * between them (F-342, and the two `resolveHomeScope` copies that disagreed
 * about private-terminal vs private-floor — both DELETED in slice B15) happened
 * because their tests could not see each other. Asserting the pair side by side
 * is what makes a one-sided edit fail.
 *
 * ⚠ **THE SHELF AXIS IS A TENANCY SINCE 2026-09-02 (slice B15)**, so every case
 * that drove `TENANCY_PERSONAL_CONTAINER` or asserted a `home_scoped` filter is
 * gone with the flag and the column. What is left is the same pair, asked the
 * new way: the personal shelf is ONE container, the workspace shelf is the
 * calling workspace, and the write REFUSES rather than falling back.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/shared/supabase/caller-scope", () => ({ getCallerScope: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  insertBase,
  listBasesForWorkspace,
  listHomeScopedBaseIds,
} from "@/features/knowledge/server/repository-bases";
import {
  insertTemplate,
  listHomeScopedTemplateIds,
  listTemplatesForWorkspace,
} from "@/features/agent-templates/server/repository";

const USER = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CONTAINER = "33333333-3333-4333-8333-333333333333";

interface Query {
  table: string;
  filters: Array<[string, unknown]>;
  inserted?: Record<string, unknown>;
}

let queries: Query[];
let containerId: string | null;

/** Every query the call made, minus the container lookup itself. */
function rowQueries(): Query[] {
  return queries.filter((q) => q.table !== "workspaces");
}

function filterFor(table: string, column: string): unknown {
  const q = rowQueries().find((r) => r.table === table);
  return q?.filters.find(([c]) => c === column)?.[1];
}

function primeSupabase() {
  queries = [];
  const builder: Record<string, unknown> = {};
  let current: Query = { table: "", filters: [] };
  Object.assign(builder, {
    from: (table: string) => {
      current = { table, filters: [] };
      queries.push(current);
      return builder;
    },
    select: () => builder,
    order: () => builder,
    eq: (c: string, v: unknown) => {
      current.filters.push([c, v]);
      return builder;
    },
    is: (c: string, v: unknown) => {
      current.filters.push([c, v]);
      return builder;
    },
    in: (c: string, v: unknown) => {
      current.filters.push([c, v]);
      return builder;
    },
    insert: (row: Record<string, unknown>) => {
      current.inserted = row;
      return builder;
    },
    maybeSingle: async () => ({
      data: containerId === null ? null : { id: containerId },
      error: null,
    }),
    single: async () => ({
      data: { id: "row-1", ...(current.inserted ?? {}) },
      error: null,
    }),
    then: (resolve: (r: unknown) => void) => resolve({ data: [], error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  containerId = CONTAINER;
  primeSupabase();
  vi.mocked(getCallerScope).mockReturnValue({
    userId: USER,
    sharedCredential: false,
    credentialWorkspaceId: null,
  });
});

describe("the personal shelf is ONE container, on both tables", () => {
  it("reads the caller's container and nothing else, on both tables", async () => {
    await listBasesForWorkspace(WORKSPACE, false, "home");
    await listTemplatesForWorkspace(WORKSPACE, "home");
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([CONTAINER]);
      // ⚠ MUTATION CHECK ACROSS THE DROP: a surviving `home_scoped` predicate
      // would 42703 the whole query the day the column goes.
      expect(
        rowQueries().some((q) => q.filters.some(([c]) => c === "home_scoped")),
        `${table} still filters a dropped column`
      ).toBe(false);
    }
  });

  it("the WORKSPACE shelf and an ABSENT shelf are the calling workspace, and ask nothing", async () => {
    for (const shelf of ["workspace", undefined] as const) {
      queries = [];
      primeSupabase();
      await listBasesForWorkspace(WORKSPACE, false, shelf);
      await listTemplatesForWorkspace(WORKSPACE, shelf);
      expect(filterFor("knowledge_bases", "workspace_id")).toEqual([WORKSPACE]);
      expect(filterFor("agent_templates", "workspace_id")).toEqual([WORKSPACE]);
      expect(
        queries.some((q) => q.table === "workspaces"),
        "a non-personal shelf must not look for a container"
      ).toBe(false);
    }
  });
});

describe("the LABEL asks what the LIST asked", () => {
  it("the sibling-key fold reads the same container the list reads", async () => {
    await listHomeScopedBaseIds(WORKSPACE, ["kb-1"]);
    await listHomeScopedTemplateIds(WORKSPACE, ["t-1"]);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([CONTAINER]);
    }
  });

  it("an empty id set still costs nothing", async () => {
    expect(await listHomeScopedBaseIds(WORKSPACE, [])).toEqual([]);
    expect(await listHomeScopedTemplateIds(WORKSPACE, [])).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("🔒 with no container, the fold is EMPTY and asks nothing", async () => {
    // ⚠ Without the early return this would `.in("workspace_id", [])`, which is
    // harmless — and the round trip is not. The label is a fold over ids the
    // caller was already shown; there is nothing to fold against.
    containerId = null;
    expect(await listHomeScopedBaseIds(WORKSPACE, ["kb-1"])).toEqual([]);
    expect(await listHomeScopedTemplateIds(WORKSPACE, ["t-1"])).toEqual([]);
    expect(rowQueries()).toEqual([]);
  });
});

describe("the personal WRITE", () => {
  const baseArgs = {
    workspaceId: WORKSPACE,
    name: "Notes",
    slug: "notes",
    createdBy: USER,
  };
  const templateArgs = {
    workspaceId: WORKSPACE,
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private" as const,
    createdBy: USER,
  };

  it("files a personal row in the container, and writes no shelf column", async () => {
    await insertBase({ ...baseArgs, homeScoped: true });
    await insertTemplate({ ...templateArgs, homeScoped: true });
    for (const table of ["knowledge_bases", "agent_templates"]) {
      const row = rowQueries().find((q) => q.table === table)?.inserted ?? {};
      expect(row.workspace_id, table).toBe(CONTAINER);
      // 🔒 MUTATION CHECK: the flag routes the row and nothing stores it.
      expect("home_scoped" in row, `${table} still writes a dropped column`).toBe(
        false
      );
    }
  });

  it("a WORKSPACE-shelf insert is untouched, and asks no container question", async () => {
    await insertBase(baseArgs);
    await insertTemplate(templateArgs);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(
        rowQueries().find((q) => q.table === table)?.inserted?.workspace_id,
        table
      ).toBe(WORKSPACE);
    }
    expect(queries.some((q) => q.table === "workspaces")).toBe(false);
  });

  it("🔒 REFUSES on both tables when there is no container, rather than landing in the workspace", async () => {
    // ⚠ THE PAIR IS THE POINT: a one-sided fallback is exactly the divergence
    // this file exists to catch, and it is invisible from either feature alone.
    containerId = null;
    await expect(insertBase({ ...baseArgs, homeScoped: true })).rejects.toMatchObject(
      { code: "PERSONAL_CONTAINER_MISSING" }
    );
    await expect(
      insertTemplate({ ...templateArgs, homeScoped: true })
    ).rejects.toMatchObject({ code: "PERSONAL_CONTAINER_MISSING" });
    expect(
      rowQueries(),
      "nothing may be inserted before the refusal"
    ).toEqual([]);
  });

  it("🔒 what the write lands in, the list looks in", async () => {
    await insertBase({ ...baseArgs, homeScoped: true });
    const wrote = rowQueries()[0]?.inserted?.workspace_id;
    queries = [];
    primeSupabase();
    await listBasesForWorkspace(WORKSPACE, false, "home");
    expect(filterFor("knowledge_bases", "workspace_id")).toEqual([wrote]);
  });
});
