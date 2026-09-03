/**
 * 🔒 **THE FENCE THAT LETS AN ID RESOLVE ITS OWN TENANCY**, driven against the
 * real query builder.
 *
 * ⚠ **EVERY SERVICE SUITE ABOVE THIS ONE MOCKS THE MODULE**, so nothing but
 * this file ever asserts the filters that actually reach PostgREST — the same
 * hole `repository-tenancy.test.ts` was written to close before this module
 * generalised it. The four clauses are asserted one per describe block, each
 * with the MUTATION it is protecting against stated, because a filter that
 * silently stops being applied is indistinguishable from one that is.
 *
 * ⚠ **THE EMBED IS DELIBERATE AND IS NOT THE `!inner` THE DELETE ROUTE WARNS
 * ABOUT** — that note is about joining OUT of `workspaces`; this is a child
 * embedding its parent by FK, the shape every workspace list in the product
 * already runs. The flatten (a 1:1 embed typed as an array) is pinned because
 * that is the half a future edit gets wrong.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  resolveResource,
  resolveResourcesByName,
  type ResourceCaller,
} from "./resolve-resource";

const ME = "22222222-3333-4444-5555-666666666666";
const WS_A = "11111111-2222-3333-4444-555555555555";
const WS_B = "99999999-8888-7777-6666-555555555555";
const T1 = "44444444-4444-4444-4444-444444444444";

type Call = { table: string; op: string; args: unknown[] };

/** A recording query builder. `results` is keyed by table, so the membership
 *  read and the resource read answer independently and every filter either
 *  query applied is inspectable afterwards. */
function makeAdmin(results: Record<string, unknown[]>) {
  const calls: Call[] = [];
  let table = "";
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ table, op, args });
    return builder;
  };
  Object.assign(builder, {
    from: (t: string) => {
      table = t;
      return rec("from", [t]);
    },
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => rec("eq", [c, v]),
    in: (c: string, v: unknown) => rec("in", [c, v]),
    or: (f: string) => rec("or", [f]),
    is: (c: string, v: unknown) => rec("is", [c, v]),
    ilike: (c: string, v: unknown) => rec("ilike", [c, v]),
    then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
      resolve({ data: results[table] ?? [], error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
  return calls;
}

/** Every filter one of the two queries applied, as `op(col=value)` strings. */
function filters(calls: Call[], table: string): string[] {
  return calls
    .filter((c) => c.table === table && c.op !== "from" && c.op !== "select")
    .map((c) => `${c.op}(${c.args.map((a) => JSON.stringify(a)).join("=")})`);
}

function member(workspaceId: string, role = "member") {
  return { workspace_id: workspaceId, role };
}

function templateRow(over: Record<string, unknown> = {}) {
  return {
    id: T1,
    name: "Code Auditor",
    workspace_id: WS_B,
    created_by: ME,
    workspace: { name: "Acme", kind: "standard" },
    ...over,
  };
}

const caller: ResourceCaller = { userId: ME, credentialSubjectUserId: ME };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── CLAUSE 1 ──────────────────────────────────────────────────────────────

describe("🔒 a SHARED credential resolves nothing, and does not even ask", () => {
  it("issues no query at all", async () => {
    const calls = makeAdmin({});
    // ⚠ FENCED AND ANONYMOUS: identical to the container session below on the
    // container axis, and different on the subject axis alone.
    const shared: ResourceCaller = {
      userId: ME,
      credentialSubjectUserId: null,
      apiKeyWorkspaceId: WS_A,
    };
    expect(await resolveResource(shared, "agent_template", T1)).toBeNull();
    expect(await resolveResourcesByName(shared, "agent_template", "x")).toEqual(
      []
    );
    // ⚠ Arm 2 of every `canSee*` predicate restated, not a second rule: a key
    // that may be passed between humans inherits no one person's reach, so it
    // must not learn where "their" rows live either.
    expect(calls).toEqual([]);
  });

  it("but a CONTAINER SESSION is one human's session and resolves normally", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [templateRow({ workspace_id: WS_A })],
    });
    const session: ResourceCaller = {
      userId: ME,
      credentialSubjectUserId: ME,
      apiKeyWorkspaceId: WS_A,
    };
    expect(
      await resolveResource(session, "agent_template", T1)
    ).not.toBeNull();
    expect(calls.length).toBeGreaterThan(0);
  });
});

