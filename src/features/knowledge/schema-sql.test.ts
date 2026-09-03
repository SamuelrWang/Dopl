/**
 * INVARIANT SUITE — `resource_grants`: its RLS POLICIES, its VALIDITY TRIGGER,
 * and the two tables it replaced, all read out of `supabase/migrations` and
 * REPLAYED in apply order. These are database facts no application test can
 * reach, because every knowledge read in this app runs on the SERVICE-ROLE
 * client and never meets a policy.
 *
 * ⚠ **REWRITTEN, NOT REPLACED, FOR WAVE B (ruling B4).** It used to pin
 * `channel_resource_grants`. `20260914120000_resource_grants.sql` folded that
 * table, `team_resource_access` and `agent_template_teams` into ONE grant table
 * keyed by `scope_type`, and `20260915120000` / `20260916120000` dropped the
 * other two. Every property the old file pinned is still pinned below, on the
 * new table — plus the ones the fold created.
 *
 * 🔒 WHY THE ORIGINAL FILE EXISTED, because the reasons did not expire.
 * `20260827120000` shipped two defects, both defended by the same sentence —
 * *"the SERVICE is the true gate"*:
 *
 *   1. **THE WRITE FLOOR WAS `member`**, where the template it claims to copy
 *      (`team_resource_access_admin_write`) uses `admin`. The service gate is
 *      creator-or-admin, but **PostgREST is a SECOND DOOR** and a workspace
 *      member reaches it with their own JWT, where the service does not exist.
 *      🔒 And a container PEER can be granted `member`
 *      (`home/schema.ts › grantedRole` ∈ guest|viewer|member) — so **the very
 *      party the audience ceiling bounds could write the grant rows layer A
 *      calls "unforgeable DB facts"**.
 *   2. **`agent_only`'s EXISTENCE LEAKED.** The SELECT policy's viewer+ arm
 *      returned every row, so any workspace viewer could enumerate
 *      `(channel_id, resource_id, level)` for grants the wave's own rule says
 *      must be indistinguishable from absence to anyone outside that audience.
 *
 * Both were corrected by `20260828120000_channel_resource_grants_rls_tighten.sql`,
 * and `20260914120000` carries that corrected shape onto the new table rather
 * than re-deriving it. The `admin` floor and the `level='visible'` filter are
 * asserted here on BOTH tables, because the old one is still standing (it is
 * dropped in batch 3, with the compatibility mirror).
 *
 * ⚠ WHAT THIS SUITE PINS IS THE FINAL STATE AFTER REPLAY, not one file. Policies
 * are OR-ed, so a `DROP` in a later migration is as load-bearing as the
 * `CREATE` — a test that read only the newest file would pass while a
 * member-floored policy sat there granting writes. Files are read in FILENAME
 * order, which is apply order.
 *
 * ⚠ MUTATION-VERIFIED. Each of these turns an assertion below red: deleting the
 * `DROP POLICY … member_write` line; lowering `'admin'` back to `'member'`;
 * removing the `level = 'visible'` filter; deleting either
 * `may not share into|out of container` branch of `enforce_resource_grant()`;
 * deleting its unattributed-cross-container branch; dropping the
 * `scope_type = 'team'` term from a chats policy or from
 * `can_current_user_read_agent_template()`; and re-creating either retired
 * table.
 *
 * ⚠ COMMENTS ARE STRIPPED LINE-WISE before matching, because these migration
 * headers quote their own SQL at length (the rollback prose, the verification
 * SELECTs, the owed probe list, and — in the tightening migration — the OLD
 * policy bodies verbatim). A scan that did not strip them would pin a
 * paragraph. The strip is line-level rather than the hand scanner
 * `channels/schema-sql.test.ts` carries: that one exists to protect `--`
 * sequences inside string literals, and no migration touching these tables has
 * one. If that ever changes, take the hand scanner.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Every migration, filename-sorted (= apply order), comments removed. */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")),
  }));

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/**
 * REPLAY the migrations and answer with the policies LIVE on `table` at the end
 * — `CREATE POLICY` inserts, `DROP POLICY` removes, `DROP TABLE` takes them all,
 * later wins. That is the only reading that can tell "tightened" from
 * "tightened, and the loose one left behind beside it".
 *
 * ⚠ THE `DROP TABLE` ARM IS NOT A DETAIL: a policy is a dependency of its table
 * and dies with it silently. Without that arm this function reports the policies
 * of a table that no longer exists, which is the exact reading that would let a
 * dropped table look guarded.
 */
