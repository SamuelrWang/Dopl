"use client";

import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { formatDate } from "@/shared/lib/format-time";
import type { WalletKind } from "../credits";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

/**
 * Usage half of `/billing/[segment]`. Pure read of the one billing-status
 * payload (`useWorkspaceEntitlements`) — no second endpoint, no write, no
 * Stripe; legible to every member, unlike the admin-gated Billing tab.
 *
 * Order = order things run out: credits, ontology objects (capped only on
 * multi-member free), then members/seats and chat window as lines.
 *
 * 2026-09-07: the credit meter is the reader's own, not the workspace's —
 * `credits.wallet` says which, so the label names the payer instead of implying
 * a pool that does not exist.
 * Minimal copy (INVARIANTS §5): label + control, no explainer paragraph.
 * 2026-09-08: a personal container has no roster and no seats, so the Members
 * line and every "billable seat" phrase are dropped there rather than printed
 * as a `1` that can only ever be 1.
 */
export function BillingUsagePane({ workspaceId }: { workspaceId: string }) {
  const ent = useWorkspaceEntitlements(workspaceId);

  if (ent.loading) return <UsageSkeleton />;

  const isPersonal = ent.containerKind === "personal";
  const creditsExhausted = ent.credits.remaining === 0 && ent.credits.limit > 0;

  return (
    <>
      <section className="bento px-6 py-5">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Usage this period
        </h2>

        <UsageMeter
          className="mt-4"
          label={creditsLabel(ent.credits.wallet)}
          used={ent.credits.used}
          limit={ent.credits.limit}
          over={creditsExhausted}
          overNote="Tool calls are paused until the next period."
        />
        {/* Period bounds are blank on the degraded fallback status
            (`use-workspace-entitlements.ts › DEFAULT_STATUS`); a date we never
            measured must not be invented here. */}
        {ent.credits.periodEnd && (
          <p className="mt-1.5 text-micro text-text-secondary">
            Resets {formatDate(ent.credits.periodEnd)}
          </p>
        )}

        {ent.isCapped && ent.objectCap !== null ? (
          <UsageMeter
            className="mt-5"
            label="Ontology objects"
            used={ent.objectsUsed}
            limit={ent.objectCap}
            over={ent.overCap}
            overNote="New objects are paused. Nothing was deleted — reads and edits still work."
          />
        ) : (
          <UsageLine
            className="mt-5"
            label="Ontology objects"
            value={`${ent.objectsUsed.toLocaleString()} · Unlimited`}
          />
        )}
      </section>

      <section className="bento px-6 py-5">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          {isPersonal ? "Limits" : "Workspace limits"}
        </h2>
        <div className="mt-3 divide-y divide-border-subtle">
          {!isPersonal && (
            <UsageLine
              className="py-2 first:pt-0"
              label="Members"
              value={
                ent.isTeam
                  ? `${ent.memberCount} · ${ent.billableSeats} billable ${
                      ent.billableSeats === 1 ? "seat" : "seats"
                    }`
                  : `${ent.memberCount}`
              }
            />
          )}
          <UsageLine
            className="py-2 first:pt-0"
            label="Chat history"
            value={
              ent.chatsWindowDays
                ? `Last ${ent.chatsWindowDays} days`
                : "Full history"
            }
          />
        </div>
      </section>
    </>
  );
}

/**
 * Whose meter this is. `seat` = the reader's own allocation inside this
 * workspace; `personal` = their home-space wallet (`credits.ts › WalletKind`).
 * Null is an older cached payload — the neutral label claims no payer.
 */
function creditsLabel(wallet: WalletKind | null): string {
  if (wallet === "seat") return "Your credits";
  if (wallet === "personal") return "Personal credits";
  return "Credits";
}

/** Limit you meet rather than fill — meter row shape, no track. */
function UsageLine({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between text-caption",
        className
      )}
    >
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{value}</span>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <section
      className="bento px-6 py-5"
      role="status"
      aria-busy="true"
      aria-label="Loading usage"
    >
      <span className="sr-only">Loading usage</span>
      <SkeletonLine w="38%" h={12} />
      <div className="mt-4 space-y-2.5">
        <SkeletonLine w="100%" />
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
      <div className="mt-5 space-y-2.5">
        <SkeletonLine w="100%" />
        <Skeleton className="h-2.5 w-full rounded-full" />
      </div>
    </section>
  );
}
