import type { OverviewActivityRow } from "@/features/workspaces/types";
import { cn } from "@/shared/lib/utils";

/**
 * Chip faces by kind. Severity colours come from the token ramp, never a hex;
 * `neutral` is the design-system pill pattern (`rounded-full` +
 * `border-border-strong` + `bg-bg-inset`, flat on a card).
 */
const KIND: Record<
  OverviewActivityRow["kind"],
  { label: string; chip: string; dot: string }
> = {
  message: {
    label: "Message",
    chip: "border-border-strong bg-bg-inset text-text-secondary",
    dot: "bg-text-muted",
  },
  thread_opened: {
    label: "Thread opened",
    chip: "border-link/25 bg-link/10 text-link",
    dot: "bg-link",
  },
  thread_closed: {
    label: "Thread closed",
    chip: "border-success/25 bg-success/10 text-success",
    dot: "bg-success",
  },
};

/** `14:05` for anything from today, `3/9` before that. */
function activityTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toDateString() === now.toDateString()
    ? at.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : `${at.getDate()}/${at.getMonth() + 1}`;
}

/**
 * What the workspace has just done. Replaces the clone's "Still to come today"
 * panel, which was a schedule the product does not have; this is the same row
 * and chip language over `payload.activity` (newest first, viewer-filtered and
 * capped server-side).
 */
export function RecentActivity({ rows }: { rows: OverviewActivityRow[] }) {
  return (
    <section className="bento flex flex-col p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        Recent activity
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border-subtle">
          {rows.map((row) => {
            const kind = KIND[row.kind];
            const meta = [activityTime(row.at), row.channelName, row.actorName]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={row.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-text-primary">
                    {row.preview}
                  </p>
                  <p className="mt-0.5 truncate text-caption text-text-muted">
                    {meta}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium",
                    kind.chip
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-1.5 w-1.5 rounded-full", kind.dot)}
                  />
                  {kind.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
