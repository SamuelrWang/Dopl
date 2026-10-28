# `@dopl/device-contracts`

The Dopl Device SDK contracts C1–C10, frozen v1: zod schemas and their inferred types for keys,
capabilities, Connect, actions, context, display blocks, events, errors and the adapter interface.
Shared by `@dopl/sdk`, the `/api/v1` server and device adapters.

**Standalone.** Depends on `zod` only and imports nothing outside `src/`
(`packages/sdk/src/standalone.test.ts` enforces it). Contract changes need a Samuel ruling plus a
changelog line in the spec.

**Build.** `npm run build` emits ESM + `.d.ts` to `dist/` (the `exports` target). Source relative
imports stay extensionless because the Next app bundles this package from source;
`scripts/fix-esm-specifiers.mjs` adds `.js` to the emitted files.

**In this monorepo** consumers read source, not `dist/`: root `tsconfig.json › paths` (also used by
Next) and root `vitest.config.ts › resolve.alias` map `@dopl/device-contracts` to `src/index.ts`.

Gates: `npm run typecheck -w @dopl/device-contracts`, `npm test -w @dopl/device-contracts`,
`npm run build -w @dopl/device-contracts`.
