import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import * as repoMessages from "@/features/channels/server/repository-messages";
import * as repoTasks from "@/features/channels/server/repository-tasks";
import { pgErrorCode } from "@/features/channels/server/repository";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

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
 * ════════════════════════════════════════════════════════════════════════════
 * THE 2026-08-08 FIX BATCH (C-1 + C-17, F-171). Three defects lived in this one
 * route, and all three were invisible because the job has never run.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * 1. IT MEASURED THE WRONG CLOCK. It filtered on `channel_tasks.updated_at` and
 *    this docblock claimed that meant last activity. It did not: the only writer
 *    to that column is `repository-tasks.updateTask`, reached solely from close /
 *    set_mode / reopen, and `postMessage` bumps `channels.updated_at` and never
 *    the task row. So a thread with hourly traffic looked 30 days idle — the
 *    sweep fired HARDEST on the busiest threads — while `set_thread_mode` reset
 *    the clock with zero activity. It now reads `repoTasks.listStaleOpenThreads`,
 *    which derives the clock from `channel_messages` (migration `20260807160000`
 *    holds the trigger-vs-touch-vs-subquery reasoning; the short version is that
 *    a daily reader must not be paid for by every message insert forever).
 *
 * 2. IT WROTE AN AUTHOR NO AGENT COULD SEE. `author_user_id: null` plus every
 *    MCP await's `.neq("author_user_id", …)` — and SQL `NULL <> x` is NULL, not
 *    true — meant the close proposal rendered on the web card and was invisible
 *    to any agent holding an await, the exact surface `dopl_channel` teaches
 *    every agent to keep armed. THE NULL AUTHOR STAYS; the FILTER was fixed
 *    (`repository-messages.excludeAuthorFilter`). Forging an identity here would
 *    put a close proposal in the mouth of one of the two parties — who may
 *    disagree with it — and would then be invisible to precisely that party's
 *    agent, which is the wrong member to hide it from. `author_kind:'system'`
 *    with no author is the honest attribution: no person said this.
 *
 * 3. IT BYPASSED THE SERIALIZED INSERT. A raw `db.from("channel_messages")
 *    .insert(...)` skipped `channel_message_insert`, whose per-channel advisory
 *    xact lock is taken before `nextval` precisely so a reader's cursor cannot
 *    advance past a not-yet-visible lower seq and miss it permanently. A sweep
 *    posting concurrently with a live agent is exactly that race. It now goes
 *    through `repoMessages.insertMessage` like every other writer in the system.
 *
 * ONE PROMPT PER IDLE PERIOD, and it no longer STEALS the agent's. This route
 * used to restate `proposeTaskClose`'s own `client_msg_id` so the two rows would
 * collide — which is how a scheduled sweep landing first could replace an
 * agent's stated reason with "no activity for a while" on the card that renders
 * the most recent proposal (C-6). The keys are now disjoint namespaces, and the
 * real guard is upstream: `channel_tasks_stale` does not select a thread whose
 * newest message is already a close proposal, so the sweep cannot talk over a
 * live prompt, and its own proposal takes the thread out of tomorrow's
 * candidate set. The `client_msg_id` below is belt and braces behind that.
 *
 * It writes through the repositories rather than `postMessage` because the
 * service layer's whole contract is built around an acting user and this sweep
 * has none. (The messages route's schema rejects `system` from any HTTP caller,
 * which is why that lane is not reachable by anything else.)
 *
 * Auth: CRON_SECRET bearer via requireCronSecret (fail-closed 503 when unset,
 * 401 without the secret), same as the other /api/cron/* routes.
 *
 * ⚠ OPERATIONAL HISTORY (secret SET 2026-08-10; this note is how it was done).
 * `CRON_SECRET` was unset in Vercel until 2026-08-10, so every /api/cron/*
 * route answered 503 and the scheduler ran nothing — fail-closed working as
 * designed, and why none of the three defects above was ever observed. The
 * first-run risk was retired before setting it: the candidate SELECT was run
 * against production and returned ZERO rows (oldest open thread 2026-07-31),
 * so the feared first sweep was empty by measurement, not hope. The sweep now
 * runs daily at 07:00 UTC against a backlog bounded at 14+ days idle since
 * the feature shipped — and now with a clock that finally identifies those
 * correctly. The first run is therefore the largest one this job will ever have,
 * and each prompt it posts is a real message in a real shared transcript that
 * both members see and cannot un-see. `MAX_PER_RUN` caps it at 50 per run, and
 * `channel_tasks_stale` is a pure read, so the safe sequence is: run the
 * migration's verification SELECT first, read the candidate list, THEN set the
 * secret. Do not set it and read the log afterwards.
 */

/**
 * How long an open thread has to sit untouched before it is worth asking about.
 *
 * 14 days is chosen against what a thread IS rather than against a tidy number:
 * an exchange between two people's agents is normally minutes to hours, a slow
 * one runs a few days, and the ones that matter get activity. Two weeks of total
 * silence is well past any live exchange and still short enough that the prompt
 * arrives while somebody remembers the thread. It is measured from the LAST
 * ACTIVITY — really so, since 2026-08-08 — not from creation, so a long-running
 * exchange is never swept.
 */
const STALE_AFTER_DAYS = 14;

/** How many threads one run may prompt on — a bound, not a page. */
const MAX_PER_RUN = 50;

export const dynamic = "force-dynamic";

/**
 * The sweep's OWN key namespace. Deliberately not `proposeTaskClose`'s — see the
 * "no longer steals" paragraph above. Scoped by the same activity anchor the
 * agent's key uses, so a thread that resumes and later goes quiet again can be
 * prompted on again, while a re-run inside one idle period cannot double-post.
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
            // Distinguishes this from an agent's proposal for anyone reading the
            // row later. Nothing gates on it.
            staleSweep: true,
          },
          client_msg_id: sweepClientMsgId(task.id, task.anchor_seq),
        });
      } catch (err) {
        // The INSERT is the second idempotency check (the RPC propagates the
        // unique violation on `channel_messages_client_msg_key` unhandled). The
        // FIRST is the candidate query itself, which drops any thread already
        // carrying a live proposal — so reaching here at all means two runs
        // raced inside one idle period.
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
    // The cause is in the system event above; the response body carries the
    // shared sanitized envelope rather than the raw exception (ENGINEERING §9).
    return toHttpErrorResponse("api/cron/stale-threads", err);
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
