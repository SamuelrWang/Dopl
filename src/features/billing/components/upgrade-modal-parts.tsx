"use client";

import { formatMoney, TEAM_SEAT_PRICE } from "../prices";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

/**
 * The paywall's shared blocks — the add-member variant plus the three notes
 * every variant can end on.
 *
 * ⚠ SPLIT OUT OF `./upgrade-modal.tsx` ON 2026-09-07 BECAUSE THAT FILE WAS THE
 * OLDEST OVER-CAP ROW IN `docs/REFACTOR-FINDINGS.md` (551 lines; the 500 cap is
 * INVARIANTS §1). Retiring the Pro card took it to ~510 — still over — so the
 * seam is drawn where the reasons-to-change actually differ: `upgrade-modal.tsx`
 * owns the SELL (the free-workspace upsell and the checkout hand-off), and this
 * file owns the BLOCKED path (a member could not be added) and the terminal
 * notes. The imports run one way, parts ← modal, so there is no cycle.
 *
 * ⚠ NOTHING HERE MENTIONS A PRICE OR AN ALLOWANCE AS A LITERAL — `plans.ts`'s
 * G4 rule. `prices.ts › TEAM_SEAT_PRICE` is the one source.
 *
 * ⚠ **`AddMemberBlocked` IS STANDARD-WORKSPACE-ONLY (2026-09-08)** and the caller
 * enforces it (`./upgrade-modal.tsx › showAddMember`). Everything it says —
 * seats, "invite your team", the legacy single-member limit — is about a roster,
 * and a personal container has none.
 */

export type Ent = ReturnType<typeof useWorkspaceEntitlements>;

/**
 * The invite/join 402 (`SOLO_MEMBER_LIMIT`) landing.
 *
 * ⚠ STILL REACHABLE AFTER PRO WAS RETIRED FROM SALE (2026-09-07), WHICH IS WHY
 * IT IS STILL HERE. Nothing sells `solo` any more, but the workspaces that
 * already hold a live legacy row are still single-member and their invites
 * still 402 — so the gate keeps its handling and only its WORDS change: the
 * plan is named as legacy, never as something to buy.
 */
export function AddMemberBlocked({
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
  // ⚠ Any live non-Team sub behind a SOLO_MEMBER_LIMIT 402 is the legacy Pro
  // sub (incl. the degraded case reporting plan=free). Must swap in place —
  // checkout would 409 on the existing subscription.
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
        The legacy Pro plan is limited to one member. Upgrade to Team —{" "}
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
        // ⚠ The 402 opens this modal before /api/billing/status resolves;
        // acting on DEFAULT_STATUS offers checkout to a live legacy-Pro
        // workspace (409). Wait for real state.
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
              // Live legacy Pro sub: swap to per-seat Team in place, no 2nd
              // checkout.
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

export function PlanOption({
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

/**
 * ⚠ THE SUBJECT IS THE CONTAINER, NOT ALWAYS A WORKSPACE (2026-09-08): a
 * personal container is the reader's own space, so it is addressed in the
 * second person and named `Pro`. `isSolo` still labels the retired flat
 * WORKSPACE plan, which is a different product from the personal `pro`.
 */
export function AlreadyPaidNote({
  ent,
  onClose,
}: {
  ent: Ent;
  onClose: () => void;
}) {
  return (
    <div className="mt-5">
      <p className="rounded-lg border border-border-default bg-card-surface-subtle px-3 py-2 text-caption text-text-secondary">
        {ent.containerKind === "personal"
          ? "You're already on Pro."
          : `This workspace is already on ${
              ent.isSolo ? "the legacy Pro plan" : "Team"
            }.`}
      </p>
      <CloseButton onClose={onClose} />
    </div>
  );
}

export function AskAdminNote({
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

export function CloseButton({ onClose }: { onClose: () => void }) {
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
