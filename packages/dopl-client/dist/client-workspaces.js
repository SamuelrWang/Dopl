"use strict";
/**
 * Workspace method group — link 2 of the chain documented in
 * `client-base.ts`. Pure delegation to `workspaces.ts`; no HTTP here.
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
exports.WorkspaceMethods = void 0;
const client_base_js_1 = require("./client-base.js");
const workspaces = __importStar(require("./workspaces.js"));
const grants = __importStar(require("./grants.js"));
class WorkspaceMethods extends client_base_js_1.DoplClientBase {
    async listWorkspaces() {
        return workspaces.listWorkspaces(this.transport);
    }
    async getWorkspace(slug) {
        return workspaces.getWorkspace(this.transport, slug);
    }
    /** See `workspaces.getActiveWorkspace`. */
    async getActiveWorkspace() {
        return workspaces.getActiveWorkspace(this.transport);
    }
    /**
     * Lend one resource to one scope — the write that REPLACED the copy ops
     * (Wave B ruling B11). ⚠ It lives on link 2 because a grant is cross-domain:
     * `KnowledgeMethods` and `AgentTemplateMethods` both call it, and a method on
     * either of those would be invisible to the other.
     */
    async grantResource(input) {
        return grants.grantResource(this.transport, input);
    }
    async pingMcpStatus() {
        return workspaces.pingMcpStatus(this.transport);
    }
}
exports.WorkspaceMethods = WorkspaceMethods;
