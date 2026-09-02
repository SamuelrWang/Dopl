/**
 * THE PERSONAL CONTAINER'S 2x2, pinned in both directions.
 *
 * The migration and the deploy move independently, so all four combinations of
 * (containers minted?) x (`TENANCY_PERSONAL_CONTAINER` on?) are real states a
 * production request lands in. What is asserted here is the property that makes
 * them safe: **every combination reads back every row the others wrote**, and
 * turning the flag OFF is a rollback rather than a data loss — which is the
 * whole of "rollback fails closed, never open".
 *
 * ⚠ THE INTERESTING CASE IS THE FLAG-OFF READ, NOT THE FLAG-ON ONE. Flag on is
 * the target model and is easy; flag off has to span TWO containers, and a test
 * that only drove the happy direction would pass on a resolver that stranded
 * every row written during the flag's ON window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/shared/supabase/caller-scope", () => ({ getCallerScope: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  TENANCY_PERSONAL_CONTAINER_ENV,
  findPersonalContainerId,
  personalContainerReadsEnabled,
  personalWriteWorkspaceId,
  resolveShelfScope,
} from "./personal-container";

const USER = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CONTAINER = "33333333-3333-4333-8333-333333333333";

/** Every narrowing the container lookup applied, so the query shape is pinned
 *  rather than only its answer. */
let filters: Array<[string, unknown]>;
let tables: string[];

function primeContainer(id: string | null) {
  filters = [];
  tables = [];
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: (t: string) => {
      tables.push(t);
      return builder;
    },
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    maybeSingle: async () => ({ data: id === null ? null : { id }, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

function callerIs(userId: string | null, sharedCredential = false) {
  vi.mocked(getCallerScope).mockReturnValue(
    userId === null
      ? null
      : { userId, sharedCredential, credentialWorkspaceId: null }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
  primeContainer(CONTAINER);
  callerIs(USER);
});

afterEach(() => {
  delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
});

describe("the flag", () => {
  it("is off unless it is an explicit spelling of on", () => {
    const on = ["1", "true", "on", "TRUE", " On "];
    const off = [undefined, "", "0", "false", "yes", "off", "enabled"];
    for (const v of on) {
      expect(
        personalContainerReadsEnabled({ [TENANCY_PERSONAL_CONTAINER_ENV]: v }),
        `${v} should read as ON`
      ).toBe(true);
    }
    for (const v of off) {
      expect(
        personalContainerReadsEnabled({ [TENANCY_PERSONAL_CONTAINER_ENV]: v }),
        `${String(v)} should read as OFF`
      ).toBe(false);
    }
  });
});

describe("findPersonalContainerId", () => {
  it("asks `workspaces` for ONE row, keyed on owner AND kind", async () => {
    expect(await findPersonalContainerId(USER)).toBe(CONTAINER);
    expect(tables).toEqual(["workspaces"]);
    // ⚠ BOTH filters, and the kind one is what stops a standard workspace
    // answering. `maybeSingle` is legitimate only because
    // `workspaces_personal_owner_uidx` is unique on this pair.
    expect(filters).toEqual([
      ["owner_id", USER],
      ["kind", "personal"],
    ]);
  });

  it("answers null before the migration has run", async () => {
    primeContainer(null);
    expect(await findPersonalContainerId(USER)).toBeNull();
  });
});

describe("resolveShelfScope — the 2x2", () => {
  it("an ABSENT shelf is unchanged in both flag states: this workspace, no shelf filter", async () => {
    for (const flag of [undefined, "1"]) {
      if (flag) process.env[TENANCY_PERSONAL_CONTAINER_ENV] = flag;
      else delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
      expect(await resolveShelfScope(WORKSPACE, undefined)).toEqual({
        workspaceIds: [WORKSPACE],
        homeScoped: undefined,
      });
    }
  });

  it("the WORKSPACE shelf is unchanged in both flag states, and keeps excluding personal rows", async () => {
    // ⚠ The `home_scoped = false` predicate is redundant ONCE every row has
    // moved and load-bearing until then: a row the migration has not reached
    // must not surface on the shared shelf because a flag went on.
    for (const flag of [undefined, "1"]) {
      if (flag) process.env[TENANCY_PERSONAL_CONTAINER_ENV] = flag;
      else delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
      expect(await resolveShelfScope(WORKSPACE, "workspace")).toEqual({
        workspaceIds: [WORKSPACE],
        homeScoped: false,
      });
    }
  });

  it("flag OFF, no container minted: exactly today's read", async () => {
    primeContainer(null);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [WORKSPACE],
      homeScoped: true,
    });
  });

  it("flag OFF, container minted: reads BOTH, so a row written under the flag is never stranded", async () => {
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [WORKSPACE, CONTAINER],
      homeScoped: true,
    });
  });

  it("flag ON: the container is the whole answer, and `home_scoped` stops being asked", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [CONTAINER],
      homeScoped: undefined,
    });
  });

  it("flag ON with no container minted falls back to today rather than reading nothing", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    primeContainer(null);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [WORKSPACE],
      homeScoped: true,
    });
  });

  it("🔒 a SHARED credential has no personal shelf, so it never reaches a container", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    callerIs(USER, true);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [WORKSPACE],
      homeScoped: true,
    });
    expect(tables, "a shared credential must not even ask").toEqual([]);
  });

  it("outside a request there is no caller, and the read stays on today's path", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    callerIs(null);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [WORKSPACE],
      homeScoped: true,
    });
    expect(tables).toEqual([]);
  });

  it("neither non-personal shelf costs a round trip", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    await resolveShelfScope(WORKSPACE, undefined);
    await resolveShelfScope(WORKSPACE, "workspace");
    expect(tables).toEqual([]);
  });
});

