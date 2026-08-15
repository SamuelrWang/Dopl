/**
 * `GET /api/cron/stale-threads` — three properties:
 *   1. idleness measured from MESSAGES, not `channel_tasks.updated_at`;
 *   2. the post goes through the serialized RPC (per-channel advisory lock);
 *   3. the sweep does not wear the agent's `client_msg_id`.
 * The NULL author is deliberate; the await-side `.neq` fix is in `repository-messages.test.ts`.
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

    expect(repoTasks.listStaleOpenThreads).toHaveBeenCalledTimes(1);
    const [before, limit] = vi.mocked(repoTasks.listStaleOpenThreads).mock.calls[0];
    expect(limit).toBe(50);
    // To the day, not the millisecond — the clock must not depend on test runtime.
    const days = (Date.now() - Date.parse(before)) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("prompts on nothing when nothing is idle, and says so with a 200", async () => {
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([]);

    const res = await GET(request());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, prompted: 0 });
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("is bounded per run regardless of how large the backlog is", async () => {
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
    // The RPC's advisory xact lock precedes `nextval`; a raw insert can commit a higher seq
    // before a lower one — the hole an await cursor advances past and never returns to.
    await GET(request());
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("posts a NON-TERMINAL, system-authored close proposal", async () => {
    await GET(request());

    const row = inserted();
    expect(row?.kind).toBe("task_progress");
    expect(row?.author_kind).toBe("system");
    // ⚠ NULL author is deliberate: forging a party would hide the proposal from that party's
    // own agent (an await excludes its own author). See repository-messages.test.ts.
    expect(row?.author_user_id).toBeNull();
    expect(row?.metadata).toMatchObject({
      taskId: TASK,
      closeProposed: true,
      closeOutcome: "completed",
      staleSweep: true,
    });
  });

  it("does NOT wear the agent's proposal key (C-6: no stealing the reason)", async () => {
    // A shared key lets the sweep land first and overwrite the agent's reason on the card.
    await GET(request());

    expect(inserted()?.client_msg_id).toBe(`stale-swept-${TASK}-17`);
    expect(inserted()?.client_msg_id).not.toContain("close-proposed-");
  });

  it("keys on the activity anchor, so one idle period gets one prompt", async () => {
    // Anchor excludes proposals, so it holds still across an idle period.
    vi.mocked(repoTasks.listStaleOpenThreads).mockResolvedValue([
      staleRow({ anchor_seq: 93 }),
    ]);
    await GET(request());
    expect(inserted()?.client_msg_id).toBe(`stale-swept-${TASK}-93`);
  });
});

describe("failure handling", () => {
  it("counts a duplicate as SKIPPED, not as an error", async () => {
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
    // 23505 is a narrow allowance, not a catch-all.
    vi.mocked(repoMessages.insertMessage).mockRejectedValue(
      Object.assign(new Error("connection reset"), { code: "08006" })
    );

    const res = await GET(request());

    expect(res.status).toBe(500);
  });

  it("fails closed when the cron secret gate refuses", async () => {
    vi.mocked(requireCronSecret).mockReturnValue(
      new Response(null, { status: 503 }) as never
    );

    const res = await GET(request());

    expect(res.status).toBe(503);
    expect(repoTasks.listStaleOpenThreads).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });
});
