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
  /** The rail's role for this workspace — the seed for gating until
   *  `/api/workspaces/me` answers with the authoritative one. */
  role: Role;
  /** The shell's workspaces refetch, so the rail and switcher pick up a
   *  rename immediately. */
  onWorkspaceChanged: () => void;
}

/**
 * Settings modal — the DESKTOP binding of
 * `@/shared/layout/settings-modal/settings-modal-core`.
 *
 * Restores the web app's gear-opens-a-modal-over-the-current-page behaviour in
 * the SPA (the port had replaced it with a navigate to `/settings`, a
 * different and narrower surface; that route still works for deep links).
 *
 * Three panes come from the shared cores unchanged — General, Members and the
 * Account profile form, all of which read through `apiRequest`, i.e. the IPC
 * bridge. What the renderer cannot do arrives as slots: the multipart icon
 * upload is simply absent (the bridge carries JSON), account deletion links
 * out, and Plans & Billing renders in full off `PlansBillingCore` with only
 * its two Stripe-shaped actions rerouted to the browser (see `./billing-pane`).
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

  // The web shell reads the caller from the Supabase session; here main owns
  // it, so the id comes off the membership endpoint — the SAME cache entry
  // `useWorkspaceAccess` fills for the members and skills pages, and only
  // while the modal is open (it is the Members pane that needs it).
  const me = useApiQuery<{ role: Role; userId: string }>("/api/workspaces/me", {
    workspaceId,
    enabled: open && Boolean(workspaceId),
  });

  // Re-reading the keys a workspace write invalidates is `#/lib/workspace-cache`'s
  // job — the SAME helper the /settings page calls, so the two surfaces can no
  // longer disagree about what a rename or a delete makes stale.
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
            // Falling back to BootPage, which provisions via ensure-default or
            // routes to /onboarding — mirrors the web's post-delete convergence.
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
