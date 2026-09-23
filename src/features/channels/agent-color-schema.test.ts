/**
 * INVARIANT SUITE — **THE AGENT-COLOUR RULE, READ OUT OF THE MIGRATION** (Samuel,
 * 2026-09-13; docs/specs/agent-colors.md).
 *
 * 🔒 **WHY THIS FILE EXISTS, AND IT IS A DIFFERENT REASON FROM THE OTHER `schema-sql`
 * SUITES.** Those four compare BOUNDS — a number re-typed in trees that cannot import each
 * other. This one guards a rule that has no number and no readable failure: **"no two live
 * agents in one channel wear the same colour" is enforced by a PARTIAL UNIQUE INDEX and by
 * nothing else.** `src/features/channels/lib/agent-colors.ts › firstFreeAgentColor` is the
 * policy that keeps the write from ever hitting that index, and it is unit-tested next door —
 * but a policy is an optimisation, not a guarantee: two members' desktops cannot see each
 * other's registries, so the read-then-write window is real and the index is the only thing
 * standing in it. Delete the `WHERE` clause and every test in this repo still passes while
 * two agents in one room quietly go red.
 *
 * ⚠ **AND THE PREDICATE IS THE HALF THAT WOULD ROT SILENTLY.** `state <> 'ended'` is what
 * Samuel's *"once the agent has ended, that color needs to be returned to the color bank"*
 * compiles to. Drop it and colours are never reclaimed — a channel exhausts its bank after
 * sixteen agents have EVER run in it, which nothing would report as a failure: launches keep
 * succeeding, uncoloured.
 *
 * ⚠ **FIVE STATEMENTS OF THE SIXTEEN-KEY SET, IN FOUR TREES THAT CANNOT IMPORT EACH OTHER:**
 *
 *   1. `supabase/migrations/20261005120000_agent_session_colors.sql` — two CHECKs. **They win.**
 *   2. `@dopl/contracts › AgentColorKey` — the union. Reached by the COMPILER, via the
 *      `satisfies` on (3), so it needs no assertion here.
 *   3. `src/features/channels/lib/agent-colors.ts › AGENT_COLOR_KEYS` — the runtime array and
 *      the assignment ORDER.
 *   4. `packages/mcp-server/src/tools/channel-ops-launch-color.ts › AGENT_COLOR_KEYS` — the
 *      published `z.enum`'s members. That package cannot import `src/`.
 *   5. `dopl-desktop-app/main/{session-launch-op,session-state-push-wire,launch-directive-wire}.js
 *      › AGENT_COLOR_RE` — three copies of the pattern on the boundary, in a tree that cannot
 *      see `src/` either.
 *
 * ⚠ SOURCE READ, NOT IMPORT, for trees 4 and 5 — neither is in the root vitest project's
 * module graph. The same seam `agent-identities/schema-sql.test.ts` uses, for its reason.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-13). Each of these turns an assertion below red:**
 *   (a) dropping `WHERE color IS NOT NULL AND state <> 'ended'` from the index — the
 *       UNIQUENESS case and the LIVE-PREDICATE case;
 *   (b) scoping the index to `(user_id, channel_id, color)` — the CROSS-MEMBER case, which is
 *       the exact form Samuel ruled against (*"the other user should not be able to launch an
 *       agent with that specific color of red either"*);
 *   (c) widening either CHECK's regex to `agent-\d\d` — the NEAR-MISS case, since `agent-00`
 *       and `agent-99` would then be storable and neither names a token.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

const MIGRATION = read(
  "supabase",
  "migrations",
  "20261005120000_agent_session_colors.sql"
);

/** ⚠ NORMALIZED WHITESPACE, so a re-indent or a wrapped line cannot fail these — the
 *  assertions are about which CLAUSES are present, never about formatting. */
const sql = MIGRATION.replace(/\s+/g, " ");

