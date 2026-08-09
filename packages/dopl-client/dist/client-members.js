"use strict";
/**
 * Members / teams / access method group (READ-ONLY) — link 8 of the chain
 * documented in `client-base.ts`. Pure delegation to `members.ts`; no HTTP
 * here.
 *
 * Membership, team, and access changes are human decisions made in the web
 * UI — this client deliberately exposes no write path.
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
exports.MemberMethods = void 0;
const client_chats_js_1 = require("./client-chats.js");
const members = __importStar(require("./members.js"));
class MemberMethods extends client_chats_js_1.ChatMethods {
    getMyMembership() {
        return members.getMyMembership(this.transport);
    }
    listWorkspaceMembers() {
        return members.listMembers(this.transport);
    }
    listWorkspaceTeams() {
        return members.listTeams(this.transport);
    }
    getAccessMatrix() {
        return members.getAccessMatrix(this.transport);
    }
    getMyAccess() {
        return members.getMyAccess(this.transport);
    }
    getMemberAccess(targetUserId) {
        return members.getMemberAccess(this.transport, targetUserId);
    }
}
exports.MemberMethods = MemberMethods;
