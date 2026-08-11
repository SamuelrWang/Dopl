"use client";

import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { formatDate } from "@/shared/lib/format-time";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

/**
 * USAGE — what this workspace has spent of what it is entitled to.
 *
 * The Usage half of `/billing/[segment]`. Everything here is a READ of the one
 * billing-status payload (`useWorkspaceEntitlements`) — no second endpoint, no
 * write, no Stripe. That is the whole reason the page splits: the Billing tab
 * is about money and is admin-only in its interesting parts, while this tab is
 * about the workspace and is legible to every member.
 *
 * FOUR FACTS, IN THE ORDER THEY RUN OUT. MCP credits reset monthly and are the
 * only meter every plan has, so they lead. Ontology objects are capped only on
 * a multi-member free workspace — a paid one shows the count and says
 * "Unlimited" rather than rendering an empty track against a cap that does not
 * exist. Members/seats and the chat-history window are limits you meet rather
 * than fill, so they are lines, not bars.
 */
export function BillingUsagePane({ workspaceId }: { workspaceId: string }) {
  const ent = useWorkspaceEntitlements(workspaceId);

  if (ent.loading) return <UsageSkeleton />;

  const creditsExhausted = ent.credits.remaining === 0 && ent.credits.limit > 0;

  return (
    <>
      <section className="bento px-6 py-5">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Usage this period
        </h2>
        <p className="mt-1 text-caption text-text-secondary">
          Every plan has a monthly MCP allowance. Running out pauses tool calls
          until the period rolls — nothing is deleted and the app keeps working.
        </p>

        <UsageMeter
          className="mt-4"
          label="MCP credits"
          used={ent.credits.used}
          limit={ent.credits.limit}
          over={creditsExhausted}
          overNote="MCP tool calls are paused until the next billing period. Nothing was deleted — the app keeps working."
        />
        {/* The period bounds are blank on the degraded fallback status (see
            `use-workspace-entitlements.ts › DEFAULT_STATUS`), and a date we
            never measured must not be invented here. */}
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
          Workspace limits
        </h2>
        <div className="mt-3 divide-y divide-border-subtle">
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
          <UsageLine
            className="py-2"
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

/** A limit you meet rather than fill — the meter's row shape, no track. */
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