/**
 * THE EXECUTABLE HALF — every `--` comment line stripped.
 *
 * ⚠ **THIS FILE'S MIGRATIONS ARE MOSTLY PROSE, AND THE PROSE CONTAINS SQL.** The header
 * carries a ROLLBACK recipe (`DROP INDEX`, `DROP CONSTRAINT`, `DROP COLUMN`) as a comment,
 * which is a convention worth keeping and which makes a naive "this migration is additive"
 * scan over the whole text fail on its own documentation. So the ADDITIVE assertion reads this
 * projection and the CLAUSE assertions read {@link sql} — a clause the migration only mentions
 * in prose would pass the latter, which is fine: those cases are proving a clause IS present,
 * and the index and CHECK bodies are quoted nowhere but their own statements.
 */
const executable = MIGRATION.split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join(" ")
  .replace(/\s+/g, " ");

describe("the migration — the column, on both tables", () => {
  it("adds `color` to `channel_sessions` and to `channel_launch_directives`", () => {
    // ⚠ BOTH OR NEITHER (the migration's own argument): a colour the server accepts on
    // `manage action="launch"` and cannot hand to the machine that spawns the agent is a
    // parameter that is silently dropped, which is worse than no parameter.
    expect(sql).toContain(
      "ALTER TABLE public.channel_sessions ADD COLUMN IF NOT EXISTS color TEXT"
    );
    expect(sql).toContain(
      "ALTER TABLE public.channel_launch_directives ADD COLUMN IF NOT EXISTS color TEXT"
    );
  });

  it("leaves both nullable — NULL is the ordinary value, not an error state", () => {
    // ⚠ EVERY EXISTING ROW IS NULL, a desktop older than this wave reports NULL, and a room
    // with all sixteen out stores NULL. A `NOT NULL` here would make the migration itself fail
    // and would turn "the bank is full" into a refused launch.
    expect(sql).not.toMatch(/color TEXT NOT NULL/);
  });

  it("is ADDITIVE — it drops no column and no table", () => {
    // ⚠ READ OFF {@link executable}, NOT THE WHOLE FILE: the header states the rollback recipe
    // in a comment, which is exactly the SQL this case forbids being RUN.
    expect(executable).not.toMatch(/DROP TABLE/i);
    expect(executable).not.toMatch(/DROP COLUMN/i);
  });
});

