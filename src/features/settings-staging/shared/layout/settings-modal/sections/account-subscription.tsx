// STAGING COPY of src/shared/layout/settings-modal/sections/account-subscription.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks and
// desktop libs → src/features/settings-staging/stubs). See src/features/settings-staging/PORTING.md.
"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import {
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/settings-staging/stubs/use-workspace-entitlements";
import { useCancelPlan } from "@/features/settings-staging/stubs/use-billing";
import { PERSONAL_PLAN_NAMES } from "@/features/billing/plans";
import { queuedSwitchCancelNote } from "@/features/billing/components/billing-cancel-plan";
import { usePersonalPlanChange } from "@/features/settings-staging/stubs/use-billing";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { formatDate } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SettingsPanel, SettingsRows } from "@/shared/layout/settings-modal/sections/settings-panel";

/**
 * Account → Plan (Samuel, 2026-09-28: the app never says "subscription"): cancel or resume the caller's live subscriptions; renders nothing when
 * none is live. Next-free, so web and desktop mount the same block. Two rows are possible: Pro or Max on
 * the caller's home space (no `workspaceId`; the server resolves it), and Team / legacy
 * Pro on the open standard workspace for admin/owner only (the route's own floor). The second row
 * is `containerKind === "standard"` only, so one subscription never draws twice.
 * `useCancelPlan` sets Stripe's `cancel_at_period_end` and awaits the status refresh, so the row
 * flips without a reload.
 */
export function AccountSubscription({
  workspaceId,
  role,
}: {
  /** The workspace whose settings are open. Absent = personal only. */
  workspaceId?: string;
  /** Caller's role in `workspaceId`. Absent = no workspace row. */
  role?: Role;
}) {
  // No id → the caller's own home space (`with-workspace-auth.ts`).
  const personal = useWorkspaceEntitlements(undefined);
  const workspace = useWorkspaceEntitlements(workspaceId);

  const showPersonal =
    personal.containerKind === "home" && personal.isPaid;
  const showWorkspace =
    Boolean(workspaceId) &&
    role !== undefined &&
    meetsMinRole(role, "admin") &&
    workspace.containerKind === "standard" &&
    workspace.isPaid;

  if (!showPersonal && !showWorkspace) return null;

  return (
    <SettingsPanel id="settings-account-plan" label="Plan">
      <SettingsRows label="Plan">
        {showPersonal && <SubscriptionRow ent={personal} workspaceId={undefined} />}
        {showWorkspace && <SubscriptionRow ent={workspace} workspaceId={workspaceId} />}
      </SettingsRows>
    </SettingsPanel>
  );
}

function planName(ent: WorkspaceEntitlements): string {
  if (ent.personalPlan) return PERSONAL_PLAN_NAMES[ent.personalPlan];
  if (ent.isSolo) return "Legacy Pro";
  return "Team";
}

function SubscriptionRow({
  ent,
  workspaceId,
}: {
  ent: WorkspaceEntitlements;
  workspaceId: string | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelPlan(workspaceId);
  const queued = usePersonalPlanChange(
    workspaceId,
    ent.containerKind === "home" && ent.isPaid && !ent.cancelAtPeriodEnd
  );

  const endsOn = ent.subscription_period_end
    ? formatDate(ent.subscription_period_end)
    : null;
  const ending = ent.cancelAtPeriodEnd;
  const name = planName(ent);

  /** Never rethrows — the dialog is dismissed before this runs, so the error
   *  lands on the row rather than behind a scrim. */
  async function run(resume: boolean) {
    setError(null);
    try {
      await cancel.submit({ resume });
    } catch (err) {
      setError(
        userFacingMessage(
          err,
          resume ? "Couldn't resume plan" : "Couldn't cancel plan"
        )
      );
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body font-medium text-text-primary">{name}</p>
          {endsOn && (
            <p className="text-caption text-text-muted">
              {ending ? `Cancels ${endsOn}` : `Renews ${endsOn}`}
            </p>
          )}
        </div>
        {ending ? (
          <button
            type="button"
            disabled={cancel.pending}
            onClick={() => void run(true)}
            className={pillButton("outline", "md")}
          >
            {cancel.pending ? "Resuming…" : "Resume plan"}
          </button>
        ) : (
          <button
            type="button"
            disabled={cancel.pending}
            onClick={() => setConfirming(true)}
            className={cn(pillButton("outline", "md"), "text-danger")}
          >
            {cancel.pending ? "Cancelling…" : "Cancel plan"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Cancel ${name}?`}
        description={
          endsOn
            ? `Paid features stay on until ${endsOn}.${queuedSwitchCancelNote(queued.scheduledPlan)}`
            : `Paid features stay on until the period ends.${queuedSwitchCancelNote(queued.scheduledPlan)}`
        }
        confirmLabel="Cancel plan"
        cancelLabel="Keep"
        destructive
        // Dismiss first, then run: `run` never throws, so the dialog would
        // otherwise sit open for the whole round trip.
        onConfirm={() => {
          setConfirming(false);
          void run(false);
        }}
      />
    </li>
  );
}
