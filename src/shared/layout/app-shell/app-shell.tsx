"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, UserRound } from "lucide-react";
import { useAuthUser } from "@/shared/auth/use-auth-user";
import type { WorkspaceLike } from "./workspace-types";
import { SettingsModal, type SettingsSection } from "@/shared/layout/settings-modal";
import { CreateWorkspaceDialog } from "@/features/workspaces/components/create-workspace-dialog";
import { AppRail } from "./app-rail";
import { AppSidebar } from "./app-sidebar";
import styles from "./app-shell.module.css";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  workspacePublicId: string;
  workspaceName: string;
  children: React.ReactNode;
}

/**
 * Full-screen shell for the new design language (knowledge preview):
 * dark top titlebar (bell + profile), workspace rail, restyled sidebar,
 * and a rounded surface whose main area is supplied by `children`.
 * Owns the workspaces fetch for the rail and the settings modal that the
 * sidebar / titlebar buttons open. Used by the knowledge landing page and
 * the KB detail page; routes that use it bypass the global layout chrome.
 */
export function AppShell({
  workspaceSegment,
  workspaceId,
  workspacePublicId,
  workspaceName,
  children,
}: Props) {
  const { user } = useAuthUser();
  const { workspaces, refresh: refreshWorkspaces } = useRailWorkspaces();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("billing");
  const [createWsOpen, setCreateWsOpen] = useState(false);

  const activeRole =
    workspaces.find((w) => w.publicId === workspacePublicId)?.role ?? "viewer";

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  return (
    <div className={styles.root}>
      <div className={styles.titlebar}>
        <div className={styles.spacer} />
        <div className={styles.topIcons}>
          <button type="button" aria-label="Notifications">
            <Bell size={22} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label="Account"
            style={{ color: "inherit", display: "flex" }}
            onClick={() => openSettings("account")}
          >
            <UserRound size={22} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <AppRail
          workspaces={workspaces}
          activePublicId={workspacePublicId}
          onAddWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={styles.surface}>
          <AppSidebar
            workspaceSegment={workspaceSegment}
            workspaceName={workspaceName}
            onOpenSettings={openSettings}
          />
          {children}
        </div>
      </div>

      <CreateWorkspaceDialog
        open={createWsOpen}
        onOpenChange={setCreateWsOpen}
        onCreated={refreshWorkspaces}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        workspaceSegment={workspaceSegment}
        workspaceId={workspaceId}
        currentUserId={user?.id ?? ""}
        role={activeRole}
        onWorkspaceChanged={() => {}}
      />
    </div>
  );
}

/** Loads the user's workspaces for the rail. Empty until the fetch
 *  resolves; `refresh` refetches (e.g. after creating a workspace). */
function useRailWorkspaces(): {
  workspaces: WorkspaceLike[];
  refresh: () => void;
} {
  const [workspaces, setWorkspaces] = useState<WorkspaceLike[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((body: { workspaces?: WorkspaceLike[] }) => {
        if (!cancelled) setWorkspaces(body.workspaces ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { workspaces, refresh };
}
