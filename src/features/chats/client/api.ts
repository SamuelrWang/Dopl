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
  const headers: Record<string, string> = {};
  if (opts.workspaceId) headers["x-workspace-id"] = opts.workspaceId;
  if (opts.body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(path, {
    headers,
    method: opts.method ?? "GET",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include",
  });

  if (res.status === 204) return undefined as unknown as T;
  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    let message = `Request failed with ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body?.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {}
    throw new ChatApiError(res.status, code, message);
  }
  return (await res.json()) as T;
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
