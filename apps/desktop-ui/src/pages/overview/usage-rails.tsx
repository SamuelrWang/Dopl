import { SectionPanel } from "@/shared/ui/section-panel";
import {
  EMPTY_PERSON_USAGE,
  EMPTY_TOOL_USAGE,
} from "@/features/home/overview-types";
import {
  EMPTY_WORKSPACE_CHANNEL_USAGE,
  type WorkspaceChannelUsage,
  type WorkspaceUsageBreakdown,
} from "@/features/workspaces/types";
import {
  ChannelCreditRail,
  ChannelMessageRail,
  ClippedNote,
  PeopleRail,
  RailsGhost,
  ToolRail,
  type RankRow,
} from "#/components/overview/rank-rail";

/**
 * THE WORKSPACE OVERVIEW'S BREAKDOWN — credits by channel, by person, and the
 * busiest MCP tools (wave 8, R-29(b): *"give a workspace admin the thing they
 * most obviously want and do not have"*).
 *
 * 🔒 **EVERY CREDIT FIGURE HERE IS THIS CONTAINER'S SEAT SPEND** — never a
 * personal wallet's (`workspaces/server/service-usage.ts ›
 * isWorkspaceSeatBurn`).
 *
 * ⚠ **THE WINDOW IS THE CURRENT CALENDAR MONTH AND NO CONTROL MOVES IT** — the
 * same split /home makes, so the rails and the page's period figure answer for
 * one window. The range switcher belongs to the plot above.
 *
 * ⚠ **THE BY-CHANNEL AND BY-PERSON RAILS ARE FENCED, THE TOOL RAIL IS NOT** —
 * both print a name, so both are cut server-side (a channel to the caller's
 * visible set, a person to the roster), which is why neither sums to the plot.
 * INVARIANTS §9 states the two postures.
 *
 * ⚠ **THE RAILS THEMSELVES ARE `#/components/overview/rank-rail.tsx`'s** since
 * 2026-09-17 — this file had a byte-identical private copy of all five.
 * ⚠ **`ClippedNote` RENDERS INSIDE THIS PANEL AND OUTSIDE /home's** — a caller
 * concern on both faces, deliberately not absorbed into a rail.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer paragraphs.
 */
export function UsageRails({ usage }: { usage?: WorkspaceUsageBreakdown }) {
  return (
    <SectionPanel id="workspace-overview-breakdown" label="All channels">
      {usage ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <ChannelCreditRail
              rows={channelRows(
                usage.channels ?? EMPTY_WORKSPACE_CHANNEL_USAGE,
                (row) => row.credits
              )}
            />
            <ChannelMessageRail
              rows={channelRows(
                usage.channels ?? EMPTY_WORKSPACE_CHANNEL_USAGE,
                (row) => row.messages
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PeopleRail rows={usage.people ?? EMPTY_PERSON_USAGE} />
            <ToolRail rows={usage.tools ?? EMPTY_TOOL_USAGE} />
          </div>
          {usage.truncated && <ClippedNote scanned={usage.scanned} />}
        </div>
      ) : (
        <RailsGhost />
      )}
    </SectionPanel>
  );
}

/** ⚠ **THE ID KEY IS THIS PAGE'S** — a workspace addresses a channel by
 *  `channelId`, /home by `workspaceId`, which is why the shared rail takes
 *  `RankRow`s and not a key flag. */
function channelRows(
  rows: readonly WorkspaceChannelUsage[],
  value: (row: WorkspaceChannelUsage) => number
): RankRow[] {
  return rows.map((row) => ({
    id: row.channelId,
    name: row.name,
    value: value(row),
  }));
}
