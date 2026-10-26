"use client";

/**
 * STAGING STAND-IN for `src/features/billing/components/upgrade-modal.tsx`. The
 * real modal reads billing status and opens Stripe checkout; this draws the same
 * `ModalShell` (narrow, "Upgrade your plan") with the reason line and a closed
 * plan summary, so the cap flow can be clicked through. Billing UI is out of the
 * ontology staging scope. ⚠ PORTING: do not port.
 */

import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";

export function UpgradeModal({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId?: string;
  canManageBilling?: boolean;
  reason?: string;
}) {
  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label="Upgrade your plan"
      size="narrow"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 className="text-title font-semibold text-text-primary">Upgrade your plan</h2>
        {reason && <p className="text-body text-text-secondary">{reason}</p>}
        <p className="text-small text-text-muted">
          Staging stub: the real modal shows the Pro plan and Stripe checkout.
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-light px-3 py-1 text-small"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
