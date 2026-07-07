"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMembers } from "../hooks/use-members";
import { Avatar } from "./member-bits";

interface Props {
  workspaceSlug: string;
}

/**
 * Compact members panel for the overview page. Shows the total member
 * count, an overlapping avatar stack (first 5), and a "View all →" link
 * to the full members page. Reuses `useMembers` so the avatars hydrate
 * with the same data as the full table.
 */
export function MembersWidget({ workspaceSlug }: Props) {
  const { members, loading } = useMembers(workspaceSlug);
  const list = members ?? [];
  const visible = list.slice(0, 5);
  const remaining = Math.max(0, list.length - visible.length);

  return (
    <section className="bento p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-medium text-text-primary">Members</h2>
          <p className="text-small text-text-tertiary mt-1">
            {loading
              ? "Loading…"
              : `${list.length} ${list.length === 1 ? "person" : "people"} in this workspace`}
          </p>
        </div>
        <Link
          href={`/${workspaceSlug}/members`}
          className="flex items-center gap-1 text-small text-text-tertiary hover:text-text-primary transition-colors"
        >
          View all
          <ArrowRight size={11} />
        </Link>
      </div>

      {visible.length > 0 && (
        <div className="mt-4 flex items-center">
          <div className="flex -space-x-2">
            {visible.map((m) => (
              <Avatar
                key={m.userId}
                person={m}
                size="md"
                className="ring-2 ring-[var(--panel-surface)]"
              />
            ))}
          </div>
          {remaining > 0 && (
            <span className="ml-3 text-small text-text-tertiary">
              +{remaining} more
            </span>
          )}
        </div>
      )}
    </section>
  );
}
