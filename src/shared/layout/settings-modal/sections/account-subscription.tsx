"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";
import {
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { useCancelPlan } from "@/features/billing/components/use-billing-account";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { formatDate } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { OpenScaleButton } from "@/shared/ui/open-scale-button";
import { SettingsPanel, SettingsRows } from "./settings-panel";

/**
 * Account → Plan (Samuel, 2026-09-28: the app never says "subscription"): cancel or resume the caller's live subscriptions; renders nothing when
 * none is live. Next-free, so web and desktop mount the same block. Two rows are possible: Pro on
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
  if (ent.isPro) return "Pro";
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
          <OpenScaleButton
            disabled={cancel.pending}
            onClick={() => void run(true)}
            className="disabled:opacity-50"
          >
            {cancel.pending ? "Resuming…" : "Resume plan"}
          </OpenScaleButton>
        ) : (
          <OpenScaleButton
            disabled={cancel.pending}
            onClick={() => setConfirming(true)}
            className="text-danger disabled:opacity-50"
          >
            {cancel.pending ? "Cancelling…" : "Cancel plan"}
          </OpenScaleButton>
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
            ? `Paid features stay on until ${endsOn}.`
            : "Paid features stay on until the period ends."
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
