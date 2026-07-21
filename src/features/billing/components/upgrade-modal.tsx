"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ModalShell } from "@/shared/layout/settings-modal";
import { apiRequest, ApiError } from "@/shared/api/api-client";
import { EmbeddedCheckoutForm } from "./embedded-checkout";
import {
  formatMoney,
  SOLO_PRICE,
  TEAM_SEAT_PRICE,
  useWorkspaceEntitlements,
} from "./use-workspace-entitlements";

const PAID_UNLOCKS = [
  "Uncapped ontology objects",
  "Full chat history restored",
  "Priority support",
] as const;

type CheckoutPlan = "solo" | "team";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scope the seat / total figures to a specific workspace. */
  workspaceId?: string;
  /** Admin/owner only — others get an "ask an admin" note instead of checkout. */
  canManageBilling?: boolean;
  /** Optional context line explaining why the modal opened. */
  reason?: string;
  /**
   * "generic" (default): the free-workspace upsell — single-member
   * workspaces choose Solo Pro or Team; 2+ members get Team only.
   * "add-member": the invite/join blocked path — Team is the only
   * offer, and a live Solo subscription is swapped in place via
   * `/api/billing/upgrade-to-team` (no checkout).
   */
  variant?: "generic" | "add-member";
}

/**
 * Reusable upgrade prompt shared by the settings pane, the ontology
 * over-cap flow, the chats retention upsell, and the Solo member-limit
 * block. Admin/owner see the purchase path; everyone else gets an
 * "ask an admin" note.
 */
export function UpgradeModal({
  open,
  onOpenChange,
  workspaceId,
  canManageBilling = true,
  reason,
  variant = "generic",
}: Props) {
  const ent = useWorkspaceEntitlements(workspaceId);
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  function close() {
    setCheckoutPlan(null);
    setSwitchError(null);
    onOpenChange(false);
  }

  async function switchToTeam() {
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await apiRequest<{ ok: boolean; seatCount: number }>(
        "/api/billing/upgrade-to-team",
        { method: "POST", workspaceId }
      );
      if (res?.ok) {
        await ent.refresh();
        close();
        return;
      }
      setSwitchError("The switch didn't complete — please try again.");
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === "NOT_ON_SOLO" || err.message === "NOT_ON_SOLO")
      ) {
        // Billing state moved under us — resync and let the user retry.
        setSwitchError(
          "This workspace is no longer on Solo Pro. Refreshing billing state…"
        );
        void ent.refresh();
      } else {
        setSwitchError(
          err instanceof Error ? err.message : "Couldn't switch to Team"
        );
      }
    } finally {
      setSwitching(false);
    }
  }

  const label =
    variant === "add-member" ? "Upgrade to add members" : "Upgrade your workspace";

  return (
    <ModalShell open={open} onClose={close} label={label} size="narrow">
      <div className="p-6">
        {checkoutPlan ? (
          <CheckoutView
            plan={checkoutPlan}
            ent={ent}
            workspaceId={workspaceId}
            onBack={() => setCheckoutPlan(null)}
          />
        ) : variant === "add-member" ? (
          <AddMemberBlocked
            ent={ent}
            reason={reason}
            canManageBilling={canManageBilling}
            switching={switching}
            switchError={switchError}
            onSwitchToTeam={() => void switchToTeam()}
            onCheckout={() => setCheckoutPlan("team")}
            onClose={close}
          />
        ) : (
          <GenericUpsell
            ent={ent}
            reason={reason}
            canManageBilling={canManageBilling}
            switching={switching}
            switchError={switchError}
            onSwitchToTeam={() => void switchToTeam()}
            onChoose={setCheckoutPlan}
            onClose={close}
          />
        )}
      </div>
    </ModalShell>
  );
}

type Ent = ReturnType<typeof useWorkspaceEntitlements>;

function CheckoutView({
  plan,
  ent,
  workspaceId,
  onBack,
}: {
  plan: CheckoutPlan;
  ent: Ent;
  workspaceId?: string;
  onBack: () => void;
}) {
  const seats = ent.billableSeats;
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 cursor-pointer text-small text-text-secondary transition-colors hover:text-text-primary"
      >
        ← Back
      </button>
      <h2 className="mb-1 text-display font-semibold tracking-tight text-text-primary">
        {plan === "solo" ? "Subscribe to Solo Pro" : "Subscribe to Team"}
      </h2>
      <p className="mb-4 text-caption text-text-secondary">
        {plan === "solo"
          ? `${formatMoney(SOLO_PRICE)} / month — flat, single member`
          : `${seats} ${seats === 1 ? "seat" : "seats"} · ${formatMoney(
              seats * TEAM_SEAT_PRICE
            )} / month`}
      </p>
      <EmbeddedCheckoutForm workspaceId={workspaceId} plan={plan} />
    </div>
  );
}

