"use strict";
/**
 * Home-surface method group — link 10 of the chain in `client-base.ts`
 * (`BillingMethods` extends this one). Pure delegation to `home.ts`; no HTTP
 * here.
 *
 * ⚠ TWO METHODS, and the omissions are the point — link MINT, link REVOKE and
 * the CLAIM are all `sessionOnly`, so none of them is bound. See `home.ts`.
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
exports.HomeMethods = void 0;
const client_agent_templates_js_1 = require("./client-agent-templates.js");
const home = __importStar(require("./home.js"));
class HomeMethods extends client_agent_templates_js_1.AgentTemplateMethods {
    getHomeChannels() {
        return home.getHomeChannels(this.transport);
    }
    createHomeChannel(input) {
        return home.createHomeChannel(this.transport, input);
    }
}
exports.HomeMethods = HomeMethods;
