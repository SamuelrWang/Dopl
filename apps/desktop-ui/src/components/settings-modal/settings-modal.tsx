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
import { TurnCapRow } from "./turn-cap-row";

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
 * General and the Account profile form come from the shared cores unchanged.
 * ⚠ THERE IS NO MEMBERS PANE (Samuel, 2026-08-30 — ledger ASK-1): `/members` is
 * the one console, and the v1 one this modal used to mount is deleted.
 * What the renderer cannot do arrives as SLOTS: multipart icon
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

  // Main owns the session here, so the authoritative role comes off the
  // membership endpoint — the SAME cache entry `useWorkspaceAccess` fills, and
  // only while the modal is open. ⚠ The `userId` half went unread when the
  // members pane was deleted (2026-08-30); the payload still carries it and
  // narrowing the type here would fork the shape `useWorkspaceAccess` reads.
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
          // ⚠ MACHINE-SCOPED, so it is bound here and not in the core: this
          // modal is the DESKTOP binding, and the row hides itself when main
          // has no turn-cap ops (`./use-turn-cap`).
          machineSection={<TurnCapRow />}
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
