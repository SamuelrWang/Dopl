import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { mapKnowledgeError } from "@/features/knowledge/server/http-mapping";

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
  const mapped = mapKnowledgeError(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  // Don't leak the raw error message to the client — could expose DB
  // internals, file paths, or PII inside dynamic SQL strings (ENGINEERING
  // §9). The full error gets logged via the auth wrapper's 5xx
  // system_events trail; clients see a generic 500.
  if (err instanceof Error) {
    console.error("[knowledge-route] unmapped error:", err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
