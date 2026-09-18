import { z } from "zod";
import type { SearchScope } from "./contracts";

/** `satisfies` couples the zod enum to the union: a third scope added to
 *  `contracts.ts` and not here is a compile error, not a silent 400. */
const SEARCH_SCOPES = ["account", "container"] as const satisfies readonly SearchScope[];

/**
 * `GET /api/search`'s query params. Parsed by `shared/api/parse-json.ts ›
 * parseQuery`, never a hand-rolled `searchParams` block (§2).
 *
 * `q` is optional and an absent one is not a 400: the popup mounts before anybody
 * types, and the too-short answer is an empty 200 by contract. The
 * minimum-length rule lives in the service so it is not spelled
 * `VALIDATION_FAILED`.
 *
 * `container` is REFUSED under `scope=account`, not ignored (INVARIANTS §4A) — a
 * scoping parameter that silently does nothing gives one endpoint two answers.
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

/** The keys `parseQuery` lifts off the URL. Listed, so a param nobody reads
 *  cannot arrive by accident. */
export const SEARCH_QUERY_KEYS = ["q", "scope", "container"] as const;
