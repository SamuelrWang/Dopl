"use client";

import { useRouter } from "next/navigation";
import type { Workspace, Role } from "../types";
import { workspaceSegment } from "../url";
import { WorkspaceSettingsFormCore } from "./workspace-settings-form-core";

interface Props {
  workspace: Workspace;
  role: Role;
}

/**
 * Per-workspace General form: rename + description. Deletion lives in
 * WorkspaceDangerZone so callers can order it after the reversible
 * sections.
 *
 * The markup and the write live in `./workspace-settings-form-core`, which
 * takes the post-save navigation as a prop; this file is only the
 * `next/navigation` binding, so the desktop renderer reuses the same form with
 * the SPA router.
 */
export function WorkspaceSettingsForm({ workspace, role }: Props) {
  const router = useRouter();

  return (
    <WorkspaceSettingsFormCore
      workspace={workspace}
      role={role}
      onSaved={(updated) => {
        // Slug may have changed if the name changed; redirect to the new
        // canonical settings URL so subsequent saves hit the right route.
        if (updated.slug !== workspace.slug) {
          router.push(`/${workspaceSegment(updated)}/settings`);
        } else {
          router.refresh();
        }
      }}
    />
  );
}
