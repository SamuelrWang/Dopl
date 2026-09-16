-- ============================================================================
-- THE LAUNCH-NAME CHARSET CHECKS, RE-STATED IN ESCAPES ONLY (2026-09-16)
-- ============================================================================
-- ⚠ **`20261006120000` SHIPPED A CHECK THAT FORBADE A PLAIN SPACE, AND IT IS
-- APPLIED IN PRODUCTION.** That migration writes each charset class TWICE — once
-- with `\uXXXX` escapes and once with the literal characters — so that a reader
-- of either spelling sees the rule. **The literal twin reached disk with U+2028
-- (LINE SEPARATOR) and U+202F (NARROW NO-BREAK SPACE) flattened to U+0020**,
-- which turned the range `\u2028-\u202F` into `\u0020-\u0020`. Both new columns
-- therefore forbid a SPACE:
--
--     agent_name          forbids   <U+200B>..<U+200F>, <SPACE>, <U+2060>..<U+206F>, <U+FEFF>
--     applied_agent_name  forbids   the same set
--
-- (written without the `!~ '...'` spelling on purpose: the suite below scans this
--  directory for that form, and an ILLUSTRATION must not read as a CONSTRAINT.)
--
-- ⚠ **WHAT THAT BREAKS IS EVERY MULTI-WORD NAME.** `Bug reviewer` and `Research
-- bot` — `packages/mcp-server/src/tools/channel-ops-launch-name.ts`'s own copy
-- examples — and `New Agent`, the fallback `main/launch-directive-spawn.js`
-- writes for a client older than that migration, all raise `23514` on the INSERT.
-- An agent launching an agent over MCP fails at the directive write.
--
-- ⚠ **NOTHING IN THE REPO COULD HAVE CAUGHT IT AND THAT IS THE DURABLE LESSON.**
-- No suite executes SQL; `supabase db reset` replays a CHECK happily because
-- CREATING a constraint is not INSERTING through one; and both spellings are
-- invisible on screen, so review compared two strings that look identical.
-- `src/features/channels/agent-name-schema.test.ts` now reads these classes out of
-- the file and decodes them, which is the gate that would have.
--
-- ⚠ **SO THIS FILE WRITES THE CLASS IN ESCAPES ONLY — THE LITERAL TWIN IS
-- DELIBERATELY NOT RESTORED.** A rule spelled in invisible characters is a rule an
-- editor, a copy-paste, a terminal or a diff viewer can silently rewrite, which is
-- precisely what happened. Postgres ARE understands `\uXXXX`, so the escape form is
-- the complete rule on its own and it is the only form that survives being moved.
-- A future migration that wants a second spelling should add a TEST, not a twin.
--
-- ⚠ **A NEW FILE RATHER THAN AN EDIT.** `20261006120000` is applied in production
-- (2026-09-15); migrations are matched by NAME and an applied file is never
-- changed in place, or the recorded hash and the replayed bytes disagree.
--
-- ⚠ **IT IS SAFE TO RE-ADD OVER EXISTING ROWS.** The class is being NARROWED — a
-- space stops being forbidden and nothing new becomes forbidden — so every row
-- that satisfies the old CHECK satisfies this one. No `NOT VALID` / `VALIDATE`
-- dance is needed and none is used.
--
-- ⚠ **F-707 IS NOT CLOSED HERE, AND THE REASON IS A RULE RATHER THAN CAUTION.**
-- That finding is that the class omits CONTROL characters (`\u0000`-`\u001F`,
-- `\u007F`) though `20261006120000`'s header says they are refused. It is NOT
-- fixed in this file for three reasons:
--   1. **It would be three columns, not two.** The class is `20260907120000` §3's
--      `target_name` rule, copied character for character by that migration's own
--      instruction. Adding control characters to two of the three re-creates
--      exactly the drift the copy exists to prevent.
--   2. **Re-adding a WIDER constraint validates existing rows.** This file only
--      narrows, which cannot fail; adding a character class can, and a migration
--      whose job is to un-break production must not carry that risk.
--   3. **The hole is not reachable.** Both doors that write these columns already
--      refuse control characters — `packages/mcp-server` at the tool and
--      `dopl-desktop-app/main/agent-names.js › sanitizeName` at the store — so the
--      column being weaker than its header is a documentation defect, not an open
--      path. F-707 stays open as one decision about all three columns.

-- ===========================================================================
-- 1. `agent_name`
-- ===========================================================================
-- ⚠ THE WHOLE PREDICATE IS RE-STATED, not just the class: a CHECK is one
-- expression, so re-adding it means re-adding the bound and the `btrim` rule with
-- it. Both are unchanged from `20261006120000`.
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_agent_name_charset_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_agent_name_charset_check
  CHECK (
    agent_name IS NULL OR (
      char_length(agent_name) BETWEEN 1 AND 60
      AND agent_name = btrim(agent_name)
      AND agent_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

-- ===========================================================================
-- 2. `applied_agent_name`
-- ===========================================================================
ALTER TABLE public.channel_launch_directives
  DROP CONSTRAINT IF EXISTS channel_launch_directives_applied_agent_name_charset_check;

ALTER TABLE public.channel_launch_directives
  ADD CONSTRAINT channel_launch_directives_applied_agent_name_charset_check
  CHECK (
    applied_agent_name IS NULL OR (
      char_length(applied_agent_name) BETWEEN 1 AND 60
      AND applied_agent_name = btrim(applied_agent_name)
      AND applied_agent_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

-- ===========================================================================
-- 3. THE KIND FENCES AND THE COLUMN COMMENTS ARE UNTOUCHED
-- ===========================================================================
-- ⚠ STATED RATHER THAN OMITTED (`20260928130000`'s rule): an unstated absence is
-- indistinguishable from a forgotten one. `*_kind_check` ("only a launch has an
-- agent to name") and both `COMMENT ON COLUMN` strings were correct in
-- `20261006120000` and are not re-issued. Nothing is granted, indexed or
-- backfilled: the class is narrowing, so no stored value changes meaning.
