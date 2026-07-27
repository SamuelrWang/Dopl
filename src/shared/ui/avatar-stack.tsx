"use client";

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

function initials(name: string): string {
  const parts = name.split(/[\s@]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name[0] || "?").toUpperCase();
}

function Avatar({ user }: { user: AvatarStackUser }) {
  const title = user.editing
    ? `${user.displayName} (editing)`
    : user.displayName;
  return (
    <div className="relative" title={title}>
      <div
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full ring-2 overflow-hidden",
          // Online members get a success presence ring; the ring otherwise
          // doubles as the overlap separator against the surface behind.
          user.online ? "ring-success" : "ring-bg-elevated",
          "bg-surface-raised-4 text-micro font-semibold uppercase tracking-wide text-text-secondary"
        )}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.displayName}
            className="h-full w-full object-cover"
          />
        ) : (
          initials(user.displayName)
        )}
      </div>
      {user.editing && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-bg-elevated"
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * Overlapping avatar stack for presence ("who's here"). Renders nothing
 * when empty. Dedupe + ordering are the caller's responsibility.
 */
export function AvatarStack({
  users,
  max = 4,
}: {
  users: AvatarStackUser[];
  max?: number;
}) {
  if (users.length === 0) return null;
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((u) => (
        <Avatar key={u.userId} user={u} />
      ))}
      {overflow > 0 && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-bg-elevated bg-surface-raised-3 text-micro font-semibold text-text-tertiary">
          +{overflow}
        </div>
      )}
    </div>
  );
}
