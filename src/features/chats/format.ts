const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Postgres DATE columns arrive as bare "YYYY-MM-DD" strings. Parsing
 * those with `new Date(iso)` lands on UTC midnight, which renders as
 * the PREVIOUS day for anyone west of UTC — so date-only strings are
 * constructed as local dates instead. Full ISO datetimes parse as-is.
 */
function parseDate(iso: string): Date {
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

export function formatDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
