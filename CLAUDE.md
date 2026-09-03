# Claude instructions for this repo

## Which doc to read

- **[docs/INVARIANTS.md](docs/INVARIANTS.md) is the STANDING READ.** Load it before any structural or
  architectural work. It is the terse, verified statement of how the system behaves right now:
  layout + the 500-line cap, the repository/service/handler split, auth wrappers and gates, workspace
  resolution, the channels model, outbound consent review, realtime, the write layer, read projections, the MCP
  surface, desktop session rules, migrations, the release pipeline, and the testing gates.
- **[docs/ENGINEERING.md](docs/ENGINEERING.md) is the ARCHAEOLOGY.** Consult it when you need the
  *rationale* or the *history* behind a rule — why it exists, what it replaced, what incident bought it.
  It is **very large — do not load it wholesale**; open the section you need. It is dated
  stratum-by-stratum, and an undated "rule" section in it is not current state.

### Precedence, in full: **code > INVARIANTS.md > ENGINEERING.md**

Applied pairwise, always in that order. ENGINEERING loses to both; INVARIANTS loses to the code.

**When the CODE and INVARIANTS.md disagree, you have found a bug in one of them — say which, in the
same change. Never silently pick a side.**

- **INVARIANTS is wrong → fix INVARIANTS in the same change**, re-verified against the tree, not from
  memory. This is the common case and it is not optional follow-up work: a doc that lost one argument
  is about to win the next one.
- **The CODE looks wrong → file a finding in [docs/REFACTOR-FINDINGS.md](docs/REFACTOR-FINDINGS.md)
  (`F-NNN`)** and leave both sides alone. Do NOT edit the code to match the doc, and do NOT soften the
  doc to match code you believe is broken — either one destroys the evidence that they disagreed.
- **Cannot tell which is wrong → that is still a finding**, not a reason to pick. Record the
  disagreement and what you measured.

⚠ ENGINEERING.md has twice been the source of a claim that was never true (`withExternalAuth` /
`withAdminAuth`, and `shared/api/error-handler.ts › withErrorHandler`). **Copying from it without
opening the file it names is how a fiction gets promoted into INVARIANTS.**
`node scripts/check-doc-refs.mjs` now resolves `path › symbol` anchors and would have caught both.
- **For ANY UI work, read [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) first.** All interface code MUST
  use the global design tokens (semantic `text-*` scale, token color utilities) and kit classes — never
  hardcode hex colors, raw px font sizes, or shadow/border recipes in components.
- **Open findings live in [docs/REFACTOR-FINDINGS.md](docs/REFACTOR-FINDINGS.md)** with `F-NNN` ids.
  ⚠ **Allocate a new id from the highest claimed on ANY LIVE BRANCH, never from `master`'s** — that
  file is an append-only shared counter, and on 2026-09-01 three branches of one wave each allocated
  from master's `F-403` and produced six entries under three ids. `check-doc-refs.mjs` catches a
  DANGLING id, never a COLLIDING one. The re-derive command is at the top of the findings log.

## Standing rules for writing docs

1. **A number carries its measurement date**, or it does not go in a doc. Counts, file sizes and table
   lengths drift; an undated one is a future wrong answer. Prefer the command over the number.
2. **Code references use symbol anchors** — `path › symbolName`, or a grep pattern. **Never a bare line
   number.** Line numbers are wrong within a day and silently point at unrelated code.
3. **Current state lives in INVARIANTS.md; change-narrative lives in ENGINEERING.md. Never both.** A rule
   stated in two places drifts in one of them, and you cannot tell which from the outside.
4. **Deploy state is a measurement, not a claim.** Migrations applied, env vars set, crons armed, what a
   production endpoint answers — the repo holds claims, only the deployment holds facts. **Record the
   command, not the answer.**

## Session-end doc ritual (definition of done)

These docs are load-bearing: agents act on them instead of re-reading the codebase, so a stale doc
produces confident wrong edits. Any session that changes architecture, conventions, the API/MCP surface,
or the schema is NOT done until it has:

1. Updated **docs/INVARIANTS.md** if a live rule, layout, or contract changed — and re-verified the claim
   against the tree at write time, not from memory.
2. Added the *why* to **docs/ENGINEERING.md** only if the rationale is worth keeping. A rule change with
   no story does not need an entry.