function GenericUpsell({
  ent,
  reason,
  canManageBilling,
  switching,
  switchError,
  onSwitchToTeam,
  onChoose,
  onClose,
}: {
  ent: Ent;
  reason?: string;
  canManageBilling: boolean;
  switching: boolean;
  switchError: string | null;
  onSwitchToTeam: () => void;
  onChoose: (plan: CheckoutPlan) => void;
  onClose: () => void;
}) {
  const soloEligible = ent.memberCount === 1;
  // A live (or grace-period) subscription behind a free-reporting plan is a
  // degraded Solo sub — checkout would 409 on the existing subscription, so
  // Team must swap in place via /api/billing/upgrade-to-team, exactly like
  // the add-member variant. (An entitled paid workspace shows AlreadyPaidNote
  // instead of these options, so this only fires for the degraded case.)
  const hasLiveSub = ent.status === "active" || ent.status === "past_due";

  return (
    <div>
      <h2 className="text-display font-semibold tracking-tight text-text-primary">
        Upgrade your workspace
      </h2>
      {reason && (
        <p className="mt-1 text-caption text-text-secondary">{reason}</p>
      )}

      <ul className="mt-4 flex flex-col gap-2.5">
        {PAID_UNLOCKS.map((f) => (
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

      {ent.loading ? (
        <div className="bento mt-5 h-24 animate-pulse opacity-50" />
      ) : ent.isPaid ? (
        <AlreadyPaidNote ent={ent} onClose={onClose} />
      ) : (
        <>
          {switchError && (
            <p className="mt-4 text-caption text-danger">{switchError}</p>
          )}
          <div className="mt-5 flex flex-col gap-2.5">
            {soloEligible && (
              <PlanOption
                title="Solo Pro"
                priceLine={
                  <>
                    {formatMoney(SOLO_PRICE)}{" "}
                    <span className="text-caption font-normal text-text-muted">
                      / month — flat
                    </span>
                  </>
                }
                pitch="For individuals. Everything unlocked, just for you — limited to one member."
                cta="Choose Solo Pro"
                canManageBilling={canManageBilling}
                onSelect={() => onChoose("solo")}
              />
            )}
            <PlanOption
              title="Team"
              priceLine={
                <>
                  {formatMoney(TEAM_SEAT_PRICE)}{" "}
                  <span className="text-caption font-normal text-text-muted">
                    / seat / month
                  </span>
                </>
              }
              pitch={
                soloEligible
                  ? "Add people whenever you're ready — seats sync automatically as your team changes."
                  : `${ent.billableSeats} ${
                      ent.billableSeats === 1 ? "member" : "members"
                    } × ${formatMoney(TEAM_SEAT_PRICE)} = ${formatMoney(
                      ent.billableSeats * TEAM_SEAT_PRICE
                    )} / month. Seats sync automatically as your team changes.`
              }
              cta={
                hasLiveSub
                  ? switching
                    ? "Switching to Team…"
                    : "Switch to Team"
                  : soloEligible
                    ? "Choose Team"
                    : "Continue to checkout"
              }
              highlight={!soloEligible}
              canManageBilling={canManageBilling}
              disabled={hasLiveSub && switching}
              // Degraded Solo (live sub): swap in place. Otherwise checkout.
              onSelect={hasLiveSub ? onSwitchToTeam : () => onChoose("team")}
            />
          </div>

          {canManageBilling ? (
            <button
              type="button"
              onClick={onClose}
              className="btn-light mt-4 flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary"
            >
              Maybe later
            </button>
          ) : (
            <AskAdminNote onClose={onClose} action="upgrade this workspace" />
          )}
        </>
      )}
    </div>
  );
}

function AddMemberBlocked({
  ent,
  reason,
  canManageBilling,
  switching,
  switchError,
  onSwitchToTeam,
  onCheckout,
  onClose,
}: {
  ent: Ent;
  reason?: string;
  canManageBilling: boolean;
  switching: boolean;
  switchError: string | null;
  onSwitchToTeam: () => void;
  onCheckout: () => void;
  onClose: () => void;
}) {
  const seats = ent.billableSeats;
  // Any live non-Team subscription behind a SOLO_MEMBER_LIMIT 402 is the
  // Solo sub — including the degraded backstop case where entitlements
  // report plan=free because a second member slipped in. Those must swap
  // in place; a checkout would 409 on the existing subscription.
  const hasLiveSub = ent.status === "active" || ent.status === "past_due";

  return (
    <div>
      <h2 className="text-display font-semibold tracking-tight text-text-primary">
        Upgrade to add members
      </h2>
      {reason && (
        <p className="mt-1 text-caption text-text-secondary">{reason}</p>
      )}
      <p className="mt-2 text-small leading-snug text-text-secondary">
        Solo Pro is limited to one member. Upgrade to Team —{" "}
        {formatMoney(TEAM_SEAT_PRICE)} per seat — to invite your team.
      </p>

      <div className="bento mt-5 p-4">
        <div className="text-body font-semibold text-text-primary">
          {formatMoney(TEAM_SEAT_PRICE)}{" "}
          <span className="text-caption font-normal text-text-muted">
            / seat / month
          </span>
        </div>
        <div className="mt-1 text-caption text-text-secondary">
          {seats} {seats === 1 ? "member" : "members"} ×{" "}
          {formatMoney(TEAM_SEAT_PRICE)} ={" "}
          <span className="font-semibold text-text-primary">
            {formatMoney(seats * TEAM_SEAT_PRICE)}
          </span>{" "}
          / month
        </div>
        <div className="mt-1 text-micro text-text-muted">
          Billed per member — seats sync automatically as your team changes.
        </div>
      </div>

      {!canManageBilling ? (
        <AskAdminNote onClose={onClose} action="upgrade this workspace to Team" />
      ) : ent.loading ? (
        // The 402 opens this modal before the first /api/billing/status
        // resolves; acting on DEFAULT_STATUS would offer checkout to a
        // live-Solo workspace (which then 409s). Wait for the real state.
        <div className="bento mt-5 h-16 animate-pulse opacity-50" />
      ) : ent.isTeam ? (
        <div className="mt-5">
          <p className="rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
            This workspace is already on Team — try inviting again.
          </p>
          <CloseButton onClose={onClose} />
        </div>
      ) : (
        <div className="mt-5">
          {switchError && (
            <p className="mb-3 text-caption text-danger">{switchError}</p>
          )}
          <div className="flex items-center gap-2">
            {hasLiveSub ? (
              // Live Solo subscription (entitled or degraded): swap it to
              // per-seat Team in place — no second checkout.
              <button
                type="button"
                onClick={onSwitchToTeam}
                disabled={switching}
                className="auth-btn-3d flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
              >
                {switching ? "Switching to Team…" : "Switch to Team"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onCheckout}
                className="auth-btn-3d flex h-9 flex-1 cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white"
              >
                Continue to checkout
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={switching}
              className="btn-light flex h-9 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanOption({
  title,
  priceLine,
  pitch,
  cta,
  highlight = false,
  canManageBilling,
  disabled = false,
  onSelect,
}: {
  title: string;
  priceLine: React.ReactNode;
  pitch: string;
  cta: string;
  highlight?: boolean;
  canManageBilling: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={highlight ? "bento border-border-highlight p-4" : "bento p-4"}>
      <div className="flex items-baseline justify-between">
        <span className="text-body font-semibold text-text-primary">{title}</span>
        <span className="text-body font-semibold text-text-primary">
          {priceLine}
        </span>
      </div>
      <p className="mt-1 text-caption leading-snug text-text-secondary">{pitch}</p>
      {canManageBilling && (
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          className="auth-btn-3d mt-3 flex h-8 w-full cursor-pointer items-center justify-center rounded-lg text-small font-semibold text-white disabled:cursor-default disabled:opacity-60"
        >
          {cta}
        </button>
      )}
    </div>
  );
}

function AlreadyPaidNote({ ent, onClose }: { ent: Ent; onClose: () => void }) {
  return (
    <div className="mt-5">
      <p className="rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
        This workspace is already on {ent.isSolo ? "Solo Pro" : "Team"}.
      </p>
      <CloseButton onClose={onClose} />
    </div>
  );
}

function AskAdminNote({
  onClose,
  action,
}: {
  onClose: () => void;
  action: string;
}) {
  return (
    <div className="mt-5">
      <p className="rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
        Ask a workspace admin or owner to {action}.
      </p>
      <CloseButton onClose={onClose} />
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="btn-light mt-3 flex h-9 w-full cursor-pointer items-center justify-center rounded-lg text-small font-medium text-text-primary"
    >
      Close
    </button>
  );
}
