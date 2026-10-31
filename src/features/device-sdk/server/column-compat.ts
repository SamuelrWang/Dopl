import "server-only";

/**
 * A HOT-PATH WRITE KEEPS WORKING ON A DATABASE WITHOUT ITS NEW COLUMNS (docs/INVARIANTS.md §12).
 *
 * Migrations are applied by hand, so a web build can go live first. Without this, one missing column
 * loses a whole `dev_events` batch, or fails the glasses' inbox on `dev_actions`.
 *
 * - Detection is the ERROR, never a schema probe: Postgres `42703` or PostgREST `PGRST204`, naming a column.
 * - Once seen, the columns are dropped from writes for {@link RECHECK_MS}, so an old database costs one
 *   failed round trip per window. After the window the full shape is tried again, so applying the
 *   migration heals without a deploy.
 */

export const RECHECK_MS = 5 * 60 * 1000;

export interface ColumnCompat {
  /** True when `error` says the database lacks one of these columns. */
  isMissing(error: unknown): boolean;
  /** The row to write right now: without the columns while they are known missing. */
  shape<T extends object>(row: T): T;
  /** The row without the columns, and start the window. */
  fallback<T extends object>(row: T): T;
}

export function createColumnCompat(columns: readonly string[], now: () => number = Date.now): ColumnCompat {
  let missingUntil = 0;
  const strip = <T extends object>(row: T): T => {
    const out = { ...row } as Record<string, unknown>;
    for (const c of columns) delete out[c];
    return out as T;
  };
  return {
    isMissing(error) {
      if (typeof error !== "object" || error === null) return false;
      const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
      if (e.code !== "42703" && e.code !== "PGRST204") return false;
      const text = [e.message, e.details, e.hint].map((s) => String(s ?? "")).join(" ");
      return columns.some((c) => text.includes(c));
    },
    shape: (row) => (now() < missingUntil ? strip(row) : row),
    fallback(row) {
      missingUntil = now() + RECHECK_MS;
      return strip(row);
    },
  };
}

/** `dev_actions.delivered_at`, `settled_at` (`20261125100000_dev_portal_log_fields.sql`). */
export const actionTimeColumns = createColumnCompat(["delivered_at", "settled_at"]);
