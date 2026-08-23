import type { OverviewMemberLoadRow } from "@/features/workspaces/types";

/**
 * Per-member share of the period's messages.
 *
 * ⚠ NOT `UsageMeter`. That primitive is the "used / limit" recipe — a stacked
 * label row over a `.concave-track` well, with the pair printed on the right —
 * and this is a comparison rail: name, bar and percent on ONE line, six of them
 * scanned against each other. Using it would force six two-line meters and lose
 * the shape. Nothing recessed is forked here: the track is a flat `bg-bg-inset`
 * and the fill the flat CTA ink, both plain tokens.
 *
 * The basis is MESSAGE SHARE, and the footnote prints the real denominator —
 * the house rule that a percentage never travels without the number under it.
 */
export function MemberLoad({
  totalMessages,
  rows,
}: {
  totalMessages: number;
  rows: OverviewMemberLoadRow[];
}) {
  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        Member load, last 30 days
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 flex-1 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-3 flex flex-1 flex-col justify-between gap-2.5">
          {rows.map((row) => (
            <li key={row.userId} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-body text-text-primary">
                {/* The server falls through display name → email → "" when no
                    profile row resolves; a blank rail label reads as a bug. */}
                {row.name || "Unknown member"}
              </span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-inset">
                <span
                  className="block h-full rounded-full bg-surface-cta"
                  style={{ width: `${row.percent}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-caption tabular-nums text-text-secondary">
                {row.percent}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-caption text-text-muted">
        Share of {totalMessages.toLocaleString()} messages, last 30 days
      </p>
    </section>
  );
}
