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

import { BillingMethods } from "./client-billing.js";

// ⚠ Re-exported from HERE, not just `index.ts`: `client.test.ts` imports
// `parseRetryAfter` from this module and `index.ts` re-exports
// `DoplClientOptions` from it. Both are part of the frozen surface.
export type { DoplTransportOptions as DoplClientOptions } from "./transport.js";
export { parseRetryAfter } from "./retry.js";

export class DoplClient extends BillingMethods {}