function livePolicies(table: string): Map<string, string> {
  const live = new Map<string, string>();
  const create = new RegExp(
    String.raw`CREATE\s+POLICY\s+(\w+)\s+ON\s+(?:public\.)?${table}\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?${table}\b`,
    "gi"
  );
  const dropTable = new RegExp(
    String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    // Order matters WITHIN a file too: a tightening migration drops and
    // re-creates the same policy name in one file.
    const events: Array<{ at: number; kind: "create" | "drop" | "dropTable"; name: string }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "create", name: m[1] });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "drop", name: m[1] });
    }
    for (const m of sql.matchAll(dropTable)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "dropTable", name: "" });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "dropTable") live.clear();
      else if (e.kind === "drop") live.delete(e.name);
      else live.set(e.name, statementAt(sql, e.at));
    }
  }
  return live;
}

/** Does `table` exist at the end of the replay? */
function tableIsLive(table: string): boolean {
  let live = false;
  const create = new RegExp(
    String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    const events: Array<{ at: number; alive: boolean }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: true });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: false });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) live = e.alive;
  }
  return live;
}

/**
 * The body of the LAST `CREATE OR REPLACE FUNCTION <name>` in apply order, or
 * `null` if a later `DROP FUNCTION` retired it. ⚠ The body is dollar-quoted, so
 * it is delimited by its own opening tag rather than by the first `;` — a
 * `RAISE … ;` inside would otherwise truncate it two lines in.
 */
function liveFunctionBody(name: string): string | null {
  let body: string | null = null;
  const create = new RegExp(
    String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?${name}\s*\(`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${name}\s*\(`,
    "gi"
  );
  for (const { sql } of FILES) {
    const events: Array<{ at: number; kind: "create" | "drop" }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "create" });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "drop" });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "drop") {
        body = null;
        continue;
      }
      const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(e.at));
      if (!tag || tag.index === undefined) continue;
      const open = e.at + tag.index + tag[0].length;
      const close = sql.indexOf(tag[1], open);
      body = close === -1 ? sql.slice(open) : sql.slice(open, close);
    }
  }
  return body;
}

/**
 * The DECLARATION of `name` as the replay leaves it — everything between
 * `CREATE OR REPLACE FUNCTION` and the body's opening dollar-quote.
 *
 * ⚠ A DIFFERENT QUESTION FROM {@link liveFunctionBody}, which answers only what
 * is INSIDE the quotes. `SECURITY DEFINER`, `SET search_path` and the return
 * type all live out here, so the body scan cannot see them — and a `CREATE OR
 * REPLACE` in a later migration that dropped `SECURITY DEFINER` would leave
 * every body assertion green.
 */