// ── CLAUSE 2 ──────────────────────────────────────────────────────────────

describe("🔒 only containers the caller ACTIVELY belongs to, at the viewer floor", () => {
  it("bounds the read to the caller's own active memberships", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_A), member(WS_B, "admin")],
      agent_templates: [],
    });
    await resolveResource(caller, "agent_template", T1);
    // ⚠ MUTATION CHECK. Drop `status` and a REVOKED membership resolves ids
    // again — `findMembership` carries the scar of exactly that omission.
    expect(filters(calls, "workspace_members")).toEqual([
      `eq("user_id"=${JSON.stringify(ME)})`,
      `eq("status"="active")`,
    ]);
    expect(filters(calls, "agent_templates")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A, WS_B])})`
    );
  });

  it("EXCLUDES a container the caller is only a GUEST in", async () => {
    // 🔒 Every resource route sits at `withWorkspaceAuth`'s `viewer` floor, so
    // a guest cannot read these rows in their own container. Resolving ids
    // there would be a door UNDER that floor rather than an extra fact.
    const calls = makeAdmin({
      workspace_members: [member(WS_A, "guest"), member(WS_B, "viewer")],
      agent_templates: [],
    });
    await resolveResource(caller, "agent_template", T1);
    expect(filters(calls, "agent_templates")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_B])})`
    );
  });

  it("issues NO resource query when no container clears the floor", async () => {
    const calls = makeAdmin({ workspace_members: [member(WS_A, "guest")] });
    expect(await resolveResource(caller, "agent_template", T1)).toBeNull();
    expect(calls.some((c) => c.table === "agent_templates")).toBe(false);
  });
});

// ── CLAUSE 3 ──────────────────────────────────────────────────────────────

describe("🔒 the container lock is honoured, and narrows", () => {
  it("asks only about the locked container, never the caller's other ones", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(
      {
        userId: ME,
        credentialSubjectUserId: ME,
        apiKeyWorkspaceId: WS_A,
      },
      "agent_template",
      T1
    );
    // ⚠ MUTATION CHECK. Without this the membership set is the caller's WHOLE
    // reach and a locked credential resolves ids outside its own lock — a
    // workspace fence (§4 layer B1) quietly stepped over by a read.
    expect(filters(calls, "workspace_members")).toEqual([
      `eq("user_id"=${JSON.stringify(ME)})`,
      `eq("status"="active")`,
      `eq("workspace_id"=${JSON.stringify(WS_A)})`,
    ]);
  });
});

// ── CLAUSE 4 ──────────────────────────────────────────────────────────────

describe("🔒 only rows the caller could already list for themselves", () => {
  it("names the caller's own rows and container-visible rows, and nothing else", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(caller, "agent_template", T1);
    // ⚠ MUTATION CHECK. Drop the `created_by` arm and the caller loses their
    // own private rows; drop the `visibility` arm and a shared template stops
    // resolving. ADD a third arm and this read starts naming the container
    // another member's private row lives in, which is the existence oracle the
    // 404-never-403 surface closes.
    expect(calls.find((c) => c.op === "or")?.args).toEqual([
      `created_by.eq."${ME}",visibility.eq.workspace`,
    ]);
  });

  it("QUOTES the caller id into the filter string — the name path always did", async () => {
    // ⚠ MUTATION CHECK, and the asymmetry it removes. `.or()` takes a filter
    // STRING PostgREST parses: `,` splits the arms and `.` splits
    // column-operator-value, so a value carrying either changes the query's
    // SHAPE. The `ilike` path escapes its caller-supplied value and this one
    // interpolated raw — safe only because `auth.users` ids are UUIDs, which is a
    // fact about the caller and not about the fence.
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(
      { ...caller, userId: 'x",visibility.eq.private,name.eq."y' },
      "agent_template",
      T1
    );
    const filter = String(calls.find((c) => c.op === "or")?.args[0]);
    // Every injected quote is backslash-escaped, so the value stays ONE value.
    expect(filter).toBe(
      'created_by.eq."x\\",visibility.eq.private,name.eq.\\"y",visibility.eq.workspace'
    );
  });
});

