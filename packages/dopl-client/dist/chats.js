"use strict";
/**
 * Chat-archive methods for `DoplClient`.
 *
 * The archive is agent-written: agents export conversation summaries
 * into Dopl (`exportChat`), extend them mid-session (`appendChatMessages`),
 * and read them back later as context (`listChats` / `getChat`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChats = listChats;
exports.getChat = getChat;
exports.listChatFolders = listChatFolders;
exports.listChatsTrash = listChatsTrash;
exports.exportChat = exportChat;
exports.appendChatMessages = appendChatMessages;
exports.updateChat = updateChat;
exports.deleteChat = deleteChat;
exports.restoreChat = restoreChat;
exports.createChatFolder = createChatFolder;
exports.updateChatFolder = updateChatFolder;
exports.deleteChatFolder = deleteChatFolder;
const enc = encodeURIComponent;
// ─── Read ───────────────────────────────────────────────────────────
async function listChats(t) {
    const data = await t.request("/api/chats", { toolName: "chat_list" });
    return { chats: data.chats, hiddenCount: data.hiddenCount ?? 0 };
}
async function getChat(t, chatId) {
    const data = await t.request(`/api/chats/${enc(chatId)}`, {
        toolName: "chat_get",
    });
    return data.chat;
}
async function listChatFolders(t) {
    const data = await t.request("/api/chats/folders", {
        toolName: "chat_folders",
    });
    return data.folders;
}
async function listChatsTrash(t) {
    const data = await t.request("/api/chats/trash", {
        toolName: "chat_list_trash",
    });
    return data.chats;
}
// ─── Write ──────────────────────────────────────────────────────────
async function exportChat(t, input) {
    const data = await t.request("/api/chats", {
        method: "POST",
        body: input,
        toolName: "chat_export",
    });
    return data.chat;
}
async function appendChatMessages(t, chatId, messages) {
    const data = await t.request(`/api/chats/${enc(chatId)}/messages`, {
        method: "POST",
        body: { messages },
        toolName: "chat_append",
    });
    return data.chat;
}
async function updateChat(t, chatId, patch) {
    const data = await t.request(`/api/chats/${enc(chatId)}`, {
        method: "PATCH",
        body: patch,
        toolName: "chat_update",
    });
    return data.chat;
}
async function deleteChat(t, chatId) {
    await t.requestNoContent(`/api/chats/${enc(chatId)}`, "DELETE", "chat_delete");
}
async function restoreChat(t, chatId) {
    const data = await t.request(`/api/chats/${enc(chatId)}/restore`, { method: "POST", toolName: "chat_restore" });
    return data.chat;
}
async function createChatFolder(t, name) {
    const data = await t.request("/api/chats/folders", {
        method: "POST",
        body: { name },
        toolName: "chat_folder_create",
    });
    return data.folder;
}
async function updateChatFolder(t, folderId, patch) {
    const data = await t.request(`/api/chats/folders/${enc(folderId)}`, {
        method: "PATCH",
        body: patch,
        toolName: "chat_folder_update",
    });
    return data.folder;
}
async function deleteChatFolder(t, folderId) {
    await t.requestNoContent(`/api/chats/folders/${enc(folderId)}`, "DELETE", "chat_folder_delete");
}
