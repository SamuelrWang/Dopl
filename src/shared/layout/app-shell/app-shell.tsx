"use client";

import { useEffect, useState } from "react";
import { useAuthUser } from "@/shared/auth/use-auth-user";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Role } from "@/features/workspaces/types";
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
  /**
   * The signed-in user's role in this workspace, resolved on the server so
   * the settings modal's Members / Plans & Billing gating renders at the
   * correct privilege on first paint instead of flashing `viewer` until the
   * `/api/workspaces` fetch resolves (worst on the Stripe-success redirect).
   */
  role: Role;
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
  role,
  children,
}: Props) {
  const { user } = useAuthUser();
  const { workspaces, refresh: refreshWorkspaces } = useRailWorkspaces();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("billing");
  const [billingReturn, setBillingReturn] = useState<"success" | "return" | null>(
    null
  );
  const [createWsOpen, setCreateWsOpen] = useState(false);

  // Stripe checkout/portal return URLs land on the app with a `billing`
  // query param (via the /canvas legacy redirect). Open the settings
  // modal on Plans & Billing and strip the params from the URL.
  // `success` = checkout return (celebrate + poll for the webhook);
  // `return` = portal return, e.g. a cancel/downgrade (poll quietly so a
  // stale Pro pane settles). Any other value just opens the pane.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    // Defer the open to a separate paint (setState inside rAF satisfies the
    // set-state-in-effect rule, matching ModalShell) AND strip the params in
    // that same frame. Stripping synchronously here would let a StrictMode
    // remount — which cancels this rAF via cleanup — re-run the effect against
    // an already-clean URL and bail, so the pane would never open. Deferring
    // the strip keeps the trigger in the URL until the open actually commits.
    const id = requestAnimationFrame(() => {
      setBillingReturn(
        billing === "success" ? "success" : billing === "return" ? "return" : null
      );
      setSettingsSection("billing");
      setSettingsOpen(true);
      params.delete("billing");
      params.delete("session_id");
      const query = params.size > 0 ? `?${params.toString()}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${query}`);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Seed from the server-resolved `role` so gating is correct on first
  // paint; let the fetched membership take over once `/api/workspaces`
  // resolves (it may be fresher if the role changed mid-session).
  const activeRole =
    workspaces.find((w) => w.publicId === workspacePublicId)?.role ?? role;

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
            workspaceId={workspaceId}
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
