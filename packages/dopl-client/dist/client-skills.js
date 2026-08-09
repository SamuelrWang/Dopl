"use strict";
/**
 * Skill method group — link 10 and LAST of the chain documented in
 * `client-base.ts`; `DoplClient` in `client.ts` extends this one. Pure
 * delegation to `skills.ts`; no HTTP here.
 *
 * Read paths are unrestricted; write paths are gated server-side by the
 * per-skill `agent_write_enabled` toggle for API-key (agent) callers. Skills
 * are single-file: one SKILL.md procedure body.
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
exports.SkillMethods = void 0;
const client_channels_js_1 = require("./client-channels.js");
const skills = __importStar(require("./skills.js"));
class SkillMethods extends client_channels_js_1.ChannelMethods {
    listSkills() {
        return skills.listSkills(this.transport);
    }
    getSkill(slug) {
        return skills.getSkill(this.transport, slug);
    }
    createSkill(input) {
        return skills.createSkill(this.transport, input);
    }
    updateSkill(slug, patch) {
        return skills.updateSkill(this.transport, slug, patch);
    }
    deleteSkill(slug) {
        return skills.deleteSkill(this.transport, slug);
    }
    readSkillBody(slug) {
        return skills.readSkillBody(this.transport, slug);
    }
    writeSkillBody(slug, body, expectedVersion) {
        return skills.writeSkillBody(this.transport, slug, body, expectedVersion);
    }
}
exports.SkillMethods = SkillMethods;
