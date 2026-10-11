import "server-only";
import { readAllPages, type Clipped } from "@/shared/supabase/max-rows";

/**
 * THE ONE SHAPE EVERY ONTOLOGY LIST READ TAKES (Samuel #2935, 2026-10-10).
 *
 * 🔒 **IT EXISTS BECAUSE `max_rows` CLIPPED NINE READS AND RAISED NOTHING.**
 * `supabase/config.toml › max_rows = 1000` bounds every PostgREST select
 * server-side, so `.limit(ONTOLOGY_READ_LIMITS.memberships)` was never a bound —
 * it was a request the server silently declined. `repository.ts`'s header
 * carries the finding; this module is the mechanism, in one copy, because nine
 * hand-rolled page loops are nine chances for one of them to quietly stop
 * paging.
 *
 * ⚠ **`build` MUST RETURN A FRESH QUERY EVERY CALL.** A Supabase builder is a
 * one-shot thenable: re-awaiting one re-sends range 0, and the walk spins on
 * page 0 forever. Pass a factory, never a built query.
 *
 * ⚠ **AND THE QUERY'S ORDER MUST BE TOTAL** — `.order("id")` last, on top of
 * whatever display order the read wants. Paging a non-unique ORDER BY lets
 * Postgres hand one row back twice and skip another between pages, which is the
 * one failure here that looks like data rather than like a bug.
 */
export function walkedRead<T>(
  build: (from: number, toInclusive: number) => PromiseLike<{
    data: unknown;
    error: unknown;
  }>,
  hardCap: number
): Promise<Clipped<T>> {
  return readAllPages<T>(
    async (from, to) => {
      const { data, error } = await build(from, to);
      // ⚠ `null` data with no error reads as a SHORT page, which is exactly the
      // old `(data ?? [])` behaviour and terminates the walk honestly.
      return { data: (data ?? []) as T[], error };
    },
    { hardCap }
  );
}

/** The no-scope answer. ⚠ `truncated: false` is a CLAIM, and a true one: a read
 *  that was never issued cannot have been clipped. */
export function emptyWalk<T>(): Clipped<T> {
  return { rows: [], truncated: false };
}
