"use client";

import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";

export interface AvatarStackUser {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Show a live "editing" dot on this avatar. */
  editing?: boolean;
  /** Ring the avatar with the success token — the agent is online / listening. */
  online?: boolean;
}

/**
 * ⚠ THREE OF THE FOUR KEYS ARE `avatar.tsx › SIZE`'s OWN KEYS AND PIXELS,
 * deliberately: a stack and a lone `Avatar` appear on the SAME row of the same
 * list (a home channel with one peer vs. three —
 * `pages/home/relationship-list.tsx`), and a stack one step off would make the
 * row change height when a second person joins. Added 2026-08-26 for that
 * surface; `xs` is the default, so the four callers that predate it are
 * byte-identical.
 *
 * ⚠ **`2xs` (20px) IS THE EXCEPTION AND HAS NO `Avatar` TWIN ON PURPOSE
 * (2026-09-13).** It exists for the /home channel row's SECOND line — a stack
 * beside an 18px badge under a `text-body` title, on a row whose height Samuel
 * fixed ("I like the current size of it"), where 24px grows the card. The rule
 * above is about a stack and a LONE avatar sharing a row; nothing renders a lone
 * `Avatar` on that line, so there is no twin for this to disagree with. **Do not
 * add a 20px key to `avatar.tsx` to "match"** — that would put a size in the
 * component the rule is measured against, for a caller that does not exist.
 *
 * ⚠ **THE OVERLAP MOVED INTO THIS MAP (same values, 2026-09-13)**, because the
 * fourth size made the ternary that held it a three-deep chain. The bite scales
 * with the face, or a `md` stack barely overlaps at all.
 */
const SIZE = {
  "2xs": { box: "h-5 w-5", text: "text-micro", dot: "h-2 w-2", bite: "-space-x-1" },
  xs: { box: "h-6 w-6", text: "text-micro", dot: "h-2 w-2", bite: "-space-x-1.5" },
  sm: { box: "h-8 w-8", text: "text-caption", dot: "h-2.5 w-2.5", bite: "-space-x-2" },
  md: { box: "h-10 w-10", text: "text-body", dot: "h-2.5 w-2.5", bite: "-space-x-2.5" },
} as const;

export type AvatarStackSize = keyof typeof SIZE;

function initials(name: string): string {
  const parts = name.split(/[\s@]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

function Avatar({
  user,
  size,
}: {
  user: AvatarStackUser;
  size: AvatarStackSize;
}) {
  // ⚠ Same proxy as `@/shared/ui/avatar`: provider-CDN avatars are unrenderable
  // in the packaged SPA until main hands them back as a `data:` URI.
  const src = useBridgedImageSrc(user.avatarUrl);
  const title = user.editing
    ? `${user.displayName} (editing)`
    : user.displayName;
  return (
    <div className="relative" title={title}>
      <div
        className={cn(
          "flex items-center justify-center rounded-full ring-2 overflow-hidden",
          SIZE[size].box,
          // Ring is presence when online, overlap separator otherwise.
          user.online ? "ring-success" : "ring-bg-elevated",
          "bg-surface-raised-4 font-semibold uppercase tracking-wide text-text-secondary",
          SIZE[size].text
        )}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={user.displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(user.displayName)
        )}
      </div>
      {user.editing && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full bg-success ring-2 ring-bg-elevated",
            SIZE[size].dot
          )}
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * Overlapping presence stack. Dedupe + ordering are the caller's job.
 *
 * ⚠ **THE OVERFLOW CHIP COUNTS WHAT IS HIDDEN, NOT THE TOTAL** — `+2` beside
 * three faces means five people. A caller that wants the total says it in text
 * beside the stack; changing this to the total would silently re-label every
 * existing caller's chip.
 *
 * ⚠ `-space-x` IS THE OVERLAP AND `ring-2` IS WHAT MAKES IT READ AS ONE. Without
 * the ring the circles merge into a blob at any size; it is a ring rather than a
 * border because a border would eat into the box and shrink the face.
 */
export function AvatarStack({
  users,
  max = 4,
  size = "xs",
}: {
  users: AvatarStackUser[];
  max?: number;
  size?: AvatarStackSize;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  return (
    <div
      className={cn("flex items-center", SIZE[size].bite)}
    >
      {shown.map((u) => (
        <Avatar key={u.userId} user={u} size={size} />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full ring-2 ring-bg-elevated bg-surface-raised-3 font-semibold text-text-tertiary",
            SIZE[size].box,
            SIZE[size].text
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
