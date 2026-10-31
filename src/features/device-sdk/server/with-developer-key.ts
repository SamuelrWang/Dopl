import "server-only";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { RouteContextArg } from "@/shared/auth/with-auth";
import { ERROR_CODE_INFO, type ApiKeyScope, type ErrorCode, type EventOutcome, type RouteDecision } from "../types";
import { devSdkError, devSdkErrorCode } from "./errors";
import { flushDevEventsLater, logDevEvent, type DevEventInput } from "./events";
import { touchApiKeyLastUsed, verifyApiKey, type ResolvedDeveloperKey } from "./keys";

/**
 * `withDeveloperKey(handler, { scopes })` — the auth wrapper for every `/api/v1` route (C1).
 *
 *   Bearer parse → verify (keys.ts) → publishable gate → scope check → handler.
 *
 * Every refusal is the C10 shape (`errors.ts › devSdkError`): no/invalid/revoked/expired key →
 * `unauthenticated` (401); missing scope or a publishable key on a route that did not opt in →
 * `insufficient_scope` (403). `last_used_at` is bumped fire-and-forget, never awaited.
 *
 * 🔒 EVENT LOG (C8, A2): every call whose PROJECT is known writes EXACTLY ONE `dev_events` row
 * (`events.ts › logDevEvent`) — success, handler error, scope/publishable refusal, revoked or
 * expired key, and a handler that throws. A call with no key or an unknown key resolves no project
 * and logs nothing. `latency_ms.api` is measured here; a handler attaches the rest through
 * `ctx.event` (`setRouteDecision`, `annotate`). The row is never awaited on the response path;
 * the batch is flushed in `after()`.
 *
 * ⚠ PUBLISHABLE KEYS (`pk_…`) ARE REFUSED UNLESS THE ROUTE OPTS IN with `publishable: true`, and only a
 * route whose required scopes are `connect` alone may opt in (checked when the route is defined).
 * Every response carries `Request-Id` (equal to the call's `dev_events.event_id` when one is logged).
 * The ONE exception to "exactly one row" is a route defined with `logEvent: false` (the log reader).
 * Separate from `withUserAuth` on purpose: no Dopl session, no OAuth token, no cookie is read here.
 */

/** Fields a handler may set on its call's event row. Identity, outcome and `latency_ms.api` are the wrapper's. */
export type DevEventAnnotation = Omit<
  DevEventInput,
  "org_id" | "project_id" | "env" | "outcome" | "error_code" | "event_id" | "ts" | "latency_ms" | "api_key_id" | "http_method" | "route" | "http_status"
> & { latency_ms?: { device_delivery?: number | null; user_response?: number | null } };

interface DevEventHandle {
  /** C5 step 4: the routing decision and its reason. */
  setRouteDecision(decision: RouteDecision): void;
  /** Merge any other C8 field (device, capability, intent, bytes, cost, …). Later calls win. */
  annotate(fields: DevEventAnnotation): void;
}

export type DeveloperKeyContext = ResolvedDeveloperKey & { event: DevEventHandle };

interface DeveloperKeyOptions {
  /** Every scope the key must carry. `[]` = any valid key of an allowed kind. */
  scopes: readonly ApiKeyScope[];
  /** Admit publishable keys. Only legal when `scopes` is exactly `["connect"]`. */
  publishable?: boolean;
  /**
   * `false` = this route writes NO `dev_events` row, ever (refusals included). Only for routes that
   * READ the log back (`GET /v1/events`): a polling reader would otherwise flood the log it reads
   * and its own usage. Every other route leaves this unset. Ruled 2026-10-28.
   */
  logEvent?: false;
}

type DeveloperKeyHandler = (
  request: NextRequest,
  ctx: DeveloperKeyContext,
  routeContext: RouteContextArg
) => Promise<Response>;

/** `Authorization: Bearer <key>` → the key, or null. Scheme is case-insensitive (RFC 7235). */
export function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)[ ]*$/i.exec(header);
  return match ? match[1] : null;
}

const OPERATIONS: ReadonlyArray<[RegExp, string]> = [
  [/^\/users\/[^/]+\/deliver$/, "deliver"],
  [/^\/users\/[^/]+\/context$/, "context.read"],
  [/^\/users\/[^/]+\/connections$/, "connections.list"],
  [/^\/devices\/[^/]+\/actions\/[^/]+$/, "device.action"],
  [/^\/devices\/[^/]+$/, "device.read"],
  [/^\/actions\/[^/]+$/, "action.read"],
  [/^\/connect_sessions$/, "connect.session"],
  [/^\/connections\/exchange$/, "connect.exchange"],
  [/^\/connections\/[^/]+$/, "connection"],
  [/^\/webhook_/, "webhooks"],
  [/^\/test\/reset$/, "test.reset"],
  [/^\/ping$/, "ping"],
];