describe("personalWriteWorkspaceId — the dual-write's other half", () => {
  const base = { workspaceId: WORKSPACE, createdBy: USER };

  it("leaves a WORKSPACE-shelf insert alone, flag or no flag", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    expect(await personalWriteWorkspaceId(base)).toBe(WORKSPACE);
    expect(await personalWriteWorkspaceId({ ...base, homeScoped: false })).toBe(
      WORKSPACE
    );
    expect(tables, "a workspace-shelf insert must not ask").toEqual([]);
  });

  it("flag OFF writes exactly where it writes today", async () => {
    expect(await personalWriteWorkspaceId({ ...base, homeScoped: true })).toBe(
      WORKSPACE
    );
    expect(tables).toEqual([]);
  });

  it("flag ON files a personal row in the AUTHOR's container", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    expect(await personalWriteWorkspaceId({ ...base, homeScoped: true })).toBe(
      CONTAINER
    );
    // ⚠ THE AUTHOR, NOT THE AMBIENT CALLER — the write path must produce the
    // same row from a script as from a request.
    expect(filters).toEqual([
      ["owner_id", USER],
      ["kind", "personal"],
    ]);
  });

  it("flag ON with an unknown author, or no container yet, falls back rather than guessing", async () => {
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    expect(
      await personalWriteWorkspaceId({ ...base, homeScoped: true, createdBy: null })
    ).toBe(WORKSPACE);
    primeContainer(null);
    expect(await personalWriteWorkspaceId({ ...base, homeScoped: true })).toBe(
      WORKSPACE
    );
  });

  it("🔒 what the flag ON writes, the flag OFF still reads", async () => {
    // The rollback property, driven rather than argued: write under ON, read
    // under OFF, and the row's container is still in the answer.
    process.env[TENANCY_PERSONAL_CONTAINER_ENV] = "1";
    const wrote = await personalWriteWorkspaceId({ ...base, homeScoped: true });
    delete process.env[TENANCY_PERSONAL_CONTAINER_ENV];
    const scope = await resolveShelfScope(WORKSPACE, "home");
    expect(scope.workspaceIds).toContain(wrote);
  });
});

describe("🔒 no path here prefers a workspace by 'default'", () => {
  it("the module names no default-workspace lookup at all", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./personal-container.ts", import.meta.url),
      "utf8"
    );
    // ⚠ B10 removes the CONCEPT, not just a call: a resolver that reached for
    // the derived default to pick a container would re-introduce the lookup
    // this slice exists to delete, and it would do it invisibly.
    for (const banned of [
      "findDefaultWorkspaceForUser",
      "ensureDefaultWorkspace",
      "ensure_default_workspace",
      "default_workspace_of",
      'slug: "default"',
    ]) {
      expect(src, `${banned} must not appear`).not.toContain(banned);
    }
  });
});
