import "server-only";
import { NextResponse } from "next/server";
import { mapKnowledgeError } from "@/features/knowledge/server/http-mapping";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * Knowledge-feature catch-block helper. Translates domain errors via
 * `mapKnowledgeError`, falls through to `HttpError` directly (e.g. from
 * `parseJson`), and returns a generic 500 for anything else.
 *
 * Mirrors `toErrorResponse` in clusters/route.ts but layered so the
 * knowledge-specific mapping runs first.
 */
/**
 * Builds an attachment `Response` for knowledge exports (zip archives,
 * single `.md` files). `filename` is expected to be slug-safe ASCII
 * (it comes from `slugify`), so it's embedded directly in the
 * `Content-Disposition` header without RFC 5987 encoding.
 */
export function knowledgeDownloadResponse(
  filename: string,
  body: Uint8Array | string,
  contentType: string
): Response {
  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "no-store",
  };
  if (typeof body === "string") return new Response(body, { headers });
  // Copy into a fresh ArrayBuffer-backed view: fflate hands back a
  // `Uint8Array<ArrayBufferLike>`, which the DOM lib won't accept as a
  // `BodyInit` (it could be SharedArrayBuffer-backed). The copy is
  // cheap for download-sized payloads.
  const bytes = new Uint8Array(body);
  headers["content-length"] = String(bytes.byteLength);
  return new Response(bytes, { headers });
}

export function toKnowledgeErrorResponse(err: unknown): NextResponse {
  // Domain errors map first; anything unrecognized falls through to the
  // shared HttpError pass-through / generic 500. The raw error is never
  // leaked to the client — it could expose DB internals, file paths, or
  // PII inside dynamic SQL strings (ENGINEERING §9).
  //
  // WHERE THE CAUSE ACTUALLY GOES, corrected (2026-08-08). This used to claim
  // "the full error gets logged via the auth wrapper's 5xx system_events
  // trail". It does not. These tails RETURN their 500 rather than throwing it,
  // and `runAndLog5xx` only reaches its error-bearing branch on a THROWN
  // escape — a returned 500 takes the response branch, which writes
  // `"5xx response: 500"` and a `status_code` and nothing else. So
  // `system_events` records THAT a 500 happened, never WHY. The only place the
  // cause exists is the `console.error` in `toHttpErrorResponse`, which is
  // process stdout: fine in a tailed dev log, gone once the platform's log
  // retention rolls. Diagnosing one of these from the durable trail alone is
  // not possible; that is a known gap, not a compensating control.
  return toHttpErrorResponse("knowledge-route", err, mapKnowledgeError);
}
