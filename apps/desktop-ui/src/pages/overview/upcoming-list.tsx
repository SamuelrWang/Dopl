import { cn } from "@/shared/lib/utils";
import { UPCOMING_LABEL, UPCOMING_ROWS, type ChipTone } from "./overview-data";

/**
 * Chip faces by tone. Severity colours come from the token ramp, never a hex;
 * `neutral` is the design-system pill pattern (`rounded-full` +
 * `border-border-strong` + `bg-bg-inset`, flat on a card).
 */
const CHIP_TONE: Record<ChipTone, { chip: string; dot: string }> = {
  info: { chip: "border-link/25 bg-link/10 text-link", dot: "bg-link" },
  neutral: {
    chip: "border-border-strong bg-bg-inset text-text-secondary",
    dot: "bg-text-muted",
  },
  caution: {
    chip: "border-warning/30 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
};

/** What the workspace still has queued for the rest of today. */
export function UpcomingList() {
  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        {UPCOMING_LABEL}
      </h2>
      <ul className="mt-1 divide-y divide-border-subtle">
        {UPCOMING_ROWS.map((row) => {
          const tone = CHIP_TONE[row.tone];
          return (
            <li
              key={`${row.time}-${row.name}`}
              className="flex items-center gap-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-text-primary">
                  {row.name}
                </p>
                <p className="mt-0.5 truncate text-caption text-text-muted">
                  {row.time} · {row.owner}
                </p>
              </div>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium",
                  tone.chip
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn("h-1.5 w-1.5 rounded-full", tone.dot)}
                />
                {row.status}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
