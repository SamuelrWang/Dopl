/**
 * `@dopl/device-contracts`: the Dopl Device SDK contracts C1–C10, frozen v1 (changes only by a
 * maintainer ruling + a changelog line). Zod schemas plus their inferred types. Standalone:
 * imports nothing but `zod` and its own files. The HTTP surface is the device-sdk `openapi.yaml`.
 *
 * Relative imports stay EXTENSIONLESS: the Next app bundles this package from source and Turbopack
 * does not map `./x.js` to `x.ts`. The build (`scripts/fix-esm-specifiers.mjs`) adds `.js` to the
 * emitted `dist/` so Node ESM and `node16` type resolution work for published consumers.
 */
export * from "./keys";
export * from "./capabilities";
export * from "./connect";
export * from "./actions";
export * from "./context";
export * from "./display";
export * from "./events";
export * from "./errors";
export * from "./lists";
export * from "./adapter";
