import { PanelHeading } from "@/features/channels/components/channels-v2/bits";
import { ThreadActivityStrip } from "@/features/channels/components/channels-v2/thread-activity";
import { useOverviewSeries } from "@/features/workspaces/hooks/use-overview-series";

/**
 * THREAD ACTIVITY, ON THE HOME INFO TAB (Samuel, 2026-08-25) — the channels
 * page's density strip, fed from REAL per-day counts for THIS channel.
 *
 * ⚠ THE VISUAL IS THE CHANNELS PAGE'S, THE NUMBERS ARE NOT ITS FIXTURE. That
 * page renders `fixtures.ts › HARDCODED_THREAD_ACTIVITY` — 24 invented levels,
 * marked as such at its render site since 2026-08-18 because
 * `channel_tasks_activity` carries one timestamp per thread and not a
 * histogram. Samuel's ruling was to keep the PICTURE and make it true, so the
 * squares come from `thread-activity.tsx` (shared with that page, one ramp) and
 * the levels are quantised from a real series.
 *
 * ⚠ WHAT FEEDS IT: `GET /api/workspaces/[segment]/overview-series?metric=
 * messages&channelId=` — 31 UTC days, one counted bin each, narrowed to this
 * channel. **No new endpoint**: `channelId` is a narrowing query parameter on
 * the route that already served this shape (§9 — two views of one resource is a
 * parameter), and it is fenced against the channels feature's own visibility
 * statement before any service-role count runs.
 *
 * ⚠ IT COUNTS MESSAGES, AND THE LABEL FOLLOWS THE SURFACE (Samuel, 2026-09-05).
 * This pane shows a CHANNEL, so the heading says "Channel activity"; a thread's
 * own pane says "Thread activity". It said "Thread" here for a channel until
 * this ruling. The `threads` metric was the other candidate
 * and was rejected as a MEASUREMENT rather than as a taste: it counts threads
 * OPENED per day, which on a two-person relationship is zero almost every day
 * and would paint an empty strip over a busy channel.
 *
 * ⚠ 31 COUNTED BINS PER CHANNEL VIEW is the cost, and it is why the channels
 * page has NOT been switched over in the same change (F-316): there, that cost
 * lands on every channel selection in a workspace, which is a decision for
 * Samuel rather than a side effect of this one. Here the read is cached by the
 * channel's own key and a home channel is opened deliberately.
 */
export function PersonThreadActivity({
  channelId,
  workspaceSegment,
}: {
  channelId: string;
  /** The link container's `{slug}-{publicId}` — this route addresses by
   *  SEGMENT, not by id (`use-overview-series.ts`). */
  workspaceSegment: string;
}) {
  const { days, loading } = useOverviewSeries({
    workspaceSegment,
    metric: "messages",
    channelId,
  });

  return (
    <>
      <PanelHeading title="Channel activity" />
      {/* ⚠ THE STRIP RENDERS NOTHING RATHER THAN EMPTY WELLS while the read is
          in flight or when a stale cache entry cannot answer — an empty well
          means a MEASURED zero here, so a full row of them would state 31 quiet
          days nobody counted. */}
      <ThreadActivityStrip bins={days} loading={loading} metricLabel="Messages" />
    </>
  );
}
