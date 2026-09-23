/**
 * The agent-colour rule, read out of its migration. "No two live agents in one channel share a colour"
 * is enforced only by a partial unique index; `firstFreeAgentColor` merely avoids hitting it. The
 * sixteen-key set is restated in trees that cannot import each other: the migration's CHECKs (they
 * win), `AGENT_COLOR_KEYS` (held to `@dopl/contracts › AgentColorKey` by `satisfies`), and — source
 * read, outside this module graph — the MCP package and three desktop boundary files.
 */

import { describe, it, expect } from "vitest";
import { AGENT_COLOR_KEYS } from "./lib/agent-colors";
import { stripSqlLineComments } from "@/shared/supabase/migration-files";
import { readCode, readSource } from "@/shared/testing/source-text";

/** Repo-root-relative path, resolved from this file rather than the working directory. */
const repoFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url);

const MIGRATION = readSource(repoFile("supabase/migrations/20261005120000_agent_session_colors.sql"));

/** Whitespace-normalised, so a re-indent cannot fail a clause assertion. */
const sql = MIGRATION.replace(/\s+/g, " ");

/** Comments stripped: the header carries a rollback recipe (`DROP COLUMN`…) the additive case must not see. */
const executable = stripSqlLineComments(MIGRATION).replace(/\s+/g, " ");

describe("the migration — the column, on both tables", () => {
  it("adds `color` to `channel_sessions` and to `channel_launch_directives`", () => {
    // Both or neither: a colour the server accepts but cannot hand to the spawning machine is silently dropped.
    expect(sql).toContain(
      "ALTER TABLE public.channel_sessions ADD COLUMN IF NOT EXISTS color TEXT"
    );
    expect(sql).toContain(
      "ALTER TABLE public.channel_launch_directives ADD COLUMN IF NOT EXISTS color TEXT"
    );
  });

  it("leaves both nullable — NULL is the ordinary value, not an error state", () => {
    // NULL is every existing row, an older desktop's report, and a full bank.
    expect(sql).not.toMatch(/color TEXT NOT NULL/);
  });

  it("is ADDITIVE — it drops no column and no table", () => {
    expect(executable).not.toMatch(/DROP TABLE/i);
    expect(executable).not.toMatch(/DROP COLUMN/i);
  });
});

describe("the CHECKs — the key set, character for character on both tables", () => {
  const PATTERN = "'^agent-(0[1-9]|1[0-6])$'";

  it("constrains both columns with the SAME anchored pattern", () => {
    const hits = sql.split(PATTERN).length - 1;
    // A value legal on the directive but refused by the session column could never be honoured.
    expect(hits).toBe(2);
    expect(sql).toContain(
      `CONSTRAINT channel_sessions_color_check CHECK (color IS NULL OR color ~ ${PATTERN})`
    );
    expect(sql).toContain(
      `CONSTRAINT channel_launch_directives_color_check CHECK (color IS NULL OR color ~ ${PATTERN})`
    );
  });

  it("is ANCHORED at both ends", () => {
    // Postgres `~` searches: unanchored, `wat agent-03 wat` would pass and name no CSS token.
    expect(sql).toContain("'^agent-");
    expect(sql).toContain("$'");
  });

  it("accepts exactly the sixteen keys the runtime array holds, and nothing adjacent", () => {
    // Re-executed in JS so this asserts what Postgres accepts; the near misses are why it is not `agent-\d\d`.
    const re = /^agent-(0[1-9]|1[0-6])$/;
    for (const key of AGENT_COLOR_KEYS) expect(re.test(key), key).toBe(true);
    for (const bad of ["agent-00", "agent-17", "agent-99", "agent-1", "agent-016"]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });
});

describe("the UNIQUE INDEX — the only statement of the rule that both machines pass through", () => {
  it("is UNIQUE on `(channel_id, color)`", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX channel_sessions_channel_color_live_key ON public.channel_sessions (channel_id, color)"
    );
  });

  it("is NOT scoped to `user_id` — the rule is CROSS-MEMBER", () => {
    // With `user_id` in the index, two members could each hold `agent-01` in one room.
    const index = sql.slice(
      sql.indexOf("CREATE UNIQUE INDEX channel_sessions_channel_color_live_key"),
      sql.indexOf("COMMENT ON COLUMN public.channel_sessions.color")
    );
    expect(index).not.toContain("user_id");
  });

  it("is PARTIAL on BOTH arms — `color IS NOT NULL` and the LIVE predicate", () => {
    // `color IS NOT NULL` lets colourless sessions coexist; `state <> 'ended'` returns a colour to
    // the bank, without which a channel runs out after sixteen agents ever.
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
    // Order matters: the refusal's first free key must be the one the server would itself pick.
    const src = readCode(repoFile("packages/mcp-server/src/tools/channel-ops-launch-color.ts"));
    const listed = [...src.matchAll(/"(agent-\d\d)"/g)].map((m) => m[1]);
    expect(listed).toEqual([...AGENT_COLOR_KEYS]);
  });

  it("all three desktop boundary copies hold the identical pattern", () => {
    // The button lane, the wire row and the directive row; a drifted copy narrows a legal key on one path (F-510).
    const expected = "/^agent-(0[1-9]|1[0-6])$/";
    // Named, not globbed, so a moved copy fails like a dropped one; re-derive: `grep -rn "AGENT_COLOR_RE" main/`.
    for (const file of [
      "session-launch-op.js",
      "session-state-push-wire.js",
      "launch-directive-wire.js",
    ]) {
      const src = readCode(repoFile(`dopl-desktop-app/main/${file}`));
      expect(src, file).toContain(`const AGENT_COLOR_RE = ${expected};`);
    }
  });
});
