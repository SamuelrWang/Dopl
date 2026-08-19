# Claude instructions for this repo

## Which doc to read

- **[docs/INVARIANTS.md](docs/INVARIANTS.md) is the STANDING READ.** Load it before any structural or
  architectural work. It is the terse, verified statement of how the system behaves right now:
  layout + the 500-line cap, the repository/service/handler split, auth wrappers and gates, workspace
  resolution, the channels model, consent + trust, realtime, the write layer, read projections, the MCP
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

**Five suites, TWO lints, TWO typechecks, and four non-suite gates** — the full table is
docs/INVARIANTS.md §14. Red CI is a P0.

The four that are routinely forgotten, because none of them is a test suite:

1. `npm run typecheck -w @dopl/desktop-ui` — the SPA is **outside the root `tsconfig`**, and its
   vitest run does not typecheck. `npm run typecheck` alone does not cover it.
2. `node scripts/check-doc-refs.mjs` — doc anchors. **Not covered by `npm run lint`**
   (`globalIgnores` excludes `scripts/**`).
3. the `size-check` CI job — the 500-line cap over `packages/`, an inline `find`/`awk` in ci.yml.
4. `npx tsx scripts/check-knowledge-type-drift.ts` — knowledge types, server vs SDK.

⚠ **`npm run test:all` chains the first four SUITES and nothing else. It is not the definition of
green.** The two lint steps differ: the ROOT one runs `npm run lint -- --max-warnings 0`, so a new
warning fails CI; the DESKTOP one runs a bare `npm run lint`, so only a new error does. Both trees
measured 0/0 on 2026-08-11 — the root zero is enforced, the desktop zero is not. Full table:
docs/INVARIANTS.md §14.
