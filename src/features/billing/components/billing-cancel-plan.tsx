"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { formatDate } from "@/shared/lib/format-time";
import { useCancelPlan } from "./use-billing-account";

/**
 * CANCEL — and, when it is already canceled, RESUME. One switch, two faces.
 *
 * NOTHING ENDS TODAY, and the copy says so in both states: cancelling sets
 * Stripe's `cancel_at_period_end`, so the workspace keeps every paid feature
 * until the date quoted here and then reverts to Starter. That is why the
 * confirm dialog names the date rather than asking "are you sure?" — the date
 * IS the consequence, and it is the only thing the person is deciding about.
 *
 * DESTRUCTIVE-SUBTLE, not a danger zone. Deleting an account is irreversible
 * and gets the red block at the bottom of the page; cancelling a subscription
 * is reversible from this same section for the rest of the period, so it is a
 * quiet text button rather than a wall.
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

  async function run(resume: boolean) {
    setError(null);
    try {
      await cancel.mutateAsync({ resume });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : resume
            ? "Couldn't resume the plan"
            : "Couldn't cancel the plan"
      );
      throw err;
    }
  }

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
          onClick={() => void run(true).catch(() => {})}
          className="auth-btn-3d mt-4 flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
        >
          {cancel.pending ? "Resuming…" : "Resume plan"}
        </button>
        {error && <p className="mt-3 text-caption text-danger">{error}</p>}
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
        Cancel plan
      </button>
      {error && <p className="mt-3 text-caption text-danger">{error}</p>}

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
        onConfirm={() => run(false)}
      />
    </section>
  );
}
