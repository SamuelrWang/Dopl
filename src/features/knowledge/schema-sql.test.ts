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
 * ⚠ **THE VALIDITY TRIGGER LEFT ON 2026-09-02** — `resource-grant-trigger.test.ts`,
 * split at the 500-line cap when the batch-2 review repaired two of its arms.
 * The seam is the one the code has: this file pins who may READ a grant row;
 * that one pins whether the row may EXIST.
 *
 * ⚠ MUTATION-VERIFIED. Each of these turns an assertion below red: restoring the
 * dropped `channel_resource_grants_admin_write` policy or taking `SECURITY
 * DEFINER` off either mirror writer; lowering `'admin'` back to `'member'`;
 * removing the `level = 'visible'` filter; restating the teams axis inside
 * `dopl_teams_mode_visible` instead of delegating; dropping the
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
// ⚠ THE REPLAY IS A SHARED MODULE SINCE 2026-09-02 (§1's 500-line cap): both this
// suite and `resource-grant-trigger.test.ts` read the same directory the same way,
// and a second copy of "how to replay a migration set" is how two suites come to
// disagree about what the final state IS.
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

  // ⚠ THE AXIS MOVED ONE INDIRECTION FURTHER ON 2026-09-02 (F-583): the trigger
  // needs it for a NAMED user, and the only statement of it read `auth.uid()`.
  // `dopl_teams_visible_for_user` now holds the rule and
  // `dopl_teams_mode_visible` is the caller-scoped case of it — same name, same
  // signature, same answer, so every policy and the pair gate are untouched.
  const TEAMS_RULE = "dopl_teams_visible_for_user"; // where the axis is resolved
  const TEAMS_HELPER = "dopl_teams_mode_visible"; // the caller-scoped case
  const TEMPLATE_MATRIX = "can_current_user_read_agent_template";

  it("the team axis is resolved in ONE helper, and that helper names the scope", () => {
    const rule = liveFunctionBody(TEAMS_RULE);
    expect(teamScoped(rule!)).toBe(true);
    expect(rule).not.toMatch(/team_resource_access/i);
  });

  it("🔒 the caller-scoped helper DELEGATES rather than restating the axis (F-583)", () => {
    // Two copies of this rule is how the caller's answer and the grantor's come
    // to disagree, which is the whole reason the parameterised form exists.
    const helper = liveFunctionBody(TEAMS_HELPER);
    expect(helper).toContain(`${TEAMS_RULE}(`);
    expect(helper).not.toMatch(/scope_type\s*=\s*'team'/i);
    expect(helper).toMatch(/auth\.uid\(\)/i);
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

  it("🔒 `channel_resource_grants` IS GONE, and so is every function that served it (F-460)", () => {
    // ⚠ **THIS CASE SAID "STILL LIVE, AND NOW READ-ONLY" UNTIL 2026-09-02.**
    // `20260914120000` kept the table as a MIRROR because one reader outside
    // its ownership still selected from it (`repository-audience.ts ›
    // listGrantedBaseIdsForChannels`); `20260921130000` then took its write
    // policy away. The reader moved onto `resource_grants` at the batch-3
    // integration and `20260923130000` drops the table, both triggers and all
    // three functions. **The read-only shape is not weakened here, it has no
    // table left to describe** — which is why the assertions about it are
    // deleted rather than relaxed.
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
    // A drop that cannot lose anything is still worth proving: a mirror that
    // had silently stopped tracking would take real grants with it, and
    // `DROP TABLE` reports nothing. The file RAISEs on any old row absent from
    // `resource_grants`.
    const drop = FILES.find((f) =>
      f.name.startsWith("20260923130000_drop_channel_resource_grants")
    );
    expect(drop, "the drop migration").toBeDefined();
    expect(drop!.sql).toMatch(/RAISE\s+EXCEPTION[\s\S]*?the mirror is not exact/i);
    // ⚠ ORDER IS LOAD-BEARING: the WRITER goes before the table. A mirror whose
    // target has been dropped aborts every legal `resource_grants` write.
    const mirrorAt = drop!.sql.indexOf("DROP FUNCTION IF EXISTS public.mirror_channel_resource_grant");
    const tableAt = drop!.sql.indexOf("DROP TABLE IF EXISTS public.channel_resource_grants");
    expect(mirrorAt).toBeGreaterThan(-1);
    expect(tableAt).toBeGreaterThan(mirrorAt);
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
    // ⚠ **THE BOUNDARY IS PER TABLE SINCE 2026-09-02, NOT ONE SHARED CUTOFF.**
    // `channel_resource_grants` outlived the other two by nine versions (it was
    // the mirror one reader still trusted, F-460), so a single `AFTER` would
    // either miss the files between the two drops or flag the drop's own
    // statements. Each entry is the file that removes the table; the scan
    // starts strictly after it.
    const DROPPED: ReadonlyArray<[string, string]> = [
      ["team_resource_access", "20260916120000_drop_team_resource_access.sql"],
      ["agent_template_teams", "20260916120000_drop_team_resource_access.sql"],
      [
        "channel_resource_grants",
        "20260923130000_drop_channel_resource_grants.sql",
      ],
    ];
    const offenders = FILES.flatMap(({ name, sql }) =>
      DROPPED.filter(
        ([t, after]) => name > after && new RegExp(String.raw`\b${t}\b`).test(sql)
      ).map(([t]) => `${name} → ${t}`)
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
   * lived in the tree AGAIN at `20260901120000`, where two APPLIED migrations
   * shared a prefix (F-526).
   *
   * ⚠ **NO LONGER A RATCHET — THE COLLISION IS GONE AND THE ASSERTION IS CLEAN
   * (2026-09-03).** The carve-out here used to allow `20260901120000` on the
   * reasoning that "renaming an applied migration is how a replay diverges from
   * production". That reasoning rested on a premise that turned out to be FALSE:
   * production versions are **auto-stamped at apply time and have not matched
   * repo filenames since ~2026-08-23** — `credit_usage_events` is applied there
   * as `20260901193049`, `agent_template_home_scoped` as `20260827135014`.
   * Production is matched by migration NAME, never by filename version, so the
   * repo prefix was never the thing keeping the two histories aligned and
   * renaming the file diverges nothing.
   *
   * ⚠ AND THE COLLISION WAS NOT COSMETIC. `db reset` stamps `schema_migrations`
   * from the filename, so two files at one version is a duplicate primary key:
   * the CI replay died on `schema_migrations_pkey` (23505) the first time it
   * ever ran, before reaching a single migration. **The carve-out was hiding the
   * one defect that made the replay impossible.** `credit_usage_events` is now
   * `20260901130000`, which keeps its chronological truth (production applied it
   * AFTER `agent_template_home_scoped`).
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
    // The fix is ALWAYS to rename a file to the next free version. Do not
    // re-introduce a carve-out: the last one cost the replay its first run.
    expect(collisions).toEqual([]);
  });

  it("the hard-delete GC survives the mirror it shared a table with", () => {
    // ⚠ **THIS CASE PINNED THE MIRROR UNTIL 2026-09-02** — one trigger, one
    // function, writing only the old table. Both are dropped by
    // `20260923130000` and the property they carried (a KB's grants die with
    // the KB, since `resource_id` can hold no FK) is `20260914120000`'s
    // parameterised GC, which was always the successor.
    const gc = liveFunctionBody("drop_resource_grants_for_resource");
    expect(gc).not.toBeNull();
    expect(gc).toMatch(/DELETE\s+FROM\s+resource_grants/i);
    expect(gc).toMatch(/resource_type\s*=\s*TG_ARGV\[0\]/i);
    expect(liveFunctionBody("mirror_channel_resource_grant")).toBeNull();
  });
});
