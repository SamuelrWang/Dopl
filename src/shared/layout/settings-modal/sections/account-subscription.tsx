"use client";

import { useState } from "react";
import {
  useWorkspaceEntitlements,
  type WorkspaceEntitlements,
} from "@/features/billing/components/use-workspace-entitlements";
import { useCancelPlan } from "@/features/billing/components/use-billing-account";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { formatDate } from "@/shared/lib/format-time";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";

/**
 * Account → Subscription (Samuel, 2026-09-19: "if a user is on a subscription,
 * have the option to cancel subscription"). Next-free, so the web and desktop
 * Account panes mount the same block.
 *
 * TWO SUBSCRIPTIONS CAN BE THE CALLER'S, and each is a `workspace_billing` row:
 *   - Pro on their `kind='personal'` container — read and cancelled with NO
 *     `workspaceId`, which the server resolves to that container;
 *   - Team (or legacy Pro) on the STANDARD workspace whose settings are open —
 *     only when the caller is admin/owner, the same floor the route enforces.
 * The open workspace can itself be the personal container; the second row is
 * `containerKind === "standard"` only, so one subscription never draws twice.
 *
 * Renders NOTHING when neither is live — free users see no block at all.
 *
 * Wire: `POST /api/billing/cancel` via `useCancelPlan` — the same hook the
 * billing page's `BillingCancelPlan` uses. It sets Stripe's
 * `cancel_at_period_end` (paid features stay until the period ends, then the
 * webhook reverts the row to free), writes the local row in the same request,
 * and awaits the billing-status invalidation, so the row flips to "Cancels
 * <date>" + Resume without a reload.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): label + control. The one sentence is in the
 * confirm dialog, because the end date is the whole decision.
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
  // No id → the caller's own personal container (`with-workspace-auth.ts`).
  const personal = useWorkspaceEntitlements(undefined);
  const workspace = useWorkspaceEntitlements(workspaceId);

  const showPersonal =
    personal.containerKind === "personal" && personal.isPaid;
  const showWorkspace =
    Boolean(workspaceId) &&
    role !== undefined &&
    meetsMinRole(role, "admin") &&
    workspace.containerKind === "standard" &&
    workspace.isPaid;

  if (!showPersonal && !showWorkspace) return null;

  return (
    <section
      aria-label="Subscription"
      className="w-full overflow-hidden rounded-[14px] border border-border-strong"
    >
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Subscription
        </span>
      </div>
      {/* ⚠ Flat body, NOT `SECTION_BOX_INSET`: the concave recipe is retired off
          new surfaces (`identity-editor-surface.test.tsx` census). */}
      <div className="divide-y divide-border-default">
        {showPersonal && (
          <SubscriptionRow ent={personal} workspaceId={undefined} />
        )}
        {showWorkspace && (
          <SubscriptionRow ent={workspace} workspaceId={workspaceId} />
        )}
      </div>
    </section>
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
        err instanceof Error && err.message
          ? err.message
          : resume
            ? "Couldn't resume subscription"
            : "Couldn't cancel subscription"
      );
    }
  }

  return (
    <div className="flex flex-col gap-1.5 p-4">
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
            className="btn-light shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50"
          >
            {cancel.pending ? "Resuming…" : "Resume subscription"}
          </button>
        ) : (
          <button
            type="button"
            disabled={cancel.pending}
            onClick={() => setConfirming(true)}
            className="btn-light shrink-0 cursor-pointer rounded-md px-2.5 py-1.5 text-small font-medium text-danger disabled:cursor-default disabled:opacity-50"
          >
            {cancel.pending ? "Cancelling…" : "Cancel subscription"}
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
            ? `Paid features stay on until ${endsOn}.`
            : "Paid features stay on until the period ends."
        }
        confirmLabel="Cancel subscription"
        cancelLabel="Keep"
        destructive
        // Dismiss first, then run: `run` never throws, so the dialog would
        // otherwise sit open for the whole round trip.
        onConfirm={() => {
          setConfirming(false);
          void run(false);
        }}
      />
    </div>
  );
}
