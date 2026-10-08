import "server-only";

/**
 * **THE PUSH KEEPS WORKING ON A DATABASE WITHOUT `channel_sessions.color_shared`** (2026-10-08).
 *
 * The column comes from `20261115120000_agent_color_shared.sql`, and nothing in the deploy pipeline
 * applies a migration before the web build goes live: they are applied by hand, by name
 * (docs/INVARIANTS.md, the hot-path column rule). Without this module a web deploy that beats the
 * migration turns EVERY desktop session push into a 500. With it, an old database simply has no
 * full-bank reuse: every row reads as exclusive, a would-be shared row goes uncoloured (the old
 * behaviour), and the push succeeds.
 *
 * - Detection is the ERROR, never a schema probe: Postgres `42703` (undefined column) or
 *   PostgREST `PGRST204` (column not in the schema cache), naming `color_shared`.
 * - Once seen, the legacy shape is used straight away for {@link RECHECK_MS}, so an old database
 *   costs one failed round trip per window rather than one per push; after the window the full
 *   shape is tried again, so applying the migration heals without a deploy.
 */

const COLUMN = "color_shared";
const RECHECK_MS = 5 * 60 * 1000;

let missingUntil = 0;
let now: () => number = () => Date.now();

/** True when `error` says the database has no `color_shared` column. */
export function isMissingColorShared(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (e.code !== "42703" && e.code !== "PGRST204") return false;
  return [e.message, e.details, e.hint].some((s) => String(s ?? "").includes(COLUMN));
}

/** Whether the legacy (no-column) shape is in force right now. */
export function colorSharedKnownMissing(): boolean {
  return now() < missingUntil;
}

/** Record that the column is missing; the full shape is retried after the window. */
export function noteColorSharedMissing(): void {
  missingUntil = now() + RECHECK_MS;
}

/**
 * Run a SELECT with the full column list, falling back to `legacyColumns` when the column is
 * missing. `run` builds and awaits the query for a given column list.
 */
export async function selectTolerant<R>(
  fullColumns: string,
  legacyColumns: string,
  run: (columns: string) => PromiseLike<{ data: R | null; error: unknown }>
): Promise<{ data: R | null; error: unknown }> {
  if (colorSharedKnownMissing()) return run(legacyColumns);
  const first = await run(fullColumns);
  if (!first.error || !isMissingColorShared(first.error)) return first;
  noteColorSharedMissing();
  return run(legacyColumns);
}

/**
 * Rows fit for an upsert into the database as it is: unchanged when the column exists; otherwise
 * `color_shared` is removed, and a row that was going to SHARE a key goes uncoloured instead (the
 * old unique index would refuse it).
 */
export function fitColorShared<T extends { color?: unknown; color_shared?: unknown }>(
  rows: T[]
): T[] {
  if (!colorSharedKnownMissing()) return rows;
  return rows.map((row) => {
    const { color_shared: shared, ...rest } = row;
    return (shared === true ? { ...rest, color: null } : rest) as T;
  });
}

/** Test seam: forget what was seen and pin the clock. */
export function __resetColorSharedCompatForTests(clock?: () => number): void {
  missingUntil = 0;
  now = clock ?? (() => Date.now());
}
