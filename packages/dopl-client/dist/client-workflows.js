"use strict";
/**
 * Workflow method group — link 4 of the chain documented in `client-base.ts`.
 * Pure delegation to `workflows.ts`; no HTTP here.
 *
 * `listWorkflowTrash` / `restoreWorkflow` SURVIVED the 2026-08-07 trash
 * teardown on purpose (D3) — see the note atop `workflows.ts`. They look dead
 * next to the knowledge/ontology/chat trash methods that were deleted around
 * them; they are not.
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
exports.WorkflowMethods = void 0;
const client_clusters_js_1 = require("./client-clusters.js");
const workflows = __importStar(require("./workflows.js"));
class WorkflowMethods extends client_clusters_js_1.ClusterMethods {
    async listWorkflows() {
        return workflows.listWorkflows(this.transport);
    }
    async getWorkflow(idOrSlug) {
        return workflows.getWorkflow(this.transport, idOrSlug);
    }
    async createWorkflow(name) {
        return workflows.createWorkflow(this.transport, name);
    }
    async updateWorkflow(idOrSlug, updates) {
        return workflows.updateWorkflow(this.transport, idOrSlug, updates);
    }
    async deleteWorkflow(idOrSlug) {
        return workflows.deleteWorkflow(this.transport, idOrSlug);
    }
    /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
    async listWorkflowTrash() {
        return workflows.listWorkflowTrash(this.transport);
    }
    /** Restore a soft-deleted workflow (recovery, not deletion). */
    async restoreWorkflow(idOrSlug) {
        return workflows.restoreWorkflow(this.transport, idOrSlug);
    }
    // ── Workflow graph authoring ──────────────────────────────────────
    async setWorkflowGraph(idOrSlug, spec) {
        return workflows.setWorkflowGraph(this.transport, idOrSlug, spec);
    }
    async addWorkflowNode(idOrSlug, node) {
        return workflows.addWorkflowNode(this.transport, idOrSlug, node);
    }
    async updateWorkflowNode(idOrSlug, nodeId, patch) {
        return workflows.updateWorkflowNode(this.transport, idOrSlug, nodeId, patch);
    }
    async removeWorkflowNode(idOrSlug, nodeId) {
        return workflows.removeWorkflowNode(this.transport, idOrSlug, nodeId);
    }
    async connectWorkflow(idOrSlug, from, to, condition) {
        return workflows.connectWorkflow(this.transport, idOrSlug, from, to, condition);
    }
    async disconnectWorkflow(idOrSlug, from, to) {
        return workflows.disconnectWorkflow(this.transport, idOrSlug, from, to);
    }
}
exports.WorkflowMethods = WorkflowMethods;
