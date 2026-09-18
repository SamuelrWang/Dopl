import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import type { WorkspaceTokenSpend } from "@/features/workspaces/types";
import { useApiQuery } from "#/hooks/use-api-query";
import { TokenSpendStrip } from "#/components/overview/token-spend-strip";

/**
 * THE WORKSPACE OVERVIEW'S **TOKEN SPEND** PANEL — this container's rows, for
 * the caller's OWN agents (wave 8).
 *
 * 🔒 **PER-MEMBER-OWN IS THE WHOLE PANEL, AND IT IS A FENCE DECISION RATHER
 * THAN A MISSING FEATURE** — INVARIANTS §9 carries the argument.
 * ⚠ **SO THE PANEL SAYS WHOSE FIGURE IT IS**, in one line. An unlabelled strip
 * on a page full of other people's agents reads as the container's total, which
 * is the one thing this fence cannot answer. Minimal copy (§5): a RULE the
 * reader needs, not an explainer.
 *
 * ⚠ **IT FOLDS AWAY WHEN NOTHING HAS BEEN SPENT**, exactly as the agent board
 * above does — a heading over an empty box is the defect the first Overview
 * attempt was rejected for.
 *
 * ⚠ **NOT PART OF THE PAGE'S PAINT GATE.** It is its own read, like /home's, so
 * a slow ledger cannot hold the whole page at the skeleton.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7): a cold read.
 */
export function TokenSpendPanel({ segment }: { segment: string }) {
  const spend = useApiQuery<WorkspaceTokenSpend>(
    `/api/workspaces/${encodeURIComponent(segment)}/token-spend`
  );

  if (spend.error) return null;
  if (!spend.isPending && (spend.data?.marks?.length ?? 0) === 0) return null;

  return (
    <SectionPanel id="workspace-overview-token-spend" label="Token spend">
      <section className="bento flex flex-col gap-3 p-3.5">
        {spend.isPending || !spend.data ? (
          <Skeleton className="h-[104px] w-full rounded-lg" />
        ) : (
          <TokenSpendStrip
            report={spend.data}
            scopeNote="Your agents in this workspace."
          />
        )}
      </section>
    </SectionPanel>
  );
}
