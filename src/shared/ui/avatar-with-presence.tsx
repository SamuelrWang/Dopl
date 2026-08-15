"use client";

/**
 * AvatarWithPresence — {@link Avatar} in a `ring-success` (online) /
 * `ring-text-disabled` (offline) ring. Status tokens only, no hardcoded green.
 * The transparent `p-0.5` gap floats the ring so it reads on ANY surface
 * (row-hover included) with no background-matched ring-offset colour.
 * Prefer over the standalone `PresenceDot` wherever an avatar is shown.
 *
 * a11y: ring colour is the only visual cue, so the wrapper carries `role="img"`
 * + an `aria-label` naming the member and their online state.
 */

import { cn } from "@/shared/lib/utils";
import { Avatar, type AvatarPerson } from "./avatar";

export function AvatarWithPresence({
  person,
  online,
  size = "xs",
  title,
  className,
}: {
  person: AvatarPerson;
  online: boolean;
  size?: "xs" | "sm" | "md";
  /** Tooltip (e.g. "Agent listening" / "Agent offline"). */
  title?: string;
  className?: string;
}) {
  const who = person.displayName || person.email || "Member";
  const presence = online ? "agent listening" : "agent offline";
  return (
    <span
      role="img"
      aria-label={`${who}, ${presence}`}
      title={title}
      className={cn(
        "inline-flex shrink-0 rounded-full p-0.5 ring-2",
        online ? "ring-success" : "ring-text-disabled",
        className
      )}
    >
      <Avatar person={person} size={size} />
    </span>
  );
}
