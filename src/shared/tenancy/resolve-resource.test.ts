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
/** The caller's own `kind='personal'` container. */
const WS_P = "77777777-7777-7777-7777-777777777777";
const T1 = "44444444-4444-4444-4444-444444444444";

type Call = { table: string; op: string; args: unknown[] };

/**
 * A recording query builder. `results` is keyed by table, so each read answers
 * independently and every filter it applied is inspectable afterwards.
 *
 * ⚠ **ONE BUILDER PER `.from()`, EXACTLY AS POSTGREST GIVES YOU** — a single
 * shared builder with a mutable `table` answered the MEMBERSHIP query out of
 * whichever table was named LAST, which the personal-container probe (issued
 * between building that query and awaiting it) is the first caller to notice.
 */
function makeAdmin(
  results: Record<string, unknown[]>,
  /**
   * ⚠ **RESULT SETS CONSUMED IN ORDER, PER TABLE — AND THE GRANT LANE IS WHY
   * THIS EXISTS.** The builder applies no filters, so a table with ONE result
   * set answers both of `findResources`' queries identically and a case meant
   * to prove the SECOND one passes on the first. A sequence makes the two
   * queries distinguishable: `[[], [row]]` is "nameable by no clause, reached
   * by a grant". ⚠ Exhausting it falls back to `results[table]`.
   */
  sequences: Record<string, unknown[][]> = {}
) {
  const calls: Call[] = [];
  const pending = new Map<string, unknown[][]>(
    Object.entries(sequences).map(([t, sets]) => [t, [...sets]])
  );
  const newBuilder = (table: string) => {
    const builder: Record<string, unknown> = {};
    const rec = (op: string, args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    const rows = () => pending.get(table)?.shift() ?? results[table] ?? [];
    Object.assign(builder, {
      select: (c: string) => rec("select", [c]),
      eq: (c: string, v: unknown) => rec("eq", [c, v]),
      in: (c: string, v: unknown) => rec("in", [c, v]),
      or: (f: string) => rec("or", [f]),
      is: (c: string, v: unknown) => rec("is", [c, v]),
      ilike: (c: string, v: unknown) => rec("ilike", [c, v]),
      // The grant lane bounds its fan-out (`GRANT_REACH_LIMIT`).
      limit: (n: number) => rec("limit", [n]),
      // `findPersonalContainerId` ends its chain here — at most one row.
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
        resolve({ data: rows(), error: null }),
    });
    return builder;
  };
  vi.mocked(supabaseAdmin).mockReturnValue({
    from: (t: string) => {
      calls.push({ table: t, op: "from", args: [t] });
      return newBuilder(t);
    },
  } as never);
  return calls;
}

/** The row `findPersonalContainerId` reads, when the caller has a container. */
function personalContainer(id = WS_P) {
  return { id };
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
  const locked = {
    userId: ME,
    credentialSubjectUserId: ME,
    apiKeyWorkspaceId: WS_A,
  };

  it("asks only about the locked container, never the caller's other ones", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(locked, "agent_template", T1);
    // ⚠ MUTATION CHECK. Without this the membership set is the caller's WHOLE
    // reach and a locked credential resolves ids outside its own lock — a
    // workspace fence (§4 layer B1) quietly stepped over by a read.
    // ⚠ A caller with NO personal container gets the lock and nothing else, so
    // the admission below cannot be a blanket widening in disguise.
    expect(filters(calls, "workspace_members")).toEqual([
      `eq("user_id"=${JSON.stringify(ME)})`,
      `eq("status"="active")`,
      `in("workspace_id"=${JSON.stringify([WS_A])})`,
    ]);
  });

  it("🔒 ALSO admits the caller's OWN PERSONAL container", async () => {
    // 🔒 Rulings B10 / #18: the personal shelf is reachable from every
    // container the user is in. It stopped being reachable the moment it became
    // a container of its own — the 1.26.0 smoke's `base_not_found`.
    const calls = makeAdmin({
      workspaces: [personalContainer()],
      workspace_members: [member(WS_P, "owner")],
      knowledge_bases: [
        {
          id: T1,
          name: "Orchestration Guidelines",
          workspace_id: WS_P,
          created_by: ME,
          workspace: { name: "Personal", kind: "personal" },
        },
      ],
    });
    const resolved = await resolveResource(locked, "knowledge_base", T1);
    expect(resolved).toMatchObject({
      containerId: WS_P,
      containerKind: "personal",
      ownedByCaller: true,
    });
    expect(filters(calls, "workspace_members")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A, WS_P])})`
    );
  });

  it("🔒 looks that container up BY OWNER, so it is never somebody else's", async () => {
    // ⚠ MUTATION CHECK, and it is the whole reason the admission is safe: the
    // probe is keyed on the CALLER's id and on `kind='personal'`. Key it on
    // anything a caller supplies and the lock becomes a door into any shelf.
    const calls = makeAdmin({
      workspaces: [personalContainer()],
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(locked, "agent_template", T1);
    expect(filters(calls, "workspaces")).toEqual([
      `eq("owner_id"=${JSON.stringify(ME)})`,
      `eq("kind"="personal")`,
    ]);
  });

  it("names the lock ONCE when the lock IS the personal container", async () => {
    const calls = makeAdmin({
      workspaces: [personalContainer(WS_A)],
      workspace_members: [member(WS_A, "owner")],
      agent_templates: [],
    });
    await resolveResource(locked, "agent_template", T1);
    expect(filters(calls, "workspace_members")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A])})`
    );
  });

  it("🔒 a SHARED credential's lock admits no shelf — it never asks for one", async () => {
    // Clause 1 refuses before a query is built, so the personal probe is not
    // issued either: a credential that may be passed between humans points at
    // nobody's shelf. ⚠ MUTATION CHECK for moving the admission ABOVE clause 1.
    const calls = makeAdmin({ workspaces: [personalContainer()] });
    expect(
      await resolveResource(
        { ...locked, credentialSubjectUserId: null },
        "knowledge_base",
        T1
      )
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("does not probe for a shelf when the credential carries NO lock", async () => {
    // ⚠ The probe is the locked lane's cost alone; an ordinary session already
    // spans every container it belongs to.
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(caller, "agent_template", T1);
    expect(calls.some((c) => c.table === "workspaces")).toBe(false);
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

// ── CLAUSE 4, THIRD ARM: A GRANT ─────────────────────────────────────────

/**
 * 🔒 **A ROW LENT TO A SCOPE THE CALLER IS IN IS NAMEABLE BY THEM** (F-662).
 *
 * ⚠ **THE TS SIDE WAS THE NARROW HALF.** `dopl_grant_admits()` has been an arm
 * of `dopl_knowledge_base_readable()` since `20260923140000`, and `canSeeBase`
 * gained the same arm — so the policy admitted a lent row and the NAMING lane
 * refused it, which made the grant a recorded intent for every cross-container
 * lend. `resource-grant-reach.ts` recorded the gap in its own header.
 */
describe("🔒 a GRANT names a row in a container the caller is not in", () => {
  const CH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function grantedTo(channelId: string, level = "visible") {
    return {
      resource_grants: [
        {
          scope_type: "channel",
          scope_id: channelId,
          resource_id: T1,
          level,
        },
      ],
      channel_members: [{ channel_id: channelId }],
    };
  }

  it("resolves a base lent into a channel the caller is a member of", async () => {
    // ⚠ MUTATION CHECK. Drop the grant lane and this is `null` — a base the
    // operator deliberately shared into the room, unreadable in the room.
    const calls = makeAdmin(
      { workspace_members: [member(WS_A)], ...grantedTo(CH) },
      {
        // 🔒 The fenced query finds NOTHING — the caller is not a member of
        // `WS_B` and the row is private and somebody else's, so it fails the
        // `.in()` and both arms of the `.or()`. Only the grant lane can answer.
        knowledge_bases: [
          [],
          [
            {
              id: T1,
              name: "Runbooks",
              workspace_id: WS_B,
              created_by: "someone-else",
              workspace: { name: "Acme", kind: "standard" },
            },
          ],
        ],
      }
    );
    expect(await resolveResource(caller, "knowledge_base", T1)).toMatchObject({
      containerId: WS_B,
      // 🔒 A grantee holds no membership, so the floor is the answer — never a
      // borrowed role from the container they came from.
      containerRole: "viewer",
      ownedByCaller: false,
    });
    // ⚠ The second query carries NO container filter and NO `.or()`: a grantee
    // fails both by construction, so an arm inside that group is unreachable.
    const applied = filters(calls, "knowledge_bases");
    expect(applied.slice(-2)).toEqual([
      `eq("id"="${T1}")`,
      `is("deleted_at"=null)`,
    ]);
    // ⚠ MUTATION CHECK. ONE `in` and ONE `or` across BOTH queries — i.e. the
    // second carries neither. Add them and the grant lane is unreachable, which
    // is the mistake `20260923140000` §3b had to undo on the child policies.
    expect(applied.filter((f) => f.startsWith("in(")).length).toBe(1);
    expect(applied.filter((f) => f.startsWith("or(")).length).toBe(1);
  });

  it("answers NULL when nothing grants the id to this caller", async () => {
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      resource_grants: [],
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 an `agent_only` CHANNEL grant does not name it for a PERSON", async () => {
    // Two AUDIENCES, not a high/low pair: `agent_only` says "my agent may read
    // this here", and a person reading it is strictly more.
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      ...grantedTo(CH, "agent_only"),
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 a grant to a channel the caller is NOT in names nothing", async () => {
    makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      resource_grants: grantedTo(CH).resource_grants,
      channel_members: [],
    });
    expect(await resolveResource(caller, "knowledge_base", T1)).toBeNull();
  });

  it("🔒 a NAME never takes the grant lane", async () => {
    // A name is not a global handle — resolving one here would scan every
    // container in the product for a label.
    const calls = makeAdmin({
      workspace_members: [member(WS_A)],
      knowledge_bases: [],
      ...grantedTo(CH),
    });
    expect(
      await resolveResourcesByName(caller, "knowledge_base", "Runbooks")
    ).toEqual([]);
    expect(calls.some((c) => c.table === "resource_grants")).toBe(false);
  });

  it("costs no grant query when the row was nameable anyway", async () => {
    const calls = makeAdmin({
      workspace_members: [member(WS_B)],
      agent_templates: [templateRow()],
    });
    expect(await resolveResource(caller, "agent_template", T1)).not.toBeNull();
    expect(calls.some((c) => c.table === "resource_grants")).toBe(false);
  });

  it("🔒 a SHARED credential is not widened by a grant either", async () => {
    // Arm 2 travels with the grant, exactly as the SQL twin states it:
    // `NOT dopl_credential_is_shared() AND dopl_grant_admits(…)`.
    const calls = makeAdmin(grantedTo(CH));
    expect(
      await resolveResource(
        { userId: ME, credentialSubjectUserId: null },
        "knowledge_base",
        T1
      )
    ).toBeNull();
    expect(calls).toEqual([]);
  });
});
