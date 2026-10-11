/**
 * The `*` route's "Not found" page, and the fallback for a `WORKSPACE_PAGES` row with no
 * `element` (`src/routes.tsx`; every row has one today).
 */
export function PlaceholderPage({
  title,
  note,
}: {
  title: string;
  note?: string;
}) {
  return (
    <div className="page-float flex flex-1 flex-col items-center justify-center gap-2">
      <h1 className="text-display text-text-primary">{title}</h1>
      <p className="text-caption text-text-muted">
        {note ?? "Not ported yet."}
      </p>
    </div>
  );
}
