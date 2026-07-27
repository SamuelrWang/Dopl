"use client";

/**
 * AvatarWithPresence — an {@link Avatar} wrapped in a presence ring: a
 * success-token ring when the member's agent is online / listening, a muted
 * ring when it is offline. The ring sits just outside the avatar via a
 * transparent `p-0.5` gap, so it reads as a floating ring on ANY surface
 * (including row-hover states) without needing a ring-offset color that must
 * match the background.
 *
 * Design-system recipe: `ring-2 ring-success` (online) / `ring-text-disabled`
 * (offline) — status tokens only, no hardcoded green. Prefer this over the
 * standalone `PresenceDot` wherever an avatar is present; the dot stays as a
 * fallback for dense, avatar-less spots (e.g. the composer's "To" chip).
 *
 * The presence ring is a colour cue, so the wrapper also carries a non-colour
 * accessible name (`role="img"` + `aria-label`) that states the member and
 * their online / offline state. That keeps presence perceivable without relying
 * on the ring colour anywhere this component is used (session card included).
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
