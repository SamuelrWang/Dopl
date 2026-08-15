import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import * as repoMessages from "@/features/channels/server/repository-messages";
import * as repoTasks from "@/features/channels/server/repository-tasks";
import { pgErrorCode } from "@/features/channels/server/repository";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * GET /api/cron/stale-threads — daily 07:00 UTC sweep over idle open threads.
 *
 * ⚠ IT PROPOSES, IT NEVER CLOSES. Closing settles a SHARED thread for both members and is the
 * human's judgment; a cron is further from the human than an agent is, and it would fire on
 * exactly the threads with the least evidence. It writes the same non-terminal `task_progress`
 * carrying `closeProposed` that `service-tasks-propose.proposeTaskClose` writes.
 *
 * ⚠ IDLENESS COMES FROM `repoTasks.listStaleOpenThreads`, never `channel_tasks.updated_at` —
 * that column's only writer is close / set_mode / reopen, so a busy thread looks maximally idle
 * and `set_thread_mode` resets the clock with zero activity. The RPC derives it from
 * `channel_messages` (migration `20260807160000` holds the trigger-vs-subquery reasoning).
 *
 * ⚠ NULL author stays (`author_kind:'system'`, no author): forging one of the two parties would
 * put the proposal in the mouth of someone who may disagree, and hide it from that party's own
 * agent. Awaits see it because `repository-messages.excludeAuthorFilter` handles NULL.
 *
 * ⚠ Posts via `repoMessages.insertMessage`, never a raw `channel_messages` insert — the RPC's
 * per-channel advisory xact lock is taken before `nextval` so a reader's cursor cannot advance
 * past a not-yet-visible lower seq. Repositories not `postMessage`: the service layer's contract
 * needs an acting user and this sweep has none.
 *
 * ⚠ `client_msg_id` uses its OWN namespace, disjoint from `proposeTaskClose`'s — a shared key let
 * a sweep landing first replace an agent's stated reason on the card. The real guard is upstream:
 * `channel_tasks_stale` skips a thread whose newest message is already a close proposal.
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset, 401 without it).
 */

/**
 * Idle threshold. Agent-to-agent exchanges run minutes to hours, slow ones a few days; two weeks
 * of total silence is well past any live exchange and still recent enough that somebody remembers
 * the thread. Measured from LAST ACTIVITY, not creation, so a long-running exchange is never swept.
 */
const STALE_AFTER_DAYS = 14;

/** How many threads one run may prompt on — a bound, not a page. */
const MAX_PER_RUN = 50;

export const dynamic = "force-dynamic";

/**
 * Sweep's own key namespace. Scoped by the same activity anchor the agent's key uses: a thread
 * that resumes then goes quiet again can be prompted again, a re-run inside one idle period cannot.
 */
function sweepClientMsgId(taskId: string, anchorSeq: number): string {
  return `stale-swept-${taskId}-${anchorSeq}`;
}

const BODY =
  "This thread has had no activity for a while. Close it if it is done, or say something to keep it open.";

/** Postgres unique_violation — the expected, healthy re-run outcome. */
const UNIQUE_VIOLATION = "23505";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const before = new Date(
    Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  let prompted = 0;
  let skipped = 0;
  try {
    const stale = await repoTasks.listStaleOpenThreads(before, MAX_PER_RUN);

    for (const task of stale) {
      try {
        await repoMessages.insertMessage({
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
            // Marks the row as sweep-authored for later readers. Nothing gates on it.
            staleSweep: true,
          },
          client_msg_id: sweepClientMsgId(task.id, task.anchor_seq),
        });
      } catch (err) {
        // Second idempotency check (first is the candidate query, which drops threads already
        // carrying a live proposal) — reaching here means two runs raced inside one idle period.
        if (pgErrorCode(err) !== UNIQUE_VIOLATION) throw err;
        skipped += 1;
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
    // Cause is in the system event above; body carries the sanitized envelope (ENGINEERING §9).
    return toHttpErrorResponse("api/cron/stale-threads", err);
  }

  void logSystemEvent({
    // Always "info": prompting nobody is the steady state, not a failure.
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
