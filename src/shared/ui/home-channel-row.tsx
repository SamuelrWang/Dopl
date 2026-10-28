import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { MentionBadge, UnreadDot, rowQuietInk } from "@/shared/ui/home-card-marks";
import { StatusPill } from "@/shared/ui/status-pill";

/**
 * One row of /home's channel list, every derivation already done. It lives in root `src/`
 * because the landing demo authors its rows as {@link HomeChannelRowFacts} and cannot import
 * `apps/`. The props are answers, not a payload: `channelTitle`, `channelPeople`, `hasLinkOut`
 * and the `?? EMPTY_X` cache fallbacks (INVARIANTS §8) stay with the SPA's reader.
 */

/** One face on line two. `displayName` is non-null: it is the face's initial and the stack's label. */
export interface HomeChannelRowFace {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Everything the row says, already decided by whoever holds the data. */
export interface HomeChannelRowFacts {
  /** The channel's own name, never derived from the roster; a link row wears its label. */
  name: string;
  /** ISO, through `formatChannelTimestamp`. */
  at: string;
  /** Everybody else in the channel, capped at 3 by the stack. Empty is a solo channel. */
  faces: readonly HomeChannelRowFace[];
  /** The channel's topic, `""` when unset. */
  description: string;
  /** An invitation is out: the "Invited" pill at the row's right edge. */
  linkOut: boolean;
  /** An unclaimed link row: dimmed title. */
  pending: boolean;
  /** A link row's second line; null for every channel row (no last-message preview). */
  pendingLine: string | null;
  unread: boolean;
  /** Unread mentions of the viewer; `0` draws no badge. */
  mentions: number;
}

/** A white card on the shell; the selected row is the same card in solid ink, so nothing moves. */
const ROW_FACE = "white-card raise border-border-subtle";
const ROW_SELECTED = "border-surface-cta bg-surface-cta";

/**
 * The row: a real button. No leading glyph: a channel is not a DM and its icon must not follow
 * its membership. A solo channel's description takes line two where the faces would be.
 */
export function HomeChannelRow({
  row,
  selected,
  onSelect,
}: {
  row: HomeChannelRowFacts;
  selected: boolean;
  onSelect: () => void;
}) {
  const showDescription = row.faces.length === 0 && row.description.length > 0;
  const quiet = rowQuietInk(selected);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        ROW_FACE,
        selected && ROW_SELECTED,
        "flex w-full cursor-pointer flex-col gap-1 px-2.75 py-2.25 text-left"
      )}
    >
      <span className="flex min-h-4.5 w-full items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-body",
            selected ? "font-semibold text-text-on-cta" : "font-medium text-text-primary",
            row.pending && "opacity-60"
          )}
        >
          {row.name}
        </span>
        <span className={cn("shrink-0 text-micro", quiet)}>
          {formatChannelTimestamp(row.at)}
        </span>
      </span>
      <span className="flex min-h-4.5 w-full items-center gap-1.5">
        {row.pendingLine && (
          <span className={cn("truncate text-caption", quiet)}>{row.pendingLine}</span>
        )}
        {row.faces.length > 0 && (
          <IdentityStack
            size={20}
            max={3}
            faces={row.faces.map((f) => ({ key: f.userId, photo: f.avatarUrl, name: f.displayName }))}
            label={row.faces.map((f) => f.displayName).join(", ")}
          />
        )}
        {showDescription && (
          <span className={cn("min-w-0 truncate text-caption", quiet)}>
            {row.description}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {row.mentions === 0 && row.unread && <UnreadDot onDark={selected} />}
          <MentionBadge count={row.mentions} onDark={selected} />
          {row.linkOut && <StatusPill onDark={selected}>Invited</StatusPill>}
        </span>
      </span>
    </button>
  );
}
