"use client";

import { useRouter } from "next/navigation";
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";
import { CreateWorkspaceDialogCore } from "./create-workspace-dialog-core";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback fired after the workspace is created. */
  onCreated?: (workspace: Workspace) => void;
  /** Skip the post-create router push when caller wants to handle nav. */
  skipRedirect?: boolean;
}

/**
 * Create-workspace dialog in the new design language: the shared
 * ModalShell (scrim + fade/pop-in light card) in its narrow size — same
 * chrome as `CreateBaseDialog`.
 *
 * The markup and the write live in `./create-workspace-dialog-core`, which
 * leaves navigation to its caller; this file is only the `next/navigation`
 * binding, so the desktop renderer reuses the same dialog with the SPA router.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
  skipRedirect,
}: Props) {
  const router = useRouter();

  return (
    <CreateWorkspaceDialogCore
      open={open}
      onOpenChange={onOpenChange}
      onCreated={(workspace) => {
        onCreated?.(workspace);
        if (!skipRedirect) {
          router.push(`/${workspaceSegment(workspace)}`);
          router.refresh();
        }
      }}
    />
  );
}
