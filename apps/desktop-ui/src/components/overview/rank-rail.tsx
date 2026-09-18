import type { ReactNode } from "react";

/**
 * THE COMPARISON RAIL AND ITS CARD — the one recipe both Overviews draw their
 * breakdowns with (wave 8, R-29(b)).
 *
 * ⚠ **EXTRACTED FROM `pages/home/overview-rails.tsx`, UNCHANGED.** /home's four
 * rails still pass their own rows, labels and empty lines; what moved is the
 * bar geometry and the card frame, so the workspace Overview's three rails could
 * not become a second recipe for one picture. R-40 keeps /home's face
 * byte-identical: this is a seam, not a restyle.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer paragraphs.
 */

export interface RankRow {
  id: string;
  name: string;
  value: number;
  /** Optional trailing chip — the guest marker, and nothing else so far. */
  tag?: string;
}

/**
 * A comparison rail: name, bar, figure, on ONE line.
 *
 * ⚠ **NOT `UsageMeter`.** That primitive is the "used / limit" recipe — a
 * stacked label row over a `.concave-track` well — and /home has ruled that
 * nothing on it is pressed in (docs/DESIGN-SYSTEM.md). The track is a flat
 * `bg-bg-inset`, the fill the flat CTA ink; both plain tokens.
 *
 * ⚠ THE BAR IS RELATIVE TO THE TOP ROW, NOT TO A TOTAL, and the figure beside
 * it is the absolute count — so the rail is a comparison and the number is the
 * measurement. A percentage of a SCANNED denominator drawn without it beside is
 * exactly what a payload's `scanned` field exists to prevent.
 */
export function RankRail({ rows, empty }: { rows: RankRow[]; empty: string }) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return <p className="mt-3 text-caption text-text-muted">{empty}</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3">
          <span className="flex w-28 shrink-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-body text-text-primary">
              {row.name}
            </span>
            {row.tag && (
              <span className="shrink-0 rounded-full bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
                {row.tag}
              </span>
            )}
          </span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-inset">
            <span
              className="block h-full rounded-full bg-surface-cta"
              style={{ width: `${Math.round((row.value / top) * 100)}%` }}
            />
          </span>
          <span className="w-12 shrink-0 text-right font-mono text-micro tabular-nums text-text-secondary">
            {row.value.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RailCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bento flex flex-col p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
        {meta}
      </div>
      {children}
    </section>
  );
}

/**
 * The clipped notice for this surface family.
 *
 * ⚠ §9: a read AT its ceiling is indistinguishable from an exhausted one, so it
 * SAYS SO, beside the sections it clipped and never in a footer. ⚠ It may not
 * promise another read as the remedy — there is no page argument here — so what
 * it honestly offers is that the rails are a floor over the newest rows.
 */
export function ClippedNote({ scanned }: { scanned: number }) {
  return (
    <p className="px-1 text-caption text-text-muted">
      Rails cover the newest {scanned.toLocaleString()} rows.
    </p>
  );
}
