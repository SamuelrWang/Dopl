import { useNavigate } from "react-router";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import type { Role } from "@/features/workspaces/types";
import {
  SettingsModalCore,
  type SettingsSection,
} from "@/shared/layout/settings-modal/settings-modal-core";
import { AccountSectionCore } from "@/shared/layout/settings-modal/sections/account-section-core";
import { WorkspacesSectionCore } from "@/shared/layout/settings-modal/sections/workspaces-section-core";
import { ConnectSectionCore } from "@/shared/layout/settings-modal/sections/connect-section-core";
import { AgentDefaultsSettings } from "@/features/channels/components/agent-defaults-settings";
import { useApiQuery } from "#/hooks/use-api-query";
// ⚠ Deep import, not the `#/components/app-shell` barrel: that barrel exports
// the shell, which imports THIS file, and the cycle is what `account-rail.tsx`'s
// own `HOME_PATH` docblock warns about from the other side.
import { HOME_PATH } from "#/components/app-shell/account-rail";
import { AccountActions } from "./account-actions";
import { BillingPane } from "./billing-pane";
// ⚠ `TurnCapRow` NO LONGER IMPORTED (2026-09-07, Samuel: "Remove the turn/cost limit"). Its
// module (`turn-cap-row.tsx`), its hook (`use-turn-cap.ts`) and its suite are deleted in the same
// change, along with the `settings:*TurnCap` IPC pair and the preload bindings behind them.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** Canonical `{slug}-{publicId}` segment of the open workspace. ⚠ Read by the
   *  two SLOTS only now (account deletion links out, billing opens the portal);
   *  no pane in this modal edits a workspace since 2026-09-18. */
  workspaceSegment: string;
  workspaceId: string;
  /** Seed for gating until `/api/workspaces/me` answers authoritatively. */
  role: Role;
  /** ⚠ See `workspaceSegment`. A rename lands on `/{segment}/settings` now, and
   *  that page owns its own invalidation. */
  onWorkspaceChanged?: () => void;
}

/**
 * DESKTOP binding of `@/shared/layout/settings-modal/settings-modal-core` —
 * gear opens a modal over the current page (the `/settings` route still works
 * for deep links).
 *
 * Workspaces, Connect and the Account profile form come from the shared cores
 * unchanged.
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
}: Props) {
  const navigate = useNavigate();

  // Main owns the session here, so the authoritative role comes off the
  // membership endpoint — the SAME cache entry `useWorkspaceAccess` fills, and
  // only while the modal is open. ⚠ The `userId` half went unread when the
  // members pane was deleted (2026-08-30); the payload still carries it and
  // narrowing the type here would fork the shape `useWorkspaceAccess` reads.
  const me = useApiQuery<{ role: Role; userId: string }>("/api/workspaces/me", {
    workspaceId,
    enabled: open && Boolean(workspaceId),
  });

  return (
    <SettingsModalCore
      open={open}
      onOpenChange={onOpenChange}
      section={section}
      onSectionChange={onSectionChange}
      workspacesPane={
        <WorkspacesSectionCore
          activeWorkspaceId={workspaceId}
          // ⚠ CLOSE, THEN NAVIGATE. The modal is an overlay over the routed
          // page, so a switch that left it open would hang the OLD workspace's
          // panes over the NEW workspace's page.
          onOpenHome={() => {
            onOpenChange(false);
            navigate(HOME_PATH);
          }}
          onOpenWorkspace={(ws) => {
            onOpenChange(false);
            navigate(`/${canonicalSegment(ws)}`);
          }}
        />
      }
      connectPane={<ConnectSectionCore />}
      accountPane={
        <AccountSectionCore
          workspaceId={workspaceId}
          role={me.data?.role ?? role}
          // ⚠ `machineSection={<TurnCapRow />}` STOOD HERE AND IS DELETED (2026-09-07, Samuel:
          // "Remove the turn/cost limit"). ⚠ THE SLOT ITSELF IS LEFT ALONE and that is a
          // decision, not an oversight: `machineSection` is a GENERIC per-machine slot in a
          // shared file ("some settings belong to a machine, and the web has none"), not a
          // turn-cap affordance. It now has zero fillers on either platform. Removing it would
          // be editing a shared layout on the strength of one deleted row.
          dangerZone={<AccountActions workspaceSegment={workspaceSegment} />}
        />
      }
      // DEFAULT AGENT SETTINGS (2026-09-18, Samuel's ruling) — what a channel created from now on
      // starts its agents on. ⚠ DESKTOP ONLY, AND NOT BECAUSE OF A POLICY: the record is in this
      // machine's electron-store and is reached over `window.dopl.channels`, so the web binding
      // passes no pane and `SettingsModalCore` draws no nav entry (no dead rows).
      // ⚠ IT TAKES NO WORKSPACE AND NO CHANNEL. One operator, one Mac, one answer — which is why
      // it is the one pane here that needs nothing from the props above it.
      agentsPane={<AgentDefaultsSettings />}
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
