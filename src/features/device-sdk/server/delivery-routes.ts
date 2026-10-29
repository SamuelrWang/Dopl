import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { wiredDeviceAdapters } from "./device-adapters";
import type { ZodType } from "zod";
import type { RouteDecision } from "../types";
import type { DeliveryDeps, ServiceResult } from "./delivery-common";
import { supabaseDeliveryStore } from "./delivery-store-supabase";
import { devSdkError } from "./errors";
import { supabaseGrantStore } from "./grant-store";
import type { DeveloperKeyContext } from "./with-developer-key";

/**
 * Glue between the `/api/v1` delivery routes and the services: production deps (with a test seam),
 * body parsing in the C10 shape, and `respond`, which puts the ROUTE DECISION and the other C8 fields
 * on the call's one event row (🔒 every deliver logs `route_decision`; so does every A5 route).
 */

const productionDeps: DeliveryDeps = { store: supabaseDeliveryStore, grants: supabaseGrantStore, adapters: wiredDeviceAdapters };
let deps: DeliveryDeps = productionDeps;

export const deliveryDeps = (): DeliveryDeps => deps;

/** Test seam: swap the stores / adapters / clock (`null` restores production). */
export function setDeliveryDepsForTests(next: DeliveryDeps | null): void {
  deps = next ?? productionDeps;
}

export function respond(ctx: DeveloperKeyContext, result: ServiceResult): Response {
  ctx.event.setRouteDecision(result.decision);
  ctx.event.annotate(result.event);
  if (!result.ok) return devSdkError(result.code, result.message);
  // RFC 7240 §3: only when the preference changed something: an open ask returned without its hold.
  const headers = result.respondedAsync ? { "Preference-Applied": "respond-async" } : undefined;
  return NextResponse.json(result.body, { status: result.status, headers });
}

/**
 * `Prefer: respond-async` (RFC 7240 §4.1) on `deliver` / a device action: the caller does not want an
 * `ask.*` held for its answer; the route answers 202 at once and the caller reads the answer later
 * (`GET /v1/actions/{id}`, or the `action.completed` webhook). Token match is case-insensitive and
 * ignores parameters (`respond-async; foo=1`). Absent = the hold, exactly as before.
 */
export function prefersRespondAsync(request: Request): boolean {
  const values = request.headers.get("prefer");
  if (!values) return false;
  return values.split(",").some((pref) => pref.split(";")[0]?.trim().toLowerCase() === "respond-async");
}

/** A body that failed to parse still gets a decision row (`not routed`). */
export function refuseBody(ctx: DeveloperKeyContext, target: string, message: string, event: Record<string, unknown> = {}): Response {
  const decision: RouteDecision = { target, reason: "not routed: invalid request", candidates: [] };
  ctx.event.setRouteDecision(decision);
  ctx.event.annotate(event);
  return devSdkError("invalid_request", message);
}

export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, message: "The request body must be JSON." };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `Invalid request: ${issue?.path.join(".") || "body"} ${issue?.message ?? "is invalid"}.` };
  }
  return { ok: true, data: parsed.data };
}

/** `Idempotency-Key` header vs body `idempotency_key`: both sent → must match (openapi). */
export function headerKeyMismatch(request: NextRequest, bodyKey: string): boolean {
  const header = request.headers.get("idempotency-key");
  return header !== null && header !== bodyKey;
}
