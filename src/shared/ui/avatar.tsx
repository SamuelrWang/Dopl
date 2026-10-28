"use client";

/**
 * Avatar — profile picture with a neutral initials fallback (kit).
 * No gradients: identity colour in this app belongs to teams, not people.
 */

import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";
import type { AvatarScale } from "./avatar-size";

export interface AvatarPerson {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/** The avatar scale (`avatar-size.ts › AVATAR_PX`): xs 16, s 20, m 30, l 40. */
const SIZE = {
  xs: "w-4 h-4 text-micro",
  s: "w-5 h-5 text-micro",
  m: "w-7.5 h-7.5 text-caption",
  l: "w-10 h-10 text-body",
} as const satisfies Record<AvatarScale, string>;

export function initialFor(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

export type AvatarSize = AvatarScale;

export function Avatar({
  person,
  size = "m",
  className,
}: {
  person: AvatarPerson;
  size?: AvatarSize;
  className?: string;
}) {
  // ⚠ OAuth avatars sit on provider CDNs the packaged desktop CSP cannot name;
  // that renderer gets the bytes from main as a `data:` URI. Undefined (pending
  // or refused) falls through to initials.
  const src = useBridgedImageSrc(person.avatarUrl);

  if (src) {
    return (
      <span
        className={cn(
          // `block`, or the size utilities are dead letters: an inline span
          // ignores width/height, and the img inside then renders at natural
          // size. The initials branch never hit this because `flex` blockifies.
          "block shrink-0 overflow-hidden rounded-full",
          SIZE[size],
          className
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={person.displayName || person.email || "Member"}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset font-semibold text-text-secondary",
        SIZE[size],
        className
      )}
    >
      {initialFor(person.displayName, person.email)}
    </span>
  );
}
