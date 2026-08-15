/**
 * The renderer's half of F-163: the documented 30s staleTime policy was inert
 * on BOTH clients. The shared module's test proves the merge; this proves it
 * against the client this renderer actually constructs, so a change to
 * `createQueryClient` cannot quietly restore the bug on the desktop side only.
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
    // Dependents: boot page + ontology snapshot (direct `useQuery`) and the
    // channel transcript (this hook).
    const resolved = createQueryClient().defaultQueryOptions(
      buildApiQueryOptions(request, PATH, { staleTime: 0 })
    );

    expect(resolved.staleTime).toBe(0);
  });
});
