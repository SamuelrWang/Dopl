"use strict";
/**
 * Agent-template method group — link 9 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `agent-templates.ts`;
 * no HTTP here.
 *
 * `GET`/`POST /api/agent-templates` and `GET`/`PATCH .../{id}` are all
 * agent-token reachable by design (the route docblocks carry the argument);
 * only `DELETE` is `sessionOnly`, and it is deliberately unbound.
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
exports.AgentTemplateMethods = void 0;
const client_skills_js_1 = require("./client-skills.js");
const templates = __importStar(require("./agent-templates.js"));
class AgentTemplateMethods extends client_skills_js_1.SkillMethods {
    listAgentTemplates(opts = {}) {
        return templates.listAgentTemplates(this.transport, opts);
    }
    /** The rows PLUS the shelf sibling key. ⚠ Same single request; read
     *  `homeScopedTemplateIds` as `?? []` (INVARIANTS §8). */
    listAgentTemplatesPayload(opts = {}) {
        return templates.listAgentTemplatesPayload(this.transport, opts);
    }
    getAgentTemplate(templateId) {
        return templates.getAgentTemplate(this.transport, templateId);
    }
    createAgentTemplate(input) {
        return templates.createAgentTemplate(this.transport, input);
    }
    updateAgentTemplate(templateId, patch) {
        return templates.updateAgentTemplate(this.transport, templateId, patch);
    }
}
exports.AgentTemplateMethods = AgentTemplateMethods;
