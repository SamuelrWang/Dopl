import { NextResponse } from "next/server";
import { checkAndRecordRateLimitSubject } from "@/shared/auth/mcp-session";
import { devSdkError } from "@/features/device-sdk/server/errors";
import { EVENTS_READS_PER_MINUTE, listPublicEvents, parseEventListQuery } from "@/features/device-sdk/server/public-events";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/events` (spec `listEvents`, ruled 2026-10-28): the key's own project + env request
 * log, newest first, as `PublicDeviceEvent` under the shared list envelope.
 *
 * Secret key, scope `analytics:read`. `logEvent: false`: reading the log writes no `dev_events` row
 * (refusals included), so a poller neither floods the log nor counts as usage. Rate limited per key
 * id through the shared subject limiter (`mcp-session.ts`), key-scoped subject `devsdk-events:<id>`.
 */
export const GET = withDeveloperKey(
  async (request, ctx) => {
    const within = await checkAndRecordRateLimitSubject(
      `devsdk-events:${ctx.key.id}`,
      EVENTS_READS_PER_MINUTE,
      "GET /api/v1/events"
    );
    if (!within) {
      const res = devSdkError("rate_limited", "Too many log reads for this key. Try again in a minute.");
      res.headers.set("Retry-After", "60");
      return res;
    }
    const parsed = parseEventListQuery(request.nextUrl.searchParams, new Date());
    if (!parsed.ok) return devSdkError("invalid_request", parsed.message);
    const page = await listPublicEvents({ projectId: ctx.projectId, env: ctx.env, query: parsed.query });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  },
  { scopes: ["analytics:read"], logEvent: false }
);
