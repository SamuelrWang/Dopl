"use client";

import { useRouter } from "next/navigation";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import { WorkspaceIconUploader } from "../workspace-icon-uploader";
import { WorkspaceSectionCore } from "./workspace-section-core";

interface Props {
  workspaceSegment: string;
  onWorkspaceChanged: () => void;
}

/**
 * Workspace > General — the web binding.
 *
 * The pane itself lives in `./workspace-section-core`, which takes the
 * post-write navigation as props; this file is only the `next/navigation`
 * binding plus the multipart icon uploader, so the desktop renderer reuses the
 * same pane with the SPA router. The two callbacks reproduce what
 * `WorkspaceSettingsForm` / `WorkspaceDangerZone` did when this section
 * rendered those bindings directly.
 */
export function WorkspaceSection({ workspaceSegment, onWorkspaceChanged }: Props) {
  const router = useRouter();

  return (
    <WorkspaceSectionCore
      workspaceSegment={workspaceSegment}
      onSaved={(updated, previous) => {
        // Slug may have changed if the name changed; redirect to the new
        // canonical settings URL so subsequent saves hit the right route.
        if (updated.slug !== previous.slug) {
          router.push(`/${canonicalSegment(updated)}/settings`);
        } else {
          router.refresh();
        }
      }}
      onDeleted={(next) => {
        router.push(next ? `/${canonicalSegment(next)}` : "/onboarding");
        router.refresh();
      }}
      imageUploader={(workspace) => (
        <WorkspaceIconUploader workspace={workspace} onChanged={onWorkspaceChanged} />
      )}
    />
  );
}
