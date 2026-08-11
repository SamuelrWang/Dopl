"use strict";
/**
 * Chats (archive) method group — link 5 of the chain documented in
 * `client-base.ts`. Pure delegation to `chats.ts`; no HTTP here.
 *
 * Agent-exported conversation archive. Reads return the caller's own chats
 * plus workspace-public ones; writes are owner-scoped server-side.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatMethods = void 0;
const client_ontology_js_1 = require("./client-ontology.js");
const chats = __importStar(require("./chats.js"));
class ChatMethods extends client_ontology_js_1.OntologyMethods {
    listChats() {
        return chats.listChats(this.transport);
    }
    getChat(chatId) {
        return chats.getChat(this.transport, chatId);
    }
    exportChat(input) {
        return chats.exportChat(this.transport, input);
    }
    appendChatMessages(chatId, messages) {
        return chats.appendChatMessages(this.transport, chatId, messages);
    }
    updateChat(chatId, patch) {
        return chats.updateChat(this.transport, chatId, patch);
    }
    deleteChat(chatId) {
        return chats.deleteChat(this.transport, chatId);
    }
    listChatFolders() {
        return chats.listChatFolders(this.transport);
    }
    createChatFolder(name) {
        return chats.createChatFolder(this.transport, name);
    }
    updateChatFolder(folderId, patch) {
        return chats.updateChatFolder(this.transport, folderId, patch);
    }
    deleteChatFolder(folderId) {
        return chats.deleteChatFolder(this.transport, folderId);
    }
}
exports.ChatMethods = ChatMethods;
