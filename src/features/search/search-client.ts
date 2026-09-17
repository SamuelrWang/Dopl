"use client";

/**
 * THE REAL SEARCH TRANSPORT — `GET /api/search`, and nothing else.
 *
 * ⚠ **THE HOSTS NAME THIS OR THE FIXTURE, AND THAT IS THE WHOLE SWAP**
 * (`search-fixtures.ts` carries why the fixture exists). Both are a
 * `SearchFetcher`; the hook, the popup and the rows cannot tell which one they
 * were handed.
 *
 * ⚠ **SCOPE TRAVELS IN THE QUERY, NOT IN A HEADER.** `?scope=container&
 * container=<id>` is what `search/schema.ts › SearchQuerySchema` parses, and the
 * route is `withUserAuth` precisely so a multi-workspace caller can search
 * ACCOUNT-wide; sending `x-workspace-id` instead would make that unexpressible.
 * ⚠ **AND `container` UNDER `scope=account` IS A 400, NOT AN IGNORED PARAM** —
 * the schema refuses it, which is why the ternary below sends `undefined` (the
 * shared query builder drops the key) rather than the id.
 *
 * ⚠ **THE SIGNAL IS FORWARDED**, which is what makes the hook's abort real: the
 * shared client races the desktop's IPC call against it and drops the response.
 */

import { apiRequest } from "@/shared/api/api-client";
import type { SearchResponse } from "./contracts";
import type { SearchFetcher } from "./use-search";

/** ⚠ **THE PATH IS THIS FILE'S, NOT THE CONTRACT'S** — `contracts.ts` states the
 *  wire SHAPE, which both trees read; where the route is mounted is a fact only a
 *  caller needs, and the route itself is the other half of it
 *  (`src/app/api/search/route.ts`). */
const SEARCH_PATH = "/api/search";

export const apiSearchFetcher: SearchFetcher = ({
  q,
  scope,
  containerId,
  signal,
}) =>
  apiRequest<SearchResponse>(SEARCH_PATH, {
    // ⚠ `undefined` KEYS ARE STRIPPED by the shared query builder, so an
    // account-scoped call sends no `container` at all rather than an empty one.
    query: { q, scope, container: scope === "container" ? containerId : undefined },
    signal,
  });
