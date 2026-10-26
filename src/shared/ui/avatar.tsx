"use client";

/**
 * Avatar — profile picture with a neutral initials fallback (kit).
 * No gradients: identity colour in this app belongs to teams, not people.
 */

import { useBridgedImageSrc } from "@/shared/hooks/use-bridged-image-src";
import { cn } from "@/shared/lib/utils";

export interface AvatarPerson {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

const SIZE = {
  xs: "w-6 h-6 text-micro",
  px30: "w-[30px] h-[30px] text-caption",
  sm: "w-8 h-8 text-caption",
  px36: "w-9 h-9 text-small",
  md: "w-10 h-10 text-body",
} as const;

export function initialFor(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

export type AvatarSize = keyof typeof SIZE;

export function Avatar({
  person,
  size = "sm",
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
