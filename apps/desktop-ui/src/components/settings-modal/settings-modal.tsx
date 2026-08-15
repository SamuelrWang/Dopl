import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import type { Role } from "@/features/workspaces/types";
import {
  SettingsModalCore,
  type SettingsSection,
} from "@/shared/layout/settings-modal/settings-modal-core";
import { AccountSectionCore } from "@/shared/layout/settings-modal/sections/account-section-core";
import { WorkspaceSectionCore } from "@/shared/layout/settings-modal/sections/workspace-section-core";
import { useApiQuery } from "#/hooks/use-api-query";
import { invalidateWorkspaceReads } from "#/lib/workspace-cache";
import { AccountActions } from "./account-actions";
import { BillingPane } from "./billing-pane";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** Canonical `{slug}-{publicId}` segment of the open workspace. */
  workspaceSegment: string;
  workspaceId: string;
  /** Seed for gating until `/api/workspaces/me` answers authoritatively. */
  role: Role;
  /** Shell's workspaces refetch, so the switcher picks up a rename at once. */
  onWorkspaceChanged: () => void;
}

/**
 * DESKTOP binding of `@/shared/layout/settings-modal/settings-modal-core` —
 * gear opens a modal over the current page (the `/settings` route still works
 * for deep links).
 *
 * General, Members and the Account profile form come from the shared cores
 * unchanged. What the renderer cannot do arrives as SLOTS: multipart icon
 * upload absent (the bridge carries JSON only), account deletion links out,
 * Plans & Billing reroutes its two Stripe actions to the browser
 * (`./billing-pane`).
 */
export function SettingsModal({
  open,
  onOpenChange,
  section,
  onSectionChange,
  workspaceSegment,
  workspaceId,
  role,
  onWorkspaceChanged,
}: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Main owns the session here, so the caller id comes off the membership
  // endpoint — the SAME cache entry `useWorkspaceAccess` fills, and only while
  // the modal is open (the Members pane needs it).
  const me = useApiQuery<{ role: Role; userId: string }>("/api/workspaces/me", {
    workspaceId,
    enabled: open && Boolean(workspaceId),
  });

  // ⚠ Invalidation lives in `#/lib/workspace-cache` — the SAME helper the
  // /settings page calls, so the two surfaces cannot disagree about what a
  // rename or delete makes stale.
  const invalidate = () => invalidateWorkspaceReads(queryClient, workspaceSegment);

  return (
    <SettingsModalCore
      open={open}
      onOpenChange={onOpenChange}
      section={section}
      onSectionChange={onSectionChange}
      workspaceSegment={workspaceSegment}
      workspaceId={workspaceId}
      currentUserId={me.data?.userId ?? ""}
      role={me.data?.role ?? role}
      workspacePane={
        <WorkspaceSectionCore
          workspaceSegment={workspaceSegment}
          onSaved={() => {
            invalidate();
            onWorkspaceChanged();
          }}
          onDeleted={(next) => {
            invalidate();
            onWorkspaceChanged();
            onOpenChange(false);
            // "/" = BootPage, which provisions via ensure-default or routes to
            // /onboarding — mirrors the web's post-delete convergence.
            navigate(next ? `/${canonicalSegment(next)}` : "/", { replace: true });
          }}
        />
      }
      accountPane={
        <AccountSectionCore
          dangerZone={<AccountActions workspaceSegment={workspaceSegment} />}
        />
      }
      billingPane={
        <BillingPane
          workspaceSegment={workspaceSegment}
          workspaceId={workspaceId}
          role={me.data?.role ?? role}
        />
      }
    />
  );
}
