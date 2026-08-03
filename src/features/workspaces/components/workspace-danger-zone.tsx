"use client";

import { useRouter } from "next/navigation";
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";
import { WorkspaceDangerZoneCore } from "./workspace-danger-zone-core";

/**
 * Owner-only workspace deletion: the danger-zone section box + confirm
 * dialog. Rendered by both the settings page and the settings modal,
 * after the reversible sections.
 *
 * The markup and the writes live in `./workspace-danger-zone-core`, which takes
 * the post-delete navigation as a prop; this file is only the
 * `next/navigation` binding, so the desktop renderer reuses the same section
 * with the SPA router.
 */
export function WorkspaceDangerZone({ workspace }: { workspace: Workspace }) {
  const router = useRouter();

  return (
    <WorkspaceDangerZoneCore
      workspace={workspace}
      onDeleted={(next) => {
        router.push(next ? `/${workspaceSegment(next)}` : "/onboarding");
        router.refresh();
      }}
    />
  );
}
