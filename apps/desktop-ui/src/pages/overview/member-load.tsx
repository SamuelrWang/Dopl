import {
  MEMBER_LOAD_FOOTNOTE,
  MEMBER_LOAD_LABEL,
  MEMBER_LOAD_ROWS,
} from "./overview-data";

/**
 * Per-member share of the period's sessions.
 *
 * ⚠ NOT `UsageMeter`. That primitive is the "used / limit" recipe — a stacked
 * label row over a `.concave-track` well, with the pair printed on the right —
 * and this is a comparison rail: name, bar and percent on ONE line, six of them
 * scanned against each other. Using it would force six two-line meters and lose
 * the shape. Nothing recessed is forked here: the track is a flat `bg-bg-inset`
 * and the fill the flat CTA ink, both plain tokens.
 */
export function MemberLoad() {
  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        {MEMBER_LOAD_LABEL}
      </h2>
      <ul className="mt-3 flex flex-1 flex-col justify-between gap-2.5">
        {MEMBER_LOAD_ROWS.map((row) => (
          <li key={row.name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-body text-text-primary">
              {row.name}
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
      <p className="mt-3 text-caption text-text-muted">{MEMBER_LOAD_FOOTNOTE}</p>
    </section>
  );
}
