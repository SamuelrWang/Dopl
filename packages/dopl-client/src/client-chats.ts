/**
 * Chats (archive) method group — link 7 of the chain documented in
 * `client-base.ts`. Pure delegation to `chats.ts`; no HTTP here.
 *
 * Agent-exported conversation archive. Reads return the caller's own chats
 * plus workspace-public ones; writes are owner-scoped server-side.
 */

import { OntologyMethods } from "./client-ontology.js";
import * as chats from "./chats.js";
import type {
  Chat,
  ChatDetail,
  ChatExportInput,
  ChatFolder,
  ChatFolderUpdateInput,
  ChatList,
  ChatMessageInput,
  ChatUpdateInput,
} from "./chat-types.js";

export class ChatMethods extends OntologyMethods {
  listChats(): Promise<ChatList> {
    return chats.listChats(this.transport);
  }

  getChat(chatId: string): Promise<ChatDetail> {
    return chats.getChat(this.transport, chatId);
  }

  exportChat(input: ChatExportInput): Promise<ChatDetail> {
    return chats.exportChat(this.transport, input);
  }

  appendChatMessages(
    chatId: string,
    messages: ChatMessageInput[]
  ): Promise<ChatDetail> {
    return chats.appendChatMessages(this.transport, chatId, messages);
  }

  updateChat(chatId: string, patch: ChatUpdateInput): Promise<Chat> {
    return chats.updateChat(this.transport, chatId, patch);
  }

  deleteChat(chatId: string): Promise<void> {
    return chats.deleteChat(this.transport, chatId);
  }

  listChatFolders(): Promise<ChatFolder[]> {
    return chats.listChatFolders(this.transport);
  }

  createChatFolder(name: string): Promise<ChatFolder> {
    return chats.createChatFolder(this.transport, name);
  }

  updateChatFolder(
    folderId: string,
    patch: ChatFolderUpdateInput
  ): Promise<ChatFolder> {
    return chats.updateChatFolder(this.transport, folderId, patch);
  }

  deleteChatFolder(folderId: string): Promise<void> {
    return chats.deleteChatFolder(this.transport, folderId);
  }
}
