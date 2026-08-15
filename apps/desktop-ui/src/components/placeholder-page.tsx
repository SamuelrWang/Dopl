/**
 * Stand-in for every unported route (`src/routes.tsx`). To port a page, write
 * the real component and repoint its row's `element`.
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