describe("the CHECKs — the key set, character for character on both tables", () => {
  const PATTERN = "'^agent-(0[1-9]|1[0-6])$'";

  it("constrains both columns with the SAME anchored pattern", () => {
    const hits = sql.split(PATTERN).length - 1;
    // ⚠ TWO OCCURRENCES, AND THE COUNT IS THE ASSERTION: a value legal on the directive and
    // refused by the session column is a directive that can never be honoured.
    expect(hits).toBe(2);
    expect(sql).toContain(
      `CONSTRAINT channel_sessions_color_check CHECK (color IS NULL OR color ~ ${PATTERN})`
    );
    expect(sql).toContain(
      `CONSTRAINT channel_launch_directives_color_check CHECK (color IS NULL OR color ~ ${PATTERN})`
    );
  });

  it("is ANCHORED at both ends", () => {
    // ⚠ POSTGRES' `~` IS A SEARCH, NOT A FULL MATCH. Unanchored, `'agent-(0[1-9]|1[0-6])'`
    // accepts `wat agent-03 wat` — and that value is substituted into a CSS custom property
    // name on the far side, where it resolves to nothing and paints an invisible border.
    expect(sql).toContain("'^agent-");
    expect(sql).toContain("$'");
  });

  it("accepts exactly the sixteen keys the runtime array holds, and nothing adjacent", () => {
    // ⚠ THE REGEX IS RE-EXECUTED IN JS RATHER THAN EYEBALLED, so this asserts what Postgres
    // would actually accept rather than that two strings look alike. ⚠ THE NEAR MISSES ARE
    // THE REASON THE PATTERN IS NOT `agent-\d\d`: all four below are two digits.
    const re = /^agent-(0[1-9]|1[0-6])$/;
    for (const key of AGENT_COLOR_KEYS) expect(re.test(key), key).toBe(true);
    for (const bad of ["agent-00", "agent-17", "agent-99", "agent-1", "agent-016"]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });
});

describe("🔒 the UNIQUE INDEX — the only statement of the rule that both machines pass through", () => {
  it("is UNIQUE on `(channel_id, color)`", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX channel_sessions_channel_color_live_key ON public.channel_sessions (channel_id, color)"
    );
  });

  it("is NOT scoped to `user_id` — the rule is CROSS-MEMBER", () => {
    // 🔒 **THE MUTATION THIS CASE EXISTS FOR (b).** Adding `user_id` to the index is the same
    // index with the rule deleted: two members could each hold `agent-01` in one room, which is
    // precisely what Samuel ruled against — *"If my agent is a specific shade of red, then the
    // other user should not be able to launch an agent with that specific color of red
    // either."* It would also be invisible: every launch succeeds, and the collision only
    // shows up as two identically-coloured boxes in somebody's transcript.
    const index = sql.slice(
      sql.indexOf("CREATE UNIQUE INDEX channel_sessions_channel_color_live_key"),
      sql.indexOf("COMMENT ON COLUMN public.channel_sessions.color")
    );
    expect(index).not.toContain("user_id");
  });

  it("is PARTIAL on BOTH arms — `color IS NOT NULL` and the LIVE predicate", () => {
    // 🔒 **THE MUTATION THIS CASE EXISTS FOR (a).**
    //  · `color IS NOT NULL` keeps the index off every uncoloured row, so an unlimited number
    //    of colourless sessions can coexist.
    //  · `state <> 'ended'` IS the bank. It is Samuel's *"once the agent has ended, that color
    //    needs to be returned to the color bank to be used again"* — and dropping it needs no
    //    sweep to go wrong: the channel simply exhausts its sixteen keys after sixteen agents
    //    have ever run in it, with every launch still succeeding.
    expect(sql).toContain(
      "WHERE color IS NOT NULL AND state <> 'ended'"
    );
  });

  it("drops itself first, so the migration is re-runnable", () => {
    expect(sql).toContain(
      "DROP INDEX IF EXISTS public.channel_sessions_channel_color_live_key"
    );
  });
});

describe("the set, in the two trees that cannot import `src/`", () => {
  it("the MCP package publishes the same sixteen, in the same order", () => {
    // ⚠ ORDER, NOT JUST MEMBERSHIP: the refusal lists what is FREE, and the first entry has to
    // be the key the server would itself have picked, or the advice and the assignment
    // disagree on the caller's retry.
    const src = read(
      "packages",
      "mcp-server",
      "src",
      "tools",
      "channel-ops-launch-color.ts"
    );
    const listed = [...src.matchAll(/"(agent-\d\d)"/g)].map((m) => m[1]);
    expect(listed).toEqual([...AGENT_COLOR_KEYS]);
  });

  it("all three desktop boundary copies hold the identical pattern", () => {
    // ⚠ THREE LANES, AND F-510's SHAPE IS A FIELD SPELLED AT ONE AND FORGOTTEN BY THE OTHERS.
    // These are the button lane, the wire row and the directive row; a pattern that drifted on
    // one of them would narrow a legal key to "no colour" on exactly one launch path.
    const expected = "/^agent-(0[1-9]|1[0-6])$/";
    // ⚠ **`session-state-push.js` → `session-state-push-wire.js` (2026-09-14).** The push lane
    // was split at the 500-line cap and the pattern moved with the WIRE half, which is where it
    // belongs: this constant is about what crosses to the server, not about when a push fires.
    // The list is the thing that must be re-derived — `grep -rn "AGENT_COLOR_RE" main/` — and a
    // stale name here fails as "does not contain", i.e. exactly as a DROPPED copy would, which
    // is why the file names are asserted rather than globbed.
    for (const file of [
      "session-launch-op.js",
      "session-state-push-wire.js",
      "launch-directive-wire.js",
    ]) {
      const src = read("dopl-desktop-app", "main", file);
      expect(src, file).toContain(`const AGENT_COLOR_RE = ${expected};`);
    }
  });
});
