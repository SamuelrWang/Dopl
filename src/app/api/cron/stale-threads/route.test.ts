/**
 * `GET /api/cron/stale-threads` — C-1 + C-17, the three defects that lived in
 * one route (2026-08-08, F-171).
 *
 * WHY THIS FILE EXISTS AT ALL. The audit's headline finding about this job was
 * not any individual bug, it was that NONE of them had a test — and could not
 * have been caught in production either, because `CRON_SECRET` was unset in
 * Vercel until 2026-08-10, so every `/api/cron/*` route answered 503 and this
 * sweep had never run.
 * A job whose first real execution could be its largest (a 14-day backlog, with a
 * clock that only now identifies it correctly) posting real messages into real
 * shared transcripts is exactly the shape that needs its behaviour pinned
 * BEFORE the variable is set, not observed after.
 *
 * The three properties, each of which was false:
 *   1. IDLENESS IS MEASURED FROM MESSAGES, not `channel_tasks.updated_at` —
 *      whose only writer is close / set_mode / reopen, so a thread with hourly
 *      traffic looked 30 days idle and `set_thread_mode` reset the clock with
 *      zero activity;
 *   2. THE POST GOES THROUGH THE SERIALIZED RPC, whose per-channel advisory
 *      lock is the reason an await cursor cannot skip a lower seq;
 *   3. THE SWEEP DOES NOT WEAR THE AGENT'S KEY, so it can never land first and
 *      replace an agent's stated reason with "no activity for a while".
 *
 * The NULL author it writes is deliberate and is pinned here as such; the half
 * of C-17 that was actually wrong (an await's `.neq` dropping NULL rows) is
 * fixed and tested in `repository-messages.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/auth/require-cron-secret", () => ({
  requireCronSecret: vi.fn(() => null),
}));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));
vi.mock("@/features/channels/server/repository-messages");
vi.mock("@/features/channels/server/repository-tasks");

import { NextRequest } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import * as repoMessages from "@/features/channels/server/repository-messages";
import * as repoTasks from "@/features/channels/server/repository-tasks";
import type { StaleThreadRow } from "@/features/channels/server/repository-tasks";
import { GET } from "./route";

const TASK = "660e8400-e29b-41d4-a716-446655440111";
const request = () => new NextRequest("https://dopl.test/api/cron/stale-threads");

function staleRow(overrides: Partial<StaleThreadRow> = {}): StaleThreadRow {
  return {
    id: TASK,
    channel_id: "chan-1",
    workspace_id: "ws-1",
    title: "Ship the migration",
    last_activity_at: "2026-07-01T00:00:00Z",
    anchor_seq: 17,
    ...overrides,
  };
}

/** The one insert a run made, or undefined when it wrote nothing. */
function inserted() {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0]?.[0];
}

/** A PostgREST-shaped unique violation on `channel_messages_client_msg_key`. */
function uniqueViolation() {
  return Object.assign(new Error("duplicate key value"), { code: "23505" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCronSecret).mockReturnValue(null);
  vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([staleRow()]);
  vi.mocked(repoMessages.insertMessage).mockResolvedValue(
    {} as Awaited<ReturnType<typeof repoMessages.insertMessage>>
  );
});

