/**
 * THE PERSONAL CONTAINER'S FENCE AND ITS ONE READ, pinned in both directions.
 *
 * ⚠ **THIS FILE WAS THE 2x2 UNTIL 2026-09-02 (slice B15).** It drove all four
 * combinations of (containers minted?) x (`TENANCY_PERSONAL_CONTAINER` on?) and
 * the union read that made every one of them safe. **`home_scoped` was what made
 * the union possible AND what made it necessary** — every personal row carried
 * the boolean wherever it lived — and `20260923120000_drop_home_scoped.sql`
 * removes it. There is one place a personal row can be now, so the flag, the
 * union and every fallback are gone, and what replaces the 2x2 is a MIGRATION
 * PRECONDITION stated in that file's header (P2) rather than a runtime branch.
 *
 * ⚠ **THE INTERESTING CASE IS THE MISSING CONTAINER, and it changed direction.**
 * Every old fallback answered `[workspaceId]`; each of those now writes or reads
 * the SHARED shelf under a request for the personal one, with no marker left to
 * tell them apart. The read fails to EMPTY and the write REFUSES.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/shared/supabase/caller-scope", () => ({ getCallerScope: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { getCallerScope } from "@/shared/supabase/caller-scope";
import {
  PersonalContainerMissingError,
  findPersonalContainerId,
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
  primeContainer(CONTAINER);
  callerIs(USER);
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

describe("resolveShelfScope — one container, or none", () => {
  it("every NON-personal shelf is this workspace, and costs no round trip", async () => {
    // ⚠ ABSENT and "workspace" are the same SCOPE and stay two spellings: they
    // are two questions, and a third shelf would separate them again.
    for (const shelf of [undefined, "workspace"] as const) {
      expect(await resolveShelfScope(WORKSPACE, shelf)).toEqual({
        workspaceIds: [WORKSPACE],
      });
    }
    expect(tables, "neither may ask for a container").toEqual([]);
  });

  it("the PERSONAL shelf is the caller's container and nothing else", async () => {
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [CONTAINER],
    });
    expect(filters).toEqual([
      ["owner_id", USER],
      ["kind", "personal"],
    ]);
  });

  it("🔒 FAILS TO EMPTY with no container, never back to the calling workspace", async () => {
    // ⚠ THE DIRECTION THAT CHANGED (B15). Every arm of the old 2x2 fell back to
    // `[workspaceId]`, which was safe only because `home_scoped` was still there
    // to narrow it. Without the column that fallback answers a request for the
    // PERSONAL shelf with the SHARED workspace's rows — the widening direction,
    // and silent.
    primeContainer(null);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [],
    });
  });

  it("🔒 a SHARED credential has no personal shelf, and does not even ask", async () => {
    callerIs(USER, true);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({ workspaceIds: [] });
    expect(tables).toEqual([]);
  });

  it("outside a request there is no caller, and no personal shelf either", async () => {
    callerIs(null);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({ workspaceIds: [] });
    expect(tables).toEqual([]);
  });
});

describe("personalWriteWorkspaceId — refuse, never downgrade", () => {
  const base = { workspaceId: WORKSPACE, createdBy: USER };

  it("leaves a WORKSPACE-shelf insert alone, and does not ask", async () => {
    expect(await personalWriteWorkspaceId(base)).toBe(WORKSPACE);
    expect(await personalWriteWorkspaceId({ ...base, homeScoped: false })).toBe(
      WORKSPACE
    );
    expect(tables).toEqual([]);
  });

  it("files a personal row in the AUTHOR's container", async () => {
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

  it("🔒 REFUSES rather than falling back, on both missing halves", async () => {
    // ⚠ **THE OLD BEHAVIOUR WAS TO FALL BACK, AND IT WAS RIGHT THEN.** The row
    // still carried `home_scoped = true`, so the shelf could find it wherever it
    // landed. With the column dropped a fallback writes a row that is on the
    // SHARED shelf and listed nowhere the operator asked — so the fence is the
    // refusal, and it is the only condition of the two deleted `resolveHomeScope`
    // copies that survives.
    await expect(
      personalWriteWorkspaceId({ ...base, homeScoped: true, createdBy: null })
    ).rejects.toBeInstanceOf(PersonalContainerMissingError);
    primeContainer(null);
    await expect(
      personalWriteWorkspaceId({ ...base, homeScoped: true })
    ).rejects.toMatchObject({ status: 403, code: "PERSONAL_CONTAINER_MISSING" });
  });

  it("🔒 what the write lands in, the read looks in", async () => {
    // The round trip, driven rather than argued — the surviving half of the
    // rollback property the 2x2 existed to hold.
    const wrote = await personalWriteWorkspaceId({ ...base, homeScoped: true });
    expect((await resolveShelfScope(WORKSPACE, "home")).workspaceIds).toEqual([
      wrote,
    ]);
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
