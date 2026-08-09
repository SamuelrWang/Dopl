/**
 * The renderer's half of F-163.
 *
 * The finding is not "one hook forwarded a bad option" — it is that the
 * documented 30s policy was inert on BOTH clients, because both mount the same
 * `QUERY_DEFAULT_OPTIONS` and both read through the same
 * `use-api-query-core`. The shared module's own test proves the merge; this
 * one proves it against the client this renderer actually constructs, so a
 * future change to `createQueryClient` (a copied default, a wrapper that
 * re-spreads options) cannot quietly restore the bug on the desktop side only.
 */

import { describe, expect, it } from "vitest";
import { buildApiQueryOptions } from "@/shared/hooks/use-api-query-core";
import type { ApiRequestFn } from "@/shared/hooks/use-api-query-core";
import { QUERY_DEFAULT_OPTIONS } from "@/shared/api/query-defaults";
import { createQueryClient } from "#/lib/query-client";

const PATH = "/api/things";
const request: ApiRequestFn = (async () => ({})) as ApiRequestFn;

describe("the SPA client resolves the shared defaults", () => {
  it("gives an unspecified staleTime the app default, not undefined", () => {
    const resolved = createQueryClient().defaultQueryOptions(
      buildApiQueryOptions(request, PATH)
    );

    expect(resolved.staleTime).toBe(QUERY_DEFAULT_OPTIONS.queries?.staleTime);
    expect(resolved.staleTime).toBe(30_000);
  });

  it("still lets a caller force revalidation with staleTime 0", () => {
    // The desktop surfaces that depend on this: the boot page and the ontology
    // snapshot (both direct `useQuery`) and the channel transcript (this hook).
    const resolved = createQueryClient().defaultQueryOptions(
      buildApiQueryOptions(request, PATH, { staleTime: 0 })
    );

    expect(resolved.staleTime).toBe(0);
  });
});
