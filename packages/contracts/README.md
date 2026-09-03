# `@dopl/contracts`

The one declaration of every closed set that crosses a tree boundary
(`src/` ↔ `packages/dopl-client` ↔ `packages/mcp-server`).

**Type-only, and it has no build.** `package.json` points `types` at
`src/index.ts`; every consumer imports it with `import type` and erases it at
compile time. There is no `dist/`, nothing to rebuild before committing, and
nothing to add to CI. See `src/index.ts` for the two rules that keep it that way
and for what still needs a runtime drift gate.
