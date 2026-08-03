/**
 * The stand-in every unported route renders (see `src/routes.tsx`). ONE
 * component rather than 14 identical files — porting a page means writing the
 * real component and pointing its row's `element` at it, then this stops
 * rendering for that route.
 *
 * Token classes only, no hand-rolled values (docs/DESIGN-SYSTEM.md).
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
