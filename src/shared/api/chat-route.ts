import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { isUuid } from "@/shared/lib/id/uuid";
import {
  ChatFolderConflictError,
  ChatFolderNotFoundError,
  ChatFolderScopeError,
  ChatForbiddenError,
  ChatNotFoundError,
} from "@/features/chats/server/errors";

function mapChatError(err: unknown): HttpError | null {
  if (err instanceof ChatNotFoundError) {
    return new HttpError(404, "CHAT_NOT_FOUND", err.message);
  }
  if (err instanceof ChatFolderNotFoundError) {
    return new HttpError(404, "CHAT_FOLDER_NOT_FOUND", err.message);
  }
  if (err instanceof ChatForbiddenError) {
    return new HttpError(403, "CHAT_FORBIDDEN", err.message);
  }
  if (err instanceof ChatFolderConflictError) {
    return new HttpError(409, "CHAT_FOLDER_CONFLICT", err.message);
  }
  if (err instanceof ChatFolderScopeError) {
    return new HttpError(409, "CHAT_FOLDER_SCOPE", err.message);
  }
  return null;
}

export function toChatErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("chat-route", err, mapChatError);
}

/**
 * Extract + validate the `[chatId]` dynamic param.
 *
 * ⚠ The shape check is not cosmetic, and it is the same ruling
 * `channel-route.ts › requireConsentId` carries: `chats.id` is a `UUID PRIMARY
 * KEY` (`20260707170000_chats.sql`) reached unguarded at
 * `chats/server/repository.ts › .eq("id", chatId)`, so a non-UUID arrives at
 * Postgres as a 22P02 cast failure — a generic 500 plus a `system_events` row on
 * EVERY such call. Malformed collapses to the SAME 404 (and the same wording) a
 * missing or foreign id gets, so ids cannot be probed.
 */
export function requireChatId(params: Record<string, string> | undefined): string {
  const chatId = params?.chatId;
  if (!chatId) {
    throw new HttpError(400, "MISSING_CHAT_ID", "Route param chatId is required");
  }
  if (!isUuid(chatId)) {
    throw new HttpError(404, "CHAT_NOT_FOUND", `Chat not found: ${chatId}`);
  }
  return chatId;
}

/** Extract + validate the `[folderId]` dynamic param. ⚠ Same rationale as
 *  `requireChatId` — `chat_folders.id` is a `UUID PRIMARY KEY` and the folder
 *  reads filter on it directly (`repository.ts › .eq("id", folderId)`). */
export function requireFolderId(params: Record<string, string> | undefined): string {
  const folderId = params?.folderId;
  if (!folderId) {
    throw new HttpError(400, "MISSING_FOLDER_ID", "Route param folderId is required");
  }
  if (!isUuid(folderId)) {
    throw new HttpError(
      404,
      "CHAT_FOLDER_NOT_FOUND",
      `Chat folder not found: ${folderId}`
    );
  }
  return folderId;
}
