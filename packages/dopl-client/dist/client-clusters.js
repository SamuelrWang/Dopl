"use strict";
/**
 * Cluster method group — link 3 of the chain documented in `client-base.ts`.
 * Pure delegation to `clusters.ts`; no HTTP here.
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
exports.ClusterMethods = void 0;
const client_workspaces_js_1 = require("./client-workspaces.js");
const clusters = __importStar(require("./clusters.js"));
class ClusterMethods extends client_workspaces_js_1.WorkspaceMethods {
    async createCluster(name) {
        return clusters.createCluster(this.transport, name);
    }
    async listClusters() {
        return clusters.listClusters(this.transport);
    }
    async getCluster(slug) {
        return clusters.getCluster(this.transport, slug);
    }
    async updateCluster(slug, updates) {
        return clusters.updateCluster(this.transport, slug, updates);
    }
    async deleteCluster(slug) {
        return clusters.deleteCluster(this.transport, slug);
    }
}
exports.ClusterMethods = ClusterMethods;
