import type { ReactNode } from "react";
import { Skeleton } from "@/shared/ui/skeleton";
import type { Role } from "@/features/workspaces/types";

/**
 * THE COMPARISON RAIL AND ITS CARD — the one recipe both Overviews draw their
 * breakdowns with (wave 8, R-29(b)).
 *
 * ⚠ **THE FOUR RAILS THEMSELVES LIVE HERE TOO SINCE 2026-09-17.** Wave 8 moved
 * the bar geometry and the card frame out of /home's own rails file (deleted),
 * but both Overviews then kept private copies of the RAILS — byte-identical
 * apart from the channel id key, which is now the caller's `.map`. /home's face
 * is unchanged (R-40): this is a seam, not a restyle.
 *
 * ⚠ MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer paragraphs.
 */

export interface RankRow {
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
 * nothing on it is pressed in (docs/DESIGN-SYSTEM.md). The track is a flat
 * `bg-bg-inset`, the fill the flat CTA ink; both plain tokens.
 *
 * ⚠ THE BAR IS RELATIVE TO THE TOP ROW, NOT TO A TOTAL, and the figure beside
 * it is the absolute count — so the rail is a comparison and the number is the
 * measurement. A percentage of a SCANNED denominator drawn without it beside is
 * exactly what a payload's `scanned` field exists to prevent.
 */
export function RankRail({ rows, empty }: { rows: RankRow[]; empty: string }) {
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

export function RailCard({
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

/* ───────────────────────── THE FOUR RAILS BOTH OVERVIEWS DRAW ─────────────────
 * ⚠ ONE DECLARATION EACH. /home and the workspace Overview each kept a private
 * copy of these after the wave-8 extraction; the copies were byte-identical. */

/**
 * CREDITS per channel.
 *
 * ⚠ **THE ID KEY IS THE CALLER'S** — /home addresses a channel by
 * `workspaceId`, a workspace by `channelId` — so this takes {@link RankRow}s the
 * page already mapped, and there is no key flag on the component.
 */
export function ChannelCreditRail({ rows }: { rows: readonly RankRow[] }) {
  return (
    <RailCard title="Credits by channel">
      <RankRail empty="Nothing yet." rows={labelledChannels(rows)} />
    </RailCard>
  );
}

/** Messages per channel — the same rows, re-sorted by the figure they carry. */
export function ChannelMessageRail({ rows }: { rows: readonly RankRow[] }) {
  return (
    <RailCard title="Messages by channel">
      <RankRail
        empty="Nothing yet."
        rows={labelledChannels(rows).sort((a, b) => b.value - a.value)}
      />
    </RailCard>
  );
}

/** A channel with no name of its own still needs a rail label. ⚠ Returns a
 *  FRESH array — the message rail sorts it in place. */
function labelledChannels(rows: readonly RankRow[]): RankRow[] {
  return rows.map((row) => ({ ...row, name: row.name || "Untitled channel" }));
}

/**
 * One person's credit row.
 *
 * ⚠ **`role` IS NULLABLE, AND THAT IS THE WIDER OF THE TWO PAYLOADS** — /home
 * keeps a departed member's spend after the row that carried their role is
 * gone, while a workspace's roster fence means every row it prints has one.
 */
export interface PersonRailRow {
  userId: string;
  name: string;
  role: Role | null;
  credits: number;
}

/**
 * CREDIT USAGE per PERSON, with guests marked.
 *
 * 🔒 **THE GUEST MARK IS THE POINT OF THIS RAIL** (Samuel). `role` comes from
 * `workspace_members`, the only table where `guest` exists —
 * `channel_members.role` is `owner|member` and would report every guest as a
 * member.
 */
export function PeopleRail({ rows }: { rows: readonly PersonRailRow[] }) {
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

/** One `(tool, op)` pair's traffic. */
export interface ToolRailRow {
  tool: string;
  op: string;
  calls: number;
}

/** The busiest `(tool, op)` pairs. ⚠ There is no MCP SERVER column anywhere in
 *  the schema, so this is the finest grain that exists. */
export function ToolRail({ rows }: { rows: readonly ToolRailRow[] }) {
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

/** The 2×2 rail grid's loading state. ⚠ `h-40` is the ghost card size
 *  `home-skeleton.tsx` mirrors — move it and move that with it. */
export function RailsGhost() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-40 rounded-[14px]" />
      ))}
    </div>
  );
}
