"use client";

import { useEffect, useState } from "react";
import { useAuthUser } from "@/shared/auth/use-auth-user";
import { useApiQuery } from "@/shared/hooks/use-api-query";
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
 * workspace rail, restyled sidebar, and a rounded surface whose main
 * area is supplied by `children`. Owns the workspaces fetch for the
 * rail and the settings modal the sidebar buttons open. Used by the
 * knowledge landing page and the KB detail page; routes that use it
 * bypass the global layout chrome.
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
  const [billingReturn, setBillingReturn] = useState(false);
  const [createWsOpen, setCreateWsOpen] = useState(false);

  // Stripe checkout/portal return URLs land on the app with a `billing`
  // query param (via the /canvas legacy redirect). Open the settings
  // modal on Plans & Billing and strip the params from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    // setState inside rAF so the open runs on a separate paint (and the
    // set-state-in-effect rule is satisfied), matching ModalShell.
    const id = requestAnimationFrame(() => {
      setBillingReturn(billing === "success");
      setSettingsSection("billing");
      setSettingsOpen(true);
    });
    params.delete("billing");
    params.delete("session_id");
    const query = params.size > 0 ? `?${params.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);
    return () => cancelAnimationFrame(id);
  }, []);

  const activeRole =
    workspaces.find((w) => w.publicId === workspacePublicId)?.role ?? "viewer";

  function openSettings(section: SettingsSection) {
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        <AppRail
          workspaces={workspaces}
          activePublicId={workspacePublicId}
          onAddWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={styles.surface}>
          <AppSidebar
            workspaceSegment={workspaceSegment}
            workspacePublicId={workspacePublicId}
            workspaceName={workspaceName}
            onOpenSettings={openSettings}
            onCreateWorkspace={() => setCreateWsOpen(true)}
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
        billingReturn={billingReturn}
        workspaceSegment={workspaceSegment}
        workspaceId={workspaceId}
        currentUserId={user?.id ?? ""}
        role={activeRole}
        onWorkspaceChanged={refreshWorkspaces}
      />
    </div>
  );
}

const selectWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  body.workspaces ?? [];

/** Loads the user's workspaces for the rail via the query cache. Empty
 *  until the fetch resolves; `refresh` refetches (e.g. after creating a
 *  workspace). */
function useRailWorkspaces(): {
  workspaces: WorkspaceLike[];
  refresh: () => void;
} {
  const query = useApiQuery("/api/workspaces", { select: selectWorkspaces });
  return { workspaces: query.data ?? [], refresh: query.refetch };
}
