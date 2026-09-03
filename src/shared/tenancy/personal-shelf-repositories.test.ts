/**
 * BOTH SHELF-BEARING TABLES, DRIVEN THROUGH THE REAL REPOSITORY FUNCTIONS, so
 * what is pinned is the SQL each one emits rather than the resolver's return
 * value (which `personal-container.test.ts` already holds).
 *
 * ⚠ ONE FILE FOR TWO FEATURES ON PURPOSE. `knowledge_bases` and
 * `agent_templates` are hand mirrors of each other on the shelf axis — same
 * column, same three functions, same fence — and every previous divergence
 * between them (F-342, the two `resolveHomeScope` copies that disagree about
 * private-terminal vs private-floor) happened because their tests could not see
 * each other. Asserting the pair side by side is what makes a one-sided edit
 * fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/shared/supabase/caller-scope", () => ({ getCallerScope: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import { TENANCY_PERSONAL_CONTAINER_ENV } from "./personal-container";
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
  delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
  containerId = CONTAINER;
  primeSupabase();
  vi.mocked(getCallerScope).mockReturnValue({
    userId: USER,
    sharedCredential: false,
    credentialWorkspaceId: null,
  });
});

afterEach(() => {
  delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
});

describe("the personal shelf is addressed by CONTAINER, on both tables", () => {
  it("flag OFF spans both containers and still asks for `home_scoped`", async () => {
    await listBasesForWorkspace(WORKSPACE, false, "home");
    await listTemplatesForWorkspace(WORKSPACE, "home");
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([
        WORKSPACE,
        CONTAINER,
      ]);
      expect(filterFor(table, "home_scoped"), table).toBe(true);
    }
  });

  it("🔒 flag ON asks BOTH too — the flip strands nothing (F-590)", async () => {
    // ⚠ It used to ask the container and nothing else, which HID every personal
    // row written in the migrated-but-flag-off window: the one-time move in
    // `20260920120000` §5 had already run and never runs again. `home_scoped`
    // survives the move, so one filter over both containers finds all of them.
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await listBasesForWorkspace(WORKSPACE, false, "home");
    await listTemplatesForWorkspace(WORKSPACE, "home");
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([WORKSPACE, CONTAINER]);
      expect(filterFor(table, "home_scoped"), table).toBe(true);
    }
  });

  it("the WORKSPACE shelf does not move in this slice", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await listBasesForWorkspace(WORKSPACE, false, "workspace");
    await listTemplatesForWorkspace(WORKSPACE, "workspace");
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([WORKSPACE]);
      expect(filterFor(table, "home_scoped"), table).toBe(false);
    }
  });

  it("an ABSENT shelf is byte-identical to today: this workspace, no shelf filter", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await listBasesForWorkspace(WORKSPACE);
    await listTemplatesForWorkspace(WORKSPACE);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([WORKSPACE]);
      expect(filterFor(table, "home_scoped"), table).toBeUndefined();
    }
    expect(queries.some((q) => q.table === "workspaces")).toBe(false);
  });
});

describe("the LABEL asks what the LIST asked", () => {
  it("flag ON: the sibling-key fold reads what the list reads, so a listed row is still labelled", async () => {
    // ⚠ THE BUG THIS CLOSES. `listHomeScoped*Ids` used to hardcode
    // `workspace_id = <the request's workspace>`; once the rows live in the
    // container, that filter matches nothing and the `· personal` marker
    // silently disappears from every row it is supposed to mark. The fold and
    // the list ask through the SAME `resolveShelfScope`, which is the property
    // being pinned — not the particular id set it answers with today.
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await listHomeScopedBaseIds(WORKSPACE, ["kb-1"]);
    await listHomeScopedTemplateIds(WORKSPACE, ["tpl-1"]);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toContain(CONTAINER);
      expect(filterFor(table, "workspace_id"), table).toEqual([WORKSPACE, CONTAINER]);
    }
  });

  it("flag OFF: the fold spans both containers, exactly as the list does", async () => {
    await listHomeScopedBaseIds(WORKSPACE, ["kb-1"]);
    await listHomeScopedTemplateIds(WORKSPACE, ["tpl-1"]);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([
        WORKSPACE,
        CONTAINER,
      ]);
      expect(filterFor(table, "home_scoped"), table).toBe(true);
    }
  });

  it("an empty id set still costs nothing", async () => {
    await listHomeScopedBaseIds(WORKSPACE, []);
    await listHomeScopedTemplateIds(WORKSPACE, []);
    expect(queries).toEqual([]);
  });
});

describe("the dual-WRITE", () => {
  const baseArgs = {
    workspaceId: WORKSPACE,
    name: "Notes",
    slug: "notes",
    createdBy: USER,
  };
  const templateArgs = {
    workspaceId: WORKSPACE,
    name: "Scout",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "private" as const,
    createdBy: USER,
  };

  it("flag ON files a personal row in the container AND keeps `home_scoped`", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await insertBase({ ...baseArgs, homeScoped: true, visibility: "private" });
    await insertTemplate({ ...templateArgs, homeScoped: true });
    for (const table of ["knowledge_bases", "agent_templates"]) {
      const row = rowQueries().find((q) => q.table === table)?.inserted;
      // ⚠ BOTH, which is what "dual-write" means: the column still carries the
      // truth for a flag-off reader while the container carries the address.
      expect(row?.workspace_id, table).toBe(CONTAINER);
      expect(row?.home_scoped, table).toBe(true);
    }
  });

  it("flag OFF writes exactly where it writes today", async () => {
    await insertBase({ ...baseArgs, homeScoped: true, visibility: "private" });
    await insertTemplate({ ...templateArgs, homeScoped: true });
    for (const table of ["knowledge_bases", "agent_templates"]) {
      const row = rowQueries().find((q) => q.table === table)?.inserted;
      expect(row?.workspace_id, table).toBe(WORKSPACE);
      expect(row?.home_scoped, table).toBe(true);
    }
  });

  it("a WORKSPACE-shelf insert is untouched, and asks no container question", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await insertBase(baseArgs);
    await insertTemplate(templateArgs);
    for (const table of ["knowledge_bases", "agent_templates"]) {
      const row = rowQueries().find((q) => q.table === table)?.inserted;
      expect(row?.workspace_id, table).toBe(WORKSPACE);
      expect(row?.home_scoped, table).toBe(false);
    }
    expect(queries.some((q) => q.table === "workspaces")).toBe(false);
  });

  it("🔒 what the flag ON wrote, the flag OFF still finds", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await insertBase({ ...baseArgs, homeScoped: true, visibility: "private" });
    const wrote = rowQueries()[0].inserted?.workspace_id;

    delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
    primeSupabase();
    await listBasesForWorkspace(WORKSPACE, false, "home");
    expect(filterFor("knowledge_bases", "workspace_id")).toContain(wrote);
  });
});

describe("before the migration, nothing moves", () => {
  it("with no container minted, every path is today's path", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    containerId = null;
    await listBasesForWorkspace(WORKSPACE, false, "home");
    await listTemplatesForWorkspace(WORKSPACE, "home");
    for (const table of ["knowledge_bases", "agent_templates"]) {
      expect(filterFor(table, "workspace_id"), table).toEqual([WORKSPACE]);
      expect(filterFor(table, "home_scoped"), table).toBe(true);
    }
  });
});