function liveFunctionHeader(name: string): string | null {
  let header: string | null = null;
  const create = new RegExp(
    String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?${name}\s*\(`,
    "gi"
  );
  for (const { sql } of FILES) {
    for (const m of sql.matchAll(create)) {
      if (m.index === undefined) continue;
      const tag = /AS\s+\$[A-Za-z_]*\$/.exec(sql.slice(m.index));
      header =
        tag && tag.index !== undefined
          ? sql.slice(m.index, m.index + tag.index)
          : sql.slice(m.index);
    }
  }
  return header;
}

const GRANTS = livePolicies("resource_grants");

describe("resource_grants — the replayed RLS state", () => {
  it("finds the table's policies at all (an empty scan must not pass silently)", () => {
    expect(tableIsLive("resource_grants")).toBe(true);
    expect(GRANTS.size).toBeGreaterThan(0);
  });

  it("🔒 NO live policy admits a WRITE at the `member` floor", () => {
    // Policies are OR-ed. One member-floored ALL/INSERT/UPDATE/DELETE policy
    // anywhere re-opens the door however tight its neighbours are.
    const offenders = [...GRANTS].filter(
      ([, body]) =>
        !/\bFOR\s+SELECT\b/i.test(body) &&
        /is_current_workspace_member\(\s*workspace_id\s*,\s*'(?:member|viewer|guest)'/i.test(
          body
        )
    );
    expect(offenders.map(([name]) => name)).toEqual([]);
  });

  it("🔒 the live WRITE policy is at `admin`, as `20260828120000` established", () => {
    const writes = [...GRANTS].filter(([, body]) => !/\bFOR\s+SELECT\b/i.test(body));
    expect(writes).toHaveLength(1);
    const [, body] = writes[0];
    expect(body).toMatch(
      /USING\s*\(\s*is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)\s*\)/i
    );
    expect(body).toMatch(
      /WITH\s+CHECK\s*\(\s*is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)\s*\)/i
    );
  });

  it("🔒 the live SELECT policy hides a channel's `agent_only` below admin", () => {
    const selects = [...GRANTS].filter(([, body]) => /\bFOR\s+SELECT\b/i.test(body));
    expect(selects).toHaveLength(1);
    const [, body] = selects[0];
    // The non-admin arms are gated on the LEVEL, so absence and `agent_only` are
    // one answer through this door exactly as they are through the guest lane.
    expect(body).toMatch(/level\s*=\s*'visible'/i);
    // …and the managing audience still sees everything, or nobody can administer
    // a grant through PostgREST at all.
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)/i);
  });

  it("the guest arm SURVIVED the fold — a channel member still reads its own grants", () => {
    const [, body] = [...GRANTS].find(([, b]) => /\bFOR\s+SELECT\b/i.test(b))!;
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'guest'\s*\)/i);
    expect(body).toMatch(/is_channel_member\(\s*scope_id\s*\)/i);
    // 🔒 AND IT IS SCOPED TO CHANNELS. `is_channel_member` over a `scope_id`
    // that might be a team or a container is a membership question asked of the
    // wrong table; the guest arm must say which scope it is answering for.
    expect(body).toMatch(/scope_type\s*=\s*'channel'/i);
    // ⚠ NO `visibility='public'` arm, ever: a lowered floor plus an inherited
    // public arm is how a narrow grant turns into a cross-channel read.
    expect(body).not.toMatch(/visibility\s*=\s*'public'/i);
  });

  it("exactly TWO policies are live — a third is an unreviewed door", () => {
    expect([...GRANTS.keys()].sort()).toEqual([
      "resource_grants_admin_write",
      "resource_grants_member_select",
    ]);
  });
});

describe("🔒 enforce_resource_grant — 'the grantor may share this'", () => {
  const BODY = liveFunctionBody("enforce_resource_grant");

  it("is the live validity trigger, and its predecessors are gone", () => {
    expect(BODY).not.toBeNull();
    // The five-migration `CREATE OR REPLACE` chain and the channel trigger it
    // replaces: one is dropped, the other is left standing only for the
    // compatibility mirror on the old table.
    expect(liveFunctionBody("assert_team_grant_workspace")).toBeNull();
    expect(liveFunctionBody("assert_agent_template_team_workspace")).toBeNull();
  });

  it("files the row under the RESOURCE's container, and refuses any other", () => {
    // ⚠ One canonical tenancy per row: every `workspace_id`-filtered read in the
    // app depends on this, and it is the ONE equality the fold kept.
    expect(BODY).toMatch(/res_ws\s*<>\s*NEW\.workspace_id/i);
    expect(BODY).toMatch(/resource workspace mismatch/i);
  });

  it("🔒 asserts the grantor reaches BOTH containers — the whole of ruling B4", () => {
    // Deleting either branch is the mutation that turns the trigger back into a
    // workspace-equality check with extra steps, and it would not fail any
    // application test: the service gate would still refuse the cases it knows
    // about, and PostgREST would not.
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*res_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(/may not share out of container/i);
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*scope_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(/may not share into container/i);
  });

  it("🔒 keeps the OLD same-container rule for an unattributed row", () => {
    // `created_by` is ON DELETE SET NULL and the backfilled team rows never had
    // one, so reach across containers has to be bought with an audit trail.
    // Without this branch a NULL grantor would silently pass both checks above.
    expect(BODY).toMatch(/NEW\.created_by\s+IS\s+NULL/i);
    expect(BODY).toMatch(/scope_ws\s*<>\s*res_ws/i);
    expect(BODY).toMatch(/unattributed grant may not cross containers/i);
  });

  it("resolves all three scopes and all five resource types, or RAISEs", () => {
    for (const scope of ["channels", "workspaces", "teams"]) {
      expect(BODY).toMatch(new RegExp(String.raw`FROM\s+${scope}\b`, "i"));
    }
    for (const table of [
      "knowledge_bases",
      "agent_templates",
      "skills",
      "chats",
      "chat_folders",
    ]) {
      expect(BODY).toMatch(new RegExp(String.raw`FROM\s+${table}\b`, "i"));
    }
    expect(BODY).toMatch(/unsupported scope_type/i);
    expect(BODY).toMatch(/unsupported resource_type/i);
  });
});

describe("🔒 the TEAM scope read path", () => {
  /**
   * The team axis retired as an AXIS, not as a capability (ruling B4), so the
   * read paths that used to join `team_resource_access` now join
   * `resource_grants` — and a join to a table carrying THREE scopes is only correct
   * while it says which one it means. Dropping `scope_type = 'team'` makes a
   * channel grant confer team access, silently.
   * ⚠ **THE JOIN MOVED ONE INDIRECTION AWAY ON 2026-09-02 (B12) AND THE INVARIANT
   * DID NOT** — phase 2 restated these onto `dopl_chat_readable()` /
   * `dopl_teams_mode_visible()`, so the term is written ONCE and these cases follow
   * the chain. Asserting on the CALLER would read a de-duplication as a lost fence.
   */
  const teamScoped = (sql: string) =>
    /scope_type\s*=\s*'team'/i.test(sql) && /resource_grants/i.test(sql);

  const TEAMS_HELPER = "dopl_teams_mode_visible"; // where the axis is resolved
  const TEMPLATE_MATRIX = "can_current_user_read_agent_template";

  it("the team axis is resolved in ONE helper, and that helper names the scope", () => {
    const helper = liveFunctionBody(TEAMS_HELPER);
    expect(teamScoped(helper!)).toBe(true);
    expect(helper).not.toMatch(/team_resource_access/i);
  });

  it("every surviving read policy reaches it, and none names the dropped table", () => {
    // ⚠ BOTH permissive `chats` policies: they are OR-ed, so a fence stated on one
    // of a pair is not a fence. Arm-by-arm equality is the redteam suites' job.
    for (const [table, policy, chain] of [
      ["chats", "chats_owner_select", "dopl_chat_readable"],
      ["chats", "chats_member_select", "dopl_chat_readable"],
      ["chat_messages", "chat_messages_select", "dopl_chat_readable"],
      ["agent_templates", "agent_templates_member_select", TEMPLATE_MATRIX],
      [
        "agent_template_knowledge_bases",
        "agent_template_knowledge_bases_member_select",
        TEMPLATE_MATRIX,
      ],
    ] as const) {
      const body = livePolicies(table).get(policy);
      expect(body, `${policy} must survive the drop`).toBeDefined();
      expect(body).not.toMatch(/team_resource_access/i);
      expect(body).toContain(`${chain}(`);
    }
    // `resource_type` is the other half of each narrowing — without it a team's KB
    // grant opens that team's members' chats. ⚠ The template matrix spelled that
    // `EXISTS` inline until `20260921120000` STEP 4 put it on the helper and added
    // the missing shared-credential arm; arm ORDER is unchanged.
    expect(liveFunctionBody("dopl_chat_readable")).toMatch(/'chat',\s*c\.id/i);
    const fn = liveFunctionBody(TEMPLATE_MATRIX);
    expect(fn).toMatch(/'agent_template',\s*t\.id/i);
    expect(fn).toMatch(new RegExp(`${TEAMS_HELPER}\\(`));
    expect(fn).toMatch(/visibility\s*=\s*'workspace'/i);
    expect(fn).toMatch(/visibility\s*=\s*'team'/i);
  });
});

describe("the retired tables are gone, and the one left behind is unchanged", () => {
  it("neither retired grant table survives the replay", () => {
    expect(tableIsLive("team_resource_access")).toBe(false);
    expect(tableIsLive("agent_template_teams")).toBe(false);
    // …and no policy is left pointing at either, which is what would make the
    // drop fail on apply rather than at review.
    expect(livePolicies("team_resource_access").size).toBe(0);
    expect(livePolicies("agent_template_teams").size).toBe(0);
  });

  it("🔒 `channel_resource_grants` is STILL LIVE, and now READ-ONLY (F-581)", () => {
    // ⚠ Deliberate, and batch 3's to remove: `repository-audience.ts` still
    // reads it, so `20260914120000` mirrors into it instead of dropping it.
    expect(tableIsLive("channel_resource_grants")).toBe(true);
    const old = livePolicies("channel_resource_grants");
    // 🔒 THE MIRROR IS NOT A WRITE SURFACE. `20260828120000`'s `FOR ALL` write
    // policy was correct while this table WAS the grant table; once
    // `20260914120000` made it a mirror that one reader still trusts, an admin
    // reaching PostgREST could file a grant that never met
    // `enforce_resource_grant()`. `20260921130000` drops it — the only writers
    // left are the two SECURITY DEFINER trigger functions.
    expect([...old.keys()].sort()).toEqual(["channel_resource_grants_member_select"]);
    expect(old.get("channel_resource_grants_member_select")).toMatch(/level\s*=\s*'visible'/i);
    // The read stays as narrow as `20260828120000` made it: admin sees all,
    // everyone else only `visible`, and the `admin` arm is what makes a second
    // admin-SELECT policy pure duplication rather than a replacement.
    expect(old.get("channel_resource_grants_member_select")).toMatch(
      /is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)/i
    );
  });

  it("🔒 both mirror writers are SECURITY DEFINER, or the read-only table loses its writes (F-581)", () => {
    // The policy drop and these two are ONE change: an invoker-rights mirror
    // would refuse its own INSERT under the narrowed table and take the LEGAL
    // `resource_grants` write down with it, and an invoker-rights GC would
    // silently delete zero rows (RLS filters, it does not raise).
    for (const fn of ["mirror_channel_resource_grant", "drop_channel_resource_grants_for_kb"]) {
      const header = liveFunctionHeader(fn);
      expect(header, fn).not.toBeNull();
      expect(header, fn).toMatch(/SECURITY\s+DEFINER/i);
    }
  });

  /**
   * 🔒 THE INTEGRATION GATE. F-468 (cross-slice, and slice B7 has its own entry on `v2/b-rls-real-1` under an id from its reserved range): `20260919120000` defines
   * `dopl_teams_mode_visible()` as `LANGUAGE sql`, whose body IS parsed and
   * dependency-tracked at creation time — so a `CREATE OR REPLACE` reading
   * `team_resource_access` AFTER `20260916120000` dropped it does not fail
   * subtly at runtime, it fails the migration outright with `relation … does not
   * exist`. Every branch of this wave writes migrations against a directory it
   * cannot see, and filename order is the only thing that decides which of them
   * is right.
   *
   * ⚠ THIS CASE IS GREEN ON THIS BRANCH BY CONSTRUCTION and is not decoration:
   * the file it exists to catch lands at MERGE, which is the first moment the
   * two slices share a directory and the last moment before replay.
   */
  it("🔒 no migration AFTER the drop mentions a dropped table (F-468)", () => {
    const DROPPED = ["team_resource_access", "agent_template_teams"];
    const AFTER = "20260916120000_drop_team_resource_access.sql";
    const offenders = FILES.filter((f) => f.name > AFTER).flatMap(({ name, sql }) =>
      DROPPED.filter((t) => new RegExp(String.raw`\b${t}\b`).test(sql)).map(
        (t) => `${name} → ${t}`
      )
    );
    // The fix is never to re-create the table: repoint the reader at
    // `resource_grants` with its `scope_type` term, which is what the fold is
    // for. See F-468 in the findings log for the exact replacement body.
    expect(offenders).toEqual([]);
  });

  /**
   * 🔒 THE OTHER MERGE HAZARD ON THIS DIRECTORY, AND IT HAS FIRED BEFORE.
   * A migration's VERSION is its filename prefix, and two files sharing one is a
   * merged-directory defect exactly like the case above: each branch picks the
   * next free slot in the directory IT can see. It happened on 2026-09-02, when
   * two files landed at `20260907120000` and the collision was found by hand and
   * recorded as a BLOCKER (`docs/MCP-EFFICIENCY-WAVE-2026-09-01.md`) — and it is
   * live in the tree AGAIN at `20260901120000`, where two APPLIED migrations
   * share a prefix (F-526).
   *
   * ⚠ SO THIS IS A RATCHET, NOT A CLEAN ASSERTION. The one live collision is
   * named and allowed, because both of its files are already applied and
   * renaming an applied migration is how a replay diverges from production. What
   * the case forbids is a SECOND one — which is the only half a gate can still
   * protect, and the half that was going to be found by hand again.
   */
  it("🔒 no TWO migrations share a version, except the one already applied (F-526)", () => {
    const APPLIED_COLLISION = ["20260901120000"];
    const byVersion = new Map<string, string[]>();
    for (const { name } of FILES) {
      const v = name.slice(0, 14);
      byVersion.set(v, [...(byVersion.get(v) ?? []), name]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([v, names]) => names.length > 1 && !APPLIED_COLLISION.includes(v))
      .map(([v, names]) => `${v}: ${names.join(" + ")}`);
    // The fix is to RENAME the UNAPPLIED file to the next free version — never to
    // rename an applied one, and never to bless the collision by adding it above.
    expect(collisions).toEqual([]);
  });

  it("the mirror is one trigger and one function — not a second write path", () => {
    const mirror = liveFunctionBody("mirror_channel_resource_grant");
    expect(mirror).not.toBeNull();
    // It only ever writes the OLD table, and only for the one slice that table
    // can hold. A mirror that read back would be a source of truth.
    expect(mirror).toMatch(/INSERT\s+INTO\s+channel_resource_grants/i);
    expect(mirror).not.toMatch(/INSERT\s+INTO\s+resource_grants/i);
    expect(mirror).toMatch(/scope_type\s*=\s*'channel'/i);
    // 🔒 Cross-container rows are SKIPPED: the old table's own trigger cannot
    // hold them, and mirroring one would RAISE inside a legal write.
    expect(mirror).toMatch(/channel_ws\s+IS\s+DISTINCT\s+FROM\s+NEW\.workspace_id/i);
  });
});