// ── REF MATCHING ──────────────────────────────────────────────────────────

describe("an id resolves by id and a name by name — never through each other", () => {
  it("matches an id exactly, and returns AT MOST ONE answer", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_B)],
      agent_templates: [templateRow()],
    });
    const resolved = await resolveResource(caller, "agent_template", T1);
    expect(resolved).toEqual({
      type: "agent_template",
      id: T1,
      name: "Code Auditor",
      containerId: WS_B,
      containerName: "Acme",
      containerKind: "standard",
      ownedByCaller: true,
      containerRole: "member",
    });
    expect(calls.some((c) => c.op === "ilike")).toBe(false);
  });

  it("answers NULL for an id nothing nameable matches", async () => {
    makeAdmin({ workspace_members: [member(WS_A)], agent_templates: [] });
    expect(await resolveResource(caller, "agent_template", T1)).toBeNull();
  });

  it("matches a name case-insensitively and ESCAPES the wildcards", async () => {
    // ⚠ MUTATION CHECK. Unescaped, a caller-supplied `%` matches ANYTHING —
    // `ilike` is an exact match here, never a pattern.
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResourcesByName(caller, "agent_template", "100%_off\\x");
    expect(calls.find((c) => c.op === "ilike")?.args).toEqual([
      "name",
      "100\\%\\_off\\\\x",
    ]);
  });

  it("returns EVERY name match and picks none", async () => {
    // ⚠ Names are not unique on purpose. A pick made here would make both the
    // launch lane's ambiguity refusal and the tenancy label a lie.
    makeAdmin({
      workspace_members: [member(WS_A), member(WS_B)],
      agent_templates: [
        templateRow({ workspace_id: WS_A }),
        templateRow({ workspace_id: WS_B }),
      ],
    });
    const rows = await resolveResourcesByName(
      caller,
      "agent_template",
      "Code Auditor"
    );
    expect(rows.map((r) => r.containerId)).toEqual([WS_A, WS_B]);
  });
});

// ── THE REGISTRY ──────────────────────────────────────────────────────────

/**
 * 🔒 **ONE RESOLVER, FOUR TABLES** (B2). Each type is driven through the SAME
 * query and asserted on the filters that reach PostgREST, because a registry row
 * is four constants and a wrong one is a silent widening rather than a failure.
 */
