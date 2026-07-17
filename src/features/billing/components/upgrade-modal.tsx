"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ModalShell } from "@/shared/layout/settings-modal";
import { EmbeddedCheckoutForm } from "./embedded-checkout";
import {
  formatMoney,
  PRO_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "./use-workspace-entitlements";

const PRO_UNLOCKS = [
  "Uncapped ontology objects",
  "Full chat history restored",
  "Priority support",
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scope the seat / total figures to a specific workspace. */
  workspaceId?: string;
  /** Admin/owner only — others get an "ask an admin" note instead of checkout. */
  canManageBilling?: boolean;
  /** Optional context line explaining why the modal opened. */
  reason?: string;
}

/**
 * Reusable Pro upgrade prompt: what Pro unlocks, the per-seat price, this
 * workspace's member count → monthly total, and the embedded checkout
 * (revealed on demand). Admin/owner only see the checkout; everyone else
 * gets an "ask an admin" note. Shared by the settings pane and the
 * ontology over-cap flow.
 */
export function UpgradeModal({
  open,
  onOpenChange,
  workspaceId,
  canManageBilling = true,
  reason,
}: Props) {
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkout, setCheckout] = useState(false);

  function close() {
    setCheckout(false);
    onOpenChange(false);
  }

  const seats = ent.billableSeats;

  return (
    <ModalShell open={open} onClose={close} label="Upgrade to Pro" size="narrow">
      <div className="p-6">
        {checkout ? (
          <div>
            <button
              type="button"
              onClick={() => setCheckout(false)}
              className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
            >
              ← Back
            </button>
            <h2 className="mb-1 text-display font-semibold tracking-tight text-text-primary">
              Subscribe to Pro
            </h2>
            <p className="mb-4 text-caption text-text-secondary">
              {seats} {seats === 1 ? "seat" : "seats"} · {formatMoney(ent.monthlyTotal)} / month
            </p>
            <EmbeddedCheckoutForm workspaceId={workspaceId} />
          </div>
        ) : (
          <div>
            <h2 className="text-display font-semibold tracking-tight text-text-primary">
              Upgrade to Pro
            </h2>
            {reason && (
              <p className="mt-1 text-caption text-text-secondary">{reason}</p>
            )}

            <ul className="mt-4 flex flex-col gap-2.5">
              {PRO_UNLOCKS.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-small leading-snug text-text-primary"
                >
                  <Check
                    size={13}
                    strokeWidth={2.4}
                    className="mt-0.5 shrink-0 text-success"
                  />
                  {f}
                </li>
              ))}
            </ul>

            <div className="bento mt-5 p-4">
              <div className="text-body font-semibold text-text-primary">
                {formatMoney(PRO_SEAT_PRICE)}{" "}
                <span className="text-caption font-normal text-text-muted">
                  / seat / month
                </span>
              </div>
              <div className="mt-1 text-caption text-text-secondary">
                {seats} {seats === 1 ? "member" : "members"} × {formatMoney(PRO_SEAT_PRICE)} ={" "}
                <span className="font-semibold text-text-primary">
                  {formatMoney(ent.monthlyTotal)}
                </span>{" "}
                / month
              </div>
              <div className="mt-1 text-micro text-text-muted">
                Billed per member — seats sync automatically as your team changes.
              </div>
            </div>

            {canManageBilling ? (
              <div className="mt-5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCheckout(true)}
                  className="auth-btn-3d flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white"
                >
                  Continue to checkout
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="btn-light flex h-9 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-medium text-text-primary"
                >
                  Maybe later
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <p className="rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
                  Ask a workspace admin or owner to upgrade this workspace to Pro.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="btn-light mt-3 flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
