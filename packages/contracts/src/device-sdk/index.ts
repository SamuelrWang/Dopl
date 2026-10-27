/**
 * `@dopl/contracts/device-sdk` — the Dopl Device SDK contracts C1–C10, frozen v1
 * (docs/specs/device-sdk/SPEC-v1.md; changes only by Samuel ruling + a changelog line there).
 *
 * ⚠ **THE ONE RUNTIME CORNER OF THIS PACKAGE.** The rest of `@dopl/contracts` is type-only
 * (`../index.ts` rule 1). These modules carry zod schemas, which are values, so they are reachable
 * ONLY through the `./device-sdk` subpath export; the root barrel re-exports their TYPES alone and
 * stays erasable for every existing consumer. The HTTP surface is `docs/specs/device-sdk/openapi.yaml`.
 */
export * from "./keys";
export * from "./capabilities";
export * from "./connect";
export * from "./actions";
export * from "./context";
export * from "./display";
export * from "./events";
export * from "./errors";
export * from "./adapter";
