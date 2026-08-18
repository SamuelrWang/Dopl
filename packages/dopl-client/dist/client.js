"use strict";
/**
 * `DoplClient` — the shared HTTP client for the Dopl API, consumed by
 * `@dopl/mcp-server` and the app.
 *
 * THE TERMINAL LINK of a per-domain method-group chain, not the whole facade.
 * `DoplClient` is still one class with one flat method surface; the methods are
 * declared in the chain's links and inheritance flattens them onto the same
 * instance. See `client-base.ts` for the chain and its ordering rules; HTTP
 * lives in the free-function modules the links delegate to (`workspaces.ts`,
 * `knowledge.ts`, `ontology.ts`, `chats.ts`, `members.ts`, `channel.ts`,
 * `skills.ts`).
 *
 * ⚠ ADD NOTHING TO THIS FILE. A new method belongs in its domain's link — or a
 * new link, per the rules in `client-base.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoplClient = exports.parseRetryAfter = void 0;
const client_billing_js_1 = require("./client-billing.js");
var retry_js_1 = require("./retry.js");
Object.defineProperty(exports, "parseRetryAfter", { enumerable: true, get: function () { return retry_js_1.parseRetryAfter; } });
class DoplClient extends client_billing_js_1.BillingMethods {
}
exports.DoplClient = DoplClient;
