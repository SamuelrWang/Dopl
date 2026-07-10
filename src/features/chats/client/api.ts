import { ApiError, apiRequest } from "@/shared/api/api-client";
import type {
  Chat,
  ChatAccessMode,
  ChatDetail,
  ChatFolder,
  ChatVisibility,
} from "../types";

export class ChatApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

interface RequestOpts {
  workspaceId?: string;
  body?: unknown;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ChatApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export async function fetchChat(
  chatId: string,
  workspaceId: string
): Promise<ChatDetail> {
  const data = await request<{ chat: ChatDetail }>(
    `/api/chats/${encodeURIComponent(chatId)}`,
    { workspaceId }
  );
  return data.chat;
}

export interface ChatHeaderPatch {
  visibility?: ChatVisibility;
  accessMode?: ChatAccessMode;
  /** Teams granted read access; only with visibility 'public' + accessMode 'teams'. */
  teamIds?: string[];
  pinned?: boolean;
  folderId?: string | null;
}

export async function updateChat(
  chatId: string,
  patch: ChatHeaderPatch,
  workspaceId: string
): Promise<Chat> {
  const data = await request<{ chat: Chat }>(
    `/api/chats/${encodeURIComponent(chatId)}`,
    { method: "PATCH", body: patch, workspaceId }
  );
  return data.chat;
}

export async function deleteChat(
  chatId: string,
  workspaceId: string
): Promise<void> {
  await request<void>(`/api/chats/${encodeURIComponent(chatId)}`, {
    method: "DELETE",
    workspaceId,
  });
}

export async function createChatFolder(
  name: string,
  workspaceId: string
): Promise<ChatFolder> {
  const data = await request<{ folder: ChatFolder }>("/api/chats/folders", {
    method: "POST",
    body: { name },
    workspaceId,
  });
  return data.folder;
}

export interface ChatFolderPatch {
  name?: string;
  visibility?: ChatVisibility;
  accessMode?: ChatAccessMode;
  /** Teams granted read access; only with visibility 'public' + accessMode 'teams'. */
  teamIds?: string[];
}

/** Scope changes propagate to every chat filed in the folder. */
export async function updateChatFolder(
  folderId: string,
  patch: ChatFolderPatch,
  workspaceId: string
): Promise<ChatFolder> {
  const data = await request<{ folder: ChatFolder }>(
    `/api/chats/folders/${encodeURIComponent(folderId)}`,
    { method: "PATCH", body: patch, workspaceId }
  );
  return data.folder;
}