/** The stable name of a `/api/v1` call, so counting deliveries never parses a path. Null = unnamed route. */
export function operationOf(pathname: string): string | null {
  const path = pathname.replace(/^\/api\/v1/, "");
  return OPERATIONS.find(([re]) => re.test(path))?.[1] ?? null;
}

const MAX_ROUTE_CHARS = 256;

/** C8 outcome for a response: auth/permission refusals are `denied`, other failures `error`. */
function outcomeOf(status: number, code: ErrorCode | null): EventOutcome {
  if (status < 400) return "ok";
  const type = code ? ERROR_CODE_INFO[code].type : null;
  return type === "authentication_error" || type === "permission_error" ? "denied" : "error";
}

const byteLength = (h: string | null): number => {
  const n = h === null ? NaN : Number(h);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export function withDeveloperKey(handler: DeveloperKeyHandler, options: DeveloperKeyOptions) {
  const required = [...options.scopes];
  if (options.publishable && !(required.length === 1 && required[0] === "connect")) {
    throw new Error("withDeveloperKey: only a route requiring exactly the `connect` scope may admit publishable keys");
  }

  return async (request: NextRequest, routeContext: RouteContextArg): Promise<Response> => {
    const started = performance.now();
    // One id per call: the `Request-Id` response header AND the event row's `event_id`, so a
    // developer quoting the header finds the exact `dev_events` row.
    const requestId = randomUUID();
    const stamp = (res: Response): Response => {
      try {
        res.headers.set("Request-Id", requestId);
      } catch {
        // Immutable headers (a fetched Response): leave it unstamped rather than fail the call.
      }
      return res;
    };
    let resolved: ResolvedDeveloperKey | null = null;
    let annotation: DevEventAnnotation = {};
    const event: DevEventHandle = {
      setRouteDecision: (decision) => {
        annotation = { ...annotation, route_decision: decision };
      },
      annotate: (fields) => {
        annotation = { ...annotation, ...fields };
      },
    };

    /** The one row for this call. Skipped when no project was resolved, or the route opted out. Never throws. */
    const record = (status: number, code: ErrorCode | null, bytesOut: number) => {
      if (!resolved || options.logEvent === false) return;
      try {
        const { latency_ms, ...rest } = annotation;
        const pathname = new URL(request.url).pathname;
        logDevEvent({
          bytes_in: byteLength(request.headers.get("content-length")),
          bytes_out: bytesOut,
          operation: operationOf(pathname),
          ...rest,
          api_key_id: resolved.key.id,
          http_method: request.method,
          route: pathname.slice(0, MAX_ROUTE_CHARS),
          http_status: status,
          event_id: requestId,
          org_id: resolved.orgId,
          project_id: resolved.projectId,
          env: resolved.env,
          outcome: outcomeOf(status, code),
          error_code: code,
          latency_ms: { ...latency_ms, api: Math.max(0, Math.round(performance.now() - started)) },
        });
        flushDevEventsLater();
      } catch (err) {
        console.warn("[device-sdk] event record failed:", err);
      }
    };
    const refuse = (code: ErrorCode, message: string) => {
      const res = devSdkError(code, message);
      record(res.status, code, 0);
      return stamp(res);
    };

    const raw = readBearer(request);
    if (!raw) {
      return refuse("unauthenticated", "No API key provided. Send it as `Authorization: Bearer sk_test_…`.");
    }

    const verified = await verifyApiKey(raw);
    if (!verified.ok) {
      resolved = verified.known ?? null;
      return refuse(verified.code, verified.message);
    }
    const ctx = verified.resolved;
    resolved = ctx;

    if (ctx.key.kind === "publishable" && !options.publishable) {
      return refuse(
        "insufficient_scope",
        "Publishable keys can only create Connect sessions. Use a secret key for this route."
      );
    }
    const missing = required.filter((s) => !ctx.key.scopes.includes(s));
    if (missing.length > 0) {
      return refuse("insufficient_scope", `This API key lacks the required scope: ${missing.join(", ")}.`);
    }

    touchApiKeyLastUsed(ctx.key.id);
    let res: Response;
    try {
      res = await handler(request, { ...ctx, event }, routeContext);
    } catch (err) {
      record(500, null, 0);
      throw err;
    }
    record(res.status, devSdkErrorCode(res), byteLength(res.headers.get("content-length")));
    return stamp(res);
  };
}
