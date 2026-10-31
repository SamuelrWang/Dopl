import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import type { Environment } from "../types";

/**
 * Shared bits for the `/api/developers/*` self-serve routes. Every one of them is
 * `withUserAuth({ sessionOnly: true })`: a developer org's members, invites and keys are the
 * credential-minting and membership class, so an agent's OAuth token never reaches them
 * (`write-gate-coverage.test.ts`). Reach and roles are decided in `portal-admin.ts`.
 */

/** A path id, or 404 (a malformed id reads the same as a missing one). */
export function pathId(value: string | undefined, what: string): string {
  if (!value || !isUuid(value)) throw new HttpError(404, "NOT_FOUND", `${what} not found`);
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

export function parseEnv(value: unknown): Environment {
  if (value !== "test" && value !== "live") throw new HttpError(400, "BAD_REQUEST", "env must be test or live");
  return value;
}

/** A body that carries a secret shown once: never cached anywhere. */
export function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** A route's handler, with anything it throws mapped to its error response. */
export function portalRoute<C>(source: string, run: (request: NextRequest, ctx: C) => Promise<Response>) {
  return async (request: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await run(request, ctx);
    } catch (err) {
      return toHttpErrorResponse(`developers/${source}`, err);
    }
  };
}

/** A query's rows, or it throws naming the operation. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, op: string): T {
  if (res.error) throw new Error(`${op} failed: ${res.error.message}`);
  return res.data as T;
}
