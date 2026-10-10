import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { NOTIFICATION_EVENT_IDS } from "@/features/notifications/registry";
import {
  NotificationPrefsUnavailable,
  readNotificationPrefs,
  writeNotificationPrefs,
} from "@/features/notifications/server/repository";

/**
 * GET / PUT /api/user/notification-preferences — the caller's own record, global switches.
 *
 * ⚠ THIS IS NOW THE ONLY HOME OF THE RECORD (2026-10-09): the Notifications tab
 * (`stores/api-store.ts`) and the desktop's banner gate both read it here.
 * ⚠ The table (migration 20261117120000) is WRITTEN, NOT APPLIED: until it is, both verbs answer
 * 503 `NOT_AVAILABLE`, which every caller reads as "no record to honor" = every banner ON.
 *
 * `event_type` has no CHECK in the table by design; the registry is the domain, enforced by the
 * zod schema below (derived from it) and again in `server/repository.ts`.
 */

const EventsSchema = z.object(
  Object.fromEntries(NOTIFICATION_EVENT_IDS.map((id) => [id, z.boolean().optional()])) as Record<
    (typeof NOTIFICATION_EVENT_IDS)[number],
    z.ZodOptional<z.ZodBoolean>
  >
);
const PutSchema = z.object({ prefs: z.object({ events: EventsSchema }) });

function toResponse(err: unknown): NextResponse {
  if (err instanceof NotificationPrefsUnavailable) {
    return NextResponse.json(
      new HttpError(503, "NOT_AVAILABLE", "Notification settings are not available yet").toResponseBody(),
      { status: 503 }
    );
  }
  return toHttpErrorResponse("api/user/notification-preferences", err);
}

async function handleGet(_request: NextRequest, context: { userId: string }) {
  try {
    return NextResponse.json({ prefs: await readNotificationPrefs(context.userId) });
  } catch (err) {
    return toResponse(err);
  }
}

async function handlePut(request: NextRequest, context: { userId: string }) {
  try {
    const input = await parseJson(request, PutSchema);
    const prefs = await writeNotificationPrefs(context.userId, {
      v: 1,
      events: input.prefs.events as Record<(typeof NOTIFICATION_EVENT_IDS)[number], boolean>,
    });
    return NextResponse.json({ prefs });
  } catch (err) {
    return toResponse(err);
  }
}

export const GET = withUserAuth(handleGet);
export const PUT = withUserAuth(handlePut);
