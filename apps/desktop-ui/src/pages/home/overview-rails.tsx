import type { ReactNode } from "react";
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
 */

interface RankRow {
  id: string;
  name: string;
  value: number;
  /** Optional trailing chip — the guest marker, and nothing else so far. */
  tag?: string;
}

/**
 * A comparison rail: name, bar, figure, on ONE line.
 *
 * ⚠ **NOT `UsageMeter`.** That primitive is the "used / limit" recipe — a
 * stacked label row over a `.concave-track` well — and /home has ruled that
 * nothing on it is pressed in (docs/DESIGN-SYSTEM.md, pinned by
 * `template-editor.test.tsx › no concave surfaces`, whose sweep reaches every
 * `.tsx` in this directory). The track is a flat `bg-bg-inset`, the fill the
 * flat CTA ink; both plain tokens.
 *
 * ⚠ THE BAR IS RELATIVE TO THE TOP ROW, NOT TO A TOTAL, and the figure beside
 * it is the absolute count — so the rail is a comparison and the number is the
 * measurement. A percentage of a SCANNED denominator drawn without it beside is
 * exactly what the payload's `scanned` field exists to prevent.
 */
function RankRail({ rows, empty }: { rows: RankRow[]; empty: string }) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) {
    return <p className="mt-3 text-caption text-text-muted">{empty}</p>;
  }
  return (
    <ul className="mt-3 flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3">
          <span className="flex w-28 shrink-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-body text-text-primary">
              {row.name}
            </span>
            {row.tag && (
              <span className="shrink-0 rounded-full bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
                {row.tag}
              </span>
            )}
          </span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-inset">
            <span
              className="block h-full rounded-full bg-surface-cta"
              style={{ width: `${Math.round((row.value / top) * 100)}%` }}
            />
          </span>
          <span className="w-12 shrink-0 text-right font-mono text-micro tabular-nums text-text-secondary">
            {row.value.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RailCard({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bento flex flex-col p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h3>
        {meta}
      </div>
      {children}
    </section>
  );
}

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

/**
 * The clipped notice for this surface family.
 *
 * ⚠ §9: a read AT its ceiling is indistinguishable from an exhausted one, so it
 * SAYS SO, beside the sections it clipped and never in a footer. ⚠ It may not
 * promise another read as the remedy — there is no page argument here — so what
 * it honestly offers is that the rails are a floor over the newest rows.
 */
export function ClippedNote({ scanned }: { scanned: number }) {
  return (
    <p className="px-1 text-caption text-text-muted">
      Rails cover the newest {scanned.toLocaleString()} rows.
    </p>
  );
}
