import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import type { PageParams } from "@/shared/types/paginated";

/**
 * Parse `?cursor=&limit=` from a route request URL. `limit` is clamped
 * to [1, maxLimit]; a non-numeric limit is a 400.
 *
 * No consumer yet by design: this is the sanctioned pagination shape
 * (ENGINEERING §7/§15) — the first paginated list route adopts it
 * (chat transcripts are the expected first customer, see F-027).
 */
export function parsePageParams(
  url: URL,
  { defaultLimit, maxLimit }: { defaultLimit: number; maxLimit: number }
): PageParams {
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const rawLimit = url.searchParams.get("limit");
  if (rawLimit === null) return { cursor, limit: defaultLimit };
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1) {
    throw HttpError.badRequest("limit must be a positive integer");
  }
  return { cursor, limit: Math.min(limit, maxLimit) };
}
