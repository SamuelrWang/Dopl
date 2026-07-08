import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
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
  const mapped = mapChatError(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  if (err instanceof Error) {
    console.error("[chat-route] unmapped error:", err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}

export function requireChatId(params: Record<string, string> | undefined): string {
  const chatId = params?.chatId;
  if (!chatId) {
    throw new HttpError(400, "MISSING_CHAT_ID", "Route param chatId is required");
  }
  return chatId;
}

export function requireFolderId(params: Record<string, string> | undefined): string {
  const folderId = params?.folderId;
  if (!folderId) {
    throw new HttpError(400, "MISSING_FOLDER_ID", "Route param folderId is required");
  }
  return folderId;
}
