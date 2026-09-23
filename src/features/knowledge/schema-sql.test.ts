/**
 * Invariant suite — `resource_grants`: its RLS policies and the two tables it
 * replaced, read out of `supabase/migrations` and replayed in apply order.
 * These are database facts no application test can reach, because every
 * knowledge read in this app runs on the service-role client and never meets a
 * policy.
 *
 * What is pinned is the FINAL STATE AFTER REPLAY, not one file: policies are
 * OR-ed, so a later `DROP` is as load-bearing as the `CREATE`. Files are read in
 * filename order, which is apply order.
 *
 * Two properties exist because `20260827120000` shipped them wrong: the write
 * floor is `admin`, not `member` (PostgREST is a second door a workspace member
 * reaches with their own JWT, and a container peer can be granted `member` —
 * `home/schema.ts › grantedRole` ∈ guest|viewer|member), and the non-admin
 * SELECT arms filter on `level = 'visible'`, or `agent_only`'s existence is
 * enumerable by any viewer.
 *
 * The validity trigger is pinned in `resource-grant-trigger.test.ts`: this file
 * says who may READ a grant row, that one whether the row may EXIST.
 *
 * Comments are stripped line-wise before matching, because these migration
 * headers quote their own SQL at length. The strip is line-level; if a migration
 * on these tables ever puts a `--` inside a string literal, take the hand
 * scanner from `channels/schema-sql.test.ts`.
 */

