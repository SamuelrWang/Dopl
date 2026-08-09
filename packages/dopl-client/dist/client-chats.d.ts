/**
 * Chats (archive) method group — link 7 of the chain documented in
 * `client-base.ts`. Pure delegation to `chats.ts`; no HTTP here.
 *
 * Agent-exported conversation archive. Reads return the caller's own chats
 * plus workspace-public ones; writes are owner-scoped server-side.
 */
import { OntologyMethods } from "./client-ontology.js";
import type { Chat, ChatDetail, ChatExportInput, ChatFolder, ChatFolderUpdateInput, ChatList, ChatMessageInput, ChatUpdateInput } from "./chat-types.js";
export declare class ChatMethods extends OntologyMethods {
    listChats(): Promise<ChatList>;
    getChat(chatId: string): Promise<ChatDetail>;
    exportChat(input: ChatExportInput): Promise<ChatDetail>;
    appendChatMessages(chatId: string, messages: ChatMessageInput[]): Promise<ChatDetail>;
    updateChat(chatId: string, patch: ChatUpdateInput): Promise<Chat>;
    deleteChat(chatId: string): Promise<void>;
    listChatFolders(): Promise<ChatFolder[]>;
    createChatFolder(name: string): Promise<ChatFolder>;
    updateChatFolder(folderId: string, patch: ChatFolderUpdateInput): Promise<ChatFolder>;
    deleteChatFolder(folderId: string): Promise<void>;
}
