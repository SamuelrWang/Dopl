import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Generic catch-block helper for features whose services throw
 * `HttpError` directly (no domain-error mapping layer). Unmapped
 * errors are logged server-side and returned as a generic 500 so DB
 * internals never leak to the client (ENGINEERING §9).
 */
export function toHttpErrorResponse(source: string, err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  if (err instanceof Error) {
    console.error(`[${source}] unmapped error:`, err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
