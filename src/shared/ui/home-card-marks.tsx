import { cn } from "@/shared/lib/utils";

/**
 * The channel row's marks: the quiet-line ink, the `@ N` pill, the unread dot and the "Link out"
 * chip. One declaration each, read by /home's row (`home-channel-row.tsx`), the workspace picker
 * (`channels/components/sidebar-rows.tsx`) and the landing demo, which cannot import `apps/`.
 * On a selected (ink) row every mark inverts or dims `--text-on-cta`, never a second colour.
 */

/** A quiet line's ink: `--text-on-cta` dimmed on the ink row, `--text-muted` on a white one. */
export function rowQuietInk(selected: boolean): string {
  return selected ? "text-text-on-cta/70" : "text-text-muted";
}

/**
 * Unread mentions of the viewer, backed by `Channel.mentionCount`. Hidden at zero: an inked `@ 0`
 * claims something is waiting. `onDark` swaps the two tokens so the pill stays visible on ink.
 */
export function MentionBadge({
  count,
  onDark = false,
}: {
  count: number;
  onDark?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} unread ${count === 1 ? "mention" : "mentions"}`}
      className={cn(
        "flex h-4.5 shrink-0 items-center rounded-full px-1.5 text-micro font-medium",
        onDark
          ? "bg-text-on-cta text-surface-cta"
          : "bg-surface-cta text-text-on-cta"
      )}
    >
      @ {count}
    </span>
  );
}

/** The surface's accent: `"ink"` is /home's, `"link"` the channels picker's. */
export type UnreadDotTone = "ink" | "link";

/**
 * Something is newer than the viewer's watermark and none of it tags them: the `@ N` pill's
 * alternative, never its companion (the caller decides). `onDark` outranks `tone`.
 */
export function UnreadDot({
  onDark = false,
  tone = "ink",
}: {
  onDark?: boolean;
  tone?: UnreadDotTone;
}) {
  return (
    <span
      aria-label="Unread messages"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        onDark ? "bg-text-on-cta" : tone === "link" ? "bg-link" : "bg-text-primary"
      )}
    />
  );
}

/**
 * An invitation is out on this row (`Channel.linkOut`). A state, not a control: minting and
 * revoking a link are the record pane's.
 */
export function LinkOutChip({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 text-micro font-medium",
        onDark
          ? "border-text-on-cta/30 bg-text-on-cta/15 text-text-on-cta"
          : "border-border-strong bg-bg-inset text-text-secondary"
      )}
    >
      Link out
    </span>
  );
}
