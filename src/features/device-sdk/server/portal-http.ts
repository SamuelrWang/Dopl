import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * Shared bits for the `/api/developers/*` self-serve routes (P3). Every one of them is
 * `withUserAuth({ sessionOnly: true })`: a developer org's members, invites and keys are the
 * credential-minting and membership class, so an agent's OAuth token never reaches them
 * (`write-gate-coverage.test.ts`). Reach and roles are decided in `portal-admin.ts`.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id, or 404 (a malformed id reads the same as a missing one). */
export function pathId(value: string | undefined, what: string): string {
  if (!value || !UUID.test(value)) throw new HttpError(404, "NOT_FOUND", `${what} not found`);
  return value;
}

/** The request's JSON object body, or 400. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "BAD_REQUEST", "Expected a JSON object body");
  }
  return body as Record<string, unknown>;
}

/** A body that carries a secret shown once: never cached anywhere. */
export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function portalErrorResponse(source: string, err: unknown): NextResponse {
  return toHttpErrorResponse(`developers/${source}`, err);
}
