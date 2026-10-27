# Dopl Device SDK: contracts (frozen v1)

The source of truth is **[SPEC-v1.md](SPEC-v1.md)**: contracts C1–C10 and decisions D1–D6, frozen
2026-10-27. It is an in-repo copy of `SPEC-step0-contracts.md` from the 2026-10-26 research folder.

The spec lives as code in two places, which must agree field for field:

- **TypeScript + zod:** `packages/contracts/src/device-sdk/` (import from `@dopl/contracts/device-sdk`;
  the root `@dopl/contracts` barrel re-exports the types only). Tests sit next to each file.
- **HTTP surface:** [openapi.yaml](openapi.yaml), OpenAPI 3.1 for `/v1`. Validate with
  `npx --yes @redocly/cli@latest lint docs/specs/device-sdk/openapi.yaml`.

## Changing a contract

Contracts change **only by an explicit Samuel ruling**, recorded as a changelog line at the bottom of
`SPEC-v1.md`. The same change updates the zod contracts, `openapi.yaml` and their tests in one commit.
