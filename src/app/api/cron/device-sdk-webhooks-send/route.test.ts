/**
 * `GET /api/cron/device-sdk-webhooks-send` — CRON_SECRET-gated, one sender run within the cron
 * budget, failure = 500 + a system event. Scheduled every minute in vercel.json.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/shared/auth/require-cron-secret", () => ({ requireCronSecret: vi.fn(() => null) }));
vi.mock("@/features/analytics/server/system-events", () => ({ logSystemEvent: vi.fn() }));
vi.mock("@/features/device-sdk/server/webhooks/runtime", () => ({
  CRON_BUDGET_MS: 40_000,
  runWebhookSenderNow: vi.fn(),
}));

import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { runWebhookSenderNow } from "@/features/device-sdk/server/webhooks/runtime";
import { GET } from "./route";

const request = () => new NextRequest("https://dopl.test/api/cron/device-sdk-webhooks-send");

beforeEach(() => vi.clearAllMocks());

describe("GET /api/cron/device-sdk-webhooks-send", () => {
  it("runs the sender within the cron budget and reports", async () => {
    vi.mocked(runWebhookSenderNow).mockResolvedValue({ fannedOut: 2, attempted: 3, delivered: 2, retrying: 1, deadLettered: 0 });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, fannedOut: 2, attempted: 3, delivered: 2, retrying: 1, deadLettered: 0 });
    expect(runWebhookSenderNow).toHaveBeenCalledWith(40_000);
  });

  it("is gated by CRON_SECRET", async () => {
    vi.mocked(requireCronSecret).mockReturnValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(runWebhookSenderNow).not.toHaveBeenCalled();
  });

  it("answers 500 and logs a system event on failure", async () => {
    vi.mocked(runWebhookSenderNow).mockRejectedValue(new Error("db down"));
    expect((await GET(request())).status).toBe(500);
    expect(logSystemEvent).toHaveBeenCalledWith(expect.objectContaining({ source: "GET /api/cron/device-sdk-webhooks-send" }));
  });

  it("is scheduled every minute in vercel.json", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toContainEqual({ path: "/api/cron/device-sdk-webhooks-send", schedule: "* * * * *" });
  });
});
