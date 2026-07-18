import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import {
  ChatForbiddenError,
  ChatNotFoundError,
} from "@/features/chats/server/errors";
import { mapKnowledgeError } from "@/features/knowledge/server/http-mapping";
import { mapSkillError } from "@/features/skills/server/http-mapping";

/**
 * Catch-block helper for the cross-feature Trash routes. Because a
 * restore/purge dispatches into one of five features, the error may be any
 * feature's domain error. Chain the per-feature mappers (which each return
 * `HttpError | null`), then fall through to `HttpError` thrown directly by
 * workflows / ontology and by the dispatch's unknown-kind guard, then a
 * generic 500 so DB internals never leak (ENGINEERING §9).
 */

/**
 * The only chat domain errors restore/purge can raise (both extend the chat
 * base `Error`, not `HttpError`, so the knowledge/skill mappers leave them
 * untouched). `mapChatError` in `shared/api/chat-route` is not exported, so
 * the two relevant cases are mapped inline here.
 */
function mapChatTrashError(err: unknown): HttpError | null {
  if (err instanceof ChatNotFoundError) {
    return new HttpError(404, "CHAT_NOT_FOUND", err.message);
  }
  if (err instanceof ChatForbiddenError) {
    return new HttpError(403, "CHAT_FORBIDDEN", err.message);
  }
  return null;
}

export function toTrashErrorResponse(err: unknown): NextResponse {
  const mapped =
    mapKnowledgeError(err) ?? mapSkillError(err) ?? mapChatTrashError(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  if (err instanceof Error) {
    console.error("[trash-route] unmapped error:", err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
