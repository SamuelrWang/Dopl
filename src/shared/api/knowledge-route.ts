import "server-only";
import { NextResponse } from "next/server";
import { mapKnowledgeError } from "@/features/knowledge/server/http-mapping";
import { KnowledgeStorageLimitError } from "@/features/knowledge/server/errors";
import { kbStorageDeniedBody } from "@/features/knowledge/server/service-storage";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/**
 * Attachment `Response` for knowledge exports (zip archives, single `.md`).
 * ⚠ `filename` must be slug-safe ASCII (it comes from `slugify`) — it is
 * embedded directly in `Content-Disposition` without RFC 5987 encoding.
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
  // ⚠ Copy into a fresh ArrayBuffer-backed view: fflate returns
  // `Uint8Array<ArrayBufferLike>`, which the DOM lib rejects as `BodyInit`
  // (could be SharedArrayBuffer-backed).
  const bytes = new Uint8Array(body);
  headers["content-length"] = String(bytes.byteLength);
  return new Response(bytes, { headers });
}

/** Knowledge catch-block helper: domain errors via `mapKnowledgeError`, then
 *  `HttpError` pass-through, then a generic 500. */
export function toKnowledgeErrorResponse(err: unknown): NextResponse {
  // ⚠ PLAN GATE FIRST, deliberately skipping `mapKnowledgeError`. The per-KB
  // storage cap answers with the FLAT `{ error, message, upgrade_url }` at 403
  // (same shape/status as the ontology object cap) because `@dopl/client` and
  // MCP `respond.ts › entitlementDenied` parse that shape, not the nested one
  // `HttpError.toResponseBody()` emits. Handled HERE so all three entry-write
  // surfaces (POST entries, PATCH entry, PUT files-by-path) cannot drift.
  if (err instanceof KnowledgeStorageLimitError) {
    return NextResponse.json(kbStorageDeniedBody(err), { status: 403 });
  }
  // ⚠ The raw error is never leaked to the client — it can expose DB internals,
  // file paths, or PII inside dynamic SQL strings (ENGINEERING §9).
  // ⚠ KNOWN GAP: these tails RETURN their 500 rather than throwing, so
  // `runAndLog5xx` takes its response branch and `system_events` records THAT a
  // 500 happened, never WHY. The cause exists only in `toHttpErrorResponse`'s
  // `console.error` (process stdout, gone once log retention rolls).
  return toHttpErrorResponse("knowledge-route", err, mapKnowledgeError);
}
