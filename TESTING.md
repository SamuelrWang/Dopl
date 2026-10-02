# Testing

How to test Dopl. The authoritative gate table is docs/INVARIANTS.md §14; CI is
`.github/workflows/ci.yml` (re-derive the steps with `grep -n 'run:' .github/workflows/ci.yml`).
CI runs on macOS (`macos-latest`) with Node 22 for the suites; Dopl ships macOS only.

## Suites (all five run in CI)

```sh
npm test                              # root: vitest over src/**/*.test.{ts,tsx}
npm test -w @dopl/client              # packages/dopl-client
npm test -w @dopl/mcp-server          # packages/mcp-server (incl. MCP parity)
npm test -w @dopl/desktop-ui          # apps/desktop-ui, the bundled SPA
cd dopl-desktop-app && npm test       # Electron main: node --test 'test/**/*.test.mjs'
```

`npm run test:all` runs the first four only — it is not the definition of green.
`dopl-desktop-app/` is a separate npm project (own lockfile, `npm install` there);
its suite launches no Electron binary.

Run one file while iterating: `npx vitest run path/to/file.test.ts`.

## Typechecks and lints

```sh
npm run typecheck                     # root tsconfig: src/ + scripts/ (excludes apps/ and packages/)
npm run typecheck -w @dopl/desktop-ui # the SPA — vitest there does not typecheck
npm run lint -- --max-warnings 0      # root eslint, as CI runs it
cd dopl-desktop-app && npm run lint   # desktop eslint (its own config)
```

## Non-suite gates

Listed with commands in CLAUDE.md ("Definition of green") and INVARIANTS §14:
`node scripts/check-doc-refs.mjs`, the `size-check` job (500-line cap over
`packages/`), the `scripts/check-*-drift.ts` scripts, `check-rls-pair-gate.ts`,
`check-bridge-caller-drift.mjs`, `check-tenancy-move-gate.ts`, and the
committed-`dist` check (`npm run build:packages`, then
`git status --porcelain -- 'packages/*/dist/*'` must be empty).

## Tests that need more than the tree

- **RLS redteam (live half).** CI's `rls-redteam` job: `supabase start && supabase db reset`,
  export the local stack's keys, then `RLS_REDTEAM_LIVE=1 npx vitest run rls-redteam`.
  Without the env var those suites run their static half only.
- **Desktop live contract harness.** `cd dopl-desktop-app && npm run test:live` posts real
  messages to a real API and MCP endpoint; it needs a credential and the network, and is
  not part of `npm test`.
- **Codex compatibility.** `cd dopl-desktop-app && npm run test:codex-compat` runs the suite
  with the live Codex tiers armed and refuses to start without a Codex binary.

## Writing tests

Tests live next to the code (`foo.ts` → `foo.test.ts`). A bug fix includes a test that
would have caught it. Conventions: docs/INVARIANTS.md; rationale: docs/ENGINEERING.md §13.
