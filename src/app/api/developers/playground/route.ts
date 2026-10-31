import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { flushDevEvents } from "@/features/device-sdk/server/events";
import { verifyApiKey } from "@/features/device-sdk/server/keys";
import { getPortalEvent, listPortalProjects } from "@/features/device-sdk/server/portal";
import { fillPath, playgroundOp } from "@/features/device-sdk/portal/playground-ops";
import { maskKey, type PlaygroundRun } from "@/features/device-sdk/portal/playground-types";
import { PLAYGROUND_DISPATCH } from "./dispatch";

export const dynamic = "force-dynamic";
/** A playground `deliver` with intent `ask` holds as long as the real route (200s). */
export const maxDuration = 300;

const TEST_SECRET = /^sk_test_[A-Za-z0-9]{16,}$/;
const QUERY_VALUE = /^[A-Za-z0-9_.:@+*-]{1,512}$/;

const RunSchema = z.object({
  project_id: z.string().refine(isUuid),
  key: z.string().min(1).max(256),
  operation: z.string().min(1).max(64),
  path_params: z.record(z.string(), z.string().max(255)).default({}),
  query: z.record(z.string(), z.string().max(512)).default({}),
  body: z.unknown().optional(),
});

/**
 * `POST /api/developers/playground` — the developer portal's playground runs ONE `/v1` call with
 * the caller's own TEST key, server side, and answers the request, the response and the event row.
 *
 * 🔒 TEST ONLY, CALLER'S OWN: the key must look like `sk_test_…`, VERIFY as a live secret key of the
 * `test` env, and belong to `project_id`, which must be one of the caller's projects
 * (`listPortalProjects`). Anything else is refused before a handler runs. A live key never runs
 * here, whatever the project.
 * 🔒 THE KEY IS NEVER STORED, LOGGED OR ECHOED: it rides in the JSON body (the session owns
 * `Authorization`), goes into the in-process request's header, and comes back only masked.
 * Errors are mapped by `toHttpErrorResponse`, which logs the route name, never the body.
 * ⚠ `sessionOnly`: a run WRITES (deliver, revoke, create a Connect session), so an agent's OAuth
 * token never reaches it (pinned in `write-gate-coverage.test.ts`).
 * The call itself is the REAL handler (`dispatch.ts`) called in process: same key check, scopes,
 * rate limits and event row as a call from the developer's server.
 */
export const POST = withUserAuth(async (request, { userId }) => {
  try {
    const parsed = RunSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "INVALID_REQUEST", "Pick a project, an operation and paste a test key.");
    const input = parsed.data;

    const op = playgroundOp(input.operation);
    const dispatch = op ? PLAYGROUND_DISPATCH[op.id] : undefined;
    if (!op || !dispatch) throw new HttpError(400, "UNKNOWN_OPERATION", "That operation is not in the playground.");
    if (!TEST_SECRET.test(input.key)) {
      throw new HttpError(400, "TEST_KEY_ONLY", "The playground runs with a test secret key (sk_test_…) only.");
    }

    const [projects, verified] = await Promise.all([listPortalProjects(userId), verifyApiKey(input.key)]);
    if (!projects.some((p) => p.id === input.project_id)) throw new HttpError(404, "NOT_FOUND", "Project not found");
    if (
      !verified.ok ||
      verified.resolved.projectId !== input.project_id ||
      verified.resolved.env !== "test" ||
      verified.resolved.key.kind !== "secret"
    ) {
      throw new HttpError(403, "KEY_NOT_IN_PROJECT", "That key is not an active test secret key of this project.");
    }

    const filled = fillPath(op, input.path_params);
    if (!filled.ok) throw new HttpError(400, "INVALID_PATH", filled.message);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(input.query)) {
      if (v === "") continue;
      if (!op.query.includes(k) || !QUERY_VALUE.test(v)) throw new HttpError(400, "INVALID_QUERY", `Check the ${k} value.`);
      q.set(k, v);
    }
    const path = `${filled.path}${q.size > 0 ? `?${q.toString()}` : ""}`;

    let body: unknown = undefined;
    let idempotencyKey: string | null = null;
    if (op.body !== null) {
      if (input.body === undefined || input.body === null || typeof input.body !== "object" || Array.isArray(input.body)) {
        throw new HttpError(400, "INVALID_BODY", "The body must be a JSON object.");
      }
      const b = { ...(input.body as Record<string, unknown>) };
      if (op.idempotent && b.idempotency_key === undefined) b.idempotency_key = randomUUID();
      if (op.idempotent && typeof b.idempotency_key === "string") idempotencyKey = b.idempotency_key;
      body = b;
    }

    const headers = new Headers({ authorization: `Bearer ${input.key}` });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const inner = new NextRequest(new URL(`/api/v1${path}`, request.nextUrl.origin), {
      method: op.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const started = performance.now();
    const res = await dispatch.handler(inner, { params: Promise.resolve(dispatch.segments(input.path_params)) });
    const durationMs = Math.round(performance.now() - started);
    const text = await res.text();
    let resBody: unknown = text;
    try {
      resBody = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: show it as text.
    }

    // The handler queued its event row; write it now so the run can show it.
    await flushDevEvents();
    const requestId = res.headers.get("request-id");
    const event = requestId && isUuid(requestId) ? await getPortalEvent(requestId, [input.project_id]) : null;

    const run: PlaygroundRun = {
      request: { method: op.method, path: `/v1${path}`, authorization: `Bearer ${maskKey(input.key)}`, idempotencyKey, body: body ?? null },
      response: { status: res.status, requestId, durationMs, body: resBody },
      event,
    };
    return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toHttpErrorResponse("developers/playground", err);
  }
}, { sessionOnly: true });
