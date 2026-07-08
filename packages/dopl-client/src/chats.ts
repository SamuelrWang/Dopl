/**
 * Chat-archive methods for `DoplClient`.
 *
 * The archive is agent-written: agents export conversation summaries
 * into Dopl (`exportChat`), extend them mid-session (`appendChatMessages`),
 * and read them back later as context (`listChats` / `getChat`).
 */

import type { DoplTransport } from "./transport.js";
import type {
  Chat,
  ChatDetail,
  ChatExportInput,
  ChatFolder,
  ChatMessageInput,
  ChatUpdateInput,
} from "./chat-types.js";

const enc = encodeURIComponent;

// ─── Read ───────────────────────────────────────────────────────────

export async function listChats(t: DoplTransport): Promise<Chat[]> {
  const data = await t.request<{ chats: Chat[] }>("/api/chats", {
    toolName: "chat_list",
  });
  return data.chats;
}

export async function getChat(t: DoplTransport, chatId: string): Promise<ChatDetail> {
  const data = await t.request<{ chat: ChatDetail }>(`/api/chats/${enc(chatId)}`, {
    toolName: "chat_get",
  });
  return data.chat;
}

export async function listChatFolders(t: DoplTransport): Promise<ChatFolder[]> {
  const data = await t.request<{ folders: ChatFolder[] }>("/api/chats/folders", {
    toolName: "chat_folders",
  });
  return data.folders;
}

// ─── Write ──────────────────────────────────────────────────────────

export async function exportChat(
  t: DoplTransport,
  input: ChatExportInput
): Promise<ChatDetail> {
  const data = await t.request<{ chat: ChatDetail }>("/api/chats", {
    method: "POST",
    body: input,
    toolName: "chat_export",
  });
  return data.chat;
}

export async function appendChatMessages(
  t: DoplTransport,
  chatId: string,
  messages: ChatMessageInput[]
): Promise<ChatDetail> {
  const data = await t.request<{ chat: ChatDetail }>(
    `/api/chats/${enc(chatId)}/messages`,
    {
      method: "POST",
      body: { messages },
      toolName: "chat_append",
    }
  );
  return data.chat;
}

export async function updateChat(
  t: DoplTransport,
  chatId: string,
  patch: ChatUpdateInput
): Promise<Chat> {
  const data = await t.request<{ chat: Chat }>(`/api/chats/${enc(chatId)}`, {
    method: "PATCH",
    body: patch,
    toolName: "chat_update",
  });
  return data.chat;
}

export async function deleteChat(t: DoplTransport, chatId: string): Promise<void> {
  await t.requestNoContent(`/api/chats/${enc(chatId)}`, "DELETE", "chat_delete");
}

export async function createChatFolder(
  t: DoplTransport,
  name: string
): Promise<ChatFolder> {
  const data = await t.request<{ folder: ChatFolder }>("/api/chats/folders", {
    method: "POST",
    body: { name },
    toolName: "chat_folder_create",
  });
  return data.folder;
}

export async function deleteChatFolder(
  t: DoplTransport,
  folderId: string
): Promise<void> {
  await t.requestNoContent(
    `/api/chats/folders/${enc(folderId)}`,
    "DELETE",
    "chat_folder_delete"
  );
}
