"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceLike } from "./workspace-types";
import { WorkspaceSwitcherCore } from "./workspace-switcher-core";

interface Props {
  /** Canonical segment of the open workspace (`{slug}-{publicId}`). */
  workspaceSegment: string;
  /** Public id of the open workspace — marks the active row + header. */
  workspacePublicId: string;
  /** Name of the open workspace (header fallback before the fetch lands). */
  workspaceName: string;
  onOpenSettings: (section: "workspace") => void;
  onCreateWorkspace: () => void;
}

const selectWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  body.workspaces ?? [];

/**
 * Workspace-switcher dropdown behind the sidebar brand pill. The markup lives
 * in `./workspace-switcher-core`; this file binds it to Next's router and to
 * the web `/api/workspaces` fetch (lazy — `enabled: open` — sharing the rail's
 * cache entry), so the desktop renderer can mount the same switcher on its own
 * router and transport.
 */
export function WorkspaceSwitcher({
  workspaceSegment,
  workspacePublicId,
  workspaceName,
  onOpenSettings,
  onCreateWorkspace,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { data: workspaces = [], isLoading } = useApiQuery("/api/workspaces", {
    enabled: open,
    select: selectWorkspaces,
  });

  return (
    <WorkspaceSwitcherCore
      workspaceSegment={workspaceSegment}
      workspacePublicId={workspacePublicId}
      workspaceName={workspaceName}
      workspaces={workspaces}
      isLoading={isLoading}
      onNavigate={(path) => router.push(path)}
      onOpenSettings={onOpenSettings}
      onCreateWorkspace={onCreateWorkspace}
      onOpenChange={setOpen}
    />
  );
}
