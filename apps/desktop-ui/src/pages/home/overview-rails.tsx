import { RailCard, RankRail } from "#/components/overview/rank-rail";
import type {
  HomeChannelUsage,
  HomePersonUsage,
  HomeToolUsage,
} from "@/features/home/overview-types";

/**
 * The /home Overview face's RANK RAILS — the four comparison lists.
 *
 * ⚠ **THE ACTIVITY SECTIONS LEFT THIS FILE ON 2026-09-01.** Recent threads and
 * running agents became their own panels, because Samuel made them top-of-page
 * surfaces with their own shapes — a list and a kanban board — rather than two
 * more rails. ⚠ Recent threads was then CUT ENTIRELY on 2026-09-05, so the only
 * survivor is `overview-agent-board.tsx`; do not restore a thread rail here on
 * the strength of this note. What is left in this file is the one thing its four
 * rails share: a name, a bar and a figure on one line.
 *
 * ⚠ **TWO OF THE FOUR CHANGED WHAT THEY MEASURE IN THE SAME CHANGE.** "MCP
 * calls by channel" became **credits** by channel and "MCP calls by person"
 * became **credit usage** by person (Samuel), which is the UI half of closing
 * F-328 — `mcp_tool_calls` counts loopback REQUESTS and was never a cost.
 * Messages-by-channel and the tool rail are untouched.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer paragraphs.
 *
 * ⚠ **THE RAIL, THE CARD AND THE CLIPPED NOTE MOVED TO
 * `#/components/overview/rank-rail.tsx` IN WAVE 8, UNCHANGED.** The workspace
 * Overview draws the same breakdown over a different fence. **What is left here
 * is the four /home rails' own copy and their own rows** — R-40 keeps this face
 * byte-identical.
 */

/**
 * CREDITS per home channel.
 *
 * ⚠ **"Nothing yet." IS THE HONEST EMPTY HERE AND IT WILL BE THE COMMON ONE FOR
 * A WHILE.** The `credit_usage_events` ledger starts at its migration, so every
 * channel reads zero until traffic accrues — that is a young ledger, not a quiet
 * month, and neither this rail nor the payload pretends to tell them apart.
 */
export function ChannelRail({ rows }: { rows: readonly HomeChannelUsage[] }) {
  return (
    <RailCard title="Credits by channel">
      <RankRail
        empty="Nothing yet."
        rows={rows.map((row) => ({
          id: row.workspaceId,
          // A channel with no name of its own still needs a rail label.
          name: row.name || "Untitled channel",
          value: row.credits,
        }))}
      />
    </RailCard>
  );
}

/** Messages per home channel — unchanged by the 2026-09-01 credit swap. */
export function ChannelMessageRail({
  rows,
}: {
  rows: readonly HomeChannelUsage[];
}) {
  return (
    <RailCard title="Messages by channel">
      <RankRail
        empty="Nothing yet."
        rows={[...rows]
          .sort((a, b) => b.messages - a.messages)
          .map((row) => ({
            id: row.workspaceId,
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
 * 🔒 **THE GUEST MARK IS THE POINT OF THIS RAIL** (Samuel) and it survived the
 * swap from calls to credits intact. `role` comes from `workspace_members`, the
 * only table where `guest` exists — `channel_members.role` is `owner|member` and
 * would report every guest as a member.
 *
 * ⚠ **IT IS A REAL CREDIT FIGURE NOW.** This rail carried `mcp_tool_calls`
 * counts until 2026-09-01 because the credit ledger had no user dimension
 * (F-328); `credit_usage_events` gives it one, so the number beside a guest is
 * what that guest actually cost the operator.
 */
export function PeopleRail({ rows }: { rows: readonly HomePersonUsage[] }) {
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
export function ToolRail({ rows }: { rows: readonly HomeToolUsage[] }) {
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
