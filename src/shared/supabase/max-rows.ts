import "server-only";

/**
 * THE ROW CEILING POSTGREST APPLIES WHETHER OR NOT WE ASK FOR ONE, and the two
 * shapes that survive it: an HONEST clip marker, and a RANGE LOOP.
 *
 * 🔒 **IT IS A WRONG ANSWER THIS MODULE REMOVES, NOT A SLOW ONE** — the
 * distinction `20261118120000_home_credit_usage_bins_rpc.sql` draws, now one
 * layer down because the same bug was found at six call sites across four
 * features (Samuel #2935 → the sweep). `supabase/config.toml › max_rows` clips
 * every PostgREST select server-side and **raises nothing**; a `.limit(n)` above
 * it is not the bound, it is a request the server silently declines.
 *
 * ⚠ **WHY IT LIVES IN `shared/` AND NOT IN A FEATURE.** The constant was born in
 * `home/server/repository-overview.ts` (its original reader re-exports it still),
 * but §2 forbids one feature importing another's repository, so a second reader
 * meant a second copy — and a ceiling copied per feature is a ceiling that goes
 * stale per feature. `max-rows.test.ts` pins this number against
 * `supabase/config.toml`, so raising the server setting cannot leave it behind.
 *
 * ⚠ **A HONEST MARKER IS THE WEAKER HALF AND IS NOT A LICENCE TO HAUL.** Where a
 * read exists to be SUMMED or GROUPED, the fix is an aggregate in SQL and the
 * ceiling stops being reachable; where it exists to be LISTED, the fix is
 * {@link readAllPages}. {@link clippedAt} is for what is left: a read that still
 * hauls, now saying so.
 */

/**
 * 🔒 **`supabase/config.toml › max_rows`.** Pinned against that file by
 * `max-rows.test.ts` rather than restated from memory.
 *
 * ⚠ **IT EXISTS BECAUSE `truncated` LIED (Samuel #2935, 2026-10-10).** Four
 * `clipped()` helpers compared row count against the ASKED limit, so a read
 * asking 20,000 and receiving the server's 1,000 computed `1000 >= 20000` =
 * false and reported itself COMPLETE. The /home histogram drew ~1,000 credits —
 * all of them the newest day — beside a spend card reading the month's true
 * 4,288, and no clip banner fired on the one read that was actually a floor.
 */
export const POSTGREST_MAX_ROWS = 1_000;

/** A read that came back AT its effective ceiling is a FLOOR, and says so (§9). */
export interface Clipped<T> {
  rows: T[];
  truncated: boolean;
}

/**
 * THE EFFECTIVE CEILING IS THE SMALLER OF THE TWO, never the asked one.
 *
 * ⚠ Export it so a caller that must compute a page size, a denominator or a
 * warning threshold reads the same arithmetic the marker does, instead of
 * `Math.min`-ing against the constant itself and drifting.
 */
export function effectiveCeiling(limit: number): number {
  return Math.min(limit, POSTGREST_MAX_ROWS);
}

/**
 * `{ rows, truncated }` with `truncated` measured against {@link effectiveCeiling}.
 *
 * ⚠ **AT the ceiling counts as clipped even when the set was exactly that long.**
 * The house rule, unchanged: a read at its ceiling is indistinguishable from an
 * exhausted one, so it reports the pessimistic reading rather than guessing the
 * lucky one.
 */
export function clippedAt<T>(rows: T[], limit: number): Clipped<T> {
  return { rows, truncated: rows.length >= effectiveCeiling(limit) };
}

/** What a PostgREST page answers, narrowed to the two fields this loop reads. */
export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * EVERY ROW OF A LIST READ, FETCHED IN PAGES THE SERVER WILL ACTUALLY RETURN.
 *
 * 🔒 **FOR A READ WHOSE ANSWER IS THE LIST ITSELF** — an object graph, a
 * membership set — where an aggregate cannot help because nothing is being
 * summed. A clipped graph does not merely under-report: it renders as a SMALLER
 * GRAPH, with edges pointing at objects that appear not to exist.
 *
 * ⚠ **`buildPage` MUST BUILD A FRESH QUERY EACH CALL.** A Supabase query builder
 * is a one-shot thenable; re-awaiting one re-sends the first range and this loop
 * would spin on page 0 forever.
 *
 * ⚠ **THE CALLER'S ORDER MUST BE TOTAL AND STABLE, AND THAT IS ON THE CALLER.**
 * Paging a non-unique ORDER BY lets Postgres return a row twice and skip
 * another between pages, so the order column is either unique or tie-broken by
 * `id`. An unordered page loop is the worst version of this: it is allowed to
 * return any permutation per page.
 * ⚠ It is also NOT a snapshot — a concurrent insert during the walk can be seen
 * or missed. Correct for the admin/graph reads that use it, and never for a read
 * whose claim is "exactly this many".
 *
 * ⚠ **`hardCap` IS STILL A CEILING AND STILL REPORTED.** It bounds a runaway
 * walk (an import, an agent loop); reaching it returns `truncated: true`. The
 * difference from a bare `.limit(hardCap)` is that the rows up to it are now all
 * actually fetched instead of being silently cut at 1,000.
 */
export async function readAllPages<T>(
  buildPage: (from: number, toInclusive: number) => PromiseLike<PageResult<T>>,
  opts: { hardCap: number; pageSize?: number }
): Promise<Clipped<T>> {
  const pageSize = effectiveCeiling(
    Math.max(1, Math.floor(opts.pageSize ?? POSTGREST_MAX_ROWS))
  );
  const rows: T[] = [];
  for (let from = 0; from < opts.hardCap; from += pageSize) {
    // ⚠ The LAST page is narrowed to the cap, so the walk never fetches rows it
    // would immediately discard — and `want` is what a short page is measured
    // against, which is why it is computed rather than assumed to be `pageSize`.
    const want = Math.min(pageSize, opts.hardCap - from);
    const { data, error } = await buildPage(from, from + want - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    // ⚠ **A SHORT PAGE IS THE ONLY PROOF OF EXHAUSTION, and it is proof only
    // because `want` never exceeds the server ceiling** — ask 1,000 or fewer and
    // a short answer is the table's, not `max_rows`'s. This is the whole reason
    // the page size is clamped above.
    if (page.length < want) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
