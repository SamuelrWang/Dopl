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
  // PII inside dynamic SQL strings (ENGINEERING §9). The full error gets
  // logged via the auth wrapper's 5xx system_events trail.
  return toHttpErrorResponse("knowledge-route", err, mapKnowledgeError);
}
