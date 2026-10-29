/**
 * The one LIST convention for every public list route (`GET /events`, webhook endpoints and
 * deliveries, …), ruled 2026-10-28.
 *
 *   query:    `cursor` (opaque, base64url) + `limit` (1–100, default 50)
 *   response: `{ data: T[], next_cursor: string | null, has_more: boolean }`
 *
 * The cursor is OPAQUE to clients: they pass back the `next_cursor` they were given and nothing
 * else. Its content is the server's business and the server validates it strictly after decoding;
 * the contract only fixes its alphabet and length, so a malformed one is `invalid_request` before
 * it reaches a query. `has_more` is true exactly when `next_cursor` is set.
 */
import { z } from "zod";

export const LIST_LIMIT_MIN = 1;
export const LIST_LIMIT_MAX = 100;
export const LIST_LIMIT_DEFAULT = 50;

/** base64url alphabet, no padding. 512 chars is far above any cursor the server writes. */
export const ListCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/, "cursor must be an opaque base64url string");

/** Query params as they arrive (strings). `limit` is coerced and bounded. */
export const ListQuerySchema = z.object({
  cursor: ListCursorSchema.optional(),
  limit: z.coerce.number().int().min(LIST_LIMIT_MIN).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

/** The response envelope around any list item schema. */
export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z
    .object({
      data: z.array(item),
      next_cursor: ListCursorSchema.nullable(),
      has_more: z.boolean(),
    })
    .refine((page) => page.has_more === (page.next_cursor !== null), {
      message: "has_more must be true exactly when next_cursor is set",
      path: ["has_more"],
    });
}

export interface ListResponse<T> {
  data: T[];
  next_cursor: string | null;
  has_more: boolean;
}
