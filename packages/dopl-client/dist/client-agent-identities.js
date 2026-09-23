"use strict";
/**
 * Agent-identity method group (`HomeMethods` extends this one; chain in `client-base.ts`). Pure
 * delegation to `agent-identities.ts`; only `DELETE` is `sessionOnly`, and it is unbound.
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
exports.AgentIdentityMethods = void 0;
const client_skills_js_1 = require("./client-skills.js");
const identities = __importStar(require("./agent-identities.js"));
class AgentIdentityMethods extends client_skills_js_1.SkillMethods {
    listAgentIdentities(opts = {}) {
        return identities.listAgentIdentities(this.transport, opts);
    }
    /** The rows plus the shelf sibling key; read `homeScopedIdentityIds` as `?? []` (INVARIANTS §8). */
    listAgentIdentitiesPayload(opts = {}) {
        return identities.listAgentIdentitiesPayload(this.transport, opts);
    }
    getAgentIdentity(identityId) {
        return identities.getAgentIdentity(this.transport, identityId);
    }
    createAgentIdentity(input) {
        return identities.createAgentIdentity(this.transport, input);
    }
    /** `expectedVersion` is tri-state and omitting it refuses (`agent-identities.ts › updateAgentIdentity`). */
    updateAgentIdentity(identityId, patch, expectedVersion) {
        return identities.updateAgentIdentity(this.transport, identityId, patch, expectedVersion);
    }
}
exports.AgentIdentityMethods = AgentIdentityMethods;
