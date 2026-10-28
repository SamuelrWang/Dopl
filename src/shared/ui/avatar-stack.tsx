"use client";

import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";
import { initialFor } from "./avatar";
import { IdentityFace, type IdentityFaceProps } from "./identity-face";
import type { AvatarScale } from "./avatar-size";

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
 * The avatar scale (`avatar-size.ts`), so a stack and a lone `Avatar` on one row stand the same
 * height. The overlap scales with the face, or an `l` stack barely overlaps at all.
 */
const SIZE = {
  xs: { box: "h-4 w-4", text: "text-micro", dot: "h-1.5 w-1.5", bite: "-space-x-1" },
  s: { box: "h-5 w-5", text: "text-micro", dot: "h-2 w-2", bite: "-space-x-1" },
  m: { box: "h-7.5 w-7.5", text: "text-caption", dot: "h-2.5 w-2.5", bite: "-space-x-2" },
  l: { box: "h-10 w-10", text: "text-body", dot: "h-2.5 w-2.5", bite: "-space-x-2.5" },
} as const satisfies Record<AvatarScale, unknown>;

export type AvatarStackSize = keyof typeof SIZE;

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
          initialFor(user.displayName, null)
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
 * Overlapping PRESENCE stack (an `editing` dot, a presence ring) for the collaborative surfaces:
 * the knowledge and skill editors, teams, search rows and the channel sidebar. Identity faces are
 * {@link IdentityStack}. Dedupe + ordering are the caller's job.
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
  size = "s",
}: {
  /** ⚠ `readonly` so a caller holding a frozen or readonly roster hands it over
   *  directly — this component only reads it, and a defensive `[...users]` at
   *  every call site is a copy per row per render. */
  users: readonly AvatarStackUser[];
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

export type IdentityStackFace = Omit<IdentityFaceProps, "size" | "px" | "label" | "className"> & {
  key: string;
};

/**
 * The identity look's stack: {@link IdentityFace}s overlapping by 6px, then a muted `+N` that,
 * as above, counts what is hidden. `label` names the whole stack (and is its tooltip); without it
 * the stack is decorative.
 */
export function IdentityStack({
  faces,
  size,
  max = faces.length,
  label,
}: {
  faces: readonly IdentityStackFace[];
  size: AvatarScale;
  max?: number;
  label?: string;
}) {
  if (faces.length === 0) return null;
  const shown = faces.slice(0, max);
  const overflow = faces.length - shown.length;
  const a11y = label
    ? { role: "img" as const, "aria-label": label, title: label }
    : { "aria-hidden": true };
  return (
    <span {...a11y} className="inline-flex flex-none items-center">
      {shown.map(({ key, ...face }, i) => (
        <IdentityFace key={key} size={size} {...face} className={i > 0 ? "-ml-1.5" : undefined} />
      ))}
      {overflow > 0 && <span className="ml-0.75 text-label text-text-muted">+{overflow}</span>}
    </span>
  );
}