3. Recorded new debt or resolved findings in **docs/REFACTOR-FINDINGS.md** (`F-NNN`).
4. Synced the "Dopl Development" knowledge base in the Dopl workspace (via `dopl_kb`) when the change
   affects what a future coding session must know.

Do this before reporting the work complete, not as a follow-up.

## Definition of green

**Five suites, TWO lints, TWO typechecks, and TEN non-suite gates** (ten since 2026-09-02) — the full table is
docs/INVARIANTS.md §14. Red CI is a P0.

⚠ **THE COUNT HAS BEEN WRONG THREE TIMES AND THE TWO ERRORS ARE OPPOSITE ONES — read both before
trusting any number here.** (1) Until 2026-08-26 it said FIVE over a table of FOUR, because the five
it counted included the desktop-ui typecheck, **which is one of the TWO typechecks** — a double
count. (2) It then said FOUR until 2026-09-01, and that was an UNDERCOUNT: two real gates
(`check-role-drift`, then `check-css-token-drift`) had shipped in CI with no doc row. It is FIVE
today for a different reason than it was FIVE in August, and both times the fix was the same
command. ⚠ **AND IT IS EIGHT SINCE 2026-09-02**, when `check-session-health-drift`, then
`check-message-kind-drift`, then the committed-`dist` check landed — all three shipped WITH their
doc rows, in the same change, which is the whole remedy this warning has been asking for. Three in
one day makes it the convention rather than the exception. ⚠ **AND NINE SINCE LATER THE SAME DAY**,
when Wave B's B7 added `check-rls-pair-gate` — also with its rows, here and in §14. ⚠ **AND TEN SINCE THE BATCH-2 REVIEW THE SAME DAY**, when the `rls-redteam` job landed — the fifth in two days to ship with its rows. ⚠ The list below is **"what gets forgotten"**, which is a different question from **"how
many non-suite gates there are"** — the first item is on it precisely because it is a typecheck
nobody remembers to run, and it is NOT one of the five.

The eleven things that are routinely forgotten (TEN non-suite gates since 2026-09-02, plus the
second typecheck):

1. `npm run typecheck -w @dopl/desktop-ui` — the SPA is **outside the root `tsconfig`**, and its
   vitest run does not typecheck. `npm run typecheck` alone does not cover it.
2. `node scripts/check-doc-refs.mjs` — doc anchors. **Not covered by `npm run lint`**
   (`globalIgnores` excludes `scripts/**`).
3. the `size-check` CI job — the 500-line cap over `packages/`, an inline `find`/`awk` in ci.yml.
4. `npx tsx scripts/check-knowledge-type-drift.ts` — knowledge types, server vs SDK.
5. `npx tsx scripts/check-role-drift.ts` — the workspace ROLE SET, the `GET /api/workspaces` row
   shape, and `isStandardWorkspace`'s positive form. ⚠ **THE TYPE HALVES OF (A) AND (C) LEFT ON
   2026-09-02** when `@dopl/contracts` took them (INVARIANTS §1): what is checked is the role-keyed
   decision MAPS, the SQL rank `CASE`, the two DTO interfaces and the three copies of the
   PREDICATE — a type-only package cannot hold a function.
   ⚠ **This list said "four" and omitted it until 2026-08-26**, though it has been the second step
   of CI's `type-drift` job since guest-role M0 (`080b7b48`) — i.e. the wave that introduced the
   `guest` role shipped the gate that guards the role set and told no doc about it.
6. `npx tsx scripts/check-session-health-drift.ts` — the SEVEN session-health
   fields, across the zod block in `schema-sessions.ts` and the migration's own
   columns, against `@dopl/contracts › sessions.ts`. ⚠ **ADDED 2026-09-02 WITH ITS DOC
   ROW IN THE SAME CHANGE**, which is the whole point of the warning below it —
   the previous two gates each shipped without one. ⚠ **AND REDUCED FROM FOUR
   HAND-MIRRORS TO TWO SITES THE SAME DAY**, when the shared package took the
   type: the SDK's copy and its committed `dist/` re-export it now, so neither can
   disagree. Every field on this set is `optional` AND `nullable` by design (an
   older desktop must not 400 its whole push), so drift here fails no build and no
   test: the field just never arrives.
