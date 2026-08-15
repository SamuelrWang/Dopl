"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { formatDate } from "@/shared/lib/format-time";
import { useCancelPlan } from "./use-billing-account";

/**
 * CANCEL — and, when already canceled, RESUME. One switch, two faces.
 *
 * Cancelling sets Stripe's `cancel_at_period_end`: nothing ends today, paid
 * features stay until the quoted date, then revert to Starter. Confirm dialog
 * names the DATE because the date is the whole decision.
 *
 * ⚠ Dialog closes on confirm, failure lands IN THE SECTION
 * (`pending-invitations.tsx` pattern). `ConfirmDialog` swallows a throw and
 * stays open, so a reason rendered under it sits behind the scrim — in the DOM,
 * unreadable.
 *
 * ⚠ Button stays disabled past the POST: `useCancelPlan().pending` spans the
 * awaited status invalidation, during which this section still renders "Cancel
 * plan" off the OLD status — a live button there is a second cancel.
 */
export function BillingCancelPlan({
  workspaceId,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  workspaceId: string;
  cancelAtPeriodEnd: boolean;
  /** ISO instant, or null when the webhook never stamped a period end. */
  currentPeriodEnd: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelPlan(workspaceId);

  const endsOn = currentPeriodEnd ? formatDate(currentPeriodEnd) : null;

  /** ⚠ NEVER RETHROWS — a throw keeps the dialog open over this message. */
  async function run(resume: boolean) {
    setError(null);
    try {
      await cancel.submit({ resume });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : resume
            ? "Couldn't resume the plan"
            : "Couldn't cancel the plan"
      );
    }
  }

  /** Section's failure banner — the only report a dismissed dialog leaves. */
  const banner = error ? (
    <p
      role="alert"
      className="mt-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-caption text-danger"
    >
      {error}
    </p>
  ) : null;

  if (cancelAtPeriodEnd) {
    return (
      <section className="bento px-6 py-5">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Plan ending
        </h2>
        <p className="mt-1 text-caption text-text-secondary">
          {endsOn
            ? `This plan ends ${endsOn}. Until then nothing changes — every paid feature stays on.`
            : "This plan will not renew. Until the period ends nothing changes — every paid feature stays on."}
        </p>
        <button
          type="button"
          disabled={cancel.pending}
          onClick={() => void run(true)}
          className="auth-btn-3d mt-4 flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
        >
          {cancel.pending ? "Resuming…" : "Resume plan"}
        </button>
        {banner}
      </section>
    );
  }

  return (
    <section className="bento px-6 py-5">
      <h2 className="text-title font-semibold tracking-tight text-text-primary">
        Cancel plan
      </h2>
      <p className="mt-1 text-caption text-text-secondary">
        {endsOn
          ? `Cancelling keeps every paid feature until ${endsOn}, then this workspace reverts to Starter. Nothing is deleted.`
          : "Cancelling keeps every paid feature until the end of the current period, then this workspace reverts to Starter. Nothing is deleted."}
      </p>
      <button
        type="button"
        disabled={cancel.pending}
        onClick={() => setConfirming(true)}
        className="mt-4 cursor-pointer rounded-lg border border-border-default bg-bg-elevated px-4 py-1.5 text-small font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-default disabled:opacity-50"
      >
        {cancel.pending ? "Cancelling…" : "Cancel plan"}
      </button>
      {banner}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this plan?"
        description={
          endsOn
            ? `Paid features stay on until ${endsOn}. After that the workspace reverts to Starter — nothing is deleted, and you can resume any time before then.`
            : "Paid features stay on until the end of the current period. After that the workspace reverts to Starter — nothing is deleted, and you can resume any time before then."
        }
        confirmLabel="Cancel plan"
        cancelLabel="Keep plan"
        destructive
        // Dismiss FIRST, then run. `ConfirmDialog` closes on a resolve and
        // stays open on a throw, and `run` never throws — so without this the
        // dialog would sit over the section for the whole round trip and the
        // outcome, good or bad, would land behind it.
        onConfirm={() => {
          setConfirming(false);
          void run(false);
        }}
      />
    </section>
  );
}
