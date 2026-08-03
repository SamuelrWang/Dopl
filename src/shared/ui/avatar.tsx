"use client";

/**
 * Avatar — profile picture with a neutral initials fallback (kit).
 * Deterministic and quiet: initials on the inset gray, no gradients —
 * identity color in this app belongs to teams, not people.
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
  sm: "w-8 h-8 text-caption",
  md: "w-10 h-10 text-body",
} as const;

function initialFor(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

export function Avatar({
  person,
  size = "sm",
  className,
}: {
  person: AvatarPerson;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  // OAuth avatars live on provider CDNs the packaged desktop CSP cannot name,
  // so in that renderer the bytes arrive from main as a `data:` URI instead.
  // Undefined (pending, or refused) falls through to the initials below —
  // which is what this component already did for a member with no picture.
  const src = useBridgedImageSrc(person.avatarUrl);

  if (src) {
    return (
      <span
        className={cn(
          "shrink-0 overflow-hidden rounded-full",
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