describe("every resource type resolves through the one query", () => {
  const ROWS: Record<string, Record<string, unknown>> = {
    knowledge_bases: { name: "Runbooks" },
    skills: { name: "Triage" },
    // ⚠ A chat has NO `name` column. The select aliases `title`, so the row a
    // test feeds back carries the ALIAS, exactly as PostgREST would return it.
    chats: { name: "Tuesday session" },
  };

  it.each([
    ["knowledge_base", "knowledge_bases", "created_by", "name"],
    ["skill", "skills", "created_by", "name"],
    ["chat", "chats", "owner_id", "title"],
  ] as const)(
    "%s reads %s, owned by %s, named by %s",
    async (type, table, ownerColumn, nameColumn) => {
      const calls = makeAdmin({
        workspace_members: [member(WS_B)],
        [table]: [{ id: T1, workspace_id: WS_B, ...ROWS[table] }],
      });
      const resolved = await resolveResource(caller, type, T1);
      expect(resolved).toMatchObject({ type, id: T1, containerId: WS_B });
      // ⚠ MUTATION CHECK — the projection, per table. The OWNER column's NAME
      // differs per table (`created_by` / `owner_id`), so a hard-coded one would
      // 400 `chats` outright and silently answer `ownedByCaller: false` for
      // every row of the others; `chats` has no `name`, so a missing alias
      // would 400 too. ⚠ Scoped to `table`: the membership read selects first.
      expect(
        calls.find((c) => c.table === table && c.op === "select")?.args[0]
      ).toBe(
        [
          "id",
          `name:${nameColumn}`,
          "workspace_id",
          ownerColumn,
          "workspace:workspaces!inner(name, kind)",
        ].join(", ")
      );
      // 🔒 MUTATION CHECK — clause 4 for the three tables that carry
      // `access_mode`. Drop the `and(...)` group and a `public` row shared with
      // GRANTED TEAMS ONLY becomes nameable by every member of the container,
      // which is the oracle clause 4 closes.
      expect(calls.find((c) => c.op === "or")?.args).toEqual([
        `${ownerColumn}.eq."${ME}",and(visibility.eq.public,access_mode.eq.workspace)`,
      ]);
      // 🔒 MUTATION CHECK — a TRASHED row is not nameable. Drop this and an id
      // resolves a container for a row every read path then skips: the read
      // 404s and the ADDRESS is what leaked.
      expect(filters(calls, table)).toContain(`is("deleted_at"=null)`);
    }
  );

  it("does NOT filter a soft delete on the one table that has none", async () => {
    // ⚠ `agent_templates` hard-deletes (`20260822200000_agent_templates.sql`).
    // An `is(deleted_at, null)` there is a 400, not a tighter fence.
    const calls = makeAdmin({
      workspace_members: [member(WS_B)],
      agent_templates: [templateRow()],
    });
    await resolveResource(caller, "agent_template", T1);
    expect(calls.some((c) => c.op === "is")).toBe(false);
  });

  it("matches a chat by TITLE on the name path", async () => {
    const calls = makeAdmin({ workspace_members: [member(WS_A)], chats: [] });
    await resolveResourcesByName(caller, "chat", "Tuesday session");
    expect(calls.find((c) => c.op === "ilike")?.args).toEqual([
      "title",
      "Tuesday session",
    ]);
  });
});

// ── THE EMBED ─────────────────────────────────────────────────────────────

describe("the 1:1 embed is flattened, whichever way PostgREST types it", () => {
  it("reads an ARRAY embed identically to an OBJECT one", async () => {
    makeAdmin({
      workspace_members: [member(WS_B, "admin")],
      agent_templates: [
        templateRow({ workspace: [{ name: "Alpha", kind: "link" }] }),
      ],
    });
    expect(await resolveResource(caller, "agent_template", T1)).toMatchObject({
      containerName: "Alpha",
      containerKind: "link",
      ownedByCaller: true,
      containerRole: "admin",
    });
  });

  it("degrades an ABSENT embed to a blank name and a STANDARD kind", async () => {
    // ⚠ Never `undefined` into a rendered refusal, and never a guessed `link`:
    // "standard" is the answer that claims the least.
    makeAdmin({
      workspace_members: [member(WS_B)],
      agent_templates: [templateRow({ created_by: null, workspace: [] })],
    });
    expect(await resolveResource(caller, "agent_template", T1)).toMatchObject({
      containerName: "",
      containerKind: "standard",
      // 🔒 AN UNATTRIBUTED ROW IS NOT YOURS. `created_by` is `SET NULL` when an
      // author leaves the workspace, and a null that read as ownership would
      // hand their rows to whoever asks.
      ownedByCaller: false,
    });
  });
});
