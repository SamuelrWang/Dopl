import { z } from "zod";
import { REVISION_PAGE_MAX } from "./constants";

/**
 * Wire schemas for the changelog routes.
 *
 * ⚠ **THE PAGE ARGUMENTS ARE VALIDATED, NOT CLAMPED SILENTLY.** A `limit` of
 * `"all"` is a 400; a `limit` of 5,000 is a 400 too. Quietly rounding a caller's
 * number down and answering 200 rows under a header that says nothing is the
 * clip-passing-as-an-absence failure INVARIANTS §9 refuses — the service clamps
 * a MISSING limit to a default, which is a different act.
 */
export const RevisionQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().positive().max(REVISION_PAGE_MAX).optional(),
});

/**
 * The keys the routes hand `shared/api/parse-json.ts › parseQuery`.
 *
 * ⚠ **THE PARSE IS `parseQuery`, NOT A HAND-ROLLED BLOCK.** Four hand-written
 * `searchParams → safeParse → throw` copies once drifted on `||` vs `??` and one
 * of them turned a filter into "no filter" (that module's docblock carries the
 * incident). A fifth copy here would be the same bet taken again — and it is the
 * shared helper that turns a zod failure into the 400 this schema's own docblock
 * promises.
 */
export const REVISION_QUERY_KEYS = ["cursor", "limit"] as const;
