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

/** ⚠ The AGENT lanes reach `personal-reach.ts`, which awaits two more reads —
 *  the member count and the arming probe. Both answer off this builder so the
 *  fence runs for real rather than being mocked past. */
let memberCount: number | null;
let armedChannels: string[];

function primeContainer(id: string | null) {
  filters = [];
  tables = [];
  let current = "";
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: (t: string) => {
      current = t;
      tables.push(t);
      return builder;
    },
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return builder;
    },
    maybeSingle: async () => ({ data: id === null ? null : { id }, error: null }),
    then: (resolve: (r: unknown) => void) =>
      resolve({
        data:
          current === "channel_personal_arming"
            ? armedChannels.map((channel_id) => ({ channel_id }))
            : [],
        count: memberCount,
        error: null,
      }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

function callerIs(
  userId: string | null,
  sharedCredential = false,
  /** ⚠ THE ASKER AND THE LOCK, stated separately — `source` is a third axis and
   *  is no longer inferred from the lock (the proxy this slice retired). */
  over: { source?: "agent" | null; credentialWorkspaceId?: string | null } = {}
) {
  vi.mocked(getCallerScope).mockReturnValue(
    userId === null
      ? null
      : {
          userId,
          sharedCredential,
          credentialWorkspaceId: over.credentialWorkspaceId ?? null,
          source: over.source ?? null,
        }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  memberCount = 5;
  armedChannels = [];
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
  it("the WORKSPACE shelf is this workspace alone, and costs no round trip", async () => {
    // ⚠ **ABSENT AND `workspace` STOPPED BEING THE SAME ANSWER (task 11, gap
    // 1).** They were always two questions — "no filter was asked for" against
    // "the shared shelf, explicitly" — and the widening below is what finally
    // separates them. An explicit `workspace` read is the one that must NEVER
    // grow a second container: it is how a caller asks to see the room's shelf
    // and only the room's shelf.
    expect(await resolveShelfScope(WORKSPACE, "workspace")).toEqual({
      workspaceIds: [WORKSPACE],
    });
    expect(tables, "an explicit workspace shelf asks nothing").toEqual([]);
  });

  it("🔒 an UNFILTERED read now sees BOTH shelves — gap 1 of #1077", async () => {
    // 🔒 THE LISTING REPAIR, and it is the reversal landing rather than a
    // break. Enumeration was container-scoped while RESOLUTION already crossed
    // containers, so an operator could READ a personal base from another room
    // by id and could not FIND it from there — "my builder agent's KB is
    // invisible everywhere else". Every enumerating surface asks through here.
    expect(await resolveShelfScope(WORKSPACE, undefined)).toEqual({
      workspaceIds: [WORKSPACE, CONTAINER],
    });
    // ⚠ NOT A RE-GROWN DEFAULT-WORKSPACE FALLBACK (MCP-2, invariant 1 of
    // #1077): the calling container is read as it always was and the caller's
    // OWN container is read IN ADDITION, by owner. Nothing is guessed.
    expect(filters).toEqual([
      ["owner_id", USER],
      ["kind", "personal"],
    ]);
  });

  it("names the workspace ONCE when the caller is standing on their own shelf", async () => {
    expect(await resolveShelfScope(CONTAINER, undefined)).toEqual({
      workspaceIds: [CONTAINER],
    });
  });

  it("falls back to the calling workspace alone when there is no container", async () => {
    primeContainer(null);
    expect(await resolveShelfScope(WORKSPACE, undefined)).toEqual({
      workspaceIds: [WORKSPACE],
    });
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

/**
 * 🔒 **BOTH SHELF READS ASK `personal-reach.ts`, AND THIS IS WHERE THAT SHOWS.**
 * The fence's own directions are driven in `personal-reach.test.ts`; what is
 * pinned here is that the shelf reads GO THROUGH IT — a caller-scope field, not
 * a credential shape, decides, and a closed answer is EMPTY rows rather than a
 * refusal, so arming state is never an oracle.
 */
describe("🔒 an AGENT's shelf reads are gated by the room", () => {
  const inRoom = { source: "agent" as const, credentialWorkspaceId: WORKSPACE };

  it("closes the personal shelf in an unarmed shared room — no rows, no refusal", async () => {
    callerIs(USER, false, inRoom);
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [],
    });
    // ⚠ The SAME answer a caller with no container gets. That identity is the
    // 404-never-403 property, driven rather than argued.
    expect(tables).toContain("channel_personal_arming");
  });

  it("closes the WIDENING too, so an unarmed room enumerates the room alone", async () => {
    // 🔒 GAP 1 OVER GAP 3, in the order #1077 requires: widening enumeration
    // over an open clause 3 turns a latent reach into a discoverable one.
    callerIs(USER, false, inRoom);
    expect(await resolveShelfScope(WORKSPACE, undefined)).toEqual({
      workspaceIds: [WORKSPACE],
    });
  });

  it("opens both reads once the owner has armed the room", async () => {
    callerIs(USER, false, inRoom);
    armedChannels = ["66666666-6666-4666-8666-666666666666"];
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [CONTAINER],
    });
    expect(await resolveShelfScope(WORKSPACE, undefined)).toEqual({
      workspaceIds: [WORKSPACE, CONTAINER],
    });
  });

  it("leaves a SOLO container open, which is today's behaviour unchanged", async () => {
    callerIs(USER, false, inRoom);
    memberCount = 1;
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [CONTAINER],
    });
    expect(tables, "a solo room never probes the arming table").not.toContain(
      "channel_personal_arming"
    );
  });

  it("🔒 reads the ASKER off the scope, not off the lock", async () => {
    // ⚠ MUTATION CHECK FOR THE RETIRED PROXY. This module used to infer "agent"
    // from `credentialWorkspaceId` being set; a locked HUMAN session must now
    // reach their own shelf, and an UNLOCKED agent must still be gated.
    callerIs(USER, false, { source: null, credentialWorkspaceId: WORKSPACE });
    expect(await resolveShelfScope(WORKSPACE, "home")).toEqual({
      workspaceIds: [CONTAINER],
    });
    expect(tables, "a person pays for one read").toEqual(["workspaces"]);
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
