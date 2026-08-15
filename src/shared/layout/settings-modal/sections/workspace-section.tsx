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
 * Workspace > General — web binding. Pane is `./workspace-section-core`; this
 * file is only the `next/navigation` wiring plus the multipart icon uploader,
 * so the desktop renderer reuses the same pane on the SPA router.
 */
export function WorkspaceSection({ workspaceSegment, onWorkspaceChanged }: Props) {
  const router = useRouter();

  return (
    <WorkspaceSectionCore
      workspaceSegment={workspaceSegment}
      onSaved={(updated, previous) => {
        // ⚠ A rename can change the slug; redirect to the new canonical URL or
        // subsequent saves hit the wrong route.
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
