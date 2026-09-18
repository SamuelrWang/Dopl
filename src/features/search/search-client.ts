"use client";

/**
 * The real search transport: `GET /api/search`, and nothing else. A host names
 * this or the fixture, and that is the whole swap — both are a `SearchFetcher`.
 *
 * Scope travels in the query, not a header: the route is `withUserAuth` precisely
 * so a multi-workspace caller can search account-wide, which `x-workspace-id`
 * would make unexpressible. `container` under `scope=account` is a 400, not an
 * ignored param, which is why the ternary sends `undefined`.
 *
 * The signal is forwarded, which is what makes the hook's abort real.
 */

import { apiRequest } from "@/shared/api/api-client";
import type { SearchResponse } from "./contracts";
import type { SearchFetcher } from "./use-search";

/** The path is this file's, not the contract's: `contracts.ts` states the wire
 *  shape, which both trees read; where the route is mounted only a caller needs. */
const SEARCH_PATH = "/api/search";

export const apiSearchFetcher: SearchFetcher = ({
  q,
  scope,
  containerId,
  signal,
}) =>
  apiRequest<SearchResponse>(SEARCH_PATH, {
    // `undefined` keys are stripped by the shared query builder, so an
    // account-scoped call sends no `container` at all rather than an empty one.
    query: { q, scope, container: scope === "container" ? containerId : undefined },
    signal,
  });
