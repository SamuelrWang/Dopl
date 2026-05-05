"use client";

import { Avatar } from "@/features/members/components/member-bits";

interface UserMessageHeaderProps {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Header rendered above each user-side message in the private chat.
 * Right-aligned to mirror the AI-side header on the left. Falls back
 * to the email handle (before the @) when no display name is set, and
 * to the gradient-initials avatar when no profile picture exists.
 */
export function UserMessageHeader({
  userId,
  email,
  displayName,
  avatarUrl,
}: UserMessageHeaderProps) {
  const name = displayName || (email ? email.split("@")[0] : "You");
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="text-[12px] font-medium uppercase tracking-wider text-text-primary">
        {name}
      </span>
      <Avatar
        person={{ userId, email, displayName, avatarUrl }}
        size="xs"
        className="rounded-md"
      />
    </div>
  );
}
