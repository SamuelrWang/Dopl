"use client";

import { BookOpen, MessagesSquare, Sparkles, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SkeletonRow } from "@/shared/ui/skeleton";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { ActivityEventRow, ActivityVerb } from "../../activity-visibility";
import { PaneError, PaneHeading } from "./bits";

const VERB_ICON: Record<ActivityVerb, LucideIcon> = {
  "member.joined": UserPlus,
  "member.invited": UserPlus,
  "member.role_changed": Users,
  "member.removed": Users,
  "team.created": Users,
  "team.member_added": Users,
  "team.member_removed": Users,
};

/** Resource icons for the verbs that will carry one once resource writes are
 *  instrumented; teams already do. */
const RESOURCE_ICON: Record<string, LucideIcon> = {
  knowledge_base: BookOpen,
  skill: Sparkles,
  chat: MessagesSquare,
  team: Users,
};

function label(row: ActivityEventRow): string {
  const meta = row.metadata as { label?: string; to?: string; via?: string };
  switch (row.verb) {
    case "member.joined":
      return meta.via === "invitation"
        ? "Accepted an invitation to the workspace"
        : "Joined the workspace";
    case "member.invited":
      return "Invited a new member";
    case "member.role_changed":
      return meta.to ? `Changed a member's role to ${meta.to}` : "Changed a member's role";
    case "member.removed":
      return "Removed a member from the workspace";
    case "team.created":
      return `Created the ${meta.label ?? "team"} team`;
    case "team.member_added":
      return `Joined the ${meta.label ?? "team"} team`;
    case "team.member_removed":
      return `Left the ${meta.label ?? "team"} team`;
  }
}

/**
 * ⚠ Already filtered by the CALLER's access, server-side
 * (`GET .../activity`). Nothing here re-filters, and nothing here counts what
 * was withheld — a count of what you cannot see still tells you it exists.
 */
export function ActivityTab({
  events,
  loading,
  error,
  onRetry,
}: {
  events: ActivityEventRow[] | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <PaneHeading
        title="Activity"
        subtitle="What this member has done in the workspace recently."
      />

      {error && !events ? (
        <PaneError title="Couldn't load activity." onRetry={onRetry} />
      ) : loading || !events ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading activity</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-caption leading-relaxed text-text-muted">
          Nothing to show. Activity on resources you do not have access to is not
          listed here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {events.map((row) => {
            const Icon =
              (row.resourceType && RESOURCE_ICON[row.resourceType]) ?? VERB_ICON[row.verb];
            return (
              <li
                key={row.id}
                className="flex items-center gap-2.5 border-b border-border-subtle py-2.5 last:border-b-0"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-inset text-text-secondary">
                  <Icon size={13} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-body leading-snug text-text-primary">
                  {label(row)}
                </span>
                <span className="shrink-0 text-caption text-text-muted">
                  {formatRelativeTime(row.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
