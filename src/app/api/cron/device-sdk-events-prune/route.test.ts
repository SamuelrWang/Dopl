/**
 * `GET /api/cron/device-sdk-events-prune` — CRON_SECRET-gated, prunes at the default retention,
 * reports a failure as 500 + a system event. And it is scheduled in vercel.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/shared/auth/require-cron-secret", () => ({ requireCronSecret: vi.fn(() => null) }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/features/device-sdk/server/events", () => ({
  DEFAULT_EVENT_RETENTION_DAYS: 30,
  pruneDevEvents: vi.fn(),
}));

import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { pruneDevEvents } from "@/features/device-sdk/server/events";
import { GET } from "./route";

const request = () => new NextRequest("https://dopl.test/api/cron/device-sdk-events-prune");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cron/device-sdk-events-prune", () => {
  it("prunes at the default 30-day retention and reports the count", async () => {
    vi.mocked(pruneDevEvents).mockResolvedValue(12);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 12, retention_days: 30 });
    expect(pruneDevEvents).toHaveBeenCalledWith({ retentionDays: 30 });
  });

  it("is gated by CRON_SECRET", async () => {
    vi.mocked(requireCronSecret).mockReturnValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(pruneDevEvents).not.toHaveBeenCalled();
  });

  it("answers 500 and logs a system event on failure", async () => {
    vi.mocked(pruneDevEvents).mockRejectedValue(new Error("db down"));
    expect((await GET(request())).status).toBe(500);
    expect(logSystemEvent).toHaveBeenCalledWith(expect.objectContaining({ source: "GET /api/cron/device-sdk-events-prune" }));
  });

  it("is scheduled in vercel.json", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string }[] };
    expect(vercel.crons.map((c) => c.path)).toContain("/api/cron/device-sdk-events-prune");
  });
});
