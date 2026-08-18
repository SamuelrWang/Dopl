/**
 * Chat-archive methods for `DoplClient`. Agent-written: export conversation
 * summaries (`exportChat`), extend mid-session (`appendChatMessages`), read
 * back later as context (`listChats` / `getChat`).
 */
import type { DoplTransport } from "./transport.js";
import type { Chat, ChatDetail, ChatExportInput, ChatFolder, ChatFolderUpdateInput, ChatList, ChatMessageInput, ChatUpdateInput } from "./chat-types.js";
export declare function listChats(t: DoplTransport): Promise<ChatList>;
export declare function getChat(t: DoplTransport, chatId: string): Promise<ChatDetail>;
export declare function listChatFolders(t: DoplTransport): Promise<ChatFolder[]>;
export declare function exportChat(t: DoplTransport, input: ChatExportInput): Promise<ChatDetail>;
export declare function appendChatMessages(t: DoplTransport, chatId: string, messages: ChatMessageInput[]): Promise<ChatDetail>;
export declare function updateChat(t: DoplTransport, chatId: string, patch: ChatUpdateInput): Promise<Chat>;
export declare function deleteChat(t: DoplTransport, chatId: string): Promise<void>;
export declare function createChatFolder(t: DoplTransport, name: string): Promise<ChatFolder>;
export declare function updateChatFolder(t: DoplTransport, folderId: string, patch: ChatFolderUpdateInput): Promise<ChatFolder>;
export declare function deleteChatFolder(t: DoplTransport, folderId: string): Promise<void>;
