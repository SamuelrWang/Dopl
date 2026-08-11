"use strict";
/**
 * Knowledge-base method group (Item 4) — link 3 of the chain documented in
 * `client-base.ts`. Pure delegation to `knowledge.ts`; no HTTP here.
 *
 * User-authored, editable knowledge bases. Path-based methods accept a base
 * id and a "/"-separated path; the server resolves to folder/entry rows.
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
exports.KnowledgeMethods = void 0;
const client_workspaces_js_1 = require("./client-workspaces.js");
const kb = __importStar(require("./knowledge.js"));
class KnowledgeMethods extends client_workspaces_js_1.WorkspaceMethods {
    listKbBases() {
        return kb.listKbBases(this.transport);
    }
    getKbBase(baseId) {
        return kb.getKbBase(this.transport, baseId);
    }
    getKbTree(baseId, opts) {
        return kb.getKbTree(this.transport, baseId, opts);
    }
    createKbBase(input) {
        return kb.createKbBase(this.transport, input);
    }
    updateKbBase(baseId, patch) {
        return kb.updateKbBase(this.transport, baseId, patch);
    }
    deleteKbBase(baseId) {
        return kb.deleteKbBase(this.transport, baseId);
    }
    readKbFileByPath(baseId, path) {
        return kb.readKbFileByPath(this.transport, baseId, path);
    }
    writeKbFileByPath(baseId, path, input = {}, expectedVersion) {
        return kb.writeKbFileByPath(this.transport, baseId, path, input, expectedVersion);
    }
    listKbDirByPath(baseId, path = "") {
        return kb.listKbDirByPath(this.transport, baseId, path);
    }
    createKbFolderByPath(baseId, path, description) {
        return kb.createKbFolderByPath(this.transport, baseId, path, description);
    }
    deleteKbByPath(baseId, path) {
        return kb.deleteKbByPath(this.transport, baseId, path);
    }
    moveKbByPath(baseId, fromPath, toPath) {
        return kb.moveKbByPath(this.transport, baseId, fromPath, toPath);
    }
    searchKb(query, opts = {}) {
        return kb.searchKb(this.transport, query, opts);
    }
}
exports.KnowledgeMethods = KnowledgeMethods;
