import { z } from "zod";
import type { SearchScope } from "./contracts";

/** ⚠ `satisfies` COUPLES THE ZOD ENUM TO THE UNION — a third scope added to
 *  `contracts.ts` and not here is a compile error, not a silent 400. */
const SEARCH_SCOPES = ["account", "container"] as const satisfies readonly SearchScope[];

/**
 * `GET /api/search`'s query params. Parsed by `shared/api/parse-json.ts ›
 * parseQuery`, never by a hand-rolled `searchParams` block (§2 — four copies
 * once disagreed on `??` vs `||`).
 *
 * ⚠ **`q` IS OPTIONAL AND AN ABSENT ONE IS NOT A 400.** The popup mounts before
 * anybody types, and the too-short answer is an EMPTY 200 by contract; a
 * required param would make the first paint an error. The minimum-length rule
 * lives in the service, not here, for exactly that reason — a zod `.min(2)`
 * would spell it as `VALIDATION_FAILED`.
 *
 * ⚠ **`container` IS REFUSED UNDER `scope=account`, NOT IGNORED.** A scoping
 * parameter that silently does nothing is the mistake `GET /api/home/overview`
 * had surgically removed (INVARIANTS §4A) — it gives one endpoint two answers to
 * the question it exists to answer whole. A caller that wants one container says
 * so with `scope=container`.
 */
export const SearchQuerySchema = z
  .object({
    q: z.string().optional(),
    scope: z.enum(SEARCH_SCOPES).default("account"),
    container: z.string().uuid().optional(),
  })
  .refine((v) => v.scope !== "container" || v.container !== undefined, {
    message: "scope=container requires container=<workspaceId>",
    path: ["container"],
  })
  .refine((v) => v.scope !== "account" || v.container === undefined, {
    message: "container is only meaningful with scope=container",
    path: ["container"],
  });

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** The keys `parseQuery` lifts off the URL. ⚠ Listed, so a param nobody reads
 *  cannot arrive by accident. */
export const SEARCH_QUERY_KEYS = ["q", "scope", "container"] as const;