describe("the activity clock (C-1)", () => {
  it("asks for stale threads by MESSAGE activity, never channel_tasks.updated_at", async () => {
    await GET(request());

    // `listStaleOpenThreads` is the only read, and it is an RPC over
    // `channel_messages`. The route holds no `updated_at` query of its own —
    // that column means "this row was modified" (close / set_mode / reopen) and
    // is equal to `created_at` for every thread that was never closed.
    expect(repoTasks.listStaleOpenThreads).toHaveBeenCalledTimes(1);
    const [before, limit] = vi.mocked(repoTasks.listStaleOpenThreads).mock.calls[0];
    expect(limit).toBe(50);
    // 14 days back, to the day — not to the millisecond, so the clock does not
    // depend on how long the test took to get here.
    const days = (Date.now() - Date.parse(before)) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("prompts on nothing when nothing is idle, and says so with a 200", async () => {
    // The steady state of this job is doing nothing, which must not read as a
    // failure to whoever is watching the log after turning it on.
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([]);

    const res = await GET(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, prompted: 0 });
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("is bounded per run regardless of how large the backlog is", async () => {
    // The first real run is against a 14-day backlog that has never been swept.
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => staleRow({ id: `task-${i}` }))
    );

    const res = await GET(request());

    await expect(res.json()).resolves.toMatchObject({ prompted: 50 });
    expect(vi.mocked(repoTasks.listStaleOpenThreads).mock.calls[0][1]).toBe(50);
  });
});

describe("the write (C-17)", () => {
  it("goes through the SERIALIZED insert, not a raw table insert", async () => {
    // `insertMessage` is the `channel_message_insert` RPC, whose per-channel
    // advisory xact lock is taken BEFORE `nextval`. The raw insert this replaces
    // could commit a higher seq before a lower one, which is precisely the hole
    // an await cursor advances past and never comes back to.
    await GET(request());
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("posts a NON-TERMINAL, system-authored close proposal", async () => {
    await GET(request());

    const row = inserted();
    expect(row?.kind).toBe("task_progress");
    expect(row?.author_kind).toBe("system");
    // THE NULL AUTHOR IS DELIBERATE and stays. No person said this, and forging
    // one of the two parties would put a close proposal in the mouth of somebody
    // who may disagree with it — and would then hide it from exactly that
    // party's agent, since an await excludes its own author. The half of C-17
    // that was wrong is the FILTER (see repository-messages.test.ts).
    expect(row?.author_user_id).toBeNull();
    expect(row?.metadata).toMatchObject({
      taskId: TASK,
      closeProposed: true,
      closeOutcome: "completed",
      staleSweep: true,
    });
  });

  it("does NOT wear the agent's proposal key (C-6: no stealing the reason)", async () => {
    // Sharing the key is how a scheduled sweep could land first and have the
    // card — which renders the MOST RECENT proposal — show "no activity for a
    // while" where the agent's own reason belonged.
    await GET(request());

    expect(inserted()?.client_msg_id).toBe(`stale-swept-${TASK}-17`);
    expect(inserted()?.client_msg_id).not.toContain("close-proposed-");
  });

  it("keys on the activity anchor, so one idle period gets one prompt", async () => {
    // The anchor does not move while a thread is idle (it excludes proposals),
    // so a re-run inside the same idle period recomputes the same key. A thread
    // that resumes and later goes quiet again gets a new anchor and may be
    // prompted again — which is the honest behaviour, not a leak.
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([
      staleRow({ anchor_seq: 93 }),
    ]);
    await GET(request());
    expect(inserted()?.client_msg_id).toBe(`stale-swept-${TASK}-93`);
  });
});

describe("failure handling", () => {
  it("counts a duplicate as SKIPPED, not as an error", async () => {
    // 23505 is the healthy outcome of two runs racing inside one idle period.
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(uniqueViolation());

    const res = await GET(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ prompted: 0, skipped: 1 });
  });

  it("a duplicate on one thread does not abort the rest of the run", async () => {
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([
      staleRow({ id: "task-a" }),
      staleRow({ id: "task-b" }),
      staleRow({ id: "task-c" }),
    ]);
    vi.mocked(repoMessages.insertMessage)
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValue({} as Awaited<ReturnType<typeof repoMessages.insertMessage>>);

    const res = await GET(request());

    await expect(res.json()).resolves.toMatchObject({ prompted: 2, skipped: 1 });
  });

  it("surfaces a REAL error as a 500 instead of swallowing it as a skip", async () => {
    // The 23505 branch is a narrow allowance, not a catch-all: a sweep that
    // silently reported success while writing nothing is how this job would go
    // back to being invisible.
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(
      Object.assign(new Error("connection reset"), { code: "08006" })
    );

    const res = await GET(request());

    expect(res.status).toBe(500);
  });

  it("fails closed when the cron secret gate refuses", async () => {
    // This was the branch EVERY run took until 2026-08-10 (secret unset in
    // Vercel) — the reason none of the above was ever observed in production.
    // The secret is set now; this pins the fail-closed shape for the next
    // environment that lacks it (preview, local).
    vi.mocked(requireCronSecret).mockReturnValue(
      new Response(null, { status: 503 }) as never
    );

    const res = await GET(request());

    expect(res.status).toBe(503);
    expect(repoTasks.listStaleOpenThreads).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});