import { describe, it, expect } from "vitest";
// Shared replay module: a second copy of "how to replay a migration set" is how
// two suites come to disagree about what the final state is.
import {
  FILES,
  livePolicies,
  liveFunctionBody,
  liveFunctionHeader,
  tableIsLive,
} from "./migration-replay";

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
    // Non-admin arms gate on the level, so absence and `agent_only` are one
    // answer through this door, as they are through the guest lane.
    expect(body).toMatch(/level\s*=\s*'visible'/i);
    // …and the managing audience still sees everything, or nobody can
    // administer a grant through PostgREST at all.
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'admin'\s*\)/i);
  });

  it("the guest arm SURVIVED the fold — a channel member still reads its own grants", () => {
    const [, body] = [...GRANTS].find(([, b]) => /\bFOR\s+SELECT\b/i.test(b))!;
    expect(body).toMatch(/is_current_workspace_member\(\s*workspace_id\s*,\s*'guest'\s*\)/i);
    expect(body).toMatch(/is_channel_member\(\s*scope_id\s*\)/i);
    // Scoped to channels: `is_channel_member` over a `scope_id` that might be a
    // team or a container asks the wrong table, so the guest arm must say which
    // scope it answers for.
    expect(body).toMatch(/scope_type\s*=\s*'channel'/i);
    // No `visibility='public'` arm, ever: a lowered floor plus an inherited
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

describe("🔒 the TEAM scope read path", () => {
  /**
   * The team read paths join `resource_grants`, a table carrying three scopes,
   * so they are only correct while they say which one: dropping
   * `scope_type = 'team'` makes a channel grant confer team access silently.
   * The term is stated once, on `dopl_chat_readable()` /
   * `dopl_teams_mode_visible()`, and these cases follow the chain — asserting on
   * the caller would read a de-duplication as a lost fence.
   */
  const teamScoped = (sql: string) =>
    /scope_type\s*=\s*'team'/i.test(sql) && /resource_grants/i.test(sql);

  // F-583 (2026-09-02): the trigger needs the axis for a NAMED user, so
  // `dopl_teams_visible_for_user` holds the rule and `dopl_teams_mode_visible`
  // is the caller-scoped case of it.
  const TEAMS_RULE = "dopl_teams_visible_for_user"; // where the axis is resolved
  const TEAMS_HELPER = "dopl_teams_mode_visible"; // the caller-scoped case
  const IDENTITY_MATRIX = "can_current_user_read_agent_identity";

  it("the team axis is resolved in ONE helper, and that helper names the scope", () => {
    const rule = liveFunctionBody(TEAMS_RULE);
    expect(teamScoped(rule!)).toBe(true);
    expect(rule).not.toMatch(/team_resource_access/i);
  });

  it("🔒 the caller-scoped helper DELEGATES rather than restating the axis (F-583)", () => {
    // Two copies of this rule is how the caller's answer and the grantor's come
    // to disagree, which is why the parameterised form exists.
    const helper = liveFunctionBody(TEAMS_HELPER);
    expect(helper).toContain(`${TEAMS_RULE}(`);
    expect(helper).not.toMatch(/scope_type\s*=\s*'team'/i);
    expect(helper).toMatch(/auth\.uid\(\)/i);
  });

  it("every surviving read policy reaches it, and none names the dropped table", () => {
    // Both permissive `chats` policies: they are OR-ed, so a fence stated on
    // one of a pair is not a fence.
    for (const [table, policy, chain] of [
      ["chats", "chats_owner_select", "dopl_chat_readable"],
      ["chats", "chats_member_select", "dopl_chat_readable"],
      ["chat_messages", "chat_messages_select", "dopl_chat_readable"],
      ["agent_identities", "agent_identities_member_select", IDENTITY_MATRIX],
      [
        "agent_identity_knowledge_bases",
        "agent_identity_knowledge_bases_member_select",
        IDENTITY_MATRIX,
      ],
    ] as const) {
      const body = livePolicies(table).get(policy);
      expect(body, `${policy} must survive the drop`).toBeDefined();
      expect(body).not.toMatch(/team_resource_access/i);
      expect(body).toContain(`${chain}(`);
    }
    // `resource_type` is the other half of each narrowing — without it a team's
    // KB grant opens that team's members' chats.
    expect(liveFunctionBody("dopl_chat_readable")).toMatch(/'chat',\s*c\.id/i);
    const fn = liveFunctionBody(IDENTITY_MATRIX);
    expect(fn).toMatch(/'agent_identity',\s*t\.id/i);
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

  it("🔒 `channel_resource_grants` IS GONE, and so is every function that served it (F-460)", () => {
    // The table was kept as a mirror while `repository-audience.ts ›
    // listGrantedBaseIdsForChannels` still read it; that reader moved onto
    // `resource_grants` and `20260923130000` drops the table, both triggers and
    // all three functions.
    expect(tableIsLive("channel_resource_grants")).toBe(false);
    // …and nothing is left pointing at it, which is what would make the drop
    // fail on apply rather than at review.
    expect(livePolicies("channel_resource_grants").size).toBe(0);
    for (const fn of [
      "mirror_channel_resource_grant",
      "enforce_channel_resource_grant",
      "drop_channel_resource_grants_for_kb",
    ]) {
      expect(liveFunctionHeader(fn), fn).toBeNull();
    }
  });

  it("🔒 the drop proves the mirror was exact before it removes it", () => {
    // A mirror that had silently stopped tracking would take real grants with
    // it and `DROP TABLE` reports nothing, so the file RAISEs on any old row
    // absent from `resource_grants`.
    const drop = FILES.find((f) =>
      f.name.startsWith("20260923130000_drop_channel_resource_grants")
    );
    expect(drop, "the drop migration").toBeDefined();
    expect(drop!.sql).toMatch(/RAISE\s+EXCEPTION[\s\S]*?the mirror is not exact/i);
    // Order is load-bearing: the writer goes before the table, or a mirror
    // whose target is gone aborts every legal `resource_grants` write.
    const mirrorAt = drop!.sql.indexOf("DROP FUNCTION IF EXISTS public.mirror_channel_resource_grant");
    const tableAt = drop!.sql.indexOf("DROP TABLE IF EXISTS public.channel_resource_grants");
    expect(mirrorAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(mirrorAt);
  });

  /**
   * The integration gate. F-468: `20260919120000` defines
   * `dopl_teams_mode_visible()` as `LANGUAGE sql`, whose body is parsed and
   * dependency-tracked at creation time, so a `CREATE OR REPLACE` reading
   * `team_resource_access` after `20260916120000` dropped it fails the migration
   * outright. Green on this branch by construction: the file it catches lands at
   * merge, the first moment two slices share a directory.
   */
  it("🔒 no migration AFTER the drop mentions a dropped table (F-468)", () => {
    // The boundary is per table, not one shared cutoff: `channel_resource_grants`
    // outlived the other two by nine versions (F-460), so a single `AFTER` would
    // either miss the files between the two drops or flag the drop's own
    // statements. Each entry is the file that removes the table; the scan starts
    // strictly after it.
    const DROPPED: ReadonlyArray<[string, string]> = [
      ["team_resource_access", "20260916120000_drop_team_resource_access.sql"],
      ["agent_template_teams", "20260916120000_drop_team_resource_access.sql"],
      [
        "channel_resource_grants",
        "20260923130000_drop_channel_resource_grants.sql",
      ],
      // R-48 (Samuel, 2026-09-17): same shape, cutoff is again its own drop file.
      [
        "channel_personal_arming",
        "20261012120000_drop_channel_personal_arming.sql",
      ],
    ];
    const offenders = FILES.flatMap(({ name, sql }) =>
      DROPPED.filter(
        ([t, after]) => name > after && new RegExp(String.raw`\b${t}\b`).test(sql)
      ).map(([t]) => `${name} → ${t}`)
    );
    // The fix is never to re-create the table: repoint the reader at
    // `resource_grants` with its `scope_type` term. See F-468 in the findings
    // log for the exact replacement body.
    expect(offenders).toEqual([]);
  });

  /**
   * The other merge hazard on this directory: two files sharing a version
   * prefix, because each branch picks the next free slot in the directory it can
   * see (F-526).
   *
   * No carve-out. `db reset` stamps `schema_migrations` from the filename, so a
   * shared version is a duplicate primary key and the replay dies on
   * `schema_migrations_pkey` (23505) before reaching a migration. Renaming is
   * safe: production stamps versions at apply time and is matched by migration
   * NAME, never by filename version.
   */
  it("🔒 no TWO migrations share a version (F-526)", () => {
    const byVersion = new Map<string, string[]>();
    for (const { name } of FILES) {
      const v = name.slice(0, 14);
      byVersion.set(v, [...(byVersion.get(v) ?? []), name]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([v, names]) => `${v}: ${names.join(" + ")}`);
    // The fix is always to rename a file to the next free version; a carve-out
    // cost the replay its first run.
    expect(collisions).toEqual([]);
  });

  it("the hard-delete GC survives the mirror it shared a table with", () => {
    // The old mirror trigger and function are dropped by `20260923130000`; the
    // property they carried (a KB's grants die with the KB, since `resource_id`
    // can hold no FK) is now `20260914120000`'s parameterised GC.
    const gc = liveFunctionBody("drop_resource_grants_for_resource");
    expect(gc).not.toBeNull();
    expect(gc).toMatch(/DELETE\s+FROM\s+resource_grants/i);
    expect(gc).toMatch(/resource_type\s*=\s*TG_ARGV\[0\]/i);
    expect(liveFunctionBody("mirror_channel_resource_grant")).toBeNull();
  });
});
