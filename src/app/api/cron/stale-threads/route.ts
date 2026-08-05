import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/cron/stale-threads
 *
 * THE PROBLEM IT ANSWERS (P1-6, 2026-08-04). Nothing linked "the responder said
 * it was finished" to `channel_tasks`: no trigger, nothing on the write path, and
 * a `task_finished` message never touched the row. So threads simply never
 * closed. Two have been open in production since the feature shipped, one of them
 * a 1.7.20 smoke test. An open-thread list that fills with dead exchanges stops
 * being a list anyone reads, which costs the live ones their visibility.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT. It does NOT close anything.
 * Samuel's decision 2 is that closing settles a SHARED thread for both members
 * and is the human's judgment — an agent may not make it, and a cron is further
 * from the human than the agent is. A sweep that auto-closed would be the same
 * mistake with a scheduler behind it, and it would fire on exactly the threads
 * nobody has looked at, i.e. with the least evidence.
 *
 * So it PROPOSES, using the same marker `service-tasks-propose.proposeTaskClose`
 * writes: a non-terminal `task_progress` carrying `closeProposed`, which the
 * thread card renders as a one-click confirm. The human decides, as they do for
 * an agent's proposal; the only difference is who noticed.
 *
 * ONE PROMPT PER THREAD, FOREVER. The `client_msg_id` is derived from the thread
 * id and collides with the agent's own proposal key, so a daily sweep over a
 * thread somebody is ignoring adds nothing after the first day — and a thread
 * whose agent already proposed gets no second prompt. Both are the same row.
 *
 * AUTHORED BY THE SYSTEM, never by a member. `author_kind:'system'` with a null
 * author is the honest attribution: no person said this, and forging one of the
 * two parties would put words in the mouth of somebody who may disagree with the
 * proposal. It writes through `supabaseAdmin` rather than `postMessage` for the
 * same reason — the service layer's whole contract is built around an acting
 * user, and this sweep has none. (The route's own schema rejects `system` from
 * any HTTP caller, which is why that lane is not reachable by anything else.)
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset,
 * 401 without the secret), same as the other /api/cron/* routes.
 *
 * OPERATIONAL NOTE FOR WHOEVER DEPLOYS THIS: `CRON_SECRET` is currently UNSET in
 * Vercel, so every /api/cron/* route — this one included — answers 503 and the
 * scheduler runs nothing at all. That is the fail-closed behaviour working as
 * designed, not a bug in this job, but it does mean this sweep is inert until the
 * variable is set. Same for purge-trash, oauth-cleanup and reconcile-seats.
 */

/**
 * How long an open thread has to sit untouched before it is worth asking about.
 *
 * 14 days is chosen against what a thread IS rather than against a tidy number:
 * an exchange between two people's agents is normally minutes to hours, a slow
 * one runs a few days, and the ones that matter get activity. Two weeks of total
 * silence is well past any live exchange and still short enough that the prompt
 * arrives while somebody remembers the thread. It is measured from the LAST
 * ACTIVITY, not from creation, so a long-running exchange is never swept.
 */
const STALE_AFTER_DAYS = 14;

/** How many threads one run may prompt on — a bound, not a page. */
const MAX_PER_RUN = 50;

export const dynamic = "force-dynamic";

/** The proposal key `proposeTaskClose` uses, restated so the two rows collide. */
function proposalClientMsgId(taskId: string): string {
  return `close-proposed-${taskId}-completed`;
}

const BODY =
  "This thread has had no activity for a while. Close it if it is done, or say something to keep it open.";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const before = new Date(
    Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const db = supabaseAdmin();

  let prompted = 0;
  let skipped = 0;
  try {
    const stale = await db
      .from("channel_tasks")
      .select("id, channel_id, workspace_id, title, updated_at")
      .eq("status", "open")
      .lt("updated_at", before)
      .order("updated_at", { ascending: true })
      .limit(MAX_PER_RUN);
    if (stale.error) throw stale.error;

    for (const task of stale.data ?? []) {
      const clientMsgId = proposalClientMsgId(task.id);
      // The INSERT is the idempotency check: `channel_messages_client_msg_key`
      // is unique per (channel, client_msg_id), so a repeat run — or a thread
      // whose agent already proposed — collides and is skipped. Cheaper and more
      // honest than a pre-read, which would race itself.
      const res = await db.from("channel_messages").insert({
        channel_id: task.channel_id,
        workspace_id: task.workspace_id,
        author_user_id: null,
        author_kind: "system",
        kind: "task_progress",
        body: BODY,
        metadata: {
          taskId: task.id,
          closeProposed: true,
          closeOutcome: "completed",
          summary: task.title,
          // Distinguishes this from an agent's proposal for anyone reading the
          // row later. Nothing gates on it.
          staleSweep: true,
        },
        client_msg_id: clientMsgId,
      });
      if (res.error) {
        // 23505 is the expected, healthy outcome for an already-prompted thread.
        if (res.error.code === "23505") skipped += 1;
        else throw res.error;
        continue;
      }
      prompted += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "stale sweep failed";
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/cron/stale-threads",
      message: `Stale-thread sweep failed: ${message}`,
      fingerprintKeys: ["cron", "stale-threads", "fail"],
      metadata: { before, prompted, skipped },
      userId: null,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  void logSystemEvent({
    // Always "info": a run that prompts nobody is a healthy heartbeat, and the
    // steady state of this job is doing nothing.
    severity: "info",
    category: "other",
    source: "GET /api/cron/stale-threads",
    message: `Proposed a close on ${prompted} thread(s) idle for ${STALE_AFTER_DAYS}d (${skipped} already prompted)`,
    fingerprintKeys: ["cron", "stale-threads", String(prompted)],
    metadata: { before, prompted, skipped },
    userId: null,
  });

  return NextResponse.json({
    ok: true,
    staleAfterDays: STALE_AFTER_DAYS,
    before,
    prompted,
    skipped,
  });
}
