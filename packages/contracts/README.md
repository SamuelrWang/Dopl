# `@dopl/contracts`

The one declaration of every closed set that crosses a tree boundary
(`src/` ↔ `packages/dopl-client` ↔ `packages/mcp-server`).

**Type-only, and it has no build.** `package.json` points `types` at
`src/index.ts`; every consumer imports it with `import type` and erases it at
compile time. There is no `dist/`, nothing to rebuild before committing, and
nothing to add to CI. See `src/index.ts` for the two rules that keep it that way
and for what still needs a runtime drift gate.

**One exception: `src/device-sdk/`** (Device SDK contracts C1–C10, frozen v1 —
`docs/specs/device-sdk/`). It holds zod schemas, which are runtime values, so it is reachable
only through the `@dopl/contracts/device-sdk` subpath; the root barrel re-exports its types alone.
`zod` resolves from the root workspace (no lockfile change). Gates: `npm run typecheck -w
@dopl/contracts` and `npm test -w @dopl/contracts` (the root vitest config collects `src/**` only).