7. `npx tsx scripts/check-message-kind-drift.ts` — the `channel_messages` **kind** and
   **author_kind** SETS across `@dopl/contracts › channels.ts` and the column `CHECK`. The zod half
   needs no step: `closedEnum` over an `Exclude`d type makes that pair a compile error, and the SDK
   halves stopped being steps the same day for the same reason (a re-export cannot disagree).
   ⚠ **ADDED 2026-09-02 WITH ITS DOC ROW**, the second gate that day to do so.
   Both drift directions are silent — a kind the `CHECK` lacks throws `23514` only on a real
   INSERT, and a kind the union lacks is cast into it and takes every default branch.
8. `npx tsx scripts/check-css-token-drift.ts` — the DESIGN TOKENS, `src/app/globals.css` vs the
   SPA's `apps/desktop-ui/src/styles/tokens.css`, which is a second copy with no shared module.
   ⚠ **And this list said "five" and omitted THIS one until 2026-09-01**, though it has been the
   `type-drift` job's THIRD step since `522f53df` (2026-08-31). **The same failure, a second time,
   one month apart: the wave that adds a gate does not add its doc row.** Twice is a coincidence;
   three times (counting `check-role-drift`) is the process. **So re-derive this list rather than
   trusting it — it has been wrong twice and the command takes one second:
   `grep -n 'run:' .github/workflows/ci.yml`.**
9. 🔒 **the committed-`dist` check** — `npm run build:packages`, then
   `git status --porcelain -- 'packages/*/dist/*'` (⚠ **the trailing `/*` IS the gate** — a git
   pathspec glob must match the WHOLE path, so `packages/*/dist` matched nothing and the check
   reported every stale build as clean from the day it landed; fixed 2026-09-02). **The committed `dist/` is what the app LOADS**
   (`next.config.ts › serverExternalPackages` keeps both packages external), and until 2026-09-02
   nothing asserted it was the build of `src/`. The A10 branch shipped a `dist/` that predated its
   own source change and every gate stayed green: the suites import `src/`, both typechecks read
   `src/`, and CI's `build-test` rebuilds into a **throwaway checkout**, so it proves the build
   SUCCEEDS and never that the committed output MATCHES. ⚠ **ADDED 2026-09-02 WITH ITS DOC ROW**,
   the third gate that day to do so (F-452). The build step is a precondition; the `git status`
   is the gate.
10. `npx tsx scripts/check-rls-pair-gate.ts` — every `canSee*` predicate has a NAMED SELECT-policy
    twin, checked in both directions (a new predicate with no declared twin fails; a twin a later
    migration dropped fails). ⚠ **ADDED 2026-09-02 WITH ITS DOC ROW**, the fourth gate in two days
    to do so. It does NOT claim the predicate and the policy AGREE — that is what the per-table
    redteam suites prove, one table at a time. ⚠ Since B12 it also checks the covered tables
    that have NO predicate to hang a twin on (the child tables, and `resource_grants`).
    ⚠ **AND IT CHECKS FOUR THINGS SINCE THE BATCH-2 REVIEW, NOT ONE (F-585)**: it had asserted
    that a policy NAME survived, so `USING (true)`, a second permissive policy, `DISABLE ROW
    LEVEL SECURITY` and a `FOR SELECT` → `FOR INSERT` flip all passed. It now replays
    `DROP TABLE`, asserts RLS is on per table, asserts the live SELECT set EQUALS the declared
    set, and asserts each policy is `FOR SELECT` and reaches its predicate.
11. 🔒 **the `rls-redteam` CI job** — the only gate that starts a database, and therefore the only
    one that can say POSTGRES agrees. `supabase start && supabase db reset`, then
    `RLS_REDTEAM_LIVE=1 vitest run` over the five redteam files. Before it, every behavioural RLS
    case in two waves was green having never executed a statement, because the flag was set
    nowhere. `db reset` makes it the migration REPLAY gate too. ⚠ It cannot run on a machine
    without Docker; the local skip-with-reason stays.

⚠ **`npm run test:all` chains the first four SUITES and nothing else. It is not the definition of
green.** The two lint steps differ: the ROOT one runs `npm run lint -- --max-warnings 0`, so a new
warning fails CI; the DESKTOP one runs a bare `npm run lint`, so only a new error does. Both trees
measured 0/0 on 2026-08-11 — the root zero is enforced, the desktop zero is not. Full table:
docs/INVARIANTS.md §14.
