"use client";

import Link from "next/link";
import { useMembers } from "../hooks/use-members";
import { MembersWidgetCore } from "./members-widget-core";

interface Props {
  workspaceSlug: string;
}

/**
 * Compact members panel for the overview page. Reuses `useMembers` so the
 * avatars hydrate with the same data as the full table; the markup lives in
 * `./members-widget-core`, which takes the list and the link component as
 * props so the desktop renderer can render it off its own transport.
 */
export function MembersWidget({ workspaceSlug }: Props) {
  const { members, loading } = useMembers(workspaceSlug);

  return (
    <MembersWidgetCore
      workspaceSlug={workspaceSlug}
      members={members}
      loading={loading}
      Link={Link}
    />
  );
}
