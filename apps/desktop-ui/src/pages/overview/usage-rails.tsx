import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_TOOL_USAGE,
  type WorkspaceUsageBreakdown,
} from "@/features/workspaces/types";
import {
  ClippedNote,
  RailCard,
  RankRail,
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
 * ⚠ MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer paragraphs.
 */
export function UsageRails({ usage }: { usage?: WorkspaceUsageBreakdown }) {
  return (
    <SectionPanel id="workspace-overview-breakdown" label="All channels">
      {usage ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <ChannelCreditRail rows={usage.channels ?? EMPTY_CHANNEL_USAGE} />
            <ChannelMessageRail rows={usage.channels ?? EMPTY_CHANNEL_USAGE} />
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

type ChannelRow = WorkspaceUsageBreakdown["channels"][number];
type PersonRow = WorkspaceUsageBreakdown["people"][number];
type ToolRow = WorkspaceUsageBreakdown["tools"][number];

/**
 * CREDITS per channel.
 *
 * ⚠ **"Nothing yet." IS THE HONEST EMPTY AND IT WILL BE THE COMMON ONE FOR A
 * WHILE.** The `credit_usage_events` ledger starts at its migration, so every
 * channel reads zero until traffic accrues — a young ledger, not a quiet month,
 * and neither this rail nor the payload pretends to tell them apart.
 */
function ChannelCreditRail({ rows }: { rows: readonly ChannelRow[] }) {
  return (
    <RailCard title="Credits by channel">
      <RankRail
        empty="Nothing yet."
        rows={rows.map((row) => ({
          id: row.channelId,
          name: row.name || "Untitled channel",
          value: row.credits,
        }))}
      />
    </RailCard>
  );
}

function ChannelMessageRail({ rows }: { rows: readonly ChannelRow[] }) {
  return (
    <RailCard title="Messages by channel">
      <RankRail
        empty="Nothing yet."
        rows={[...rows]
          .sort((a, b) => b.messages - a.messages)
          .map((row) => ({
            id: row.channelId,
            name: row.name || "Untitled channel",
            value: row.messages,
          }))}
      />
    </RailCard>
  );
}

/**
 * CREDIT USAGE per PERSON, with guests marked.
 *
 * ⚠ `role` comes from `workspace_members`, the only table where `guest` exists
 * — `channel_members.role` is `owner|member` and would report every guest as a
 * member.
 */
function PeopleRail({ rows }: { rows: readonly PersonRow[] }) {
  const guests = rows.filter((row) => row.role === "guest");
  const guestCredits = guests.reduce((sum, row) => sum + row.credits, 0);
  return (
    <RailCard
      title="Credit usage by person"
      meta={
        guests.length > 0 ? (
          <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
            {guests.length} guest{guests.length === 1 ? "" : "s"} ·{" "}
            {guestCredits.toLocaleString()}
          </span>
        ) : undefined
      }
    >
      <RankRail
        empty="Nothing yet."
        rows={rows.map((row) => ({
          id: row.userId,
          // The server falls through display name → email → "" when no profile
          // row resolves; a blank rail label reads as a bug.
          name: row.name || "Unknown member",
          value: row.credits,
          tag: row.role === "guest" ? "Guest" : undefined,
        }))}
      />
    </RailCard>
  );
}

/** The busiest `(tool, op)` pairs. ⚠ There is no MCP SERVER column anywhere in
 *  the schema, so this is the finest grain that exists. */
function ToolRail({ rows }: { rows: readonly ToolRow[] }) {
  return (
    <RailCard title="Top MCP tools">
      <RankRail
        empty="Nothing yet."
        rows={rows.map((row) => ({
          id: `${row.tool}:${row.op}`,
          name: row.op ? `${row.tool} · ${row.op}` : row.tool,
          value: row.calls,
        }))}
      />
    </RailCard>
  );
}

function RailsGhost() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-40 rounded-[14px]" />
      ))}
    </div>
  );
}
