/**
 * Cursor pagination contract for list endpoints (ENGINEERING §15:
 * paginate any list query that can exceed ~50 rows).
 *
 * Routes accept `?cursor=<opaque>&limit=<n>` and respond with
 * `Paginated<T>`; `nextCursor: null` means the last page. The cursor is
 * opaque to clients — typically the sort key + id of the last row.
 */

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageParams {
  cursor?: string;
  limit: number;
}
