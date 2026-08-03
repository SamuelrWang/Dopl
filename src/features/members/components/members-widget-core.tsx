"use client";

import { ArrowRight } from "lucide-react";
import type { LinkLike } from "@/shared/ui/link-like";
import type { WorkspaceMemberView } from "../types";
import { Avatar } from "./member-bits";

export interface MembersWidgetCoreProps {
  /** Canonical workspace segment — the "View all" target. */
  workspaceSlug: string;
  /** Null until the members fetch resolves. */
  members: WorkspaceMemberView[] | null;
  loading: boolean;
  /** Router-agnostic link — `next/link` in the web app, react-router in the SPA. */
  Link: LinkLike;
}

/**
 * The overview members panel's Next-free, fetch-free core (see
 * `./members-widget` for the web binding): total count, an overlapping avatar
 * stack (first 5), and a "View all →" link to the full members page. The list
 * is a prop because the two apps read it over different transports.
 */
export function MembersWidgetCore({
  workspaceSlug,
  members,
  loading,
  Link,
}: MembersWidgetCoreProps) {
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
